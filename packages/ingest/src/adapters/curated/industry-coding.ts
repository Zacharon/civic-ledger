import type { CuratedIndustryMapFile, INDUSTRY_RULE_FIELDS } from '@civic-ledger/core';
import type { INDUSTRY_CODING_METHODS } from '@civic-ledger/db';

type Method = (typeof INDUSTRY_CODING_METHODS)[number];
type RuleField = (typeof INDUSTRY_RULE_FIELDS)[number];

export interface CommitteeFacts {
  id: number;
  fecCommitteeId: string;
  name: string;
  connectedOrganization: string | null;
  organizationType: string | null;
  designation: string | null;
  committeeType: string | null;
}

export interface IndustryRule {
  /** `<file>#<rule id>`: provenance for every committee the rule codes. */
  key: string;
  industry: string;
  field: RuleField;
  terms: string[];
  confidence: number;
}

export interface ExplicitCoding {
  key: string;
  fecCommitteeId: string;
  industry: string;
  method: Method;
  confidence: number;
}

export interface Coding {
  committeeId: number;
  industryId: string;
  method: Method;
  confidence: number;
  sourceKey: string;
}

/** Upper-case words separated by single spaces, padded so whole-word search is `includes`. */
export const normalizeName = (value: string): string =>
  ` ${value
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()} `;

const NAME_FIELDS: ReadonlySet<RuleField> = new Set([
  'connected_org',
  'committee_name',
  'any_name',
]);

export function rulesFromFile(file: string, data: CuratedIndustryMapFile): IndustryRule[] {
  return data.rules.map((r) => ({
    key: `${file}#${r.id}`,
    industry: r.industry,
    field: r.field,
    terms: NAME_FIELDS.has(r.field) ? r.any_of.map(normalizeName) : r.any_of,
    confidence: r.confidence,
  }));
}

interface Normalized {
  facts: CommitteeFacts;
  name: string;
  org: string | null;
}

const nameHas = (name: string | null, terms: readonly string[]): boolean =>
  name !== null && terms.some((term) => name.includes(term));

/** The coding method a matching rule implies, or null when the rule does not match. */
function match(rule: IndustryRule, { facts: c, name, org }: Normalized): Method | null {
  const code = (value: string | null) => value !== null && rule.terms.includes(value);
  switch (rule.field) {
    case 'connected_org':
      return nameHas(org, rule.terms) ? 'connected_org' : null;
    case 'committee_name':
      return nameHas(name, rule.terms) ? 'name_rule' : null;
    case 'any_name':
      if (nameHas(org, rule.terms)) return 'connected_org';
      return nameHas(name, rule.terms) ? 'name_rule' : null;
    case 'org_type':
      return code(c.organizationType) ? 'fec_code' : null;
    case 'designation':
      return code(c.designation) ? 'fec_code' : null;
    case 'committee_type':
      return code(c.committeeType) ? 'fec_code' : null;
  }
}

/**
 * One industry per committee: an explicit `committees[]` entry wins; otherwise the first
 * matching rule in file order. Committees nothing matches stay uncoded ("not coded").
 */
export function codeCommittees(
  committees: readonly CommitteeFacts[],
  explicit: readonly ExplicitCoding[],
  rules: readonly IndustryRule[],
): Coding[] {
  const byFecId = new Map(explicit.map((e) => [e.fecCommitteeId, e]));
  const out: Coding[] = [];
  for (const c of committees) {
    const listed = byFecId.get(c.fecCommitteeId);
    if (listed) {
      out.push({
        committeeId: c.id,
        industryId: listed.industry,
        method: listed.method,
        confidence: listed.confidence,
        sourceKey: listed.key,
      });
      continue;
    }
    const normalized: Normalized = {
      facts: c,
      name: normalizeName(c.name),
      org: c.connectedOrganization ? normalizeName(c.connectedOrganization) : null,
    };
    for (const rule of rules) {
      const method = match(rule, normalized);
      if (!method) continue;
      out.push({
        committeeId: c.id,
        industryId: rule.industry,
        method,
        confidence: rule.confidence,
        sourceKey: rule.key,
      });
      break;
    }
  }
  return out;
}
