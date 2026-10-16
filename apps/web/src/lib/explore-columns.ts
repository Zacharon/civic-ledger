import type { CapabilityOutput, EXPLORE_SORT_COLUMNS } from '@civic-ledger/core';

/** Client-safe: only types come from core, so no database code reaches the browser. */

export type ExploreRow = CapabilityOutput<'explore.table'>['rows'][number];
export type ScorecardColumn = CapabilityOutput<'explore.table'>['scorecardColumns'][number];
export type CoreSortColumn = keyof typeof EXPLORE_SORT_COLUMNS;

export const COLUMN_GROUPS = [
  { id: 'office', label: 'Office' },
  { id: 'money', label: 'Money' },
  { id: 'votes', label: 'Votes' },
  { id: 'ideology', label: 'Ideology' },
  { id: 'scorecards', label: 'Scorecards' },
  { id: 'promises', label: 'Promises' },
] as const;
export type ColumnGroupId = (typeof COLUMN_GROUPS)[number]['id'];

export type CellKind =
  | 'cents'
  | 'share'
  | 'signed'
  | 'years'
  | 'count'
  | 'industries'
  | 'scorecard';

export interface ColumnDef {
  id: string;
  group: ColumnGroupId;
  label: string;
  /** Short header text; `label` is the accessible name. */
  header: string;
  description: string;
  kind: CellKind;
  /** Core sort key; undefined = not sortable. */
  sortKey?: string;
  /** Direction a first click sorts in: numbers read largest first. */
  firstDirection: 'asc' | 'desc';
  defaultVisible: boolean;
  /** Only for scorecard columns. */
  scorecard?: ScorecardColumn;
}

type FixedColumn = Omit<ColumnDef, 'sortKey' | 'scorecard'> & { sortKey?: CoreSortColumn };

/** Fixed metric columns. Identity columns (name, party, seat) are always shown. */
export const FIXED_COLUMNS: readonly FixedColumn[] = [
  {
    id: 'tenure',
    group: 'office',
    label: 'Years in office',
    header: 'Tenure',
    description: 'Years since the member’s first term began, in either chamber.',
    kind: 'years',
    sortKey: 'tenureYears',
    firstDirection: 'desc',
    defaultVisible: false,
  },
  {
    id: 'total',
    group: 'money',
    label: 'Total raised',
    header: 'Raised',
    description: 'Total receipts reported to the FEC for the latest cycle.',
    kind: 'cents',
    sortKey: 'totalReceiptsCents',
    firstDirection: 'desc',
    defaultVisible: true,
  },
  {
    id: 'pac',
    group: 'money',
    label: 'Share from PACs and other committees',
    header: 'From PACs',
    description: 'Contributions from PACs and other committees as a share of total receipts.',
    kind: 'share',
    sortKey: 'pacShare',
    firstDirection: 'desc',
    defaultVisible: true,
  },
  {
    id: 'small',
    group: 'money',
    label: 'Share from small-dollar donors',
    header: 'Small donors',
    description:
      'Unitemized individual contributions (under $200 per donor) as a share of total receipts.',
    kind: 'share',
    sortKey: 'smallDollarShare',
    firstDirection: 'desc',
    defaultVisible: true,
  },
  {
    id: 'industries',
    group: 'money',
    label: 'Top industries by PAC money',
    header: 'Top industries',
    description: 'Largest industries among PAC contributions, by in-house coding.',
    kind: 'industries',
    firstDirection: 'desc',
    defaultVisible: false,
  },
  {
    id: 'coverage',
    group: 'money',
    label: 'Industry coding coverage',
    header: 'Coded',
    description: 'Share of PAC dollars assigned to an industry. The rest is “not coded”.',
    kind: 'share',
    sortKey: 'industryCodingCoverage',
    firstDirection: 'desc',
    defaultVisible: false,
  },
  {
    id: 'outsideFor',
    group: 'money',
    label: 'Outside spending for',
    header: 'Outside, for',
    description: 'Independent expenditures supporting this member.',
    kind: 'cents',
    sortKey: 'outsideSupportCents',
    firstDirection: 'desc',
    defaultVisible: false,
  },
  {
    id: 'outsideAgainst',
    group: 'money',
    label: 'Outside spending against',
    header: 'Outside, against',
    description: 'Independent expenditures opposing this member.',
    kind: 'cents',
    sortKey: 'outsideOpposeCents',
    firstDirection: 'desc',
    defaultVisible: false,
  },
  {
    id: 'missed',
    group: 'votes',
    label: 'Missed votes',
    header: 'Missed votes',
    description:
      'Share of roll calls marked “not voting”, in the latest Congress with recorded votes.',
    kind: 'share',
    sortKey: 'missedVoteRate',
    firstDirection: 'desc',
    defaultVisible: true,
  },
  {
    id: 'eligible',
    group: 'votes',
    label: 'Roll calls eligible',
    header: 'Roll calls',
    description:
      'Roll calls with a recorded position for the member, in the latest Congress with votes.',
    kind: 'count',
    firstDirection: 'desc',
    defaultVisible: false,
  },
  {
    id: 'dim1',
    group: 'ideology',
    label: 'DW-NOMINATE first dimension',
    header: 'DW-NOMINATE',
    description:
      'Academic, roll-call based estimate (Voteview). Negative = more liberal, positive = more conservative, as the method defines them.',
    kind: 'signed',
    sortKey: 'dwNominateDim1',
    firstDirection: 'asc',
    defaultVisible: true,
  },
  {
    id: 'dim2',
    group: 'ideology',
    label: 'DW-NOMINATE second dimension',
    header: 'Dim. 2',
    description: 'Second DW-NOMINATE dimension; its meaning varies by era (see Methodology).',
    kind: 'signed',
    sortKey: 'dwNominateDim2',
    firstDirection: 'asc',
    defaultVisible: false,
  },
  {
    id: 'kept',
    group: 'promises',
    label: 'Promises kept',
    header: 'Kept',
    description: 'Kept promises as a share of rated promises (kept, compromise or broken).',
    kind: 'share',
    sortKey: 'promiseKeptRate',
    firstDirection: 'desc',
    defaultVisible: true,
  },
  {
    id: 'rated',
    group: 'promises',
    label: 'Promises rated',
    header: 'Rated',
    description: 'Promises with a kept, compromise or broken rating.',
    kind: 'count',
    firstDirection: 'desc',
    defaultVisible: false,
  },
];

