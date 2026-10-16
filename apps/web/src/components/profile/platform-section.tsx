import type { CapabilityOutput } from '@civic-ledger/core';
import Link from 'next/link';
import { SourceList, SourceMark, SourceNotes } from '@/components/sources';
import { formatDate, safeHref } from '@/lib/format';
import { POSITION_LABEL } from '@/lib/labels';
import { read } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';
import { ProfileSection } from './section';

type Platform = CapabilityOutput<'people.get'>['platform'];

const VOTES_PER_AREA = 4;

/**
 * What the member said next to how they voted in the same policy area. Placed side by
 * side without a verdict: readers judge consistency, the ledger does not.
 */
export async function PlatformSection({ slug, platform }: { slug: string; platform: Platform }) {
  const sources = await sourceInfos();
  const notes = new SourceNotes('platform', sources);
  if (platform.length === 0) {
    return (
      <ProfileSection id="platform" title="Platform and record">
        <p className="text-ink-2">
          No stated platform positions have been curated for this member yet.
        </p>
      </ProfileSection>
    );
  }
  const areaIds = [...new Set(platform.map((p) => p.policyArea.id))];
  const votesByArea = new Map(
    await Promise.all(
      areaIds.map(
        async (policyArea) =>
          [
            policyArea,
            await read('votes.list', { slug, policyArea, limit: VOTES_PER_AREA }),
          ] as const,
      ),
    ),
  );

  return (
    <ProfileSection
      id="platform"
      title="Platform and record"
      lede="Stated positions from campaign materials beside the member’s most recent votes on bills in the same Congress.gov policy area. No score is computed."
    >
      <div className="hidden grid-cols-[12rem_minmax(0,1fr)_minmax(0,1.2fr)] gap-6 border-b border-control pb-2 text-sm font-semibold text-ink-2 md:grid">
        <span>Policy area</span>
        <span>Stated position</span>
        <span>Recent votes in this area</span>
      </div>
      <ul className="divide-y divide-rule">
        {platform.map((p) => {
          const votes = votesByArea.get(p.policyArea.id);
          const source = safeHref(p.sourceUrl);
          return (
            <li
              key={`${p.cycle}-${p.policyArea.id}`}
              className="grid gap-3 py-5 md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1.2fr)] md:gap-6"
            >
              <div className="font-semibold">
                {p.policyArea.name}
                <span className="num block text-sm font-normal text-ink-3">{p.cycle} campaign</span>
              </div>
              <div>
                <p className="font-serif text-lg leading-snug">{p.stance}</p>
                <p className="mt-1 text-sm text-ink-2">
                  {source ? (
                    <a className="link" href={source} rel="noreferrer">
                      Campaign source
                    </a>
                  ) : (
                    'Campaign source not linked'
                  )}
                  <SourceMark notes={notes} n={notes.cite(p.provenance)} />
                </p>
              </div>
              <div>
                {votes && votes.items.length > 0 ? (
                  <ul className="space-y-2 text-sm">
                    {votes.items.map((v) => (
                      <li
                        key={`${v.rollcall.chamber}-${v.rollcall.number}-${v.rollcall.congress}`}
                        className="flex gap-3"
                      >
                        <span className="w-20 shrink-0 font-semibold">
                          {v.position ? POSITION_LABEL[v.position] : 'No record'}
                        </span>
                        <span className="min-w-0 text-ink-2">
                          {v.bill?.title ?? v.rollcall.question}
                          <span className="num block text-xs text-ink-3">
                            {formatDate(v.rollcall.voteDate)} · {v.rollcall.question} ·{' '}
                            {v.rollcall.result}
                            <SourceMark notes={notes} n={notes.cite(v.rollcall.provenance)} />
                          </span>
                        </span>
                      </li>
                    ))}
                    {votes.total > votes.items.length ? (
                      <li>
                        <Link
                          className="link"
                          href={`/people/${slug}?area=${p.policyArea.id}#votes`}
                        >
                          All {votes.total} votes in {p.policyArea.name}
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-3">
                    No roll calls on {p.policyArea.name} bills for this member.
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <SourceList notes={notes} />
    </ProfileSection>
  );
}
