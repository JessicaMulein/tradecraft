/**
 * The Hostile Service's tailing of the player and the burn threshold (design,
 * "Hostile Service AI": `dailyTick` step 6, "Tailing decisions for the player,
 * from Cover Suspicion"; Requirements 12.5, 21.4).
 *
 * **Cover Suspicion** is the Hostile Service's suspicion that the player is an
 * intelligence officer (requirements glossary). It accrues on the player side
 * from surveil, approach, arrange-meeting and a tailed arrival (the Action
 * Resolver owns those raises); this leaf is the opposition's daily decision
 * about it:
 *
 * - **Tailing (Req 12.5).** When Cover Suspicion is high enough the service puts
 *   a tail on the player; when it falls back the service calls the tail off. A
 *   running tail is what the travel action reads (`WorldState.player.tailed`) to
 *   add arrival Cover Suspicion in risky places and to let a countersurveillance
 *   route shake the tail — so the two halves meet: the service *starts/ends* the
 *   tail here, the player's travel *reacts* to it. A standing tail also costs the
 *   player a little Cover Suspicion each day (the opposition is watching), which
 *   is how a tail, once set, tends to push suspicion toward the burn threshold.
 * - **The burn threshold (Req 21.4).** When Cover Suspicion crosses the preset's
 *   `coverSuspicionBurnThreshold` (default 0.8) the player is burned — a lose
 *   condition — and a hidden `player-burned` event fires. The crossing is
 *   checked on the Cover Suspicion *after* this day's tailing delta, so a tail
 *   can be the thing that tips a player over.
 *
 * ## This leaf is player-model-light (19.1's pattern)
 *
 * The leaves of task 19 deliberately stay out of the player/Relationship model
 * and return their effects as data for the Turn Pipeline to apply. So this leaf
 * does NOT mutate `WorldState.player`: the caller projects the player's current
 * Cover Suspicion and tailed flag in ({@link TailingInputs}), and
 * {@link decideTailing} returns a {@link TailingDecision} — the new tailed
 * state, the Cover-Suspicion delta a standing tail adds, the Cover Suspicion
 * after the delta, and whether the player is now burned — which the pipeline
 * writes back to `player.tailed` / `player.coverSuspicion` / `WorldState.ended`.
 * The hidden `tail-started` / `tail-ended` / `player-burned` events are returned
 * alongside.
 *
 * ## Hysteresis on the tail decision
 *
 * The start and end of a tail use two thresholds, not one: a tail *starts* when
 * suspicion rises past {@link TailingThresholds.start} and *ends* only when it
 * falls back below {@link TailingThresholds.end} (`end <= start`). The gap keeps
 * a tail from flapping on and off day to day when suspicion sits right at a
 * single cutoff. A more security-conscious doctrine tails sooner, so the caller
 * lowers `start` with `securityConsciousness` when it builds the thresholds
 * ({@link tailingThresholds}).
 *
 * ## Determinism / purity
 *
 * No draws. {@link decideTailing} is a pure function of the projected inputs and
 * the thresholds, so the same Cover Suspicion / tailed state always yields the
 * same decision and the same events (Requirement 1.2). The leaf imports only the
 * core model and the state event type — it stays Relationship-free and
 * Action-Resolver-free.
 */

import type { GameTime } from '../model/core.js';
import type { EventId, SimEvent } from '../model/state.js';
import type { Doctrine } from './doctrine.js';

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * The Cover-Suspicion cutoffs the tail decision uses. A tail starts when
 * suspicion rises past `start` and ends when it falls back below `end`
 * (`end <= start`), the hysteresis gap that stops a tail from flapping. `burn`
 * is the preset's `coverSuspicionBurnThreshold`: suspicion at or above it burns
 * the player.
 */
export interface TailingThresholds {
  /** Cover Suspicion above which the service starts a tail. */
  readonly start: number;
  /** Cover Suspicion below which the service ends a running tail (`<= start`). */
  readonly end: number;
  /** Cover Suspicion at or above which the player is burned (the preset's). */
  readonly burn: number;
}

/**
 * The default Cover-Suspicion a standing tail adds to the player per day. A
 * modest value so a tail nudges suspicion toward the burn threshold over a few
 * days rather than at once; documented so a preset can tune it. The player-side
 * raises (surveil/approach/meeting/travel) do the bulk of the work.
 */
export const DEFAULT_TAIL_SUSPICION_DELTA = 0.05;

/**
 * The default tail-start cutoff at zero `securityConsciousness`. A service that
 * is more security-conscious tails sooner, so {@link tailingThresholds} lowers
 * the start cutoff by up to {@link TAIL_START_SECURITY_SPAN} as the doctrine's
 * `securityConsciousness` rises. Documented defaults until a preset drives them.
 */
export const DEFAULT_TAIL_START = 0.5;

/** How far a maximally security-conscious doctrine lowers the tail-start cutoff. */
export const TAIL_START_SECURITY_SPAN = 0.2;

/**
 * The gap between the start and end cutoffs (the hysteresis band). The tail ends
 * only once suspicion has fallen this far below where it started.
 */
export const TAIL_HYSTERESIS = 0.1;

/** Clamp a value to `[0, 1]`. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Build the {@link TailingThresholds} from the service's doctrine and the
 * preset's burn threshold (design: "Tailing decisions for the player, from
 * Cover Suspicion"; Req 21.4). Pure. A higher `securityConsciousness` lowers the
 * tail-start cutoff (the service tails sooner), down to
 * `DEFAULT_TAIL_START − TAIL_START_SECURITY_SPAN`; the end cutoff sits
 * {@link TAIL_HYSTERESIS} below start (clamped to `>= 0`) so the band never
 * inverts. `burn` is passed straight through from the preset.
 */
