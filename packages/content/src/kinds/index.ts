/**
 * The content-expansion content kinds (content-expansion task 1.2).
 *
 * This spec adds new content kinds on top of the slice kinds (registered in
 * `../lib/registry.ts`). Each new kind lives in its own stub module so that
 * tasks 1.3–1.7 and 1.8 can edit only their own file:
 *
 * - `tag-vocabulary.ts` — task 1.3
 * - `city.ts`           — task 1.4 (`city`, `district`, `location`, `route`,
 *                          `newspaper`, `local-org`, `weather`, `streets`,
 *                          `sources`)
 * - `era.ts`            — task 1.5 (`era`, `technology`, `cipher-conventions`,
 *                          `anachronisms`, `blocklist`, `style-guide`,
 *                          `sensitivity`, `public-text`)
 * - `library.ts`        — task 1.6 (`culture-group`, `descriptor-fragment`)
 * - `locale.ts`         — task 1.7 (`locale`, `template-variant`)
 * - `service.ts`        — task 1.8 (`service`)
 *
 * The slice kind `location-type` is already registered in `../lib/registry.ts`;
 * task 1.4 layers the City-Scoped treatment and the required `tags` field onto
 * that existing registration rather than registering a second kind here.
 *
 * `CONTENT_EXPANSION_KIND_REGISTRATIONS` gathers every new registration. The
 * loader concatenates it with the slice registrations (and any caller-supplied
 * `LoadOptions.kinds`) to form the effective Content Kind Registry.
 */

import type { ContentKindRegistration } from '../lib/registry.js';

import { tagVocabularyKind } from './tag-vocabulary.js';
import { CITY_KINDS } from './city.js';
import { ERA_KINDS } from './era.js';
import { LIBRARY_KINDS } from './library.js';
import { LOCALE_KINDS } from './locale.js';
import { serviceKind } from './service.js';

export * from './tag-vocabulary.js';
export * from './city.js';
export * from './era.js';
export * from './library.js';
export * from './locale.js';
export * from './service.js';
export { CONTENT_EXPANSION_OWNER, defineKindStub, STUB_SCHEMA } from './stub.js';

/** Every content kind this spec registers inside `content`. */
export const CONTENT_EXPANSION_KIND_REGISTRATIONS: readonly ContentKindRegistration[] =
  [
    tagVocabularyKind,
    ...CITY_KINDS,
    ...ERA_KINDS,
    ...LIBRARY_KINDS,
    ...LOCALE_KINDS,
    serviceKind,
  ];
