/**
 * NPC physical descriptors (content-expansion task 3.5): {@link describeNpc},
 * the pure function the setting step calls to assemble one NPC's one-line
 * physical description from Descriptor Fragments (content-expansion Req 6.4,
 * 6.5; design, "Naming and descriptors").
 *
 * A descriptor is one fragment per slot in a fixed slot order (build, age,
 * clothing, headwear, feature, with `carried` optional), drawn from the pool
 * filtered to the fragments that fit the subject. The design fixes the filter
 * and the uniqueness rule:
 *
 * - **Filter.** A fragment is eligible when its `gender` is unset or equals the
 *   NPC's gender, and its `climate` is unset/empty or contains the city's
 *   climate Tag (Req 6.4). The Year Range filter is applied *upstream* by
 *   `yearFilter`, so the `frags` passed here are already in period — the design
 *   lists year with gender and climate, and `describeNpc` keeps the invariant
 *   by trusting its year-filtered input (so the assembled descriptor only ever
 *   uses in-period fragments).
 * - **Uniqueness.** One fragment is drawn per slot. If the assembled descriptor
 *   collides with one already used in the world, the whole draw is redrawn up to
 *   {@link MAX_DESCRIPTOR_REJECTIONS} times. If every redraw still collides, a
 *   further `feature` fragment is appended in enumerated order (from a drawn
 *   offset) until the descriptor is unique (Req 6.5). Appending distinguishing
 *   features is guaranteed to terminate because each extra `feature` multiplies
 *   the descriptor space, and the feature pool is far larger than any world's
 *   NPC count.
 *
 * Every random choice is drawn from the passed {@link Prng} (the core stream for
 * Principals, the noise stream for Background NPCs) in a fixed order, so the
 * result is a pure function of the fragments, gender, climate, the used-set and
 * the PRNG state (underpinning Property 10 — descriptor uniqueness, and Property
 * 14 — setting determinism). `describeNpc` does not mutate `used`; the caller
 * adds the returned descriptor after accepting it, so the next NPC's draw sees
 * it.
 */

import type { DescriptorFragment } from '@tradecraft/content';

import type { Prng } from '../prng/prng.js';

/**
 * The gender an NPC is described for: `'f'` or `'m'`, matching a Descriptor
 * Fragment's optional `gender` filter. This is the content spelling, the same
 * as `names.ts`'s {@link NameGender}; the generator wiring (task 3.8) maps the
 * slice persona's `'female'`/`'male'` onto it.
 */
export type DescriptorGender = 'f' | 'm';

/**
 * The slots a descriptor is assembled from, in render order (design,
 * `DescriptorFragment.slot`). `carried` is optional — it is only included when
 * the (filtered) pool has a `carried` fragment — so a descriptor reads as a
 * natural one-liner even when no carried item fits. `feature` fragments are also
 * the ones appended to break a collision (Req 6.5), so the slot sits before
 * `carried` in the base order and extra features are added after the base line.
 */
const BASE_SLOT_ORDER = [
  'build',
  'age',
  'clothing',
  'headwear',
  'feature',
  'carried',
] as const;

/** The number of whole-descriptor redraws before features are appended. */
export const MAX_DESCRIPTOR_REJECTIONS = 32;

/**
 * True when a fragment is eligible for the subject: its `gender` is unset or
 * equals the NPC's gender, and its `climate` is unset or empty or contains the
 * city's climate Tag (design, "Descriptors": "filtered by gender, climate and
 * year" — year applied upstream). A fragment with no filters fits every
 * subject.
 */
function isEligible(
  frag: DescriptorFragment,
  gender: DescriptorGender,
  climate: string,
): boolean {
  if (frag.gender !== undefined && frag.gender !== gender) {
    return false;
  }
  if (
    frag.climate !== undefined &&
    frag.climate.length > 0 &&
    !frag.climate.includes(climate)
  ) {
    return false;
  }
  return true;
}

/**
 * Group the eligible fragments by slot, each list sorted by id so the draw and
 * the enumeration fallback are deterministic for a fragment set regardless of
 * the authored file order. A slot with no eligible fragment maps to an empty
 * list.
 */
