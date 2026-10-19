import { explainerHref } from '@civic-ledger/core';
import Link from 'next/link';
import { SourceList, SourceMark, SourceNotes } from '@/components/sources';
import { formatDate, safeHref } from '@/lib/format';
import { read } from '@/server/capabilities';
import { sourceInfos } from '@/server/sources';

/** Same sentences and raw facts as people.glance over HTTP and MCP. */
export async function GlanceSection({ slug }: { slug: string }) {
  const [glance, sources] = await Promise.all([read('people.glance', { slug }), sourceInfos()]);
  const notes = new SourceNotes('glance', sources);
  const paragraphs = glance.paragraphs.map((paragraph) => ({
    ...paragraph,
    sentences: paragraph.sentences.map((sentence) => ({
      ...sentence,
      mark: notes.cite(sentence.provenance),
    })),
  }));
  return (
    <section
      id="glance"
      aria-labelledby="glance-title"
      className="scroll-mt-24 border-t border-ink pt-5"
    >
      <h2 id="glance-title" className="font-serif text-2xl font-medium">
        At a glance
      </h2>
      <p className="mt-2 max-w-3xl text-ink-2">
        Start with the public record, then inspect the details. This overview uses the latest loaded
        campaign totals; source dates and coverage differ by section.
      </p>
      <div className="mt-6 grid gap-x-10 gap-y-8 md:grid-cols-2">
        {paragraphs.map((paragraph) => (
          <div
            key={paragraph.id}
            data-glance={paragraph.id}
            className="min-w-0 border-t border-rule pt-4"
          >
            <h3 className="font-semibold">{paragraph.title}</h3>
            <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink-2">
              {paragraph.sentences.map((sentence) => (
                <p key={sentence.id} data-sentence={sentence.id}>
                  <span data-sentence-text>
                    {sentence.parts.map((part) =>
                      part.kind === 'term' ? (
                        <Link
                          key={`${sentence.id}-${part.explainer}`}
                          className="link"
                          href={explainerHref(part.explainer)}
                        >
                          {part.text}
                        </Link>
                      ) : part.kind === 'value' ? (
                        <span
                          key={`${sentence.id}-${part.fact}`}
                          className="num"
                          data-glance-fact={part.fact}
                          data-value={JSON.stringify(part.value)}
                        >
                          {part.text}
                        </span>
                      ) : (
                        part.text
                      ),
                    )}
                  </span>
                  <SourceMark notes={notes} n={sentence.mark} />
                  {sentence.evidenceHref && safeHref(sentence.evidenceHref) ? (
                    <>
                      {' '}
                      <a
                        className="link"
                        href={safeHref(sentence.evidenceHref) ?? undefined}
                        rel="noreferrer"
                      >
                        Read the cited source
                      </a>
                    </>
                  ) : null}
                </p>
              ))}
            </div>
            <a
              className="link mt-3 inline-flex min-h-11 items-center text-sm font-semibold"
              href={paragraph.detailHref}
            >
              {paragraph.id === 'who'
                ? 'Inspect career records'
                : paragraph.id === 'money'
                  ? 'Inspect campaign records'
                  : paragraph.id === 'votes'
                    ? 'Inspect roll calls'
                    : 'Inspect positions and sources'}
            </a>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-ink-3">
        Ledger table rebuilt {formatDate(glance.asOf)}. Counts and industry totals link to their
        full records above; source notes include example records for aggregate vote counts.{' '}
        <Link className="link" href="/methodology#at-a-glance">
          How this overview is written
        </Link>
        .
      </p>
      <SourceList notes={notes} title="Sources and example records" />
    </section>
  );
}
