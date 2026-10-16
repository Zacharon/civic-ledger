import type { Metadata } from 'next';
import Link from 'next/link';
import { formatNumber } from '@/lib/format';
import { read } from '@/server/capabilities';

export const metadata: Metadata = {
  title: 'Policy areas',
  description: 'Roll-call votes grouped by Congress.gov policy area.',
};

export default async function PolicyIndexPage() {
  const areas = await read('policy.areas', {});
  return (
    <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6 sm:pt-10">
      <header className="max-w-3xl">
        <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">Policy areas</h1>
        <p className="mt-3 text-ink-2">
          Bills grouped by the policy area Congress.gov assigns them, a neutral topic list kept by
          the Library of Congress. Open an area to see its roll calls and how every member voted.
        </p>
      </header>
      {areas.items.length === 0 ? (
        <p className="mt-10 text-ink-2">No policy areas are loaded yet.</p>
      ) : (
        <table className="mt-10 w-full text-sm">
          <caption className="sr-only">Policy areas with bill and roll-call counts</caption>
          <thead>
            <tr className="border-b border-ink text-left">
              <th scope="col" className="py-2 pr-4 font-semibold">
                Policy area
              </th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">
                Bills
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Roll calls
              </th>
            </tr>
          </thead>
          <tbody>
            {areas.items.map((a) => (
              <tr key={a.id} className="border-b border-rule">
                <th scope="row" className="py-3 pr-4 text-left font-normal">
                  {a.rollcallCount > 0 ? (
                    <Link href={`/policy/${a.id}`} className="link text-base">
                      {a.name}
                    </Link>
                  ) : (
                    <span className="text-base">{a.name}</span>
                  )}
                </th>
                <td className="num py-3 pr-4 text-right">{formatNumber(a.billCount)}</td>
                <td className="num py-3 text-right">
                  {a.rollcallCount > 0 ? (
                    formatNumber(a.rollcallCount)
                  ) : (
                    <span className="text-ink-3">None yet</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
