import {
  FIRST_NAMES,
  LAST_NAMES,
  SEED_BILLS,
  SEED_OUTSIDE_SPENDERS,
  SEED_PACS,
  SEED_PARTIES,
  SEED_POLICY_AREAS,
  SEED_PROMISES,
  SEED_PUBLISHERS,
  SEED_STANCES,
  SEED_STATES,
  type SeedPolicyAreaId,
} from './catalog';
import { createRandom, type Random } from './random';

/** Natural-key shaped records; the loader resolves them to database ids. */
export interface SeedPerson {
  slug: string;
  firstName: string;
  lastName: string;
  state: string;
  chamber: 'house' | 'senate';
  district: number | null;
  party: string;
  bioguide: string;
  icpsr: string;
  fecCandidateId: string;
  currentTermStart: number;
  firstTermStart: number;
  dim1: number;
  dim2: number;
  missRate: number;
  hasMoney: boolean;
}

export interface SeedTerm {
  slug: string;
  chamber: 'house' | 'senate';
  state: string;
  district: number | null;
  party: string;
  startDate: string;
  endDate: string;
}

export interface SeedCandidacy {
  slug: string;
  cycle: number;
  chamber: 'house' | 'senate';
  state: string;
  district: number | null;
  party: string;
  fecCandidateId: string | null;
  outcome: 'won' | 'lost';
}

export interface SeedCommittee {
  fecCommitteeId: string;
  name: string;
  committeeType: string;
  designation: string;
  industryId: string | null;
  principalFor: string | null;
}

export interface SeedTotals {
  slug: string;
  fecCandidateId: string;
  cycle: number;
  totalReceiptsCents: number;
  individualCents: number;
  unitemizedIndividualCents: number;
  otherCommitteeCents: number;
  partyCents: number;
  candidateSelfCents: number;
  totalDisbursementsCents: number;
  cashOnHandCents: number;
  debtsCents: number;
}

export interface SeedContribution {
  fecSubId: string;
  committeeFecId: string;
  slug: string;
  fecCandidateId: string;
  cycle: number;
  amountCents: number;
  transactionDate: string;
}

export interface SeedOutsideSpending {
  fecTransactionId: string;
  spenderFecId: string;
  spenderName: string;
  slug: string;
  fecCandidateId: string;
  supportOppose: 'support' | 'oppose';
  cycle: number;
  amountCents: number;
  expenditureDate: string;
  purpose: string;
}

export interface SeedBill {
  congress: number;
  billType: 'hr' | 's';
  number: number;
  title: string;
  policyAreaId: SeedPolicyAreaId;
  lean: -1 | 0 | 1;
  sponsorSlug: string;
  introducedDate: string;
}

export interface SeedRollcall {
  congress: number;
  chamber: 'house' | 'senate';
  number: number;
  voteDate: string;
  question: string;
  bill: { billType: 'hr' | 's'; number: number };
  isFinalPassage: boolean;
  positions: { slug: string; position: 'yea' | 'nay' | 'present' | 'not_voting' }[];
}

export interface SeedScore {
  publisherId: string;
  slug: string;
  year: number;
  score: number;
}

export interface SeedPromise {
  promiseKey: string;
  slug: string;
  policyAreaId: SeedPolicyAreaId;
  statement: string;
  madeOn: string;
  status: 'kept' | 'compromise' | 'broken' | 'in_progress' | 'stalled' | 'not_yet_rated';
}

export interface SeedPlatform {
  slug: string;
  cycle: number;
  policyAreaId: SeedPolicyAreaId;
  stance: string;
}

export type SeedRuleTarget =
  | { kind: 'rollcall'; chamber: 'house' | 'senate'; number: number }
  | { kind: 'bill'; billType: 'hr' | 's'; number: number };

export interface SeedFramework {
  slug: string;
  title: string;
  statedOrientation: string;
  description: string;
  rules: { target: SeedRuleTarget; alignedPosition: 'yea' | 'nay'; rationale: string }[];
}

