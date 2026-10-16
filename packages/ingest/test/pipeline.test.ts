import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IngestRunReceipt } from '@civic-ledger/core';
import type { DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import yauzl from 'yauzl';
import {
  curatedFixture,
  FIXTURES,
  freshDb,
  ingestFixture,
  insertFictionalPerson,
  rows,
  testRuntime,
} from './helpers';

/** Loads every committed fixture through `ingest.run@1`, in pipeline order, once. */
let handle: DbHandle;
const receipts: Record<string, IngestRunReceipt> = {};

beforeAll(async () => {
  handle = await freshDb();
  const rt = await testRuntime(handle);
  await insertFictionalPerson(handle.db);
  for (const source of [
    'congress-legislators',
    'voteview',
    'fec-bulk',
    'govinfo-billstatus',
  ] as const) {
    receipts[source] = await ingestFixture(rt, source);
  }
  receipts.curated = await ingestFixture(rt, 'curated', await curatedFixture());
}, 120_000);
afterAll(() => handle?.close());

const q = <T>(query: ReturnType<typeof sql>) => rows<T>(handle.db, query);

describe('fixture pipeline', () => {
  it('succeeds for every source with an operator receipt', () => {
    for (const [source, receipt] of Object.entries(receipts)) {
      expect(receipt, source).toMatchObject({
        status: 'succeeded',
        deduplicated: false,
        actor: 'operator',
        error: null,
      });
      expect(receipt.snapshotChecksum).toMatch(/^[0-9a-f]{64}$/);
      expect(receipt.readModelRefreshedAfter).not.toBeNull();
    }
  });
});

describe('congress-legislators', () => {
  it('loads people with stable bioguide slugs and every identifier scheme', async () => {
    expect(receipts['congress-legislators']?.counts).toMatchObject({
      people: 9,
      people_new: 9,
      terms_party_split: 2,
    });
    const ids = await q<{ scheme: string; value: string }>(sql`
      select pi.scheme, pi.value from person_identifier pi join person p on p.id = pi.person_id
      where p.slug = 'andy-barr-b001282' order by 1, 2`);
    expect(ids.filter((i) => i.scheme === 'fec_candidate').map((i) => i.value)).toEqual([
      'H0KY06104',
      'S6KY00286',
    ]);
  });

  it('keeps party per term across a mid-term switch', async () => {
    const terms = await q<{ party: string; start: string }>(sql`
      select t.party, t.start_date::text as start from term t join person p on p.id = t.person_id
      where p.slug = 'jefferson-van-drew-v000133' and t.start_date between '2019-01-01' and '2019-12-31' order by 2`);
    expect(terms).toEqual([
      { party: 'Democrat', start: '2019-01-03' },
      { party: 'Republican', start: '2019-12-19' },
    ]);
  });

  it('encodes at-large/delegate seats as district 0 and unknown historical districts as null', async () => {
    const offices = await q<{ slug: string; district: number | null; party: string }>(sql`
      select p.slug, o.district, t.party from term t join office o on o.id = t.office_id join person p on p.id = t.person_id
      where p.slug in ('eleanor-holmes-norton-n000147', 'george-clymer-c000538') and o.chamber = 'house'
      group by 1, 2, 3 order by 1`);
    expect(offices).toEqual([
      { slug: 'eleanor-holmes-norton-n000147', district: 0, party: 'Democrat' },
      { slug: 'george-clymer-c000538', district: null, party: 'Unknown' },
    ]);
  });
});

describe('voteview', () => {
  it('stores Voteview rollnumber and the official session + clerk number separately', async () => {
    const [roll] = await q<{ number: number; session: number; clerk: number }>(sql`
      select number, session, clerk_number as clerk from rollcall where congress = 119 and chamber = 'house' and number = 416`);
    expect(roll).toEqual({ number: 416, session: 2, clerk: 56 });
  });

  it('maps both of a party switcher’s icpsr ids to one person by bioguide', async () => {
    expect(receipts.voteview?.counts).toMatchObject({
      members_matched: 8,
      president_rows_skipped: 1,
      votes_unmatched_member: 1,
      icpsr_differs_from_legislators: 1,
    });
    const icpsr = await q<{ value: string }>(sql`
      select pi.value from person_identifier pi join person p on p.id = pi.person_id
      where p.slug = 'kevin-kiley-k000401' and pi.scheme = 'icpsr' order by 1`);
    expect(icpsr.map((r) => r.value)).toEqual(['22336', '92336']);
  });

  it('loads DW-NOMINATE and positions with the official mapping', async () => {
    const [cantwell] = await q<{ dim1: number; positions: string }>(sql`
      select i.dim1, string_agg(vp.position::text, ',' order by r.number) as positions
      from person p join ideology_score i on i.person_id = p.id
      join vote_position vp on vp.person_id = p.id join rollcall r on r.id = vp.rollcall_id
      where p.slug = 'maria-cantwell-c000127' group by i.dim1`);
    expect(cantwell).toEqual({ dim1: -0.308, positions: 'nay,not_voting,nay' });
  });
});

describe('fec-bulk', () => {
  it('applies the pas2 amendment / memo / refund rules', () => {
    expect(receipts['fec-bulk']?.counts).toMatchObject({
      pas2_rows: 29,
      pas2_memo_dropped: 1,
      pas2_excluded_type: 1,
      pas2_amendment_superseded: 1,
      pas2_duplicate_reports: 1,
      contributions: 24,
      contributions_recipient_via_committee: 1,
      contributions_unresolved_recipient: 1,
    });
  });

  it('nets a refund against its contribution (same TRAN_ID on a later report)', async () => {
    const [row] = await q<{ total: string; n: number }>(sql`
      select sum(cc.amount_cents)::text as total, count(*)::int as n
      from committee_contribution cc join committee c on c.id = cc.committee_id
      where c.fec_committee_id = 'C00004861' and cc.recipient_fec_candidate_id = 'H8MN05239'`);
    expect(row).toEqual({ total: '0', n: 2 });
  });

  it('attributes exactly one totals row per person and cycle', async () => {
    const attributed = await q<{ slug: string; fec: string }>(sql`
      select p.slug, t.fec_candidate_id as fec from candidate_cycle_totals t join person p on p.id = t.person_id
      where p.slug in ('andy-barr-b001282', 'harriet-m-hageman-h001096') order by 1`);
    expect(attributed).toEqual([
      { slug: 'andy-barr-b001282', fec: 'S6KY00286' },
      { slug: 'harriet-m-hageman-h001096', fec: 'H2WY00166' },
    ]);
    const [dupes] = await q<{ n: number }>(sql`
      select count(*)::int as n from (select person_id, cycle from candidate_cycle_totals
      where person_id is not null group by 1, 2 having count(*) > 1) d`);
    expect(dupes?.n).toBe(0);
  });

  it('loads the candidate summary split, one row per person, filer errors counted', async () => {
    expect(receipts['fec-bulk']?.counts).toMatchObject({
      summaries: 14,
      summaries_matched_to_person: 3,
      summaries_attributed_via_other_id: 1,
      summary_unitemized_out_of_range: 1,
    });
    const linked = await q<{ slug: string; fec: string; unitemized: string; receipts: string }>(sql`
      select p.slug, s.fec_candidate_id as fec, s.unitemized_individual_cents::text as unitemized,
        s.total_receipts_cents::text as receipts
      from candidate_cycle_summary s join person p on p.id = s.person_id order by 1`);
    // Hageman: weball totals sit on her House id, the summary lists her Senate run.
    expect(linked.map((r) => [r.slug, r.fec])).toEqual([
      ['andy-barr-b001282', 'S6KY00286'],
      ['harriet-m-hageman-h001096', 'S6WY00209'],
      ['jefferson-van-drew-v000133', 'H8NJ02166'],
    ]);
    expect(linked[0]).toMatchObject({ unitemized: '72934521', receipts: '998104448' });
    const [card] = await q<{ share: number; asOf: string }>(sql`
      select small_dollar_share as share, small_dollar_as_of::text as "asOf"
      from person_card where slug = 'andy-barr-b001282'`);
    expect(card?.share).toBeCloseTo(72934521 / 998104448, 12);
    expect(card?.asOf).toBe('2026-09-30');
  });

  it('dedupes independent expenditures and keys them by filing + transaction', async () => {
    expect(receipts['fec-bulk']?.counts).toMatchObject({
      ie_rows: 13,
      ie_superseded_filings: 1,
      ie_duplicate_reports: 1,
      ie_implausible_amount_dropped: 1,
      ie_invalid_support_oppose: 1,
      ie_unattributed_dropped: 1,
      ie_candidate_ids_uppercased: 1,
      independent_expenditures: 8,
    });
    const keys = await q<{ key: string }>(sql`
      select fec_transaction_id as key from independent_expenditure where spender_fec_committee_id = 'C90023581' order by 1`);
    expect(keys.map((k) => k.key)).toEqual(['2014700:F57.000002', '2014732:F57.000002']);
    // The lower-case id ("h2az02360") is upper-cased; that row also lacks S/O and is dropped.
    const [lower] = await q<{ n: number }>(
      sql`select count(*)::int as n from independent_expenditure where candidate_fec_id <> upper(candidate_fec_id)`,
    );
    expect(lower?.n).toBe(0);
  });

  it('never persists pas2 payee/contributor names or IE payees', async () => {
    const pas2 = await zipText(join(FIXTURES, 'fec-bulk', 'pas226.zip'), 'itpas2.txt');
    const names = pas2
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('|')[7] ?? '');
    const ie = await readFile(
      join(FIXTURES, 'fec-bulk', 'independent_expenditure_2026.csv'),
      'utf8',
    );
    const payees = ['THE STEWART GROUP INC', 'Ads for Good', 'ASCENT MEDIA LLC'];
    expect(ie).toContain(payees[0]);
    const columns = await q<{ table: string; column: string }>(sql`
      select table_name as table, column_name as column from information_schema.columns
      where table_schema = 'public' and data_type = 'text'`);
    const tables = new Set([
      'committee_contribution',
      'independent_expenditure',
      'candidate_cycle_totals',
      'committee_link',
      'candidacy',
    ]);
    for (const { table, column } of columns.filter((c) => tables.has(c.table))) {
      const [hit] = await q<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} in ${[...names, ...payees]}`,
      );
      expect(hit?.n, `${table}.${column}`).toBe(0);
    }
  });
});

describe('govinfo-billstatus', () => {
  it('joins recorded votes to rollcalls on chamber + session + clerk number', async () => {
    expect(receipts['govinfo-billstatus']?.counts).toMatchObject({
      bills: 4,
      recorded_votes: 6,
      rollcall_links: 5,
      rollcall_links_final_passage: 4,
      recorded_votes_without_rollcall: 1,
      bills_without_policy_area: 1,
      bills_sponsor_matched: 1,
    });
    const links = await q<{
      bill: string;
      chamber: string;
      session: number;
      clerk: number;
      final: boolean;
    }>(sql`
      select b.bill_type || b.number as bill, r.chamber, r.session, r.clerk_number as clerk, rb.is_final_passage as final
      from rollcall_bill rb join bill b on b.id = rb.bill_id join rollcall r on r.id = rb.rollcall_id
      where b.number = 142 order by r.chamber, r.session, r.clerk_number`);
    expect(links).toEqual([
      { bill: 'hjres142', chamber: 'house', session: 2, clerk: 56, final: true },
      { bill: 'hjres142', chamber: 'senate', session: 2, clerk: 36, final: false },
      { bill: 'hjres142', chamber: 'senate', session: 2, clerk: 37, final: true },
    ]);
  });

  it('links the sponsor and the Congress.gov policy area', async () => {
    const [bill] = await q<{ sponsor: string; area: string; url: string }>(sql`
      select p.slug as sponsor, bpa.policy_area_id as area, b.url from bill b
      join person p on p.id = b.sponsor_person_id join bill_policy_area bpa on bpa.bill_id = b.id
      where b.bill_type = 'hjres' and b.number = 130`);
    expect(bill).toEqual({
      sponsor: 'harriet-m-hageman-h001096',
      area: 'public-lands-and-natural-resources',
      url: 'https://www.congress.gov/bill/119th-congress/house-joint-resolution/130',
    });
  });
});

describe('curated', () => {
  it('seeds the 32 Congress.gov policy areas and codes committees with coverage', async () => {
    const [areas] = await q<{ n: number }>(sql`select count(*)::int as n from policy_area`);
    expect(areas?.n).toBe(32);
    const counts = receipts.curated?.counts ?? {};
    expect(counts.policy_areas).toBe(32);
    expect(counts.committees_coded).toBeGreaterThan(0);
    expect(counts.industry_coverage_bps).toBe(
      Math.round(
        ((counts.contribution_cents_coded ?? 0) / (counts.contribution_cents_total ?? 1)) * 10_000,
      ),
    );
    const [leadership] = await q<{ industry: string; method: string }>(sql`
      select ci.industry_id as industry, ci.method from committee_industry ci join committee c on c.id = ci.committee_id
      where c.designation = 'D' limit 1`);
    expect(leadership).toEqual({ industry: 'leadership-pacs', method: 'fec_code' });
  });

  it('loads fictional promises, platforms and a framework resolved to fixture rows', async () => {
    expect(receipts.curated?.counts).toMatchObject({
      promises: 1,
      promise_ratings: 1,
      platform_positions: 1,
      frameworks: 1,
      framework_rules: 2,
    });
  });

  it('refreshes person_card with money, ideology and votes from every source', async () => {
    const [card] = await q<{
      party: string;
      dim1: number;
      cycle: number;
      receipts: string;
      votes: number;
    }>(sql`
      select party, dw_nominate_dim1 as dim1, money_cycle as cycle, total_receipts_cents::text as receipts, votes_eligible as votes
      from person_card where slug = 'andy-barr-b001282'`);
    expect(card).toMatchObject({ party: 'Republican', dim1: 0.489, cycle: 2026, votes: 3 });
    expect(Number(card?.receipts)).toBeGreaterThan(0);
  });
});

async function zipText(path: string, entry: string): Promise<string> {
  const zip = await yauzl.openPromise(path, { lazyEntries: true });
  for await (const e of zip.eachEntry()) {
    if (e.fileName !== entry) continue;
    const chunks: Buffer[] = [];
    for await (const chunk of await zip.openReadStreamPromise(e)) chunks.push(chunk as Buffer);
    zip.close();
    return Buffer.concat(chunks).toString('latin1');
  }
  throw new Error(`${entry} not found`);
}
