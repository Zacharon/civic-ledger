---
type: research
created: 2026-11-10
status: bronze-evidence
use: register of public U.S. civic-data sources Civic Ledger could ingest
---
# Public civic-data source register (2026-11-10)

All retrieval dates below are **2026-11-10** unless another date is stated. Every "Quoted" line is text copied from the page named in its own row. Anything not on a page opened for this register is **unknown**. No API was called with a key; the only network calls were page fetches and one anonymous `HEAD` on an FEC bulk file.

## Names this project already uses

From `README.md`, `docs/ARCHITECTURE.md` and `docs/DATA_SOURCES.md`: ingest adapter ids `congress-legislators`, `fec-bulk`, `voteview`, `govinfo-billstatus`. Identity schemes: `bioguide`, `fec_candidate`, `icpsr`, `opensecrets`, `govtrack`, `openstates`, `wikidata`. Rows below carry the matching adapter id in the "Civic Ledger name" field. Everything else is a candidate, not a built adapter.

## How to read a block

Fields: Covers · Docs URL · Terms URL · Commercial / attribution · Rate limits · Auth · Retrieved. "Quoted" = verbatim from the opened page. "Observed" = what my own request returned today. "unknown" = not on a page I opened.

---

## Federal sources

### 1. OpenFEC API (FEC)

