/**
 * The **setting** PRNG stream (content-expansion task 3.2).
 *
 * The slice fixes a registry of PRNG streams, each a `derive(seed, offset)`
 * sub-stream so one subsystem's draws never shift another's (slice design,
 * "PRNG stream registry"). A follow-on spec must claim a block in that registry
 * before it adds a stream; this spec claims the block `0x30000`–`0x30FFF` for
 * the setting stream (slice design, PRNG stream registry; content-expansion
 * design, "PRNG streams").
 *
 * The setting stream is used for the whole setting step — the Start Date draw,
 * the Instantiated City selection, and, on the Core City Path, the slice's
 * world-generation step 1 (Districts, Locations, Routes) — so moving step 1 off
 * the core stream for the Core City leaves steps 2–10 of the core stream
 * untouched (content-expansion Req 9.10, 9.11). Setting attempt *j* draws from
 * `derive(seed, SETTING_STREAM_BASE + j)`; `j` is the setting retry index the
 * generator advances when discovery-path verification is exhausted for the
 * current instantiation (content-expansion design, "City instantiation";
 * Req 9.9).
 *
 * Keeping the offset arithmetic here, behind {@link settingStreamSeed}, means
 * every setting draw reads the same block from one place and the block bound is
 * checked so a stray attempt index cannot silently reach into a neighbouring
 * spec's block.
 */

import { derive } from '../prng/prng.js';

/**
 * The base offset of the **setting** PRNG stream in the slice PRNG stream
 * registry: `derive(seed, 0x30000 + j)` for setting attempt *j* (content-expansion
 * design, "PRNG streams"). The block runs `0x30000`–`0x30FFF`
 * ({@link SETTING_STREAM_LIMIT}), so this spec owns 4096 attempt slots — far
 * more than the four setting attempts the generator makes before raising a
 * {@link import('./setting.js').SettingError} (Req 9.9).
 */
export const SETTING_STREAM_BASE = 0x30000;

/**
 * The exclusive upper bound of the setting stream block (`0x31000`). The next
 * block (`0x31000`–`0x31FFF`) belongs to plot-library's `select` stream, so a
 * setting attempt index must stay strictly below {@link SETTING_STREAM_LIMIT} −
 * {@link SETTING_STREAM_BASE} to keep the streams independent.
 */
export const SETTING_STREAM_LIMIT = 0x31000;

/** The number of attempt slots the setting block holds (`0x1000` = 4096). */
export const SETTING_STREAM_SPAN = SETTING_STREAM_LIMIT - SETTING_STREAM_BASE;

/**
 * The seed string of the setting stream for setting attempt `j`:
 * `derive(seed, 0x30000 + j)`.
 *
 * `derive` returns a seed *string* (not a {@link import('../prng/prng.js').PrngState}),
 * so the caller passes the result to `createPrng` to open the stream, exactly
 * as the slice's daily and noise streams do. `j` must be a non-negative integer
 * inside the setting block; an index at or past {@link SETTING_STREAM_SPAN}
 * would reach into plot-library's block and is rejected so a stream collision
 * fails loudly rather than silently.
 */
export function settingStreamSeed(seed: string, attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new RangeError(
      `settingStreamSeed(): attempt must be a non-negative integer, received ${String(attempt)}`,
    );
  }
  if (attempt >= SETTING_STREAM_SPAN) {
    throw new RangeError(
      `settingStreamSeed(): attempt ${attempt} is outside the setting stream block ` +
        `[0, ${SETTING_STREAM_SPAN})`,
    );
  }
  return derive(seed, SETTING_STREAM_BASE + attempt);
}
