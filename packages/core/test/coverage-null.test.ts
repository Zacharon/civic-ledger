import { refreshPersonCard } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { useSeededDb } from './helpers';

/**
 * H3-03 (probe P6): industry-coding coverage must mean the same thing on the card
 * (`people.get`, Explore) and in `money.summary`: 0 when positive PAC money exists but
 * none of it is coded, null only when there is no positive PAC money at all.
 */
const db = useSeededDb();
const exec = (query: ReturnType<typeof sql>) => db.handle().db.execute(query);
const cases: Record<'allUncoded' | 'allRefunds' | 'mixed', string> = {
  allUncoded: '',
  allRefunds: '',
  mixed: '',
};

async function committee(coded: boolean): Promise<string> {
  const result = await exec(sql`
    select c.fec_committee_id as id from committee c
    left join committee_industry ci on ci.committee_id = c.id
    where (ci.id is not null) = ${coded} order by 1 limit 1`);
  const row = result.rows[0] as { id: string } | undefined;
  if (!row) throw new Error(`seed has no ${coded ? 'coded' : 'uncoded'} committee`);
  return row.id;
}

/** Replaces a member's PAC entries in their latest money cycle with `gifts` (cents). */
async function setContributions(slug: string, gifts: { committee: string; cents: number }[]) {
  await exec(
    sql`delete from committee_contribution where person_id = (select id from person where slug = ${slug})`,
  );
  for (const [i, gift] of gifts.entries()) {
    await exec(sql`
      insert into committee_contribution
        (fec_sub_id, committee_id, recipient_fec_candidate_id, person_id, cycle, amount_cents,
         transaction_date, transaction_type, source_id, source_key, ingest_run_id, retrieved_at)
      select ${`h3-03-${slug}-${i}`}, c.id, t.fec_candidate_id, p.id, t.cycle, ${gift.cents},
        '2024-11-01', '24K', 'dev-seed', ${`test:h3-03-${slug}-${i}`}, 1, now()
      from person p
      join lateral (select * from candidate_cycle_totals t where t.person_id = p.id
        order by t.cycle desc limit 1) t on true
      join committee c on c.fec_committee_id = ${gift.committee}
      where p.slug = ${slug}`);
  }
}

beforeAll(async () => {
  const slugs = await exec(sql`
    select distinct p.slug from person p join candidate_cycle_totals t on t.person_id = p.id
    order by p.slug limit 3`);
  const [a, b, c] = (slugs.rows as { slug: string }[]).map((r) => r.slug);
  if (!a || !b || !c) throw new Error('seed has fewer than three members with money');
  Object.assign(cases, { allUncoded: a, allRefunds: b, mixed: c });
  const coded = await committee(true);
  const uncoded = await committee(false);
  await setContributions(a, [
    { committee: uncoded, cents: 1_500_000 },
    { committee: uncoded, cents: 600_000 },
  ]);
  await setContributions(b, [
    { committee: uncoded, cents: -400_000 },
    { committee: coded, cents: -250_000 },
  ]);
  await setContributions(c, [
    { committee: coded, cents: 900_000 },
    { committee: coded, cents: -100_000 },
    { committee: uncoded, cents: 300_000 },
    { committee: uncoded, cents: -50_000 },
  ]);
  await refreshPersonCard(db.handle().db);
});

const coverageOf = async (slug: string) => {
  const [money, profile] = await Promise.all([
    dispatch('money.summary', { slug }, db.ctx()),
    dispatch('people.get', { slug }, db.ctx()),
  ]);
  return {
    money: money.industryCoding.coverage,
    card: profile.card.industryCodingCoverage,
  };
};

describe('industry-coding coverage: card versus money.summary (H3-03)', () => {
  it('all positive PAC money uncoded: both report 0, not null', async () => {
    expect(await coverageOf(cases.allUncoded)).toEqual({ money: 0, card: 0 });
  });

  it('only refunds (no positive base): both report null', async () => {
    expect(await coverageOf(cases.allRefunds)).toEqual({ money: null, card: null });
  });

  it('mixed coded, uncoded and refunds: both report the gross-coded share', async () => {
    const { money, card } = await coverageOf(cases.mixed);
    expect(money).toBeCloseTo(900_000 / 1_200_000, 12);
    expect(card).toBeCloseTo(money ?? -1, 12);
  });
});
