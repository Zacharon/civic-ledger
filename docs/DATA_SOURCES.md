---
type: research
created: 2026-10-15
status: bronze-evidence
use: ingest adapter spec (copied to repo docs/DATA_SOURCES.md)
---
# Data sources — ingest adapter spec (verified 2026-10-15)

Subagent research (Claude Sonnet 5.5). Formats confirmed by fetching real header rows / first lines on 2026-10-15. Where docs and the real file disagree, the real file wins and the difference is noted.

## 1. unitedstates/congress-legislators (c-l) — CC0

Base `https://unitedstates.github.io/congress-legislators/`. Files: `legislators-current.json` (539 people), `legislators-historical.json` (12,231 people, 13.5 MB), also `.yaml`/`.csv`; `committees-current.json`, `committee-membership-current.json`, `legislators-social-media.json`, `legislators-district-offices.json`. Last-Modified 2026-09-24.

- Person: `id`, `name{first,last,official_full,middle?,suffix?,nickname?}`, `bio{birthday,gender}`, `terms[]` (oldest → newest).
- `id`: `bioguide` (primary key, 539/539), `fec[]` (537), `opensecrets` (523), `govtrack` (539), `icpsr` (**only 319/539**), `lis` (Senate, 100), `wikidata`, `votesmart`, `ballotpedia`, `wikipedia`, `thomas`, `cspan`, `maplight`, `google_entity_id`.
- `terms[]`: `type` sen|rep, `start`, `end` (scheduled end, not departure), `state`, `party` (word: Democrat/Republican/Independent; missing on some historical), rep: `district` int (at-large & delegates = 0); sen: `class`, `state_rank`; optional `party_affiliations[]` for switchers, `caucus`, `url`, `phone`, etc.

## 2. Voteview — no license stated; citation requested

Base `https://voteview.com/static/data/out/`; names `{members|rollcalls|votes}/{H|S|HS|HSall}{NNN}_{kind}.csv` (3-digit zero-padded congress; `H10` 404s). Also `parties/HSall_parties.csv`. Votes have no JSON. `HSall_votes.csv` is 702 MB — use per-congress files.

- members (22): `congress,chamber,icpsr,state_icpsr,district_code,state_abbrev,party_code,occupancy,last_means,bioname,bioguide_id,born,died,nominate_dim1,nominate_dim2,nominate_log_likelihood,nominate_geo_mean_probability,nominate_number_of_votes,nominate_number_of_errors,conditional,nokken_poole_dim1,nokken_poole_dim2`. Chamber House|Senate|President (President row: blank bioguide, icpsr 99912). `party_code` 100 D, 200 R, 328 I. `conditional=1` = provisional estimate. dim1 can be blank.
- rollcalls (19): `congress,chamber,rollnumber,date,session,clerk_rollnumber,majority_requirement,yea_count,nay_count,nominate_mid_1,nominate_mid_2,nominate_spread_1,nominate_spread_2,nominate_log_likelihood,bill_number,vote_result,vote_desc,vote_question,dtl_desc`. `bill_number` like `HR1`, `HRES977`, `S5`, `PN121`; blank for procedural votes; Senate has many `PN` nominations (458/915 in S119).
- **`rollnumber` is Voteview's own sequence** (continuous across sessions, excludes quorum calls). Official number = `clerk_rollnumber` + `session`.
- votes (6): `congress,chamber,rollnumber,icpsr,cast_code,prob`. cast_code: 0 not member, 1 Yea, 2 paired yea, 3 announced yea, 4 announced nay, 5 paired nay, 6 Nay, 7/8 Present, 9 Not voting.
- Citation: "Voteview: Congressional Roll-Call Votes Database," Lewis, Poole, Rosenthal, Boche, Rudkin, Sonnet (2026), https://voteview.com/.
- Freshness: per-congress files modified 2026-10-01; poll by Last-Modified/ETag.
- TLS: Python 3.14 urllib saw an expired-cert error; curl/openssl fine (LE cert valid to 2026-12-01). Do not disable TLS verification.

## 3. FEC bulk (2026 cycle) — committee data reusable; individual donor names restricted

Base `https://www.fec.gov/files/bulk-downloads/2026/` (302 → S3; follow redirects). Pipe-delimited `.txt` inside zips, **no header row**, decode latin-1. Header files at `.../data_dictionaries/{cn,cm,ccl,pas2,oth,indiv,oppexp}_header_file.csv` (none for weball).

