import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { POSITION_LABEL } from '../src/lib/labels';
import { summarizeTally, VOTE_KEY_CLASS, VOTE_PARTS } from '../src/lib/vote';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

/** Custom properties declared in the light `:root` block and the dark media block. */
function tokens(scheme: 'light' | 'dark') {
  const dark = css.indexOf('@media (prefers-color-scheme: dark)');
  const block =
    scheme === 'light'
      ? css.slice(css.indexOf(':root {'), dark)
      : css.slice(dark, css.indexOf('@theme'));
  return Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [
      m[1],
      m[2]?.toLowerCase(),
    ]),
  ) as Record<string, string>;
}

function hsl(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === r
      ? 60 * (((g - b) / d) % 6)
      : max === g
        ? 60 * ((b - r) / d + 2)
        : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

describe('vote and party colors are separate semantic families', () => {
  for (const scheme of ['light', 'dark'] as const) {
    const t = tokens(scheme);
    const votes = ['--vote-yea', '--vote-nay', '--vote-present', '--vote-not-voting'];
    const parties = Object.keys(t).filter((k) => k.startsWith('--party-'));

    it(`${scheme}: defines every vote token and the party tokens`, () => {
      for (const v of votes) expect(t[v], v).toMatch(/^#[0-9a-f]{6}$/);
      expect(parties.length).toBeGreaterThanOrEqual(4);
    });

    it(`${scheme}: no vote color is red or blue (reserved for party identification)`, () => {
      for (const v of votes) {
        const { h, s } = hsl(t[v] as string);
        if (s < 0.15) continue; // neutral grey: carries no hue
        expect(h >= 330 || h <= 20, `${v} ${t[v]} reads as red`).toBe(false);
        expect(h >= 195 && h <= 260, `${v} ${t[v]} reads as blue`).toBe(false);
      }
    });

    it(`${scheme}: Yea is teal, Nay is amber, Not voting and Present are neutral`, () => {
      const yea = hsl(t['--vote-yea'] as string);
      const nay = hsl(t['--vote-nay'] as string);
      expect(yea.h).toBeGreaterThan(150);
      expect(yea.h).toBeLessThan(190);
      expect(nay.h).toBeGreaterThan(28);
      expect(nay.h).toBeLessThan(50);
      expect(hsl(t['--vote-not-voting'] as string).s).toBeLessThan(0.15);
      expect(hsl(t['--vote-present'] as string).s).toBeLessThan(0.15);
    });

    it(`${scheme}: no vote token shares a value with a party token`, () => {
      const partyValues = new Set(parties.map((p) => t[p]));
      for (const v of votes) expect(partyValues.has(t[v]), v).toBe(false);
    });
  }

  it('vote key classes paint only from --vote-* tokens', () => {
    for (const className of Object.values(VOTE_KEY_CLASS)) {
      const rule = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      expect(rule, className).toMatch(/var\(--vote-/);
      expect(rule, className).not.toMatch(/--party-|--data-|--accent|--status-/);
    }
  });

  it('vote components never reference party or category-palette colors', () => {
    for (const file of [
      '../src/components/charts/tally-bar.tsx',
      '../src/components/profile/votes-section.tsx',
    ]) {
      const source = read(file);
      expect(source, file).not.toMatch(/chip-(democratic|republican)|--party-|(fill|bg)-data-/);
    }
  });
});

describe('summarizeTally: one source for meter and legend', () => {
  it('states the denominator and keeps every official category separate', () => {
    const summary = summarizeTally({ yea: 312, nay: 109, present: 2, notVoting: 6 });
    expect(summary.total).toBe(429);
    expect(summary.parts.map((p) => [p.label, p.count])).toEqual([
      ['Yea', 312],
      ['Nay', 109],
      ['Present', 2],
      ['Not voting', 6],
    ]);
    expect(summary.segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
  });

  it('does not inflate tiny categories', () => {
    const summary = summarizeTally({ yea: 999, nay: 0, present: 0, notVoting: 1 });
    expect(summary.segments.map((s) => s.key)).toEqual(['yea', 'notVoting']);
    expect(summary.segments[1]?.share).toBe(0.001);
    // The legend still lists the zero categories with their count.
    expect(summary.parts.find((p) => p.key === 'nay')?.count).toBe(0);
  });

  it('handles a roll call with nothing recorded without dividing by zero', () => {
    const summary = summarizeTally({ yea: 0, nay: 0, present: 0, notVoting: 0 });
    expect(summary.total).toBe(0);
    expect(summary.segments).toEqual([]);
    expect(summary.parts.every((p) => p.share === 0 && Number.isFinite(p.share))).toBe(true);
  });

  it('handles a unanimous vote', () => {
    const summary = summarizeTally({ yea: 0, nay: 100, present: 0, notVoting: 0 });
    expect(summary.segments).toHaveLength(1);
    expect(summary.segments[0]).toMatchObject({ key: 'nay', share: 1 });
  });

  it('treats malformed counts as zero rather than corrupting the total', () => {
    const summary = summarizeTally({ yea: 5, nay: Number.NaN, present: -3, notVoting: 1 });
    expect(summary.total).toBe(6);
  });

  it('labels Present and Not voting as distinct positions everywhere', () => {
    expect(new Set(VOTE_PARTS.map((p) => p.label)).size).toBe(VOTE_PARTS.length);
    expect(new Set(VOTE_PARTS.map((p) => p.className)).size).toBe(VOTE_PARTS.length);
    expect(POSITION_LABEL.present).not.toBe(POSITION_LABEL.not_voting);
    for (const part of VOTE_PARTS) expect(POSITION_LABEL[part.position]).toBe(part.label);
  });
});
