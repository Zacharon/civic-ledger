import type { CapabilityOutput } from '@civic-ledger/core';
import { Info } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ShareBar } from '@/components/charts/share-bar';
import {
  type CandidateRollcall,
  FrameworkBuilder,
} from '@/components/frameworks/framework-builder';
import { Pagination } from '@/components/pagination';
import { PartyChip } from '@/components/party-chip';
import { ScrollRegion } from '@/components/scroll-region';
import { SourceList, SourceMark, SourceNotes } from '@/components/sources';
import { formatDate, formatNumber, rollCallNumber, safeHref, seatLabel } from '@/lib/format';
import { decodeRules, describeTarget, encodeRules, type RuleSpec } from '@/lib/framework-url';
import { POSITION_LABEL } from '@/lib/labels';
import { read, readOrInvalid } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';

export const metadata: Metadata = {
  title: 'Frameworks',
  description:
    'Score members against a named, attributed framework: aligned X of Y with every vote listed.',
};

const PAGE_SIZE = 50;
const CANDIDATES = 100;

type Prebuilt = CapabilityOutput<'frameworks.list'>['items'][number];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const UNRESOLVED: Record<string, string> = {
  rollcall_not_found: 'No such roll call in the data',
  bill_not_found: 'No such bill in the data',
  no_final_passage_vote: 'The bill has no final-passage roll call yet',
  duplicate_rollcall: 'Already counted by an earlier rule',
};

function copyHref(f: Prebuilt): string {
  const params = new URLSearchParams({
    build: '1',
    title: `Copy of ${f.title}`,
    stance: f.statedOrientation,
    rules: encodeRules(f.spec.rules),
  });
  return `/frameworks?${params.toString()}`;
}