| File | Inner | Columns |
|---|---|---|
| `cn26.zip` | `cn.txt` | `CAND_ID,CAND_NAME,CAND_PTY_AFFILIATION,CAND_ELECTION_YR,CAND_OFFICE_ST,CAND_OFFICE,CAND_OFFICE_DISTRICT,CAND_ICI,CAND_STATUS,CAND_PCC,CAND_ST1,CAND_ST2,CAND_CITY,CAND_ST,CAND_ZIP` |
| `cm26.zip` | `cm.txt` | `CMTE_ID,CMTE_NM,TRES_NM,CMTE_ST1,CMTE_ST2,CMTE_CITY,CMTE_ST,CMTE_ZIP,CMTE_DSGN,CMTE_TP,CMTE_PTY_AFFILIATION,CMTE_FILING_FREQ,ORG_TP,CONNECTED_ORG_NM,CAND_ID` |
| `ccl26.zip` | `ccl.txt` | `CAND_ID,CAND_ELECTION_YR,FEC_ELECTION_YR,CMTE_ID,CMTE_TP,CMTE_DSGN,LINKAGE_ID` |
| `weball26.zip` | `weball26.txt` | `CAND_ID,CAND_NAME,CAND_ICI,PTY_CD,CAND_PTY_AFFILIATION,TTL_RECEIPTS,TRANS_FROM_AUTH,TTL_DISB,TRANS_TO_AUTH,COH_BOP,COH_COP,CAND_CONTRIB,CAND_LOANS,OTHER_LOANS,CAND_LOAN_REPAY,OTHER_LOAN_REPAY,DEBTS_OWED_BY,TTL_INDIV_CONTRIB,CAND_OFFICE_ST,CAND_OFFICE_DISTRICT,SPEC_ELECTION,PRIM_ELECTION,RUN_ELECTION,GEN_ELECTION,GEN_ELECTION_PRECENT,OTHER_POL_CMTE_CONTRIB,POL_PTY_CONTRIB,CVG_END_DT,INDIV_REFUNDS,CMTE_REFUNDS` (dates MM/DD/YYYY, decimal amounts) |
| `pas226.zip` | `itpas2.txt` | `CMTE_ID,AMNDT_IND,RPT_TP,TRANSACTION_PGI,IMAGE_NUM,TRANSACTION_TP,ENTITY_TP,NAME,CITY,STATE,ZIP_CODE,EMPLOYER,OCCUPATION,TRANSACTION_DT,TRANSACTION_AMT,OTHER_ID,CAND_ID,TRAN_ID,FILE_NUM,MEMO_CD,MEMO_TEXT,SUB_ID` (date MMDDYYYY; SUB_ID unique; CMTE_ID = giver, OTHER_ID = recipient committee) |
| `independent_expenditure_2026.csv` | plain CSV, **lower-case quoted header** | `cand_id,cand_name,spe_id,spe_nam,ele_type,can_office_state,can_office_dis,can_office,cand_pty_aff,exp_amo,exp_date,agg_amo,sup_opp,pur,pay,file_num,amndt_ind,tran_id,image_num,receipt_dat,fec_election_yr,prev_file_num,dissem_dt` (dates `16-MAY-26`; `sup_opp` S/O; originals + amendments both present → dedupe via `prev_file_num`; `cand_id` may be blank) |

- Codes: `CMTE_DSGN` A authorized, B lobbyist PAC, D leadership PAC, J joint fundraiser, P principal, U unauthorized. `ORG_TP` C corp, L labor, M membership, T trade, V coop, W corp w/o stock. `CAND_OFFICE` H/S/P; district `00` at-large/Senate. `CAND_ICI` C/I/O.
- pas2 profile (2026-10-11): 220,203 rows; TRANSACTION_TP 24K 200,614 · 24E 14,459 · 24A 3,615 · 24C 924 · 24Z 511 · 24F 63 · 24N 17. AMNDT_IND N 190,042 · A 29,844 · T 317. 7,074 negative (refunds), 1,301 blank dates, 4,345 memo (X), 1,484 24K rows with blank CAND_ID (resolve via OTHER_ID → ccl/cm).
- Transaction types: 24K contribution to nonaffiliated committee (PAC → candidate), 24Z in-kind, 24E IE for, 24A IE against, 24C coordinated party, 24F/24N communication cost for/against.
- **Do not sum raw rows**: handle amendments (latest per transaction; FEC dedupe key unverified — test), memo rows, refunds.
- **52 U.S.C. 30111(a)(4)**: individual contributor names/addresses may not be sold or used for solicitation/commercial purposes. Show aggregates; never list individual donors (pas2 has 964 `ENTITY_TP=IND` rows).
- Cadence: varies daily–weekly; masters refreshed 2026-10-15, pas2 2026-10-11. Poll Last-Modified.
- OpenFEC API `https://api.open.fec.gov/v1/` (api.data.gov key, 1,000/hr; DEMO_KEY unusable for ingest).

