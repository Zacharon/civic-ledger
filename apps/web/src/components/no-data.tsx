/** Missing data is stated, never shown as zero (ARCHITECTURE §1.4). */
export function NoData({ children = 'No data' }: { children?: string }) {
  return <span className="text-sm text-ink-3">{children}</span>;
}