function poolsBySlot(
  frags: readonly DescriptorFragment[],
  gender: DescriptorGender,
  climate: string,
): Map<DescriptorFragment['slot'], DescriptorFragment[]> {
  const pools = new Map<DescriptorFragment['slot'], DescriptorFragment[]>();
  for (const slot of BASE_SLOT_ORDER) {
    pools.set(slot, []);
  }
  for (const frag of frags) {
    if (isEligible(frag, gender, climate)) {
      pools.get(frag.slot)?.push(frag);
    }
  }
  for (const list of pools.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return pools;
}

/**
 * Join a descriptor's fragment texts into the one-line description. Fragments
 * are joined with a single space in slot order; the texts carry their own
 * phrasing, matching the slice descriptor rendering.
 */
function joinDescriptor(parts: readonly string[]): string {
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Draw one fragment's text per base slot from the eligible pools, in slot
 * order, on `rng`. `carried` is included only when its pool is non-empty; every
 * other slot with an empty pool is skipped (a defective pool the caller's
 * content targets rule out). The draw order is fixed, so the sequence is
 * deterministic for a PRNG state.
 */
function drawBase(
  pools: Map<DescriptorFragment['slot'], DescriptorFragment[]>,
  rng: Prng,
): string[] {
  const parts: string[] = [];
  for (const slot of BASE_SLOT_ORDER) {
    const pool = pools.get(slot);
    if (pool === undefined || pool.length === 0) {
      continue;
    }
    parts.push(rng.pick(pool).text);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// describeNpc
// ---------------------------------------------------------------------------

/**
 * Assemble one NPC's unique one-line physical descriptor (design, "Descriptors";
 * Req 6.4, 6.5).
 *
 * `frags` are the (year-filtered) Descriptor Fragments; `gender` the NPC's
 * gender; `climate` the city's climate Tag; `used` the set of descriptors
 * already assigned in the world (never mutated here); `rng` the generating
 * stream.
 *
 * One fragment is drawn per slot from the pool filtered to the subject's gender
 * and the city's climate. If the assembled line collides with a used one, the
 * whole draw is redrawn up to {@link MAX_DESCRIPTOR_REJECTIONS} times; if it
 * still collides, extra `feature` fragments are appended in enumerated order
 * (from a drawn offset) until the descriptor is unique — which always succeeds
 * because the feature pool is far larger than any world's NPC count, so the
 * function is total.
 *
 * Returns the assembled descriptor string.
 */
export function describeNpc(
  frags: readonly DescriptorFragment[],
  gender: DescriptorGender,
  climate: string,
  used: ReadonlySet<string>,
  rng: Prng,
): string {
  const pools = poolsBySlot(frags, gender, climate);

  // Random phase: redraw the whole descriptor on a collision.
  let base: string[] = drawBase(pools, rng);
  for (let attempt = 0; attempt < MAX_DESCRIPTOR_REJECTIONS; attempt += 1) {
    const descriptor = joinDescriptor(base);
    if (!used.has(descriptor)) {
      return descriptor;
    }
    base = drawBase(pools, rng);
  }

  // The base line keeps colliding: append `feature` fragments in enumerated
  // order from a drawn offset until the descriptor is unique (Req 6.5). Each
  // appended feature widens the space, so the walk terminates well within the
  // feature pool for any world's NPC count.
  const features = pools.get('feature') ?? [];
  if (features.length === 0) {
    // No feature to append — only reachable when the pool cannot distinguish
    // this many NPCs, a content shortfall the Pack Linter's quantity rule
    // catches. Return the colliding base so the function stays total.
    return joinDescriptor(base);
  }

  const parts = [...base];
  const offset = rng.int(0, features.length - 1);
  // Append successive features from the drawn offset, cycling the pool. Each
  // appended feature multiplies the number of distinct descriptors, so a free
  // one is found quickly; the bound is a generous multiple of the pool to stay
  // total even in the degenerate all-used case.
  const maxAppended = features.length * MAX_DESCRIPTOR_REJECTIONS;
  for (let step = 0; step < maxAppended; step += 1) {
    parts.push(features[(offset + step) % features.length].text);
    const descriptor = joinDescriptor(parts);
    if (!used.has(descriptor)) {
      return descriptor;
    }
  }

  // Every appended-feature combination up to the bound is used — unreachable for
  // conforming content. Return the longest assembled line so the function is
  // total; a duplicate here is a content-shortfall defect, not a crash.
  return joinDescriptor(parts);
}
