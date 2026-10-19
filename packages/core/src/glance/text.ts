import type { Provenance } from '../schemas/common';
import { compactCents, count, longDate, ordinal, percent, plural, signed, years } from './format';

/** Fixed templates over facts. No model, ideological verdict, or inference about motives. */
export type Chamber = 'house' | 'senate';
export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'value'; fact: string; value: number | string | null; text: string }
  | { kind: 'term'; explainer: string; text: string };
export interface Sentence {
  id: string;
  parts: Part[];
  text: string;
  provenance: Provenance | null;
  evidenceHref: string | null;
}
export interface Paragraph {
  id: 'who' | 'money' | 'votes' | 'say';
  title: string;
  detailHref: string;
  sentences: Sentence[];
}
export interface WhoFacts {
  fullName: string;
  isCurrent: boolean;
  chamber: Chamber | null;
  state: string | null;
  district: number | null;
  party: string | null;
  termStart: string | null;
  termEnd: string | null;
  serviceStart: string | null;
  tenureYears: number | null;
  termsServed: number;
  provenance: Provenance;
}
export interface MoneyFacts {
  cycle: number;
  totalReceiptsCents: number;
  coverageEndDate: string | null;
  pacShare: number | null;
  smallDollarShare: number | null;
  smallDollarAsOf: string | null;
  largerIndividualShare: number | null;
  topIndustries: Array<{ id: string; name: string; amountCents: number }>;
  industryCodingCoverage: number | null;
  hasPacContributions: boolean;
  outsideSupportCents: number;
  outsideOpposeCents: number;
  outsideItems: number;
  provenance: Provenance;
  smallDollarProvenance: Provenance | null;
}
export interface VotesFacts {
  congress: number | null;
  votesEligible: number | null;
  votesMissed: number | null;
  missedVoteRate: number | null;
  provenance: Provenance | null;
  dwNominate: {
    congress: number;
    dim1: number;
    dim2: number | null;
    provenance: Provenance;
  } | null;
}
export interface SayFacts {
  platformPositions: number;
  platformCycle: number | null;
  promises: number;
  promisesRated: number;
  promisesKept: number;
  provenance: Provenance | null;
  positions: Array<{
    cycle: number;
    policyArea: string;
    stance: string;
    sourceUrl: string;
    provenance: Provenance;
  }>;
}
export interface GlanceFacts {
  who: WhoFacts;
  money: MoneyFacts | null;
  votes: VotesFacts;
  say: SayFacts;
}
const t = (text: string): Part => ({ kind: 'text', text });
const v = (fact: string, value: number | string | null, text: string): Part => ({
  kind: 'value',
  fact,
  value,
  text,
});
const term = (explainer: string, text: string): Part => ({ kind: 'term', explainer, text });
function sentence(
  id: string,
  parts: Part[],
  provenance: Provenance | null = null,
  evidenceHref: string | null = null,
): Sentence {
  return { id, parts, text: parts.map((p) => p.text).join(''), provenance, evidenceHref };
}
export const chamberName = (chamber: Chamber): string =>
  chamber === 'senate' ? 'Senate' : 'House';
