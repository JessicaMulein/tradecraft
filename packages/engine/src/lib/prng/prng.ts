/**
 * xoshiro128** — the single source of randomness for the whole simulation.
 *
 * Every random choice in Tradecraft is drawn from here so that a seed plus an
 * action log fully determines a playthrough (Requirements 1.2, 17.1, 17.2). The
 * state is four 32-bit words, which serialise straight into a `SaveSnapshot`
 * with no custom codec.
 *
 * The algorithm is xoshiro128** by David Blackman and Sebastiano Vigna, which
 * they released into the public domain; see https://prng.di.unimi.it/ for the
 * reference description. The arithmetic below is written with `Math.imul` and
 * `>>> 0` so that every intermediate stays in 32-bit unsigned range in JS.
 */

import { z } from 'zod';

/** Number of distinct values a 32-bit unsigned word can hold. */
const UINT32_SPAN = 0x1_0000_0000;
const MAX_UINT32 = 0xffffffff;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const WORD_MESSAGE = 'PRNG state words must be integers in [0, 2^32)';

const stateWord = z
  .int(WORD_MESSAGE)
  .min(0, WORD_MESSAGE)
  .max(MAX_UINT32, WORD_MESSAGE);

/**
 * A serialised PRNG state: four 32-bit unsigned words, never all zero.
 *
 * Saves are plain JSON on disk, so a loaded state is parsed rather than trusted
 * (Requirement 17.1). Validating here means a corrupt save fails loudly at load
 * instead of silently producing a different playthrough.
 */
export const PrngStateSchema = z
  .tuple(
    [stateWord, stateWord, stateWord, stateWord],
    'PRNG state must hold exactly 4 words',
  )
  .readonly()
  .refine(
    (words) => words.some((word) => word !== 0),
    'PRNG state must not be all zero',
  );

/**
 * A PRNG state.
 *
 * Plain numbers in a tuple, so `JSON.parse(JSON.stringify(state))` is a faithful
 * round-trip and a save file needs no special handling.
 */
export type PrngState = readonly [number, number, number, number];

/** Parse a state read from a save file or any other untrusted source. */
export function parsePrngState(value: unknown): PrngState {
  return PrngStateSchema.parse(value);
}

/**
 * A seeded random source. Draw order is part of the simulation's contract: two
 * runs that make the same calls in the same order see the same values.
 */
export interface Prng {
  /** Next raw word, in `[0, 2^32)`. */
  nextUint32(): number;
  /** Next float in `[0, 1)`. */
  next(): number;
  /** Integer in `[min, max]`, both ends inclusive, drawn without modulo bias. */
  int(min: number, max: number): number;
  /** True with the given probability (default 0.5). */
  bool(probability?: number): boolean;
  /** Uniform choice from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates shuffle returning a new array; the input is left untouched. */
  shuffle<T>(items: readonly T[]): T[];
  /** Snapshot of the current state, safe to serialise or hand to `createPrng`. */
  state(): PrngState;
}

function u32(value: number): number {
  return value >>> 0;
}

/** Rotate a 32-bit word left by `k` bits. */
function rotl(value: number, k: number): number {
  return u32((value << k) | (value >>> (32 - k)));
}

/**
 * FNV-1a over the string's UTF-16 code units. Both bytes of each unit are mixed
 * in, so surrogate pairs and non-ASCII seeds hash distinctly.
 */
function fnv1a(input: string, basis: number = FNV_OFFSET_BASIS): number {
  let hash = u32(basis);
  for (let i = 0; i < input.length; i += 1) {
    const unit = input.charCodeAt(i);
    hash = u32(Math.imul(hash ^ (unit & 0xff), FNV_PRIME));
    hash = u32(Math.imul(hash ^ (unit >>> 8), FNV_PRIME));
  }
  return hash;
}

/**
 * SplitMix32: expands one word into a stream of well-mixed words. Used only to
 * turn a seed string into a full xoshiro state, never for gameplay draws.
 */
