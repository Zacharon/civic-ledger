import type { SourceAdapter } from '../../adapter';
import { loadMemberPhotos } from './load';
import { type PortraitParsed, parseMemberPhotos } from './parse';
import { planMemberPhotos } from './plan';

/**
 * Official portraits of members: unitedstates/images, which republishes the public-domain
 * photos of the GPO Member Guide. Files are downloaded into the database so readers' browsers
 * never contact a third-party host (DECISIONS A72).
 */
export const memberPhotosAdapter: SourceAdapter<PortraitParsed> = {
  source: {
    id: 'member-photos',
    name: 'unitedstates/images (GPO Member Guide portraits)',
    url: 'https://github.com/unitedstates/images',
    license:
      'Public domain: official photos from the U.S. Government Publishing Office Member Guide (memberguide.gpo.gov)',
    licenseUrl: 'https://github.com/unitedstates/images#public-domain',
    description:
      'Official portrait of each current member and of those who served during the 119th Congress, in two sizes (225x275 and 450x550), keyed by Bioguide id. Not every member has one.',
  },
  version: 'member-photos@2',
  // The people it attaches photos to come from the identity spine.
  dependsOn: ['congress-legislators'],
  scopes: ['all'],
  shrinkDatasets: [
    { table: 'person_portrait', loaded: 'portraits', swept: 'stale_portraits_deleted' },
  ],
  plan: planMemberPhotos,
  parse: (snapshot, scope, ctx) => parseMemberPhotos(snapshot, scope, ctx),
  load: loadMemberPhotos,
};
