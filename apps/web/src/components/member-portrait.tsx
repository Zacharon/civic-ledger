import type { Portrait } from '@civic-ledger/core';
import { SourceMark, type SourceNotes } from '@/components/sources';

/** Same words for every member without a portrait; no initials, no silhouette. */
export const NO_PORTRAIT_TEXT = 'No official portrait published yet';

interface MemberPortraitProps {
  /** `people.get` `portrait`: facts only, the image is served from our own origin. */
  portrait: Portrait;
  /** Used in the alt text: "Official portrait of {name}". */
  name: string;
  /** Header footnotes, so the file's source is listed with the other sources. */
  notes: SourceNotes;
  /** Footnote number from `notes.cite(portrait.provenance)`. */
  mark: number | null;
  /**
   * Defer loading until near the viewport. Off by default: the profile portrait is at the
   * top of the page, where lazy loading would only delay the largest element.
   */
  lazy?: boolean;
}

/**
 * The official portrait in a member record header (DESIGN.md "Portraits"): a 4:5 frame with an
 * explicit file size (no layout shift), 1x/2x sources, a fixed credit line, or a neutral tile
 * of the same size when none is published. Every member's header carries the same weight.
 * Member records only: never on race pages.
 */
export function MemberPortrait({
  portrait,
  name,
  notes,
  mark,
  lazy = false,
}: Omit<MemberPortraitProps, 'portrait'> & { portrait: Portrait | null }) {
  if (!portrait) {
    return (
      <figure className="member-portrait" data-portrait="missing">
        <div className="member-portrait-frame member-portrait-empty">
          <p>{NO_PORTRAIT_TEXT}</p>
        </div>
      </figure>
    );
  }
  const retina = portrait.variants.find((v) => v.size === 450);
  return (
    <figure className="member-portrait" data-portrait="present" data-portrait-asof={portrait.asOf}>
      <div className="member-portrait-frame">
        {/* biome-ignore lint/performance/noImgElement: files are pre-sized, same-origin and cached immutably, so next/image would only add a second hop */}
        <img
          src={portrait.url}
          srcSet={retina ? `${portrait.url} 1x, ${retina.url} 2x` : undefined}
          width={portrait.width}
          height={portrait.height}
          alt={`Official portrait of ${name}`}
          loading={lazy ? 'lazy' : 'eager'}
          fetchPriority={lazy ? 'auto' : 'high'}
          decoding="async"
        />
      </div>
      <figcaption>
        {portrait.credit}
        <SourceMark notes={notes} n={mark} />
      </figcaption>
    </figure>
  );
}
