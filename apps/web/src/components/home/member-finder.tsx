import { read } from '@/server/capabilities';

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  AS: 'American Samoa',
  GU: 'Guam',
  MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico',
  VI: 'U.S. Virgin Islands',
};

/** An ordinary GET form: the same state/district filter available to API and MCP readers. */
export async function MemberFinder() {
  const facets = await read('explore.facets', {});
  const states = [...facets.states].sort((a, b) =>
    (STATE_NAMES[a.value] ?? a.value).localeCompare(STATE_NAMES[b.value] ?? b.value),
  );
  return (
    <section
      aria-labelledby="member-finder-title"
      className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6"
    >
      <div className="grid gap-6 border-t border-ink pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-12">
        <div>
          <h2 id="member-finder-title" className="font-serif text-2xl font-medium">
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