- **Civic Ledger name:** none yet (`fec-bulk` is the existing FEC adapter; DATA_SOURCES.md mentions the API as an alternative).
- **Covers:** FEC campaign-finance data: candidates, committees, filings, receipts, disbursements, independent expenditures, audits. Base URL `https://api.open.fec.gov/v1/`.
- **Docs URL:** https://api.open.fec.gov/developers/ (the page itself is JavaScript-rendered; the description text was read from its OpenAPI spec at https://api.open.fec.gov/swagger/)
- **Terms URL:** https://github.com/fecgov/FEC/blob/master/TERMS-OF-SERVICE.md and https://github.com/fecgov/FEC/blob/master/ACCEPTABLE-USE-POLICY.md (read as raw files); contributor-data rule: https://www.fec.gov/updates/sale-or-use-contributor-information/
- **Commercial use:** **Restricted.** Acceptable use policy, quoted: "use campaign finance information disclosed on fec.gov or through openFEC, the FEC's API, for commercial purposes including, but not limited to training data for large language models, machine learning models or artificial intelligence models, including generative artificial intelligence models" is listed under "Don't". Sale-or-use page, quoted: "information about individual contributors taken from FEC reports cannot be sold or used for soliciting contributions (including any political or charitable contribution) or for any commercial purpose." The same page says the restriction "applies only to the use of individual contributor information" and "Any person may compile and sell the names of political committees." It also says individual contributor information may be used for "bona fide academic research projects" that do not involve commercial use or solicitation (AO 1986-25).
- **Attribution:** **Required.** Terms of service, quoted: "All services which utilize or access the API should identify openFEC API as the data source. You may not use the FEC name, logo, or the like to imply endorsement of any product, service, or entity". Also: "You may not modify or falsely represent content accessed through the API and still claim the source is FEC."
- **Rate limits:** Quoted from the OpenAPI description: "Signing up for an API key will enable you to place up to 1,000 calls an hour. Each call is limited to 100 results per page. You can email questions, comments or a request to get a key for 7,200 calls an hour (120 calls per minute) to APIinfo@fec.gov." The api.data.gov manual (https://api.data.gov/docs/developer-manual/) states default "Hourly Limit: 1,000 requests per hour" and that `DEMO_KEY` "has much lower rate limits" (exact DEMO_KEY numbers not captured from that page). The spec lists `DEMO_KEY` as the default key for exploring.
- **Auth:** API key required (free, api.data.gov signup). `DEMO_KEY` exists for trying the web interface. Acceptable-use policy forbids sharing keys and creating keys in bulk.
- **Update cadence:** unknown for the API as a whole. The openFEC README (https://raw.githubusercontent.com/fecgov/openFEC/develop/README.md) says API responses are set to expire after one hour.
- **Retrieved:** 2026-11-10
- **Project note:** the Civic Ledger ingest adapters already respect the contributor-name rule (aggregates only, `DATA_SOURCES.md` section 3). The AI-training clause above matters for any product that feeds FEC data to a model; this register does not interpret how it applies to Civic Ledger.

### 2. FEC bulk downloads (`fec-bulk`)

- **Civic Ledger name:** `fec-bulk`.
- **Covers:** Downloadable FEC files (candidates, committees, linkages, summaries, committee-to-candidate and other transaction files, independent expenditures), published per two-year cycle.
- **Docs URL:** https://www.fec.gov/data/browse-data/?tab=bulk-data (the "Download bulk data" tab). File base observed: https://www.fec.gov/files/bulk-downloads/2026/
- **Terms URL:** https://www.fec.gov/updates/sale-or-use-contributor-information/ (no separate bulk-download terms page found among the pages I opened).
- **Commercial use:** Same contributor-information restriction as row 1 (quoted above). The openFEC API acceptable-use policy is written for the API; whether it also governs bulk files is **unknown** from the pages opened.
- **Attribution:** unknown for bulk files (the attribution requirement quoted in row 1 is in the API terms of service).
- **Rate limits:** unknown. None published on the pages opened.
- **Auth:** none. Observed: an anonymous `HEAD` of `https://www.fec.gov/files/bulk-downloads/2026/cn26.zip` returned a 302 and then 200 with `Last-Modified: Tue, 10 Nov 2026 06:36:27 GMT`, `Content-Length: 313652`.
- **Update cadence:** the FEC page says "Newly filed summary data may not appear for up to 48 hours." A schedule for bulk files is unknown from the pages opened.
- **Retrieved:** 2026-11-10

### 3. Congress.gov API v3 (Library of Congress)

- **Civic Ledger name:** none yet (`govinfo-billstatus` currently provides bill status). DATA_SOURCES.md section 5 notes the `house-vote` endpoints.
- **Covers:** Machine-readable Congress.gov collections: bills, amendments, members, committees, and others. README: "provides a method for Congress and the public to view, retrieve, and re-use machine-readable data from collections available on Congress.gov." Base URL `https://api.congress.gov/v3` (from the project's notes; the README names `https://api.congress.gov/`).
- **Docs URL:** https://github.com/LibraryOfCongress/api.congress.gov (README read as https://raw.githubusercontent.com/LibraryOfCongress/api.congress.gov/main/README.md)
- **Terms URL:** https://www.loc.gov/legal/ (Library of Congress legal page). The Congress.gov page "Using Data Offsite" (https://www.congress.gov/help/using-data-offsite) returned HTTP 403 to my fetch, so its content is **unknown**.
- **Commercial use:** Not stated in the README. The Library of Congress legal page says it "generally do[es] not own the rights to materials in our collections" and that the user must determine copyright status of an item; whether this applies to Congress.gov API data is unknown from the pages opened.
- **Attribution:** Not required. README, quoted: "While not required, the following citation may be used for attribution: *Data retrieved from Congress.gov (https://www.congress.gov/)*"
- **Rate limits:** README, quoted: "The rate limit is set to 5,000 requests per hour." Default page size "20 results"; can be raised "up to 250 results." The Library of Congress legal page separately says "Current guidelines recommend that software programs submit a total of no more than 10 requests per minute to our applications, regardless of the number of machines used to submit requests." and that the Library may "block IP addresses that fail to honor our websites' robot.txt files." Whether the 10-per-minute guideline applies to the API is unknown; the two figures differ and I did not reconcile them.
- **Auth:** API key required. README, quoted: "An API key is required for access." Signup: https://api.congress.gov/sign-up/ (the form is JavaScript-loaded; I did not submit it).
- **Update cadence:** README points to https://www.congress.gov/help/coverage-dates for coverage and "estimated update times"; that page was not opened, so the schedule is unknown.
- **Retrieved:** 2026-11-10

### 4. GovInfo Bill Status bulk XML (`govinfo-billstatus`)

- **Civic Ledger name:** `govinfo-billstatus`.
- **Covers:** Bill status XML for each Congress, 108th (2003–2004) through the 119th (2025–2026), published by the Government Publishing Office. Observed directory listing: 119th Congress last modified 10-Nov-2026 23:47 GMT; 118th 20-Oct-2026; 117th 26-Mar-2026.
- **Docs URL:** https://www.govinfo.gov/bulkdata/BILLSTATUS (parent: Bulk Data Repository, GPO GitHub repository for issues and schema/user guide, per that page). 
- **Terms URL:** https://www.govinfo.gov/about/policies (section "Public Domain & Copyright Notice")
- **Commercial use:** Not restricted as stated. The policy quotes 17 U.S.C. 105 ("Copyright protection under this title is not available for any work of the United States Government") and says "public documents can generally be reprinted without legal restriction," with the caveat that "Government publications may contain copyrighted material which was used with permission of the copyright owner."
- **Attribution:** "customary credit should be given to the Government department or agency which prepared the material" applies "in those instances in which permission to reprint material from Government publications is granted"; no mandatory credit line found for this dataset.
- **Rate limits:** unknown. None on the pages opened.
- **Auth:** none. Observed: the directory page fetched without a key.
- **Update cadence:** the page shows Last Modified timestamps only; a stated cadence is unknown from the page. (The project's DATA_SOURCES.md recorded "current Congress every 4 h; prior daily" on 2026-10-15; that is not re-verified here.)
- **Retrieved:** 2026-11-10

### 5. unitedstates/congress-legislators (`congress-legislators`)

- **Civic Ledger name:** `congress-legislators` (identity spine).
- **Covers:** Community-maintained legislator, term and ID data (bioguide, FEC, OpenSecrets, GovTrack, ICPSR and other IDs), committees, social media. README: the `legislators-current.yaml` / `legislators-historical.yaml` split is "somewhat arbitrary because these files may not be updated immediately when a legislator leaves office", so load both.
- **Docs URL:** https://github.com/unitedstates/congress-legislators (README read as https://raw.githubusercontent.com/unitedstates/congress-legislators/main/README.md)
- **Terms URL:** https://raw.githubusercontent.com/unitedstates/congress-legislators/main/LICENSE
- **Commercial use / attribution:** The LICENSE file opened is "Creative Commons Legal Code CC0 1.0 Universal" (public-domain dedication). No attribution requirement is stated in it.
- **Rate limits:** unknown (served from GitHub; GitHub's limits were not looked up).
- **Auth:** none observed (raw files fetched without credentials).
- **Update cadence:** unknown from the README. The project's own notes recorded a Last-Modified of 2026-09-24 on 2026-10-15; not re-checked.
- **Retrieved:** 2026-11-10

### 6. Voteview (`voteview`)

- **Civic Ledger name:** `voteview`.
- **Covers:** Roll-call votes, member DW-NOMINATE ideology scores and congressional party data, hosted by UCLA. Formats on the download page: CSV (recommended), JSON, DAT, ORD.
- **Docs URL:** https://voteview.com/data (project description: https://voteview.com/about)
- **Terms URL:** none found. Neither page I opened states a license or terms of use.
- **Commercial use:** unknown (no license stated on the pages opened).
- **Attribution:** Requested on the data page, quoted: "Please cite the dataset as: Lewis, Jeffrey B., Keith Poole, Howard Rosenthal, Adam Boche, Aaron Rudkin, and Luke Sonnet (2026). Voteview: Congressional Roll-Call Votes Database. https://voteview.com/". Whether the citation is mandatory is not stated.
- **Rate limits:** unknown.
- **Auth:** none observed (pages fetched without credentials).
- **Update cadence:** unknown from these pages. The About page says institutional users can ask to be told about "deprecation of data sources, major new data sources, or major changes to score calculation".
- **Retrieved:** 2026-11-10

### 7. OpenSecrets (API and bulk data)

- **Civic Ledger name:** identity scheme `opensecrets` exists (IDs come from congress-legislators); no adapter.
- **Covers:** Federal and state money-in-politics data, lobbying, personal finances of officials.
- **Docs URL:** https://www.opensecrets.org/api (opened live). Bulk data: https://www.opensecrets.org/open-data/bulk-data (live fetch returned HTTP 403; I read an Internet Archive copy dated 2026-10-30, https://web.archive.org/web/2026/https://www.opensecrets.org/open-data/bulk-data. It contained only site navigation plus "Inspired by OpenSecrets' exclusive data? Jump into our bulk data.", so the bulk-data terms, layout and access rules are **unknown**).
- **Status of the API:** Quoted from the live page: "As of April 15, 2025, our API offerings have been discontinued." and "If you need a custom data solution, we'd love to help. Reach out to commercial@opensecrets.org".
- **Terms URL:** https://www.opensecrets.org/about/terms-and-conditions (live fetch HTTP 403; read via an Internet Archive copy dated 2026-10-11, https://web.archive.org/web/2026/https://www.opensecrets.org/about/terms-and-conditions).
- **Commercial use:** **Restricted.** Archived terms, quoted: "Any resale or commercial use of the Site, OpenSecrets Materials, or our Services is prohibited, as is the distribution, public performance, or public display of any OpenSecrets Materials". Also: "Prior written permission to use, reproduce, or reprint any of the OpenSecrets Materials (or portion thereof) or other information or materials used for the Services must be obtained from the owner for any commercial use." Live page footer, quoted: "Except for the Revolving Door section, content on this site is licensed under a Creative Commons Attribution-Noncommercial-Share Alike 3.0 United States License by OpenSecrets.org. To request permission for commercial use, please contact us."
- **Scraping:** Archived terms prohibit using any "robot, spider, scraper, crawler" without "express written permission".
- **Attribution:** The CC BY-NC-SA licence in the footer implies attribution and share-alike for non-commercial reuse; the exact attribution wording OpenSecrets wants is unknown.
- **Rate limits:** unknown (API discontinued).
- **Auth:** API: none, discontinued. Bulk: unknown from the pages opened. The project's DATA_SOURCES.md recorded registration and approval; not re-verified here.
- **Update cadence:** unknown.
- **Retrieved:** 2026-11-10 (live pages); archived copies as dated above.

### 8. GovTrack

- **Civic Ledger name:** identity scheme `govtrack` (ID from congress-legislators); no adapter.
- **Covers:** Tracking of Congress and the White House (bills, votes, members). Its "About Our Data" page says bill status comes from "GPO GovInfo.gov Bill Status XML Bulk Data", votes from the Senate and House websites, and member data from the congress-legislators project, so it largely repackages sources already in this register.
- **Docs URL:** https://www.govtrack.us/about-our-data (live fetch HTTP 403; read via an Internet Archive copy dated 2026-09-29: https://web.archive.org/web/20260929221015/https://www.govtrack.us/about-our-data). The developer page https://www.govtrack.us/developers returned 403 live and had no archive copy, so any GovTrack API and its rate limits are **unknown**.
- **Terms URL:** https://www.govtrack.us/legal (live 403; archived copy dated 2026-09-29: https://web.archive.org/web/20260929221005/https://www.govtrack.us/legal)
- **Commercial use / reuse:** Restricted in part. Archived terms, quoted: "You are welcome — and encouraged — to copy and reuse any information you see here, except as noted below. You may not use this website or any text, images, data, metadata, or other materials that you obtain from this website for the (1) the development of any software program, including, but not limited to, training a machine learning or artificial intelligence (AI) system; or (2) providing archived or cached data sets containing Content to another person or entity, except for personal, non-commercial use."
- **Attribution:** unknown (not found in the terms text I read).
- **Rate limits:** unknown.
- **Auth:** unknown for any API; the archived pages needed no credentials.
- **Retrieved:** 2026-11-10 (archive copies dated 2026-09-29).

### 9. House of Representatives financial disclosure (Clerk)

- **Civic Ledger name:** none.
- **Covers:** Financial disclosure reports of Members, staff and candidates. The page has "Download Financial Disclosure Reports" and "Search" links, with "For Members And Staff" and "For Congressional Candidates" entries.
- **Docs URL:** https://disclosures-clerk.house.gov/FinancialDisclosure
- **Terms URL:** none found on the page opened; the House Clerk site links a "Terms of Service" page that I did not open. The Senate eFD page (row 10) quotes 5 U.S.C. app. section 105(c); whether the House portal carries the same notice is **unknown** from the pages opened.
- **Commercial use / attribution:** unknown for the House portal.
- **Rate limits:** unknown.
- **Auth:** none observed for the landing page.
- **Update cadence:** unknown.
- **Retrieved:** 2026-11-10

### 10. Senate financial disclosure (eFD)

- **Civic Ledger name:** none.
- **Covers:** Financial disclosure reports for Senators, former Senators and Senate candidates "filed from 2012 to present". Page quote: "Senator reports are available for six years from the date a Senator ceases to be a Member of Congress. Candidate reports are available for one year after the individual is no longer a candidate."
- **Docs URL / Terms URL:** https://efdsearch.senate.gov/search/home/ (the statute is quoted on this page)
- **Commercial use:** **Restricted by statute.** Page quote of Title 1 of the Ethics in Government Act, 5 U.S.C. app. section 105(c): "It shall be unlawful for any person to obtain or use a report: for any unlawful purpose; for any commercial purpose, other than by news and communications media for dissemination to the general public; for determining or establishing the credit rating of any individual; or for use, directly or indirectly, in the solicitation of money for any political, charitable, or other purpose." Civil penalty "not to exceed $10,000." Users must accept "I understand the prohibitions on obtaining and use of financial disclosure reports" before searching.
- **Attribution:** unknown.
- **Rate limits:** unknown.
- **Auth:** no key; an agreement checkbox gates search. I did not accept it.
- **Update cadence:** unknown.
- **Retrieved:** 2026-11-10

---

## State campaign-finance portals

**Which states.** The ten largest by population plus Virginia. Ranking from the U.S. Census Bureau Vintage 2025 table "Top Ten Most Populous States: 2025" (https://www.census.gov/newsroom/press-releases/2026/population-growth-slows.html, Release Number CB26-20, January 27, 2026; July 1, 2025 estimates): 1 California 39,355,309 · 2 Texas 31,709,821 · 3 Florida 23,462,518 · 4 New York 20,002,427 · 5 Pennsylvania 13,059,432 · 6 Illinois 12,719,141 · 7 Ohio 11,900,510 · 8 Georgia 11,302,748 · 9 North Carolina 11,197,968 · 10 Michigan 10,127,884. Retrieved 2026-11-10 or 2026-11-11 (the session clock rolled past midnight mid-run; I did not log the exact date per page, so this applies to every state row below).

**Gaps that apply to all 11 states.** I found **no published API rate limits** and **no explicit terms-of-use or commercial-use statement** on any state page I opened. Every state row therefore says "unknown" for those fields. State statutes on contributor data were not checked, so state restrictions may exist and are **unverified**. Auth: no key was needed to open any state page that loaded; downloads were not attempted.

Pages that refused my fetch (HTTP 403): New York Public Reporting and bulk-download pages, Ohio Secretary of State pages, Florida DOS campaign-finance home, Illinois campaign-disclosure home. A web search returned snippets about some of them; those are flagged "search snippet, page not opened" below and are not verified claims.

### S1. California: CAL-ACCESS (Secretary of State)

- **Covers:** Campaign finance and lobbying activity filings. Raw data: tab-delimited text files from tables of the CAL-ACCESS database, plus field guides.
- **Docs URL:** https://www.sos.ca.gov/campaign-lobbying/helpful-resources/raw-data-campaign-finance-and-lobbying-activity
- **Terms URL:** none found (https://www.sos.ca.gov/terms-use returned 404).
- **Commercial / attribution:** unknown.
- **Rate limits:** unknown.
- **Auth:** none stated on the page.
- **Cadence:** Quoted: "The raw data extracts are updated once per day." Unredacted address lists for Data Processing Requests are "updated once per week, every Sunday."
- **Support:** Quoted: "The Secretary of State does not provide technical support to users who want to download and analyze CAL-ACCESS data in this advanced way."
- **Note:** the page links a "CAL-ACCESS Replacement Project" that I did not open.

### S2. Texas: Texas Ethics Commission (TEC)

- **Covers:** Electronically filed campaign-finance reports since July 1, 2000 (contributions, expenditures, loans, debts, pledges, assets, filer index and more). Layout from the data README ("Flat File Architecture Record Listing -- Generated 07/19/2023"): files such as `contribs_##.csv`, `expend_##.csv`, `filers.csv`, `cover.csv`.
- **Docs URL:** https://www.ethics.state.tx.us/search/cf/ (search page); layout README: https://www.ethics.state.tx.us/data/search/cf/CFS-ReadMe.txt
- **Terms URL:** none found. The page mentions a future site, www.ethics.texas.gov, which I could not load (connection closed).
- **Commercial / attribution:** unknown.
- **Rate limits:** unknown.
- **Auth:** none stated.
- **Cadence:** unknown.
- **Zip package URL:** not captured. The README describes "This zip package" but I did not see its link on the pages opened.

### S3. Florida: Division of Elections campaign-finance database

- **Covers:** Contribution, expenditure and related records searchable by election year (back to 1996 on the form), candidate or committee.
- **Docs URL:** https://dos.elections.myflorida.com/campaign-finance/contributions/ (the parent https://dos.elections.myflorida.com/campaign-finance/ returned 403)
- **Terms URL:** none found. The page says, quoted: "This information is being provided as a convenience to the public. It has been processed by the Division of Elections and should be cross referenced with the original report on file with the Division of Elections in case of questions."
- **Bulk download:** not seen on the page opened; unknown.
- **Commercial / attribution / rate limits / cadence:** unknown. **Auth:** none stated.

### S4. New York: NYSBOE Public Reporting System

- **Covers:** Itemized disclosure reports; a bulk download page exists per a search snippet.
- **Docs URL:** https://publicreporting.elections.ny.gov/ and https://publicreporting.elections.ny.gov/DownloadCampaignFinanceData/DownloadCampaignFinanceData (both returned HTTP 403 to my fetch, so the page content is **unknown** from my own opening).
- **Search snippet, page not opened (unverified):** reports filed from July 1999 onward; zipped CSV files with eight data files plus a layout PDF; a 2022 meeting transcript says filers who submitted only no-activity reports are absent from the bulk download.
- **Terms, commercial / attribution, rate limits, auth, cadence:** unknown.

### S5. Pennsylvania: Department of State campaign-finance data

- **Covers:** Full campaign-finance report exports, one file per year from 2000 to 2026, with a read-me.
- **Docs URL:** https://www.pa.gov/agencies/dos/resources/voting-and-elections-resources/campaign-finance-data ; read-me: https://www.pa.gov/content/dam/copapwp-pagov/en/dos/resources/voting-and-elections/campaign-finance/campaign-finance-data/readme-cf-data.txt
- **Layout (read-me):** Filer file `CampaignfinanceID,FILERID,EYEAR,SubmittedDate,CYCLE,AMMEND,TERMINATE,FILERTYPE,FILERNAME,...`; Contribution, Expense, Debt and Receipt files with similar key columns.
- **Terms URL:** none found. **Commercial / attribution / rate limits / cadence:** unknown. **Auth:** none stated.
- **Note:** a search snippet mentioned a `data.pa.gov` filer dataset "listed as public domain, updated monthly"; I did not open it, so that is **unverified**.

### S6. Illinois: State Board of Elections, Campaign Disclosure

- **Covers:** Committee, candidate, contribution and expenditure data. Search options page, quoted: "Only receipts exceeding $150 in aggregate are itemized at the time of filing; therefore, smaller contributions cannot be searched by contributor."
- **Docs URL:** https://www.elections.il.gov/Main/FAQ.aspx (FAQ) and https://elections.il.gov/campaigndisclosure/searchoptions.aspx. The download page https://www.elections.il.gov/CampaignDisclosure/DownloadFiles.aspx returned an "An error has occurred" page; the Campaign Disclosure home returned 403.
- **Bulk data (FAQ, quoted):** "Contribution and expenditure data may be downloaded in either a Tab-Delimited Text File or XML file. The data is also available at no cost from the Board on cdrom."
- **Terms URL:** none found. **Commercial / attribution / rate limits / cadence:** unknown. **Auth:** none stated.

### S7. Ohio: Secretary of State campaign-finance data

- **Covers:** Per a search snippet (page not opened): a File Transfer page with pre-queried files (for example all candidate contributions for a year) and a searchable database from 2020 onward.
- **Docs URL:** https://www.ohiosos.gov/elections/campaign-finance and https://www6.ohiosos.gov/ords/f?p=CFDISCLOSURE%3A73%3A0%3A (both returned HTTP 403 to my fetch).
- **Everything else (terms, commercial, attribution, rate limits, auth, cadence, formats):** **unknown**.

### S8. Georgia: Georgia Government Transparency & Campaign Finance Commission

- **Covers:** Campaign reports, personal financial reports, lobbyist reports, late filers, vendor-gift reports, PeachFile e-filing system (from the home page menu).
- **Docs URL:** https://ethics.ga.gov/ ; search: https://media.ethics.ga.gov/search/Campaign/Campaign_Name.aspx (loaded as a bare search shell with little usable text).
- **Bulk download, terms, commercial / attribution, rate limits, cadence:** not found on the pages opened; **unknown**. **Auth:** none stated.

### S9. North Carolina: State Board of Elections

- **Covers:** Campaign document search by committee or candidate: IMAGE view (scanned PDF) and DATA view (electronically filed or manually keyed data).
- **Docs URL:** https://cf.ncsbe.gov/CFOrgLkup/ and https://www.ncsbe.gov/campaign-finance
- **Cadence:** Quoted: "Report data that is imported does not appear on our website in real-time. Our website updates overnight each weeknight." Page footer: "Data current as of - Tuesday, November 10, 2026 3:18AM".
- **Bulk download:** not seen on the pages opened; unknown. **Terms, commercial / attribution, rate limits:** unknown. **Auth:** none stated.

### S10. Michigan: Secretary of State, MiTN campaign-finance database

- **Covers:** Contributions, expenditures and committee data. Page quote: "The All-Transactions Reports page provides tab-delimited downloadable files which contain annual data for Contributions, Expenditures, and Receipts, in a zipped file format." Searchable database: "Many Queries are downloadable: Look for the Spreadsheet Format check box."
- **Docs URL:** https://www.michigan.gov/sos/elections/disclosure/cfr and https://www.michigan.gov/sos/elections/disclosure/cfr/committee-search/intro/welcome-to-the-michigan-campaign-finance-searchable-database
- **Terms URL:** none found. **Commercial / attribution / rate limits / cadence:** unknown. **Auth:** none stated.
- **Note:** `https://cfrsearch.nictusa.com/` returned nothing usable. A search snippet said a legacy CSV export covers 2020 to 2025; not verified.

### S11. Virginia: Department of Elections, campaign-finance reports and data

- **Covers:** Reports from 2012 on in the viewer, and a CSV download "1999 through present". Independent Expenditure Reports from July 1, 2025.
- **Docs URL:** https://www.elections.virginia.gov/candidatepac-info/reporting/
- **Bulk files:** Observed directory listing at https://apps.elections.virginia.gov/SBE_CSV/CF/ with year folders from 1999 and monthly folders through `2026_11`; folder `2026_10` carries the timestamp 11/1/2026 5:16 PM. File layouts inside the folders were not opened.
- **Cadence:** Quoted: "Submitted reports and data feeds are updated daily starting at 5:15 p.m. and again at 12:05 a.m. The update process completes in about 5 minutes."
- **Caveat (quoted):** "To submit amendments to reports which have activity from 1999-2011, changes must be submitted in a paper format."
- **Terms URL:** none found. **Commercial / attribution / rate limits:** unknown. **Auth:** none stated on the page; the directory listing loaded without credentials.

---

## Counts

- Federal sources documented: 10 rows (OpenFEC API, FEC bulk, Congress.gov API, GovInfo BILLSTATUS, congress-legislators, Voteview, OpenSecrets API and bulk as one row, GovTrack, House financial disclosure, Senate eFD).
- State portals documented: 11 (CA, TX, FL, NY, PA, IL, OH, GA, NC, MI, VA). NY and OH are mostly unknown because their pages refused my fetch.
- Total register rows: 21.

## What I could not verify

- Official **rate limits**: only OpenFEC (1,000 per hour per key, 7,200 on request), Congress.gov (5,000 per hour) and the Library of Congress site guideline (10 requests per minute) were found on pages I opened. All other federal rows and all 11 state rows are unknown.
- **Terms or commercial-use text** for: FEC bulk files (separate from the API), the Congress.gov "Using Data Offsite" page (403), GovTrack's API (403, no archive), OpenSecrets bulk data, House financial disclosure, Voteview, and every state portal.
- **Pages that refused automated fetch (HTTP 403):** congress.gov/help/using-data-offsite, govtrack.us pages, opensecrets.org terms and bulk-data pages (archive copies used), NY and OH state pages, Florida DOS home, Illinois campaign-disclosure home. Archive copies are dated and may differ from the live pages.
- **Search snippets** (NY, OH, PA data.pa.gov, MI legacy) were not opened and are labelled as such.
- No API was called with a key. A request to `api.census.gov` needed a key and was dropped; the Census ranking comes from the Census press-release page.
- State statutes on contributor-data use were not checked.
- Retrieval dates: federal pages 2026-11-10; state pages 2026-11-10 or 2026-11-11 (clock rolled over mid-run).
