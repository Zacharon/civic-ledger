"""Prepare review-only YAML from the fixed research ledger and captured source receipts.

This never writes data/curated, loads a database or assigns a promise rating. It
refuses to overwrite an existing candidate whose exact bytes differ. For a deliberate
revision, review the diff and edit that named proposal file; do not silently regenerate.
"""
from collections import Counter
import datetime
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]


def read(name):
    return json.loads((ROOT / name).read_text(encoding='utf-8'))


def write_json(name, data):
    (ROOT / name).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')


def quoted(value):
    return json.dumps(value, ensure_ascii=False)


def candidate(path, content):
    path = ROOT / path
    path.parent.mkdir(exist_ok=True)
    content += '\n'
    if path.exists() and path.read_bytes() != content.encode('utf-8'):
        raise RuntimeError(f'FRESH_REVIEW_REQUIRED: refusing to overwrite changed proposal {path.name}')
    path.write_text(content, encoding='utf-8', newline='\n')


identities = read('identities.json')
by_name = {p['last_name']: p for p in identities}
receipts = {r['url']: r for r in read('source-receipts.json')}
records = read('review-records.json')
policy_path = REPO / 'data/curated/policy_areas/congress-gov.yaml'
policies = set(re.findall(r'\bid: ([a-z0-9-]+)', policy_path.read_text(encoding='utf-8')))
assert len(identities) == len({p['bioguide'] for p in identities}) == 24
assert Counter(p['party'] for p in identities) == {'D': 12, 'R': 12}
assert Counter(p['chamber'] for p in identities) == {'house': 12, 'senate': 12}
assert len({r['record_id'] for r in records}) == len(records) == 32
assert len({r['member_last_name'] for r in records if r['kind'] == 'position'}) == 24
assert len([r for r in records if r['kind'] == 'promise']) == 8

for record in records:
    identity = by_name[record['member_last_name']]
    record.update(bioguide=identity['bioguide'], party=identity['party'], chamber=identity['chamber'],
                  name=f"{identity['first_name']} {identity['last_name']}",
                  identity_source_url=identity['source_url'],
                  identity_source_sha256=identity['source_sha256'])
    assert record['policy_area'] in policies, record
    assert record['source_url'].startswith('https://') and record['owner_approved'] is False
    if record['published_on']:
        datetime.date.fromisoformat(record['published_on'])
    receipt = receipts.get(record['source_url'])
    assert receipt, record['source_url']
    record['source_receipt'] = {k: receipt.get(k) for k in ['status', 'retrieved_at', 'sha256', 'final_url', 'error']}
    if not receipt.get('sha256'):
        record['status'] = 'HOLD'
        record['hold_reason'] = (record['hold_reason'] + '; ' if record['hold_reason'] else '') + 'DIRECT_FETCH_FAILED'
    record['proposal_file'] = None
    if record['kind'] == 'position' and record['status'] != 'HOLD':
        assert record['source_kind'] == 'campaign' and record['cycle']
        path = f"platforms/{identity['bioguide']}-{record['cycle']}.yaml"
        candidate(path, '\n'.join([
            '# REVIEW ONLY. Owner approval required before any copy to data/curated.',
            'schema_version: 1', 'person:', f"  bioguide: {identity['bioguide']}",
            f"cycle: {record['cycle']}", 'positions:', f"  - policy_area: {record['policy_area']}",
            f"    stance: {quoted(record['statement'])}", f"    source_url: {record['source_url']}",
        ]))
        record['proposal_file'] = path
    elif record['kind'] == 'promise' and record['status'] != 'HOLD':
        assert record['ratings'] == []
        path = f"promises/{identity['bioguide']}.yaml"
        candidate(path, '\n'.join([
            '# REVIEW ONLY. Empty ratings means not_yet_rated; no agent verdict.',
            'schema_version: 1', 'person:', f"  bioguide: {identity['bioguide']}", 'promises:',
            f"  - id: {record['record_id']}", f"    statement: {quoted(record['statement'])}",
            f"    made_on: {record['made_on']}", f"    policy_area: {record['policy_area']}",
            f"    source_url: {record['source_url']}", '    ratings: []',
        ]))
        record['proposal_file'] = path

