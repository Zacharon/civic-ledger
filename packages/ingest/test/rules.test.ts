import { describe, expect, it } from 'vitest';
import { toRecord } from '../src/adapters/congress-legislators/parse';
import {
  type CommitteeFacts,
  codeCommittees,
  normalizeName,
} from '../src/adapters/curated/industry-coding';
import {
  dedupeIndependentExpenditures,
  dedupePas2,
  type IeRow,
  type Pas2Row,
} from '../src/adapters/fec-bulk/dedupe';
import { attributeTotals, resolveRecipient } from '../src/adapters/fec-bulk/load';
import type { TotalsRecord } from '../src/adapters/fec-bulk/parse';
import { isFinalPassageQuestion } from '../src/adapters/govinfo-billstatus/final-passage';
import { positionForCastCode } from '../src/adapters/voteview/load';

const pas2 = (over: Partial<Pas2Row>): Pas2Row => ({
  cmteId: 'C00000001',
  amndtInd: 'N',
  rptTp: 'M4',
  transactionTp: '24K',
  transactionDt: '03242025',
  amount: '1000',
  otherId: 'C00000002',
  candId: 'H8MN05239',
  tranId: 'T1',
  fileNum: 100,
  memoCd: '',
  subId: '1',
  ...over,
});

describe('pas2 dedupe (amendments, memos, refunds)', () => {
  it('keeps a refund that reuses the original TRAN_ID on a later report, so they net out', () => {
    // Real pattern: C00004861 B897712 +2500 (M4) then -2500 (YE).
    const { kept, stats } = dedupePas2([
      pas2({ amount: '2500', subId: '1' }),
      pas2({ amount: '-2500', rptTp: 'YE', transactionDt: '12032025', fileNum: 200, subId: '2' }),
    ]);
    expect(kept.map((r) => r.amount)).toEqual(['2500', '-2500']);
    expect(stats.amendmentSuperseded + stats.duplicateReports).toBe(0);
  });

  it('keeps distinct contributions that reuse a TRAN_ID across monthly reports', () => {
    // Real pattern: C00692327 SB23.1 on every monthly report, different recipients.
    const { kept } = dedupePas2([
      pas2({
        tranId: 'SB23.1',
        rptTp: 'M4',
        transactionDt: '03102025',
        candId: 'S4AK00214',
        fileNum: 1,
        subId: '1',
      }),
      pas2({
        tranId: 'SB23.1',
        rptTp: 'M4',
        transactionDt: '03052026',
        candId: 'S6AL00476',
        fileNum: 2,
        subId: '2',
      }),
      pas2({
        tranId: 'SB23.1',
        rptTp: 'M2',
        transactionDt: '01272025',
        candId: 'S2TX00106',
        fileNum: 3,
        subId: '3',
      }),
    ]);
    expect(kept).toHaveLength(3);
  });

  it('drops the original when a later filing of the same report amends it (A or T)', () => {
    // Real pattern: C00679167 SB23.4553 N (file 1979024) then A (file 1979918), same MY report.
    const { kept, stats } = dedupePas2([
      pas2({ rptTp: 'MY', fileNum: 1979024, subId: '10' }),
      pas2({ rptTp: 'MY', amndtInd: 'A', fileNum: 1979918, subId: '11' }),
    ]);
    expect(kept.map((r) => r.subId)).toEqual(['11']);
    expect(stats.amendmentSuperseded).toBe(1);
  });

  it('keeps two new (N) filings of a repeating report type with a reused TRAN_ID', () => {
    // Real pattern: C00053553 30S filed twice in 2025 for different special elections.
    const { kept } = dedupePas2([
      pas2({ rptTp: '30S', transactionDt: '04012025', amount: '4950', fileNum: 1, subId: '1' }),
      pas2({
        rptTp: '30S',
        transactionDt: '09082025',
        amount: '1000',
        candId: 'H6NE03115',
        fileNum: 2,
        subId: '2',
      }),
    ]);
    expect(kept).toHaveLength(2);
  });

  it('counts an identical transaction re-reported on another report once (latest filing)', () => {
    const { kept, stats } = dedupePas2([
      pas2({ rptTp: 'Q2', amount: '-535', fileNum: 1909501, subId: '1' }),
      pas2({ rptTp: 'MY', amndtInd: 'A', amount: '-535', fileNum: 1941058, subId: '2' }),
    ]);
    expect(kept.map((r) => r.subId)).toEqual(['2']);
    expect(stats.duplicateReports).toBe(1);
  });

  it('drops memo rows and non-contribution transaction types', () => {
    const { kept, stats } = dedupePas2([
      pas2({ memoCd: 'X', subId: '1' }),
      pas2({ transactionTp: '24E', tranId: 'T2', subId: '2' }),
      pas2({ transactionTp: '24Z', tranId: 'T3', subId: '3' }),
    ]);
    expect(kept.map((r) => r.transactionTp)).toEqual(['24Z']);
    expect(stats).toMatchObject({ memoDropped: 1, excludedType: 1, kept: 1 });
  });
});

