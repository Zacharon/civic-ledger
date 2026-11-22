import { STATE_NAMES } from '@/lib/states';
import { read } from '@/server/capabilities';

/** An ordinary GET form: the same state/district filter available to API and MCP readers. */
export async function MemberFinder() {
  const facets = await read('explore.facets', {});
  const states = [...facets.states].sort((a, b) =>
    (STATE_NAMES[a.value] ?? a.value).localeCompare(STATE_NAMES[b.value] ?? b.value),
  );
  return (
    <section aria-labelledby="member-finder-title" className="page-frame pb-12">
      <div className="grid gap-6 rule-strong pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-12">
        <div>
          <h2 id="member-finder-title" className="section-title">
            Find your members
          </h2>
          <p id="member-finder-help" className="mt-2 max-w-xl text-ink-2">
            Choose a state or territory. Add your House district to see that seat together with the
            state’s senators. Leave it blank to browse all loaded current members there.
          </p>
          <p className="mt-2 text-sm text-ink-3">
            Results reflect loaded records; vacancies and missing seats may leave gaps.
          </p>
        </div>
        {states.length === 0 ? (
          <p className="text-ink-2">
            No current seats are loaded yet.{' '}
            <a href="/sources" className="link">
              Check source coverage
            </a>
            .
          </p>
        ) : (
          <form
            method="get"
            action="/explore"
            aria-describedby="member-finder-help"
            className="grid content-start gap-4 sm:grid-cols-2"
          >
            <div className="flex min-w-0 flex-col gap-2">
              <label htmlFor="member-state" className="text-sm font-semibold">
                State or territory
              </label>
              <select
                id="member-state"
                className="field w-full"
                name="state"
                required
                defaultValue=""
              >
                <option value="" disabled>
                  Choose a state or territory
                </option>
                {states.map((state) => (
                  <option key={state.value} value={state.value}>
                    {STATE_NAMES[state.value] ?? state.value}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <label htmlFor="member-district" className="text-sm font-semibold">
                House district (optional)
              </label>
              <input
                id="member-district"
                className="field w-full"
                name="district"
                type="number"
                inputMode="numeric"
                min={0}
                max={99}
                step={1}
                aria-describedby="member-district-help"
              />
              <p id="member-district-help" className="text-xs text-ink-3">
                Use 0 for an at-large seat.{' '}
                <a
                  className="link"
                  href="https://www.house.gov/representatives/find-your-representative"
                  rel="noreferrer"
                >
                  Look up your district
                </a>
                .
              </p>
            </div>
            <button className="btn btn-primary justify-self-start sm:col-span-2" type="submit">
              Find members
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
