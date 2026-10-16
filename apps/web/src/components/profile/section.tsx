import type { ReactNode } from 'react';

/** A titled profile section; `id` is the in-page anchor and the footnote prefix. */
export function ProfileSection({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-24 border-t border-ink pt-6"
    >
      <h2 id={`${id}-title`} className="font-serif text-2xl font-medium tracking-tight">
        {title}
      </h2>
      {lede ? <p className="mt-1.5 max-w-3xl text-ink-2">{lede}</p> : null}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function SectionFallback({ id, title }: { id: string; title: string }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      aria-busy="true"
      className="scroll-mt-24 border-t border-ink pt-6"
    >
      <h2 id={`${id}-title`} className="font-serif text-2xl font-medium tracking-tight">
        {title}
      </h2>
      <p className="mt-3 text-sm text-ink-3">Loading {title.toLowerCase()}…</p>
      <div className="mt-6 h-48 rounded-panel bg-sunk/60" />
    </section>
  );
}

/** A labeled figure: title says what it shows; the caption carries source and as-of. */
export function Figure({
  title,
  caption,
  children,
}: {
  title: string;
  caption: ReactNode;
  children: ReactNode;
}) {
  return (
    <figure className="min-w-0">
      <h3 className="font-semibold">{title}</h3>
      <div className="mt-3">{children}</div>
      <figcaption className="mt-2 text-xs text-ink-3">{caption}</figcaption>
    </figure>
  );
}