const ie = (over: Partial<IeRow>): IeRow => ({
  spenderId: 'C00935767',
  tranId: 'SE.1',
  fileNum: 1,
  prevFileNum: null,
  candidateId: 'H4NC01137',
  supportOppose: 'O',
  amountCents: 565500,
  date: '2026-02-26',
  imageNum: '1',
  ...over,
});

describe('independent expenditure dedupe', () => {
  it('drops a filing superseded by an amendment (prev_file_num)', () => {
    const { kept, stats } = dedupeIndependentExpenditures([
      ie({ fileNum: 1950700 }),
      ie({ fileNum: 1950704, prevFileNum: 1950700 }),
    ]);
    expect(kept.map((r) => r.fileNum)).toEqual([1950704]);
    expect(stats.superseded).toBe(1);
  });

  it('keeps per-filing tran_id reuse for different expenditures; collapses exact re-reports', () => {
    const { kept, stats } = dedupeIndependentExpenditures([
      ie({
        spenderId: 'C00608943',
        tranId: '1',
        fileNum: 1932708,
        candidateId: 'S6IA00314',
        amountCents: 1820500,
      }),
      ie({
        spenderId: 'C00608943',
        tranId: '1',
        fileNum: 1926639,
        candidateId: 'H8LA00017',
        amountCents: 2422957,
      }),
      ie({ spenderId: 'C90023581', tranId: 'F57.000002', fileNum: 2014703, amountCents: 5501519 }),
      ie({ spenderId: 'C90023581', tranId: 'F57.000002', fileNum: 2014732, amountCents: 5501519 }),
    ]);
    expect(kept).toHaveLength(3);
    expect(stats.duplicateReports).toBe(1);
    expect(kept.find((r) => r.spenderId === 'C90023581')?.fileNum).toBe(2014732);
  });

  it('drops implausible amounts and rows without a support/oppose flag', () => {
    const { kept, stats } = dedupeIndependentExpenditures([
      ie({ amountCents: 900_000_000_000, tranId: 'bogus' }),
      ie({ supportOppose: '', tranId: 'x' }),
      ie({ tranId: 'ok' }),
    ]);
    expect(kept.map((r) => r.tranId)).toEqual(['ok']);
    expect(stats).toMatchObject({ implausibleAmount: 1, invalidSupportOppose: 1 });
  });
});

const totals = (candidateId: string, receipts: number): TotalsRecord => ({
  kind: 'totals',
  candidateId,
  totalReceiptsCents: receipts,
  individualCents: 0,
  otherCommitteeCents: 0,
  partyCents: 0,
  candidateSelfCents: 0,
  totalDisbursementsCents: 0,
  cashOnHandCents: 0,
  debtsCents: 0,
  coverageEndDate: null,
});

