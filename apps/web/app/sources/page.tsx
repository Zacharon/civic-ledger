import type { Metadata } from 'next';
import Link from 'next/link';
import { formatCents, formatDate, formatNumber, formatShare, safeHref } from '@/lib/format';
import { read } from '@/server/capabilities';

export const metadata: Metadata = {
  title: 'Sources',
  description: 'Every data source with its terms, last run and coverage.',
};

const STATUS_LABEL = {
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  partial: 'Partial',
} as const;

export default async function SourcesPage() {
  const status = await read('sources.status', {});
  const coding = status.coverage.industryCoding;

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 sm:pt-10 [&>*]:max-w-5xl">
      <header className="max-w-3xl">
        <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">Sources</h1>
        <p className="mt-3 text-ink-2">
          Every number in the ledger comes from one of these sources. Each load is recorded as an
          ingest run; footnotes across the site cite the run and the source’s own record key.
        </p>
      </header>

      <dl className="mt-8 grid gap-x-10 gap-y-4 border-y border-ink py-5 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-ink-2">Tables last rebuilt</dt>
          <dd className="mt-1 text-lg font-semibold">
            {formatDate(status.readModelRefreshedAt) ?? 'Not yet'}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-2">Sources</dt>
          <dd className="num mt-1 text-lg font-semibold">{status.sources.length}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-2">PAC dollars coded to an industry</dt>
          <dd className="mt-1 text-lg font-semibold">
            {formatShare(coding.coverage, 1) ?? 'No PAC data'}
            {coding.totalCents > 0 ? (
              <span className="block text-sm font-normal text-ink-2">
                <span className="num">{formatCents(coding.codedCents)}</span> of{' '}
                <span className="num">{formatCents(coding.totalCents)}</span>; the rest is shown as
                “not coded”
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      {status.sources.length === 0 ? (
        <p className="mt-10 text-ink-2">
          No sources are registered yet. Run an ingest to load data.
        </p>
      ) : (
        <ol className="mt-10 space-y-10">
          {status.sources.map((source) => {
            const url = safeHref(source.url);
            const license = safeHref(source.licenseUrl);
            const run = source.lastRun;
            return (
              <li key={source.id} id={`source-${source.id}`} className="scroll-mt-24">
                <h2 className="font-serif text-2xl font-medium">
                  {url ? (
                    <a className="link-quiet" href={url} rel="noreferrer">
                      {source.name}
                    </a>
                  ) : (
                    source.name
                  )}
                </h2>
                <p className="mt-1 max-w-3xl text-ink-2">{source.description}</p>
                <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
                  <dt className="text-ink-2">Terms</dt>
                  <dd>
                    {source.license}{' '}
                    {license ? (
                      <a className="link" href={license} rel="noreferrer">
                        Read the terms
                      </a>
                    ) : null}
                  </dd>
                  <dt className="text-ink-2">Last successful load</dt>
                  <dd>
                    {source.lastSuccess
                      ? `${formatDate(source.lastSuccess.finishedAt ?? source.lastSuccess.startedAt)} (run ${source.lastSuccess.id}, adapter ${source.lastSuccess.adapterVersion}, scope ${source.lastSuccess.scope})`
                      : 'Never'}
                  </dd>
                  <dt className="text-ink-2">Latest run</dt>
                  <dd>
                    {run ? (
                      <>
                        <span className="font-semibold">{STATUS_LABEL[run.status]}</span>, started{' '}
                        {formatDate(run.startedAt)}
                        {run.error ? (
                          <span className="mt-1 block text-ink-2">Error: {run.error}</span>
                        ) : null}
                      </>
                    ) : (
                      'No runs yet'
                    )}
                  </dd>
                  {run && Object.keys(run.counts).length > 0 ? (
                    <>
                      <dt className="text-ink-2">Records loaded</dt>
                      <dd>
                        <ul className="grid grid-cols-2 gap-x-6 gap-y-0.5 sm:grid-cols-3">
                          {Object.entries(run.counts).map(([key, count]) => (
                            <li
                              key={key}
                              className="flex justify-between gap-3 border-b border-rule py-0.5"
                            >
                              <span className="text-ink-2">{humanize(key)}</span>
                              <span className="num">{formatNumber(count)}</span>
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </>
                  ) : null}
                </dl>
              </li>
            );
          })}
        </ol>
      )}

      <section aria-labelledby="citing" className="mt-16 border-t border-ink pt-6">
        <h2 id="citing" className="font-serif text-2xl font-medium">
          How to cite the underlying sources
        </h2>
        <div className="prose-ledger mt-3 text-ink-2">
          <p>
            Roll-call votes and DW-NOMINATE scores: Lewis, Jeffrey B., Keith Poole, Howard
            Rosenthal, Adam Boche, Aaron Rudkin, and Luke Sonnet.{' '}
            <cite>Voteview: Congressional Roll-Call Votes Database</cite>. https://voteview.com/
          </p>
          <p>
            Campaign finance: Federal Election Commission bulk data,
            https://www.fec.gov/data/browse-data/. Members and identifiers: the public-domain
            congress-legislators project. Bills and policy areas: GovInfo BILLSTATUS and
            Congress.gov.
          </p>
          <p>
            How each figure is computed is on the{' '}
            <Link className="link" href="/methodology">
              methodology
            </Link>{' '}
            page.
          </p>
        </div>
      </section>
    </div>
  );
}

function humanize(key: string): string {
  const spaced = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
