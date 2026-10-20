import { describe, expect, it } from 'vitest';
import {
  type Attendance,
  type AttendanceMonth,
  attendanceSummary,
  missedShare,
  monthLabel,
  monthSentence,
  monthStatusLabel,
} from '../src/lib/attendance';
import { partyBreakdown, partyRowLabel } from '../src/lib/party-breakdown';
import {
  type ChamberBlock,
  compositionSentence,
  nonVotingGroups,
  SEAT_COLUMNS,
  seatGroups,
  seatTone,
  seatTones,
} from '../src/lib/seat-grid';

const t = (yea: number, nay: number, present: number, notVoting: number) => ({
  yea,
  nay,
  present,
  notVoting,
});

describe('partyBreakdown', () => {
  const byParty = [
    { party: 'Democrat', ...t(200, 5, 1, 11) },
    { party: 'Independent', ...t(1, 0, 0, 0) },
    { party: 'Republican', ...t(10, 200, 2, 9) },
  ];

  it('keeps one row per party, in the given order, and reconciles to the roll-call total', () => {
    const model = partyBreakdown(byParty, t(211, 205, 3, 20));
    expect(model.rows.map((r) => r.party)).toEqual(['Democrat', 'Independent', 'Republican']);
    expect(model.reconciles).toBe(true);
    expect(model.total.total).toBe(439);
    expect(model.rows.reduce((n, r) => n + r.summary.total, 0)).toBe(439);
    // Present and Not voting are separate counts in every row.
    expect(model.rows[2]?.summary.parts.map((p) => [p.label, p.count])).toEqual([
      ['Yea', 10],
      ['Nay', 200],
      ['Present', 2],
      ['Not voting', 9],
    ]);
  });

  it('reports a mismatch instead of hiding it', () => {
    expect(partyBreakdown(byParty, t(211, 205, 3, 21)).reconciles).toBe(false);
    // Same grand total, but Present was folded into Not voting: still caught.
    expect(partyBreakdown(byParty, t(211, 205, 4, 19)).reconciles).toBe(false);
  });

  it('handles a roll call with no positions and names unplaced members plainly', () => {
    expect(partyBreakdown([], t(0, 0, 0, 0))).toMatchObject({ rows: [], reconciles: true });
    const withUnknown = partyBreakdown(
      [...byParty, { party: 'Unknown', ...t(0, 0, 0, 2) }],
      t(211, 205, 3, 22),
    );
    expect(withUnknown.unplaced).toBe(2);
    expect(withUnknown.reconciles).toBe(true);
    expect(partyRowLabel('Unknown')).toBe('Party not on file at the vote date');
    expect(partyRowLabel('Democrat')).toBe('Democrat');
  });
});

const month = (over: Partial<AttendanceMonth> & { month: string }): AttendanceMonth => ({
  status: 'served',
  rollcallsHeld: 4,
  eligible: 4,
  missed: 1,
  present: 0,
  voted: 3,
  ...over,
});

describe('attendance wording', () => {
  it('states the denominator for a served month', () => {
    expect(monthSentence(month({ month: '2025-03', eligible: 12, missed: 2, present: 1 }))).toBe(
      'Of 12 eligible votes in March 2025, 2 not voting and 1 present.',
    );
    expect(monthSentence(month({ month: '2025-03', eligible: 1, missed: 0 }))).toContain(
      'Of 1 eligible vote in March 2025',
    );
  });

  it('words each non-voting status differently and never as zero', () => {
    const sentences = (
      ['no_votes_held', 'not_yet_serving', 'no_longer_serving', 'not_serving', 'no_record'] as const
    ).map((status) =>
      monthSentence(month({ month: '2025-06', status, eligible: 0, missed: 0, rollcallsHeld: 3 })),
    );
    expect(new Set(sentences).size).toBe(5);
    expect(sentences[0]).toBe("No votes held in June 2025 in this member's chamber.");
    expect(sentences[1]).toBe('Not yet serving in June 2025; 3 roll calls held.');
    expect(monthStatusLabel('no_votes_held')).toBe('No votes held');
    expect(monthStatusLabel('not_yet_serving')).toBe('Not yet serving');
    for (const sentence of sentences) expect(sentence).not.toMatch(/\b0 eligible/);
  });

  it('computes the missed share only from eligible votes', () => {
    expect(missedShare(month({ month: '2025-03', eligible: 8, missed: 2 }))).toBe(0.25);
    expect(missedShare(month({ month: '2025-03', eligible: 0, missed: 0 }))).toBe(0);
    expect(monthLabel('2026-01')).toBe('January 2026');
  });

  it('summarizes the totals it was given', () => {
    const attendance = {
      months: [month({ month: '2025-03' }), month({ month: '2025-04', status: 'no_votes_held' })],
      totals: { eligible: 4, missed: 1, present: 0, voted: 3, missedRate: 0.25 },
    } as unknown as Attendance;
    expect(attendanceSummary(attendance)).toBe(
      'Across 1 month with votes, 1 of 4 eligible votes were not voting (25.0%) and 0 were present.',
    );
    expect(
      attendanceSummary({
        ...attendance,
        totals: { eligible: 0, missed: 0, present: 0, voted: 0, missedRate: null },
      }),
    ).toBe('No eligible roll-call votes are on file for this member.');
  });
});

