/**
 * Party color appears only on small chips, muted, with the name always in text
 * (ARCHITECTURE §6, DESIGN.md). Known U.S. major parties get their conventional muted
 * tone; every other party, including Independent, stays neutral.
 */
export type PartyTone = 'democratic' | 'republican' | 'neutral';

export function partyTone(party: string | null): PartyTone {
  const name = party?.trim().toLowerCase() ?? '';
  if (/^democrat(ic)?( party)?$/.test(name)) return 'democratic';
  if (/^republican( party)?$/.test(name)) return 'republican';
  return 'neutral';
}
