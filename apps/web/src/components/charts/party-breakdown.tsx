import type { CSSProperties } from 'react';
import { formatNumber } from '@/lib/format';
import { partyBreakdown, partyRowLabel } from '@/lib/party-breakdown';
import type { Tally } from '@/lib/vote';
import { PartyDisclosure } from './party-disclosure';

/**
 * How each party voted on one roll call: one row per party actually present, each with
 * its Yea / Nay / Present / Not voting counts and a small meter in the vote colors. The
 * party is text; party color never fills a vote segment. Present and Not voting stay
 * separate columns. A total row proves the party rows add up to the roll call's tally.
 *
 * Party is the member's party on the vote date (their term in force then), so a member
 * who changed party is counted with the party they held at the time.
 */
export function PartyBreakdown({
  byParty,
  tally,
  placement,
}: {
  byParty: readonly (Tally & { party: string })[];
  tally: Tally;
  /** `list`: full table, open on wide screens and folded on phones. `row`: compact lines, folded. */
  placement: 'list' | 'row';
}) {
  const model = partyBreakdown(byParty, tally);
  if (model.rows.length === 0) return null;
  if (placement === 'row') {
    // Compact, counts-only markup for long lists (the member votes table renders up to 20
    // of these): plain text lines, no per-party meter, no client component. Every number
    // of the full table is here and works without JavaScript.
    const line = (label: string, parts: { key: string; label: string; count: number }[]) =>
      `${label}: ${parts.map((p) => `${p.label} ${formatNumber(p.count)}`).join(', ')}`;
    return (
      <details
        className="disclosure party-lines"
        data-party-breakdown
        data-total={model.total.total}
        data-reconciles={model.reconciles}
      >
        <summary>How each party voted</summary>
        <ul>
          {model.rows.map(({ party, summary }) => (
            <li key={party} data-party={party}>
              {line(partyRowLabel(party), summary.parts)}
            </li>
          ))}
          <li data-party-total>{line('All parties', model.total.parts)}</li>
        </ul>
      </details>
    );
  }
  return (
    <div
      className="mt-3"
      data-party-breakdown
      data-total={model.total.total}
      data-reconciles={model.reconciles}
    >
      <PartyDisclosure summary="How each party voted" defaultOpen closeOnPhone>
        <table className="w-full text-sm">
          <caption className="sr-only">
            Positions by party; the party rows add up to the roll call total
          </caption>
          <thead>
            <tr className="border-b border-ink text-ink-2">
              <th scope="col" className="py-1 text-left font-semibold">
                Party
              </th>
              <th scope="col" className="py-1 pl-2 text-right font-semibold">
                Yea
              </th>
              <th scope="col" className="py-1 pl-2 text-right font-semibold">
                Nay
              </th>
              <th scope="col" className="py-1 pl-2 text-right font-semibold">
                Present
              </th>
              <th scope="col" className="py-1 pl-2 text-right font-semibold">
                Not voting
              </th>
            </tr>
          </thead>
          <tbody>
            {model.rows.map(({ party, summary }) => (
              <tr
                key={party}
                data-party={party}
                data-value={JSON.stringify(summary.parts.map((p) => p.count))}
                className="border-t border-rule align-top"
              >
                <th scope="row" className="min-w-[7rem] py-2 text-left font-normal">
                  <span className="font-medium">{partyRowLabel(party)}</span>
                  <span className="block text-ink-3">
                    Of <span className="num">{formatNumber(summary.total)}</span>
                  </span>
                  <span className="vote-meter vote-meter-xs mt-1" aria-hidden="true">
                    {summary.segments.map((s) => (
                      <span
                        key={s.key}
                        className={s.className}
                        style={{ '--n': s.count } as CSSProperties}
                      />
                    ))}
                  </span>
                </th>
                {summary.parts.map((part) => (
                  <td
                    key={part.key}
                    className={`num py-2 pl-2 text-right ${
                      part.key === 'yea' || part.key === 'nay' ? '' : 'text-ink-2'
                    }`}
                  >
                    {formatNumber(part.count)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink font-semibold" data-party-total>
              <th scope="row" className="py-2 text-left">
                All parties
                <span className="block font-normal text-ink-3">
                  Of <span className="num">{formatNumber(model.total.total)}</span>
                </span>
              </th>
              {model.total.parts.map((part) => (
                <td key={part.key} className="num py-2 pl-2 text-right">
                  {formatNumber(part.count)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
        <p className="mt-2 text-sm text-ink-3">
          Party is each member’s party on the vote date, from their term records. Rows add up to the
          roll call’s <span className="num">{formatNumber(model.total.total)}</span> recorded
          positions.
          {model.unplaced > 0
            ? ` ${formatNumber(model.unplaced)} ${model.unplaced === 1 ? 'has' : 'have'} no party on file for that date and ${model.unplaced === 1 ? 'is' : 'are'} listed apart.`
            : ''}
        </p>
      </PartyDisclosure>
    </div>
  );
}
