-- Read model for the Explore table (ARCHITECTURE §3 "Read model").
-- Scope per person: latest term, latest DW-NOMINATE congress, latest FEC cycle,
-- latest congress with recorded votes. Shares and rates are fractions in [0, 1].
CREATE MATERIALIZED VIEW "person_card" AS
WITH latest_term AS (
  SELECT DISTINCT ON (t.person_id)
    t.person_id, t.party, t.start_date, o.state, o.chamber, o.district
  FROM "term" t
  JOIN "office" o ON o.id = t.office_id
  ORDER BY t.person_id, t.start_date DESC
),
first_term AS (
  SELECT person_id, min(start_date) AS first_start
  FROM "term"
  GROUP BY person_id
),
latest_ideology AS (
  SELECT DISTINCT ON (person_id) person_id, congress, dim1, dim2
  FROM "ideology_score"
  WHERE method = 'dw-nominate'
  ORDER BY person_id, congress DESC
),
latest_totals AS (
  SELECT DISTINCT ON (person_id)
    person_id, cycle, total_receipts_cents, other_committee_cents, unitemized_individual_cents
  FROM "candidate_cycle_totals"
  WHERE person_id IS NOT NULL
  ORDER BY person_id, cycle DESC
),
pac_by_industry AS (
  SELECT cc.person_id, ci.industry_id, sum(cc.amount_cents)::bigint AS amount_cents
  FROM "committee_contribution" cc
  JOIN latest_totals lt ON lt.person_id = cc.person_id AND lt.cycle = cc.cycle
  LEFT JOIN "committee_industry" ci ON ci.committee_id = cc.committee_id
  GROUP BY cc.person_id, ci.industry_id
),
industry_coverage AS (
  SELECT person_id,
    (sum(amount_cents) FILTER (WHERE industry_id IS NOT NULL))::float8
      / nullif(sum(amount_cents), 0) AS coverage
  FROM pac_by_industry
  GROUP BY person_id
),
top_industries AS (
  SELECT person_id,
    jsonb_agg(
      jsonb_build_object('id', industry_id, 'name', name, 'amountCents', amount_cents)
      ORDER BY amount_cents DESC, industry_id
    ) AS items
  FROM (
    SELECT p.person_id, p.industry_id, i.name, p.amount_cents,
      row_number() OVER (PARTITION BY p.person_id ORDER BY p.amount_cents DESC, p.industry_id) AS rank
    FROM pac_by_industry p
    JOIN "industry" i ON i.id = p.industry_id
  ) ranked
  WHERE rank <= 3
  GROUP BY person_id
),
outside AS (
  SELECT ie.person_id,
    coalesce(sum(ie.amount_cents) FILTER (WHERE ie.support_oppose = 'support'), 0)::bigint AS support_cents,
    coalesce(sum(ie.amount_cents) FILTER (WHERE ie.support_oppose = 'oppose'), 0)::bigint AS oppose_cents
  FROM "independent_expenditure" ie
  JOIN latest_totals lt ON lt.person_id = ie.person_id AND lt.cycle = ie.cycle
  GROUP BY ie.person_id
),
latest_vote_congress AS (
  SELECT vp.person_id, max(r.congress) AS congress
  FROM "vote_position" vp
  JOIN "rollcall" r ON r.id = vp.rollcall_id
  GROUP BY vp.person_id
),
votes AS (
  SELECT vp.person_id,
    count(*)::int AS eligible,
    (count(*) FILTER (WHERE vp.position = 'not_voting'))::int AS missed
  FROM "vote_position" vp
  JOIN "rollcall" r ON r.id = vp.rollcall_id
  JOIN latest_vote_congress lc ON lc.person_id = vp.person_id AND lc.congress = r.congress
  GROUP BY vp.person_id
),
latest_rating AS (
  SELECT DISTINCT ON (pr.promise_id) pr.promise_id, pr.status
  FROM "promise_rating" pr
  ORDER BY pr.promise_id, pr.rated_on DESC, pr.rater
),
promises AS (
  SELECT p.person_id,
    (count(*) FILTER (WHERE lr.status IN ('kept', 'compromise', 'broken')))::int AS rated,
    (count(*) FILTER (WHERE lr.status = 'kept'))::int AS kept
  FROM "promise" p
  JOIN latest_rating lr ON lr.promise_id = p.id
  GROUP BY p.person_id
)
SELECT
  p.id AS person_id,
  p.slug,
  p.full_name,
  p.last_name || ', ' || p.first_name AS sort_name,
  lt.party,
  lt.state,
  lt.chamber,
  lt.district,
  lt.start_date AS term_start,
  round(((current_date - ft.first_start) / 365.25)::numeric, 1)::float8 AS tenure_years,
  li.congress AS ideology_congress,
  li.dim1 AS dw_nominate_dim1,
  li.dim2 AS dw_nominate_dim2,
  tot.cycle AS money_cycle,
  tot.total_receipts_cents,
  tot.other_committee_cents::float8 / nullif(tot.total_receipts_cents, 0) AS pac_share,
  tot.unitemized_individual_cents::float8 / nullif(tot.total_receipts_cents, 0) AS small_dollar_share,
  coalesce(ti.items, '[]'::jsonb) AS top_industries,
  ic.coverage AS industry_coding_coverage,
  CASE WHEN tot.person_id IS NULL THEN NULL ELSE coalesce(o.support_cents, 0) END AS outside_support_cents,
  CASE WHEN tot.person_id IS NULL THEN NULL ELSE coalesce(o.oppose_cents, 0) END AS outside_oppose_cents,
  v.eligible AS votes_eligible,
  v.missed::float8 / nullif(v.eligible, 0) AS missed_vote_rate,
  pr.rated AS promises_rated,
  pr.kept::float8 / nullif(pr.rated, 0) AS promise_kept_rate,
  now() AS refreshed_at