export interface SeedData {
  people: SeedPerson[];
  terms: SeedTerm[];
  candidacies: SeedCandidacy[];
  committees: SeedCommittee[];
  totals: SeedTotals[];
  contributions: SeedContribution[];
  outsideSpending: SeedOutsideSpending[];
  bills: SeedBill[];
  rollcalls: SeedRollcall[];
  scores: SeedScore[];
  promises: SeedPromise[];
  platforms: SeedPlatform[];
  frameworks: SeedFramework[];
}

export const SEED_CONGRESS = 119;
export const SEED_CYCLE = 2024;
const SEED = 20261015;
const PROMISE_STATUSES = [
  'kept',
  'broken',
  'compromise',
  'in_progress',
  'kept',
  'stalled',
  'not_yet_rated',
  'kept',
] as const;

const round = (value: number, digits: number) => Number(value.toFixed(digits));
const dollars = (amount: number) => Math.round(amount) * 100;
const pad = (value: number, width: number) => String(value).padStart(width, '0');
const isoDate = (year: number, month: number, day: number) =>
  `${year}-${pad(month, 2)}-${pad(day, 2)}`;

function partyFor(index: number): string {
  if (index === 5 || index === 18 || index === 33) return SEED_PARTIES.independent;
  return index % 2 === 0 ? SEED_PARTIES.harbor : SEED_PARTIES.prairie;
}

function ideologyFor(party: string, random: Random): { dim1: number; dim2: number } {
  const base =
    party === SEED_PARTIES.harbor ? -0.38 : party === SEED_PARTIES.prairie ? 0.42 : -0.04;
  return {
    dim1: round(base + (random.next() - 0.5) * 0.3, 3),
    dim2: round((random.next() - 0.5) * 0.8, 3),
  };
}

function buildPeople(random: Random): SeedPerson[] {
  const people: SeedPerson[] = [];
  SEED_STATES.forEach((state, stateIndex) => {
    for (let seat = 0; seat < 8; seat++) {
      const index = stateIndex * 8 + seat;
      const firstName = FIRST_NAMES[index] ?? 'Sample';
      const lastName = LAST_NAMES[index] ?? 'Member';
      const chamber = seat < 2 ? 'senate' : 'house';
      const party = partyFor(index);
      const currentTermStart = chamber === 'senate' ? random.pick([2021, 2023, 2025]) : 2025;
      const servedTerms = chamber === 'senate' ? random.int(0, 2) * 6 : random.int(0, 5) * 2;
      people.push({
        slug: `${firstName}-${lastName}`.toLowerCase(),
        firstName,
        lastName,
        state,
        chamber,
        district: chamber === 'senate' ? null : seat - 1,
        party,
        bioguide: `ZZ${pad(index + 1, 5)}`,
        icpsr: String(990_001 + index),
        fecCandidateId: `${chamber === 'senate' ? 'S' : 'H'}4${state}${pad(index + 1, 5)}`,
        currentTermStart,
        firstTermStart: currentTermStart - servedTerms,
        ...ideologyFor(party, random),
        missRate: round(random.next() * 0.12, 3),
        hasMoney: index < 38,
      });
    }
  });
  return people;
}

function buildTerms(people: SeedPerson[]): SeedTerm[] {
  return people.flatMap((p) => {
    const length = p.chamber === 'senate' ? 6 : 2;
    const terms: SeedTerm[] = [];
    for (let year = p.firstTermStart; year <= p.currentTermStart; year += length) {
      terms.push({
        slug: p.slug,
        chamber: p.chamber,
        state: p.state,
        district: p.district,
        party: p.party,
        startDate: isoDate(year, 1, 3),
        endDate: isoDate(year + length, 1, 3),
      });
    }
    return terms;
  });
}

