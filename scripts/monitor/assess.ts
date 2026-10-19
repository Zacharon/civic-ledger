import { createHash } from 'node:crypto';

export const SOURCE_POLICY = {
  'congress-legislators': { attemptHours: 30, freshHours: 48 },
  'govinfo-billstatus': { attemptHours: 30, freshHours: 48 },
  'fec-bulk': { attemptHours: 8 * 24, freshHours: 14 * 24 },
  voteview: { attemptHours: 8 * 24, freshHours: 14 * 24 },
} as const;
export interface Run {
  status: string;
  startedAt: string;
  finishedAt: string | null;
}
export interface Source {
  id: string;
  lastRun: Run | null;
  lastSuccess: Run | null;
}
export interface Observation {
  time: string;
  liveStatus: number | null;
  readyStatus: number | null;
  sources: Source[] | null;
  backupTakenAt: string | null;
  backupAuthenticated: boolean;
  rawBackupTakenAt?: string | null;
  rawBackupAuthenticated?: boolean;
  backupWorkflowConclusion?: string | null;
}
export interface Finding {
  key: string;
  severity: 'SEV1' | 'SEV2';
  title: string;
  reason: string;
}
export interface ExistingIssue {
  number: number;
  body: string | null;
  title?: string;
}
export interface IssueDraft {
  fingerprint: string;
  action: 'create' | 'already_open';
  existingIssue?: number;
  title: string;
  body: string;
  assignees: string[];
  labels: string[];
}
/** Project public receipts; arbitrary upstream error/source text never enters draft artifacts. */
export function normalizeSources(value: unknown): Source[] {
  if (!Array.isArray(value)) throw new Error('source status must contain a sources array');
  const run = (input: unknown): Run | null => {
    if (input === null) return null;
    if (!input || typeof input !== 'object') throw new Error('source run is malformed');
    const row = input as Record<string, unknown>;
    if (
      !['running', 'succeeded', 'failed', 'partial', 'cancelled'].includes(String(row.status)) ||
      typeof row.startedAt !== 'string' ||
      !Number.isFinite(Date.parse(row.startedAt)) ||
      !(
        row.finishedAt === null ||
        (typeof row.finishedAt === 'string' && Number.isFinite(Date.parse(row.finishedAt)))
      )
    )
      throw new Error('source run is malformed');
    return {
      status: String(row.status),
      startedAt: row.startedAt,
      finishedAt: row.finishedAt as string | null,
    };
  };
  return value.map((input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('source status is malformed');
    const row = input as Record<string, unknown>;
    if (typeof row.id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(row.id))
      throw new Error('source id is malformed');
    return { id: row.id, lastRun: run(row.lastRun), lastSuccess: run(row.lastSuccess) };
  });
}
function ageHours(value: string | null | undefined, now: number): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed > now + 5 * 60_000) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - parsed) / 3_600_000);
}
export function assess(observation: Observation): Finding[] {
  const now = Date.parse(observation.time);
  if (!Number.isFinite(now)) throw new Error('monitor clock must be a valid timestamp');
  const findings: Finding[] = [];
  const add = (
    key: string,
    title: string,
    reason: string,
    severity: Finding['severity'] = 'SEV2',
  ) => {
    findings.push({ key, title, reason, severity });
  };
  if (observation.liveStatus !== 200)
    add(
      'site:liveness',
      'Site liveness failed',
      'Liveness request failed or did not return HTTP 200 after the confirmation probe.',
      'SEV1',
    );
  if (observation.readyStatus !== 200)
    add(
      'site:readiness',
      'Site database readiness failed',
      'Readiness request failed or did not return HTTP 200 after the confirmation probe.',
      'SEV1',
    );
  if (observation.sources === null)
    add(
      'ingest:status-unavailable',
      'Ingest status could not be read',
      'The public sources.status capability did not return a valid status payload.',
    );
  else {
    for (const [id, policy] of Object.entries(SOURCE_POLICY)) {
      const source = observation.sources.find((s) => s.id === id);
      if (!source) {
        add(
          `ingest:${id}:missing`,
          `${id}: source has not been loaded`,
          'The expected source is absent from the run ledger.',
        );
        continue;
      }
      if (ageHours(source.lastSuccess?.finishedAt, now) > policy.freshHours)
        add(
          `ingest:${id}:stale`,
          `${id}: published data is stale`,
          `No valid successful receipt within ${policy.freshHours} hours. Inspect Sources and the ingest workflow.`,
        );
      if (ageHours(source.lastRun?.startedAt, now) > policy.attemptHours)
        add(
          `ingest:${id}:missed`,
          `${id}: scheduled ingest was missed`,
          `No valid attempt receipt within ${policy.attemptHours} hours. Check the schedule, credentials and runner availability.`,
        );
      if (source.lastRun && ['failed', 'partial', 'cancelled'].includes(source.lastRun.status))
        add(
          `ingest:${id}:failed`,
          `${id}: latest ingest failed`,
          'The latest run is failed, partial or cancelled. Review its receipt; successful prior publication may still be available.',
        );
      if (source.lastRun?.status === 'running' && ageHours(source.lastRun.startedAt, now) > 2)
        add(
          `ingest:${id}:stuck`,
          `${id}: ingest has exceeded two hours`,
          'Inspect the runner before retrying. Do not delete the advisory lock or overwrite the last publication.',
        );
    }
  }
  if (!observation.backupAuthenticated || ageHours(observation.backupTakenAt, now) > 24)
    add(
      'backup:stale',
      'Off-provider backup is missing, invalid or over 24 hours old',
      'An authenticated successful archive within the 24-hour recovery-point target could not be established. Inspect the backup workflow and archive access.',
    );
  if (
    observation.backupWorkflowConclusion &&
    !['success', 'neutral', 'skipped'].includes(observation.backupWorkflowConclusion)
  )
    add(
      'backup:workflow-failed',
      'Latest backup workflow failed',
      'The latest completed backup workflow did not succeed. The last successful archive may still be available.',
    );
  if (!observation.rawBackupAuthenticated || ageHours(observation.rawBackupTakenAt, now) > 24)
    add(
      'backup:raw-stale',
      'Raw provenance archive is missing, invalid or over 24 hours old',
      'The signed raw-snapshot archive does not establish preservation within 24 hours. Inspect the quiesced archive command and source checksums.',
    );
  return findings;
}
export function issueDrafts(
  findings: Finding[],
  existing: ExistingIssue[],
  assignee: string,
): IssueDraft[] {
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(assignee))
    throw new Error('CIVIC_ALERT_ASSIGNEE must name the owner GitHub login');
  return [...new Map(findings.map((finding) => [finding.key, finding])).values()].map((finding) => {
    const fingerprint = createHash('sha256')
      .update(`civic-ledger-ops@1:${finding.key}`)
      .digest('hex');
    const marker = `<!-- civic-ledger-ops:${fingerprint} -->`;
    const match = existing.find((issue) => issue.body?.includes(marker));
    return {
      fingerprint,
      action: match ? 'already_open' : 'create',
      ...(match ? { existingIssue: match.number } : {}),
      title: `[${finding.severity}] ${finding.title}`,
      body: `${marker}\n\n${finding.reason}\n\nOwner: @${assignee}. See docs/DEPLOY_RENDER.md and docs/OPERATIONS.md for recovery.\n\nThis draft contains no connection strings or remote error text. Verify impact before publishing a public status claim.`,
      assignees: [assignee],
      labels: ['civic-ops'],
    };
  });
}
export function digest(observation: Observation, findings: Finding[]): string {
  return [
    `Civic Ledger operations ${observation.time}`,
    `Liveness: ${observation.liveStatus ?? 'unavailable'}; readiness: ${observation.readyStatus ?? 'unavailable'}.`,
    `Expected sources: ${Object.keys(SOURCE_POLICY).length}; returned: ${observation.sources?.length ?? 'unavailable'}.`,
    `Authenticated archive: ${observation.backupAuthenticated ? observation.backupTakenAt : 'unavailable'}.`,
    `Authenticated raw archive: ${observation.rawBackupAuthenticated ? observation.rawBackupTakenAt : 'unavailable'}.`,
    `Actionable conditions: ${findings.length}. Routine successes remain in this digest.`,
    'External alert delivery and owner receipt are separate checks.',
  ].join('\n');
}
