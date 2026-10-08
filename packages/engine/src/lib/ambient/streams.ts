/**
 * Keyed ambient PRNG streams (ambient-world design, Ambient streams).
 *
 * Offsets sit in 0x50000–0x5FFFF. A draw is `derive(derive(seed, base + day), fnv1a32(key))`,
 * so two keys never share a sequential stream.
 */

import { derive, fnv1a32 } from '../prng/prng.js';

export const AMBIENT_STREAM = {
  init: 0x50000,
  exo: 0x51000,
  react: 0x52000,
  life: 0x53000,
  local: 0x54000,
  notice: 0x55000,
  gossip: 0x56000,
  news: 0x57000,
  townsfolk: 0x58000,
  cover: 0x59000,
} as const;

export type AmbientStreamName = keyof typeof AMBIENT_STREAM;

/** Day-scoped stream before a key is mixed in. Init ignores the day. */
export function ambientDaySeed(seed: string, stream: AmbientStreamName, day = 0): string {
  const base = AMBIENT_STREAM[stream];
  return derive(seed, stream === 'init' || stream === 'townsfolk' ? base : base + day);
}

/** Independent sub-seed for one key on a day stream. */
export function ambientKeySeed(
  seed: string,
  stream: AmbientStreamName,
  key: string,
  day = 0,
): string {
  return derive(ambientDaySeed(seed, stream, day), fnv1a32(key));
}

/** Retry k of ambient init: derive(derive(seed, 0x50000), k). */
export function ambientInitRetry(seed: string, attempt: number): string {
  return derive(derive(seed, AMBIENT_STREAM.init), attempt);
}