function buildCandidacies(people: SeedPerson[]): SeedCandidacy[] {
  return people.flatMap((p, index) => {
    const seat = { chamber: p.chamber, state: p.state, district: p.district, party: p.party };
    const won: SeedCandidacy = {
      slug: p.slug,
      cycle: p.currentTermStart - 1,
      ...seat,
      fecCandidateId: p.fecCandidateId,
      outcome: 'won',
    };
    // A few members lost an earlier race for the same seat (career history).
    if (index % 7 !== 3) return [won];
    const lost: SeedCandidacy = {
      ...won,
      cycle: p.firstTermStart - 3,
      fecCandidateId: null,
      outcome: 'lost',
    };
    return [lost, won];
  });
}

function buildCommittees(people: SeedPerson[]): SeedCommittee[] {
  const pacs = SEED_PACS.map((pac, i) => ({
    fecCommitteeId: `C99${pad(i + 1, 6)}`,
    name: pac.name,
    committeeType: 'Q',
    designation: 'U',
    industryId: pac.industryId,
    principalFor: null,
  }));
  const spenders = SEED_OUTSIDE_SPENDERS.map((name, i) => ({
    fecCommitteeId: `C99${pad(500 + i, 6)}`,
    name,
    committeeType: 'O',
    designation: 'U',
    industryId: null,
    principalFor: null,
  }));
  const principals = people.map((p, i) => ({
    fecCommitteeId: `C99${pad(1000 + i, 6)}`,
    name: `Friends of ${p.firstName} ${p.lastName} (fictional)`,
    committeeType: p.chamber === 'senate' ? 'S' : 'H',
    designation: 'P',
    industryId: null,
    principalFor: p.slug,
  }));
  return [...pacs, ...spenders, ...principals];
}

function buildTotals(people: SeedPerson[], random: Random): SeedTotals[] {
  return people
    .filter((p) => p.hasMoney)
    .map((p) => {
      const total =
        p.chamber === 'senate' ? random.int(5_000_000, 38_000_000) : random.int(800_000, 9_000_000);
      const pacShare = 0.05 + random.next() * 0.3;
      const partyShare = random.next() * 0.03;
      const selfShare = random.chance(0.2) ? random.next() * 0.08 : 0;
      const individual = total * (1 - pacShare - partyShare - selfShare);
      const disbursements = total * (0.7 + random.next() * 0.25);
      return {
        slug: p.slug,
        fecCandidateId: p.fecCandidateId,
        cycle: SEED_CYCLE,
        totalReceiptsCents: dollars(total),
        individualCents: dollars(individual),
        unitemizedIndividualCents: dollars(individual * (0.12 + random.next() * 0.4)),
        otherCommitteeCents: dollars(total * pacShare),
        partyCents: dollars(total * partyShare),
        candidateSelfCents: dollars(total * selfShare),
        totalDisbursementsCents: dollars(disbursements),
        cashOnHandCents: dollars(total - disbursements),
        debtsCents: random.chance(0.15) ? dollars(random.int(10_000, 250_000)) : 0,
      };
    });
}

function buildContributions(
  people: SeedPerson[],
  pacs: SeedCommittee[],
  random: Random,
): SeedContribution[] {
  return people
    .filter((p) => p.hasMoney)
    .flatMap((p, personIndex) => {
      const count = random.int(4, 8);
      const start = random.int(0, pacs.length - 1);
      return Array.from({ length: count }, (_, k) => {
        const pacIndex = (start + k * 3) % pacs.length;
        const pac = pacs[pacIndex];
        if (!pac) throw new Error('PAC index out of range');
        return {
          fecSubId: `DEVSEED-${pad(personIndex, 3)}-${pad(pacIndex, 2)}`,
          committeeFecId: pac.fecCommitteeId,
          slug: p.slug,
          fecCandidateId: p.fecCandidateId,
          cycle: SEED_CYCLE,
          amountCents: dollars(random.pick([1000, 2500, 5000, 5000, 7500, 10000])),
          transactionDate: isoDate(2024, random.int(1, 10), random.int(1, 28)),
        };
      });
    });
}

