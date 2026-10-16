# Ingest test fixtures

Every line in `congress-legislators/`, `voteview/`, `fec-bulk/` and `govinfo-billstatus/`
is an unedited line (or XML document) from the real source file downloaded on 2026-10-16,
selected by `cut_fixtures.py` (`python -I cut_fixtures.py <raw-dir> <this-dir>`). Tests
load them offline through `ingest.run@1` with `snapshotPath`.

| Case | Real rows used |
|---|---|
| Several FEC ids, Senate run from the House | Andy Barr B001282 (`H0KY06104`, `S6KY00286`, both on the 2026 ballot) |
| At-large seat, identical weball rows per id | Harriet Hageman H001096 (WY district 0; Voteview district 1) |
| Party switch inside a term; Voteview icpsr differs from c-l | Jefferson Van Drew V000133 (2019, icpsr 21980 vs 91980) |
| Party switch with two Voteview icpsr ids | Kevin Kiley K000401 (22336 and 92336) |
| Non-voting delegate (district 0, no floor votes) | Eleanor Holmes Norton N000147 |
| Senator with an old House FEC id | Maria Cantwell C000127 |
| Historical: no party; district -1 | Theodorick Bland B000546; George Clymer C000538 |
| Session-2 clerk numbers; non-final Senate vote | H.J.Res. 142 (House 2/56, Senate 2/36 motion to proceed, 2/37) |
| Recorded vote with no loaded rollcall | H.Res. 893 (House 1/302 left out on purpose) |
| Bill without a policy area | S. 5531 |
| pas2 refund reusing the original TRAN_ID | C00004861 `B897712` (+2,500 / −2,500) |
| pas2 TRAN_ID reused across reports | C00692327 `SB23.1` (two M4 reports, different years) |
| pas2 amendment of the same report | C00679167 `SB23.4553` (N then A) |
| pas2 identical re-report | C00193441 `AAF694CEB100445C8A7D` (Q2 N, MY A) |
| pas2 memo, 24E, recipient via committee, joint recipient, `ENTITY_TP=IND` | one row each |
| IE amended filing; Form 5 re-report; per-filing tran_id reuse | C00935767 `SE.4124`; C90023581 `F57.000002`; C00608943 `1` |
| IE bogus amount, blank candidate, blank S/O, lower-case candidate id | one row each (`h2az02360`) |

`curated/` is different: **fictional** promise, platform and framework files about the
invented person X000001, so no test asserts a claim about a real politician. Tests combine
them with the repository's real `policy_areas` and `industry_map`.
