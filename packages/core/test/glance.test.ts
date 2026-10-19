import { office, person, platformPosition, rollcall, votePosition } from '@civic-ledger/db';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { EXPLAINERS } from '../src/explainers/content';
import { expectCapabilityError, useSeededDb } from './helpers';

const db = useSeededDb();

describe('people.glance@1', () => {
  it('builds facts and sentences from the same numbers the other capabilities return', async () => {
    const ctx = db.ctx();
    const slug = 'avery-ashvale';
    const [glance, profile, money, promises, scores] = await Promise.all([
      dispatch('people.glance', { slug }, ctx),
      dispatch('people.get', { slug }, ctx),
      dispatch('money.summary', { slug }, ctx),
      dispatch('promises.list', { slug }, ctx),
      dispatch('scores.list', { slug }, ctx),
    ]);
    expect(glance.person.fullName).toBe('Avery Ashvale');
    expect(glance.asOf).toBe(profile.card.refreshedAt);
    expect(glance.facts.who).toMatchObject({
      isCurrent: profile.card.isCurrent,
      chamber: profile.card.chamber,
      state: profile.card.state,
      party: profile.card.party,
      termsServed: profile.terms.length,
    });
    expect(glance.facts.who.provenance).toEqual(profile.terms[0]?.provenance);

    expect(glance.facts.money?.cycle).toBe(money.cycle);
    expect(glance.facts.money?.totalReceiptsCents).toBe(money.totals?.totalReceiptsCents);
    expect(glance.facts.money?.pacShare).toBe(money.totals?.pacShare);
    expect(glance.facts.money?.smallDollarShare).toBe(money.smallDollar?.share ?? null);
    expect(glance.facts.money?.industryCodingCoverage).toBe(money.industryCoding.coverage);
    expect(glance.facts.money?.topIndustries).toEqual(
      money.industries.slice(0, 3).map((i) => ({
        id: i.industry.id,
        name: i.industry.name,
        amountCents: i.amountCents,
      })),
    );
    expect(glance.facts.money?.outsideSupportCents).toBe(money.outsideSpending.supportCents);

    expect(glance.facts.votes.votesEligible).toBe(profile.card.votesEligible);
    expect(glance.facts.votes.missedVoteRate).toBe(profile.card.missedVoteRate);
    expect(glance.facts.votes.dwNominate?.dim1).toBe(scores.ideology[0]?.dim1);
    expect(glance.facts.votes.dwNominate?.provenance).toEqual(scores.ideology[0]?.provenance);
    expect(glance.facts.votes.provenance).not.toBeNull();

    expect(glance.facts.say.platformPositions).toBe(profile.platform.length);
    expect(glance.facts.say.promises).toBe(promises.summary.total);
    expect(glance.facts.say.promisesRated).toBe(promises.summary.rated);

    expect(glance.paragraphs.map((p) => p.id)).toEqual(['who', 'money', 'votes', 'say']);
    expect(glance.paragraphs[0]?.sentences[0]?.text).toMatch(
      /^Avery Ashvale serves as Senator for ZV/,
    );
  });

  it('every value part names a fact and every term names an existing explainer', async () => {
    const glance = await dispatch('people.glance', { slug: 'avery-ashvale' }, db.ctx());
    const ids = new Set(EXPLAINERS.map((e) => e.id));
    for (const sentence of glance.paragraphs.flatMap((p) => p.sentences)) {
      expect(sentence.text).toBe(sentence.parts.map((p) => p.text).join(''));
      for (const part of sentence.parts) {
        if (part.kind === 'term') expect(ids.has(part.explainer), part.explainer).toBe(true);
        if (part.kind === 'value') expect(part.fact).toMatch(/^(who|money|votes|say)\./);
      }
    }
  });

  it('handles a former member with no money and no votes loaded', async () => {
    const glance = await dispatch('people.glance', { slug: 'cornelius-oakhurst' }, db.ctx());
    expect(glance.facts.who.isCurrent).toBe(false);
    expect(glance.facts.money).toBeNull();
    const texts = glance.paragraphs.flatMap((p) => p.sentences.map((s) => s.text));
    expect(texts[0]).toMatch(/last served as/);
    expect(texts).toContainEqual(expect.stringMatching(/^No FEC campaign totals are loaded/));
    expect(texts).toContainEqual(expect.stringMatching(/^No roll-call votes are loaded/));
    expect(texts).toContainEqual(expect.stringMatching(/^No reviewed platform or promise entries/));
  });

  it('returns not_found for an unknown slug and rejects extra input', async () => {
    await expectCapabilityError(
      dispatch('people.glance', { slug: 'nobody-here' }, db.ctx()),
      'not_found',
    );
    await expectCapabilityError(
      dispatch('people.glance', { slug: 'avery-ashvale', verbose: true }, db.ctx()),
      'invalid_input',
    );
  });

  it('keeps newer votes independent of an older ideology estimate and never labels every platform as the latest cycle', async () => {
    const ctx = db.ctx();
    const [member] = await ctx.db.select().from(person).where(eq(person.slug, 'avery-ashvale'));
    const [template] = await ctx.db.select().from(rollcall).limit(1);
    const [position] = await ctx.db
      .select()
      .from(platformPosition)
      .where(eq(platformPosition.personId, member?.id ?? 0))
      .limit(1);
    if (!member || !template || !position) throw new Error('Expected fictional seed records');
    const { id: _id, ...record } = template;
    const [future] = await ctx.db
      .insert(rollcall)
      .values({
        ...record,
        congress: 120,
        number: 99999,
        voteDate: '2027-02-01',
        sourceKey: 'test:future-rollcall',
      })
      .returning();
    if (!future) throw new Error('Expected a test rollcall');
    try {
      await ctx.db.insert(votePosition).values({
        rollcallId: future.id,
        personId: member.id,
        position: 'not_voting',
        sourceId: template.sourceId,
        sourceKey: 'test:future-position',
        ingestRunId: template.ingestRunId,
        retrievedAt: template.retrievedAt,
      });
      const { id: _positionId, ...oldPosition } = position;
      await ctx.db
        .insert(platformPosition)
        .values({ ...oldPosition, cycle: 2022, sourceKey: 'test:older-platform' });
      const glance = await dispatch('people.glance', { slug: member.slug }, ctx);
      expect(glance.facts.votes.congress).toBe(120);
      expect(glance.facts.votes.votesEligible).toBe(1);
      expect(glance.facts.votes.votesMissed).toBe(1);
      expect(glance.facts.votes.dwNominate?.congress).toBeLessThan(120);
      expect(glance.facts.say.platformPositions).toBeGreaterThan(1);
      expect(glance.paragraphs[3]?.sentences[0]?.text).toContain('across loaded campaigns');
    } finally {
      await ctx.db.delete(votePosition).where(eq(votePosition.rollcallId, future.id));
      await ctx.db.delete(rollcall).where(eq(rollcall.id, future.id));
      await ctx.db
        .delete(platformPosition)
        .where(eq(platformPosition.sourceKey, 'test:older-platform'));
    }
  });
});

