import 'server-only';
import type { SourceInfo } from '@/components/sources';
import { read } from './capabilities';

/** Source names and links for footnotes (one sources.status read per request). */
export async function sourceInfos(): Promise<SourceInfo[]> {
  const status = await read('sources.status', {});
  return status.sources.map((s) => ({ id: s.id, name: s.name, url: s.url }));
}
