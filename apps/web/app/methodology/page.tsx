import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Methodology',
  description: 'How every figure in the ledger is computed, and what it does not claim.',
};

const SECTIONS = [
  { id: 'principles', title: 'Principles' },
  { id: 'money', title: 'Money' },
  { id: 'industry-coding', title: 'Industry coding' },
  { id: 'votes', title: 'Votes' },
  { id: 'dw-nominate', title: 'DW-NOMINATE' },
  { id: 'scores', title: 'Scorecards' },
  { id: 'promises', title: 'Promises and platforms' },
  { id: 'frameworks', title: 'Frameworks' },
  { id: 'missing-data', title: 'Missing data' },
] as const;

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 sm:pt-10 [&>*]:max-w-5xl">
      <header className="max-w-3xl">
        <h1 className="font-serif text-3xl font-medium tracking-tight sm:text-4xl">Methodology</h1>
        <p className="mt-3 text-ink-2">
          How each number is computed, where it comes from, and what it does not claim. The same
          rules apply on this site, in the JSON API and in the MCP tools.
        </p>
      </header>

      <div className="mt-10 grid gap-12 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-24 space-y-1 border-l border-rule text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="-ml-px block border-l border-transparent py-1 pl-3 text-ink-2 hover:border-ink hover:text-ink"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-12">
          <Part id="principles" title="Principles">
            <p>
              Facts come before judgments. The default view shows raw data and several independent
              scores side by side, and no default sort uses an ideological measure. Every score
              names who made it, with the publisher’s own description of its viewpoint, the year,
              the scale and a link to its method. Every fact carries its source, the source’s record
              key, the ingest run that loaded it and when it was retrieved.
            </p>
          </Part>
          <Part id="money" title="Money">
            <p>
              Totals come from FEC candidate summaries for the latest loaded election cycle, in
              whole cents. <strong>From PACs</strong> is contributions from PACs and other
              committees divided by total receipts. <strong>Small donors</strong> is unitemized
              individual contributions (donors giving $200 or less in the cycle, whom campaigns are
              not required to name) divided by total receipts. Outside spending is independent
              expenditures reported for or against the candidate in the same cycle.
            </p>
          </Part>
          <Part id="industry-coding" title="Industry coding">
            <p>
              Committees that give to campaigns are assigned to one industry by a reviewed, in-house
              map kept in the public repository. A committee without a reviewed assignment stays
              “not coded”; its dollars are never folded into an industry or into “other”. Every
              industry breakdown states its coverage: the share of PAC dollars that are coded.
            </p>
          </Part>
          <Part id="votes" title="Votes">
            <p>
              Roll calls and positions come from Voteview. A position is yea, nay, present or not
              voting. <strong>Missed votes</strong> is the share of roll calls marked not voting in
              the member’s latest Congress with recorded votes. Bills and their policy area come
              from GovInfo BILLSTATUS, using the Congress.gov policy-area list as a neutral topic
              base. Vote agreement in Compare counts only roll calls where both members voted yea or
              nay.
            </p>
          </Part>
          <Part id="dw-nominate" title="DW-NOMINATE">
            <p>
              DW-NOMINATE is an academic scaling method that places members on dimensions using
              roll-call votes alone. On the first dimension, lower values are conventionally read as
              more liberal and higher values as more conservative; the second dimension’s meaning
              varies across eras. It measures voting patterns, not motives, and is one method among
              several. The ledger shows it as a position on a labeled axis, never as a color, and
              never as the default sort.
            </p>
            <p>
              Citation: Lewis, Jeffrey B., Keith Poole, Howard Rosenthal, Adam Boche, Aaron Rudkin,
              and Luke Sonnet. <cite>Voteview: Congressional Roll-Call Votes Database</cite>.
              https://voteview.com/
            </p>
          </Part>
          <Part id="scores" title="Scorecards">
            <p>
              Interest-group scorecards appear only after the publisher’s terms of use are reviewed
              and cleared. Until then the publisher is listed with a link and its scores are not
              copied. Scores are shown on the publisher’s own scale with its self-described
              orientation. Sorting by a scorecard uses the score rescaled to 0–1 within that
              publisher’s scale; the displayed number is always the original.
            </p>
          </Part>
          <Part id="promises" title="Promises and platforms">
            <p>
              Promises and stated platform positions are curated in the public repository and merged
              only after human review. Each rating is dated, names its rater and links its evidence.
              The kept rate counts only promises whose latest rating is kept, compromise or broken;
              promises in progress, stalled or not yet rated are listed but not counted. Platform
              positions are shown beside votes in the same policy area without a consistency score.
            </p>
          </Part>
          <Part id="frameworks" title="Frameworks">
            <p>
              A framework is a list of roll calls or bills and the position its author considers
              aligned. Results read “aligned X of Y”: Y counts the framework’s roll calls on which
              the member voted yea or nay; present and not-voting positions are listed but excluded
              from both numbers. A bill rule scores the bill’s final-passage roll calls, and each
              roll call counts once even if several rules reach it. Frameworks are one view, never a
              neutral score;{' '}
              <Link className="link" href="/frameworks">
                build or inspect one
              </Link>
              .
            </p>
          </Part>
          <Part id="missing-data" title="Missing data">
            <p>
              Missing data is stated, never shown as zero. Tables print “No data” when a source has
              nothing for a member, “Not coded” for uncoded industry money, “Not scored” when a
              publisher has not scored a member, and “Not yet rated” for promises without a verdict.
            </p>
          </Part>
        </div>
      </div>
    </div>
  );
}

function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 border-t border-rule pt-5"
    >
      <h2 id={`${id}-title`} className="font-serif text-2xl font-medium">
        {title}
      </h2>
      <div className="prose-ledger mt-3 text-ink-2">{children}</div>
    </section>
  );
}
