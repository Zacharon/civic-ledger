import type { Capability } from '../capability';
import { curatedValidate } from './curated';
import { exploreTable } from './explore';
import { frameworksEvaluate, frameworksList } from './frameworks';
import { moneySummary } from './money';
import { peopleCompare, peopleGet, peopleSearch } from './people';
import { policyAreas } from './policy';
import { promisesList } from './promises';
import { scoresList } from './scores';
import { sourcesStatus } from './sources';
import { votesList } from './votes';

/**
 * The single list of capabilities. The web UI, `/api/v1` and MCP dispatch through it;
 * adapters must expose only `audience: 'public'` entries (see `publicCapabilities`).
 * `ingest.run@1` is operator-only and lives in packages/ingest (contract in contracts/ingest).
 */
export const registry = {
  'people.search': peopleSearch,
  'people.get': peopleGet,
  'people.compare': peopleCompare,
  'explore.table': exploreTable,
  'money.summary': moneySummary,
  'votes.list': votesList,
  'scores.list': scoresList,
  'promises.list': promisesList,
  'policy.areas': policyAreas,
  'frameworks.list': frameworksList,
  'frameworks.evaluate': frameworksEvaluate,
  'sources.status': sourcesStatus,
  'curated.validate': curatedValidate,
} as const;

export type Registry = typeof registry;
export type CapabilityName = keyof Registry;

export function isCapabilityName(name: string): name is CapabilityName {
  return Object.hasOwn(registry, name);
}

/** Capabilities an anonymous reader (human or agent) may call. */
export function publicCapabilities(): Capability[] {
  return Object.values(registry).filter((c) => c.audience === 'public');
}
