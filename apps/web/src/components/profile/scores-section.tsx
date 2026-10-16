import type { CapabilityOutput } from '@civic-ledger/core';
import Link from 'next/link';
import { MemberScatter } from '@/components/charts/member-scatter';
import { PositionStrip } from '@/components/charts/position-strip';
import { SourceList, SourceMark, SourceNotes } from '@/components/sources';
import type { ExploreRow } from '@/lib/explore-columns';
import { formatScore, formatSigned, ordinal, safeHref } from '@/lib/format';
import { read } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';
import { Figure, ProfileSection } from './section';

const PAGE = 100;

/** Every member of a chamber (the capability pages at 100), for the placement chart. */
async function chamberMembers(chamber: 'house' | 'senate'): Promise<ExploreRow[]> {
  const first = await read('explore.table', { filters: { chamber }, limit: PAGE });
  const rest = await Promise.all(
    Array.from({ length: Math.ceil(first.total / PAGE) - 1 }, (_, i) =>
      read('explore.table', { filters: { chamber }, limit: PAGE, offset: (i + 1) * PAGE }),
    ),
  );
  return [first, ...rest].flatMap((r) => r.rows);
}

export async function ScoresSection({
  slug,
  name,
  chamber,
}: {
  slug: string;
  name: string;
  chamber: 'house' | 'senate' | null;
}) {
  const [scores, sources, peers] = await Promise.all([
    read('scores.list', { slug }),
    sourceInfos(),
    chamber ? chamberMembers(chamber) : Promise.resolve([]),
  ]);
  const notes = new SourceNotes('scores', sources);
  const latest = scores.ideology[0];
  const chamberName = chamber === 'senate' ? 'Senate' : 'House';
  const sameCongress = latest
    ? peers.filter((p) => p.dwNominateDim1 !== null && p.ideologyCongress === latest.congress)
    : [];
  const lower = latest
    ? sameCongress.filter((p) => (p.dwNominateDim1 ?? 0) < latest.dim1).length
    : 0;

  return (
    <ProfileSection
      id="scores"
      title="Scores"
      lede="Independent measures side by side. Each is one method’s view, attributed to whoever made it; none is ours."
    >
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {latest ? (
          <Figure
            title={`DW-NOMINATE placement among ${chamberName} members, ${ordinal(latest.congress)} Congress`}
            caption={
              <>
                {latest.label}. Each dot is a member; horizontal = first dimension, vertical =
                second. Source: Voteview
                <SourceMark notes={notes} n={notes.cite(latest.provenance)} />.{' '}
                <Link className="link" href="/methodology#dw-nominate">
                  How to read it
                </Link>
              </>
            }
          >
            <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="text-ink-2">First dimension</span>
              <PositionStrip value={latest.dim1} width={140} />
              {latest.dim2 !== null ? (
                <span className="text-ink-2">
                  Second dimension <span className="num text-ink">{formatSigned(latest.dim2)}</span>
                </span>
              ) : null}
            </p>
            {sameCongress.length > 1 ? (
              <MemberScatter
                points={sameCongress.map((p) => ({
                  key: p.slug,
                  x: p.dwNominateDim1 ?? 0,
                  y: p.dwNominateDim2,
                }))}
                focus={{ key: slug, x: latest.dim1, y: latest.dim2, name }}
                label={`${name}'s first-dimension score is ${formatSigned(latest.dim1)}. ${lower} of ${sameCongress.length} ${chamberName} members with a score are further toward the liberal end of the scale.`}
              />
            ) : null}
            {scores.ideology.length > 1 ? (
              <table className="mt-4 w-full max-w-sm text-sm">
                <caption className="text-left text-xs font-semibold text-ink-3">
                  By Congress
                </caption>
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Congress</th>
                    <th scope="col">First dimension</th>
                    <th scope="col">Second dimension</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.ideology.map((row) => (
                    <tr key={`${row.congress}-${row.method}`} className="border-b border-rule">
                      <th scope="row" className="py-1 text-left font-normal text-ink-2">
                        {ordinal(row.congress)}
                      </th>
                      <td className="num py-1 text-right">{formatSigned(row.dim1)}</td>
                      <td className="num py-1 text-right text-ink-2">
                        {formatSigned(row.dim2) ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </Figure>
        ) : (
          <p className="text-ink-2">
            No DW-NOMINATE estimate yet. Voteview publishes one once a member has cast enough
            roll-call votes.
          </p>
        )}

        <div>
          <h3 className="font-semibold">Published scorecards</h3>
          {scores.scorecards.length === 0 ? (
            <p className="mt-3 text-sm text-ink-2">No cleared scorecard has scored this member.</p>
          ) : (
            <ul className="mt-3 divide-y divide-rule border-y border-rule">
              {latestByPublisher(scores.scorecards).map(({ latest: s, earlier }) => {
                const method = safeHref(s.methodologyUrl);
                const span = s.scale.max - s.scale.min;
                const position = span > 0 ? (s.score - s.scale.min) / span : 0;
                return (
                  <li key={`${s.publisher.id}-${s.year}`} className="py-3">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="font-medium">{s.publisher.name}</span>
                      <span className="num text-lg font-semibold">
                        {formatScore(s.score)}
                        <span className="text-sm font-normal text-ink-3">
                          {' '}
                          / {formatScore(s.scale.max)}
                        </span>
                        <SourceMark notes={notes} n={notes.cite(s.provenance)} />
                      </span>
                    </div>
                    <svg className="mt-2 block h-1.5 w-full" aria-hidden="true">
                      <rect width="100%" height="6" rx="1" className="fill-sunk" />
                      <rect
                        width={`${Math.min(Math.max(position, 0), 1) * 100}%`}
                        height="6"
                        rx="1"
                        className="fill-bar"
                      />
                    </svg>
                    <p className="mt-1.5 text-sm text-ink-2">
                      Self-described: {s.publisher.selfDescribedOrientation}.{' '}
                      <span className="num">{s.year}</span> scorecard, scale{' '}
                      {formatScore(s.scale.min)}–{formatScore(s.scale.max)} ({s.scale.label}).{' '}
                      {method ? (
                        <a className="link" href={method} rel="noreferrer">
                          Methodology
                        </a>
                      ) : null}
                    </p>
                    {earlier.length > 0 ? (
                      <p className="mt-1 text-xs text-ink-3">
                        Earlier:{' '}
                        {earlier.map((e, i) => (
                          <span key={e.year}>
                            {i > 0 ? ', ' : ''}
                            <span className="num">{e.year}</span> {formatScore(e.score)}
                            <SourceMark notes={notes} n={notes.cite(e.provenance)} />
                          </span>
                        ))}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {scores.linkOnlyPublishers.length > 0 ? (
            <div className="mt-6 text-sm text-ink-2">
              <h4 className="font-semibold text-ink">Listed, not shown</h4>
              <p className="mt-1">
                These publishers’ terms of use have not been cleared, so their scores are linked,
                not copied:
              </p>
              <ul className="mt-2 space-y-1">
                {scores.linkOnlyPublishers.map((p) => {
                  const url = safeHref(p.url);
                  return (
                    <li key={p.id}>
                      {url ? (
                        <a className="link" href={url} rel="noreferrer">
                          {p.name}
                        </a>
                      ) : (
                        p.name
                      )}{' '}
                      (self-described: {p.selfDescribedOrientation})
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
      <SourceList notes={notes} />
    </ProfileSection>
  );
}

type Scorecard = CapabilityOutput<'scores.list'>['scorecards'][number];

/** One entry per publisher: its latest year up front, earlier years as a footnote line. */
function latestByPublisher(scorecards: Scorecard[]) {
  const groups = new Map<string, Scorecard[]>();
  for (const s of scorecards)
    groups.set(s.publisher.id, [...(groups.get(s.publisher.id) ?? []), s]);
  return [...groups.values()].flatMap((list) => {
    const [latest, ...earlier] = [...list].sort((a, b) => b.year - a.year);
    return latest ? [{ latest, earlier }] : [];
  });
}