export function tailingThresholds(
  doctrine: Doctrine,
  burnThreshold: number,
): TailingThresholds {
  const start = clamp01(
    DEFAULT_TAIL_START - TAIL_START_SECURITY_SPAN * doctrine.securityConsciousness,
  );
  const end = clamp01(Math.max(0, start - TAIL_HYSTERESIS));
  return { start, end, burn: clamp01(burnThreshold) };
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * The player state the tail decision reads, projected in by the caller so the
 * leaf never touches `WorldState.player` (both are the ground-truth values from
 * `player.coverSuspicion` / `player.tailed`, revealed by the caller).
 */
export interface TailingInputs {
  /** The player's current Cover Suspicion, in `[0, 1]`. */
  readonly coverSuspicion: number;
  /** Whether a tail is currently on the player. */
  readonly tailed: boolean;
}

/**
 * The tail decision the daily tick returns for the Turn Pipeline to apply (the
 * leaf stays out of `WorldState.player`). The pipeline writes `tailed` back to
 * `player.tailed` and `coverSuspicion` back to `player.coverSuspicion`, and sets
 * the burn/lose condition when `burned`.
 */
export interface TailingDecision {
  /** Whether a tail is on the player after this day's decision. */
  readonly tailed: boolean;
  /** The Cover-Suspicion a standing tail added this day (0 when not tailed). */
  readonly suspicionDelta: number;
  /** The player's Cover Suspicion after `suspicionDelta`, clamped to `[0, 1]`. */
  readonly coverSuspicion: number;
  /** True when `coverSuspicion` crossed the burn threshold this day (Req 21.4). */
  readonly burned: boolean;
}

/** The result of {@link decideTailing}: the decision and the hidden events. */
export interface TailingResult {
  /** The decision the pipeline applies to the player. */
  readonly decision: TailingDecision;
  /**
   * The hidden events: a `tail-started` / `tail-ended` when the tail state
   * changed, then a `player-burned` when the player crossed the burn threshold
   * this day. Empty when nothing changed.
   */
  readonly events: readonly SimEvent[];
}

/** Deterministically mint a tailing event id from a tag, time and seq. */
function tailEventId(tag: string, at: GameTime, seq: number): EventId {
  return `hostile-evt:${tag}:${at.day}:${at.phase}:${seq}`;
}

/**
 * Decide the day's tailing of the player and check the burn threshold (design,
 * step 6; Req 12.5, 21.4). Pure, no draws.
 *
 * Given the projected player Cover Suspicion and tailed flag and the
 * {@link TailingThresholds}:
 *
 * 1. **Tail decision (Req 12.5).** With hysteresis: if not tailed, start a tail
 *    when suspicion is at or above `start` (emit `tail-started`); if tailed, end
 *    it when suspicion is below `end` (emit `tail-ended`); otherwise the tail
 *    state is unchanged and no tail event fires.
 * 2. **Standing-tail cost.** When a tail is running *after* the decision, add
 *    {@link DEFAULT_TAIL_SUSPICION_DELTA} to Cover Suspicion (clamped to `[0,
 *    1]`); otherwise the delta is 0. This is the daily cost of being watched —
 *    the player-side travel/surveil raises do the rest.
 * 3. **Burn threshold (Req 21.4).** The player is burned when Cover Suspicion
 *    *after* the delta is at or above `burn` and it was *below* `burn` before
 *    this day's delta — i.e. this day's tailing is what tipped it over, so a
 *    player already past the threshold is not re-burned each day. Emits
 *    `player-burned` on the crossing.
 *
 * The decision is returned as data for the pipeline to write to the player; the
 * events are the hidden `tail-started` / `tail-ended` / `player-burned`.
 */
export function decideTailing(
  inputs: TailingInputs,
  thresholds: TailingThresholds,
  at: GameTime,
): TailingResult {
  const before = clamp01(inputs.coverSuspicion);
  const events: SimEvent[] = [];
  let seq = 0;

  // Step 1: the tail start/end decision, with hysteresis.
  let tailed = inputs.tailed;
  if (!tailed && before >= thresholds.start) {
    tailed = true;
    events.push({
      id: tailEventId('tail-started', at, seq),
      at,
      visibility: 'hidden',
      kind: 'tail-started',
    });
    seq += 1;
  } else if (tailed && before < thresholds.end) {
    tailed = false;
    events.push({
      id: tailEventId('tail-ended', at, seq),
      at,
      visibility: 'hidden',
      kind: 'tail-ended',
    });
    seq += 1;
  }

  // Step 2: a standing tail adds its daily Cover-Suspicion cost.
  const suspicionDelta = tailed ? DEFAULT_TAIL_SUSPICION_DELTA : 0;
  const coverSuspicion = clamp01(before + suspicionDelta);

  // Step 3: burn when this day's suspicion crossed the burn threshold.
  const burned = coverSuspicion >= thresholds.burn && before < thresholds.burn;
  if (burned) {
    events.push({
      id: tailEventId('player-burned', at, seq),
      at,
      visibility: 'hidden',
      kind: 'player-burned',
    });
    seq += 1;
  }

  return {
    decision: { tailed, suspicionDelta, coverSuspicion, burned },
    events,
  };
}