describe('explainers.list@1', () => {
  it('lists every explainer with a source link and a methodology anchor', async () => {
    const result = await dispatch('explainers.list', {}, db.ctx());
    expect(result.items.map((e) => e.id)).toEqual(EXPLAINERS.map((e) => e.id));
    for (const e of result.items) {
      expect(e.answer.length).toBeGreaterThan(0);
      expect(e.source.url).toMatch(/^(https:\/\/|\/methodology#)/);
      expect(e.href).toBe(`/methodology#explainer-${e.id}`);
    }
  });

  it('returns one by id and not_found otherwise', async () => {
    const one = await dispatch('explainers.list', { id: 'pac' }, db.ctx());
    expect(one.items).toHaveLength(1);
    expect(one.items[0]?.question).toBe('What is a PAC?');
    await expectCapabilityError(dispatch('explainers.list', { id: 'nope' }, db.ctx()), 'not_found');
    await expectCapabilityError(
      dispatch('explainers.list', { id: 'Bad Id' }, db.ctx()),
      'invalid_input',
    );
  });
});

describe('explore district filter and facets', () => {
  it('an at-large district of zero includes that House seat and state senators; omitting it includes every state seat', async () => {
    const ctx = db.ctx();
    const [seat] = await ctx.db
      .select()
      .from(office)
      .where(and(eq(office.chamber, 'house'), eq(office.state, 'ZV')))
      .limit(1);
    if (!seat) throw new Error('Expected a fictional House seat');
    try {
      await ctx.db.update(office).set({ district: 0 }).where(eq(office.id, seat.id));
      await ctx.db.execute(sql`refresh materialized view person_card`);
      const atLarge = await dispatch(
        'explore.table',
        { filters: { state: seat.state, district: 0 } },
        ctx,
      );
      const all = await dispatch('explore.table', { filters: { state: seat.state } }, ctx);
      expect(atLarge.rows.some((row) => row.chamber === 'house' && row.district === 0)).toBe(true);
      expect(atLarge.rows.some((row) => row.chamber === 'senate')).toBe(true);
      expect(
        atLarge.rows.every(
          (row) => row.state === seat.state && (row.chamber === 'senate' || row.district === 0),
        ),
      ).toBe(true);
      expect(all.total).toBeGreaterThan(atLarge.total);
      const facets = await dispatch('explore.facets', {}, ctx);
      expect(facets.districts.some((row) => row.state === seat.state && row.district === 0)).toBe(
        true,
      );
    } finally {
      await ctx.db.update(office).set({ district: seat.district }).where(eq(office.id, seat.id));
      await ctx.db.execute(sql`refresh materialized view person_card`);
    }
  });
  it('a district matches its representative and the state’s senators', async () => {
    const ctx = db.ctx();
    const facets = await dispatch('explore.facets', {}, ctx);
    const seat = facets.districts[0];
    expect(seat).toBeDefined();
    if (!seat) return;
    const result = await dispatch(
      'explore.table',
      { filters: { state: seat.state, district: seat.district } },
      ctx,
    );
    expect(result.total).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.state).toBe(seat.state);
      expect(row.chamber === 'senate' || row.district === seat.district).toBe(true);
    }
    expect(result.rows.filter((r) => r.chamber === 'house')).toHaveLength(seat.count);
  });

  it('rejects a district without a state', async () => {
    await expectCapabilityError(
      dispatch('explore.table', { filters: { district: 3 } }, db.ctx()),
      'invalid_input',
    );
  });
});
