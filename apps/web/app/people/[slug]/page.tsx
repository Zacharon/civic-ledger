import type { Metadata } from 'next';
import Link from 'next/link';
import { type ReactNode, Suspense } from 'react';
import { CareerTimeline } from '@/components/charts/career-timeline';
import { PositionStrip } from '@/components/charts/position-strip';
import { PartyChip } from '@/components/party-chip';
import { MoneySection } from '@/components/profile/money-section';
import { PlatformSection } from '@/components/profile/platform-section';
import { PromisesSection } from '@/components/profile/promises-section';
import { ScoresSection } from '@/components/profile/scores-section';
import { ProfileSection, SectionFallback } from '@/components/profile/section';
import { VotesSection } from '@/components/profile/votes-section';
import { SourceList, SourceMark, SourceNotes } from '@/components/sources';
import {
  formatCents,
  formatDate,
  formatShare,
  formatYears,
  memberTitle,
  ordinal,
  safeHref,
  seatLabel,
} from '@/lib/format';
import { readOrNotFound } from '@/server/capabilities';
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
  const [profile, sources] = await Promise.all([
    readOrNotFound('people.get', { slug }),
    sourceInfos(),
  ]);
  const { person, card, terms, candidacies, identifiers, platform } = profile;
  const cycle = Number.parseInt(firstParam(query.cycle) ?? '', 10);
  const votesPage = Number.parseInt(firstParam(query.vpage) ?? '', 10);
  const area = firstParam(query.area) ?? null;

  const headerNotes = new SourceNotes('summary', sources);
  const personMark = headerNotes.cite(person.provenance);
  const termMark = headerNotes.cite(terms[0]?.provenance);
  const title = memberTitle(card.chamber);
  const seat = seatLabel(card.chamber, card.state, card.district);
  const careerNotes = new SourceNotes('career', sources);
  careerNotes.citeAll([...terms.map((t) => t.provenance), ...candidacies.map((c) => c.provenance)]);

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 sm:pt-10">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
        <Link href="/explore" className="link">
          Explore
        </Link>{' '}
        / <span aria-current="page">{person.fullName}</span>
      </nav>

      <header className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <h1 className="font-serif text-4xl font-medium tracking-tight sm:text-5xl">
            {person.fullName}
            <SourceMark notes={headerNotes} n={personMark} />
          </h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-lg text-ink-2">
            <PartyChip party={card.party} full />
            <span>
              {title && seat ? `${title}, ${seat}` : (seat ?? 'Seat unknown')}
              <SourceMark notes={headerNotes} n={termMark} />
            </span>
            {card.termStart ? (
              <span className="text-base">
                · Current term began {formatDate(card.termStart)}
                {card.tenureYears !== null ? ` · ${formatYears(card.tenureYears)} in Congress` : ''}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/compare?ids=${slug}`} className="btn btn-primary">
            Compare with others
          </Link>
          <Link
            href={`/explore?q=${encodeURIComponent(person.lastName)}`}
            className="btn btn-secondary"
          >
            Find in table
          </Link>
        </div>
      </header>

      <dl className="mt-8 grid grid-cols-2 border-y border-ink sm:grid-cols-3 lg:grid-cols-6">
        <Fact
          label={card.moneyCycle ? `Raised, ${card.moneyCycle}` : 'Raised'}
          value={formatCents(card.totalReceiptsCents, { compact: true })}
        />
        <Fact label="From PACs" value={formatShare(card.pacShare)} />
        <Fact label="Small donors" value={formatShare(card.smallDollarShare)} />
        <Fact label="Missed votes" value={formatShare(card.missedVoteRate)} />
        <Fact
          label={
            card.ideologyCongress ? `DW-NOMINATE, ${ordinal(card.ideologyCongress)}` : 'DW-NOMINATE'
          }
          value={
            card.dwNominateDim1 === null ? null : (
              <PositionStrip value={card.dwNominateDim1} width={64} />
            )
          }
        />
        <Fact
          label="Promises kept"
          value={
            card.promiseKeptRate === null
              ? null
              : `${formatShare(card.promiseKeptRate)} of ${card.promisesRated}`
          }
          empty={card.promisesRated === null ? 'None tracked' : 'None rated yet'}
        />
      </dl>
      <p className="mt-2 text-xs text-ink-3">
        Summary from the ledger table, rebuilt {formatDate(card.refreshedAt)}. Details and sources
        in each section below.
      </p>

      <div className="mt-12 grid gap-12 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-24 space-y-1 border-l border-rule text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="-ml-px block border-l border-transparent py-1 pl-3 text-ink-2 hover:border-ink hover:text-ink"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-16">
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
            {identifiers.length > 0 ? (
              <div className="mt-10">
                <h3 className="font-semibold">Records elsewhere</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {identifiers.map((id) => {
                    const link = IDENTIFIER_LINKS[id.scheme];
                    const href = link ? safeHref(link.href(id.value)) : null;
                    return (
                      <li key={`${id.scheme}-${id.value}`}>
                        {href && link ? (
                          <a className="link" href={href} rel="noreferrer">
                            {link.label}
                          </a>
                        ) : (
                          id.scheme
                        )}{' '}
                        <span className="num text-ink-3">{id.value}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <SourceList notes={careerNotes} />
          </ProfileSection>
          <SourceList notes={headerNotes} title="Sources for the header" />
        </div>
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  empty = 'No data',
}: {
  label: string;
  value: ReactNode;
  empty?: string;
}) {
  return (
    <div className="border-rule px-1 py-4 sm:px-4 [&:not(:first-child)]:border-l max-sm:[&:nth-child(odd)]:border-l-0">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="num mt-1 text-xl font-semibold">
        {value ?? <span className="text-base font-normal text-ink-3">{empty}</span>}
      </dd>
    </div>
  );
}
