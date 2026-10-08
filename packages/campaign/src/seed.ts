/**
 * Campaign seeds (design, "Determinism"; Requirements 2.1, 2.2).
 *
 * A posting's world seed is `derive(campaignSeed, k)` for posting index `k`.
 * The campaign's own draws (HQ steps, reviews, arc rolls) use a separate
 * stream at `0xC0000`, above the ambient block (`0x50000`–`0x5FFFF`) and the
 * plot-lab streams (`0x31000`, `0x32000`).
 */

import { derive } from '@tradecraft/engine';

/** Stream index for campaign-loop draws. Not a posting index. */
export const CAMPAIGN_STREAM = 0xc0000;

/**
 * The world seed for posting `k`. Depends only on the campaign seed and `k`,
 * never on the choice log or the campaign stream.
 */
export function postingSeed(campaignSeed: string, k: number): string {
  return derive(campaignSeed, k);
}

/** The campaign-loop stream seed: `derive(campaignSeed, 0xC0000)`. */
export function campaignStream(campaignSeed: string): string {
  return derive(campaignSeed, CAMPAIGN_STREAM);
}
