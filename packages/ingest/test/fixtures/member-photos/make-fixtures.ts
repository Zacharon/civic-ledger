/**
 * Regenerates the committed member-photos fixtures: `pnpm exec tsx
 * packages/ingest/test/fixtures/member-photos/make-fixtures.ts`.
 * Every image is a flat grey synthetic JPEG (no face, no real photo), keyed by the Bioguide
 * ids of the congress-legislators fixture so the two fixtures load together. Some files are
 * deliberately broken to cover the rejection paths.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticGreyJpeg } from '../../../../db/src/seed/synthetic-jpeg';
import {
  adobeSegment,
  commentSegment,
  exifSegment,
  iccSegment,
  jfxxSegment,
  photoshopSegment,
  withSegments,
} from '../../support/jpeg-segments';

const here = dirname(fileURLToPath(import.meta.url));
const write = (path: string, bytes: Uint8Array | string) => {
  const target = join(here, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
};
const small = (grey: number) => syntheticGreyJpeg(225, 275, grey);
const large = (grey: number) => syntheticGreyJpeg(450, 550, grey);

// Complete pairs: C000127 and N000147 and B001282 are current members, B000546 is historical.
for (const [id, grey] of [
  ['C000127', 150],
  ['N000147', 180], // its small file is a narrower 183x275, as upstream often is
  ['B001282', 210],
  ['B000546', 120],
  ['Z999999', 100], // a Bioguide id the identity spine does not know
] as const) {
  write(`225x275/${id}.jpg`, id === 'N000147' ? syntheticGreyJpeg(183, 275, grey) : small(grey));
  write(`450x550/${id}.jpg`, large(grey));
}
// Only the small file exists.
write('225x275/A000375.jpg', small(160));
// A web server answered 200 with an HTML error page instead of the image.
write('225x275/V000133.jpg', small(170));
write('450x550/V000133.jpg', '<!doctype html><title>Not Found</title><p>' + 'x'.repeat(200));
// The large file is bigger than its 450x550 box.
write('225x275/K000401.jpg', small(140));
write('450x550/K000401.jpg', syntheticGreyJpeg(600, 750, 140));
// The small file was cut off before its end-of-image marker.
write('225x275/H001096.jpg', small(130).slice(0, 400));
write('450x550/H001096.jpg', large(130));

// C000127 carries the metadata real files carry: EXIF with GPS and a thumbnail, a comment, Photoshop
// data and a JFXX thumbnail (all dropped on load), plus an ICC profile and an Adobe segment (kept).
write(
  '225x275/C000127.jpg',
  withSegments(small(150), [
    exifSegment({ gps: true, thumbnail: true }),
    commentSegment('edited by a fake photographer'),
    photoshopSegment(),
    jfxxSegment(),
    iccSegment(),
    adobeSegment(),
  ]),
);
write('450x550/C000127.jpg', withSegments(large(150), [exifSegment({ gps: false, thumbnail: false })]));
