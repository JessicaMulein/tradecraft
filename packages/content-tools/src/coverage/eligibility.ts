/**
 * Eligible-item and Required-Query-Binder computation for the Coverage Report
 * (content-expansion task 5.11; design, "Coverage Report"; Req 15.2, 15.3).
 *
 * The accounting core ({@link ./report}) needs two things from the content set
 * that the usage tallies alone do not carry:
 *
 * - **Eligible items per kind.** Expected use divides a kind's total draws by
 *   the number of items of that kind the city could draw, and every eligible
 *   item gets a row so a never-drawn item is reported `unused` (Req 15.3). The
 *   eligible set is read from the *year-filtered* City Bundle, matching the
 *   content the generator's setting step actually draws from: the city's
 *   Locations (minted to the `loc:<id>` ids the write-only `UsageSink` records)
 *   and its local Cover Identities. These are the two kinds the generator's
 *   sink currently records; the map is keyed by the sink's kind strings so it
 *   lines up with the recorded counts, and extends automatically as the engine
 *   records more kinds.
 * - **Static Required-Query Binder counts.** For every Required Query in the
 *   merged Tag Vocabulary, the number of the city's Locations whose Effective
 *   Tags (own Tags plus the Location Type's Tags) satisfy the query, and the
 *   margin over the query's `minStatic` (Req 15.2). This is the same naive
 *   recount the loader's static Tag Conformance and the bindability property
 *   use, computed here per city for the report.
 *
 * Everything here is a pure function of the (year-filtered) City Bundle and the
 * Tag Vocabulary; it makes no draws and reads no filesystem.
 */

import {
  locationEntityId,
  yearFilter,
  type CityBundle,
  type ContentSetV2,
} from '@tradecraft/engine';
import type {
  CityLocation,
  LocationType,
  RequiredQuery,
  TagVocabulary,
} from '@tradecraft/content';

import type { ContentId, EligibleByKind, RequiredQueryMargin } from './report.js';

/**
 * The eligible items a City Pack can draw of each recorded kind, at a given
 * Game Year. The bundle is year-filtered to the year first (as the generator
 * does), so only in-period Locations and Covers are eligible. The map is keyed
 * by the `UsageSink` kind strings — `'loc'` and `'cover-identity'` — so it
 * aligns with the counts the sink collects.
 */
export function eligibleForCity(
  set: ContentSetV2,
  city: string,
  year: number,
): EligibleByKind {
  const filtered = yearFilter(set, year, city);
  const bundle = filtered.cities[city];
  const eligible = new Map<string, readonly ContentId[]>();
  if (bundle === undefined) {
    return eligible;
  }
  eligible.set(
    'loc',
    bundle.locations.map((loc) => locationEntityId(loc.id) as ContentId),
  );
  eligible.set(
    'cover-identity',
    bundle.covers.map((cover) => cover.id as ContentId),
  );
  return eligible;
}

/**
 * The static Required-Query margins for a City Pack: for every Required Query
 * in the vocabulary, the city's static Binder count and the margin over
 * `minStatic` (Req 15.2). The bundle is year-filtered to `year` first, so the
 * recount uses exactly the in-period Locations the generator would bind. The
 * `query` string is the query's Tag list joined with `+`, a stable human label.
 */
export function requiredQueryMarginsForCity(
  set: ContentSetV2,
  city: string,
  year: number,
): RequiredQueryMargin[] {
  const filtered = yearFilter(set, year, city);
  const bundle = filtered.cities[city];
  if (bundle === undefined) {
    return [];
  }
  const vocab: TagVocabulary = filtered.tagVocabulary;
  return vocab.requiredQueries.map((rq) => ({
    city,
    query: queryLabel(rq),
    binders: staticBinderCount(bundle, rq.query as readonly string[]),
    min: rq.minStatic,
  }));
}

/**
 * A stable human label for a Required Query: its id, then its Tag list in
 * brackets, so the report names the query and shows the Tags it binds. Both are
 * drawn from the vocabulary, which is deterministic across runs.
 */
function queryLabel(rq: RequiredQuery): string {
  return `${rq.id} [${[...rq.query].join('+')}]`;
}

/**
 * The static Binder count of a query in a City Bundle: the number of the
 * bundle's Locations whose Effective Tags contain every Tag the query names.
 * Effective Tags are a Location's own Tags together with its Location Type's
 * Tags — the same definition the loader's Tag Conformance and
 * `instantiateCity` use.
 */
export function staticBinderCount(
  bundle: CityBundle,
  query: readonly string[],
): number {
  const types = new Map<string, LocationType>(
    bundle.locationTypes.map((t) => [t.id, t]),
  );
  return bundle.locations.filter((loc) => {
    const tags = effectiveTags(loc, types);
    return query.every((tag) => tags.has(tag));
  }).length;
}

/** A Location's Effective Tags: its own Tags plus its Location Type's Tags. */
function effectiveTags(
  loc: CityLocation,
  types: ReadonlyMap<string, LocationType>,
): Set<string> {
  const tags = new Set<string>(loc.tags);
  for (const t of types.get(loc.type)?.tags ?? []) {
    tags.add(t);
  }
  return tags;
}
