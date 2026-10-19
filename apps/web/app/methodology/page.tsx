import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { safeHref } from '@/lib/format';
import { read } from '@/server/capabilities';

export const metadata: Metadata = {
  title: 'Methodology',
  description: 'How every figure in the ledger is computed, and what it does not claim.',
};

const SECTIONS = [
  { id: 'principles', title: 'Principles' },
  { id: 'at-a-glance', title: 'At a glance' },
  { id: 'plain-language', title: 'Terms explained' },
  { id: 'money', title: 'Money' },
  { id: 'industry-coding', title: 'Industry coding' },
  { id: 'members', title: 'Current and former members' },
  { id: 'votes', title: 'Votes' },
  { id: 'dw-nominate', title: 'DW-NOMINATE' },
  { id: 'scores', title: 'Scorecards' },
  { id: 'promises', title: 'Promises and platforms' },
  { id: 'frameworks', title: 'Frameworks' },
  { id: 'missing-data', title: 'Missing data' },
] as const;

export default async function MethodologyPage() {
  const explainers = await read('explainers.list', {});
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
          <Part id="at-a-glance" title="At a glance">
            <p>
              The profile overview uses fixed sentence templates over the same sourced records as
              the detailed sections. It does not generate a political verdict or infer motives.
              Campaign receipts are campaign finances, not personal pay, and contributions do not
              establish why a member voted a particular way.
            </p>
            <p>
              Money uses the latest loaded cycle. The PAC share and individual contribution shares
              retain their own FEC filing periods and should not be added across files.
              Participation uses the latest Congress with recorded votes; a DW-NOMINATE estimate can
              cover a different Congress. Platform counts cover all loaded campaigns, with up to
              three of the newest reviewed entries shown. Missing records are coverage gaps.
            </p>
            <p>
              Each overview links to its full profile records. Source notes identify individual
              records; a vote-count source note is an example, with all underlying roll calls in
              Votes. The JSON API and agent tools receive the same facts, sentences and links.
            </p>
          </Part>
          <Part id="plain-language" title="Terms explained">
            <p>Definitions used beside the figures, with their sources.</p>
            <div className="mt-5 space-y-6">
              {explainers.items.map((explainer) => (
                <section
                  key={explainer.id}
                  id={`explainer-${explainer.id}`}
                  aria-labelledby={`explainer-${explainer.id}-title`}
                  className="scroll-mt-24 border-t border-rule pt-4"
                >
                  <h3 id={`explainer-${explainer.id}-title`} className="font-semibold text-ink">
                    {explainer.question}
                  </h3>
                  {explainer.answer.map((answer) => (
                    <p key={answer}>{answer}</p>
                  ))}
                  <p className="text-sm">
                    Source:{' '}
                    {safeHref(explainer.source.url) ? (
                      <a
                        className="link"
                        href={safeHref(explainer.source.url) ?? undefined}
                        rel="noreferrer"
                      >
                        {explainer.source.name}
                      </a>
                    ) : (
                      explainer.source.name
                    )}
                    .
                  </p>
                </section>
              ))}
            </div>
          </Part>
          <Part id="money" title="Money">
            <p>
              Totals come from the FEC all-candidates file for the latest loaded election cycle, in
              whole cents. <strong>From PACs</strong> is contributions from PACs and other
              committees divided by total receipts. <strong>Small donors</strong> is unitemized
              individual contributions (donors giving $200 or less in the cycle, whom campaigns are
              not required to name) divided by total receipts, both taken from the FEC candidate
              summary file. That file is refreshed on its own schedule and often covers a shorter
              period than the totals, so the share is labeled with its own end date and never mixed
              with the other file’s amounts. A share is shown only when receipts are positive and
              the part lies between zero and the total; otherwise it reads “No data”. Outside
              spending is independent expenditures reported for or against the candidate in the same
              cycle.
            </p>
          </Part>
          <Part id="industry-coding" title="Industry coding">
            <p>
              Committees that give to campaigns are assigned to one industry by a reviewed, in-house
              map kept in the public repository. A committee without a reviewed assignment stays
              “not coded”; its dollars are never folded into an industry or into “other”. Every
              industry breakdown states its coverage: the share of PAC dollars that are coded.
              Coverage and industry shares are computed on contributions before refunds, so a refund
              can never push them above 100% or below zero; amounts kept after refunds are shown
              beside them, and an industry appears among a member’s top industries only when its net
              amount is positive.
            </p>
          </Part>
          <Part id="members" title="Current and former members">
            <p>
              A <strong>current member</strong> is someone whose latest term of office covers
              today’s date, as recorded by the congress-legislators project (scheduled term ends, or
              the actual date for members who resigned or died). Explore and the home page show
              current members by default; “Include former members” adds everyone on record since
              1789. Search, profiles and Compare work for anyone and label former members with their
              years of service. <strong>Years in office</strong> counts days actually served across
              all terms.
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
