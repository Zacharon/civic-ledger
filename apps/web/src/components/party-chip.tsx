import { partyAbbreviation } from '@/lib/format';
import { partyTone } from '@/lib/party';

const TONE_CLASS = {
  democratic: 'bg-(--party-dem-bg) text-(--party-dem-ink)',
  republican: 'bg-(--party-rep-bg) text-(--party-rep-ink)',
  neutral: 'bg-sunk text-ink-2',
} as const;

/** Party as a small muted chip; the name is always present as text (DESIGN.md). */
export function PartyChip({ party, full = false }: { party: string | null; full?: boolean }) {
  if (!party) return <span className="text-sm text-ink-3">Party unknown</span>;
  const abbreviation = partyAbbreviation(party) ?? party;
  return (
    <span
      className={`inline-flex min-w-7 items-center justify-center rounded-control px-1.5 py-px text-xs font-semibold leading-5 ${TONE_CLASS[partyTone(party)]}`}
      title={full ? undefined : party}
    >
      {full ? (
        party
      ) : (
        <>
          <span aria-hidden="true">{abbreviation}</span>
          <span className="sr-only">{party}</span>
        </>
      )}
    </span>
  );
}
