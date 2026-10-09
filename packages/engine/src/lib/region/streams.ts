/**
 * Regional PRNG streams (multi-city design, stream table; Requirement 1.3).
 *
 * The game seed yields one region seed, `derive(seed, 0x70000)`. Every per-city
 * stream derives from that region seed, so a city's draws never move the slice
 * core, noise, daily, hostile, setting, ambient or carry streams. `generate`
 * does not call these helpers; a slice world keeps its single runtime
 * {@link PrngState}.
 *
 * City index `i` is 0-based in region-template order.
 */

import type { CityId } from '../fidelity/types.js';
import { createPrng, derive, type PrngState } from '../prng/prng.js';

/** Game-seed offset of the region stream. The block through {@link REGION_STREAM_END} stays reserved. */
export const REGION_STREAM_BASE = 0x70000;

/** Last game-seed offset reserved for the region block. */
export const REGION_STREAM_END = 0x7ffff;

/** `derive(seed, 0x70000)`. */
export function regionSeed(seed: string): string {
  return derive(seed, REGION_STREAM_BASE);
}

/** Region-stream retry `k`: `derive(regionSeed, k)`. */
export function regionRetrySeed(seed: string, attempt: number): string {
  return derive(regionSeed(seed), attempt);
}

/** City `i` core stream: `derive(regionSeed, 0x100 + i)`. */
export function cityCoreSeed(seed: string, index: number): string {
  return derive(regionSeed(seed), 0x100 + index);
}

/** City `i` noise stream: `derive(regionSeed, 0x200 + i)`. */
export function cityNoiseSeed(seed: string, index: number): string {
  return derive(regionSeed(seed), 0x200 + index);
}

/** Noise retry `k` for city `i`: `derive(cityNoiseSeed, k)`. */
export function cityNoiseRetrySeed(seed: string, index: number, attempt: number): string {
  return derive(cityNoiseSeed(seed, index), attempt);
}

/** City `i` daily stream for `day`: `derive(derive(regionSeed, 0x300 + i), day)`. */
export function cityDailySeed(seed: string, index: number, day: number): string {
  return derive(derive(regionSeed(seed), 0x300 + index), day);
}

/** Initial spine seed for city `i`: `derive(regionSeed, 0x400 + i)`. */
export function citySpineSeed(seed: string, index: number): string {
  return derive(regionSeed(seed), 0x400 + index);
}

/** Initial ambient seed for city `i`: `derive(regionSeed, 0x500 + i)`. */
export function cityAmbientSeed(seed: string, index: number): string {
  return derive(regionSeed(seed), 0x500 + index);
}

/**
 * Saved per-city spine and ambient states, initialised from the spine and
 * ambient seeds and not yet drawn. The keys follow `cities` in template order.
 */
export interface SavedCityStreams {
  readonly spine: Readonly<Record<CityId, PrngState>>;
  readonly ambient: Readonly<Record<CityId, PrngState>>;
}

/** The initial saved spine and ambient states for `cities` in template order. */
export function initialCityStreams(seed: string, cities: readonly CityId[]): SavedCityStreams {
  const spine: Record<CityId, PrngState> = {};
  const ambient: Record<CityId, PrngState> = {};
  for (let index = 0; index < cities.length; index += 1) {
    const city = cities[index];
    spine[city] = createPrng(citySpineSeed(seed, index)).state();
    ambient[city] = createPrng(cityAmbientSeed(seed, index)).state();
  }
  return { spine, ambient };
}
