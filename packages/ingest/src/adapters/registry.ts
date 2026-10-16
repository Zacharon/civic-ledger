import type { AdapterRegistry } from '../runtime/run';
import { congressLegislatorsAdapter } from './congress-legislators';
import { curatedAdapter } from './curated';
import { fecBulkAdapter } from './fec-bulk';
import { govinfoBillstatusAdapter } from './govinfo-billstatus';
import { voteviewAdapter } from './voteview';

/** Implemented sources, in the order a full refresh runs them (each joins the previous). */
export const ADAPTERS = {
  'congress-legislators': congressLegislatorsAdapter,
  voteview: voteviewAdapter,
  'fec-bulk': fecBulkAdapter,
  'govinfo-billstatus': govinfoBillstatusAdapter,
  curated: curatedAdapter,
} satisfies AdapterRegistry;

export const PIPELINE_ORDER = Object.keys(ADAPTERS) as (keyof typeof ADAPTERS)[];
