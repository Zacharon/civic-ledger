/**
 * A user framework lives entirely in the URL (CAPABILITIES.md: frameworks are stateless).
 * `rules=119.house.12.yea,119.hr.99001.nay.w2` — congress, chamber or bill type, number,
 * aligned position, optional weight. Client-safe: no core runtime imports.
 */

import { ordinal } from './format';

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
type BillType = (typeof BILL_TYPES)[number];

export type RuleTargetSpec =
  | { kind: 'rollcall'; congress: number; chamber: 'house' | 'senate'; number: number }
  | { kind: 'bill'; congress: number; billType: BillType; number: number };

export interface RuleSpec {
  target: RuleTargetSpec;
  alignedPosition: 'yea' | 'nay';
  weight?: number;
}

export const MAX_RULES = 200;

const isBillType = (value: string): value is BillType =>
  (BILL_TYPES as readonly string[]).includes(value);

export function encodeRule(rule: RuleSpec): string {
  const t = rule.target;
  const kind = t.kind === 'rollcall' ? t.chamber : t.billType;
  const weight = rule.weight !== undefined && rule.weight !== 1 ? `.w${rule.weight}` : '';
  return `${t.congress}.${kind}.${t.number}.${rule.alignedPosition}${weight}`;
}

export function encodeRules(rules: readonly RuleSpec[]): string {
  return rules.map(encodeRule).join(',');
}

/** Parses one token; returns null for anything malformed (never throws on URL input). */
export function decodeRule(token: string): RuleSpec | null {
  const match = /^(\d{1,3})\.([a-z]+)\.(\d{1,6})\.(yea|nay)(?:\.w(\d{1,3}(?:\.\d{1,2})?))?$/.exec(
    token.trim(),
  );
  if (!match) return null;
  const [, congressText, kind, numberText, position, weightText] = match;
  const congress = Number(congressText);
  const number = Number(numberText);
  if (!kind || congress < 1 || congress > 200 || number < 1) return null;
  const alignedPosition = position === 'nay' ? 'nay' : 'yea';
  const weight = weightText === undefined ? undefined : Number(weightText);
  if (weight !== undefined && (weight <= 0 || weight > 100)) return null;
  let target: RuleTargetSpec;
  if (kind === 'house' || kind === 'senate')
    target = { kind: 'rollcall', congress, chamber: kind, number };
  else if (isBillType(kind)) target = { kind: 'bill', congress, billType: kind, number };
  else return null;
  return { target, alignedPosition, ...(weight !== undefined ? { weight } : {}) };
}

/** Valid rules in order; duplicates of the same target keep the first. */
export function decodeRules(value: string | null | undefined): RuleSpec[] {
  if (!value) return [];
  const seen = new Set<string>();
  const rules: RuleSpec[] = [];
  for (const token of value.split(',')) {
    const rule = decodeRule(token);
    if (!rule) continue;
    const key = targetKey(rule.target);
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push(rule);
    if (rules.length === MAX_RULES) break;
  }
  return rules;
}

export function targetKey(t: RuleTargetSpec): string {
  return t.kind === 'rollcall'
    ? `${t.congress}.${t.chamber}.${t.number}`
    : `${t.congress}.${t.billType}.${t.number}`;
}

export function describeTarget(t: RuleTargetSpec): string {
  if (t.kind === 'rollcall') {
    return `${t.chamber === 'house' ? 'House' : 'Senate'} roll call ${t.number}, ${ordinal(t.congress)} Congress`;
  }
  return `${t.billType.toUpperCase()} ${t.number} (${ordinal(t.congress)} Congress), final passage`;
}
