import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CirclePause,
  CircleX,
  type LucideIcon,
} from 'lucide-react';
import { SourceList, SourceMark, SourceNotes } from '@/components/sources';
import { formatDate, formatShare, safeHref } from '@/lib/format';
import { read } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';
import { ProfileSection } from './section';

type Status = 'kept' | 'compromise' | 'broken' | 'in_progress' | 'stalled' | 'not_yet_rated';

/** Icon + label, in ink: a rating is reported, not cheered or booed (DESIGN.md). */
export const PROMISE_STATUS: Record<Status, { label: string; icon: LucideIcon }> = {
  kept: { label: 'Kept', icon: CircleCheck },
  compromise: { label: 'Compromise', icon: CircleDot },
  broken: { label: 'Broken', icon: CircleX },
  in_progress: { label: 'In progress', icon: CircleDashed },
  stalled: { label: 'Stalled', icon: CirclePause },
  not_yet_rated: { label: 'Not yet rated', icon: CircleHelp },
};

export function PromiseStatus({ status }: { status: Status }) {
  const { label, icon: Icon } = PROMISE_STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-control bg-sunk px-2 py-0.5 text-sm font-semibold whitespace-nowrap">
      <Icon aria-hidden="true" strokeWidth={1.75} className="size-4" />
      {label}
    </span>
  );
}

export async function PromisesSection({ slug }: { slug: string }) {
  const [promises, sources] = await Promise.all([read('promises.list', { slug }), sourceInfos()]);
  const notes = new SourceNotes('promises', sources);
  const { summary } = promises;

  return (
    <ProfileSection
      id="promises"
      title="Promises"
      lede={
        summary.total === 0 ? (
          'No campaign promises have been curated for this member yet.'
        ) : (
          <>
            <span className="num font-semibold text-ink">
              {summary.kept} of {summary.rated}
            </span>{' '}
            rated promises kept
            {summary.keptRate !== null ? ` (${formatShare(summary.keptRate)})` : ''};{' '}
            <span className="num">{summary.total - summary.rated}</span> still open or unrated.
            Ratings are dated and cite their evidence.
          </>
        )
      }
    >
      {promises.items.length > 0 ? (
        <ol className="divide-y divide-rule border-y border-rule">
          {promises.items.map((p) => {
            const source = safeHref(p.sourceUrl);
            return (
              <li
                key={p.promiseKey}
                className="grid gap-3 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] md:gap-8"
              >
                <div>
                  <blockquote className="font-serif text-lg leading-snug">
                    “{p.statement}”
                  </blockquote>
                  <p className="mt-1.5 text-sm text-ink-2">
                    {p.madeOn ? `Made ${formatDate(p.madeOn)}` : 'Date not recorded'}
                    {p.policyArea ? ` · ${p.policyArea.name}` : ''}
                    {source ? (
                      <>
                        {' · '}
                        <a className="link" href={source} rel="noreferrer">
                          Where it was said
                        </a>
                      </>
                    ) : null}
                    <SourceMark notes={notes} n={notes.cite(p.provenance)} />
                  </p>
                </div>
                <div>
                  <PromiseStatus status={p.status} />
                  {p.ratings.length > 0 ? (
                    <ol className="mt-2 space-y-2 text-sm text-ink-2">
                      {p.ratings.map((r) => (
                        <li key={`${r.rater}-${r.ratedOn}`}>
                          <span className="text-ink">{PROMISE_STATUS[r.status].label}</span>, rated
                          by {r.rater} on {formatDate(r.ratedOn)}
                          <SourceMark notes={notes} n={notes.cite(r.provenance)} />
                          {r.summary ? <span className="block">{r.summary}</span> : null}
                          {r.evidence.length > 0 ? (
                            <ul className="mt-1 space-y-0.5">
                              {r.evidence.map((e) => {
                                const url = safeHref(e.url);
                                return (
                                  <li key={e.url}>
                                    Evidence:{' '}
                                    {url ? (
                                      <a className="link" href={url} rel="noreferrer">
                                        {e.title}
                                      </a>
                                    ) : (
                                      e.title
                                    )}
                                    {e.note ? ` (${e.note})` : ''}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
      <SourceList notes={notes} />
    </ProfileSection>
  );
}
