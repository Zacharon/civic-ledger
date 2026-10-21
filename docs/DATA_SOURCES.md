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

- **Candidate master use (races, DECISIONS A86):** every `cn26` row with `CAND_OFFICE` H or S and `CAND_ELECTION_YR` = 2026 is stored as filed (4,379 rows, 522 seats on 2026-10-20). The file also keeps past and future registrants (`CAND_ELECTION_YR` 1980 to 2999, including obvious typos such as 2764) and presidential rows; those are counted, not stored. Real-file quirks: names carry honorifics, ranks, credentials, nicknames and sometimes a phone number; 47 rows have a blank `CAND_ICI`, one a blank status; party codes include non-codes (`W`, `N`, `TX`, `02`); a candidate with a House and a Senate id appears under both seats; districts that do not exist are filed (UT-71, UT-9, GA-23, MT-22, SC-89, OK-82, NM-66, OH-65, PA-36), blank districts appear in AZ, FL, IL, MD, MO and OR, "00" in GA, MN, NV, NY and TX, and the MP delegate is filed as district 01 (DECISIONS A93); one row (`H6AZ08210`) has an empty name and 19 Senate seats have 2026 registrations with no senator's term ending in 2026.
- Codes: `CMTE_DSGN` A authorized, B lobbyist PAC, D leadership PAC, J joint fundraiser, P principal, U unauthorized. `ORG_TP` C corp, L labor, M membership, T trade, V coop, W corp w/o stock. `CAND_OFFICE` H/S/P; district `00` at-large/Senate. `CAND_ICI` C/I/O.
- pas2 profile (2026-10-11): 220,203 rows; TRANSACTION_TP 24K 200,614 · 24E 14,459 · 24A 3,615 · 24C 924 · 24Z 511 · 24F 63 · 24N 17. AMNDT_IND N 190,042 · A 29,844 · T 317. 7,074 negative (refunds), 1,301 blank dates, 4,345 memo (X), 1,484 24K rows with blank CAND_ID (resolve via OTHER_ID → ccl/cm).
- Transaction types: 24K contribution to nonaffiliated committee (PAC → candidate), 24Z in-kind, 24E IE for, 24A IE against, 24C coordinated party, 24F/24N communication cost for/against.
- **Do not sum raw rows**: handle amendments (latest per transaction; FEC dedupe key unverified — test), memo rows, refunds.
- pas2 and IE dedupe compare rows across the whole file; the loader stages rows in temp tables and applies the rules in SQL (DECISIONS A53), so file size does not bound memory. Downloads (including cached copies reused on 304) and inflated zip entries are capped (`INGEST_MAX_DOWNLOAD_BYTES`, `INGEST_MAX_DECOMPRESSED_BYTES`).
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

## 6b. Official member portraits (unitedstates/images) - public domain

Added 2026-10-20 as ingest source `member-photos` (DECISIONS A81). Repository
`https://github.com/unitedstates/images`, branch `gh-pages`, published on GitHub Pages. Its README
states the photos are public domain. The collection's main origin is the U.S. Government Publishing
Office Member Guide (`https://memberguide.gpo.gov/`), "which has assured us that all photos are public
domain"; where GPO has no photo the maintainers accept another official public-domain one (for
example `O000172` is credited upstream to the U.S. House Office of Photography). The source record
therefore names the Member Guide as the main origin, and the credit shown with each portrait names the
collection: "Official portrait · public domain · via unitedstates/images".

* URL pattern: `https://unitedstates.github.io/images/congress/{225x275|450x550|original}/{BIOGUIDE}.jpg`
  (`original` is typically 675x825 and is not used). Keyed by Bioguide id; no auth; no rate limit stated;
  `ETag` + `Last-Modified` on every file, so conditional GET works.
* Listing (no per-id probing): `https://api.github.com/repos/unitedstates/images/git/trees/gh-pages?recursive=1`
  returns `path`, `size` and `sha` of every file (5,110 entries on 2026-10-20, `truncated: false`; a
  truncated answer fails the run). Unauthenticated GitHub API: 60 requests/hour per address; a run
  uses one. 1,297 people have a 225x275 and a 450x550 file; 1,296 have an `original`. Average sizes:
  49 KB (225x275), 143 KB (450x550).
