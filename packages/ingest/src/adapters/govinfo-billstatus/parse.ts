import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { RawSnapshot } from '../../adapter';
import { isoDateOrNull } from '../../parse/values';
import { zipEntries } from '../../parse/zip';
import type { Chamber } from '../lookups';

export const BILL_TYPES = [
  'hr',
  's',
  'hjres',
  'sjres',
  'hconres',
  'sconres',
  'hres',
  'sres',
] as const;
export type BillType = (typeof BILL_TYPES)[number];

export const billstatusZip = (congress: number, type: BillType) =>
  `BILLSTATUS-${congress}-${type}.zip`;

/** Congress.gov path segment per bill type, used when BILLSTATUS lacks `legislationUrl`. */
const URL_SEGMENT: Record<BillType, string> = {
  hr: 'house-bill',
  s: 'senate-bill',
  hjres: 'house-joint-resolution',
  sjres: 'senate-joint-resolution',
  hconres: 'house-concurrent-resolution',
  sconres: 'senate-concurrent-resolution',
  hres: 'house-resolution',
  sres: 'senate-resolution',
};

export interface RecordedVoteRef {
  chamber: Chamber;
  congress: number;
  session: number;
  /** Official clerk roll number within the session. */
  rollNumber: number;
}

export interface BillRecord {
  congress: number;
  billType: BillType;
  number: number;
  title: string;
  introducedDate: string | null;
  url: string;
  latestActionText: string | null;
  latestActionDate: string | null;
  sponsorBioguide: string | null;
  policyArea: string | null;
  subjects: string[];
  recordedVotes: RecordedVoteRef[];
}

const ARRAY_PATHS = new Set([
  'billStatus.bill.actions.item',
  'billStatus.bill.actions.item.recordedVotes.recordedVote',
  'billStatus.bill.sponsors.item',
  'billStatus.bill.subjects.legislativeSubjects.item',
]);

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (_name, jpath) => ARRAY_PATHS.has(String(jpath)),
});

const Text = z.string();
/** An element that is present but empty (`<subjects/>`) parses as ''; treat it as absent. */
const optionalElement = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const BillXmlSchema = z.object({
  billStatus: z.object({
    bill: z.object({
      number: Text,
      type: Text,
      congress: Text,
      title: Text,
      introducedDate: Text.optional(),
      legislationUrl: Text.optional(),
      latestAction: optionalElement(
        z.object({ actionDate: Text.optional(), text: Text.optional() }),
      ),
      sponsors: optionalElement(
        z.object({ item: z.array(z.object({ bioguideId: Text.optional() })) }),
      ),
      policyArea: optionalElement(z.object({ name: Text.optional() })),
      subjects: optionalElement(
        z.object({
          legislativeSubjects: optionalElement(
            z.object({ item: z.array(z.object({ name: Text })) }),
          ),
        }),
      ),
      actions: optionalElement(
        z.object({
          item: z.array(
            z.object({
              recordedVotes: optionalElement(
                z.object({
                  recordedVote: z.array(
                    z.object({
                      rollNumber: Text,
                      chamber: Text,
                      congress: Text,
                      sessionNumber: Text,
                    }),
                  ),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  }),
});

const toInt = (value: string, what: string): number => {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`BILLSTATUS ${what} is not an integer: "${value}"`);
  return n;
};

/** Parses one BILLSTATUS XML document (BILLSTATUS v3). */
export function parseBillXml(xml: string): BillRecord {
  const parsed = BillXmlSchema.safeParse(parser.parse(xml));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Unexpected BILLSTATUS shape at ${issue?.path.join('.')}: ${issue?.message}`);
  }
  const b = parsed.data.billStatus.bill;
  const billType = b.type.toLowerCase() as BillType;
  if (!BILL_TYPES.includes(billType)) throw new Error(`Unknown bill type "${b.type}"`);
  const congress = toInt(b.congress, 'congress');
  const number = toInt(b.number, 'number');

  const votes = new Map<string, RecordedVoteRef>();
  for (const action of b.actions?.item ?? []) {
    for (const v of action.recordedVotes?.recordedVote ?? []) {
      const chamber: Chamber | null =
        v.chamber === 'House' ? 'house' : v.chamber === 'Senate' ? 'senate' : null;
      if (!chamber) continue;
      const ref = {
        chamber,
        congress: toInt(v.congress, 'recordedVote.congress'),
        session: toInt(v.sessionNumber, 'recordedVote.sessionNumber'),
        rollNumber: toInt(v.rollNumber, 'recordedVote.rollNumber'),
      };
      // The same vote is repeated on several actions (floor action + LoC summary action).
      votes.set(`${ref.chamber}|${ref.congress}|${ref.session}|${ref.rollNumber}`, ref);
    }
  }

  const subjects = b.subjects?.legislativeSubjects?.item ?? [];
  return {
    congress,
    billType,
    number,
    title: b.title,
    introducedDate: isoDateOrNull(b.introducedDate),
    url:
      b.legislationUrl ??
      `https://www.congress.gov/bill/${ordinal(congress)}-congress/${URL_SEGMENT[billType]}/${number}`,
    latestActionText: b.latestAction?.text ?? null,
    latestActionDate: isoDateOrNull(b.latestAction?.actionDate),
    sponsorBioguide: b.sponsors?.item[0]?.bioguideId ?? null,
    policyArea: b.policyArea?.name ?? null,
    subjects: [...new Set(subjects.map((s) => s.name))],
    recordedVotes: [...votes.values()],
  };
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

async function readText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** Streams every bill of every type zip; each entry is one small XML document. */
export async function* parseBillstatus(
  snapshot: RawSnapshot,
  congress: number,
): AsyncGenerator<BillRecord> {
  for (const type of BILL_TYPES) {
    const zip = join(snapshot.directory, billstatusZip(congress, type));
    for await (const entry of zipEntries(zip, (name) => name.toLowerCase().endsWith('.xml'))) {
      try {
        yield parseBillXml(await readText(entry.stream));
      } catch (error) {
        throw new Error(
          `${billstatusZip(congress, type)}/${entry.name}: ${(error as Error).message}`,
        );
      }
    }
  }
}