## 4. GovInfo BILLSTATUS XML — U.S. government work (17 U.S.C. 105)

- File: `https://www.govinfo.gov/bulkdata/BILLSTATUS/{congress}/{type}/BILLSTATUS-{congress}{type}{number}.xml`; types `hr,hres,hjres,hconres,s,sres,sjres,sconres`. Zip per type: `.../BILLSTATUS/119/hr/BILLSTATUS-119-hr.zip` (32.6 MB).
- Listing: `https://www.govinfo.gov/bulkdata/json/BILLSTATUS/119/hr` **with** `Accept: application/json` (both required).
- Cadence: current Congress every 4 h; prior daily.
- Paths: `/billStatus/bill/{number,type(uppercase),congress,originChamber,introducedDate,updateDate,title}`; `policyArea/name`; `subjects/legislativeSubjects/item/name`; `latestAction/{actionDate,text}`; `actions/item/recordedVotes/recordedVote/{rollNumber,url,chamber,congress,date,sessionNumber}` (duplicates across actions → dedupe on chamber+congress+session+rollNumber); `sponsors/item/{bioguideId,fullName,party(letter),state,district?}`; `cosponsors/item/{bioguideId,sponsorshipDate,isOriginalCosponsor}`.

## 5. Congress.gov API v3 / chamber XML

- `https://api.congress.gov/v3`, key required (5,000/hr), `house-vote` endpoints (beta; 118th–119th) incl. `/members` with `bioguideID`, `voteCast`. **No Senate vote endpoint.**
- Senate XML: `https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/vote_{congress}_{session}_{NNNNN}.xml` (members keyed by `lis_member_id`). House clerk: `https://clerk.house.gov/evs/{year}/roll{N}.xml`. Use a browser-like User-Agent.

## 6. OpenStates / Plural (phase 3)

API v3 `https://v3.openstates.org/` key required (rate limits unverified). Bulk: legislators YAML (`github.com/openstates/people`), per-session CSV/JSON (login required), monthly Postgres dump (~10.8 GB, no login). "Public domain dedication unless otherwise noted."

## 7. Status

ProPublica Congress API: "no longer available". OpenSecrets API: discontinued 2025-04-15. OpenSecrets bulk: registration + approval, educational-use ToS, commercial republishing generally a fee.

## Identity spine and join pitfalls

- Canonical person key: **bioguide**. Voteview → `bioguide_id` (540/556 HS119 rows match c-l current; rest are departed members → check historical). Never join on c-l `icpsr` alone (221 missing; icpsr can change on party switch).
- FEC: c-l `fec[]` holds 1–3 IDs (House vs Senate IDs differ). Choose by office + `ccl.FEC_ELECTION_YR`, not list position; `CAND_ELECTION_YR` can be older than the cycle.
- PAC → candidate: prefer `pas2.CAND_ID`; fall back `OTHER_ID` → `ccl`/`cm.CAND_ID`.
- District: c-l at-large 0; FEC `00`; Voteview at-large states 1 (historical 98/99), senators 0. Normalize (chamber, state, district).
- Party: c-l words, Voteview 100/200/328, BILLSTATUS/senate letters, FEC `DEM`/`REP`. Store party per term/vote date.
- Rollcall join: BILLSTATUS `rollNumber`+`sessionNumber`+`chamber` ↔ Voteview `clerk_rollnumber`+`session`.
- Bill numbers: Voteview `HR1`; BILLSTATUS type+number; House clerk `H R 1`; senate `H.R. 9340`; nominations `PN121` vs `PN12-1` (no BILLSTATUS). Amendment votes carry the underlying bill number.
- Dates: ISO (Voteview, BILLSTATUS), MMDDYYYY (pas2), MM/DD/YYYY (weball), DD-MON-YY (IE CSV).

