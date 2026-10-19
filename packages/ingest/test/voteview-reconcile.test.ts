import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchByName } from '@civic-ledger/core';
import type { DbHandle } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runIngest } from '../src/runtime/run';
import { FIXTURES, freshDb, ingestFixture, rows, tableCounts, testRuntime } from './helpers';

/**
 * F3 (evidence-trust 2026-10-19): a Voteview snapshot is the complete record of its
 * congress. Assertions it no longer makes (a vote, a score, a person attribution) must not
 * stay current, a suspicious snapshot must be refused before anything is reconciled, and
 * the source's provisional flag must reach scores.list.
 *
 * Every test starts from an "extended" snapshot: the committed fixture plus 30 synthetic
 * House rollcalls voted by four members (138 positions), so a one-member correction is a
 * small share of the congress and the default shrink guard judges it as it would a real one.
 */
let handle: DbHandle;
beforeEach(async () => {
  handle = await freshDb();
});
afterEach(() => handle.close());

const q = <T>(query: ReturnType<typeof sql>) => rows<T>(handle.db, query);

const SYNTHETIC = Array.from({ length: 30 }, (_, i) => 1001 + i);
const SYNTHETIC_VOTERS = ['21333', '21700', '22336', '91980'];

interface Files {
  members: string[];
  rollcalls: string[];
  votes: string[];
}

