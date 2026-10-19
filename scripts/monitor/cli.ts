import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { verifyManifest } from '../backup/archive';
import { verifyRawManifest } from '../backup/raw';
import { safeError } from '../backup/safety';
import { createStore } from '../backup/storage';
import {
  assess,
  digest,
  type ExistingIssue,
  issueDrafts,
  normalizeSources,
  type Observation,
  type Source,
} from './assess';

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      'existing-issues': { type: 'string' },
      fixture: { type: 'string' },
      'backup-workflow': { type: 'string' },
    },
  });
  if (!values.out) throw new Error('--out <draft-directory> is required');
  let observation: Observation;
  if (values.fixture)
    observation = JSON.parse(await readFile(values.fixture, 'utf8')) as Observation;
  else {
    const base = new URL(process.env.CIVIC_SITE_URL ?? '');
    if (
      base.protocol !== 'https:' ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== '/'
    )
      throw new Error('CIVIC_SITE_URL must be an HTTPS origin without credentials');
    const probe = async (path: string) => {
      try {
        const response = await fetch(new URL(path, base), {
          signal: AbortSignal.timeout(10_000),
          redirect: 'error',
          headers: { 'cache-control': 'no-cache' },
        });
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        if (reader)
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > 2_000_000) {
              await reader.cancel();
              throw new Error('monitor response exceeds budget');
            }
            chunks.push(next.value);
          }
        return { status: response.status, body: Buffer.concat(chunks).toString('utf8') };
      } catch {
        return { status: null, body: '' };
      }
    };
    const confirm = async (path: string) => {
      const first = await probe(path);
      if (first.status === 200) return first;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return probe(path);
    };
    const [live, ready, sources] = await Promise.all([
      confirm('/api/live'),
      confirm('/api/health'),
      probe('/api/v1/sources.status'),
    ]);
    let sourceRecords: Source[] | null = null;
    try {
      const body = JSON.parse(sources.body) as { sources?: Source[] };
      if (
        sources.status === 200 &&
        Array.isArray(body.sources) &&
        body.sources.every((s) => typeof s.id === 'string')
      )
        sourceRecords = normalizeSources(body.sources);
    } catch {
      /* Missing status is itself a finding. */
    }
    let backupTakenAt: string | null = null;
    let backupAuthenticated = false;
    let rawBackupTakenAt: string | null = null;
    let rawBackupAuthenticated = false;
    try {
      const store = await createStore();
      const latest = verifyManifest(
        await store.json('latest.json'),
        process.env.BACKUP_ENCRYPTION_KEY ?? '',
      );
      for (const file of Object.values(latest.files)) {
        if ((await store.size(file.key)) !== file.bytes)
          throw new Error('archive object is missing or truncated');
      }
      backupTakenAt = latest.takenAt;
      backupAuthenticated = true;
      const raw = verifyRawManifest(
        await store.json('latest-raw.json'),
        process.env.BACKUP_ENCRYPTION_KEY ?? '',
      );
      for (const file of [raw.files[0], raw.files.at(-1)]) {
        if (file && (await store.size(file.key)) !== file.encryptedBytes)
          throw new Error('raw archive object missing');
      }
      rawBackupTakenAt = raw.takenAt;
      rawBackupAuthenticated = true;
    } catch {
      /* Never include storage errors or credentials in public drafts. */
    }
    observation = {
      time: new Date().toISOString(),
      liveStatus: live.status,
      readyStatus: ready.status,
      sources: sourceRecords,
      backupTakenAt,
      backupAuthenticated,
      rawBackupTakenAt,
      rawBackupAuthenticated,
    };
  }
  if (values['backup-workflow']) {
    const workflow = JSON.parse(await readFile(values['backup-workflow'], 'utf8')) as {
      conclusion?: string | null;
    };
    observation.backupWorkflowConclusion = workflow.conclusion;
  }
  const issuesRaw = values['existing-issues']
    ? (JSON.parse(await readFile(values['existing-issues'], 'utf8')) as
        | ExistingIssue[]
        | ExistingIssue[][])
    : [];
  const existing = issuesRaw.flat() as ExistingIssue[];
  const findings = assess(observation);
  const drafts = issueDrafts(findings, existing, process.env.CIVIC_ALERT_ASSIGNEE ?? '');
  await mkdir(values.out, { recursive: true });
  await writeFile(
    join(values.out, 'report.json'),
    `${JSON.stringify({ observation, findings, drafts }, null, 2)}\n`,
  );
  await writeFile(join(values.out, 'digest.md'), `${digest(observation, findings)}\n`);
  for (const draft of drafts.filter((d) => d.action === 'create')) {
    const { title, body, assignees, labels } = draft;
    await writeFile(
      join(values.out, `issue-${draft.fingerprint}.json`),
      `${JSON.stringify({ title, body, assignees, labels }, null, 2)}\n`,
    );
  }
  process.stdout.write(
    `${digest(observation, findings)}\nDrafts: ${drafts.filter((d) => d.action === 'create').length}; already open: ${drafts.filter((d) => d.action === 'already_open').length}. No issues were created.\n`,
  );
}
main().catch((error) => {
  process.stderr.write(`${safeError(error)}\n`);
  process.exitCode = 1;
});