function buildOutsideSpending(
  people: SeedPerson[],
  spenders: SeedCommittee[],
  random: Random,
): SeedOutsideSpending[] {
  return people
    .filter((p, index) => p.hasMoney && index % 4 === 0)
    .flatMap((p, k) =>
      Array.from({ length: random.int(1, 2) }, (_, n) => {
        const spender = random.pick(spenders);
        const supportOppose = random.chance(0.55) ? ('support' as const) : ('oppose' as const);
        return {
          fecTransactionId: `DEVSEED-IE-${pad(k, 3)}-${n}`,
          spenderFecId: spender.fecCommitteeId,
          spenderName: spender.name,
          slug: p.slug,
          fecCandidateId: p.fecCandidateId,
          supportOppose,
          cycle: SEED_CYCLE,
          amountCents: dollars(random.int(25_000, 400_000)),
          expenditureDate: isoDate(2024, random.int(8, 10), random.int(1, 28)),
          purpose: supportOppose === 'support' ? 'Digital ads (fictional)' : 'Mailers (fictional)',
        };
      }),
    );
}

function buildBills(people: SeedPerson[], random: Random): SeedBill[] {
  return SEED_BILLS.map((bill, i) => {
    const billType = i % 2 === 0 ? ('hr' as const) : ('s' as const);
    const sponsors = people.filter((p) => p.chamber === (billType === 'hr' ? 'house' : 'senate'));
    return {
      congress: SEED_CONGRESS,
      billType,
      number: 99_001 + i,
      title: bill.title,
      policyAreaId: bill.policyAreaId,
      lean: bill.lean,
      sponsorSlug: random.pick(sponsors).slug,
      introducedDate: isoDate(2025, 1 + (i % 9), 10 + (i % 15)),
    };
  });
}

function castVote(
  person: SeedPerson,
  lean: number,
  random: Random,
): SeedRollcall['positions'][number]['position'] {
  if (random.chance(person.missRate)) return 'not_voting';
  if (random.chance(0.01)) return 'present';
  const yeaProbability = lean === 0 ? 0.92 : 1 / (1 + Math.exp(-7 * lean * person.dim1));
  return random.chance(yeaProbability) ? 'yea' : 'nay';
}

function buildRollcalls(people: SeedPerson[], bills: SeedBill[], random: Random): SeedRollcall[] {
  const nextNumber = { house: 9001, senate: 9001 };
  const rollcalls: SeedRollcall[] = [];
  const add = (
    bill: SeedBill,
    chamber: 'house' | 'senate',
    question: string,
    isFinalPassage: boolean,
    lean: number,
  ) => {
    const index = rollcalls.length;
    rollcalls.push({
      congress: SEED_CONGRESS,
      chamber,
      number: nextNumber[chamber]++,
      voteDate: isoDate(2025 + Math.floor(index / 14), 2 + (index % 10), 3 + (index % 24)),
      question,
      bill: { billType: bill.billType, number: bill.number },
      isFinalPassage,
      positions: people
        .filter((p) => p.chamber === chamber)
        .map((p) => ({ slug: p.slug, position: castVote(p, lean, random) })),
    });
  };
  bills.forEach((bill, i) => {
    const chamber = bill.billType === 'hr' ? 'house' : 'senate';
    if (bill.billType === 'hr' && i % 4 === 0)
      add(bill, chamber, 'On Motion to Recommit', false, -bill.lean);
    add(bill, chamber, 'On Passage', true, bill.lean);
    if (bill.billType === 'hr' && i % 4 === 2) add(bill, 'senate', 'On Passage', true, bill.lean);
  });
  return rollcalls;
}

function buildScores(people: SeedPerson[], random: Random): SeedScore[] {
  const cleared = SEED_PUBLISHERS.filter((p) => p.termsStatus === 'cleared');
  return people
    .filter((_, index) => index % 9 !== 4)
    .flatMap((p) =>
      cleared.flatMap((publisher) =>
        [2024, 2025].map((year) => ({
          publisherId: publisher.id,
          slug: p.slug,
          year,
          score: Math.round(
            Math.min(
              100,
              Math.max(0, 50 + 60 * publisher.direction * p.dim1 + (random.next() - 0.5) * 16),
            ),
          ),
        })),
      ),
    );
}

