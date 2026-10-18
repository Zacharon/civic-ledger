import { refreshPersonCard } from '@civic-ledger/db';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dispatch } from '../src/dispatch';
import { useSeededDb } from './helpers';

/**
 * H3R3-01: the restore-drill comparison policy (OPERATIONS "Backups and restore", step 4).
 * Refreshing the read models (as pg_restore and the permitted manual refresh do) changes
 * only the refresh-time fields; with those removed, recorded and current answers must be
 * equal. This runs on one date, so it does not cover the date-dependent answers the
 * policy lists separately.
 */
const db = useSeededDb();

/** The volatile keys the drill excludes from capability answers, at any depth. */
const VOLATILE_KEYS = new Set(['readModelRefreshedAt', 'refreshedAt']);

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !VOLATILE_KEYS.has(key))
        .map(([key, v]) => [key, normalize(v)]),
    );
  }
  return value;
}

const sample = async () => ({
  sources: await dispatch('sources.status', {}, db.ctx()),
  person: await dispatch('people.get', { slug: 'avery-ashvale' }, db.ctx()),
  table: await dispatch('explore.table', { filters: { scope: 'all' } }, db.ctx()),
});

/** person_card checksum, with and without its refresh-time column. */
async function cardChecksums() {
  const result = (await db.handle().db.execute(sql`select
      md5(string_agg(t::text, '|' order by t::text)) as raw,
      md5(string_agg((to_jsonb(t) - 'refreshed_at')::text, '|'
        order by (to_jsonb(t) - 'refreshed_at')::text)) as normalized
    from person_card t`)) as unknown as { rows: { raw: string; normalized: string }[] };
  return result.rows[0];
}

describe('restore comparison normalization (H3R3-01)', () => {
  it('a refresh changes only the named refresh-time fields', async () => {
    const recorded = await sample();
    const recordedCard = await cardChecksums();
    await refreshPersonCard(db.handle().db);
    const restored = await sample();
    const restoredCard = await cardChecksums();

    // Raw answers differ, and only in the volatile fields.
    expect(restored.sources.readModelRefreshedAt).not.toBe(recorded.sources.readModelRefreshedAt);
    expect(restored.person.card.refreshedAt).not.toBe(recorded.person.card.refreshedAt);
    expect(restored.sources).not.toEqual(recorded.sources);
    expect({ ...restored.sources, readModelRefreshedAt: null }).toEqual({
      ...recorded.sources,
      readModelRefreshedAt: null,
    });
    expect(normalize(restored)).toEqual(normalize(recorded));

    // The same holds for the view checksum with `refreshed_at` excluded.
    expect(restoredCard?.raw).not.toBe(recordedCard?.raw);
    expect(restoredCard?.normalized).toBe(recordedCard?.normalized);
  });

  it('normalization keeps business values: a changed fact is still a difference', async () => {
    const recorded = await sample();
    await db.handle().db.execute(sql`update person set full_name = full_name || ' (changed)'
      where slug = 'avery-ashvale'`);
    await refreshPersonCard(db.handle().db);
    expect(normalize(await sample())).not.toEqual(normalize(recorded));
  });
});
