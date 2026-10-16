/**
 * Static vocabulary for the dev seed. Every name here is invented; the seed must never
 * describe a real politician, committee or bill. States use unassigned codes (ZV–ZZ).
 */

export const SEED_STATES = ['ZV', 'ZW', 'ZX', 'ZY', 'ZZ'] as const;

export const SEED_PARTIES = {
  harbor: 'Harbor Party',
  prairie: 'Prairie Party',
  independent: 'Independent',
} as const;

export const FIRST_NAMES = [
  'Avery',
  'Blair',
  'Cameron',
  'Dana',
  'Emerson',
  'Finley',
  'Gray',
  'Harper',
  'Indigo',
  'Jordan',
  'Kendall',
  'Logan',
  'Morgan',
  'Noel',
  'Oakley',
  'Parker',
  'Quinn',
  'Reese',
  'Sage',
  'Tatum',
  'Umber',
  'Val',
  'Wren',
  'Xen',
  'Yael',
  'Zion',
  'Arden',
  'Briar',
  'Corin',
  'Devon',
  'Ellis',
  'Frankie',
  'Greer',
  'Hollis',
  'Ira',
  'Jules',
  'Kai',
  'Lane',
  'Marlow',
  'Nico',
] as const;

export const LAST_NAMES = [
  'Ashvale',
  'Brindlemoor',
  'Corrowind',
  'Dunmere',
  'Elderquay',
  'Fallowmere',
  'Glimmerton',
  'Hollowmere',
  'Ivystead',
  'Juniperfield',
  'Kestrelby',
  'Larkhollow',
  'Mossgrave',
  'Nettlecombe',
  'Oakhaven',
  'Pebbleford',
  'Quillmoor',
  'Rookwell',
  'Saltmarsh',
  'Thistlewood',
  'Umberlane',
  'Valeford',
  'Willowmere',
  'Yarrowby',
  'Zephyrine',
  'Amberleigh',
  'Brackenridge',
  'Cindervale',
  'Driftmoor',
  'Emberly',
  'Frostholm',
  'Greywater',
  'Heathmoor',
  'Ironvale',
  'Jasperton',
  'Kindlewood',
  'Lanternfield',
  'Marrowby',
  'Northquill',
  'Orchardine',
] as const;

/** Real Congress.gov policy-area names (a neutral vocabulary, not facts about anyone). */
export const SEED_POLICY_AREAS = [
  { id: 'health', name: 'Health' },
  { id: 'energy', name: 'Energy' },
  { id: 'taxation', name: 'Taxation' },
  { id: 'agriculture-and-food', name: 'Agriculture and Food' },
  { id: 'armed-forces-and-national-security', name: 'Armed Forces and National Security' },
  { id: 'education', name: 'Education' },
  { id: 'immigration', name: 'Immigration' },
  { id: 'environmental-protection', name: 'Environmental Protection' },
] as const;

export type SeedPolicyAreaId = (typeof SEED_POLICY_AREAS)[number]['id'];

export const SEED_INDUSTRIES = [
  { id: 'energy', name: 'Energy', sector: 'Energy & Natural Resources' },
  { id: 'health', name: 'Health Care', sector: 'Health' },
  { id: 'finance', name: 'Banking & Insurance', sector: 'Finance, Insurance & Real Estate' },
  { id: 'technology', name: 'Software & Electronics', sector: 'Communications & Electronics' },
  { id: 'agriculture', name: 'Crop Production', sector: 'Agribusiness' },
  { id: 'labor', name: 'Building Trades Unions', sector: 'Labor' },
  { id: 'defense', name: 'Defense Aerospace', sector: 'Defense' },
  { id: 'transportation', name: 'Railroads', sector: 'Transportation' },
] as const;

/** `industryId: null` = deliberately not coded, so coverage is below 100%. */
export const SEED_PACS = [
  { name: 'Sample Grid Operators PAC', industryId: 'energy' },
  { name: 'Sample Solar Installers PAC', industryId: 'energy' },
  { name: 'Sample Hospital Association PAC', industryId: 'health' },
  { name: 'Sample Nurses Guild PAC', industryId: 'health' },
  { name: 'Sample Community Bankers PAC', industryId: 'finance' },
  { name: 'Sample Insurers PAC', industryId: 'finance' },
  { name: 'Sample Software Makers PAC', industryId: 'technology' },
  { name: 'Sample Grain Growers PAC', industryId: 'agriculture' },
  { name: 'Sample Electrical Workers PAC', industryId: 'labor' },
  { name: 'Sample Aerospace Suppliers PAC', industryId: 'defense' },
  { name: 'Sample Freight Rail PAC', industryId: 'transportation' },
  { name: 'Sample Citizens for Good Government PAC', industryId: null },
  { name: 'Sample Forward Together PAC', industryId: null },
  { name: 'Sample Leadership PAC', industryId: null },
] as const;

