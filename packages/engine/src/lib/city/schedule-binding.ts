/**
 * Tag-Query schedule binding for the generated city (content-expansion task
 * 3.8; design, "Library content").
 *
 * Task 1.6 changed the archetype schedule from a Location Type id per slot
 * (`scheduleTemplates: [{ weekday, phase, locationType }]`) to a Tag Query per
 * slot (`schedule: [{ weekday, phase, at: TagQuery }]`) with an archetype-level
 * `fallback` Tag Query. A schedule slot no longer names a Location Type
 * directly; it binds through the Tag Vocabulary like every other Tag Query. At
 * generation a slot resolves to the Instantiated City's Binders of its `at`
 * query, and when the city binds none of them it falls back to the archetype's
 * `fallback` query, and then to the NPC's home District's public meeting spot
 * (design, "Library content").
 *
 * This module owns that resolution for the slice {@link City}. The Principal
 * and Background NPC generators (`./principals.ts`, `../noise/background.ts`)
 * both build concrete schedules by binding each archetype slot; they share this
 * resolver so the two read the same way and the Effective-Tags definition lives
 * in one place.
 *
 * ## Effective Tags on a slice Location
 *
 * The design's Binder rule is: an item binds a Tag Query when its **Effective
 * Tags** contain every Tag the query names, where a Location's Effective Tags
 * are its own Tags together with its Location Type's Tags (design, "City
 * instantiation"; CityView). The slice {@link Location} the core-stream
 * generator stamps carries no own Tags — only its Location Type id — so a slice
 * Location's Effective Tags are exactly its Location Type's `tags`. This module
 * reads those Tags from the loaded {@link ContentSet}'s Location Types, keyed
 * by the Location Type id each Location was stamped from, and treats an unknown
 * type as contributing no Tags (a defensive floor; the loader guarantees a
 * stamped type resolves).
 *
 * ## Determinism
 *
 * The resolver only *selects* candidate Locations for a query; the caller draws
 * one from the returned, id-sorted list on its own stream, exactly as the old
 * Location-Type binding did. Keeping the list id-sorted means the draw sequence
 * does not depend on map iteration order, so the schedule stays a pure function
 * of the stream and the content (Requirement 1.2).
 */

import type { City, Location } from './city.js';
import type { ContentSet, LocationType } from '@tradecraft/content';

/**
 * The Tag that marks a public meeting spot — the schedule binder's final
 * fallback target (design, "Library content": "then to the NPC's home
 * District's public meeting spot"). It is the `function:meeting-spot` Tag the
 * core Tag Vocabulary gives every café, park, hotel bar, station concourse and
 * other open meeting ground.
 */
export const MEETING_SPOT_TAG = 'function:meeting-spot';

/**
 * A reusable binder over a generated {@link City}: it resolves a Tag Query to
 * the city's Locations whose Effective Tags satisfy it, caching each Location's
 * Effective Tags so repeated schedule binding across a roster of NPCs is cheap.
 *
 * Build one per city with {@link cityScheduleBinder} and pass it to the per-NPC
 * schedule builders. The binder is read-only over the city and the content; it
 * draws no randomness.
 */
export interface CityScheduleBinder {
  /**
   * The Locations whose Effective Tags contain every Tag in `query`, id-sorted.
   * An empty query matches every Location. Returns an empty array when the city
   * binds none.
   */
  binders(query: readonly string[]): Location[];
  /**
   * The public Locations whose Effective Tags contain every Tag in `query`,
   * id-sorted. The Background NPC generator keeps civilians in public view, so
   * it binds only public Locations.
   */
  publicBinders(query: readonly string[]): Location[];
  /** Every public Location in the city, id-sorted (the broad civilian fallback). */
  allPublic(): Location[];
  /** Every Location in the city, id-sorted (the broad Principal fallback). */
  all(): Location[];
}

/** Build the Location-Type → Tags lookup once from the loaded content. */
function locationTypeTags(content: ContentSet): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const [id, type] of content.locationTypes) {
    // Index by both the namespaced id and the bare local id, because a stamped
    // Location's `type` is the bare Location Type id (e.g. `kaffeehaus`) while
    // the registry key is namespaced (`core/kaffeehaus`).
    const typed = type as LocationType;
    out.set(id, typed.tags);
    const slash = id.indexOf('/');
    if (slash !== -1) {
      out.set(id.slice(slash + 1), typed.tags);
    }
  }
  return out;
}

/** True when `tags` contains every Tag in `query` (Effective Tags ⊇ query). */
function satisfies(tags: ReadonlySet<string>, query: readonly string[]): boolean {
  for (const tag of query) {
    if (!tags.has(tag)) {
      return false;
    }
  }
  return true;
}

