import Link from 'next/link';
import type { ReactNode } from 'react';
import { FullTitle } from '@/components/full-title';
import { Pagination } from '@/components/pagination';
import { ScrollRegion } from '@/components/scroll-region';
import { SourceList, SourceMark, SourceNotes } from '@/components/sources';
import {
  formatDate,
  formatNumber,
  formatShare,
  ordinal,
  rollCallNumber,
  safeHref,
  shortTitle,
} from '@/lib/format';
import { POSITION_LABEL } from '@/lib/labels';
import { read } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';
import { ProfileSection } from './section';

const PAGE_SIZE = 20;

export async function VotesSection({
  slug,
  area,
  page,
  missedVoteRate,
  votesEligible,
}: {
  slug: string;
  area: string | null;
  page: number;
  missedVoteRate: number | null;
  votesEligible: number | null;
}) {
  const [areas, sources] = await Promise.all([read('policy.areas', {}), sourceInfos()]);
  const activeArea = areas.items.find((a) => a.id === area) ?? null;
  const votes = await read('votes.list', {
    slug,
    ...(activeArea ? { policyArea: activeArea.id } : {}),
    limit: PAGE_SIZE,
    offset: (Math.max(page, 1) - 1) * PAGE_SIZE,
  });
  const notes = new SourceNotes('votes', sources);
  const congress = votes.items[0]?.rollcall.congress;
  const href = (next: { area?: string | null; page?: number }) => {
    const params = new URLSearchParams();
    const a = next.area === undefined ? activeArea?.id : next.area;
    if (a) params.set('area', a);
    if (next.page && next.page > 1) params.set('vpage', String(next.page));
    const query = params.toString();
    return `/people/${slug}${query ? `?${query}` : ''}#votes`;
  };

  return (
    <ProfileSection
      id="votes"
      title="Votes"
      lede={
        missedVoteRate === null || votesEligible === null ? (
          'No recorded roll-call votes for this member.'
        ) : (
          <>
            Missed <span className="num font-semibold text-ink">{formatShare(missedVoteRate)}</span>{' '}
            of <span className="num">{formatNumber(votesEligible)}</span> roll calls in their latest
            Congress with votes. Newest first; positions as recorded by Voteview.
          </>
        )
      }
    >
      <nav aria-label="Filter votes by policy area" className="flex flex-wrap gap-2 text-sm">
        <AreaLink href={href({ area: null })} current={activeArea === null}>
          All areas
        </AreaLink>
        {areas.items
          .filter((a) => a.rollcallCount > 0)
          .map((a) => (
            <AreaLink key={a.id} href={href({ area: a.id })} current={activeArea?.id === a.id}>
              {a.name}
            </AreaLink>
          ))}
      </nav>

      {votes.items.length === 0 ? (
        <p className="mt-6 text-ink-2">
          No roll calls {activeArea ? `on ${activeArea.name} bills ` : ''}for this member.
        </p>
      ) : (
        <ScrollRegion label="Roll calls" className="mt-6">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">
              {activeArea ? `${activeArea.name} roll calls` : 'Roll calls'}
              {congress ? `, ${ordinal(congress)} Congress` : ''}, with this member’s position
            </caption>
            <thead>
              <tr className="border-b border-control text-left text-ink-2">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Date
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Measure
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Result
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">
                  Yea–Nay
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Position
                </th>
              </tr>
            </thead>
            <tbody>
              {votes.items.map((v) => {
                const bill = v.bill;
                const billHref = safeHref(bill?.url);
                return (
                  <tr
                    key={`${v.rollcall.chamber}-${v.rollcall.congress}-${v.rollcall.number}`}
                    className="border-b border-rule align-top"
                    data-rollcall={`${v.rollcall.chamber}.${v.rollcall.congress}.${v.rollcall.number}`}
                    data-value={JSON.stringify([v.position, v.tally.yea, v.tally.nay])}
                  >
                    <td className="num py-2.5 pr-4 whitespace-nowrap text-ink-2">
                      {formatDate(v.rollcall.voteDate)}
                    </td>
                    <td className="py-2.5 pr-4">
                      {bill ? (
                        billHref ? (
                          <a className="link" href={billHref} rel="noreferrer">
                            {shortTitle(bill.title).text}
                          </a>
                        ) : (
                          shortTitle(bill.title).text
                        )
                      ) : (
                        v.rollcall.question
                      )}
                      <span className="mt-0.5 block text-xs text-ink-3">
                        {bill ? `${bill.billType.toUpperCase()} ${bill.number} · ` : ''}
                        {v.rollcall.chamber === 'senate' ? 'Senate' : 'House'} roll call{' '}
                        <span className="num">{rollCallNumber(v.rollcall)}</span>
                        {v.policyArea ? ` · ${v.policyArea.name}` : ''} · {v.rollcall.question}
                        <SourceMark notes={notes} n={notes.cite(v.rollcall.provenance)} />
                      </span>
                      {bill ? <FullTitle title={bill.title} /> : null}
                    </td>
                    <td className="py-2.5 pr-4 text-ink-2">{v.rollcall.result}</td>
                    <td className="num py-2.5 pr-4 text-right whitespace-nowrap text-ink-2">
                      {v.tally.yea}–{v.tally.nay}
                    </td>
                    <td className="py-2.5 font-semibold whitespace-nowrap">
                      {v.position ? (
                        POSITION_LABEL[v.position]
                      ) : (
                        <span className="font-normal text-ink-3">No record</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      )}

      {votes.total > PAGE_SIZE ? (
        <div className="mt-4">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={votes.total}
            hrefFor={(p) => href({ page: p })}
            label="Vote pages"
          />
        </div>
      ) : null}

      <SourceList notes={notes} />
    </ProfileSection>
  );
}

function AreaLink({
  href,
  current,
  children,
}: {
  href: string;
  current: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={current ? 'true' : undefined}
      className={`inline-flex min-h-9 items-center rounded-control border px-3 ${
        current
          ? 'border-accent bg-accent-wash font-semibold'
          : 'border-control text-ink-2 hover:border-ink-2 hover:text-ink'
      }`}
    >
      {children}
    </Link>
  );
}
