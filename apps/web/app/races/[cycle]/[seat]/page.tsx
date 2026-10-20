import type { CapabilityOutput } from '@civic-ledger/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';
import { PartyChip } from '@/components/party-chip';
import { ScrollRegion } from '@/components/scroll-region';
import { SourceList, SourceMark, SourceNotes } from '@/components/sources';
import { formatCents, formatDate, formatNumber, safeHref } from '@/lib/format';
import { REGISTRATION_NOTICE, raceHref, raceTitle, stateName } from '@/lib/races';
import { readOrNotFound } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';

type Race = CapabilityOutput<'races.get'>;
type Candidate = Race['candidates'][number];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Invalid cycles and seat keys map to a key that cannot exist, so the capability answers 404. */
function inputOf(cycleParam: string, seat: string, sortParam: string | undefined) {
  const cycle = /^\d{4}$/.test(cycleParam) ? Number(cycleParam) : null;
  if (cycle === null || !/^[a-z]{2}-(?:senate|al|[1-9][0-9]?)$/.test(seat)) notFound();
  return {
    seat,
    cycle,
    sort: sortParam === 'receipts' ? ('receipts' as const) : ('name' as const),
  };
}

export async function generateMetadata({
  params,
}: PageProps<'/races/[cycle]/[seat]'>): Promise<Metadata> {
  const { cycle, seat } = await params;
  const race = await readOrNotFound('races.get', inputOf(cycle, seat, undefined));
  return {
    title: `${race.cycle} ${raceTitle(race.seat)} race`,
    description: `Everyone registered with the FEC for the ${raceTitle(race.seat)} in ${race.cycle}, with money reported and outside spending, each linked to its source.`,
  };
}

