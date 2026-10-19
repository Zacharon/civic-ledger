import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import { PartyChip } from '@/components/party-chip';
import { profileHref } from '@/lib/compare-list';
import { COLUMN_GROUPS, type ColumnDef, type ExploreRow } from '@/lib/explore-columns';
import { type ExploreState, nextSort, type SortTerm, serializeExplore } from '@/lib/explore-params';
import { chamberLabel, formerLabel, seatLabel } from '@/lib/format';
import { MetricCell, metricValue } from './cell';

interface Props {
  rows: ExploreRow[];
  columns: ColumnDef[];
  state: ExploreState;
  sort: SortTerm[];
  caption: string;
}

const startsGroup = (columns: ColumnDef[], i: number) =>
  i === 0 || columns[i - 1]?.group !== columns[i]?.group;

/**
 * The Explore table: server-rendered, sticky header and first column. Every sortable
 * header is a link (works without JavaScript) and carries `aria-sort` when active.
 */
export function ExploreTable({ rows, columns, state, sort, caption }: Props) {
  const groups = COLUMN_GROUPS.map((g) => ({
    ...g,
    span: columns.filter((c) => c.group === g.id).length,
  })).filter((g) => g.span > 0);

  return (
    <section
      aria-labelledby="explore-caption"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard reachable (WCAG 2.1.1)
      tabIndex={0}
      className="scroll-cue relative max-h-[calc(100dvh-8rem)] overflow-auto rounded-panel border border-rule"
    >
      <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
        <caption id="explore-caption" className="sr-only">
          {caption}
        </caption>
        <thead>
          <tr className="h-8">
            <th
              colSpan={3}
              scope="colgroup"
              className="sticky top-0 left-0 z-[3] border-b border-rule bg-sunk px-3 text-left text-xs font-semibold text-ink-3"
            >
              Member
            </th>
            {groups.map((g) => (
              <th
                key={g.id}
                colSpan={g.span}
                scope="colgroup"
                className="sticky top-0 z-[2] border-b border-l border-rule bg-sunk px-3 text-left text-xs font-semibold text-ink-3"
              >
                {g.label}
              </th>
            ))}
          </tr>
          <tr>
            <SortHeader
              id="name"
              label="Name"
              firstDirection="asc"
              state={state}
              sort={sort}
              className="left-0 z-[3] min-w-52 text-left"
            />
            <SortHeader
              id="party"
              label="Party"
              firstDirection="asc"
              state={state}
              sort={sort}
              className="z-[2] text-left"
            />
            <SortHeader
              id="seat"
              label="Seat"
              accessibleLabel="State"
              firstDirection="asc"
              state={state}
              sort={sort}
              className="z-[2] text-left"
            />
            {columns.map((c, i) => (
              <SortHeader
                key={c.id}
                id={c.id}
                label={c.header}
                accessibleLabel={c.label}
                note={
                  c.scorecard
                    ? `Self-described: ${c.scorecard.selfDescribedOrientation}`
                    : undefined
                }
                description={c.description}
                firstDirection={c.firstDirection}
                sortable={c.sortKey !== undefined}
                state={state}
                sort={sort}
                className={`z-[2] text-right ${startsGroup(columns, i) ? 'border-l border-l-rule' : ''}`}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.slug} className="xt-row" data-slug={row.slug}>
              <th scope="row" className="xt-name">
                <Link
                  href={profileHref(row.slug, state.compare)}
                  className="link-quiet block max-w-64 truncate"
                  title={row.fullName}
                >
                  {row.fullName}
                </Link>
                {row.isCurrent ? null : (
                  <span className="block text-xs font-normal text-ink-3">
                    {formerLabel(row, 'Former')}
                  </span>
                )}
              </th>
              <td className="xt-cell-start">
                <PartyChip party={row.party} />
              </td>
              <td className="xt-cell-start text-ink-2">
                {seatLabel(row.chamber, row.state, row.district) ?? 'No data'}
                <span className="ml-1.5 text-xs text-ink-3">{chamberLabel(row.chamber)}</span>
              </td>
              {columns.map((c, i) => (
                <td
                  key={c.id}
                  className={startsGroup(columns, i) ? 'xt-cell xt-group' : 'xt-cell'}
                  data-column={c.id}
                  data-value={metricValue(c, row)}
                >
                  <MetricCell column={c} row={row} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SortHeader({
  id,
  label,
  accessibleLabel,
  note,
  description,
  firstDirection,
  sortable = true,
  state,
  sort,
  className,
}: {
  id: string;
  label: string;
  accessibleLabel?: string;
  note?: string;
  description?: string;
  firstDirection: 'asc' | 'desc';
  sortable?: boolean;
  state: ExploreState;
  sort: SortTerm[];
  className: string;
}) {
  const active = sort[0]?.id === id ? sort[0] : undefined;
  const ariaSort = active ? (active.direction === 'asc' ? 'ascending' : 'descending') : undefined;
  const name = accessibleLabel ?? label;
  const alignRight = className.includes('text-right');
  const base = `sticky top-8 border-b border-b-control bg-sunk px-3 py-2 align-bottom font-semibold ${className}`;
  const spoken = `${name}${note ? `, ${note}` : ''}`;
  const content = (
    <span className="block" aria-hidden="true">
      <span className="block whitespace-nowrap">{label}</span>
      {note ? (
        <span className="block whitespace-nowrap text-xs font-normal text-ink-3">{note}</span>
      ) : null}
    </span>
  );
  if (!sortable) {
    return (
      <th scope="col" className={`${base} text-ink-2`} title={description}>
        {content}
        <span className="sr-only">{spoken}</span>
      </th>
    );
  }
  const target = nextSort(sort.length > 0 ? sort : null, id, firstDirection);
  const href = serializeExplore('/explore', { ...state, sort: target, page: null });
  const Icon = active ? (active.direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  const action = target
    ? `sort ${target[0]?.direction === 'asc' ? 'ascending' : 'descending'}`
    : 'return to the default order';
  return (
    <th scope="col" aria-sort={ariaSort} className={base} title={description}>
      <Link
        href={href}
        scroll={false}
        className={`group/sort inline-flex items-end gap-1 rounded-control hover:text-ink ${
          active ? 'text-ink' : 'text-ink-2'
        } ${alignRight ? 'flex-row-reverse text-right' : 'text-left'}`}
      >
        {content}
        <span className="sr-only">
          {spoken}, {action}
        </span>
        <Icon
          aria-hidden="true"
          strokeWidth={1.75}
          className={`mb-0.5 size-3.5 shrink-0 ${
            active ? 'text-accent' : 'text-ink-3 opacity-60 group-hover/sort:opacity-100'
          }`}
        />
      </Link>
    </th>
  );
}
