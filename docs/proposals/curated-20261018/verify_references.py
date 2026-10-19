"""Read-only proposal identity, policy, manifest and official-vote reference checks."""
import datetime
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from audit_sources import fetch

ROOT = Path(__file__).resolve().parent
read = lambda name: json.loads((ROOT / name).read_text(encoding='utf-8'))
identities = {p['bioguide']: p for p in read('identities.json')}
records = read('review-index.json')
receipts = {r['url']: r for r in read('source-receipts.json')}
assert len(identities) == 24
for record in records:
    identity = identities[record['bioguide']]
    assert identity['last_name'] == record['member_last_name']
    assert identity['party'] == record['party'] and identity['chamber'] == record['chamber']
    assert identity['source_sha256'] == receipts[identity['source_url']]['sha256']
    assert record['owner_approved'] is False
    assert record.get('ratings', []) == []
    if record['kind'] == 'position' and record['proposal_file']:
        assert record['source_kind'] == 'campaign' and record['cycle'] is not None
        assert record['source_receipt']['sha256']

manifest = read('proposal-manifest.json')
for entry in manifest:
    actual = hashlib.sha256((ROOT / entry['path']).read_bytes()).hexdigest()
    assert actual == entry['sha256'], f"REFUSE_STALE: {entry['path']} differs from its review manifest"

checks = []
for vote in read('framework-final-votes.json'):
    receipt, body = fetch(vote['official_xml_url'])
    assert body, f"Official vote unavailable: {receipt}"
    assert receipt['sha256'] == vote['official_xml_sha256'], f"FRESH_REVIEW_REQUIRED: changed official XML {vote['official_xml_url']}"
    root = ET.fromstring(body)
    if vote['chamber'].lower() == 'house':
        metadata = root.find('vote-metadata')
        official_bill = metadata.findtext('legis-num')
        official_congress = metadata.findtext('congress')
        official_session = re.sub('[^0-9]', '', metadata.findtext('session'))
        official_number = metadata.findtext('rollcall-num')
        official_date = datetime.datetime.strptime(metadata.findtext('action-date'), '%d-%b-%Y').date().isoformat()
        yea = metadata.findtext('vote-totals/totals-by-vote/yea-total')
        nay = metadata.findtext('vote-totals/totals-by-vote/nay-total')
    else:
        official_bill = root.findtext('document/document_name')
        official_congress = root.findtext('congress')
        official_session = root.findtext('session')
        official_number = root.findtext('vote_number')
        date_text = ','.join(root.findtext('vote_date').split(',')[:2])
        official_date = datetime.datetime.strptime(date_text, '%B %d, %Y').date().isoformat()
        yea = root.findtext('count/yeas')
        nay = root.findtext('count/nays')
    assert re.sub('[^A-Z0-9]', '', official_bill.upper()) == vote['bill']
    assert int(official_congress) == 119 and int(official_session) == int(vote['session'])
    assert int(official_number) == int(vote['clerk_rollnumber']) and official_date == vote['vote_date']
    assert int(yea) == int(vote['yea_count']) and int(nay) == int(vote['nay_count'])
    checks.append({'bill': vote['bill'], 'chamber': vote['chamber'], 'session': int(official_session),
                   'official_roll': int(official_number), 'voteview_sequence': vote['voteview_rollnumber'],
                   'date': official_date, 'yea': int(yea), 'nay': int(nay), 'receipt': receipt, 'result': 'PASS'})
assert len(checks) == 6
result = {'official_identities_checked': 24, 'record_identity_references_checked': len(records),
          'proposal_hashes_checked': len(manifest), 'official_vote_references_checked': len(checks),
          'vote_checks': checks, 'all_promise_ratings_empty': True,
          'owner_approved': False, 'database_load': 'NOT_RUN', 'result': 'PASS'}
(ROOT / 'reference-checks.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({k: v for k, v in result.items() if k != 'vote_checks'}))
