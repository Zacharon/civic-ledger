"""Read public primary sources without installing a collector or saving raw page dumps.

Run from this directory. Uses normal TLS verification, one request per URL, a 20-second
timeout and at most three concurrent requests. A failed source remains failed; there
is no challenge bypass, login, stealth browser or proxy rotation.
"""
import concurrent.futures
import csv
import datetime
import hashlib
import io
import json
from pathlib import Path
import ssl
import subprocess
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent
SENATE = 'https://www.senate.gov/general/contact_information/senators_cfm.xml'
HOUSE = 'https://clerk.house.gov/xml/lists/MemberData.xml'
LEGISLATORS = 'https://unitedstates.github.io/congress-legislators/legislators-current.json'
VOTEVIEW = 'https://voteview.com/static/data/out/rollcalls/HS119_rollcalls.csv'
TARGETS = [
    'Warren', 'Baldwin', 'Rosen', 'Kim', 'Gallego', 'Alsobrooks',
    'Cruz', 'Scott', 'Blackburn', 'Hawley', 'McCormick', 'Moreno',
    'Ocasio-Cortez', 'Jeffries', 'Khanna', 'Frost', 'McBride', 'Subramanyam',
    'Johnson', 'Jordan', 'Fitzpatrick', 'Mace', 'Lawler', 'McDowell',
]