export const SCORECARD_PREFIX = 'scorecard:';

export function scorecardColumnDef(scorecard: ScorecardColumn): ColumnDef {
  return {
    id: `${SCORECARD_PREFIX}${scorecard.publisherId}`,
    group: 'scorecards',
    label: `${scorecard.name} score`,
    header: scorecard.name.replace(/\s*\(.*\)\s*$/, ''),
    description: `Published by ${scorecard.name}, which describes itself as ${scorecard.selfDescribedOrientation}. Shown on the publisher's own scale.`,
    kind: 'scorecard',
    sortKey: `${SCORECARD_PREFIX}${scorecard.publisherId}`,
    firstDirection: 'desc',
    defaultVisible: true,
    scorecard,
  };
}

/** Every column available for this dataset, in display order. */
export function allColumns(scorecards: readonly ScorecardColumn[]): ColumnDef[] {
  const fixed = FIXED_COLUMNS.map((c) => ({ ...c }) satisfies ColumnDef);
  const promisesAt = fixed.findIndex((c) => c.group === 'promises');
  return [
    ...fixed.slice(0, promisesAt),
    ...scorecards.map(scorecardColumnDef),
    ...fixed.slice(promisesAt),
  ];
}

/** `cols` from the URL (null = defaults) → the visible column defs, in display order. */
export function visibleColumns(
  cols: readonly string[] | null,
  scorecards: readonly ScorecardColumn[],
): ColumnDef[] {
  const all = allColumns(scorecards);
  if (cols === null) return all.filter((c) => c.defaultVisible);
  const wanted = new Set(cols);
  return all.filter((c) => wanted.has(c.id));
}

export function columnById(id: string, scorecards: readonly ScorecardColumn[]) {
  return allColumns(scorecards).find((c) => c.id === id);
}

/** Identity sort keys (always-visible columns). */
export const IDENTITY_SORTS = {
  name: { sortKey: 'sortName', label: 'Name', firstDirection: 'asc' },
  party: { sortKey: 'party', label: 'Party', firstDirection: 'asc' },
  seat: { sortKey: 'state', label: 'State', firstDirection: 'asc' },
} as const satisfies Record<
  string,
  { sortKey: CoreSortColumn; label: string; firstDirection: 'asc' | 'desc' }
>;
