import type { CapabilityOutput } from '@civic-ledger/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PartyChip } from '@/components/party-chip';
import { ScrollRegion } from '@/components/scroll-region';
import { SourceList, SourceNotes } from '@/components/sources';
import { formatDate, formatNumber, safeHref } from '@/lib/format';
import { REGISTRATION_NOTICE, raceHref, sortedStates, stateName } from '@/lib/races';
import { STATE_NAMES } from '@/lib/states';
import { read } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';

export const metadata: Metadata = {
  title: 'Races',
  description:
    'Every House and Senate seat in the election cycle, with the candidates registered with the FEC and the money reported, each linked to its source.',
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

type RaceList = CapabilityOutput<'races.list'>;
type Item = RaceList['items'][number];

/**
 * Default view: the Senate table and one line per state for the House (the full House list
 * is ~500 rows). A state (`?state=GA`) shows its Senate and House tables in full; so do
 * `?chamber=senate` for the Senate. `?chamber=house` shows the House by state.
 */
export default async function RacesPage({ searchParams }: PageProps<'/races'>) {
  const query = await searchParams;
  const stateParam = first(query.state)?.trim().toUpperCase();
  const state = stateParam && /^[A-Z]{2}$/.test(stateParam) ? stateParam : undefined;
  const chamberParam = first(query.chamber);
  const chamber = chamberParam === 'senate' || chamberParam === 'house' ? chamberParam : undefined;
  const filtered = Boolean(state || chamber);

  const [list, sources] = await Promise.all([
    read('races.list', { state, chamber }),
    sourceInfos(),
  ]);
  const senate = list.items.filter((i) => i.seat.chamber === 'senate');
  const house = list.items.filter((i) => i.seat.chamber === 'house');
  const houseByState = Map.groupBy(house, (i) => i.seat.state);
  // Full tables only for one state; everything else gets the compact House-by-state list.
  const fullHouse = state !== undefined;

  const notes = new SourceNotes('races', sources);
  notes.cite(list.sources.candidates);
  notes.cite(list.sources.moneyReports);
  notes.cite(list.sources.outsideSpending);
  notes.cite(list.sources.terms);
  const fecDate = formatDate(list.sources.candidates?.retrievedAt ?? null);
  // The states and territories the FEC and congress-legislators use, plus any other code
  // present in the data (the development seed has none of the real ones) or requested.
  const stateOptions = sortedStates([
    ...Object.keys(STATE_NAMES),
    ...list.items.map((i) => i.seat.state),
    ...(state ? [state] : []),
  ]);

  return (
    <div className="page-frame pt-8 sm:pt-10">
      <header className="max-w-3xl">
        <p className="eyebrow">{list.cycle} elections</p>
        <h1 className="page-title mt-3">{list.cycle} races</h1>
        <p className="lede mt-4">
          Every Senate and House seat with a registered candidate or a sitting member whose term
          ends on {formatDate(list.seatsUpOn)} (or at the November election, for an appointed
          senator). Open a seat to see everyone registered with the FEC, the money each reported,
          and the outside spending for and against.
        </p>
      </header>

      <p
        role="note"
        className="mt-6 max-w-3xl border-l-2 border-ink bg-surface-sunk px-4 py-3 text-sm"
        data-registration-notice
      >
        {REGISTRATION_NOTICE}
      </p>

      <form
        method="get"
        action="/races"
        aria-label="Filter races"
        className="rule-strong mt-8 grid gap-4 pt-6 sm:grid-cols-[minmax(0,16rem)_minmax(0,14rem)_auto] sm:items-end"
      >
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor="race-state" className="text-sm font-semibold">
            State or territory
          </label>
          <select id="race-state" name="state" className="field w-full" defaultValue={state ?? ''}>
            <option value="">All states</option>
            {stateOptions.map((code) => (
              <option key={code} value={code}>
                {stateName(code)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor="race-chamber" className="text-sm font-semibold">
            Chamber
          </label>
          <select
            id="race-chamber"
            name="chamber"
            className="field w-full"
            defaultValue={chamber ?? ''}
          >
            <option value="">Both chambers</option>
            <option value="senate">Senate</option>
            <option value="house">House</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary">
            Show races
          </button>
          {filtered ? (
            <Link href="/races" className="link text-sm">
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>

      <dl
        className="mt-8 grid grid-cols-2 gap-x-6 border-t border-rule sm:grid-cols-5"
        data-races-totals={JSON.stringify([
          list.totals.seats,
          list.totals.registrations,
          list.totals.activeCandidates,
          list.totals.candidatesWithMoneyReports,
          list.totals.candidatesWithoutMoneyReports,
        ])}
      >
        <Total label="Seats" value={list.totals.seats} />
        <Total label="FEC registrations" value={list.totals.registrations} />
        <Total label="Active (FEC status C)" value={list.totals.activeCandidates} />
        <Total label="With a money report" value={list.totals.candidatesWithMoneyReports} />
        <Total label="Without a money report" value={list.totals.candidatesWithoutMoneyReports} />
      </dl>
      <p className="mt-2 text-xs text-ink-3">
        {formatNumber(list.totals.seatsWithoutRegistrations)} of these seats have no registered
        candidate yet.
        {list.totals.unplacedRegistrations > 0
          ? ` A further ${formatNumber(list.totals.unplacedRegistrations)} registrations match no seat (a district that does not exist, or none filed); they are listed on each state’s page.`
          : ''}
        {fecDate ? ` FEC files downloaded ${fecDate}.` : ''}
      </p>

      {list.items.length === 0 && list.unplaced.length === 0 ? (
        <p className="mt-10 text-ink-2">
          No races match these filters.{' '}
          <Link href="/races" className="link">
            Show all races
          </Link>
        </p>
      ) : null}

      {chamber !== 'house' && senate.length > 0 ? (
        <section id="senate" aria-labelledby="senate-title" className="rule-strong mt-12 pt-4">
          <h2 id="senate-title" className="section-title">
            Senate
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            {formatNumber(senate.length)} {senate.length === 1 ? 'state' : 'states'}. A state with
            no Senate seat up in {list.cycle} appears only if someone registered there.
          </p>
          <SeatTable
            label={`${list.cycle} Senate races by state`}
            cycle={list.cycle}
            items={senate}
            firstColumn="State"
          />
        </section>
      ) : null}

      {chamber !== 'senate' && house.length > 0 ? (
        <section id="house" aria-labelledby="house-title" className="rule-strong mt-12 pt-4">
          <h2 id="house-title" className="section-title">
            House
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            {formatNumber(house.length)} seats in {formatNumber(houseByState.size)}{' '}
            {houseByState.size === 1 ? 'state or territory' : 'states and territories'}.{' '}
            {fullHouse
              ? 'An at-large seat is the state’s only House seat.'
              : 'Choose a state to see each district.'}
          </p>
          {fullHouse ? (
            <div className="mt-6 space-y-10">
              {sortedStates(houseByState.keys()).map((code) => {
                const items = houseByState.get(code) ?? [];
                return (
                  <div key={code} data-state={code}>
                    <h3 id={`house-${code.toLowerCase()}`} className="subsection-title scroll-mt-6">
                      {stateName(code)}{' '}
                      <span className="num text-base font-normal text-ink-3">
                        {formatNumber(items.length)} {items.length === 1 ? 'seat' : 'seats'}
                      </span>
                    </h3>
                    <SeatTable
                      label={`${list.cycle} House races in ${stateName(code)}`}
                      cycle={list.cycle}
                      items={items}
                      firstColumn="District"
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <ul
              className="mt-4 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3"
              aria-label={`${list.cycle} House races by state`}
            >
              {sortedStates(houseByState.keys()).map((code) => {
                const items = houseByState.get(code) ?? [];
                const registrations = items.reduce((n, i) => n + i.registrations, 0);
                return (
                  <li
                    key={code}
                    data-state-summary={code}
                    data-value={JSON.stringify([items.length, registrations])}
                    className="flex items-baseline justify-between gap-3 border-b border-rule py-2"
                  >
                    <Link href={`/races?state=${code}`} className="link">
                      {stateName(code)}
                    </Link>
                    <span className="num text-sm text-ink-2">
                      {formatNumber(items.length)} {items.length === 1 ? 'seat' : 'seats'},{' '}
                      {formatNumber(registrations)} registered
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {list.unplaced.length > 0 && state ? (
        <section
          id="unplaced"
          aria-labelledby="unplaced-title"
          className="rule-strong mt-12 pt-4"
          data-unplaced
        >
          <h2 id="unplaced-title" className="section-title">
            Registrations that match no seat
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">
            The FEC lists these under a district that does not exist in {stateName(state)}, or with
            no district where there are several. They are shown as filed, not placed in a race.
          </p>
          <ScrollRegion
            label={`Registrations in ${stateName(state)} that match no seat`}
            className="mt-3"
          >
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">Registrations that match no seat</caption>
              <thead>
                <tr className="border-b border-ink text-left">
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Filed as
                  </th>
                  <th scope="col" className="py-2 pr-4 font-semibold">
                    Candidates
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.unplaced.map((u) => (
                  <tr
                    key={`${u.chamber}|${u.districtAsFiled}`}
                    data-unplaced-group={`${u.chamber}|${u.state}|${u.districtAsFiled ?? ''}`}
                    className="border-b border-rule align-top"
                  >
                    <th scope="row" className="py-3 pr-4 text-left font-normal">
                      {u.chamber === 'senate'
                        ? 'Senate: no Senate seat'
                        : u.districtAsFiled === null
                          ? 'House: district not filed'
                          : `House: district as filed ${u.districtAsFiled} (no such district)`}
                    </th>
                    <td className="py-3 pr-4">
                      <ul className="space-y-1">
                        {u.candidates.map((c) => {
                          const href = safeHref(c.fecUrl);
                          return (
                            <li
                              key={c.fecCandidateId}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <span>
                                {c.displayName ?? <span className="nodata">Name not filed</span>}
                              </span>
                              <PartyChip party={c.party.name ?? c.party.code} />
                              {href ? (
                                <a href={href} rel="noreferrer" className="link text-xs">
                                  FEC <span className="num">{c.fecCandidateId}</span>
                                </a>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </section>
      ) : null}

      <SourceList notes={notes} title="Sources for this page" />
    </div>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-b border-rule py-4">
      <dt className="text-sm text-ink-2">{label}</dt>
      <dd className="num mt-1 text-xl font-semibold">{formatNumber(value)}</dd>
    </div>
  );
}

function SeatTable({
  label,
  cycle,
  items,
  firstColumn,
}: {
  label: string;
  cycle: number;
  items: Item[];
  firstColumn: 'State' | 'District';
}) {
  return (
    <ScrollRegion label={label} className="mt-3">
      <table className="w-full min-w-[40rem] text-sm">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-ink text-left">
            <th scope="col" className="py-2 pr-4 font-semibold">
              {firstColumn}
            </th>
            <th scope="col" className="py-2 pr-4 font-semibold">
              Sitting member (seat up)
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-semibold">
              Registered
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-semibold">
              Active
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              With money report
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr
              key={i.seat.key}
              data-seat={i.seat.key}
              data-value={JSON.stringify([
                i.registrations,
                i.activeCandidates,
                i.candidatesWithMoneyReports,
              ])}
              className="rt-row"
            >
              <th scope="row" className="rt-head">
                <Link href={raceHref(cycle, i.seat.key)} className="link text-base">
                  {firstColumn === 'State'
                    ? stateName(i.seat.state)
                    : i.seat.district === 0
                      ? 'At-large'
                      : `District ${i.seat.district}`}
                </Link>
              </th>
              <td className="rt-cell">
                {i.incumbents.length > 0 ? (
                  <ul className="space-y-1">
                    {i.incumbents.map((m) => (
                      <li key={m.slug} className="flex flex-wrap items-center gap-2">
                        <Link href={`/people/${m.slug}`} className="link">
                          {m.fullName}
                        </Link>
                        <PartyChip party={m.party} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="nodata">No sitting member up</span>
                )}
              </td>
              <td className="rt-num">{formatNumber(i.registrations)}</td>
              <td className="rt-num">{formatNumber(i.activeCandidates)}</td>
              <td className="rt-num">{formatNumber(i.candidatesWithMoneyReports)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
