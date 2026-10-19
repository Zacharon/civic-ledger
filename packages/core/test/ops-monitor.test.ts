import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  assess,
  digest,
  issueDrafts,
  normalizeSources,
  type Observation,
  SOURCE_POLICY,
} from '../../../scripts/monitor/assess';

function good(): Observation {
  return {
    time: '2026-10-18T12:00:00Z',
    liveStatus: 200,
    readyStatus: 200,
    backupTakenAt: '2026-10-18T03:00:00Z',
    backupAuthenticated: true,
    rawBackupTakenAt: '2026-10-18T03:00:00Z',
    rawBackupAuthenticated: true,
    sources: Object.keys(SOURCE_POLICY).map((id) => ({
      id,
      lastRun: {
        status: 'succeeded',
        startedAt: '2026-10-18T00:00:00Z',
        finishedAt: '2026-10-18T01:00:00Z',
      },
      lastSuccess: {
        status: 'succeeded',
        startedAt: '2026-10-18T00:00:00Z',
        finishedAt: '2026-10-18T01:00:00Z',
      },
    })),
  };
}
describe('operator incident drafts', () => {
  it('projects receipts without copying arbitrary error text or source metadata', () => {
    const source = good().sources?.[0];
    assert(source);
    const result = normalizeSources([
      {
        ...source,
        url: 'postgres://private:secret@host/db',
        lastRun: { ...source.lastRun, error: 'private error token=secret' },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(() => normalizeSources([{ id: '../bad', lastRun: null, lastSuccess: null }])).toThrow();
  });
  it('keeps successes in a digest without producing issues', () => {
    expect(assess(good())).toEqual([]);
    expect(issueDrafts([], [], 'owner')).toEqual([]);
    expect(digest(good(), [])).toContain('Actionable conditions: 0');
  });
  it('distinguishes downtime, stale publication, missed attempts, failures and stale backups', () => {
    const o = good();
    o.liveStatus = null;
    o.readyStatus = 503;
    o.backupTakenAt = '2026-10-16T03:00:00Z';
    o.backupWorkflowConclusion = 'failure';
    if (!o.sources) throw new Error('fixture');
    assert(o.sources[0]);
    o.sources[0].lastRun = {
      status: 'failed',
      startedAt: '2026-10-15T00:00:00Z',
      finishedAt: '2026-10-15T00:30:00Z',
    };
    o.sources[0].lastSuccess = null;
    const keys = assess(o).map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'site:liveness',
        'site:readiness',
        'ingest:congress-legislators:failed',
        'ingest:congress-legislators:missed',
        'ingest:congress-legislators:stale',
        'backup:stale',
        'backup:workflow-failed',
      ]),
    );
  });
  it('refuses future/invalid freshness proof and notices missing source IDs and stuck jobs', () => {
    const o = good();
    o.backupTakenAt = 'invalid';
    if (!o.sources) throw new Error('fixture');
    o.sources.splice(1, 1);
    assert(o.sources[0]);
    o.sources[0].lastRun = {
      status: 'running',
      startedAt: '2026-10-18T08:00:00Z',
      finishedAt: null,
    };
    o.sources[0].lastSuccess = {
      status: 'succeeded',
      startedAt: '2027-01-01T00:00:00Z',
      finishedAt: '2027-01-01T00:00:00Z',
    };
    expect(assess(o).map((f) => f.key)).toEqual(
      expect.arrayContaining([
        'backup:stale',
        'ingest:govinfo-billstatus:missing',
        'ingest:congress-legislators:stuck',
        'ingest:congress-legislators:stale',
      ]),
    );
  });
  it('deduplicates an existing incident and validates the configured owner', () => {
    const o = good();
    o.liveStatus = 503;
    const findings = assess(o);
    const first = issueDrafts([...findings, ...findings], [], 'owner');
    assert(first[0]);
    expect(first).toHaveLength(1);
    expect(first[0].assignees).toEqual(['owner']);
    const next = issueDrafts(findings, [{ number: 42, body: first[0].body }], 'owner');
    assert(next[0]);
    expect(next[0].action).toBe('already_open');
    expect(next[0].existingIssue).toBe(42);
    expect(() => issueDrafts(findings, [], 'bad owner')).toThrow('ASSIGNEE');
  });
  it('gates every scheduled production workflow behind explicit deployment activation', async () => {
    for (const name of ['backup', 'monitor', 'ingest']) {
      const text = await readFile(
        new URL(`../../../.github/workflows/${name}.yml`, import.meta.url),
        'utf8',
      );
      expect(text).toContain("vars.CIVIC_DEPLOYMENT_ENABLED == 'true'");
      expect(text).toContain('environment: civic-ledger-operations');
      expect(text).toContain('timeout-minutes:');
      if (name !== 'monitor') {
        expect(text).toMatch(/CIVIC_RAW_ROOT:\s*\$\{\{\s*vars\.CIVIC_RAW_ROOT\s*\}\}/);
        expect(text).toContain('group: civic-ledger-production-ops');
      }
    }
    const blueprint = await readFile(new URL('../../../render.yaml', import.meta.url), 'utf8');
    expect(blueprint).toContain('autoDeployTrigger: off');
    expect(blueprint).toContain('connectionPool: none');
    expect(blueprint).toContain('ipAllowList: []');
  });
});