export default async function FrameworksPage({ searchParams }: PageProps<'/frameworks'>) {
  const query = await searchParams;
  const [list, sources] = await Promise.all([read('frameworks.list', {}), sourceInfos()]);
  const slug = first(query.f);
  const building = first(query.build) === '1';
  const customRules = decodeRules(first(query.rules));
  const prebuilt = slug ? (list.items.find((f) => f.slug === slug) ?? null) : null;
  const custom = !prebuilt && customRules.length > 0;
  const title = first(query.title)?.trim().slice(0, 200) || 'Untitled framework';
  const stance = first(query.stance)?.trim().slice(0, 200) || null;
  const chamber = first(query.chamber);
  const party = first(query.party)?.slice(0, 80);
  const state = first(query.state)?.toUpperCase();
  const page = Math.max(1, Number.parseInt(first(query.page) ?? '1', 10) || 1);

  const spec = prebuilt
    ? prebuilt.spec
    : custom
      ? { title, rules: customRules.map((r: RuleSpec) => ({ ...r, weight: r.weight ?? 1 })) }
      : null;
  const chamberFilter = chamber === 'house' ? 'house' : chamber === 'senate' ? 'senate' : undefined;
  const people: { chamber?: 'house' | 'senate'; state?: string; party?: string } = {
    ...(chamberFilter ? { chamber: chamberFilter } : {}),
    ...(state && /^[A-Z]{2}$/.test(state) ? { state } : {}),
    ...(party ? { party } : {}),
  };
  const [evaluation, facets, candidates] = await Promise.all([
    spec
      ? readOrInvalid('frameworks.evaluate', {
          framework: spec,
          people,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        })
      : null,
    read('explore.facets', {}),
    building || custom ? read('votes.list', { limit: CANDIDATES }) : null,
  ]);
  const notes = new SourceNotes('framework', sources);
  if (prebuilt) notes.cite(prebuilt.provenance);

  const baseParams = () => {
    const params = new URLSearchParams();
    for (const key of [
      'f',
      'build',
      'title',
      'stance',
      'rules',
      'chamber',
      'state',
      'party',
    ] as const) {
      const value = first(query[key]);
      if (value) params.set(key, value);
    }
    return params;
  };
  const pageHref = (p: number) => {
    const params = baseParams();
    if (p > 1) params.set('page', String(p));
    return `/frameworks?${params.toString()}#results`;
  };

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 sm:pt-10">
      <header className="max-w-3xl">
        <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">Frameworks</h1>
        <p className="mt-3 text-ink-2">
          A framework is someone’s list of votes and the side they consider aligned. Results read
          “aligned X of Y”, with every vote shown. Pick one below or build your own.
        </p>
      </header>

      <p
        role="note"
        className="mt-6 flex max-w-3xl items-start gap-3 rounded-panel border border-control bg-surface px-4 py-3 text-sm"
      >
        <Info
          aria-hidden="true"
          strokeWidth={1.75}
          className="mt-0.5 size-4 shrink-0 text-accent"
        />
        <span>
          <strong className="font-semibold">
            This is one framework’s view, not a neutral score.
          </strong>{' '}
          Its author chose the votes and the “aligned” side. Another author would choose
          differently.
        </span>
      </p>

      <section aria-labelledby="choose" className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="choose" className="font-serif text-2xl font-medium">
            Choose a framework
          </h2>
          <Link href="/frameworks?build=1#build" className="btn btn-secondary">
            Build your own
          </Link>
        </div>
        {list.items.length === 0 ? (
          <p className="mt-4 text-ink-2">
            No pre-built frameworks are published yet. Build your own.
          </p>
        ) : (
          <ul className="mt-4 grid gap-4 md:grid-cols-2">
            {list.items.map((f) => {
              const active = prebuilt?.slug === f.slug;
              return (
                <li
                  key={`${f.slug}-${f.version}`}
                  className={`rounded-panel border p-5 ${active ? 'border-accent bg-accent-wash' : 'border-rule bg-surface'}`}
                >
                  <h3 className="font-serif text-xl font-medium">{f.title}</h3>
                  <p className="mt-1 text-sm text-ink-2">
                    By {f.author} · Stated orientation: {f.statedOrientation} ·{' '}
                    <span className="num">{f.spec.rules.length}</span> rules · version {f.version}
                  </p>
                  <p className="mt-2 text-sm">{f.description}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/frameworks?f=${f.slug}#results`}
                      aria-current={active ? 'page' : undefined}
                      className="btn btn-primary"
                    >
                      {active ? 'Showing results' : 'Evaluate'}
                      <span className="sr-only"> {f.title}</span>
                    </Link>
                    <Link href={copyHref(f)} className="btn btn-secondary">
                      Edit a copy<span className="sr-only"> of {f.title}</span>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {building || custom ? (
        <section
          aria-labelledby="build-title"
          id="build"
          className="mt-14 scroll-mt-24 border-t border-ink pt-6"
        >
          <h2 id="build-title" className="font-serif text-2xl font-medium">
            Build your own
          </h2>
          <p className="mt-1.5 max-w-3xl text-sm text-ink-2">
            Nothing is saved: the framework lives in this page’s address, so copying the link shares
            it exactly. Present and not-voting positions are listed but never counted.
          </p>
          <div className="mt-6">
            <FrameworkBuilder candidates={(candidates?.items ?? []).map(toCandidate)} />
          </div>
        </section>
      ) : null}

      {spec ? (
        <section
          id="results"
          aria-labelledby="results-title"
          className="mt-14 scroll-mt-24 border-t border-ink pt-6"
        >
          <h2 id="results-title" className="font-serif text-2xl font-medium">
            {prebuilt ? prebuilt.title : title}
          </h2>
          <dl className="mt-2 grid max-w-3xl gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            <dt className="text-ink-2">Author</dt>
            <dd>
              {prebuilt ? (
                <>
                  {prebuilt.author}
                  <SourceMark notes={notes} n={1} />
                </>
              ) : (
                'Built on this page; not reviewed or saved'
              )}
            </dd>
            <dt className="text-ink-2">Stated orientation</dt>
            <dd>{prebuilt ? prebuilt.statedOrientation : (stance ?? 'None stated')}</dd>
            {prebuilt?.methodologyUrl && safeHref(prebuilt.methodologyUrl) ? (
              <>
                <dt className="text-ink-2">Method</dt>
                <dd>
                  <a
                    className="link"
                    href={safeHref(prebuilt.methodologyUrl) ?? undefined}
                    rel="noreferrer"
                  >
                    Methodology
                  </a>
                </dd>
              </>
            ) : null}
          </dl>

          {!evaluation?.ok ? (
            <div role="alert" className="mt-6 rounded-panel border border-control bg-surface p-5">
              <p className="font-semibold">This framework can’t be evaluated.</p>
              <p className="mt-1 text-sm text-ink-2">
                {evaluation && !evaluation.ok
                  ? (evaluation.error.issues?.[0]?.message ?? evaluation.error.message)
                  : 'No rules.'}
              </p>
            </div>
          ) : (
            <Results
              evaluation={evaluation.data}
              rationales={(prebuilt?.spec.rules ?? []).map((r) => r.rationale ?? null)}
              facets={facets}
              baseParams={baseParams}
              selected={{ chamber, state, party }}
              page={page}
              pageHref={pageHref}
            />
          )}
          <SourceList notes={notes} />
        </section>
      ) : null}
    </div>
  );
}

function toCandidate(v: CapabilityOutput<'votes.list'>['items'][number]): CandidateRollcall {
  return {
    congress: v.rollcall.congress,
    chamber: v.rollcall.chamber,
    number: v.rollcall.number,
    session: v.rollcall.session,
    clerkNumber: v.rollcall.clerkNumber,
    voteDate: formatDate(v.rollcall.voteDate) ?? v.rollcall.voteDate,
    question: v.rollcall.question,
    result: v.rollcall.result,
    billTitle: v.bill?.title ?? null,
    policyArea: v.policyArea?.name ?? null,
  };
}

function Results({
  evaluation,
  rationales,
  facets,
  baseParams,
  selected,
  page,
  pageHref,
}: {
  evaluation: CapabilityOutput<'frameworks.evaluate'>;
  rationales: (string | null)[];
  facets: CapabilityOutput<'explore.facets'>;
  baseParams: () => URLSearchParams;
  selected: { chamber: string | undefined; state: string | undefined; party: string | undefined };
  page: number;
  pageHref: (page: number) => string;
}) {
  const hidden = [...baseParams().entries()].filter(
    ([k]) => !['chamber', 'state', 'party'].includes(k),
  );
  const resolved = evaluation.rules.filter((r) => r.status === 'resolved').length;
  return (
    <>
      <h3 className="mt-8 font-semibold">
        Rules{' '}
        <span className="num font-normal text-ink-3">
          ({resolved} of {evaluation.rules.length} resolved)
        </span>
      </h3>
      <ScrollRegion label="Framework rules" className="mt-2">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Framework rules and the roll calls each one scored</caption>
          <thead>
            <tr className="border-b border-control text-left text-ink-2">
              <th scope="col" className="py-2 pr-3 font-semibold">
                #
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Vote
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                Aligned position
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Weight
              </th>
              <th scope="col" className="py-2 font-semibold">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {evaluation.rules.map((r) => (
              <tr key={r.ruleIndex} className="border-b border-rule align-top">
                <td className="num py-2 pr-3 text-ink-3">{r.ruleIndex + 1}</td>
                <td className="py-2 pr-3">
                  {r.bill?.title ?? r.rollcalls[0]?.question ?? describeTarget(r.target)}
                  <span className="block text-xs text-ink-3">
                    {describeTarget(r.target)}
                    {r.rollcalls.length > 0
                      ? ` · ${r.rollcalls.map((rc) => `${formatDate(rc.voteDate)}, ${rc.result.toLowerCase()}`).join('; ')}`
                      : ''}
                  </span>
                  {rationales[r.ruleIndex] ? (
                    <span className="mt-1 block text-xs text-ink-2">
                      Author’s rationale: {rationales[r.ruleIndex]}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3 font-semibold">
                  {r.alignedPosition === 'yea' ? 'Yea' : 'Nay'}
                </td>
                <td className="num py-2 pr-3 text-right">{r.weight}</td>
                <td className="py-2 text-ink-2">
                  {r.status === 'resolved'
                    ? 'Counted'
                    : (UNRESOLVED[r.reason ?? ''] ?? 'Not counted')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>

      <form action="/frameworks#results" className="mt-10 flex flex-wrap items-end gap-3">
        {hidden.map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <FilterSelect
          name="chamber"
          label="Chamber"
          value={selected.chamber}
          options={facets.chambers.map((c) => ({
            value: c.value,
            label: c.value === 'house' ? 'House' : 'Senate',
          }))}
          all="Both"
        />
        <FilterSelect
          name="state"
          label="State"
          value={selected.state}
          options={facets.states.map((s) => ({ value: s.value, label: s.value }))}
          all="All states"
        />
        <FilterSelect
          name="party"
          label="Party"
          value={selected.party}
          options={facets.parties.map((p) => ({ value: p.value, label: p.value }))}
          all="All parties"
        />
        <button type="submit" className="btn btn-secondary">
          Show members
        </button>
      </form>

      <h3 className="mt-6 font-semibold">
        Members{' '}
        <span className="num font-normal text-ink-3">
          ({formatNumber(evaluation.total)} with a recorded vote)
        </span>
      </h3>
      {evaluation.results.length === 0 ? (
        <p className="mt-3 text-ink-2">No member in this selection voted on these roll calls.</p>
      ) : (
        <ScrollRegion label="Member results" className="mt-2">
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">
              Alignment with this framework, member by member, with the votes used
            </caption>
            <thead>
              <tr className="border-b border-control text-left text-ink-2">
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Member
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Aligned
                </th>
                <th scope="col" className="py-2 pr-4 font-semibold">
                  Not counted
                </th>
                <th scope="col" className="py-2 font-semibold">
                  Votes used
                </th>
              </tr>
            </thead>
            <tbody>
              {evaluation.results.map((r) => (
                <tr key={r.person.slug} className="border-b border-rule align-top">
                  <th scope="row" className="py-2.5 pr-4 text-left font-normal">
                    <Link href={`/people/${r.person.slug}`} className="link-quiet font-medium">
                      {r.person.fullName}
                    </Link>
                    <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                      <PartyChip party={r.person.party} />
                      {seatLabel(r.person.chamber, r.person.state, r.person.district)}
                    </span>
                  </th>
                  <td className="py-2.5 pr-4 whitespace-nowrap">
                    <span className="num font-semibold">
                      {r.aligned} of {r.considered}
                    </span>
                    <span className="mt-1 block">
                      <ShareBar share={r.alignmentRate} empty="No yea or nay votes" />
                    </span>
                  </td>
                  <td className="num py-2.5 pr-4 text-ink-2">{r.notCounted}</td>
                  <td className="py-2.5">
                    <details>
                      <summary className="cursor-pointer text-accent">
                        Show {r.votes.length} {r.votes.length === 1 ? 'vote' : 'votes'}
                      </summary>
                      <ul className="mt-2 space-y-1 text-xs">
                        {r.votes.map((v) => (
                          <li key={`${v.ruleIndex}-${v.rollcall.chamber}-${v.rollcall.number}`}>
                            Rule {v.ruleIndex + 1}:{' '}
                            {v.rollcall.chamber === 'house' ? 'House' : 'Senate'} roll call{' '}
                            <span className="num">{rollCallNumber(v.rollcall)}</span>, voted{' '}
                            <strong>{POSITION_LABEL[v.position]}</strong>
                            {v.aligned === null
                              ? ' (not counted)'
                              : v.aligned
                                ? ' (aligned)'
                                : ' (not aligned)'}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      {evaluation.total > PAGE_SIZE ? (
        <div className="mt-4">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={evaluation.total}
            hrefFor={pageHref}
            label="Result pages"
          />
        </div>
      ) : null}
    </>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
  all,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  all: string;
}) {
  const id = `framework-${name}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <select id={id} name={name} defaultValue={value ?? ''} className="field">
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