async function fixtureFiles(congress = 119): Promise<{ header: Files; body: Files }> {
  const read = async (name: string) =>
    (await readFile(join(FIXTURES, 'voteview', `HS119_${name}.csv`), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((l) => (congress === 119 ? l : l.replace(/^119,/, `${congress},`)));
  const [members, rollcalls, votes] = await Promise.all(
    ['members', 'rollcalls', 'votes'].map(read),
  );
  const split = (lines: string[]) => ({ header: lines[0] ?? '', body: lines.slice(1) });
  const m = split(members ?? []);
  const r = split(rollcalls ?? []);
  const v = split(votes ?? []);
  const rollcall = (n: number) =>
    [
      congress,
      'House',
      n,
      '2025-06-02',
      1,
      n,
      '1/2',
      4,
      0,
      '',
      '',
      '',
      '',
      '',
      `HR${n}`,
      'Passed',
      `Synthetic rollcall ${n}`,
      'On Passage',
      '',
    ].join(',');
  return {
    header: { members: [m.header], rollcalls: [r.header], votes: [v.header] },
    body: {
      members: m.body,
      rollcalls: [...r.body, ...SYNTHETIC.map(rollcall)],
      votes: [
        ...v.body,
        ...SYNTHETIC.flatMap((n) =>
          SYNTHETIC_VOTERS.map((i) => `${congress},House,${n},${i},1,99.0`),
        ),
      ],
    },
  };
}

/** Writes an extended snapshot directory, optionally edited, and returns its path. */
async function snapshot(edit: (f: Files) => Files | undefined = () => undefined, congress = 119) {
  const { header, body } = await fixtureFiles(congress);
  const files = edit(body) ?? body;
  const dir = await mkdtemp(join(tmpdir(), 'civic-voteview-reconcile-'));
  const prefix = `HS${String(congress).padStart(3, '0')}`;
  for (const name of ['members', 'rollcalls', 'votes'] as const) {
    await writeFile(
      join(dir, `${prefix}_${name}.csv`),
      `${[...header[name], ...files[name]].join('\n')}\n`,
    );
  }
  return dir;
}

async function baseline() {
  const rt = await testRuntime(handle);
  expect((await ingestFixture(rt, 'congress-legislators')).status).toBe('succeeded');
  const first = await ingestFixture(rt, 'voteview', await snapshot());
  expect(first.status).toBe('succeeded');
  expect(first.counts.vote_positions).toBe(138);
  return { rt, first };
}

const personId = async (bioguide: string) => {
  const [row] = await q<{ id: number }>(sql`
    select person_id as id from person_identifier where scheme = 'bioguide' and value = ${bioguide}`);
  if (!row) throw new Error(`no person ${bioguide}`);
  return row.id;
};

const scores = (slug: string) =>
  dispatchByName('scores.list', { slug }, { db: handle.db }) as Promise<{
    ideology: Array<{ congress: number; dim1: number; provisional?: boolean | null }>;
  }>;

/** Every Voteview fact of a congress, for "nothing changed" comparisons. */
async function congressFacts(congress: number) {
  return {
    rollcalls: await q(sql`
      select chamber, number, question, ingest_run_id from rollcall where congress = ${congress} order by 1, 2`),
    positions: await q(sql`
      select vp.source_key, vp.person_id, vp.position::text, vp.ingest_run_id from vote_position vp
      join rollcall r on r.id = vp.rollcall_id where r.congress = ${congress} order by 1, 2`),
    scores: await q(sql`
      select person_id, dim1, dim2, provisional, ingest_run_id from ideology_score
      where congress = ${congress} order by 1`),
  };
}

const replace = (lines: string[], from: string, to: string) => {
  const hits = lines.filter((l) => l.includes(from)).length;
  if (hits !== 1) throw new Error(`expected one line containing ${from}, found ${hits}`);
  return lines.map((l) => (l.includes(from) ? l.replace(from, to) : l));
};

describe('Voteview reconciliation (F3)', () => {
  it('R1: a corrected ICPSR→Bioguide mapping moves the vote to B and leaves nothing under A', async () => {
    const { rt } = await baseline();
    const hageman = await personId('H001096');
    const bland = await personId('B000546');

    // Upstream corrects icpsr 22325: it belongs to B000546, not H001096.
    const corrected = await snapshot((f) => ({
      ...f,
      members: replace(f.members, ',H001096,', ',B000546,'),
    }));
    const receipt = await ingestFixture(rt, 'voteview', corrected);
    expect(receipt.status, receipt.error ?? '').toBe('succeeded');

    const byKey = await q<{ source_key: string; people: number[] }>(sql`
      select source_key, array_agg(person_id order by person_id) as people from vote_position
      where source_key like '%:22325' group by source_key order by 1`);
    expect(byKey.length).toBe(3);
    for (const row of byKey) expect(row.people, row.source_key).toEqual([bland]);
    const duplicated = await q(sql`
      select source_key from vote_position group by source_key having count(*) > 1`);
    expect(duplicated).toEqual([]);
    const [underA] = await q<{ votes: number; scores: number }>(sql`
      select (select count(*) from vote_position where person_id = ${hageman})::int as votes,
             (select count(*) from ideology_score where person_id = ${hageman})::int as scores`);
    expect(underA).toEqual({ votes: 0, scores: 0 });
    const [icpsr] = await q<{ person_id: number }>(sql`
      select person_id from person_identifier where scheme = 'icpsr' and value = '22325'`);
    expect(icpsr?.person_id).toBe(bland);
    expect(receipt.counts).toMatchObject({
      stale_vote_positions_deleted: 3,
      stale_ideology_scores_deleted: 1,
      icpsr_reassigned: 1,
    });
  });

  it('R2: a score replaced by a genuinely missing dim1 is no longer presented', async () => {
    const { rt } = await baseline();
    expect((await scores('andy-barr-b001282')).ideology.map((i) => i.dim1)).toEqual([0.489]);

    const missing = await snapshot((f) => ({
      ...f,
      members: replace(f.members, ',B001282,1973.0,,0.489,0.296,', ',B001282,1973.0,,,,'),
    }));
    const receipt = await ingestFixture(rt, 'voteview', missing);
    expect(receipt.status, receipt.error ?? '').toBe('succeeded');
    expect(receipt.counts).toMatchObject({
      ideology_missing_dim1: 1,
      stale_ideology_scores_deleted: 1,
    });
    expect((await scores('andy-barr-b001282')).ideology).toEqual([]);
    const [card] = await q<{ dim1: number | null }>(sql`
      select dw_nominate_dim1 as dim1 from person_card where slug = 'andy-barr-b001282'`);
    expect(card?.dim1).toBeNull();
  });

  it('R3: a vote changed to cast_code 0 and a removed vote row are reconciled', async () => {
    const { rt } = await baseline();
    const changed = await snapshot((f) => ({
      ...f,
      votes: replace(f.votes, '119,House,293,21333,1,', '119,House,293,21333,0,').filter(
        (l) => !l.startsWith('119,House,416,21700,'),
      ),
    }));
    const receipt = await ingestFixture(rt, 'voteview', changed);
    expect(receipt.status, receipt.error ?? '').toBe('succeeded');
    expect(receipt.counts).toMatchObject({
      vote_positions: 136,
      votes_not_member: 1,
      stale_vote_positions_deleted: 2,
    });
    const gone = await q(sql`
      select source_key from vote_position where source_key in ('119H293:21333', '119H416:21700')`);
    expect(gone).toEqual([]);
    const [n] = await q<{ n: number }>(sql`select count(*)::int as n from vote_position`);
    expect(n?.n).toBe(136);
  });

  it('R3b: a rollcall absent from the snapshot keeps its row but loses its withdrawn positions', async () => {
    const { rt } = await baseline();
    const dropped = await snapshot((f) => ({
      ...f,
      rollcalls: f.rollcalls.filter((l) => !l.startsWith('119,House,1030,')),
      votes: f.votes.filter((l) => !l.startsWith('119,House,1030,')),
    }));
    const receipt = await ingestFixture(rt, 'voteview', dropped);
    expect(receipt.status, receipt.error ?? '').toBe('succeeded');
    expect(receipt.counts).toMatchObject({
      rollcalls_absent_from_snapshot: 1,
      stale_vote_positions_deleted: 4,
    });
    const [kept] = await q<{ n: number; positions: number }>(sql`
      select count(*)::int as n,
        (select count(*) from vote_position vp join rollcall r on r.id = vp.rollcall_id
         where r.congress = 119 and r.number = 1030)::int as positions
      from rollcall where congress = 119 and chamber = 'house' and number = 1030`);
    expect(kept).toEqual({ n: 1, positions: 0 });
  });

  it('R4: provisional / final / unknown survive DB and scores.list; a later final estimate updates it', async () => {
    const { rt } = await baseline();
    const provisional = await snapshot((f) => ({
      ...f,
      members: replace(f.members, ',539,14,,0.631,', ',539,14,1,0.631,'),
    }));
    const receipt = await ingestFixture(rt, 'voteview', provisional);
    expect(receipt.status, receipt.error ?? '').toBe('succeeded');
    expect(receipt.counts.ideology_provisional).toBe(1);

    const stored = await q<{ bioguide: string; provisional: boolean | null }>(sql`
      select pi.value as bioguide, s.provisional from ideology_score s
      join person_identifier pi on pi.person_id = s.person_id and pi.scheme = 'bioguide'
      order by 1`);
    expect(stored.length).toBe(7);
    for (const s of stored) expect(s.provisional, s.bioguide).toBe(s.bioguide === 'B001282');

    // A row loaded before migration 0006 has no stated status.
    await handle.db.execute(sql`
      update ideology_score set provisional = null
      where person_id = (select person_id from person_identifier where scheme = 'bioguide' and value = 'N000147')`);
    expect((await scores('andy-barr-b001282')).ideology[0]?.provisional).toBe(true);
    expect((await scores('maria-cantwell-c000127')).ideology[0]?.provisional).toBe(false);
    expect((await scores('eleanor-holmes-norton-n000147')).ideology[0]?.provisional).toBeNull();

    // The finalized estimate arrives: the stored status follows the source.
    const final = await ingestFixture(
      rt,
      'voteview',
      await snapshot((f) => ({
        ...f,
        members: replace(f.members, ',539,14,,0.631,', ',539,14,0,0.631,'),
      })),
    );
    expect(final.status, final.error ?? '').toBe('succeeded');
    expect((await scores('andy-barr-b001282')).ideology[0]?.provisional).toBe(false);
    expect((await scores('eleanor-holmes-norton-n000147')).ideology[0]?.provisional).toBe(false);
  });

  it('R5: an out-of-scope congress record refuses the run and changes neither congress', async () => {
    const { rt } = await baseline();
    const c118 = await runIngest(
      {
        source: 'voteview',
        scope: { kind: 'congress', congress: 118 },
        snapshotPath: await snapshot(undefined, 118),
      },
      rt,
    );
    expect(c118.status, c118.error ?? '').toBe('succeeded');
    const before = { 118: await congressFacts(118), 119: await congressFacts(119) };

    const mixed = await snapshot((f) => ({
      ...f,
      rollcalls: f.rollcalls.map((l) =>
        l.startsWith('119,House,416,')
          ? l.replace(/^119,/, '118,').replace('Disapproving', 'X')
          : l,
      ),
      votes: f.votes.map((l) => (l.startsWith('119,House,416,') ? l.replace(/^119,/, '118,') : l)),
    }));
    const receipt = await ingestFixture(rt, 'voteview', mixed);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(
      /HS119_rollcalls\.csv line \d+: congress 118 is outside the run scope \(congress 119\)/,
    );
    expect(await congressFacts(118)).toEqual(before[118]);
    expect(await congressFacts(119)).toEqual(before[119]);
  });

  it('R6: a valid small correction among unchanged records commits under the default shrink guard', async () => {
    const { rt } = await baseline();
    const corrected = await snapshot((f) => ({
      ...f,
      votes: replace(f.votes, '119,House,1001,21333,1,', '119,House,1001,21333,6,').filter(
        (l) => !l.startsWith('119,House,1002,21700,'),
      ),
    }));
    const receipt = await ingestFixture(rt, 'voteview', corrected);
    expect(receipt.status, receipt.error ?? '').toBe('succeeded');
    expect(receipt.note).toBeNull();
    expect(receipt.counts).toMatchObject({
      vote_positions: 137,
      stale_vote_positions_deleted: 1,
      stale_ideology_scores_deleted: 0,
      rollcalls_absent_from_snapshot: 0,
    });
    const [nay] = await q<{ position: string }>(sql`
      select position::text from vote_position where source_key = '119H1001:21333'`);
    expect(nay?.position).toBe('nay');
  });

  it('R7: a failure during reconciliation leaves facts, read models and the receipt consistent', async () => {
    const { rt, first } = await baseline();
    const factsBefore = await congressFacts(119);
    const countsBefore = await tableCounts(handle.db);
    const cardsBefore = await q(sql`
      select slug, dw_nominate_dim1, refreshed_at::text from person_card order by slug`);

    // The reconciliation's DELETE is the first statement to touch vote_position rows the
    // snapshot withdrew; make the database refuse it.
    await handle.db.execute(
      sql.raw(`
      create function refuse_vote_delete() returns trigger language plpgsql as $$
      begin raise exception 'injected reconciliation failure'; end $$`),
    );
    await handle.db.execute(
      sql.raw(`
      create trigger refuse_vote_delete before delete on vote_position
      for each row execute function refuse_vote_delete()`),
    );

    const withdrawn = await snapshot((f) => ({
      ...f,
      votes: f.votes.filter((l) => !l.startsWith('119,House,1003,21333,')),
    }));
    const receipt = await ingestFixture(rt, 'voteview', withdrawn);
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(/injected reconciliation failure/);
    expect(receipt.readModelRefreshedAfter).toBeNull();
    expect(receipt.counts).toEqual({});

    expect(await congressFacts(119)).toEqual(factsBefore);
    expect(await tableCounts(handle.db)).toEqual({
      ...countsBefore,
      ingest_run: countsBefore.ingest_run + 1,
    });
    expect(
      await q(
        sql`select slug, dw_nominate_dim1, refreshed_at::text from person_card order by slug`,
      ),
    ).toEqual(cardsBefore);
    const [latest] = await q<{ id: number }>(sql`
      select id from ingest_run where source_id = 'voteview' and status = 'succeeded'
      order by id desc limit 1`);
    expect(latest?.id).toBe(first.id);
  });
});

describe('Voteview completeness checks refuse before reconciling', () => {
  const refused = async (edit: (f: Files) => Files, pattern: RegExp) => {
    const { rt } = await baseline();
    const before = await congressFacts(119);
    const receipt = await ingestFixture(rt, 'voteview', await snapshot(edit));
    expect(receipt.status).toBe('failed');
    expect(receipt.error).toMatch(pattern);
    expect(await congressFacts(119)).toEqual(before);
  };

  it('refuses a vote on a rollcall the rollcalls file does not list', () =>
    refused(
      (f) => ({ ...f, rollcalls: f.rollcalls.filter((l) => !l.startsWith('119,House,1005,')) }),
      /voteview snapshot incomplete: .*vote rows reference rollcalls missing from HS119_rollcalls\.csv \(first: House 1005\)/,
    ));

  it('refuses a rollcall with no vote rows', () =>
    refused(
      (f) => ({ ...f, votes: f.votes.filter((l) => !l.startsWith('119,House,1007,')) }),
      /voteview snapshot incomplete: .*rollcalls have no vote rows in HS119_votes\.csv \(first: House 1007\)/,
    ));

  it('refuses an empty members file', () =>
    refused(
      (f) => ({ ...f, members: [] }),
      /voteview snapshot incomplete: .*HS119_members\.csv has no member rows/,
    ));

  it('refuses one icpsr listed with two different Bioguide ids', () =>
    refused(
      (f) => ({
        ...f,
        members: [
          ...f.members,
          '119,House,22325,68,1,WY,200,,,"HAGEMAN, Harriet",B000546,1962.0,,0.636,-0.355,,,,,,,',
        ],
      }),
      /voteview snapshot incomplete: .*icpsr 22325 \(House\) is listed with Bioguide H001096 and B000546/,
    ));

  it('refuses two icpsrs that map to one person on the same rollcall', () =>
    refused(
      (f) => ({ ...f, members: replace(f.members, ',B001282,', ',A000375,') }),
      /voteview snapshot incomplete: .*two icpsrs \(\d+, \d+\) map to one person on House rollcall \d+/,
    ));

  it('refuses a members file where many members match no person', () =>
    refused(
      (f) => ({
        ...f,
        members: [
          ...f.members,
          ...Array.from(
            { length: 12 },
            (_, i) =>
              `119,House,${80001 + i},1,1,ZZ,100,,,"PERSON, Fictional ${i}",X9${String(i).padStart(5, '0')},1970.0,,0.1,0.1,,,,,,,`,
          ),
        ],
      }),
      /voteview snapshot incomplete: .*12 of 20 members match no person/,
    ));

  it('refuses a votes file where many rows name an icpsr the members file does not list', () =>
    refused(
      (f) => ({
        ...f,
        votes: [
          ...f.votes,
          ...SYNTHETIC.flatMap((n) =>
            Array.from({ length: 40 }, (_, i) => `119,House,${n},${70001 + i},1,99.0`),
          ),
        ],
      }),
      /voteview snapshot incomplete: .*1201 of 1339 vote rows name an icpsr missing from HS119_members\.csv/,
    ));
});