votes = read('framework-final-votes.json')
assert len(votes) == 6 and all(v.get('official_xml_sha256') for v in votes)
frameworks = [
    ('laken-riley-detention-support', 'Support for the Laken Riley Act detention approach', 'S5', 'yea',
     'Favors the immigration-detention and state-enforcement approach in S.5, rather than evaluating a member overall.'),
    ('take-it-down-act-support', 'Support for the TAKE IT DOWN Act', 'S146', 'yea',
     'Favors the federal criminal and removal-notice approach to nonconsensual intimate imagery in S.146.'),
    ('reconciliation-2025-opposition', 'Opposition to the 2025 reconciliation package', 'HR1', 'nay',
     'Opposes H.R.1 as a whole. The vote bundles tax, spending and other provisions and cannot isolate a motive or one issue.'),
]
framework_index = []
for slug, title, bill, aligned, orientation in frameworks:
    selected = [v for v in votes if v['bill'] == bill]
    unique = {(v['chamber'].lower(), v['voteview_rollnumber']) for v in selected}
    assert len(unique) == len(selected)
    chamber_max = Counter(v['chamber'].lower() for v in selected)
    description = f"Owner-review proposal. One curator's opt-in view, never a neutral score. Fixed set of {len(selected)} roll calls from 119th-Congress {bill}; all weights are 1. A member's denominator counts only these roll calls with a recorded yea or nay. Present, not voting, missing positions and the other chamber's votes do not increase that denominator. No member results are calculated in this proposal. See framework-final-votes.json for official records and source mappings."
    lines = ['# REVIEW ONLY. Not a publisher scorecard or an approved owner framework.', 'schema_version: 1',
             f'slug: {slug}', 'version: 1', f'title: {quoted(title)}',
             'author: Civic Ledger proposal curator (agent; owner approval pending)',
             f'stated_orientation: {quoted(orientation)}', f'description: {quoted(description)}', 'rules:']
    for vote in selected:
        lines += ['  - target:', '      kind: rollcall', '      congress: 119',
                  f"      chamber: {vote['chamber'].lower()}", f"      number: {vote['voteview_rollnumber']}",
                  f'    aligned_position: {aligned}', '    weight: 1',
                  f"    rationale: {quoted(f'Curator-selected {aligned} position on {bill}. Official session {vote["session"]}, roll {vote["clerk_rollnumber"]}, {vote["vote_date"]}: {vote["official_xml_url"]}. Source sequence is Voteview {vote["voteview_rollnumber"]}, not the official clerk number.')}" ]
    path = f'frameworks/{slug}-v1.yaml'
    candidate(path, '\n'.join(lines))
    framework_index.append({'slug': slug, 'proposal_file': path, 'bill': bill, 'aligned_position': aligned,
                            'fixed_rollcall_count': len(selected), 'maximum_denominator_by_chamber': dict(chamber_max),
                            'per_member_denominator': 'Count distinct selected roll calls on which that person voted yea or nay; never assume the maximum for an absent/nonmember person.',
                            'rollcalls': [{'congress': 119, 'chamber': v['chamber'].lower(), 'number': v['voteview_rollnumber'], 'official_roll': int(v['clerk_rollnumber']), 'session': int(v['session']), 'date': v['vote_date'], 'official_url': v['official_xml_url']} for v in selected],
                            'owner_approved': False})

write_json('review-index.json', records)
write_json('framework-index.json', framework_index)
manifest = [{'path': str(p.relative_to(ROOT)).replace('\\', '/'), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
            for kind in ['platforms', 'promises', 'frameworks'] for p in sorted((ROOT / kind).glob('*.yaml'))]
write_json('proposal-manifest.json', manifest)
summary = {
    'position_candidates': len([r for r in records if r['kind'] == 'position']),
    'platform_yaml': len([r for r in records if r['kind'] == 'position' and r['proposal_file']]),
    'held_position_candidates': len([r for r in records if r['kind'] == 'position' and not r['proposal_file']]),
    'promise_candidates': len([r for r in records if r['kind'] == 'promise']),
    'promise_yaml': len([r for r in records if r['kind'] == 'promise' and r['proposal_file']]),
    'frameworks': len(framework_index), 'yaml_files': len(manifest),
    'newer_members_first_federal_term_2023_or_later': sum(p['first_federal_term'] >= '2023-01-01' for p in identities),
    'longer_serving_members_first_federal_term_2013_or_earlier': sum(p['first_federal_term'] <= '2013-12-31' for p in identities),
    'owner_approved': False, 'loaded': False,
}
write_json('validation-summary.json', summary)
print(json.dumps(summary))