export const SEED_OUTSIDE_SPENDERS = [
  'Sample Future Majority Fund',
  'Sample Taxpayers Action Fund',
  'Sample Main Street Alliance',
] as const;

/**
 * `lean`: +1 = members with higher dim1 tend to vote yea, -1 = the reverse,
 * 0 = broadly bipartisan. Used only to generate plausible-looking fictional votes.
 */
export const SEED_BILLS = [
  { title: 'Sample Rural Clinic Access Act', policyAreaId: 'health', lean: 0 },
  { title: 'Sample Prescription Pricing Transparency Act', policyAreaId: 'health', lean: -1 },
  { title: 'Sample Grid Reliability Act', policyAreaId: 'energy', lean: -1 },
  { title: 'Sample Pipeline Permitting Act', policyAreaId: 'energy', lean: 1 },
  { title: 'Sample Small Business Tax Relief Act', policyAreaId: 'taxation', lean: 1 },
  { title: 'Sample Payroll Levy Adjustment Act', policyAreaId: 'taxation', lean: -1 },
  {
    title: 'Sample Crop Insurance Modernization Act',
    policyAreaId: 'agriculture-and-food',
    lean: 0,
  },
  {
    title: 'Sample Soil Conservation Incentives Act',
    policyAreaId: 'agriculture-and-food',
    lean: -1,
  },
  {
    title: 'Sample Veterans Job Training Act',
    policyAreaId: 'armed-forces-and-national-security',
    lean: 0,
  },
  {
    title: 'Sample Defense Procurement Reform Act',
    policyAreaId: 'armed-forces-and-national-security',
    lean: 1,
  },
  { title: 'Sample Apprenticeship Grants Act', policyAreaId: 'education', lean: -1 },
  { title: 'Sample School Choice Pilot Act', policyAreaId: 'education', lean: 1 },
  { title: 'Sample Seasonal Worker Visa Act', policyAreaId: 'immigration', lean: -1 },
  { title: 'Sample Border Technology Act', policyAreaId: 'immigration', lean: 1 },
  { title: 'Sample Watershed Restoration Act', policyAreaId: 'environmental-protection', lean: -1 },
  { title: 'Sample Regulatory Review Act', policyAreaId: 'environmental-protection', lean: 1 },
] as const satisfies readonly { title: string; policyAreaId: SeedPolicyAreaId; lean: -1 | 0 | 1 }[];

export const SEED_PUBLISHERS = [
  {
    id: 'sample-taxpayer-league',
    name: 'Sample Taxpayer League (fictional)',
    selfDescribedOrientation: 'fiscally conservative',
    termsStatus: 'cleared',
    direction: 1,
  },
  {
    id: 'sample-civic-action-fund',
    name: 'Sample Civic Action Fund (fictional)',
    selfDescribedOrientation: 'progressive',
    termsStatus: 'cleared',
    direction: -1,
  },
  {
    id: 'sample-policy-institute',
    name: 'Sample Policy Institute (fictional)',
    selfDescribedOrientation: 'nonpartisan',
    termsStatus: 'pending',
    direction: 0,
  },
] as const;

/** Two stances per policy area; a member's party picks which one they "stated". */
export const SEED_STANCES: Record<SeedPolicyAreaId, readonly [string, string]> = {
  health: ['Expand public clinic funding in rural areas.', 'Expand health savings accounts.'],
  energy: ['Invest in grid upgrades and storage.', 'Speed up permitting for new generation.'],
  taxation: ['Raise the payroll levy cap.', 'Cut small-business tax rates.'],
  'agriculture-and-food': ['Pay farmers for soil conservation.', 'Lower crop-insurance premiums.'],
  'armed-forces-and-national-security': [
    'Shift procurement savings to veterans programs.',
    'Increase procurement for modernization.',
  ],
  education: ['Grow apprenticeship grants.', 'Pilot school-choice scholarships.'],
  immigration: ['Expand seasonal worker visas.', 'Fund border sensing technology.'],
  'environmental-protection': ['Fund watershed restoration.', 'Require cost review for new rules.'],
};

export const SEED_PROMISES: Record<SeedPolicyAreaId, string> = {
  health: 'Keep rural clinics open at least five days a week.',
  energy: 'Cut average outage time in the home state.',
  taxation: 'Oppose any increase in the sample payroll levy.',
  'agriculture-and-food': 'Protect crop-insurance funding for small farms.',
  'armed-forces-and-national-security': 'Fund job training for every returning veteran.',
  education: 'Double apprenticeship slots at community colleges.',
  immigration: 'Shorten seasonal visa processing to under 60 days.',
  'environmental-protection': 'Restore the home-state watershed within one term.',
};