def fetch(url):
    receipt = {'url': url, 'requested_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'CivicLedgerProposalReview/1.0', 'Accept': '*/*'})
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read(5_000_001)
            if len(body) > 5_000_000:
                raise ValueError('Source exceeded 5MB audit bound')
            receipt.update(status=response.status, final_url=response.url,
                           content_type=response.headers.get('Content-Type'),
                           sha256=hashlib.sha256(body).hexdigest(), bytes=len(body))
            receipt['retrieved_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            return receipt, body
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        # Node uses its normal verified trust store. Never disable certificate checks.
        # This handles the known Python/Voteview certificate-chain failure transparently.
        if isinstance(getattr(error, 'reason', None), ssl.SSLCertVerificationError):
            code = "const r=await fetch(process.argv[1],{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('HTTP '+r.status);const chunks=[];let size=0;for await(const c of r.body){size+=c.length;if(size>5000000)throw new Error('Source exceeded 5MB audit bound');chunks.push(c)}process.stderr.write(JSON.stringify({status:r.status,final_url:r.url,content_type:r.headers.get('content-type')}));process.stdout.write(Buffer.concat(chunks))"
            fallback = subprocess.run(['node', '--input-type=module', '-e', code, url], capture_output=True, timeout=25)
            if fallback.returncode == 0:
                body = fallback.stdout
                metadata = json.loads(fallback.stderr)
                receipt.update(**metadata,
                               sha256=hashlib.sha256(body).hexdigest(), bytes=len(body),
                               retrieved_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                               fallback='Node fetch with normal TLS verification', initial_error=str(error))
                return receipt, body
        receipt.update(status=getattr(error, 'code', None), error=str(error), sha256=None)
        receipt['retrieved_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        return receipt, None


def write(name, data):
    (ROOT / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')


def identity_audit():
    receipts = []
    official = []
    for url, chamber in [(SENATE, 'senate'), (HOUSE, 'house')]:
        receipt, body = fetch(url)
        receipts.append(receipt)
        if body is None:
            raise RuntimeError(f'Identity source unavailable: {receipt}')
        root = ET.fromstring(body)
        members = root.findall('member') if chamber == 'senate' else root.findall('members/member/member-info')
        for member in members:
            last = member.findtext('last_name') if chamber == 'senate' else member.findtext('lastname')
            first = member.findtext('first_name') if chamber == 'senate' else member.findtext('firstname')
            # Scott/Kim/Johnson have namesakes: match the requested person explicitly.
            wanted = last in TARGETS and not (
                (last == 'Scott' and not first.startswith('Rick')) or
                (last == 'Kim' and not first.startswith('Andy')) or
                (last == 'Johnson' and not first.startswith('Mike')) or
                (last == 'McCormick' and chamber != 'senate')
            )
            if not wanted:
                continue
            official.append({
                'last_name': last, 'first_name': first, 'chamber': chamber,
                'bioguide': member.findtext('bioguide_id') if chamber == 'senate' else member.findtext('bioguideID'),
                'party': member.findtext('party'),
                'state': member.findtext('state') if chamber == 'senate' else member.find('state').get('postal-code'),
                'district': None if chamber == 'senate' else member.findtext('district'),
                'source_url': url, 'source_sha256': receipt['sha256'], 'retrieved_at': receipt['retrieved_at'],
                'prior_congresses': None if chamber == 'senate' else member.findtext('prior-congress'),
            })
    if len(official) != 24 or len({p['bioguide'] for p in official}) != 24:
        raise RuntimeError(f'Expected 24 unique official identities, got {official}')
    receipt, body = fetch(LEGISLATORS)
    receipts.append(receipt)
    if body:
        by_id = {p['id']['bioguide']: p for p in json.loads(body)}
        for person in official:
            counterpart = by_id.get(person['bioguide'])
            person['first_federal_term'] = min(t['start'] for t in counterpart['terms']) if counterpart else None
            person['tenure_source_url'] = LEGISLATORS
            person['tenure_source_sha256'] = receipt['sha256']
    write('identities.json', official)
    return receipts


def framework_audit():
    receipts = []
    bills = []
    for kind, number in [('s', 5), ('s', 146), ('hr', 1)]:
        url = f'https://www.govinfo.gov/bulkdata/BILLSTATUS/119/{kind}/BILLSTATUS-119{kind}{number}.xml'
        receipt, body = fetch(url)
        receipts.append(receipt)
        if not body:
            raise RuntimeError(f'Bill source unavailable: {receipt}')
        root = ET.fromstring(body)
        bill = root.find('bill')
        votes = []
        for action in bill.findall('actions/item'):
            for vote in action.findall('recordedVotes/recordedVote'):
                votes.append({
                    'action_date': action.findtext('actionDate'), 'action_text': action.findtext('text'),
                    'chamber': vote.findtext('chamber'), 'session': vote.findtext('sessionNumber'),
                    'clerk_rollnumber': vote.findtext('rollNumber'), 'url': vote.findtext('url'),
                })
        bills.append({'bill_type': kind, 'number': number, 'congress': 119, 'title': bill.findtext('title'),
                      'source_url': url, 'source_sha256': receipt['sha256'], 'retrieved_at': receipt['retrieved_at'], 'recorded_votes': votes})
    receipt, body = fetch(VOTEVIEW)
    receipts.append(receipt)
    if not body:
        raise RuntimeError(f'Voteview source unavailable: {receipt}')
    rows = list(csv.DictReader(io.StringIO(body.decode('utf-8-sig'))))
    mapping = []
    for bill in bills:
        for vote in bill['recorded_votes']:
            matches = [r for r in rows if r['chamber'].lower() == (vote['chamber'] or '').lower()
                       and r['session'] == vote['session'] and r['clerk_rollnumber'] == vote['clerk_rollnumber']]
            for row in matches:
                mapping.append({**vote, 'bill': f"{bill['bill_type'].upper()}{bill['number']}",
                                'voteview_rollnumber': int(row['rollnumber']), 'vote_question': row['vote_question'],
                                'vote_result': row['vote_result'], 'vote_date': row['date'],
                                'yea_count': row['yea_count'], 'nay_count': row['nay_count'], 'voteview_url': VOTEVIEW,
                                'voteview_sha256': receipt['sha256']})
    # Source XML can list one roll call under more than one action; preserve one canonical key.
    mapping = list({(m['bill'], m['chamber'], m['session'], m['clerk_rollnumber']): m for m in mapping}.values())
    write('framework-vote-records.json', {'bills': bills, 'mapped_votes': mapping})
    final_votes = []
    for vote in mapping:
        if not vote['vote_question'].startswith(('On Passage', 'On Motion to Suspend the Rules and Pass', 'On Motion to Concur')):
            continue
        number = int(vote['clerk_rollnumber'])
        url = (f"https://clerk.house.gov/evs/{vote['vote_date'][:4]}/roll{number:03}.xml" if vote['chamber'].lower() == 'house'
               else f"https://www.senate.gov/legislative/LIS/roll_call_votes/vote119{vote['session']}/vote_119_{vote['session']}_{number:05}.xml")
        official_receipt, official_body = fetch(url)
        receipts.append(official_receipt)
        if official_body:
            official_root = ET.fromstring(official_body)
            final_votes.append({**vote, 'official_xml_url': url, 'official_xml_sha256': official_receipt['sha256'],
                                'official_xml_root': official_root.tag, 'retrieved_at': official_receipt['retrieved_at']})
        else:
            final_votes.append({**vote, 'official_xml_url': url, 'official_xml_sha256': None, 'verification_error': official_receipt.get('error')})
    write('framework-final-votes.json', final_votes)
    return receipts


if __name__ == '__main__':
    receipts = identity_audit() + framework_audit()
    index_path = ROOT / 'review-records.json'
    if index_path.exists():
        index = json.loads(index_path.read_text(encoding='utf-8'))
        urls = sorted({url for record in index for url in [record.get('source_url'), record.get('cycle_source_url')] if url})
        urls += [
            'https://www.aclu.org/scorecard/', 'https://heritageaction.com/scorecard',
            'https://www.ntu.org/ratecongress', 'https://www.thelugarcenter.org/ourwork-Bipartisan-Index.html',
            'https://raw.githubusercontent.com/unclecode/crawl4ai/main/LICENSE',
            'https://raw.githubusercontent.com/D4Vinci/Scrapling/main/LICENSE',
            'https://raw.githubusercontent.com/apify/crawlee/master/LICENSE.md',
        ]
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            for receipt, _body in pool.map(fetch, urls):
                receipts.append(receipt)
    write('source-receipts.json', receipts)
    print(json.dumps({'official_identities': 24, 'source_receipts': len(receipts), 'failed': [r['url'] for r in receipts if r.get('sha256') is None]}))