* Coverage: 524 of the 539 current members on 2026-10-20. Missing: B001323 G000606 G000607 W000832
  B001328 F000485 B001321 B001324 M001246 H001104 A000383 G000608 V000139 M001245 W000831 (the newest
  members). A missing portrait is a normal state, not an error.
* Selection: everyone with a Bioguide id and a term that ends after 2025-01-03 (current members and
  those who left during the 119th Congress). The rest of the repository (former members back to 1789,
  about 250 MB for both sizes) is not fetched.
* Verification: the listing gives each file's git blob SHA-1 and size; a download that does not hash to
  it is rejected, and the listing's tree id is recorded in the run receipt's `note` and the manifest.
  An optional `GITHUB_TOKEN` is sent as a bearer token to the listing request only (never logged).
* Metadata: files carry EXIF/XMP (camera serial numbers, photographer names, edit history), Photoshop
  data, comments and embedded thumbnails (2026-10-20: 508 of 1,078 files had EXIF/XMP, 484 APP13, 4
  comments, 386 a thumbnail, none GPS). They are removed on load without re-encoding (11,448,128 bytes,
  9.8%); JFIF, the ICC profile and the Adobe segment (needed by the CMYK file) are kept.
* Validation: each file must be a complete grayscale, colour or CMYK JPEG (SOI ... EOI, frame header, scan)
  at most 2 MiB and inside its variant's pixel box (no larger than 225x275 or 450x550, at least 20% of its
  area); anything else (an HTML error page served with 200, a truncated download, an
  oversized or thumbnail-sized image) rejects that person's pair. Image content is never decoded or altered.
* Real shapes (2026-10-20, 930 files): upstream scales each photo to fit the box keeping its proportions,
  so most 225x275 files are 225x275 or 220x275, some are 183x275, 205x275 or 210x275, a few are squarer
  (225x225, 225x150), and 15 files in `450x550/` are the 225x275 original (not enlarged). One file pair
  (`L000585`) is a progressive 4-component (CMYK) JPEG; it is accepted unchanged (Chromium renders it
  correctly, checked 2026-10-20).
* Not guaranteed by the source: the file for a person can change (a better photo, a new term); the
  stored `sha256` and the cache-busting key change with it.

## 7. Status

ProPublica Congress API: "no longer available". OpenSecrets API: discontinued 2025-04-15. OpenSecrets bulk: registration + approval, educational-use ToS, commercial republishing generally a fee.

## 8. U.S. Census Bureau cartographic boundary files (district locator maps) — U.S. government work, public domain

Source id `census-boundaries`. Verified 2026-10-20 by downloading and reading the real files.

- Files (500k = 1:500,000 generalized, shapefile zips, NAD83 / EPSG:4269 lon/lat):
  `https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_cd119_500k.zip` (7.07 MB; 441 records, 633,712 vertices) and
  `https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_us_state_500k.zip` (3.25 MB; 56 records). `Last-Modified` 2026-04-23; the ISO metadata sidecar dates them 2026-05.
  The `5m` (2.1 MB) and `20m` resolutions also exist; 500k is the finest the 240 px maps could use and is already ~100x more vertices than they draw. Each zip holds `.shp`, `.dbf`, `.shp.iso.xml` (metadata), `.shx`, `.prj`, `.cpg` (UTF-8).
