/**
 * The street PRNG family (task 4.2).
 *
 * `streetStream = derive(seed, 0x80000)`. That id sits above the region block
 * (`0x70000`–`0x7FFFF`) and below the campaign stream (`0xC0000`). Each draw
 * uses its own sub-stream, keyed by kind and a stable key, so a new draw in
 * one kind cannot move another.
 */

import { createPrng, derive, type Prng } from '../prng/prng.js';

import type { StreetReplayHeader } from './state.js';

/** `derive(seed, STREET_STREAM_BASE)` is the street stream. */
export const STREET_STREAM_BASE = 0x80000;

export const STREET_SUBSTREAMS = ['tail', 'spot', 'checkpoint', 'bluff'] as const;
export type StreetSubstream = (typeof STREET_SUBSTREAMS)[number];

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a32(text: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

export function streetReplayHeader(): StreetReplayHeader {
  return { stream: 'street', base: STREET_STREAM_BASE, substreams: STREET_SUBSTREAMS };
}

export function streetStream(seed: string): string {
  return derive(seed, STREET_STREAM_BASE);
}

/** A sub-stream that does not move when a sibling kind draws. */
export function streetSubstream(seed: string, kind: StreetSubstream, stableKey: string): Prng {
  const n = fnv1a32(`${kind}\u0000${stableKey}`);
  return createPrng(derive(streetStream(seed), n));
}
