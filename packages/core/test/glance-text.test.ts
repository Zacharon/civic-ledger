import { describe, expect, it } from 'vitest';
import {
  buildGlance,
  type GlanceFacts,
  moneyParagraph,
  sayParagraph,
  votesParagraph,
  whoParagraph,
} from '../src/glance/text';

const provenance = {
  sourceId: 'dev-seed',
  sourceKey: 'fixture:1',
  ingestRunId: 1,
  retrievedAt: '2026-10-01T00:00:00.000Z',
};
const who: GlanceFacts['who'] = {
  fullName: 'Avery Ashvale',
  isCurrent: true,
  chamber: 'senate',
  state: 'ZV',
  district: null,
  party: 'Harbor Party',
  termStart: '2023-01-03',
  termEnd: '2029-01-03',
  serviceStart: '2011-01-05',
  tenureYears: 15.7,
  termsServed: 4,
  provenance,
};
const money: NonNullable<GlanceFacts['money']> = {
  cycle: 2026,
  totalReceiptsCents: 421_000_000,
  coverageEndDate: '2026-06-30',
  pacShare: 0.34,
  smallDollarShare: 0.12,
  smallDollarAsOf: '2026-03-31',
  largerIndividualShare: 0.5,
  topIndustries: [{ id: 'health', name: 'Health', amountCents: 20_000_000 }],
  industryCodingCoverage: 0.8,
  hasPacContributions: true,
  outsideSupportCents: 1_500_000,
  outsideOpposeCents: 0,
  outsideItems: 1,
  provenance,
  smallDollarProvenance: { ...provenance, sourceKey: 'summary:1' },
};
const votes: GlanceFacts['votes'] = {
  congress: 119,
  votesEligible: 412,
  votesMissed: 9,
  missedVoteRate: 9 / 412,
  provenance,
  dwNominate: { congress: 118, dim1: 0.41, dim2: -0.1, provenance },
};
const say: GlanceFacts['say'] = {
  platformPositions: 2,
  platformCycle: 2026,
  promises: 3,
  promisesRated: 2,
  promisesKept: 1,
  provenance,
  positions: [
    {
      cycle: 2024,
      policyArea: 'Health',
      stance: 'Supports a reviewed fictional proposal.',
      sourceUrl: 'https://example.org/positions',
      provenance,
    },
  ],
};
const text = (paragraph: { sentences: { text: string }[] }) =>
  paragraph.sentences.map((sentence) => sentence.text).join(' ');
describe('deterministic glance wording', () => {
  it('states current or former service and identifies at-large seats without implying continuous tenure', () => {
    expect(text(whoParagraph(who))).toContain('serves as Senator for ZV');
    expect(text(whoParagraph(who))).toContain('First recorded congressional service began in 2011');
    expect(
      text(whoParagraph({ ...who, isCurrent: false, chamber: 'house', district: 0 })),
    ).toContain('last served as Representative for ZV at-large');
    expect(text(whoParagraph({ ...who, isCurrent: false }))).toContain('last recorded term ended');
  });
  it('keeps distinct FEC reporting periods and actual itemization categories visible', () => {
    const result = moneyParagraph(money, who.fullName);
    expect(text(result)).toContain('FEC filings through Jun 30, 2026');
    expect(text(result)).toContain('candidate summary through Mar 31, 2026');
    expect(text(result)).toContain('should not be added to the PAC share');
    expect(text(result)).toContain('itemized individual contributions');
    expect(text(result)).not.toContain('larger individual gifts');
    expect(
      result.sentences.find((s) => s.id === 'money.individualShares')?.provenance?.sourceKey,
    ).toBe('summary:1');
    expect(text(result)).toContain('not personal pay');
    expect(text(result)).toContain('do not establish why a member voted');
    expect(result.title).toBe('Campaign financing');
  });
  it('distinguishes no loaded money, absent shares and no outside records from a factual zero', () => {
    expect(text(moneyParagraph(null, who.fullName))).toContain(
      'Missing coverage does not mean no fundraising',
    );
    const sparse = moneyParagraph(
      {
        ...money,
        pacShare: null,
        smallDollarShare: null,
        smallDollarAsOf: null,
        smallDollarProvenance: null,
        largerIndividualShare: null,
        hasPacContributions: false,
        outsideItems: 0,
        outsideSupportCents: 0,
        topIndustries: [],
      },
      who.fullName,
    );
    expect(text(sparse)).toContain('No computable share');
    expect(text(sparse)).toContain('No data from unitemized');
    expect(text(sparse)).toContain('does not establish that no outside spending occurred');
    expect(sparse.sentences.find((s) => s.id === 'money.individualShares')?.provenance).toBeNull();
  });
  it('describes net industry amounts and gross coverage without claiming uncoded money when coverage is unknown', () => {
    expect(text(moneyParagraph(money, 'x'))).toContain('Health ($200K)');
    expect(text(moneyParagraph(money, 'x'))).toContain(
      '80% of positive itemized committee dollars before refunds',
    );
    expect(
      text(moneyParagraph({ ...money, topIndustries: [], industryCodingCoverage: 1 }, 'x')),
    ).toContain('No coded industry has a positive net contribution total');
  });
  it('keeps participation and ideology Congresses distinct and avoids inventing reasons for absences', () => {
    const result = text(votesParagraph(votes));
    expect(result).toContain('412 recorded roll calls in the 119th Congress');
    expect(result).toContain('on its first dimension for the 118th Congress');
    expect(result).toContain('does not explain absences');
    expect(result).not.toContain('median');
    expect(result).toContain('not motives or a complete set of beliefs');
  });
  it('labels missing votes and estimates without diagnosing the cause', () => {
    const result = text(
      votesParagraph({
        congress: null,
        votesEligible: null,
        votesMissed: null,
        missedVoteRate: null,
        provenance: null,
        dwNominate: null,
      }),
    );
    expect(result).toContain('No roll-call votes are loaded');
    expect(result).toContain('Missing coverage is not a political classification');
    expect(result).not.toContain('enough');
  });
  it('counts all platform cycles honestly and preserves the actual reviewed entry and source', () => {
    const result = sayParagraph(say);
    expect(text(result)).toContain('2 reviewed platform positions across loaded campaigns');
    expect(text(result)).toContain('latest campaign cycle 2026');
    expect(text(result)).toContain('Health (2024)');
    expect(text(result)).toContain(say.positions[0]?.stance);
    expect(result.sentences[1]?.evidenceHref).toBe('https://example.org/positions');
    expect(result.sentences[1]?.provenance).toEqual(provenance);
    expect(
      text(sayParagraph({ ...say, platformPositions: 0, promises: 0, positions: [] })),
    ).toContain('coverage gap');
  });
  it('every raw value resolves to the exposed facts and every sentence equals its parts, with repeatable output', () => {
    const facts: GlanceFacts = { who, money, votes, say };
    const result = buildGlance(facts);
    expect(result).toEqual(buildGlance(facts));
    expect(result.map((p) => p.id)).toEqual(['who', 'money', 'votes', 'say']);
    for (const sentence of result.flatMap((p) => p.sentences)) {
      expect(sentence.text).toBe(sentence.parts.map((p) => p.text).join(''));
      for (const part of sentence.parts) {
        if (part.kind !== 'value') continue;
        const value = part.fact
          .split('.')
          .reduce<unknown>(
            (entry, key) =>
              entry !== null && typeof entry === 'object'
                ? (entry as Record<string, unknown>)[key]
                : undefined,
            facts,
          );
        expect(value, part.fact).toEqual(part.value);
      }
    }
  });
});
