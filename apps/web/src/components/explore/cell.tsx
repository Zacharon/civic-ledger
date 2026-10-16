import { PositionStrip } from '@/components/charts/position-strip';
import { ShareBar } from '@/components/charts/share-bar';
import { NoData } from '@/components/no-data';
import type { ColumnDef, ExploreRow } from '@/lib/explore-columns';
import { formatCents, formatNumber, formatScore, formatYears } from '@/lib/format';

/** One metric cell. Shared by the table, the mobile cards and Compare. */
export function MetricCell({ column, row }: { column: ColumnDef; row: ExploreRow }) {
  switch (column.kind) {
    case 'cents': {
      const value = row[centsField(column.id)];
      const text = formatCents(value, { compact: true });
      return text === null ? (
        <NoData />
      ) : (
        <span className="num" title={formatCents(value) ?? undefined}>
          {text}
        </span>
      );
    }
    case 'share': {
      const share = row[shareField(column.id)];
      return <ShareBar share={share} empty={emptyShareText(column.id, row)} />;
    }
    case 'signed': {
      const value = column.id === 'dim2' ? row.dwNominateDim2 : row.dwNominateDim1;
      return value === null ? <NoData /> : <PositionStrip value={value} width={56} />;
    }
    case 'years': {
      const text = formatYears(row.tenureYears);
      return text === null ? <NoData /> : <span className="num">{text}</span>;
    }
    case 'count': {
      const text = formatNumber(column.id === 'rated' ? row.promisesRated : row.votesEligible);
      return text === null ? <NoData /> : <span className="num">{text}</span>;
    }
    case 'industries': {
      if (row.topIndustries.length === 0) {
        return <NoData>{row.industryCodingCoverage === null ? 'No data' : 'Not coded'}</NoData>;
      }
      return (
        <span
          className="block max-w-56 truncate text-left"
          title={row.topIndustries.map((i) => i.name).join(', ')}
        >
          {row.topIndustries.map((i) => i.name).join(', ')}
        </span>
      );
    }
    case 'scorecard': {
      const publisherId = column.scorecard?.publisherId;
      const cell = row.scorecards.find((s) => s.publisherId === publisherId);
      if (!cell) return <NoData>Not scored</NoData>;
      return (
        <span className="num whitespace-nowrap">
          {formatScore(cell.score)}
          <span className="text-xs text-ink-3">
            {' '}
            / {formatScore(cell.scaleMax)} · {cell.year}
          </span>
        </span>
      );
    }
  }
}

type CentsField = 'totalReceiptsCents' | 'outsideSupportCents' | 'outsideOpposeCents';
type ShareField =
  | 'pacShare'
  | 'smallDollarShare'
  | 'industryCodingCoverage'
  | 'missedVoteRate'
  | 'promiseKeptRate';

function centsField(id: string): CentsField {
  if (id === 'outsideFor') return 'outsideSupportCents';
  if (id === 'outsideAgainst') return 'outsideOpposeCents';
  return 'totalReceiptsCents';
}

function shareField(id: string): ShareField {
  switch (id) {
    case 'pac':
      return 'pacShare';
    case 'small':
      return 'smallDollarShare';
    case 'coverage':
      return 'industryCodingCoverage';
    case 'missed':
      return 'missedVoteRate';
    default:
      return 'promiseKeptRate';
  }
}

function emptyShareText(id: string, row: ExploreRow): string {
  if (id === 'kept') return row.promisesRated === null ? 'None tracked' : 'None rated yet';
  return 'No data';
}