FROM "person" p
LEFT JOIN latest_term lt ON lt.person_id = p.id
LEFT JOIN first_term ft ON ft.person_id = p.id
LEFT JOIN latest_ideology li ON li.person_id = p.id
LEFT JOIN latest_totals tot ON tot.person_id = p.id
LEFT JOIN industry_coverage ic ON ic.person_id = p.id
LEFT JOIN top_industries ti ON ti.person_id = p.id
LEFT JOIN outside o ON o.person_id = p.id
LEFT JOIN votes v ON v.person_id = p.id
LEFT JOIN promises pr ON pr.person_id = p.id;
--> statement-breakpoint
-- The unique index enables REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX "person_card_person_id_idx" ON "person_card" ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_card_slug_idx" ON "person_card" ("slug");--> statement-breakpoint
CREATE INDEX "person_card_state_sort_name_idx" ON "person_card" ("state", "sort_name");--> statement-breakpoint
CREATE INDEX "person_card_sort_name_idx" ON "person_card" ("sort_name");--> statement-breakpoint
CREATE INDEX "person_card_party_idx" ON "person_card" ("party");--> statement-breakpoint
CREATE INDEX "person_card_chamber_idx" ON "person_card" ("chamber");--> statement-breakpoint
CREATE INDEX "person_card_district_idx" ON "person_card" ("district");--> statement-breakpoint
CREATE INDEX "person_card_tenure_years_idx" ON "person_card" ("tenure_years");--> statement-breakpoint
CREATE INDEX "person_card_dw_nominate_dim1_idx" ON "person_card" ("dw_nominate_dim1");--> statement-breakpoint
CREATE INDEX "person_card_dw_nominate_dim2_idx" ON "person_card" ("dw_nominate_dim2");--> statement-breakpoint
CREATE INDEX "person_card_total_receipts_cents_idx" ON "person_card" ("total_receipts_cents");--> statement-breakpoint
CREATE INDEX "person_card_pac_share_idx" ON "person_card" ("pac_share");--> statement-breakpoint
CREATE INDEX "person_card_small_dollar_share_idx" ON "person_card" ("small_dollar_share");--> statement-breakpoint
CREATE INDEX "person_card_industry_coding_coverage_idx" ON "person_card" ("industry_coding_coverage");--> statement-breakpoint
CREATE INDEX "person_card_outside_support_cents_idx" ON "person_card" ("outside_support_cents");--> statement-breakpoint
CREATE INDEX "person_card_outside_oppose_cents_idx" ON "person_card" ("outside_oppose_cents");--> statement-breakpoint
CREATE INDEX "person_card_missed_vote_rate_idx" ON "person_card" ("missed_vote_rate");--> statement-breakpoint
CREATE INDEX "person_card_promise_kept_rate_idx" ON "person_card" ("promise_kept_rate");--> statement-breakpoint
CREATE MATERIALIZED VIEW "person_card_scorecard" AS
SELECT DISTINCT ON (s.person_id, s.publisher_id)
  s.person_id,
  s.publisher_id,
  s.year,
  s.score,
  s.scale_min,
  s.scale_max,
  (s.score - s.scale_min) / nullif(s.scale_max - s.scale_min, 0) AS normalized
FROM "scorecard_score" s
JOIN "scorecard_publisher" sp ON sp.id = s.publisher_id
WHERE sp.terms_status = 'cleared'
ORDER BY s.person_id, s.publisher_id, s.year DESC;
--> statement-breakpoint
CREATE UNIQUE INDEX "person_card_scorecard_pk_idx" ON "person_card_scorecard" ("person_id", "publisher_id");--> statement-breakpoint
CREATE INDEX "person_card_scorecard_sort_idx" ON "person_card_scorecard" ("publisher_id", "normalized");
