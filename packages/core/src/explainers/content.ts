/**
 * Plain-language explainers served by `explainers.list@1` and rendered on /methodology.
 * Static, reviewed content: each explains a term the ledger uses, in neutral prose, and
 * cites the authoritative source. Never characterizes a person; describes methods only.
 */
export interface Explainer {
  /** Stable id, also the anchor on /methodology (`#explainer-<id>`). */
  id: string;
  question: string;
  /** Plain-text paragraphs, no markup. */
  answer: readonly string[];
  source: { name: string; url: string };
  /** Which ledger figures this term appears in. */
  appearsIn: readonly string[];
}

export const EXPLAINERS: readonly Explainer[] = [
  {
    id: 'pac',
    question: 'What is a PAC?',
    answer: [
      'A political action committee (PAC) raises and spends money for political activity. PACs have different structures: some give to candidate campaigns, while super PACs make independent expenditures rather than direct candidate contributions.',
      'The ledger uses the FEC category "PACs and other committees" for committee contributions received by a campaign; party contributions have a separate field. The share is other-committee contributions divided by total receipts. This is campaign financing, not personal income, and it does not establish a motive for a vote.',
    ],
    source: {
      name: 'FEC: Political action committees (PACs)',
      url: 'https://www.fec.gov/help-candidates-and-committees/registering-pac/',
    },
    appearsIn: ['From PACs', 'Where the money came from', 'At a glance'],
  },
  {
    id: 'small-dollar',
    question: 'What are small-dollar donors?',
    answer: [
      'The ledger uses "small donors" as shorthand for unitemized individual contributions. Campaigns generally identify contributors whose aggregate giving exceeds $200 during an election cycle, and some voluntarily itemize smaller contributions. Unitemized receipts are therefore a proxy, not a complete count of small donors or small gifts.',
      'The share is unitemized individual contributions divided by total receipts, both taken from the FEC candidate summary for the same filing period. That file can cover a shorter period than the cycle totals, so the share is labeled with its own end date.',
    ],
    source: {
      name: 'FEC: Individual contributions to federal candidates and committees',
      url: 'https://www.fec.gov/updates/individual-contributions-federal-candidates-and-committees/',
    },
    appearsIn: ['Small donors', 'At a glance'],
  },
  {
    id: 'dw-nominate',
    question: 'What is DW-NOMINATE?',
    answer: [
      "DW-NOMINATE is an academic method, published by Voteview, that estimates each member's position from roll-call votes alone. It places members on a scale from about −1 to +1 on a first dimension, where the method labels lower values liberal and higher values conservative; a second dimension captures voting patterns the first does not, and its meaning varies by era.",
      "It measures how a member voted relative to others, not motives or views. The ledger shows it as a position on a labeled axis beside the chamber's range, never as a color and never as a default sort.",
    ],
    source: {
      name: 'Voteview: About the data',
      url: 'https://voteview.com/about',
    },
    appearsIn: ['DW-NOMINATE', 'Scores', 'At a glance'],
  },
  {
    id: 'outside-spending',
    question: 'What is outside spending?',
    answer: [
      "Outside spending is money spent by a committee or person other than the candidate's own campaign to support or oppose that candidate, without coordinating with the campaign. The FEC calls these independent expenditures; the spender reports them, naming the candidate and whether the spending supported or opposed them.",
      'The ledger sums independent expenditures reported for and against each member in the cycle shown. It does not include party coordinated spending or issue advertising that names no candidate.',
    ],
    source: {
      name: 'FEC: Independent expenditures',
      url: 'https://www.fec.gov/help-candidates-and-committees/making-independent-expenditures/',
    },
    appearsIn: ['Outside, for', 'Outside, against', 'At a glance'],
  },
  {
    id: 'roll-call',
    question: 'What is a roll call?',
    answer: [
      "A roll call records individual members' positions in the House or Senate. The ledger groups them as yea, nay, present or not voting. Actions decided without a recorded individual vote cannot establish how a particular member voted.",
      'The ledger\'s vote counts come from Voteview, which compiles every roll call from the official House and Senate records. "Missed votes" is the share of a member\'s roll calls recorded as not voting in their latest Congress with votes.',
    ],
    source: {
      name: 'Congress.gov: Roll call votes',
      url: 'https://www.congress.gov/roll-call-votes',
    },
    appearsIn: ['Missed votes', 'Roll calls', 'Votes', 'At a glance'],
  },
  {
    id: 'framework',
    question: 'What is a framework?',
    answer: [
      'A framework is a list of roll calls or bills together with the position its author considers aligned. Evaluating a framework reports "aligned X of Y" for each member: Y counts the framework\'s roll calls on which the member voted yea or nay, X those matching the author\'s position. Present and not-voting positions are listed but not counted.',
      "A framework is one author's view, not a neutral score. The ledger shows the author, the rules and every roll call behind the number so anyone can check it or build a different one.",
    ],
    source: {
      name: 'Civic Ledger methodology: Frameworks',
      url: '/methodology#frameworks',
    },
    appearsIn: ['Frameworks'],
  },
  {
    id: 'industry-coding',
    question: 'How industry coding works',
    answer: [
      'The FEC records which committee gave money, not what industry it represents. The ledger assigns committees to industries using a reviewed map kept in the public repository; each assignment records its method and confidence. A committee without a reviewed assignment stays "not coded".',
      'Every industry breakdown states its coverage: the share of PAC dollars, before refunds, that are coded. Industry shares use the same gross dollars; amounts after refunds are shown beside them.',
    ],
    source: {
      name: 'Civic Ledger methodology: Industry coding',
      url: '/methodology#industry-coding',
    },
    appearsIn: ['Top industries', 'Coded', 'At a glance'],
  },
  {
    id: 'not-coded',
    question: 'What "not coded" means',
    answer: [
      '"Not coded" marks PAC money from committees the industry map has not yet assigned. It is a gap in the ledger\'s coding, not a statement about the money or the member. Not-coded dollars are reported as their own line and are never folded into an industry or an "other" bucket.',
      'More generally, the ledger prints "No data" when a source has nothing for a member, "Not scored" when a publisher has not scored them and "Not yet rated" for promises without a verdict. A blank is never shown as zero.',
    ],
    source: {
      name: 'Civic Ledger methodology: Missing data',
      url: '/methodology#missing-data',
    },
    appearsIn: ['Top industries', 'Coded', 'At a glance'],
  },
];

export type ExplainerId = (typeof EXPLAINERS)[number]['id'];

export function explainerById(id: string): Explainer | undefined {
  return EXPLAINERS.find((e) => e.id === id);
}
