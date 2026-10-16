import type { CapabilityOutput, EXPLORE_SORT_COLUMNS } from '@civic-ledger/core';

/** Client-safe: only types come from core, so no database code reaches the browser. */

export type ExploreRow = CapabilityOutput<'explore.table'>['rows'][number];
export type ScorecardColumn = CapabilityOutput<'explore.table'>['scorecardColumns'][number];
export type CoreSortColumn = keyof typeof EXPLORE_SORT_COLUMNS;
/** People with a value per field, from explore.facets (`withData`). */
export type FieldCoverage = CapabilityOutput<'explore.facets'>['withData'];

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
  /** Field whose explore.facets coverage decides whether the column has any data. */
  dataField?: keyof FieldCoverage;
  /** People in the current scope with a value; undefined = not measured. */
  withData?: number;
  /** Only for scorecard columns. */
  scorecard?: ScorecardColumn;
}

type FixedColumn = Omit<ColumnDef, 'sortKey' | 'scorecard'> & { sortKey?: CoreSortColumn };

/** Fixed metric columns. Identity columns (name, party, seat) are always shown. */
export const FIXED_COLUMNS: readonly FixedColumn[] = [
  {
    id: 'tenure',
    dataField: 'tenureYears',
    group: 'office',
    label: 'Years in office',
    header: 'Tenure',
    description: 'Years actually served in Congress, across all terms in either chamber.',
    kind: 'years',
    sortKey: 'tenureYears',
    firstDirection: 'desc',
    defaultVisible: false,
  },
  {
    id: 'total',
    dataField: 'totalReceiptsCents',
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
    dataField: 'pacShare',
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
    dataField: 'smallDollarShare',
    group: 'money',
    label: 'Share from small-dollar donors',
    header: 'Small donors',
    description:
      'Unitemized individual contributions (donors giving $200 or less) as a share of total receipts, both from the FEC candidate summary, whose period can end before the Raised total’s.',
    kind: 'share',
    sortKey: 'smallDollarShare',
    firstDirection: 'desc',
    defaultVisible: true,
  },
  {
    id: 'industries',
    dataField: 'industryCodingCoverage',
    group: 'money',
    label: 'Top industries by PAC money',
    header: 'Top industries',
    description:
      'Largest industries by PAC money kept after refunds, by in-house coding (up to three).',
    kind: 'industries',
    firstDirection: 'desc',
    defaultVisible: false,
  },
  {
    id: 'coverage',
    dataField: 'industryCodingCoverage',
    group: 'money',
    label: 'Industry coding coverage',
    header: 'Coded',
    description:
      'Share of PAC dollars (before refunds) assigned to an industry. The rest is “not coded”.',
    kind: 'share',
    sortKey: 'industryCodingCoverage',
    firstDirection: 'desc',
    defaultVisible: false,
  },
  {
    id: 'outsideFor',
    dataField: 'outsideSupportCents',
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
    dataField: 'outsideOpposeCents',
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
    dataField: 'missedVoteRate',
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
    dataField: 'votesEligible',
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
    dataField: 'dwNominateDim1',
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
    dataField: 'dwNominateDim2',
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
    dataField: 'promiseKeptRate',
    group: 'promises',
    label: 'Promises kept',
    header: 'Promises kept',
    description: 'Kept promises as a share of rated promises (kept, compromise or broken).',
    kind: 'share',
    sortKey: 'promiseKeptRate',
    firstDirection: 'desc',
    defaultVisible: true,
  },
  {
    id: 'rated',
    dataField: 'promisesRated',
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

/**
 * Every column available for this dataset, in display order. With `coverage`, a column
 * no one in the scope has data for is hidden by default (a whole column of "No data"
 * says nothing) but stays available in the column picker.
 */
export function allColumns(
  scorecards: readonly ScorecardColumn[],
  coverage?: FieldCoverage,
): ColumnDef[] {
  const fixed = FIXED_COLUMNS.map((c): ColumnDef => {
    const withData = c.dataField && coverage ? coverage[c.dataField] : undefined;
    return withData === undefined
      ? { ...c }
      : { ...c, withData, defaultVisible: c.defaultVisible && withData > 0 };
  });
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
  coverage?: FieldCoverage,
): ColumnDef[] {
  const all = allColumns(scorecards, coverage);
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