function buildPromisesAndPlatforms(people: SeedPerson[]): {
  promises: SeedPromise[];
  platforms: SeedPlatform[];
} {
  const promises: SeedPromise[] = [];
  const platforms: SeedPlatform[] = [];
  people.slice(0, 8).forEach((p, i) => {
    const stanceIndex = p.party === SEED_PARTIES.prairie ? 1 : 0;
    for (let k = 0; k < 3; k++) {
      const area = SEED_POLICY_AREAS[(i + k * 3) % SEED_POLICY_AREAS.length];
      if (!area) continue;
      platforms.push({
        slug: p.slug,
        cycle: SEED_CYCLE,
        policyAreaId: area.id,
        stance: SEED_STANCES[area.id][stanceIndex],
      });
      if (k === 2) continue;
      promises.push({
        promiseKey: `dev-seed-${p.slug}-${area.id}`,
        slug: p.slug,
        policyAreaId: area.id,
        statement: SEED_PROMISES[area.id],
        madeOn: isoDate(2024, 3 + k * 4, 12),
        status: PROMISE_STATUSES[(i * 2 + k) % PROMISE_STATUSES.length] ?? 'not_yet_rated',
      });
    }
  });
  return { promises, platforms };
}

function buildFrameworks(bills: SeedBill[], rollcalls: SeedRollcall[]): SeedFramework[] {
  const leaning = bills.filter((b) => b.lean !== 0);
  const passageOf = (bill: SeedBill) =>
    rollcalls.find(
      (r) => r.isFinalPassage && r.bill.number === bill.number && r.bill.billType === bill.billType,
    );
  const framework = (
    slug: string,
    title: string,
    statedOrientation: string,
    direction: 1 | -1,
    offset: number,
  ): SeedFramework => {
    const rollcallRules = leaning.slice(offset, offset + 5).flatMap((bill) => {
      const rc = passageOf(bill);
      if (!rc) return [];
      return [
        {
          target: { kind: 'rollcall' as const, chamber: rc.chamber, number: rc.number },
          alignedPosition: bill.lean * direction > 0 ? ('yea' as const) : ('nay' as const),
          rationale: `Fictional rationale for ${bill.title}.`,
        },
      ];
    });
    const billRules = leaning.slice(offset + 5, offset + 7).map((bill) => ({
      target: { kind: 'bill' as const, billType: bill.billType, number: bill.number },
      alignedPosition: bill.lean * direction > 0 ? ('yea' as const) : ('nay' as const),
      rationale: `Fictional rationale for ${bill.title}.`,
    }));
    return {
      slug,
      title,
      statedOrientation,
      description: 'A fictional framework that exists only in the development seed.',
      rules: [...rollcallRules, ...billRules],
    };
  };
  return [
    framework(
      'sample-fiscal-restraint',
      'Sample Fiscal Restraint Framework (fictional)',
      'fiscally conservative',
      1,
      0,
    ),
    framework(
      'sample-public-investment',
      'Sample Public Investment Framework (fictional)',
      'progressive',
      -1,
      3,
    ),
  ];
}

/** Builds the complete fictional dataset. Pure and deterministic. */
export function buildSeedData(): SeedData {
  const random = createRandom(SEED);
  const people = buildPeople(random);
  const committees = buildCommittees(people);
  const pacs = committees.filter((c) => c.committeeType === 'Q');
  const spenders = committees.filter((c) => c.committeeType === 'O');
  const bills = buildBills(people, random);
  const rollcalls = buildRollcalls(people, bills, random);
  return {
    people,
    terms: buildTerms(people),
    candidacies: buildCandidacies(people),
    committees,
    totals: buildTotals(people, random),
    contributions: buildContributions(people, pacs, random),
    outsideSpending: buildOutsideSpending(people, spenders, random),
    bills,
    rollcalls,
    scores: buildScores(people, random),
    ...buildPromisesAndPlatforms(people),
    frameworks: buildFrameworks(bills, rollcalls),
  };
}