const house = (over: Partial<ChamberBlock> = {}): ChamberBlock => ({
  chamber: 'house',
  seats: 435,
  members: 433,
  voting: [
    { party: 'Democrat', count: 214 },
    { party: 'Independent', count: 1 },
    { party: 'Republican', count: 218 },
  ],
  nonVoting: {
    total: 6,
    parties: [
      { party: 'Democrat', count: 5 },
      { party: 'Republican', count: 1 },
    ],
    jurisdictions: ['AS', 'DC', 'GU', 'MP', 'PR', 'VI'],
  },
  vacancies: 2,
  ...over,
});

describe('seat grid data', () => {
  it('keeps the capability order and appends vacancies last', () => {
    const groups = seatGroups(house());
    expect(groups.map((g) => [g.label, g.tone, g.count])).toEqual([
      ['Democrat', 'democratic', 214],
      ['Independent', 'independent', 1],
      ['Republican', 'republican', 218],
      ['Vacant', 'vacant', 2],
    ]);
    // Exactly one square per voting seat when vacancies are known.
    expect(seatTones(groups)).toHaveLength(435);
    expect(SEAT_COLUMNS.house * 15).toBe(435);
    expect(SEAT_COLUMNS.senate * 10).toBe(100);
  });

  it('omits vacancies when they cannot be determined and never invents squares', () => {
    const groups = seatGroups(house({ vacancies: null }));
    expect(groups.some((g) => g.tone === 'vacant')).toBe(false);
    expect(seatTones(groups)).toHaveLength(433); // the counts it was given, no padding
    expect(seatGroups(house({ vacancies: 0 })).some((g) => g.tone === 'vacant')).toBe(false);
  });

  it('colors only Democrat and Republican; everything else is neutral and patterned', () => {
    expect(seatTone('Democrat', 0)).toBe('democratic');
    expect(seatTone('Democratic Party', 0)).toBe('democratic');
    expect(seatTone('Republican', 0)).toBe('republican');
    expect(seatTone('Independent', 0)).toBe('independent');
    expect(seatTone('Libertarian', 0)).toBe('other-1');
    expect(seatTone('Green', 1)).toBe('other-2');
    expect(seatTone('Harbor Party', 2)).toBe('other-3');
    expect(seatTone('Prairie Party', 3)).toBe('other-1');
    const groups = seatGroups(
      house({
        voting: [
          { party: 'Independent', count: 1 },
          { party: 'Harbor Party', count: 2 },
          { party: 'Prairie Party', count: 3 },
        ],
        vacancies: null,
      }),
    );
    expect(groups.map((g) => g.tone)).toEqual(['independent', 'other-1', 'other-2']);
  });

  it('counts non-voting members apart from the voting grid', () => {
    expect(nonVotingGroups(house()).map((g) => [g.label, g.count])).toEqual([
      ['Democrat', 5],
      ['Republican', 1],
    ]);
    expect(seatTones(seatGroups(house())).length).toBe(435);
  });

  it('names every count in the accessible sentence', () => {
    const text = compositionSentence(house(), 'House');
    expect(text).toContain('433 of 435 voting seats filled');
    expect(text).toContain('214 Democrat, 1 Independent, 218 Republican');
    expect(text).toContain('2 vacancies');
    expect(text).toContain('plus 6 non-voting (5 Democrat, 1 Republican)');
    expect(compositionSentence(house({ vacancies: null }), 'House')).not.toContain('vacanc');
  });
});