describe('identity joins: several FEC ids per person', () => {
  const personByFec = new Map([
    ['H0KY06104', 1],
    ['S6KY00286', 1],
    ['H2TN06030', 2],
    ['S8TN00337', 2],
    ['H2WY00166', 3],
    ['S6WY00209', 3],
  ]);
  const ctx = {
    cycle: 2026,
    electionYear: new Map<string, number | null>([
      ['H0KY06104', 2026],
      ['S6KY00286', 2026],
      ['H2TN06030', 2018],
      ['S8TN00337', 2030],
      ['H2WY00166', 2026],
      ['S6WY00209', 2026],
    ]),
    currentChamber: new Map([
      [1, 'house'],
      [2, 'senate'],
      [3, 'house'],
    ]),
  };

  it('attributes one totals row per person: on-ballot id, then receipts, then current chamber', () => {
    const { attributed, personsWithSeveral } = attributeTotals(
      [
        totals('H0KY06104', 991_644_221),
        totals('S6KY00286', 998_104_448), // Barr: both on the 2026 ballot; Senate raised more
        totals('H2TN06030', 308_769_015),
        totals('S8TN00337', 308_769_015), // Blackburn: identical weball rows; neither on ballot
        totals('H2WY00166', 243_502_254),
        totals('S6WY00209', 243_502_254), // Hageman: identical and both on ballot
      ],
      personByFec,
      ctx,
    );
    expect([...attributed.keys()].sort()).toEqual(['H2WY00166', 'S6KY00286', 'S8TN00337']);
    expect(personsWithSeveral).toBe(3);
  });

  it('resolves a blank pas2 CAND_ID through the recipient committee, never through a joint one', () => {
    const links = new Map([
      ['C00467571', new Set(['S6KY00286'])],
      ['C00999999', new Set(['H1', 'H2'])],
    ]);
    const cm = new Map([['C00111111', 'H6TX19099']]);
    expect(resolveRecipient({ candidateId: null, otherId: 'C00467571' }, links, cm)).toEqual({
      candidateId: 'S6KY00286',
      viaCommittee: true,
    });
    expect(
      resolveRecipient({ candidateId: null, otherId: 'C00111111' }, links, cm)?.candidateId,
    ).toBe('H6TX19099');
    expect(resolveRecipient({ candidateId: null, otherId: 'C00999999' }, links, cm)).toBeNull();
    expect(resolveRecipient({ candidateId: 'H1', otherId: null }, links, cm)?.viaCommittee).toBe(
      false,
    );
  });
});

describe('congress-legislators terms', () => {
  const base = {
    id: { bioguide: 'V000133' },
    name: { first: 'Jefferson', last: 'Van Drew' },
  };

  it('splits a term at a mid-term party switch so each vote date resolves one party', () => {
    const record = toRecord({
      ...base,
      terms: [
        {
          type: 'rep',
          start: '2019-01-03',
          end: '2021-01-03',
          state: 'NJ',
          district: 2,
          party: 'Republican',
          party_affiliations: [
            { start: '2019-01-03', end: '2019-12-18', party: 'Democrat' },
            { start: '2019-12-19', end: '2021-01-03', party: 'Republican' },
          ],
        },
      ],
    });
    expect(record.terms.map((t) => [t.party, t.start, t.end])).toEqual([
      ['Democrat', '2019-01-03', '2019-12-18'],
      ['Republican', '2019-12-19', '2021-01-03'],
    ]);
    expect(record.partySplits).toBe(1);
  });

  it('normalizes district encodings: at-large 0 stays 0, unknown -1 and Senate become null', () => {
    const record = toRecord({
      ...base,
      terms: [
        { type: 'rep', start: '2023-01-03', state: 'WY', district: 0, party: 'Republican' },
        { type: 'rep', start: '1789-03-04', state: 'PA', district: -1 },
        { type: 'sen', start: '2025-01-03', state: 'WY', party: 'Republican' },
      ],
    });
    expect(record.terms.map((t) => [t.chamber, t.district, t.party])).toEqual([
      ['house', 0, 'Republican'],
      ['house', null, 'Unknown'],
      ['senate', null, 'Republican'],
    ]);
    expect(record.termsWithoutParty).toBe(1);
  });
});

