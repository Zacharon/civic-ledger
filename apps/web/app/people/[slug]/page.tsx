import type { Metadata } from 'next';
import Link from 'next/link';
import { type ReactNode, Suspense } from 'react';
import { CareerTimeline } from '@/components/charts/career-timeline';
import { PositionStrip } from '@/components/charts/position-strip';
import { MemberPortrait } from '@/components/member-portrait';
import { PartyChip } from '@/components/party-chip';
import { GlanceSection } from '@/components/profile/glance';
import { MoneySection } from '@/components/profile/money-section';
import { PlatformSection } from '@/components/profile/platform-section';
import { PromisesSection } from '@/components/profile/promises-section';
import { ScoresSection } from '@/components/profile/scores-section';
import { ProfileSection, SectionFallback } from '@/components/profile/section';
import { VotesSection } from '@/components/profile/votes-section';
import { SourceList, SourceMark, SourceNotes } from '@/components/sources';
import { COMPARE_MAX, compareHref, exploreHref, parseCompareIds } from '@/lib/compare-list';
import {
  formatCents,
  formatDate,
  formatShare,
  formatYears,
  memberTitle,
  ordinal,
  safeHref,
  seatLabel,
  serviceYears,
} from '@/lib/format';
import { readOrNotFound } from '@/server/capabilities';
import { comparedNames } from '@/server/compare-names';
import { sourceInfos } from '@/server/sources';

const IDENTIFIER_LINKS: Record<string, { label: string; href: (id: string) => string }> = {
  bioguide: {
    label: 'Congressional Biographical Directory',
    href: (id) => `https://bioguide.congress.gov/search/bio/${encodeURIComponent(id)}`,
  },
  fec_candidate: {
    label: 'FEC candidate record',
    href: (id) => `https://www.fec.gov/data/candidate/${encodeURIComponent(id)}/`,
  },
  icpsr: {
    label: 'Voteview member page',
    href: (id) => `https://voteview.com/person/${encodeURIComponent(id)}`,
  },
};

const SECTIONS = [
  { id: 'glance', label: 'At a glance' },
  { id: 'money', label: 'Money' },
  { id: 'votes', label: 'Votes' },
  { id: 'scores', label: 'Scores' },
  { id: 'promises', label: 'Promises' },
  { id: 'platform', label: 'Platform and record' },
  { id: 'career', label: 'Career' },
] as const;

const firstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export async function generateMetadata({ params }: PageProps<'/people/[slug]'>): Promise<Metadata> {
  const { slug } = await params;
  const profile = await readOrNotFound('people.get', { slug: safeSlug(slug) });
  return {
    title: profile.person.fullName,
    description: `Campaign money, votes, independent scores and promises for ${profile.person.fullName}, each linked to its source.`,
  };
}

function safeSlug(slug: string) {
  // Invalid slugs fail capability validation; map them to a slug that cannot exist → 404.
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 120 ? slug : 'not-found';
}