/**
 * Build a {@link CityScheduleBinder} over a generated city and the loaded
 * content (content-expansion task 3.8).
 *
 * The binder reads each Location's Effective Tags from its Location Type's
 * `tags` (a slice Location carries no own Tags), caches them, and answers Tag
 * Query lookups against the id-sorted Location list. It is pure over its inputs
 * and draws no randomness.
 */
export function cityScheduleBinder(
  city: City,
  content: ContentSet,
): CityScheduleBinder {
  const typeTags = locationTypeTags(content);
  const sorted = Object.values(city.locations).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const sortedPublic = sorted.filter((l) => l.public);

  const effectiveCache = new Map<string, Set<string>>();
  const effectiveTagsOf = (loc: Location): Set<string> => {
    let set = effectiveCache.get(loc.id);
    if (set === undefined) {
      set = new Set<string>(typeTags.get(loc.type) ?? []);
      effectiveCache.set(loc.id, set);
    }
    return set;
  };

  const matching = (pool: readonly Location[], query: readonly string[]): Location[] =>
    pool.filter((loc) => satisfies(effectiveTagsOf(loc), query));

  return {
    binders: (query) => matching(sorted, query),
    publicBinders: (query) => matching(sortedPublic, query),
    allPublic: () => [...sortedPublic],
    all: () => [...sorted],
  };
}

/**
 * Resolve a schedule slot to the candidate Locations an NPC may be bound to,
 * following the design's fallback chain (design, "Library content"):
 *
 * 1. the city's Binders of the slot's `at` Tag Query;
 * 2. when the city binds none, the Binders of the archetype's `fallback` query
 *    (when the archetype declares one);
 * 3. when neither binds, the city's public meeting spots
 *    (`function:meeting-spot`) — the "home District's public meeting spot"
 *    floor, applied city-wide for the slice city, which has no per-NPC home
 *    District;
 * 4. and, so an NPC is never left with nowhere to be, the broad fallback the
 *    caller supplies (every Location for a Principal, every public Location for
 *    a civilian).
 *
 * `publicOnly` selects the public-Location view for a civilian (Background NPC)
 * schedule and the full view for a Principal schedule. The returned list is the
 * binder's id-sorted candidates; the caller draws one on its own stream.
 */
export function resolveScheduleCandidates(
  binder: CityScheduleBinder,
  at: readonly string[],
  fallback: readonly string[] | undefined,
  publicOnly: boolean,
): Location[] {
  const bind = publicOnly ? binder.publicBinders : binder.binders;
  const primary = bind(at);
  if (primary.length > 0) {
    return primary;
  }
  if (fallback !== undefined && fallback.length > 0) {
    const fell = bind(fallback);
    if (fell.length > 0) {
      return fell;
    }
  }
  const meeting = bind([MEETING_SPOT_TAG]);
  if (meeting.length > 0) {
    return meeting;
  }
  return publicOnly ? binder.allPublic() : binder.all();
}

/**
 * Count how many of an archetype's schedule slots bind the diplomatic mission —
 * i.e. whose `at` Tag Query names the mission tag `function:embassy`
 * (content-expansion task 3.8). Replaces the old plurality count over
 * `slot.locationType === 'embassy'`: a declared hostile-power post is now read
 * off the schedule's Tag Queries, since a slot names a Tag Query rather than a
 * Location Type id.
 */
export function missionSlotCount(
  schedule: readonly { readonly at: readonly string[] }[],
  missionTag: string,
): number {
  let n = 0;
  for (const slot of schedule) {
    if (slot.at.includes(missionTag)) {
      n += 1;
    }
  }
  return n;
}

/**
 * The number of other distinct Tag Queries a schedule spends slots on, so a
 * caller can decide whether the mission is the archetype's *primary* posting
 * (strict plurality). Two queries are "the same" when they name the same Tags
 * in the same order (the authored form), which is enough to tell the resident
 * (mission twice, a bar once) from the case officer (a café, a park and the
 * mission once each).
 */
export function nonMissionSlotMax(
  schedule: readonly { readonly at: readonly string[] }[],
  missionTag: string,
): number {
  const counts = new Map<string, number>();
  for (const slot of schedule) {
    if (slot.at.includes(missionTag)) {
      continue;
    }
    const key = slot.at.join('\u0000');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let max = 0;
  for (const count of counts.values()) {
    if (count > max) {
      max = count;
    }
  }
  return max;
}

/** The diplomatic-mission Tag a declared hostile post is read against. */
export const MISSION_TAG = 'function:embassy';