describe('Voteview cast codes', () => {
  it('maps recorded votes and treats paired/announced as not voting', () => {
    expect(positionForCastCode(1)).toEqual({ position: 'yea', pairedOrAnnounced: false });
    expect(positionForCastCode(6)?.position).toBe('nay');
    expect(positionForCastCode(7)?.position).toBe('present');
    expect(positionForCastCode(9)?.position).toBe('not_voting');
    for (const code of [2, 3, 4, 5]) {
      expect(positionForCastCode(code)).toEqual({
        position: 'not_voting',
        pairedOrAnnounced: true,
      });
    }
    expect(positionForCastCode(0)).toBeNull();
    expect(() => positionForCastCode(11)).toThrow(/cast_code/);
  });
});

describe('final passage questions', () => {
  it.each([
    'On Passage',
    'On Motion to Suspend the Rules and Pass, as Amended',
    'On Agreeing to the Resolution',
    'On Motion to Concur in the Senate Amendment',
    'Passage, Objections of the President To The Contrary Notwithstanding',
    'On Passage of the Bill',
    'On the Joint Resolution',
    'On the Conference Report',
  ])('"%s" is final passage', (q) => expect(isFinalPassageQuestion(q)).toBe(true));

  it.each([
    'On Motion to Recommit',
    'On the Cloture Motion',
    'On the Motion to Proceed',
    'On the Amendment',
    'On Ordering the Previous Question',
    'On the Nomination',
  ])('"%s" is not', (q) => expect(isFinalPassageQuestion(q)).toBe(false));
});

describe('industry coding', () => {
  const committee = (over: Partial<CommitteeFacts>): CommitteeFacts => ({
    id: 1,
    fecCommitteeId: 'C00000001',
    name: 'EXAMPLE PAC',
    connectedOrganization: null,
    organizationType: null,
    designation: 'B',
    committeeType: 'Q',
    ...over,
  });
  const rule = (
    key: string,
    industry: string,
    field: 'org_type' | 'designation' | 'any_name',
    terms: string[],
  ) => ({
    key,
    industry,
    field,
    terms: field === 'any_name' ? terms.map(normalizeName) : terms,
    confidence: 0.7,
  });

  it('applies explicit entries first, then rules in order, matching whole words only', () => {
    const rules = [
      rule('codes#labor', 'labor-unions', 'org_type', ['L']),
      rule('codes#leadership', 'leadership-pacs', 'designation', ['D']),
      rule('names#banks', 'banking', 'any_name', ['BANK', 'BANKERS']),
    ];
    const codings = codeCommittees(
      [
        committee({ id: 1, name: 'AMERICAN BANKERS ASSOCIATION PAC' }),
        committee({ id: 2, name: 'BANKSIDE FRIENDS PAC' }),
        committee({ id: 3, name: 'CREDIT WORKERS PAC', organizationType: 'L' }),
        committee({ id: 4, name: 'BANK LEADERSHIP FUND', designation: 'D' }),
        committee({ id: 5, fecCommitteeId: 'C00000005', name: 'TD BANK PAC' }),
      ],
      [
        {
          key: 'curated#C00000005',
          fecCommitteeId: 'C00000005',
          industry: 'curated-one',
          method: 'curated',
          confidence: 1,
        },
      ],
      rules,
    );
    expect(codings.map((c) => [c.committeeId, c.industryId, c.method])).toEqual([
      [1, 'banking', 'name_rule'],
      [3, 'labor-unions', 'fec_code'],
      [4, 'leadership-pacs', 'fec_code'],
      [5, 'curated-one', 'curated'],
    ]);
  });

  it('reads & as AND and reports a connected-organization match as such', () => {
    const codings = codeCommittees(
      [committee({ name: 'EMPLOYEES PAC', connectedOrganization: 'AT&T INC.' })],
      [],
      [rule('names#telecom', 'telecommunications', 'any_name', ['AT AND T'])],
    );
    expect(codings[0]).toMatchObject({ industryId: 'telecommunications', method: 'connected_org' });
  });
});
