import { type CapabilityOutput, parseSeatKey } from '@civic-ledger/core';
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

/**
 * Anything that is not an even four-digit cycle in range, or not a canonical seat key,
 * is a 404 here; the capability would answer invalid_input.
 */
function inputOf(cycleParam: string, seat: string, sortParam: string | undefined) {
  const cycle = /^\d{4}$/.test(cycleParam) ? Number(cycleParam) : null;
  if (
    cycle === null ||
    cycle < 1976 ||
    cycle > 2100 ||
    cycle % 2 !== 0 ||
    !/^[a-z]{2}-(?:senate|al|[1-9][0-9]?)$/.test(seat)
  ) {
    notFound();
  }
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
  // One scale for the whole race: the largest receipts reported by any candidate that has its
  // own campaign money. Registrations that share a committee with another are left out: the
  // FEC repeats one committee's totals under each of them.
  const scaleMax = Math.max(
    0,
    ...race.candidates
      .filter((c) => c.sharedCommitteeWith.length === 0)
      .map((c) => c.money?.totalReceiptsCents ?? 0),
  );

  const notes = new SourceNotes('race', sources);
  const candidateMark = notes.cite(race.sources.candidates);
  const moneyMark = notes.cite(race.sources.moneyReports);
  const outsideMark = notes.cite(race.sources.outsideSpending);
  const termMark = notes.cite(race.sources.terms);
  const fecDate = formatDate(
    race.sources.moneyReports?.retrievedAt ?? race.sources.candidates?.retrievedAt ?? null,
  );
  const upDate = formatDate(race.seatsUpOn);
  const termEnds = [...new Set(race.incumbents.map((m) => m.termEnd))];
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
            ? `Seat up in ${race.cycle}: ${
                termEnds.length === 1
                  ? `a sitting member’s term ends ${formatDate(termEnds[0] ?? null)}.`
                  : 'sitting members’ terms end on the dates listed below.'
              }`
            : `No sitting member’s term for this seat ends ${upDate} or at the ${race.cycle} election. These registrations list ${race.cycle} as their election year.`}
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
                  <span className="text-sm text-ink-3">term ends {formatDate(m.termEnd)}</span>
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
            Candidates
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
            ? 'Everyone registered, in alphabetical order by name as filed. Order is not a ranking.'
            : 'Largest amount raised first, as you asked; registrations with no report come last. Raised is money reported so far, not support or votes.'}{' '}
          “No report on file” means the FEC has no campaign finance summary for the registration. It
          does not mean a candidate raised nothing.
        </p>

        {race.candidates.length > 0 ? (
          <>
            <CandidateCards
              cycle={race.cycle}
              candidates={race.candidates}
              scaleMax={scaleMax}
              marks={{ money: moneyMark, outside: outsideMark }}
              notes={notes}
            />
            <CandidateTable
              label={`${title}: every FEC registration`}
              cycle={race.cycle}
              candidates={race.candidates}
              scaleMax={scaleMax}
              marks={{ money: moneyMark, outside: outsideMark }}
              notes={notes}
            />
          </>
        ) : (
          <p className="mt-6 text-ink-2" data-no-registrations>
            Nobody has registered with the FEC for this seat yet.
          </p>
        )}
      </section>

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
  cycle,
  candidates,
  scaleMax,
  marks,
  notes,
}: {
  label: string;
  cycle: number;
  candidates: Candidate[];
  scaleMax: number;
  marks: { money: number | null; outside: number | null };
  notes: SourceNotes;
}) {
  return (
    <ScrollRegion label={label} className="mt-4 hidden lg:block">
      <table className="w-full min-w-[60rem] text-sm">
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
            <CandidateRow key={c.fecCandidateId} c={c} cycle={cycle} scaleMax={scaleMax} />
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function otherSeatLabel(o: Candidate['alsoRegisteredFor'][number]) {
  const seat = o.seat ? parseSeatKey(o.seat) : null;
  if (seat) return raceTitle(seat);
  return `${stateName(o.state)} ${o.chamber === 'senate' ? 'Senate' : 'House'} (no such seat)`;
}

/** The money bar's scale is the largest receipts in this race; shared committees get no bar. */
function moneyBarStyle(c: Candidate, scaleMax: number) {
  const receipts = c.money?.totalReceiptsCents ?? null;
  return receipts !== null && scaleMax > 0 && c.sharedCommitteeWith.length === 0
    ? ({
        '--v': `${Math.round((Math.max(receipts, 0) / scaleMax) * 1000) / 10}%`,
      } as CSSProperties)
    : undefined;
}

/** Name, FEC id, the name as filed and duplicate-registration notes. */
function CandidateIdentity({ c, cycle }: { c: Candidate; cycle: number }) {
  const fecHref = safeHref(c.fecUrl);
  const shared = c.sharedCommitteeWith.length > 0;
  return (
    <>
      <span className="block text-base font-semibold">
        {c.displayName === null ? (
          <span className="nodata text-base">Name not filed</span>
        ) : c.person ? (
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
      {c.nameAsFiled !== null ? (
        <span className="mt-0.5 block text-xs text-ink-3">
          Filed as <span className="num">{c.nameAsFiled}</span>
        </span>
      ) : null}
      {c.alsoRegisteredFor.length > 0 ? (
        <span className="mt-1 block text-xs text-ink-2" data-also-registered>
          Also registered for{' '}
          {c.alsoRegisteredFor.map((o, i) => (
            <span key={o.fecCandidateId}>
              {i > 0 ? ', ' : ''}
              {o.seat ? (
                <Link href={raceHref(cycle, o.seat)} className="link">
                  {otherSeatLabel(o)}
                </Link>
              ) : (
                otherSeatLabel(o)
              )}{' '}
              (<span className="num">{o.fecCandidateId}</span>)
            </span>
          ))}
          {shared ? '; same committee, so its figures are shown under both.' : '.'}
        </span>
      ) : null}
      {c.sameNameAsFiledAs.length > 0 ? (
        <span className="mt-1 block text-xs text-ink-2" data-same-name>
          The same name as filed appears under{' '}
          {c.sameNameAsFiledAs.length === 1 ? 'another FEC id' : 'other FEC ids'} in this race:{' '}
          <span className="num">{c.sameNameAsFiledAs.join(', ')}</span>.
        </span>
      ) : null}
    </>
  );
}

/**
 * Phones and tablets: one record per candidate, so the money is on screen instead of behind a sideways
 * scroll. Same order, same figures and the same "No report on file" wording as the table.
 */
function CandidateCards({
  cycle,
  candidates,
  scaleMax,
  marks,
  notes,
}: {
  cycle: number;
  candidates: Candidate[];
  scaleMax: number;
  marks: { money: number | null; outside: number | null };
  notes: SourceNotes;
}) {
  return (
    <ol className="mt-4 divide-y divide-rule border-y border-rule lg:hidden">
      {candidates.map((c) => {
        const receipts = c.money?.totalReceiptsCents ?? null;
        const cash = c.money?.cashOnHandCents ?? null;
        const barStyle = moneyBarStyle(c, scaleMax);
        return (
          <li key={c.fecCandidateId} className="py-4">
            <CandidateIdentity c={c} cycle={cycle} />
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
              {c.party.code ? (
                <PartyChip party={c.party.name ?? c.party.code} />
              ) : (
                <span className="nodata">Party not filed</span>
              )}
              <span>{c.statusLabel ?? c.status ?? 'Status not filed'}</span>
            </p>
            <dl className="cand-money mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              {c.money ? (
                <>
                  <div className="col-span-2">
                    <dt className="text-xs text-ink-3">
                      Raised
                      <SourceMark notes={notes} n={marks.money} />
                    </dt>
                    <dd>
                      <span className={barStyle ? 'share share-wide' : 'num'} style={barStyle}>
                        {formatCents(receipts)}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">Cash on hand</dt>
                    <dd className="num">
                      {formatCents(cash)}
                      {cash !== null && cash < 0 ? (
                        <span className="ml-1 text-xs text-ink-3">as filed</span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">Report through</dt>
                    <dd className="num">
                      {formatDate(c.money.coverageEndDate) ?? (
                        <span className="nodata">No date</span>
                      )}
                    </dd>
                  </div>
                </>
              ) : (
                <div className="col-span-2">
                  <dt className="text-xs text-ink-3">
                    Raised
                    <SourceMark notes={notes} n={marks.money} />
                  </dt>
                  <dd>
                    <span className="nodata">No report on file</span>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-ink-3">
                  Outside support
                  <SourceMark notes={notes} n={marks.outside} />
                </dt>
                <dd className="num">
                  <Outside cents={c.outsideSpending.supportCents} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-3">Outside oppose</dt>
                <dd className="num">
                  <Outside cents={c.outsideSpending.opposeCents} />
                </dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ol>
  );
}

function CandidateRow({ c, cycle, scaleMax }: { c: Candidate; cycle: number; scaleMax: number }) {
  const receipts = c.money?.totalReceiptsCents ?? null;
  const cash = c.money?.cashOnHandCents ?? null;
  const barStyle = moneyBarStyle(c, scaleMax);
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
        <CandidateIdentity c={c} cycle={cycle} />
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
      {c.money ? (
        <>
          <td className="py-3 pr-4 text-right">
            <span className={barStyle ? 'share share-wide' : 'num'} style={barStyle}>
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
            {formatDate(c.money.coverageEndDate) ?? <span className="nodata">No date</span>}
          </td>
        </>
      ) : (
        <td colSpan={3} className="py-3 pr-4 text-right" data-no-report>
          <span className="nodata">No report on file</span>
        </td>
      )}
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
