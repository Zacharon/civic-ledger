import type { CSSProperties } from 'react';
import { SourceMark, type SourceNotes } from '@/components/sources';
import { formatNumber } from '@/lib/format';
import {
  type ChamberBlock,
  type Composition,
  compositionSentence,
  nonVotingGroups,
  SEAT_COLUMNS,
  type SeatGroup,
  seatGroups,
  seatTones,
} from '@/lib/seat-grid';

const NAME = { house: 'House of Representatives', senate: 'Senate' } as const;
const NOUN = { house: 'House', senate: 'Senate' } as const;

/**
 * Current House and Senate composition as a Swiss-style grid of squares (a waffle, not a
 * hemicycle). Squares fill left to right, row by row, in the documented party order:
 * Democrat, Independent, Republican, then other parties alphabetically. That order is
 * alphabetical, not a ranking and not an ideological sort. Party names and counts are
 * always printed; Democrat and Republican use the muted party-chip inks (owner-approved
 * for this chart only), Independent and others are neutral, vacancies are hollow.
 * Non-voting delegates and the Resident Commissioner are counted outside the 435.
 */
export function SeatChart({
  composition,
  notes,
  mark,
}: {
  composition: Composition;
  notes: SourceNotes;
  mark: number | null;
}) {
  return (
    <div data-seat-chart className="grid gap-x-12 gap-y-10 lg:grid-cols-[29fr_10fr]">
      {composition.chambers.map((block) => (
        <Chamber key={block.chamber} block={block} notes={notes} mark={mark} />
      ))}
    </div>
  );
}

function Chamber({
  block,
  notes,
  mark,
}: {
  block: ChamberBlock;
  notes: SourceNotes;
  mark: number | null;
}) {
  const groups = seatGroups(block);
  const squares = seatTones(groups);
  const nonVoting = nonVotingGroups(block);
  const name = NAME[block.chamber];
  return (
    <figure
      className="min-w-0"
      data-chamber={block.chamber}
      data-value={JSON.stringify([
        block.seats,
        block.members,
        block.voting.map((p) => [p.party, p.count]),
        block.nonVoting.total,
        block.vacancies,
      ])}
    >
      <h3 className="font-semibold">{name}</h3>
      <p className="mt-0.5 text-sm text-ink-2">
        <span className="num font-semibold text-ink">{formatNumber(block.members)}</span> of{' '}
        <span className="num">{formatNumber(block.seats)}</span> voting seats filled
        <SourceMark notes={notes} n={mark} />
      </p>
      <div
        role="img"
        aria-label={compositionSentence(block, NOUN[block.chamber])}
        className="seat-grid mt-3"
        style={{ '--cols': SEAT_COLUMNS[block.chamber] } as CSSProperties}
      >
        {squares.map((s, i) => (
          // The order is the data; the index is the key by design.
          // biome-ignore lint/suspicious/noArrayIndexKey: squares are positional
          <span key={i} className={`seat seat-${s.tone}`} />
        ))}
      </div>
      <Legend groups={groups} />
      {block.vacancies === null ? (
        <p className="mt-2 text-sm text-ink-3" data-vacancies="unknown">
          Vacancies are not shown: the roster on file has {formatNumber(block.members)} of{' '}
          {formatNumber(block.seats)} voting seats, which looks like a partial load rather than
          empty seats.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-3" data-vacancies={block.vacancies}>
          {block.vacancies === 0
            ? 'No vacancies: every voting seat has a member on file.'
            : `${formatNumber(block.vacancies)} ${block.vacancies === 1 ? 'seat is' : 'seats are'} vacant (${formatNumber(block.seats)} minus ${formatNumber(block.members)} voting members), drawn as hollow squares.`}
        </p>
      )}
      {block.chamber === 'house' ? (
        <div className="mt-5 border-t border-rule pt-3" data-nonvoting={block.nonVoting.total}>
          <h4 className="text-sm font-semibold">
            Non-voting members: <span className="num">{formatNumber(block.nonVoting.total)}</span>
          </h4>
          <p className="mt-0.5 text-sm text-ink-3">
            Delegates and the Resident Commissioner of Puerto Rico, counted apart from the 435
            voting seats
            {block.nonVoting.jurisdictions.length > 0
              ? ` (${block.nonVoting.jurisdictions.join(', ')})`
              : ''}
            .
          </p>
          {block.nonVoting.total === 0 ? (
            <p className="mt-2 text-sm text-ink-3">None on file.</p>
          ) : (
            <>
              <div
                role="img"
                aria-label={`Non-voting House members: ${block.nonVoting.parties.map((p) => `${p.count} ${p.party}`).join(', ')}.`}
                className="seat-grid mt-3 max-w-[12rem]"
                style={{ '--cols': 6 } as CSSProperties}
              >
                {seatTones(nonVoting).map((s, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: squares are positional
                  <span key={i} className={`seat seat-${s.tone}`} />
                ))}
              </div>
              <Legend groups={nonVoting} />
            </>
          )}
        </div>
      ) : null}
    </figure>
  );
}

function Legend({ groups }: { groups: SeatGroup[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
      {groups.map((g) => (
        <li key={g.label} className="inline-flex items-center gap-1.5" data-party={g.label}>
          <span aria-hidden="true" className={`seat-key seat-${g.tone}`} />
          {g.label} <span className="num font-semibold text-ink">{formatNumber(g.count)}</span>
        </li>
      ))}
    </ul>
  );
}