export default async function RacePage({
  params,
  searchParams,
}: PageProps<'/races/[cycle]/[seat]'>) {
  const [{ cycle, seat }, query] = await Promise.all([params, searchParams]);
  const input = inputOf(cycle, seat, first(query.sort));
  const [race, sources] = await Promise.all([readOrNotFound('races.get', input), sourceInfos()]);

  const title = raceTitle(race.seat);
  const withMoney = race.candidates.filter((c) => c.money !== null);
  const withoutMoney = race.candidates.filter((c) => c.money === null);
  // One scale for the whole race: the largest receipts reported by any candidate.
  const scaleMax = Math.max(0, ...withMoney.map((c) => c.money?.totalReceiptsCents ?? 0));

  const notes = new SourceNotes('race', sources);
  const candidateMark = notes.cite(race.sources.candidates);
  const moneyMark = notes.cite(race.sources.moneyReports);
  const outsideMark = notes.cite(race.sources.outsideSpending);
  const termMark = notes.cite(race.sources.terms);
  const fecDate = formatDate(
    race.sources.moneyReports?.retrievedAt ?? race.sources.candidates?.retrievedAt ?? null,
  );
  const upDate = formatDate(race.seatsUpOn);
  const here = raceHref(race.cycle, race.seat.key);

  return (
    <div className="page-frame pt-6 sm:pt-8" data-race={race.seat.key} data-cycle={race.cycle}>
      <header className="max-w-3xl">
        <nav aria-label="Breadcrumb" className="text-sm text-ink-2">
          <Link href="/races" className="link">
            Races
          </Link>{' '}
          <span aria-hidden="true" className="px-1 text-ink-3">
            /
          </span>{' '}
          <Link href={`/races?state=${race.seat.state}`} className="link">
            {stateName(race.seat.state)}
          </Link>{' '}
          <span aria-hidden="true" className="px-1 text-ink-3">
            /
          </span>{' '}
          <span aria-current="page">{title}</span>
        </nav>
        <p className="eyebrow mt-6">
          {race.cycle} {race.seat.chamber === 'senate' ? 'Senate' : 'House'} race
        </p>
        <h1 className="page-title mt-3">{title}</h1>

        <p className="mt-5 text-lg text-ink-2" data-seat-up={race.seatUp ? 'true' : 'false'}>
          {race.seatUp
            ? `Seat up in ${race.cycle}: a sitting member’s term ends ${upDate}.`
            : `No sitting member’s term for this seat ends ${upDate}.`}
          <SourceMark notes={notes} n={termMark} />
        </p>
        {race.senateSeatsUp !== null && race.senateSeatsUp > 1 ? (
          <p className="mt-2 text-ink-2">
            {race.senateSeatsUp} {stateName(race.seat.state)} Senate seats are up this cycle. The
            FEC does not say which seat each candidate is seeking, so candidates for both are listed
            together.
          </p>
        ) : null}
        <div className="mt-2 text-ink-2" data-incumbents>
          {race.incumbents.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {race.incumbents.map((m) => (
                <li key={m.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{race.incumbents.length > 1 ? 'Sitting member:' : 'Incumbent:'}</span>
                  <Link href={`/people/${m.slug}`} className="link font-semibold">
                    {m.fullName}
                  </Link>
                  <PartyChip party={m.party} full />
                </li>
              ))}
            </ul>
          ) : (
            <p>No incumbent on file for this seat.</p>
          )}
        </div>
      </header>

      <p
        role="note"
        className="mt-6 max-w-3xl border-l-2 border-ink bg-surface-sunk px-4 py-3 text-sm"
        data-registration-notice
      >
        {REGISTRATION_NOTICE}
      </p>

      <dl
        className="rule-strong mt-8 grid grid-cols-2 gap-x-6 sm:grid-cols-4"
        data-race-counts={JSON.stringify([
          race.counts.registrations,
          race.counts.activeCandidates,
          race.counts.withMoneyReports,
          race.counts.withoutMoneyReports,
        ])}
      >
        <Count
          label="FEC registrations"
          value={race.counts.registrations}
          mark={candidateMark}
          notes={notes}
        />
        <Count label="Active (FEC status C)" value={race.counts.activeCandidates} />
        <Count
          label="With a money report"
          value={race.counts.withMoneyReports}
          mark={moneyMark}
          notes={notes}
        />
        <Count label="Without a money report" value={race.counts.withoutMoneyReports} />
      </dl>

      <section aria-labelledby="candidates-title" className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 id="candidates-title" className="section-title">
            Candidates with a money report
          </h2>
          <nav aria-label="Order candidates" className="flex items-center gap-3 text-sm text-ink-2">
            <span>Order:</span>
            <Link
              href={here}
              aria-current={race.sort === 'name' ? 'true' : undefined}
              className={
                race.sort === 'name'
                  ? 'font-semibold text-ink underline decoration-2 underline-offset-4'
                  : 'link'
              }
            >
              Name
            </Link>
            <Link
              href={`${here}?sort=receipts`}
              aria-current={race.sort === 'receipts' ? 'true' : undefined}
              className={
                race.sort === 'receipts'
                  ? 'font-semibold text-ink underline decoration-2 underline-offset-4'
                  : 'link'
              }
            >
              Amount raised
            </Link>
          </nav>
        </div>
        <p className="mt-1 text-sm text-ink-2">
          {race.sort === 'name'
            ? 'In alphabetical order by name as filed. Order is not a ranking.'
            : 'Largest amount raised first, as you asked. Raised is money reported so far, not support or votes.'}
        </p>

        {withMoney.length > 0 ? (
          <CandidateTable
            label={`${title}: candidates with a money report`}
            candidates={withMoney}
            scaleMax={scaleMax}
            money
            marks={{ money: moneyMark, outside: outsideMark }}
            notes={notes}
          />
        ) : (
          <p className="mt-6 text-ink-2" data-no-money-reports>
            No candidate in this race has a money report on file yet.
          </p>
        )}
      </section>

      {withoutMoney.length > 0 ? (
        <section aria-labelledby="no-report-title" className="mt-12">
          <details open={withMoney.length === 0} data-no-report-count={withoutMoney.length}>
            <summary className="link cursor-pointer text-base font-semibold">
              <span id="no-report-title">
                {formatNumber(withoutMoney.length)} registered{' '}
                {withoutMoney.length === 1 ? 'candidate has' : 'candidates have'} no money report
              </span>
            </summary>
            <p className="mt-2 max-w-3xl text-sm text-ink-2">
              The FEC has no campaign finance summary for these registrations. That can mean the
              campaign has not raised or spent enough to file, or has not filed yet. It does not
              mean a candidate raised nothing.
            </p>
            <CandidateTable
              label={`${title}: candidates with no money report`}
              candidates={withoutMoney}
              scaleMax={0}
              money={false}
              marks={{ money: null, outside: outsideMark }}
              notes={notes}
            />
          </details>
        </section>
      ) : null}

      <section className="mt-12 max-w-3xl border-t border-rule pt-4 text-sm text-ink-2">
        <p>
          Candidates are the FEC’s registrations for {title} in {race.cycle}. Names are shown in
          reading order; the name exactly as filed is printed under each. Cash on hand is as filed,
          so a negative figure is a figure the campaign reported.{' '}
          {fecDate ? `FEC files downloaded ${fecDate}. ` : ''}
          Outside spending is independent expenditures for or against a candidate, summed by FEC
          candidate id after the FEC’s amendment and duplicate rules.
        </p>
        <p className="mt-2">
          <Link href={`/races?state=${race.seat.state}`} className="link">
            Other {stateName(race.seat.state)} races
          </Link>
          {' · '}
          <Link href="/races" className="link">
            All {race.cycle} races
          </Link>
        </p>
      </section>

      <SourceList notes={notes} title="Sources for this race" />
    </div>
  );
}