## Unverified

OpenSecrets bulk layouts; FEC `CMTE_TP` codes page, OpenFEC ToS, pas2 amendment dedupe key, `OTHER_ID` meaning on 24E/24A; BILLSTATUS user guide, RSS, sitemap; Congress.gov ToS (403); House clerk per-member XML element names; OpenStates rate limits; Voteview `current.zip`; Voteview TLS issue cause.

## Ingest findings (2026-10-16, from loading the full files)

Measured while building `packages/ingest`; the rules adopted are in DECISIONS A12–A23.

- **pas2 dedupe key**: (CMTE_ID, TRAN_ID) is *not* unique: 979 groups in the 2026 file are
  refunds reusing the original TRAN_ID on a later report or ids reused per report
  (`SB23.1` monthly). Superseded originals are already mostly removed by FEC; only 2 same-report
  N→A pairs and 10 identical re-reports remained among 198,494 non-memo 24K/24Z rows.
- **IE file**: committees and Form 5 filers restart `tran_id` per filing; 2,537 rows belong to
  filings superseded via `prev_file_num`; 15 rows are bogus ($1B–$9B, one filer family,
  ~$37B total); 2,535 have no candidate id; one has a lower-case id (`h2az02360`); `pur` can
  contain HTML entities.
- **weball** repeats the same totals under a member's House and Senate ids (45 people).
- **ccl** has ~450 rows whose committee is missing from cm and 2 rows whose CAND_ID is a
  committee id.
- **Voteview** HS119: the President row (icpsr 99912) also appears in the votes file as stated
  positions (160 rows); a party switcher gets a second icpsr (Kiley 22336/92336); 2 members
  have blank `nominate_dim1`. Node's fetch had no TLS problem with voteview.com.
- **BILLSTATUS** 119: 19,643 bills; 182 without a policy area; all 31 area names used are in the
  32-term Congress.gov list; every recorded vote joined a Voteview rollcall on
  (chamber, session, clerk number); some titles contain U+FFFD replacement characters.
- **congress-legislators**: 452 historical terms have no party; 1,359 historical House terms
  use district -1 (unknown / general ticket).
- **candidate_summary_2026.csv** (fetched 2026-10-16, 4,482 rows, quoted CSV with header):
  `Link_Image,Cand_Name,Cand_Id,Cand_Office,Cand_Office_St,Cand_Office_Dist,Cand_Party_Affiliation,Cand_Incumbent_Challenger_Open_Seat,Total_Receipt,Total_Disbursement,Cash_On_Hand_COP,Debt_Owed_By_Committee,Coverage_End_Date,Cand_Street_1,Cand_Street_2,Cand_City,Cand_State,Cand_Zip,Individual_Itemized_Contribution,Individual_Unitemized_Contribution,Individual_Contribution,Other_Committee_Contribution,Party_Committee_Contribution,Cand_Contribution,Total_Contribution,Transfer_From_Other_Auth_Committee,Cand_Loan,Other_Loan,Total_Loan,Offsets_To_Operating_Expenditure,Offsets_To_Fundraising,Offsets_To_Leagal_Accounting,Other_Receipts,Operating_Expenditure,Exempt_Legal_Accounting_Disbursement,Fundraising_Disbursement,Transfer_To_Other_Auth_Committee,Cand_Loan_Repayment,Other_Loan_Repayment,Total_Loan_Repayment,Individual_Refund,Party_Committee_Refund,Other_Committee_Refund,Total_Contribution_Refund,Other_Disbursements,Net_Contribution,Net_Operating_Expenditure,Cash_On_Hand_BOP,Debt_Owe_To_Committee,Coverage_Start_Date`
  (dates MM/DD/YYYY, decimal dollars; 1,689 rows with no filing have blank dates and zeros).
  Itemized + unitemized = individual in 4,473 rows; one negative unitemized (filer error). It
  is refreshed separately from weball: of 533 current members with weball totals, 414 have a
  summary row and only 119 agree on total receipts (summary through 06/30, weball 09/30), and
  it can list a different FEC id than the one weball totals attach to. Loaded per DECISIONS
  A31; candidate addresses are never read.
- **Refunds** (pas2 negative rows, 6,885 in 2026) can exceed a member's gifts from the same
  group of committees; every share uses gross positive dollars (DECISIONS A29).
