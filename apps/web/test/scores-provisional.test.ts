import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { plain, seededStack } from './stack';

/**
 * F3 / scores.list@1: the source-stated provisional flag (true provisional, false final,
 * null unknown) reaches dispatch, `/api/v1` and MCP as the same field.
 */
const stack = seededStack();

type Scores = { ideology: Array<{ congress: number; provisional?: boolean | null }> };
const cases: Array<{ slug: string; provisional: boolean | null }> = [];

beforeAll(async () => {
  const { handle } = stack();
  const people = (
    (await handle.db.execute(sql`
      select distinct on (p.slug) p.slug, s.id from ideology_score s
      join person p on p.id = s.person_id
      order by p.slug, s.congress desc, s.method limit 3`)) as unknown as {
      rows: Array<{ slug: string; id: number }>;
    }
  ).rows;
  if (people.length < 3) throw new Error('seed needs three people with an ideology score');
  const states = [true, false, null] as const;
  for (const [i, row] of people.entries()) {
    const provisional = states[i] ?? null;
    await handle.db.execute(
      sql`update ideology_score set provisional = ${provisional} where id = ${row.id}`,
    );
    cases.push({ slug: row.slug, provisional });
  }
});

describe('scores.list ideology provisional flag', () => {
  it('is the same through dispatch, HTTP and MCP for true, false and null', async () => {
    const { direct, http, mcp } = stack();
    for (const { slug, provisional } of cases) {
      const expected = plain((await direct('scores.list', { slug })) as Scores);
      expect(expected.ideology[0], slug).toHaveProperty('provisional', provisional);

      const response = await http('scores.list', { slug });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected);

      const tool = await mcp('scores.list', { slug });
      expect(tool.isError).not.toBe(true);
      expect(tool.structuredContent).toEqual(expected);
    }
  });
});