function Count({
  label,
  value,
  mark,
  notes,
}: {
  label: string;
  value: number;
  mark?: number | null;
  notes?: SourceNotes;
}) {
  return (
    <div className="border-b border-rule py-4">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="num mt-1 text-xl font-semibold">
        {formatNumber(value)}
        {notes && mark !== undefined ? <SourceMark notes={notes} n={mark} /> : null}
      </dd>
    </div>
  );
}

function CandidateTable({
  label,
  candidates,
  scaleMax,
  money,
  marks,
  notes,
}: {
  label: string;
  candidates: Candidate[];
  scaleMax: number;
  money: boolean;
  marks: { money: number | null; outside: number | null };
  notes: SourceNotes;
}) {
  return (
    <ScrollRegion label={label} className="mt-4">
      <table className={`w-full text-sm ${money ? 'min-w-[60rem]' : 'min-w-[40rem]'}`}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-ink text-left">
            <th scope="col" className="py-2 pr-4 font-semibold">
              Candidate
            </th>
            <th scope="col" className="py-2 pr-4 font-semibold">
              Party
            </th>
            <th scope="col" className="py-2 pr-4 font-semibold">
              FEC status
            </th>
            {money ? (
              <>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">
                  Raised
                  <SourceMark notes={notes} n={marks.money} />
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">
                  Cash on hand
                </th>
                <th scope="col" className="py-2 pr-4 text-right font-semibold">
                  Report through
                </th>
              </>
            ) : null}
            <th scope="col" className="py-2 pr-4 text-right font-semibold">
              Outside support
              <SourceMark notes={notes} n={marks.outside} />
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              Outside oppose
            </th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <CandidateRow key={c.fecCandidateId} c={c} scaleMax={scaleMax} money={money} />
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function CandidateRow({ c, scaleMax, money }: { c: Candidate; scaleMax: number; money: boolean }) {
  const fecHref = safeHref(c.fecUrl);
  const receipts = c.money?.totalReceiptsCents ?? null;
  const cash = c.money?.cashOnHandCents ?? null;
  const barStyle =
    receipts !== null && scaleMax > 0
      ? ({
          '--v': `${Math.round((Math.max(receipts, 0) / scaleMax) * 1000) / 10}%`,
        } as CSSProperties)
      : undefined;
  return (
    <tr
      data-candidate={c.fecCandidateId}
      data-value={JSON.stringify([
        receipts,
        cash,
        c.outsideSpending.supportCents,
        c.outsideSpending.opposeCents,
      ])}
      className="border-b border-rule align-top"
    >
      <th scope="row" className="py-3 pr-4 text-left font-normal">
        <span className="block text-base font-semibold">
          {c.person ? (
            <Link href={`/people/${c.person.slug}`} className="link">
              {c.displayName}
            </Link>
          ) : (
            c.displayName
          )}
        </span>
        <span className="mt-0.5 block text-xs text-ink-3">
          {c.incumbencyLabel ?? 'No incumbency code'} ·{' '}
          {fecHref ? (
            <a href={fecHref} rel="noreferrer" className="link">
              FEC <span className="num">{c.fecCandidateId}</span>
            </a>
          ) : (
            <span className="num">{c.fecCandidateId}</span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-ink-3">
          Filed as <span className="num">{c.nameAsFiled}</span>
        </span>
      </th>
      <td className="py-3 pr-4">
        {c.party.code ? (
          <PartyChip party={c.party.name ?? c.party.code} />
        ) : (
          <span className="nodata">Not filed</span>
        )}
      </td>
      <td className="py-3 pr-4">
        <span className="block">{c.statusLabel ?? c.status ?? 'Not filed'}</span>
      </td>
      {money ? (
        <>
          <td className="py-3 pr-4 text-right">
            <span className="share share-wide" style={barStyle}>
              {formatCents(receipts)}
            </span>
          </td>
          <td className="num py-3 pr-4 text-right">
            {formatCents(cash)}
            {cash !== null && cash < 0 ? (
              <span className="ml-1 text-xs text-ink-3">as filed</span>
            ) : null}
          </td>
          <td className="num py-3 pr-4 text-right whitespace-nowrap">
            {formatDate(c.money?.coverageEndDate ?? null) ?? (
              <span className="nodata">No date</span>
            )}
          </td>
        </>
      ) : null}
      <td className="num py-3 pr-4 text-right">
        <Outside cents={c.outsideSpending.supportCents} />
      </td>
      <td className="num py-3 text-right">
        <Outside cents={c.outsideSpending.opposeCents} />
      </td>
    </tr>
  );
}

function Outside({ cents }: { cents: number }) {
  return cents === 0 ? <span className="nodata">None reported</span> : formatCents(cents);
}