export default async function PersonPage({ params, searchParams }: PageProps<'/people/[slug]'>) {
  const { slug: rawSlug } = await params;
  const query = await searchParams;
  const slug = safeSlug(rawSlug);
  const chosen = parseCompareIds(firstParam(query.compare));
  const [profile, sources, compared] = await Promise.all([
    readOrNotFound('people.get', { slug }),
    sourceInfos(),
    comparedNames(chosen),
  ]);
  // Comparison in progress (carried from Compare through Explore): add to it, don't restart.
  const others = compared.filter((m) => m.slug !== slug);
  const inComparison = compared.some((m) => m.slug === slug);
  const ids = compared.map((m) => m.slug);
  const compareAction =
    compared.length === 0
      ? { href: compareHref([slug]), label: 'Compare with others' }
      : inComparison
        ? { href: compareHref(ids), label: 'Back to comparison' }
        : ids.length >= COMPARE_MAX
          ? { href: compareHref(ids), label: `Comparison full (${COMPARE_MAX} of ${COMPARE_MAX})` }
          : {
              href: compareHref([...ids, slug]),
              label: `Add to comparison (${ids.length + 1} of ${COMPARE_MAX})`,
            };
  const { person, card, terms, candidacies, identifiers, platform } = profile;
  const cycle = Number.parseInt(firstParam(query.cycle) ?? '', 10);
  const votesPage = Number.parseInt(firstParam(query.vpage) ?? '', 10);
  const area = firstParam(query.area) ?? null;

  const headerNotes = new SourceNotes('summary', sources);
  const personMark = headerNotes.cite(person.provenance);
  const termMark = headerNotes.cite(terms[0]?.provenance);
  const portraitMark = headerNotes.cite(profile.portrait?.provenance);
  const title = memberTitle(card.chamber);
  const seat = seatLabel(card.chamber, card.state, card.district);
  const careerNotes = new SourceNotes('career', sources);
  careerNotes.citeAll([...terms.map((t) => t.provenance), ...candidacies.map((c) => c.provenance)]);

  return (
    <div className="page-frame pt-6 sm:pt-8">
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-12">
        <header className="min-w-0 lg:col-span-8">
          <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
            <Link href={exploreHref(ids)} className="link">
              Explore
            </Link>{' '}
            <span aria-hidden="true" className="px-1 text-ink-3">
              /
            </span>{' '}
            <span aria-current="page">{person.fullName}</span>
          </nav>
          <MemberPortrait
            portrait={profile.portrait}
            name={person.fullName}
            notes={headerNotes}
            mark={portraitMark}
          />
          <p className="eyebrow mt-6">Member record</p>
          <h1 className="page-title mt-3">
            {person.fullName}
            <SourceMark notes={headerNotes} n={personMark} />
          </h1>
          <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-lg text-ink-2">
            <span
              className={card.isCurrent ? 'record-status' : 'record-status record-status-plain'}
            >
              {card.isCurrent ? 'Current member' : 'Former member'}
            </span>
            <PartyChip party={card.party} full />
            <span>
              {card.isCurrent ? '' : 'Last served as '}
              {title && seat ? `${title}, ${seat}` : (seat ?? 'Seat unknown')}
              <SourceMark notes={headerNotes} n={termMark} />
            </span>
          </p>
          {card.isCurrent && card.termStart ? (
            <p className="mt-1 text-ink-2">
              Current term began {formatDate(card.termStart)}
              {card.tenureYears !== null ? `; ${formatYears(card.tenureYears)} in Congress` : ''}.
            </p>
          ) : null}
          {!card.isCurrent && card.serviceStart ? (
            <p className="mt-1 text-ink-2">
              Served <span className="num">{serviceYears(card)}</span>
              {card.tenureYears !== null ? ` (${formatYears(card.tenureYears)} in Congress)` : ''}
              {`; last term ended ${formatDate(card.termEnd) ?? 'on an unknown date'}.`}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href={compareAction.href} className="btn btn-primary" data-compare-action>
              {compareAction.label}
            </Link>
            <Link
              href={exploreHref(ids, `q=${encodeURIComponent(person.lastName)}`)}
              className="btn btn-secondary"
            >
              Find in table
            </Link>
            {others.length > 0 ? (
              <p className="w-full text-sm text-ink-2" data-compare={ids.join(',')}>
                {inComparison ? 'In your comparison with ' : 'Comparing '}
                {others.map((m) => m.name).join(', ')}.{' '}
                {ids.length < COMPARE_MAX ? (
                  <Link href={exploreHref(ids)} className="link">
                    Pick another from the table
                  </Link>
                ) : null}
              </p>
            ) : null}
          </div>
          <dl className="rule-strong mt-8 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            <Fact
              label={card.moneyCycle ? `Raised, ${card.moneyCycle}` : 'Raised'}
              value={formatCents(card.totalReceiptsCents, { compact: true })}
              raw={['totalReceiptsCents', card.totalReceiptsCents]}
            />
            <Fact
              label="From PACs"
              value={formatShare(card.pacShare)}
              raw={['pacShare', card.pacShare]}
            />
            <Fact
              label={
                card.smallDollarAsOf
                  ? `Small donors, through ${formatDate(card.smallDollarAsOf)?.replace(/, \d{4}$/, '')}`
                  : 'Small donors'
              }
              value={formatShare(card.smallDollarShare)}
              raw={['smallDollarShare', card.smallDollarShare]}
            />
            <Fact
              label="Missed votes"
              value={formatShare(card.missedVoteRate)}
              empty={card.isCurrent ? 'No data' : 'No votes loaded'}
              raw={['missedVoteRate', card.missedVoteRate]}
            />
            <Fact
              label={
                card.ideologyCongress
                  ? `DW-NOMINATE, ${ordinal(card.ideologyCongress)}`
                  : 'DW-NOMINATE'
              }
              value={
                card.dwNominateDim1 === null ? null : (
                  <PositionStrip value={card.dwNominateDim1} width={64} />
                )
              }
              empty={card.isCurrent ? 'No data' : 'No votes loaded'}
              raw={['dwNominateDim1', card.dwNominateDim1]}
            />
            <Fact
              label="Promises kept"
              value={
                card.promiseKeptRate === null
                  ? null
                  : `${formatShare(card.promiseKeptRate)} of ${card.promisesRated}`
              }
              empty={card.promisesRated === null ? 'None tracked' : 'None rated yet'}
              raw={['promiseKeptRate', card.promiseKeptRate]}
            />
          </dl>
          <p className="mt-2 text-xs text-ink-3">
            Summary from the ledger table, rebuilt {formatDate(card.refreshedAt)}. Details and
            sources in each section below.
          </p>
        </header>

        <section aria-labelledby="evidence-title" className="min-w-0 lg:col-span-4 lg:pt-10">
          <div className="evidence-panel">
            <h2 id="evidence-title" className="subsection-title">
              Source records
            </h2>
            <p className="mt-1 text-sm text-ink-2">
              Official records for this member, and the sources behind the header.
            </p>
            {identifiers.length > 0 ? (
              <ol className="mt-4 border-t border-rule">
                {identifiers.map((id, i) => {
                  const link = IDENTIFIER_LINKS[id.scheme];
                  const href = link ? safeHref(link.href(id.value)) : null;
                  return (
                    <li
                      key={`${id.scheme}-${id.value}`}
                      className="flex gap-3 border-b border-rule py-3 text-sm"
                    >
                      <span aria-hidden="true" className="num pt-0.5 text-xs text-ink-3">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0">
                        {href && link ? (
                          <a className="link font-semibold" href={href} rel="noreferrer">
                            {link.label}
                          </a>
                        ) : (
                          <span className="font-semibold">{id.scheme}</span>
                        )}
                        <span className="num mt-0.5 block break-all text-ink-3">{id.value}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-4 border-t border-rule pt-3 text-sm text-ink-3">
                No external record identifiers on file for this member.
              </p>
            )}
            <SourceList notes={headerNotes} title="Sources for the header" />
          </div>
        </section>
      </div>

      <nav aria-label="On this page" className="section-nav mt-12">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.label}
          </a>
        ))}
      </nav>

      <div className="mt-10 min-w-0 space-y-16">
        <Suspense fallback={<SectionFallback id="glance" title="At a glance" />}>
          <GlanceSection slug={slug} />
        </Suspense>
        <Suspense fallback={<SectionFallback id="money" title="Money" />}>
          <MoneySection slug={slug} cycle={Number.isInteger(cycle) ? cycle : null} />
        </Suspense>
        <Suspense fallback={<SectionFallback id="votes" title="Votes" />}>
          <VotesSection
            slug={slug}
            area={area}
            page={Number.isInteger(votesPage) && votesPage > 0 ? votesPage : 1}
            missedVoteRate={card.missedVoteRate}
            votesEligible={card.votesEligible}
          />
        </Suspense>
        <Suspense fallback={<SectionFallback id="scores" title="Scores" />}>
          <ScoresSection slug={slug} name={person.fullName} chamber={card.chamber} />
        </Suspense>
        <Suspense fallback={<SectionFallback id="promises" title="Promises" />}>
          <PromisesSection slug={slug} />
        </Suspense>
        <Suspense fallback={<SectionFallback id="platform" title="Platform and record" />}>
          <PlatformSection slug={slug} platform={platform} />
        </Suspense>

        <ProfileSection
          id="career"
          title="Career"
          lede="Terms served and campaigns run, across offices, from the earliest on record."
        >
          {terms.length === 0 && candidacies.length === 0 ? (
            <p className="text-ink-2">No terms or campaigns on record.</p>
          ) : (
            <CareerTimeline
              terms={terms}
              campaigns={candidacies}
              asOfYear={new Date(card.refreshedAt).getUTCFullYear()}
            />
          )}
          <SourceList notes={careerNotes} />
        </ProfileSection>
      </div>
    </div>
  );
}

/** `raw` is the card field behind the value, exposed as `data-fact` / `data-value`. */
function Fact({
  label,
  value,
  empty = 'No data',
  raw,
}: {
  label: string;
  value: ReactNode;
  empty?: string;
  raw: [field: string, value: number | null];
}) {
  return (
    <div
      data-fact={raw[0]}
      data-value={JSON.stringify(raw[1])}
      className="border-b border-rule py-4"
    >
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="num mt-1 text-xl font-semibold">
        {value ?? <span className="text-base font-normal text-ink-3">{empty}</span>}
      </dd>
    </div>
  );
}
