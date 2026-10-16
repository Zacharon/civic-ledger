import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import type { RawSnapshot } from '../../adapter';
import { headerCsvRows } from '../../parse/csv';
import { isoDateOrNull, parseFloatOrNull, parseIntOrNull, trimOrNull } from '../../parse/values';
import type { Chamber } from '../lookups';

/** Voteview names files by 3-digit congress: HS119_members.csv. */
export const voteviewPrefix = (congress: number) => `HS${String(congress).padStart(3, '0')}`;
export const voteviewFiles = (congress: number) => {
  const p = voteviewPrefix(congress);
  return {
    members: `${p}_members.csv`,
    rollcalls: `${p}_rollcalls.csv`,
    votes: `${p}_votes.csv`,
  } as const;
};

export interface MemberRecord {
  kind: 'member';
  congress: number;
  chamber: Chamber;
  icpsr: string;
  bioguide: string | null;
  bioname: string;
  dim1: number | null;
  dim2: number | null;
  /** Voteview `conditional = 1`: a provisional estimate. */
  provisional: boolean;
}

export interface RollcallRecord {
  kind: 'rollcall';
  congress: number;
  chamber: Chamber;
  /** Voteview `rollnumber`: its own per-congress sequence (not the clerk's number). */
  number: number;
  session: number | null;
  clerkNumber: number | null;
  date: string;
  question: string;
  description: string | null;
  result: string;
  yeaCount: number;
  nayCount: number;
}

export interface VoteRecord {
  kind: 'vote';
  congress: number;
  chamber: Chamber;
  number: number;
  icpsr: string;
  castCode: number;
}

/** Voteview's President row: its icpsr appears in the votes file as stated positions. */
export interface PresidentRecord {
  kind: 'president';
  icpsr: string;
}

export type VoteviewRecord = MemberRecord | RollcallRecord | VoteRecord | PresidentRecord;

const MEMBER_COLUMNS = [
  'congress',
  'chamber',
  'icpsr',
  'bioguide_id',
  'bioname',
  'nominate_dim1',
  'nominate_dim2',
  'conditional',
] as const;
const ROLLCALL_COLUMNS = [
  'congress',
  'chamber',
  'rollnumber',
  'date',
  'session',
  'clerk_rollnumber',
  'yea_count',
  'nay_count',
  'vote_result',
  'vote_desc',
  'vote_question',
  'dtl_desc',
] as const;
const VOTE_COLUMNS = ['congress', 'chamber', 'rollnumber', 'icpsr', 'cast_code'] as const;

function chamberOf(value: string | undefined): Chamber | null {
  if (value === 'House') return 'house';
  if (value === 'Senate') return 'senate';
  return null;
}

function required<T>(value: T | null, what: string, line: number): T {
  if (value === null) throw new Error(`${what} missing on line ${line}`);
  return value;
}

/** Members, then rollcalls, then votes: the loader needs members before it can map votes. */
export async function* parseVoteview(
  snapshot: RawSnapshot,
  congress: number,
): AsyncGenerator<VoteviewRecord> {
  const files = voteviewFiles(congress);
  const open = (name: string) => createReadStream(join(snapshot.directory, name));

  let line = 1;
  for await (const row of headerCsvRows(open(files.members), MEMBER_COLUMNS)) {
    line++;
    const chamber = chamberOf(row.chamber);
    if (!chamber) {
      yield { kind: 'president', icpsr: (row.icpsr ?? '').trim() };
      continue;
    }
    yield {
      kind: 'member',
      congress: required(parseIntOrNull(row.congress), 'congress', line),
      chamber,
      icpsr: required(trimOrNull(row.icpsr), 'icpsr', line),
      bioguide: trimOrNull(row.bioguide_id),
      bioname: row.bioname ?? '',
      dim1: parseFloatOrNull(row.nominate_dim1),
      dim2: parseFloatOrNull(row.nominate_dim2),
      provisional: row.conditional?.trim() === '1',
    };
  }

  line = 1;
  for await (const row of headerCsvRows(open(files.rollcalls), ROLLCALL_COLUMNS)) {
    line++;
    const chamber = chamberOf(row.chamber);
    if (!chamber)
      throw new Error(`${files.rollcalls} line ${line}: unknown chamber "${row.chamber}"`);
    yield {
      kind: 'rollcall',
      congress: required(parseIntOrNull(row.congress), 'congress', line),
      chamber,
      number: required(parseIntOrNull(row.rollnumber), 'rollnumber', line),
      session: parseIntOrNull(row.session),
      clerkNumber: parseIntOrNull(row.clerk_rollnumber),
      date: required(isoDateOrNull(row.date), 'date', line),
      question:
        trimOrNull(row.vote_question) ?? trimOrNull(row.vote_desc) ?? '(question not recorded)',
      description: trimOrNull(row.vote_desc) ?? trimOrNull(row.dtl_desc),
      result: trimOrNull(row.vote_result) ?? '(result not recorded)',
      yeaCount: parseIntOrNull(row.yea_count) ?? 0,
      nayCount: parseIntOrNull(row.nay_count) ?? 0,
    };
  }

  line = 1;
  for await (const row of headerCsvRows(open(files.votes), VOTE_COLUMNS)) {
    line++;
    const chamber = chamberOf(row.chamber);
    if (!chamber) continue;
    yield {
      kind: 'vote',
      congress: required(parseIntOrNull(row.congress), 'congress', line),
      chamber,
      number: required(parseIntOrNull(row.rollnumber), 'rollnumber', line),
      icpsr: required(trimOrNull(row.icpsr), 'icpsr', line),
      castCode: required(parseIntOrNull(row.cast_code), 'cast_code', line),
    };
  }
}
