import { partyAbbreviation } from '@/lib/format';
import { partyTone } from '@/lib/party';

const TONE_CLASS = {
  democratic: 'chip chip-democratic',
  republican: 'chip chip-republican',
  neutral: 'chip',
} as const;

/** Party as a small muted chip; the name is always present as text (DESIGN.md). */
export function PartyChip({ party, full = false }: { party: string | null; full?: boolean }) {
  if (!party) return <span className="nodata">Party unknown</span>;
  const className = TONE_CLASS[partyTone(party)];
  if (full) return <span className={className}>{party}</span>;
  return (
    <span className={className} title={party}>
      <span aria-hidden="true">{partyAbbreviation(party) ?? party}</span>
      <span className="sr-only">{party}</span>
    </span>
  );
}
