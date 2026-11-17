import type { CapabilityOutput } from '@civic-ledger/core';

export type DistrictShape = CapabilityOutput<'districts.shape'>;

/**
 * Locator map: a state outline with one congressional district (or, for a Senate seat, an
 * at-large seat or a delegate, the whole state) highlighted. Reusable: give it the output of
 * `districts.shape@1` and it draws that, nothing else. Inline SVG with precomputed paths, so
 * it ships no JavaScript and no map library.
 *
 * Neutral by design: the state is `--surface-sunk` with a `--line-control` outline and the
 * highlight is `--ink-2`; no party or vote colour appears (DESIGN.md "Neutrality rules").
 * Nothing animates. The intrinsic `width` and `height` reserve the space before paint, and
 * `max-width: 100%` with `height: auto` scales it down on narrow screens without shifting.
 * The accessible name is the capability's `description`, the same text API and MCP return.
 */
export function DistrictLocator({ shape }: { shape: DistrictShape }) {
  const wholeState = shape.districtPath === null;
  return (
    <figure
      className="district-locator"
      data-state={shape.state}
      data-district={shape.district ?? ''}
      data-scope={shape.scope}
    >
      <svg
        className="district-map"
        role="img"
        aria-label={shape.description}
        viewBox={shape.viewBox}
        width={shape.width}
        height={shape.height}
        focusable="false"
      >
        <path
          className={wholeState ? 'district-map-highlight' : 'district-map-state'}
          d={shape.statePath}
        />
        {shape.districtPath ? (
          <path className="district-map-highlight" d={shape.districtPath} />
        ) : null}
      </svg>
      <figcaption className="district-locator-caption">
        District boundaries: {shape.publisher}, {shape.vintage}. {shape.caveat}
      </figcaption>
    </figure>
  );
}
