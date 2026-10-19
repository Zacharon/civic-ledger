# Proposed source collection pilot

Admission: **PENDING**. Installation, tool trials, dependency security review and
compatibility proof: **NOT_RUN**. The small standard-library HTTP audit used to
prepare these proposals is not a trial of any of the recommended collectors.

| Candidate | Potential fit | Current actual license source | Remaining admission |
|---|---|---|---|
| Crawlee | Strongest fit for a durable TypeScript request queue beside the existing Node/TypeScript ingest system. A bounded allowlist and persistent request receipts could help resume permitted source collection. Static XML/HTML should use ordinary HTTP first. | [Apache 2.0 LICENSE.md on master](https://github.com/apify/crawlee/blob/master/LICENSE.md) | Exact version and transitive graph, security, Node 24 compatibility, resource limits, source-specific terms, and owner authorization remain pending. |
| Crawl4AI | Potential Python research/extraction worker for turning permitted public HTML into structured candidate evidence; less direct fit for the existing TypeScript production path. | [Actual LICENSE on main](https://github.com/unclecode/crawl4ai/blob/main/LICENSE) | The file contains Apache 2.0 text plus an additional Attribution Requirement. Treat it as that actual combined license, not an uncomplicated Apache-only approval. Review its public web/CLI/publication credit requirements and the exact release before admission. |
| Scrapling | Potential Python extraction aid when permitted pages change structure. It offers little immediate benefit for the stable official identity and vote XML in this pilot. | [BSD 3-Clause LICENSE on main](https://github.com/D4Vinci/Scrapling/blob/main/LICENSE) | Exact version/graph, security, compatibility and a demonstrated need remain pending. No stealth mode, challenge bypass, fingerprint evasion, proxy rotation or login collection is proposed. |

Current license response hashes and retrieval clocks are in `source-receipts.json`.
The moving branches are source leads, not pinned or admitted dependency versions.
No package manifest or lockfile changed. A permissive license alone is not a completed
security/compatibility review, and a tool's license does not authorize copying a site's
content or publisher scores.

## Three-source pilot, proposed only

1. [Official Senate identity XML](https://www.senate.gov/general/contact_information/senators_cfm.xml):
   verify member identity/Bioguide references. Retain the original URL, response hash,
   retrieval time and selected public identity fields. Publication time remains UNKNOWN
   when the source does not provide one.
2. [Dated candidate-authored campaign opinion](https://www.davemccormickpa.com/2024/05/15/my-plan-to-shake-up-washington/):
   prepare one short paraphrase of the two-term commitment, preserving the conditional
   election language, the source's May 15, 2024 publication date and its 2024 campaign
   context separately from retrieval. Keep a short contextual excerpt within the
   quotation budget rather than republishing the page.
3. [Official House roll-call XML](https://clerk.house.gov/evs/2025/roll104.xml):
   verify the bill, Congress, session, official roll number, vote date and totals. Preserve
   the separate Voteview sequence mapping; clerk roll 104 is Voteview sequence 103.

Bound the pilot to these three URLs, one ordinary request per source at a time, with
timeouts and response-size limits. Respect source access restrictions. A 403 or failed
certificate check is evidence to retain, not a reason to bypass a control. The audit
recorded Python's Voteview certificate-chain failure and used Node's normal verified
TLS trust store successfully; no TLS verification was disabled.

Each candidate receipt should contain original/final URL, HTTP status, source publication
time and precision (or UNKNOWN), retrieval time, SHA-256 of the exact response bytes,
extraction version, statement/paraphrase, section locator, surrounding context, identity
reference and owner review status. Hash the response before extraction. A changed source,
retraction, missing context or prepared/current proposal mismatch requires fresh review;
it must not silently replace the human's current wording. Record failures and rejected
interpretations. No collector should follow instructions embedded in source pages.

Success would mean reproducible, reviewed candidate evidence from all three source
types, plus a repeat run that preserves duplicates and changes correctly. It would not
establish nationwide coverage, permission to republish scorecards, automatic ratings,
production readiness or authority to activate these proposals.