function splitmix32(seed: number): () => number {
  let s = u32(seed);
  return () => {
    s = u32(s + 0x9e3779b9);
    let z = s;
    z = u32(Math.imul(z ^ (z >>> 16), 0x21f0aaad));
    z = u32(Math.imul(z ^ (z >>> 15), 0x735a2d97));
    return u32(z ^ (z >>> 15));
  };
}

function hex8(word: number): string {
  return u32(word).toString(16).padStart(8, '0');
}

/** Expand an arbitrary seed string into a valid xoshiro128** state. */
export function seedState(seed: string): PrngState {
  const nextWord = splitmix32(fnv1a(seed));
  // xoshiro128** is undefined for an all-zero state, so redraw until non-zero.
  // SplitMix32 makes this effectively unreachable, but the loop keeps the
  // invariant local rather than assumed.
  for (;;) {
    const words: PrngState = [nextWord(), nextWord(), nextWord(), nextWord()];
    if (words[0] !== 0 || words[1] !== 0 || words[2] !== 0 || words[3] !== 0) {
      return words;
    }
  }
}

/** Separator that cannot appear in a hand-typed seed, so `derive` cannot collide
 * with a plain seed string by accident. */
const DERIVE_TAG = '\u0000derive\u0000';

/**
 * Deterministically derive sub-seed `n` from a base seed.
 *
 * Returns a seed *string* rather than a state, so a derived seed can be
 * displayed, saved and re-entered like any other. Used by the world generator
 * when discovery-path verification fails and generation has to be retried
 * (Requirement 1.4), and anywhere a subsystem needs its own independent stream.
 */
export function derive(seed: string, n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > MAX_UINT32) {
    throw new RangeError(
      `derive(): n must be an integer in [0, 2^32), received ${String(n)}`,
    );
  }
  const nextWord = splitmix32(fnv1a(`${seed}${DERIVE_TAG}${n}`));
  return `${hex8(nextWord())}${hex8(nextWord())}`;
}

/**
 * Create a generator from a seed string or from a previously saved state.
 *
 * Passing a saved state resumes the exact stream it was taken from, which is
 * what makes save/load and replay reproduce a session (Requirements 17.2, 17.4).
 */
export function createPrng(seed: string | PrngState): Prng {
  const initial =
    typeof seed === 'string' ? seedState(seed) : parsePrngState(seed);

  let [s0, s1, s2, s3] = initial;

  const nextUint32 = (): number => {
    const result = u32(Math.imul(rotl(u32(Math.imul(s1, 5)), 7), 9));
    const t = u32(s1 << 9);
    s2 = u32(s2 ^ s0);
    s3 = u32(s3 ^ s1);
    s1 = u32(s1 ^ s2);
    s0 = u32(s0 ^ s3);
    s2 = u32(s2 ^ t);
    s3 = rotl(s3, 11);
    return result;
  };

  const next = (): number => nextUint32() / UINT32_SPAN;

  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new RangeError(
        `int(): bounds must be integers, received [${String(min)}, ${String(max)}]`,
      );
    }
    if (max < min) {
      throw new RangeError(
        `int(): max must be >= min, received [${min}, ${max}]`,
      );
    }
    const span = max - min + 1;
    if (span > UINT32_SPAN) {
      throw new RangeError(
        `int(): range must span at most 2^32 values, received ${span}`,
      );
    }
    if (span === UINT32_SPAN) {
      return min + nextUint32();
    }
    // Rejection sampling: plain modulo would favour the low end of the range,
    // which would quietly bias world generation.
    const limit = UINT32_SPAN - (UINT32_SPAN % span);
    let draw = nextUint32();
    while (draw >= limit) {
      draw = nextUint32();
    }
    return min + (draw % span);
  };

  const bool = (probability = 0.5): boolean => {
    if (!(probability >= 0 && probability <= 1)) {
      throw new RangeError(
        `bool(): probability must be in [0, 1], received ${String(probability)}`,
      );
    }
    return next() < probability;
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new RangeError('pick(): cannot pick from an empty array');
    }
    return items[int(0, items.length - 1)];
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      const held = out[i];
      out[i] = out[j];
      out[j] = held;
    }
    return out;
  };

  const state = (): PrngState => [s0, s1, s2, s3];

  return { nextUint32, next, int, bool, pick, shuffle, state };
}
