/**
 * The source-stated status of an ideology estimate (`scores.list` `provisional`), as the
 * profile prints it. A final estimate needs no label; an unstated status is never shown as
 * final (DESIGN.md: missing data is never presented as a value).
 */
export function ideologyStatusLabel(provisional: boolean | null): string | null {
  if (provisional === true) return 'Provisional estimate';
  if (provisional === null) return 'Status unknown';
  return null;
}
