# Rejected interpretations and held evidence

These are retained research limits, not missing values filled by inference.

- **Angela Alsobrooks:** her campaign abortion page specifically commits to cosponsoring
  the Women's Health Protection Act on her first day in office. The inspected page
  supplies no publication date. Do not invent `made_on`; the position remains a held
  candidate and this potential additional promise is **MISSING_ELIGIBLE_DATED_SOURCE**.
- **Sarah McBride:** the October 15, 2024 campaign release supports protecting/expanding
  Social Security and Medicare, but does not supply a narrowly specified personal
  action or measurable deadline in its readable text. It was not converted into a
  rated or dated-vote promise. A separate 2026 campaign article contains an ambiguous
  reference to a premium/child tax credit; do not silently correct that wording into
  a different policy claim.
- **Maxwell Frost:** the campaign homepage's general promises to fight gun violence
  and support Medicare for All are stated priorities, not by themselves a dated,
  checkable legislative commitment. Its first-generation-Z wording also cannot date
  the page or establish its campaign cycle.
- **Marsha Blackburn:** the current campaign domain is branded for a governor race.
  Its 2026 state campaign issues cannot be silently treated as a federal Senate
  platform. Her Senate technology page supports a held federal stated-position
  candidate, with no campaign cycle attached.
- **Amy Klobuchar:** a preliminary campaign-healthcare search resolved to her governor
  campaign. She was not included in this federal cohort; no state-campaign position
  was relabeled as a Senate platform.
- **Alexandria Ocasio-Cortez:** the current issues URL retains pandemic-era material.
  Retrieval in 2026 cannot establish that every paragraph is her 2026 platform.
- **Ro Khanna, Jacky Rosen, Tammy Baldwin campaign pages:** readable primary pages were
  available through the web reader, but the bounded direct HTTP audit received 403
  for the recorded URLs. Those direct failures remain in `source-receipts.json`.
  Baldwin's otherwise dated campaign proposal is held; Khanna and Rosen also lack
  cycle evidence for the selected campaign pages. No challenge bypass was attempted.
- **Jim Jordan:** a later web-reader attempt returned 403 after the initial primary
  page was readable. The direct audit succeeded. His official-office statement still
  remains held because that source does not establish a campaign platform or cycle.
- **Mike Lawler:** his SALT commitment is conditional on the Senate's draft and cap.
  It cannot be evaluated by checking a headline or a vote on a different bill version.
- **Rick Scott:** the United Nations funding-vote promise is conditional on becoming
  Senate Republican Leader. Failure to hold a vote does not independently show a broken
  promise, and this package assigns no verdict.
- **Mike Johnson:** the dated transcript describes bringing a named border bill to the
  floor that week. Owner review should confirm the commitment's scheduling meaning;
  bringing a measure to the floor is distinct from passing or enacting it.
- **Frameworks:** Senate passage of the TAKE IT DOWN Act used unanimous consent, so
  there is no corresponding Senate roll call in that framework. Senators therefore
  have no counted vote for that one-vote House lens. A missing or non-yea/nay position
  is never turned into an opposing vote.

The broad problem is a data-contract gap: official issue statements can be useful
evidence about what a member publicly supports without being campaign-platform
material. These held records would need either defensible campaign/cycle evidence or
a separately reviewed dated-statement model. No runtime/schema change is made here.
