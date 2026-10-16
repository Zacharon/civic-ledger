/**
 * H3-05 memory probe (not part of the test suites). Two modes, each in its own process:
 *
 *   tsx memory-probe.ts generate <dir> <pas2Rows> <ieRows>
 *     copies the FEC fixture into <dir> and replaces pas2 and the IE file with synthetic
 *     rows (fictional committees, unique SUB_IDs).
 *   tsx memory-probe.ts parse <dir> <parse-module>
 *     iterates `parseFec` from <parse-module> over <dir>, discarding records, and prints
 *     the record count and peak RSS (process.resourceUsage().maxRSS).
 */
import { cp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RawSnapshot } from '../../src/adapter';
import { FIXTURES } from '../helpers';
import { zipBuffer } from './zip';

const [mode, dir, a, b] = process.argv.slice(2);
if (!mode || !dir) throw new Error('usage: memory-probe.ts generate|parse <dir> ...');

if (mode === 'generate') {
  const pas2 = Number(a);
  const ie = Number(b);
  await cp(join(FIXTURES, 'fec-bulk'), dir, { recursive: true });
  const lines: string[] = [];
  for (let i = 0; i < pas2; i++) {
    const c = `C9${String(i % 5000).padStart(7, '0')}`;
    lines.push(
      `${c}|N|Q3|P2026|2026${String(i).padStart(14, '0')}|24K|PAC|FICTIONAL RECIPIENT|CITY|DC|20001|||0101202${i % 7}|${(i % 900) + 100}|C8${String(i % 900).padStart(7, '0')}|H6XX${String(i % 400).padStart(5, '0')}|T${i % 3000}|${2000000 + (i % 50)}|||${4000000000000000000n + BigInt(i)}`,
    );
  }
  await writeFile(
    join(dir, 'pas226.zip'),
    zipBuffer('itpas2.txt', Buffer.from(`${lines.join('\n')}\n`, 'latin1')),
  );
  lines.length = 0;
  const header =
    'cand_id,cand_name,spe_id,spe_nam,ele_type,can_office_state,can_office_dis,can_office,cand_pty_aff,exp_amo,exp_date,agg_amo,sup_opp,pur,pay,file_num,amndt_ind,tran_id,image_num,receipt_dat,fec_election_yr,prev_file_num,dissem_dt';
  const ieLines = [header];
  for (let i = 0; i < ie; i++) {
    ieLines.push(
      `H6XX${String(i % 400).padStart(5, '0')},"FICTIONAL, NAME",C7${String(i % 2000).padStart(7, '0')},FICTIONAL SPENDER,G,DC,01,H,NONE,${(i % 5000) + 1},01-OCT-26,0,${i % 2 ? 'S' : 'O'},ADS,VENDOR,${3000000 + i},N,SE.${i},${i},01-OCT-26,2026,,01-OCT-26`,
    );
  }
  await writeFile(join(dir, 'independent_expenditure_2026.csv'), `${ieLines.join('\n')}\n`);
  console.log(JSON.stringify({ generated: dir, pas2, ie }));
} else {
  const module = (await import(pathToFileURL(resolve(String(a))).href)) as {
    parseFec: (s: RawSnapshot, cycle: number) => AsyncIterable<unknown>;
  };
  const snapshot: RawSnapshot = {
    source: 'fec-bulk',
    directory: dir,
    files: [],
    upstream: {},
    checksum: 'probe',
    retrievedAt: new Date(),
  };
  const started = performance.now();
  let records = 0;
  for await (const _ of module.parseFec(snapshot, 2026)) records++;
  console.log(
    JSON.stringify({
      module: a,
      records,
      seconds: Math.round(performance.now() - started) / 1000,
      peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    }),
  );
}
