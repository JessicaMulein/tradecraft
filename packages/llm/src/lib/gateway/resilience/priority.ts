/**
 * Call priorities and the Role → priority mapping (design "LLM Gateway":
 * "Interactive calls run in the order intent → voice → narrator → extraction").
 *
 * The design orders concurrent model work by its place in the turn pipeline,
 * not by Model Role: intent classification first, then the voice reply, then
 * narration, then the between-turns claim extraction. Those pipeline stages do
 * not map one-to-one onto the five {@link Role}s — intent classification and
 * extraction both run on the `fast`/`bookkeeping` line — so priority is its own
 * axis. {@link CallPriority} names the four queue bands; lower numbers run
 * ahead of higher ones, so the numeric value is the band's rank.
 *
 * A call's priority is supplied by the caller (the dialogue and narrator layers
 * know which pipeline stage they are in). {@link rolePriority} gives a sensible
 * default from the Role alone for callers that do not say: `fast` is treated as
 * intent-class work, `voice`/`judge` as the reply band, `narrator` as narration
 * and `bookkeeping` as extraction.
 */

import type { Role } from '../../config/models-config.js';

/**
 * The four priority bands, in dispatch order. Numeric values are ranks: a
 * smaller rank is higher priority and runs/preempts ahead of a larger one, so
 * `Intent < Voice < Narrator < Extraction` reproduces the design's
 * intent → voice → narrator → extraction order.
 */
export enum CallPriority {
  Intent = 0,
  Voice = 1,
  Narrator = 2,
  Extraction = 3,
}

/** The ordered priority bands, highest priority first. */
export const PRIORITY_ORDER: readonly CallPriority[] = [
  CallPriority.Intent,
  CallPriority.Voice,
  CallPriority.Narrator,
  CallPriority.Extraction,
];

/**
 * The default priority band for a Role, for callers that schedule by Role alone
 * rather than naming the pipeline stage. The mapping follows how the dialogue
 * pipeline uses each role: the `fast` role classifies intent, `voice` and
 * `judge` produce the interactive reply, `narrator` narrates and `bookkeeping`
 * runs the between-turns extraction.
 */
export function rolePriority(role: Role): CallPriority {
  switch (role) {
    case 'fast':
      return CallPriority.Intent;
    case 'voice':
    case 'judge':
      return CallPriority.Voice;
    case 'narrator':
      return CallPriority.Narrator;
    case 'bookkeeping':
      return CallPriority.Extraction;
  }
}