- **Vintage choice.** The task named `GENZ2024`. `GENZ2025` exists and is newer, so the adapter uses it (`CENSUS_VINTAGE_YEAR` in `parse.ts`). Both describe the same 119th Congress: identical 441 `GEOID`s, land area per district within 0.2% (largest difference 0.21%), vertex counts 633,497 vs 633,712 (re-generalized and re-aligned to the newer TIGER). The 120th Congress file (`cd120`) does not exist (404 under GENZ2024 and GENZ2025). `GENZ2026` is not published (404).
- **What the file says about its own currency** (metadata abstract of `cb_2025_us_cd119_500k`): "The 119th Congress is seated from January 2025 through December 2026. States that had updates between the previous and current session include Alabama, Georgia, Louisiana, New York, and North Carolina... The generalized boundaries of all other congressional districts are based on information provided to the Census Bureau by the states by May 31, 2024." The adapter reads that date into `district_map.as_of` (2024-05-31) and fails the run if the sentence disappears.
- **Consequence: redistricting after 2024-05-31 is not in the file.** Mid-decade plans enacted after that date for the 2026 elections (reported as of May 2026 for Texas, California, Missouri and North Carolina, with litigation and further changes under way in Louisiana, Alabama and others; see Ballotpedia and the Voting Rights Lab tracker) are **not** drawn. The maps match the districts of the members now sitting (elected under the 2024 lines) and must not be read as the lines for November 2026. This is why every map carries "District boundaries: U.S. Census Bureau, 2025 cartographic boundary files, 119th Congress. Shows district lines as of May 31, 2024. A state that redrew its districts after that date is not reflected." and why `districts.shape` returns `vintage`, `asOf` and `caveat`. The product does not track which states redrew. A source for 2026 lines (race pages) is a separate decision.
- **How the as-of date is read.** 2024-05-31 is the cutoff of the district data the *states supplied* to the Census Bureau for this file. It is not the date Census drew or published the files (April-May 2026) and it is not an assurance that nothing changed since: a state may have redrawn, or a court may have ordered new lines, after it. It tells a reader the latest date the lines can claim to be current to, and the maps print it as "district lines as of May 31, 2024" next to the warning that later redistricting is not reflected. A newer vintage will carry a later date and be subject to the same reading. Do not turn it into "valid until" or "current".
- **Which members a map fits.** Every `district_map` row stores the Congress its lines are for (`congress`, the file's `CDSESSN`, 119). A House member's district number is drawn only when the member is current and their current term began in that Congress (the term start date maps to a Congress: terms starting on or after 2027-01-03 are the 120th), because after the 120th is seated the same district number can mean a different area in a state that redrew. Senate seats and whole-state maps (at-large, delegates) do not depend on the district lines and are unaffected (DECISIONS A80).
- District file fields: `STATEFP`, `CD119FP` (`01`..`53`; `00` at-large; `98` non-voting delegate), `GEOID` (`STATEFP`+`CD119FP`), `NAMELSAD`, `CDSESSN` (`119`), `ALAND`, `AWATER`. State file: `STATEFP`, `STUSPS` (USPS code), `NAME`, `GEOID`. The district file has no state letters; the adapter joins on `STATEFP`. Polygons and multipolygons only (ESRI clockwise exteriors).
- Coverage (2026-10-20 load): 435 voting districts plus six delegate records (DC, PR, GU, VI, AS, MP, each `98`). At-large states (`00`): AK, DE, ND, SD, VT, WY. No `ZZ` ("no district defined") records are present in this vintage, although the abstract mentions them for CT, IL and NH; the adapter would skip a `ZZ` record as it does `00` and `98`.
- Not drawn: American Samoa and the Northern Mariana Islands (`UNMAPPED_TERRITORIES`): at ~240 px their islands are a scatter of specks, so those delegates show no map. DC, Puerto Rico, Guam and the U.S. Virgin Islands are drawn.
- Rights: U.S. government work (17 U.S.C. 105); the Census Bureau asks to be credited as the source. https://www.census.gov/about/policies/open-gov/open-data.html
- Edges are straight lines in lon/lat (parallels stay parallels); the adapter densifies them before projecting, because d3 draws edges as great circles.
- Libraries (ingest only; nothing ships to the browser). Licences: `shapefile` 0.6.6 BSD-3-Clause (with `array-source`, `slice-source`, `stream-source`, `path-source`, `file-source`, all BSD-3-Clause; `text-encoding` Unlicense, deprecated upstream but only used to decode DBF text); `d3-geo` 3.1.1 ISC (`d3-array`, `internmap` ISC); `topojson-server`, `topojson-simplify`, `topojson-client` 3.x ISC (`commander` 2 MIT). Type packages (`@types/*`) MIT. None is a runtime dependency of `apps/web`. `shapefile` and `topojson-*` have had no release since 2022 (finished, stable libraries); no alternative with the same shared-border simplification was lighter.

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