export function seat(chamber: Chamber | null, state: string | null, district: number | null) {
  if (!state) return null;
  if (chamber !== 'house' || district === null) return state;
  return district === 0 ? `${state} at-large` : `${state}-${district}`;
}
export function whoParagraph(who: WhoFacts): Paragraph {
  const where = seat(who.chamber, who.state, who.district);
  const role =
    who.chamber === 'senate' ? 'Senator' : who.chamber === 'house' ? 'Representative' : null;
  const parts: Part[] = [v('who.fullName', who.fullName, who.fullName)];
  if (role && where) {
    parts.push(
      t(who.isCurrent ? ' serves as ' : ' last served as '),
      v('who.chamber', who.chamber, role),
      t(' for '),
      v('who.state', who.state, who.state ?? where),
    );
    if (who.chamber === 'house' && who.district !== null)
      parts.push(
        t(who.district === 0 ? ' ' : '-'),
        v('who.district', who.district, who.district === 0 ? 'at-large' : String(who.district)),
      );
    if (who.party) parts.push(t(' ('), v('who.party', who.party, who.party), t(')'));
    parts.push(t('.'));
  } else parts.push(t(': no office on record.'));
  const sentences = [sentence('who.office', parts, who.provenance)];
  if (who.serviceStart) {
    const service: Part[] = [
      t('First recorded congressional service began in '),
      v('who.serviceStart', who.serviceStart, who.serviceStart.slice(0, 4)),
      t('; '),
      v('who.termsServed', who.termsServed, plural(who.termsServed, 'term')),
      t(' on record'),
    ];
    if (who.tenureYears !== null)
      service.push(
        t(', '),
        v('who.tenureYears', who.tenureYears, years(who.tenureYears)),
        t(' served'),
      );
    service.push(t('.'));
    sentences.push(sentence('who.service', service));
  }
  if (who.isCurrent && who.termStart)
    sentences.push(
      sentence(
        'who.term',
        [
          t('The current term began '),
          v('who.termStart', who.termStart, longDate(who.termStart)),
          t('.'),
        ],
        who.provenance,
      ),
    );
  else if (!who.isCurrent && who.termEnd)
    sentences.push(
      sentence(
        'who.term',
        [
          t('The last recorded term ended '),
          v('who.termEnd', who.termEnd, longDate(who.termEnd)),
          t('.'),
        ],
        who.provenance,
      ),
    );
  return { id: 'who', title: 'Who they are', detailHref: '#career', sentences };
}
export function moneyParagraph(money: MoneyFacts | null, fullName: string): Paragraph {
  if (!money)
    return {
      id: 'money',
      title: 'Campaign financing',
      detailHref: '#money',
      sentences: [
        sentence('money.none', [
          t('No FEC campaign totals are loaded for '),
          t(fullName),
          t('. Missing coverage does not mean no fundraising.'),
        ]),
      ],
    };
  const raised: Part[] = [
    t('Campaign receipts of '),
    v('money.totalReceiptsCents', money.totalReceiptsCents, compactCents(money.totalReceiptsCents)),
    t(' in the '),
    v('money.cycle', money.cycle, String(money.cycle)),
    t(' election cycle'),
  ];
  if (money.coverageEndDate)
    raised.push(
      t(', per FEC filings through '),
      v('money.coverageEndDate', money.coverageEndDate, longDate(money.coverageEndDate)),
    );
  else raised.push(t('; the filing end date is unavailable'));
  raised.push(t('.'));
  const sentences = [sentence('money.raised', raised, money.provenance)];
  sentences.push(
    sentence(
      'money.pacShare',
      [
        v(
          'money.pacShare',
          money.pacShare,
          money.pacShare === null ? 'No computable share' : percent(money.pacShare),
        ),
        t(' from '),
        term('pac', 'PACs and other committees'),
        t(' in those totals.'),
      ],
      money.provenance,
    ),
  );
  const donors: Part[] = [t('In the separately reported FEC candidate summary')];
  if (money.smallDollarAsOf)
    donors.push(
      t(' through '),
      v('money.smallDollarAsOf', money.smallDollarAsOf, longDate(money.smallDollarAsOf)),
    );
  else donors.push(t(' (end date unavailable)'));
  donors.push(
    t(': '),
    v(
      'money.smallDollarShare',
      money.smallDollarShare,
      money.smallDollarShare === null ? 'No data' : percent(money.smallDollarShare),
    ),
    t(' from '),
    term('small-dollar', 'unitemized individual contributions'),
  );
  if (money.largerIndividualShare !== null)
    donors.push(
      t(' and '),
      v(
        'money.largerIndividualShare',
        money.largerIndividualShare,
        percent(money.largerIndividualShare),
      ),
      t(' from itemized individual contributions'),
    );
  donors.push(
    t(
      '. Its reporting period may differ from the totals above; these shares should not be added to the PAC share.',
    ),
  );
  sentences.push(sentence('money.individualShares', donors, money.smallDollarProvenance));
  if (!money.hasPacContributions) {
    sentences.push(
      sentence('money.industries', [
        t(
          'No positive itemized committee contributions are loaded for this cycle; industry coverage is unavailable.',
        ),
      ]),
    );
  } else {
    const industries: Part[] = [];
    if (money.topIndustries.length === 0)
      industries.push(t('No coded industry has a positive net contribution total'));
    else {
      industries.push(
        t('Largest coded '),
        term('industry-coding', 'industries'),
        t(' by net committee contributions: '),
      );
      money.topIndustries.forEach((industry, i) => {
        if (i > 0) industries.push(t(i === money.topIndustries.length - 1 ? ' and ' : ', '));
        industries.push(
          v(`money.topIndustries.${i}.name`, industry.name, industry.name),
          t(' ('),
          v(
            `money.topIndustries.${i}.amountCents`,
            industry.amountCents,
            compactCents(industry.amountCents),
          ),
          t(')'),
        );
      });
    }
    industries.push(
      t('. Industry coding covers '),
      v(
        'money.industryCodingCoverage',
        money.industryCodingCoverage,
        money.industryCodingCoverage === null
          ? 'an unknown share'
          : percent(money.industryCodingCoverage),
      ),
      t(' of positive itemized committee dollars before refunds; the remainder is '),
      term('not-coded', 'not coded'),
      t('.'),
    );
    sentences.push(sentence('money.industries', industries));
  }
  if (money.outsideItems === 0)
    sentences.push(
      sentence('money.outside', [
        t('No '),
        term('outside-spending', 'outside expenditure records'),
        t(
          ' are loaded for this person and cycle. This does not establish that no outside spending occurred.',
        ),
      ]),
    );
  else
    sentences.push(
      sentence('money.outside', [
        t('Loaded '),
        term('outside-spending', 'outside expenditure records'),
        t(' total '),
        v(
          'money.outsideSupportCents',
          money.outsideSupportCents,
          compactCents(money.outsideSupportCents),
        ),
        t(' supporting and '),
        v(
          'money.outsideOpposeCents',
          money.outsideOpposeCents,
          compactCents(money.outsideOpposeCents),
        ),
        t(' opposing this candidate.'),
      ]),
    );
  sentences.push(
    sentence('money.boundary', [
      t(
        'These are campaign finances, not personal pay. Contributions and spending do not establish why a member voted a particular way.',
      ),
    ]),
  );
  return { id: 'money', title: 'Campaign financing', detailHref: '#money', sentences };
}
export function votesParagraph(votes: VotesFacts): Paragraph {
  const sentences: Sentence[] = [];
  if (votes.votesEligible === null || votes.missedVoteRate === null || votes.votesMissed === null) {
    sentences.push(
      sentence('votes.participation', [
        t('No '),
        term('roll-call', 'roll-call votes'),
        t(
          ' are loaded for this member. Missing votes do not establish their position on an issue.',
        ),
      ]),
    );
  } else {
    const parts: Part[] = [
      v('votes.votesEligible', votes.votesEligible, count(votes.votesEligible)),
      t(' recorded '),
      term('roll-call', 'roll calls'),
    ];
    if (votes.congress !== null)
      parts.push(
        t(' in the '),
        v('votes.congress', votes.congress, `${ordinal(votes.congress)} Congress`),
      );
    parts.push(
      t('; recorded as not voting on '),
      v('votes.votesMissed', votes.votesMissed, count(votes.votesMissed)),
      t(' ('),
      v('votes.missedVoteRate', votes.missedVoteRate, percent(votes.missedVoteRate)),
      t('). The record does not explain absences.'),
    );
    sentences.push(sentence('votes.participation', parts, votes.provenance));
  }
  const dw = votes.dwNominate;
  if (!dw)
    sentences.push(
      sentence('votes.estimate', [
        t('No '),
        term('dw-nominate', 'DW-NOMINATE'),
        t(' estimate is loaded. Missing coverage is not a political classification.'),
      ]),
    );
  else
    sentences.push(
      sentence(
        'votes.estimate',
        [
          t("Voteview's "),
          term('dw-nominate', 'DW-NOMINATE'),
          t(' estimate is '),
          v('votes.dwNominate.dim1', dw.dim1, signed(dw.dim1)),
          t(' on its first dimension for the '),
          v('votes.dwNominate.congress', dw.congress, `${ordinal(dw.congress)} Congress`),
          t(
            '. The method generally describes lower values as more liberal and higher values as more conservative. This describes voting patterns, not motives or a complete set of beliefs.',
          ),
        ],
        dw.provenance,
      ),
    );
  return { id: 'votes', title: 'How they vote', detailHref: '#votes', sentences };
}
export function sayParagraph(say: SayFacts): Paragraph {
  if (say.platformPositions === 0 && say.promises === 0)
    return {
      id: 'say',
      title: 'What they say',
      detailHref: '#platform',
      sentences: [
        sentence('say.none', [
          t(
            'No reviewed platform or promise entries are loaded. This is a coverage gap, not evidence that the member has no stated positions.',
          ),
        ]),
      ],
    };
  const parts: Part[] = [
    v(
      'say.platformPositions',
      say.platformPositions,
      plural(say.platformPositions, 'reviewed platform position'),
    ),
    t(' across loaded campaigns'),
  ];
  if (say.platformCycle !== null)
    parts.push(
      t('; latest campaign cycle '),
      v('say.platformCycle', say.platformCycle, String(say.platformCycle)),
    );
  parts.push(
    t('. '),
    v('say.promises', say.promises, plural(say.promises, 'tracked promise')),
    t(' ('),
    v('say.promisesRated', say.promisesRated, count(say.promisesRated)),
    t(' rated, '),
    v('say.promisesKept', say.promisesKept, count(say.promisesKept)),
    t(' kept). Entries require human review.'),
  );
  const sentences = [sentence('say.summary', parts)];
  say.positions.forEach((position, i) => {
    sentences.push(
      sentence(
        `say.position.${i}`,
        [
          t('On '),
          v(`say.positions.${i}.policyArea`, position.policyArea, position.policyArea),
          t(' ('),
          v(`say.positions.${i}.cycle`, position.cycle, String(position.cycle)),
          t('), the reviewed entry states: “'),
          v(`say.positions.${i}.stance`, position.stance, position.stance),
          t('”'),
        ],
        position.provenance,
        position.sourceUrl,
      ),
    );
  });
  return { id: 'say', title: 'What they say', detailHref: '#platform', sentences };
}
export function buildGlance(facts: GlanceFacts): Paragraph[] {
  return [
    whoParagraph(facts.who),
    moneyParagraph(facts.money, facts.who.fullName),
    votesParagraph(facts.votes),
    sayParagraph(facts.say),
  ];
}
