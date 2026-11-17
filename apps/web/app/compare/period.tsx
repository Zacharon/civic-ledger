import type { CapabilityOutput } from '@civic-ledger/core';
import { type ComparePeriod, congressLabel } from '@/lib/compare-list';
import type { ColumnGroupId, ExploreRow } from '@/lib/explore-columns';
import { formatDate } from '@/lib/format';

export type Comparison = CapabilityOutput<'people.compare'>;
type PeriodValues = Comparison['periodValues'][number];

/**
 * The card with the money, vote and DW-NOMINATE fields replaced by the values for the
 * selected period, so the shared metric cells draw (and `data-value` carries) exactly what
 * people.compare returned for that period. With no period chosen this equals the card.
 */
export function periodRow(card: Comparison['people'][number], values?: PeriodValues): ExploreRow {
  if (!values) return card;
  const { money, ideology, votes } = values;
  return {
    ...card,
    moneyCycle: money.cycle,
    totalReceiptsCents: money.totalReceiptsCents,
    pacShare: money.pacShare,
    smallDollarShare: money.smallDollarShare,
    smallDollarAsOf: money.smallDollarAsOf,
    topIndustries: money.topIndustries ?? [],
    industryCodingCoverage: money.industryCodingCoverage,
    outsideSupportCents: money.outsideSupportCents,
    outsideOpposeCents: money.outsideOpposeCents,
    ideologyCongress: ideology.congress,
    dwNominateDim1: ideology.dim1,
    dwNominateDim2: ideology.dim2,
    votesEligible: votes.votesEligible,
    missedVoteRate: votes.missedVoteRate,
  };
}

/** Groups whose values depend on the period; each gets a "Period" row. */
export const PERIOD_GROUPS = new Set<ColumnGroupId>(['money', 'votes', 'ideology']);

/** The period behind one member's values in one group, as lines of text plus its data. */
export function periodCell(
  group: ColumnGroupId,
  values: PeriodValues,
): { lines: string[]; value: unknown } {
  if (group === 'money') {
    const m = values.money;
    const value = {
      status: m.status,
      cycle: m.cycle,
      coverageEndDate: m.coverageEndDate,
      smallDollarAsOf: m.smallDollarAsOf,
    };
    if (m.status === 'unavailable') {
      return {
        lines: [m.cycle === null ? 'No FEC totals on record' : `No FEC totals for ${m.cycle}`],
        value,
      };
    }
    const lines = [`${m.cycle} FEC cycle`];
    const totals = formatDate(m.coverageEndDate);
    if (totals) lines.push(`Totals through ${totals}`);
    const small = formatDate(m.smallDollarAsOf);
    if (small) lines.push(`Small donors through ${small}`);
    return { lines, value };
  }
  const v = group === 'votes' ? values.votes : values.ideology;
  const value = { status: v.status, congress: v.congress };
  const noun = group === 'votes' ? 'recorded votes' : 'DW-NOMINATE estimate';
  if (v.status === 'unavailable') {
    return {
      lines: [v.congress === null ? `No ${noun}` : `No ${noun} in the ${congressLabel(v.congress)}`],
      value,
    };
  }
  return { lines: v.congress === null ? [] : [congressLabel(v.congress)], value };
}

/** "Votes: the 118th Congress (Mar 1, 2023 – Jul 1, 2023). Money: 2022 FEC cycle." */
export function periodSummary(period: Comparison['period']): string {
  const v = period.votes;
  const first = formatDate(v.firstVoteDate);
  const last = formatDate(v.lastVoteDate);
  const range = first && last ? ` (${first} – ${last})` : ' (no roll calls loaded)';
  const votes =
    v.basis === 'congress' && v.congress !== null
      ? `Votes and DW-NOMINATE: the ${congressLabel(v.congress)}${range}.`
      : `Votes: all loaded history${range}; missed votes and DW-NOMINATE from each member’s latest Congress.`;
  const money =
    period.money.basis === 'cycle' && period.money.cycle !== null
      ? `Money: the ${period.money.cycle} FEC cycle.`
      : 'Money: each member’s latest FEC cycle, which can differ.';
  return `${votes} ${money}`;
}

/**
 * GET form, so choosing a period works before hydration and without JavaScript. Empty
 * values mean the v1 defaults.
 */
export function PeriodForm({
  ids,
  period,
  available,
}: {
  ids: readonly string[];
  period: ComparePeriod;
  available: Comparison['availablePeriods'];
}) {
  const congresses = withSelected(available.congresses, period.congress);
  const cycles = withSelected(available.cycles, period.cycle);
  return (
    <form
      action="/compare"
      method="get"
      aria-label="Comparison period"
      className="mt-6 flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="ids" value={ids.join(',')} />
      <div className="flex min-w-0 flex-col gap-1.5 max-sm:w-full">
        <label htmlFor="compare-congress" className="text-sm font-semibold">
          Votes and DW-NOMINATE
        </label>
        <select
          id="compare-congress"
          name="congress"
          defaultValue={period.congress ?? ''}
          className="field w-full min-w-0 sm:w-64"
        >
          <option value="">All loaded history</option>
          {congresses.map((c) => (
            <option key={c} value={c}>
              {congressLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 max-sm:w-full">
        <label htmlFor="compare-cycle" className="text-sm font-semibold">
          Money
        </label>
        <select
          id="compare-cycle"
          name="cycle"
          defaultValue={period.cycle ?? ''}
          className="field w-full min-w-0 sm:w-64"
        >
          <option value="">Each member’s latest FEC cycle</option>
          {cycles.map((c) => (
            <option key={c} value={c}>
              {c} FEC cycle
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn btn-secondary max-sm:w-full">
        Show period
      </button>
    </form>
  );
}

/** A period given in the URL stays selectable even when no member has data for it. */
function withSelected(values: readonly number[], selected: number | null): number[] {
  return selected === null || values.includes(selected)
    ? [...values]
    : [...values, selected].sort((x, y) => y - x);
}
