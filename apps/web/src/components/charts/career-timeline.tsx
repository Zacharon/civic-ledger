import { chamberLabel, seatLabel } from '@/lib/format';

interface Seat {
  chamber: 'house' | 'senate';
  state: string;
  district: number | null;
  party: string;
}

export interface TimelineTerm extends Seat {
  startDate: string;
  endDate: string | null;
}

export interface TimelineCampaign extends Seat {
  cycle: number;
  outcome: 'won' | 'lost' | 'withdrew' | 'pending' | null;
}

const OUTCOME: Record<NonNullable<TimelineCampaign['outcome']>, string> = {
  won: 'Won',
  lost: 'Lost',
  withdrew: 'Withdrew',
  pending: 'Pending',
};

const year = (iso: string) => Number(iso.slice(0, 4));

/**
 * Terms as bars and campaigns as marks on one shared year scale, read top to bottom
 * in time order. The list itself is the accessible version; bars are decoration.
 */
export function CareerTimeline({
  terms,
  campaigns,
  asOfYear,
}: {
  terms: TimelineTerm[];
  campaigns: TimelineCampaign[];
  asOfYear: number;
}) {
  const starts = [...terms.map((t) => year(t.startDate)), ...campaigns.map((c) => c.cycle)];
  const ends = terms.map((t) => (t.endDate ? year(t.endDate) : asOfYear));
  const min = Math.min(...starts);
  const max = Math.max(...ends, ...starts) + 1;
  const pos = (y: number) => ((y - min) / Math.max(max - min, 1)) * 100;

  const events = [
    ...terms.map((t) => ({ kind: 'term' as const, sortKey: t.startDate, term: t })),
    ...campaigns.map((c) => ({
      kind: 'campaign' as const,
      sortKey: `${c.cycle}-11-99`,
      campaign: c,
    })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  return (
    <div>
      <div
        className="num flex justify-between border-b border-control pb-1 text-xs text-ink-3"
        aria-hidden="true"
      >
        <span>{min}</span>
        <span>{max - 1}</span>
      </div>
      <ol className="mt-2 space-y-1">
        {events.map((e) =>
          e.kind === 'term' ? (
            <li
              key={`t-${e.term.startDate}-${e.term.chamber}`}
              data-term={`${e.term.chamber}:${e.term.startDate}`}
              data-value={JSON.stringify([
                e.term.state,
                e.term.district,
                e.term.party,
                e.term.startDate,
                e.term.endDate,
              ])}
              className="grid gap-1 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-center sm:gap-4"
            >
              <span className="text-sm">
                <span className="num">
                  {year(e.term.startDate)}–{e.term.endDate ? year(e.term.endDate) : 'present'}
                </span>{' '}
                <span className="text-ink-2">
                  {chamberLabel(e.term.chamber)},{' '}
                  {seatLabel(e.term.chamber, e.term.state, e.term.district)} · {e.term.party}
                </span>
              </span>
              <svg className="block h-3 w-full" aria-hidden="true">
                <rect
                  x={`${pos(year(e.term.startDate))}%`}
                  width={`${Math.max(pos(e.term.endDate ? year(e.term.endDate) : asOfYear) - pos(year(e.term.startDate)), 0.8)}%`}
                  y="2"
                  height="8"
                  rx="1"
                  className={e.term.chamber === 'senate' ? 'fill-ink-2' : 'fill-bar'}
                />
              </svg>
            </li>
          ) : (
            <li
              key={`c-${e.campaign.cycle}-${e.campaign.chamber}`}
              data-campaign={`${e.campaign.chamber}:${e.campaign.cycle}`}
              data-value={JSON.stringify([
                e.campaign.state,
                e.campaign.district,
                e.campaign.party,
                e.campaign.outcome,
              ])}
              className="grid gap-1 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-center sm:gap-4"
            >
              <span className="text-sm">
                <span className="num">{e.campaign.cycle}</span>{' '}
                <span className="text-ink-2">
                  Campaign for {chamberLabel(e.campaign.chamber)},{' '}
                  {seatLabel(e.campaign.chamber, e.campaign.state, e.campaign.district)}:{' '}
                </span>
                <span className="font-semibold">
                  {e.campaign.outcome ? OUTCOME[e.campaign.outcome] : 'Outcome not recorded'}
                </span>
              </span>
              <svg className="block h-3 w-full overflow-visible" aria-hidden="true">
                <svg x={`${pos(e.campaign.cycle)}%`} y="0" overflow="visible" aria-hidden="true">
                  <path
                    d="M0 1 L5 6 L0 11 L-5 6 Z"
                    className={
                      e.campaign.outcome === 'won' ? 'fill-ink' : 'fill-surface stroke-ink'
                    }
                    strokeWidth="1.5"
                  />
                </svg>
              </svg>
            </li>
          ),
        )}
      </ol>
      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-3">
        <span>
          <span
            className="mr-1.5 inline-block h-2 w-4 rounded-[1px] bg-bar align-middle"
            aria-hidden="true"
          />
          House term
        </span>
        <span>
          <span
            className="mr-1.5 inline-block h-2 w-4 rounded-[1px] bg-ink-2 align-middle"
            aria-hidden="true"
          />
          Senate term
        </span>
        <span>◆ Campaign won · ◇ campaign not won</span>
      </p>
    </div>
  );
}
