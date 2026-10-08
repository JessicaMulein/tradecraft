/**
 * Carry and arc streams (campaign-career design). The block `0x60000`–`0x6FFFF`
 * belongs to a posting. Carry attempt *j* is `derive(derive(postingSeed,
 * 0x60000), j)`. Arc attempt *j* is `derive(derive(postingSeed, 0x61000), j)`.
 * Neither overlaps the core, noise, setting, select, or ambient streams.
 */

import { derive } from '../prng/prng.js';

/** Base of the carry block. Attempt *j* derives again from this seed. */
export const CARRY_STREAM_BASE = 0x60000;

/** Arc threads draw on this stream, inside the carry block and off the carry seed. */
export const ARC_STREAM_BASE = 0x61000;

/** Exclusive end of the posting carry block. */
export const CARRY_STREAM_LIMIT = 0x70000;

/** How many full placements are tried before optional pieces are dropped. */
export const CARRY_ATTEMPTS = 8;

export function carryStreamSeed(postingSeed: string, attempt: number): string {
  return derive(derive(postingSeed, CARRY_STREAM_BASE), attempt);
}

export function arcStreamSeed(postingSeed: string, attempt: number): string {
  return derive(derive(postingSeed, ARC_STREAM_BASE), attempt);
}
