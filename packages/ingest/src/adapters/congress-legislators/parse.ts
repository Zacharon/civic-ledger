import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { RawSnapshot } from '../../adapter';
import { jsonArrayElements } from '../../parse/json-array';
import type { Chamber, IdentifierScheme } from '../lookups';

export const LEGISLATOR_FILES = [
  'legislators-current.json',
  'legislators-historical.json',
] as const;

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const TermSchema = z.object({
  type: z.enum(['rep', 'sen']),
  start: DateString,
  end: DateString.optional(),
  state: z.string().regex(/^[A-Z]{2}$/),
  district: z.int().optional(),
  party: z.string().min(1).optional(),
  party_affiliations: z
    .array(z.object({ start: DateString, end: DateString, party: z.string().min(1) }))
    .optional(),
});

const LegislatorSchema = z.object({
  id: z.object({
    bioguide: z.string().regex(/^[A-Z]\d{6}$/),
    fec: z.array(z.string().min(1)).optional(),
    icpsr: z.int().optional(),
    opensecrets: z.string().min(1).optional(),
    govtrack: z.int().optional(),
    wikidata: z.string().min(1).optional(),
  }),
  name: z.object({
    first: z.string().min(1),
    last: z.string().min(1),
    official_full: z.string().min(1).optional(),
    suffix: z.string().min(1).optional(),
  }),
  bio: z.object({ birthday: DateString.optional() }).optional(),
  terms: z.array(TermSchema).min(1),
});

export interface LegislatorTerm {
  chamber: Chamber;
  state: string;
  district: number | null;
  party: string;
  start: string;
  end: string | null;
}

export interface LegislatorRecord {
  bioguide: string;
  fullName: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  identifiers: { scheme: IdentifierScheme; value: string }[];
  terms: LegislatorTerm[];
  /** Terms whose source lacked a party (old historical terms). */
  termsWithoutParty: number;
  /** Extra term rows created by splitting a term at a mid-term party switch. */
  partySplits: number;
}

/** Sentinel party for historical terms the source records without one. */
export const UNKNOWN_PARTY = 'Unknown';

/** Streams both legislator files (current first) as normalized person records. */
export async function* parseLegislators(snapshot: RawSnapshot): AsyncGenerator<LegislatorRecord> {
  for (const file of LEGISLATOR_FILES) {
    let index = 0;
    for await (const element of jsonArrayElements(
      createReadStream(join(snapshot.directory, file)),
    )) {
      const parsed = LegislatorSchema.safeParse(element);
      if (!parsed.success) {
        const where = parsed.error.issues[0]?.path.join('.') ?? '';
        throw new Error(`${file}[${index}] ${where}: ${parsed.error.issues[0]?.message}`);
      }
      yield toRecord(parsed.data);
      index++;
    }
  }
}

export function toRecord(raw: z.infer<typeof LegislatorSchema>): LegislatorRecord {
  const { id, name } = raw;
  const identifiers: LegislatorRecord['identifiers'] = [{ scheme: 'bioguide', value: id.bioguide }];
  for (const fec of new Set(id.fec ?? []))
    identifiers.push({ scheme: 'fec_candidate', value: fec });
  if (id.icpsr !== undefined) identifiers.push({ scheme: 'icpsr', value: String(id.icpsr) });
  if (id.opensecrets) identifiers.push({ scheme: 'opensecrets', value: id.opensecrets });
  if (id.govtrack !== undefined)
    identifiers.push({ scheme: 'govtrack', value: String(id.govtrack) });
  if (id.wikidata) identifiers.push({ scheme: 'wikidata', value: id.wikidata });

  let termsWithoutParty = 0;
  let partySplits = 0;
  const terms: LegislatorTerm[] = [];
  for (const term of raw.terms) {
    const chamber: Chamber = term.type === 'sen' ? 'senate' : 'house';
    // c-l: at-large seats and delegates are district 0; -1 marks an unknown district.
    const district =
      chamber === 'senate' || term.district === undefined || term.district < 0
        ? null
        : term.district;
    const base = { chamber, state: term.state, district };
    const segments = term.party_affiliations ?? [];
    if (segments.length > 1) {
      // A mid-term party switch: one term row per affiliation so votes resolve the party
      // the member held on the vote date.
      partySplits += segments.length - 1;
      for (const seg of segments)
        terms.push({ ...base, party: seg.party, start: seg.start, end: seg.end });
      continue;
    }
    if (!term.party) termsWithoutParty++;
    terms.push({
      ...base,
      party: term.party ?? segments[0]?.party ?? UNKNOWN_PARTY,
      start: term.start,
      end: term.end ?? null,
    });
  }

  const fullName =
    name.official_full ??
    [name.first, name.last].join(' ') + (name.suffix ? `, ${name.suffix}` : '');
  return {
    bioguide: id.bioguide,
    fullName,
    firstName: name.first,
    lastName: name.last,
    birthDate: raw.bio?.birthday ?? null,
    identifiers,
    terms,
    termsWithoutParty,
    partySplits,
  };
}
