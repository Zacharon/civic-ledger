import { formatCents, formatNumber, formatShare } from './format';

const ACRONYMS: Record<string, string> = {
  ie: 'IE',
  fec: 'FEC',
  pas2: 'pas2',
  bps: '',
  cents: '',
  id: 'id',
  ids: 'ids',
};

/**
 * Receipt counters for display: `contribution_cents_total` → "Contribution total" in
 * dollars, `industry_coverage_bps` → "Industry coverage" as a percentage, sorted by label.
 */
export function runCountRows(counts: Record<string, number>) {
  return Object.entries(counts)
    .map(([key, count]) => {
      const words = key
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .split(/[_-]/)
        .map((w) => w.toLowerCase());
      const label = words
        .map((w) => ACRONYMS[w] ?? w)
        .filter(Boolean)
        .join(' ');
      const value = words.includes('cents')
        ? formatCents(count)
        : words.includes('bps')
          ? formatShare(count / 10_000, 1)
          : formatNumber(count);
      return { key, label: label.charAt(0).toUpperCase() + label.slice(1), value };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
