'use client';

import * as Popover from '@radix-ui/react-popover';
import { Columns3 } from 'lucide-react';
import { useQueryStates } from 'nuqs';
import { COLUMN_GROUPS, type ColumnDef } from '@/lib/explore-columns';
import { exploreParsers } from '@/lib/explore-params';
import { useExploreTransition } from './explore-transition';

/** Show or hide metric columns, grouped Money / Votes / Ideology / Scorecards / Promises. */
export function ColumnPicker({ columns }: { columns: ColumnDef[] }) {
  const { startTransition } = useExploreTransition();
  const [{ cols }, setState] = useQueryStates(
    { cols: exploreParsers.cols },
    { shallow: false, history: 'push', scroll: false, startTransition },
  );
  const visible = new Set(cols ?? columns.filter((c) => c.defaultVisible).map((c) => c.id));

  const toggle = (id: string, show: boolean) => {
    const next = columns.filter((c) => (c.id === id ? show : visible.has(c.id))).map((c) => c.id);
    void setState({ cols: next });
  };

  return (
    <Popover.Root>
      <Popover.Trigger className="btn btn-secondary">
        <Columns3 aria-hidden="true" strokeWidth={1.75} className="size-4" />
        Columns
        <span className="num font-normal text-ink-3">({visible.size})</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="z-20 max-h-[min(32rem,var(--radix-popover-content-available-height))] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-panel border border-control bg-surface p-4 text-ink shadow-[0_8px_24px_-12px_rgb(28_27_24/0.35)]"
        >
          <p className="font-serif text-lg font-medium">Show columns</p>
          <p className="mt-1 text-sm text-ink-3">Name, party and seat are always shown.</p>
          <div className="mt-3 space-y-4">
            {COLUMN_GROUPS.map((group) => {
              const inGroup = columns.filter((c) => c.group === group.id);
              if (inGroup.length === 0) return null;
              return (
                <fieldset key={group.id}>
                  <legend className="text-xs font-semibold tracking-[0.08em] text-ink-3 uppercase">
                    {group.label}
                  </legend>
                  <ul className="mt-1.5 space-y-0.5">
                    {inGroup.map((c) => (
                      <li key={c.id}>
                        <label className="flex min-h-9 cursor-pointer items-start gap-2.5 rounded-control px-1 py-1.5 text-sm hover:bg-sunk">
                          <input
                            type="checkbox"
                            checked={visible.has(c.id)}
                            onChange={(e) => toggle(c.id, e.target.checked)}
                            className="mt-0.5 size-4 shrink-0 accent-(--accent)"
                          />
                          <span>
                            {c.label}
                            {c.scorecard ? (
                              <span className="block text-xs text-ink-3">
                                Self-described: {c.scorecard.selfDescribedOrientation}
                              </span>
                            ) : null}
                            {c.withData === 0 ? (
                              <span className="block text-xs text-ink-3">
                                No data yet for anyone shown
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              );
            })}
          </div>
          <div className="mt-4 flex justify-between border-t border-rule pt-3">
            <button
              type="button"
              className="link text-sm"
              onClick={() => void setState({ cols: null })}
            >
              Reset to default columns
            </button>
            <Popover.Close className="btn btn-secondary min-h-9">Done</Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
