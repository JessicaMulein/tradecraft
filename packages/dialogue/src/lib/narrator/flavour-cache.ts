/**
 * The Location Flavour cache (task 15.4) — the store that lets the café look
 * the same each Tuesday morning.
 *
 * On arrival, a separate `arrival` narration describes the Location itself
 * (not an action), and the design is specific about how it is reused: it is
 * "keyed by `(locId, phase, crowdBand)`, stored in the save, and reused, so the
 * café looks the same each Tuesday morning. Action narrations are not cached"
 * (Requirement 20.7). This module owns that cache.
 *
 * The contract is deliberately narrow:
 *
 *   - A **stable string key** is composed from the Location id, the phase
 *     ordinal and the crowd band ({@link flavourCacheKey}). The same triple
 *     always yields the same key, and each of the three parts is part of the
 *     key, so two visits that differ in *any* of them are distinct entries.
 *   - {@link LocationFlavourCache.get} returns the stored Flavour on a hit and
 *     `undefined` on a miss.
 *   - {@link LocationFlavourCache.getOrProduce} is the get-or-produce step the
 *     narration flow uses: on a hit it returns the stored Flavour *without*
 *     calling the producer; on a miss it calls the producer once, stores the
 *     result under the key, and returns it. Repeated visits in the same phase
 *     and crowd band therefore reuse the first Flavour rather than regenerating
 *     it.
 *
 * Determinism is a hard engine requirement: the same key must always resolve to
 * the same Flavour. The cache upholds its half of that — a stored key is never
 * recomputed, and a defensive copy of the stored Flavour is returned so a
 * caller can never mutate a cached entry out from under a later visit. (The
 * producer's own determinism is the caller's concern; the Narrator stream is
 * seeded deterministically elsewhere.)
 *
 * The cache is **save-backed**: {@link LocationFlavourCache.snapshot} returns a
 * plain, JSON-serialisable record for the save file, and
 * {@link LocationFlavourCache.from} rehydrates a cache from such a snapshot.
 * Flavour is stored only here and in transcripts — never the Case File or the
 * Journal fact log — so the snapshot carries display text, not facts.
 */

import type { CrowdLevel, LocId, Phase } from '@tradecraft/engine';

/**
 * The three parts a Location Flavour entry is keyed by (design:
 * `(locId, phase, crowdBand)`). An arrival narration for the same Location in
 * the same phase and crowd band reuses the same entry.
 */
export interface FlavourCacheCoords {
  /** The Location the arrival narration describes. */
  readonly loc: LocId;
  /** The phase ordinal (`0` morning … `3` night) the visit falls in. */
  readonly phase: Phase;
  /** The crowd band the Location is in at the visit. */
  readonly crowd: CrowdLevel;
}

/**
 * A released Flavour: the clean sentences a narration produced, in order —
 * exactly the shape {@link streamNarration}'s result carries in its `flavour`
 * field. Stored and returned as a `readonly string[]`.
 */
export type CachedFlavour = readonly string[];

/**
 * A save-serialisable snapshot of the cache: a plain record from the stable
 * string key to the stored Flavour sentences. This is what lands in the save
 * file; {@link LocationFlavourCache.from} reads it back.
 */
export type FlavourCacheSnapshot = Readonly<Record<string, CachedFlavour>>;

/**
 * Compose the stable string key for a Location Flavour entry from its
 * {@link FlavourCacheCoords}.
 *
 * The key is `<locId>|<phase>|<crowd>` — the Location id, the phase ordinal and
 * the crowd band joined by `|`. The pipe cannot appear in any of the three
 * parts (a `LocId` is `loc:<slug>`, the phase is a single digit, and the crowd
 * band is one of a fixed word set), so the join is unambiguous and the mapping
 * from a triple to a key is injective: two coords produce the same key only
 * when all three parts match. The key is therefore sensitive to each of the
 * Location, the phase and the crowd band individually.
 *
 * Pure and deterministic: the same coords always produce the same string.
 */
export function flavourCacheKey(coords: FlavourCacheCoords): string {
  return `${coords.loc}|${coords.phase}|${coords.crowd}`;
}

/**
 * The Location Flavour cache: a map from the stable key to the stored Flavour,
 * with get-or-produce semantics and a save snapshot.
 *
 * It holds display text only. It is not thread-shared and performs no I/O; the
 * producer passed to {@link getOrProduce} is where any model work happens, and
 * it is called at most once per key.
 */
export class LocationFlavourCache {
  private readonly entries: Map<string, CachedFlavour>;

  private constructor(entries: Map<string, CachedFlavour>) {
    this.entries = entries;
  }

  /** Create an empty cache (a fresh save, or a game with no visits yet). */
  static empty(): LocationFlavourCache {
    return new LocationFlavourCache(new Map());
  }

  /**
   * Rehydrate a cache from a {@link FlavourCacheSnapshot} read from the save.
   * The snapshot's Flavour arrays are defensively copied so later cache writes
   * cannot alias the loaded save object.
   */
  static from(snapshot: FlavourCacheSnapshot): LocationFlavourCache {
    const entries = new Map<string, CachedFlavour>();
    for (const [key, flavour] of Object.entries(snapshot)) {
      entries.set(key, [...flavour]);
    }
    return new LocationFlavourCache(entries);
  }

  /** Whether a Flavour is cached for these coords. */
  has(coords: FlavourCacheCoords): boolean {
    return this.entries.has(flavourCacheKey(coords));
  }

  /**
   * The cached Flavour for these coords, or `undefined` on a miss. On a hit a
   * defensive copy is returned, so a caller cannot mutate the stored entry.
   */
  get(coords: FlavourCacheCoords): CachedFlavour | undefined {
    const stored = this.entries.get(flavourCacheKey(coords));
    return stored === undefined ? undefined : [...stored];
  }

  /**
   * Store (or overwrite) the Flavour for these coords. A defensive copy is
   * taken so later mutation of the caller's array cannot change the cached
   * entry. Returns the copy that was stored.
   */
  set(coords: FlavourCacheCoords, flavour: CachedFlavour): CachedFlavour {
    const copy = [...flavour];
    this.entries.set(flavourCacheKey(coords), copy);
    return [...copy];
  }

  /**
   * Get-or-produce: the step the arrival-narration flow uses.
   *
   *   - On a **hit**, the stored Flavour is returned and `produce` is *not*
   *     called — the Location reuses its first Flavour (Requirement 20.7).
   *   - On a **miss**, `produce` is called once, its result is stored under the
   *     key and returned.
   *
   * A defensive copy is returned on both paths, so the caller never holds a
   * reference to the stored entry. `produce` may be async (the Narrator stream
   * is), so this returns a promise.
   */
  async getOrProduce(
    coords: FlavourCacheCoords,
    produce: () => CachedFlavour | Promise<CachedFlavour>,
  ): Promise<CachedFlavour> {
    const hit = this.get(coords);
    if (hit !== undefined) {
      return hit;
    }
    const produced = await produce();
    return this.set(coords, produced);
  }

  /** The number of distinct entries held. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * A plain, JSON-serialisable snapshot for the save file: the stable key to
   * the stored Flavour. The arrays are copied so the snapshot does not alias
   * the live cache.
   */
  snapshot(): FlavourCacheSnapshot {
    const out: Record<string, CachedFlavour> = {};
    for (const [key, flavour] of this.entries) {
      out[key] = [...flavour];
    }
    return out;
  }
}
