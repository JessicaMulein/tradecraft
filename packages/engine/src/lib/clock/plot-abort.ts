/**
 * Plot abort: the global abort-pressure accounting, the doctrine thresholds and
 * the pure {@link abortCheck} that decides when a Cell abandons its operation
 * (design, "Clock, Plot and Schedules" / "Plot abort (Req 38)"; Requirements
 * 19.4, 38.1, 38.2, 38.4, 38.5, 38.6).
 *
 * This is task 7.4. Task 7.2 (`./plot-execution.ts`) advances the running Plot
 * one day and surfaces a clean {@link PlotDayResult} seam — an `outcome` tag
 * (`executed` / `rerouted` / `delayed` / `aborted` / `none`) and, on a
 * disruption, a `stage-disrupted` event whose `cause` string names the distinct
 * disruption key (`participant-arrested:<npc>`, `channel-compromised:<chan>` or
 * `materiel-seized`, possibly prefixed `delay:` / `abort:` / `no-reroute:`).
 * 7.2 deliberately left THREE things to this task: the global abort-pressure
 * tally over distinct keys, the `abortCheck` thresholds, and the hidden
 * `plot-aborted` event plus `WorldState.ended`. This module builds on that
 * seam — it consumes 7.2's `PlotDayResult` and cause strings rather than
 * rewriting its disruption path.
 *
 * ## The pieces (design)
 *
 * ```ts
 * const abortTolerance = (d) => 1 + Math.round(3 * d.riskTolerance);
 * const leaderAbortThreshold = (d) => 0.9 - 0.3 * d.riskTolerance;
 * function abortCheck(plot, ctx): AbortTrigger | null; // pure
 * ```
 *
 * - {@link abortTolerance} / {@link leaderAbortThreshold} are the doctrine
 *   formulas verbatim: a Cell with a higher `riskTolerance` endures more
 *   pressure and a higher leader-suspicion before pulling the plug.
 * - {@link abortCheck} is pure: given a {@link PlotState} and a context
 *   (`leaderSuspicion`, `materielSeized`, `doctrine`) it returns the
 *   {@link AbortTrigger} the Plot aborts on, or `null`. It reads the thresholds
 *   from the doctrine and never mutates or draws.
 * - {@link accruePressure} is the distinct-key accounting: a new disruption or
 *   belief key adds 1 to `abortPressure` and the key to `pressureKeys`, but only
 *   if the key is not already present. Distinct keys only (Property 27:
 *   `abortPressure` equals the number of distinct counted keys).
 * - {@link applyBeliefPressure} is the belief-driven hook wired by task 19.6: a
 *   belief adopted under the Hostile adaptation rules that the Station knows or
 *   suspects the Plot target or a Cell member adds 1 to pressure, once per
 *   belief key. It is {@link accruePressure} under a documented name so 19.6
 *   has an explicit entry point; it defaults to a no-op when the key is already
 *   counted.
 * - the materiel-seizure hook (wired by task 11.6) is the `materielSeized` flag
 *   in {@link abortCheck}'s context: the materiel counts as seized when taken
 *   from a hostile drop (`seize`) or from an arrested carrier. 11.6 computes the
 *   flag and threads it in; 7.4 defaults it to `false`.
 *
 * ## Applying an abort — the Turn-Pipeline seam
 *
 * On an abort the Sim emits a hidden `plot-aborted` event carrying the trigger,
 * sets `plot.status='aborted'` and `plot.abortCause=<trigger>`, and sets
 * `WorldState.ended` with outcome `success` — abandoning the operation is a WIN
 * for the player's side. `WorldState` is owned by the Turn Pipeline, so this
 * module does NOT reach into it. Instead {@link applyAbort} returns an
 * {@link AbortDecision}: the aborted {@link PlotState}, the `plot-aborted`
 * {@link SimEvent}, and the {@link EndedIntent} the Turn Pipeline writes to
 * `WorldState.ended`. The caller (generate / clock / Turn Pipeline) applies the
 * intent; this keeps the abort logic pure and testable in isolation.
 *
 * ## Where it runs (design)
 *
 * `abortCheck` runs after each disruption, after each belief adoption and in
 * the daily tick. {@link considerPlotDay} composes the two seams for the daily
 * path: it accrues pressure from a day's {@link PlotDayResult} (both the
 * distinct-disruption key the day surfaced and 7.2's own `aborted` outcome, the
 * `abort` draw / `reroute`-with-no-alternative case), then runs `abortCheck`,
 * and returns an {@link AbortDecision} when the Plot should abort — or `null`
 * when the day leaves it running.
 *
 * ## Determinism / purity
 *
 * Every function here is pure: no mutation of inputs, no randomness.
 * `abortCheck` takes no PRNG — the only draw in the Plot path is 7.2's
 * disruption draw, which already rode the daily stream. Same inputs always
 * yield the same decision (Requirement 1.2; Property 27).
 */

import { type GameTime } from '../model/core.js';
import {
  type PlotState,
  type AbortTrigger,
  type SimEvent,
  type EventId,
  type Outcome,
} from '../model/state.js';
import { type PlotDayResult } from './plot-execution.js';

// ---------------------------------------------------------------------------
// Doctrine
// ---------------------------------------------------------------------------

/**
 * The slice of the Hostile Service doctrine the abort maths reads: the Cell's
 * `riskTolerance` in `[0, 1]`. The full doctrine (`riskTolerance`,
 * `securityConsciousness`, `deceptionAppetite`) is drawn from the preset's
 * ranges and owned by the Hostile Service (task 19); the abort formulas need
 * only `riskTolerance`, so this is the minimal shape {@link abortTolerance},
 * {@link leaderAbortThreshold} and {@link abortCheck} require. A later task's
 * full `Doctrine` is a structural supertype — it satisfies this interface — so
 * passing the live doctrine in needs no conversion.
 */
export interface Doctrine {
  /** The Cell's tolerance for risk, in `[0, 1]`. Higher endures more pressure. */
  readonly riskTolerance: number;
}

// ---------------------------------------------------------------------------
// Doctrine thresholds (design formulas)
// ---------------------------------------------------------------------------

/**
 * The abort-pressure tolerance of a Cell: `1 + round(3 · riskTolerance)`
 * (design). A risk-averse Cell (`riskTolerance = 0`) tolerates `1` unit of
 * pressure before aborting; a risk-tolerant Cell (`riskTolerance = 1`)
 * tolerates `4`. The Plot aborts on `pressure` when `abortPressure` *exceeds*
 * this tolerance (strictly greater — the tolerance is the last pressure the
 * Cell endures).
 */
export const abortTolerance = (d: Doctrine): number =>
  1 + Math.round(3 * d.riskTolerance);

/**
 * The leader-suspicion abort threshold of a Cell: `0.9 − 0.3 · riskTolerance`
 * (design). A risk-averse Cell pulls the plug once the leader's suspicion
 * reaches `0.9`; a risk-tolerant Cell holds on until `0.6`. The Plot aborts on
 * `leader-suspicion` when `leaderSuspicion` is at or above this threshold.
 */
export const leaderAbortThreshold = (d: Doctrine): number =>
  0.9 - 0.3 * d.riskTolerance;

// ---------------------------------------------------------------------------
// abortCheck — the pure decision
// ---------------------------------------------------------------------------

/** The context {@link abortCheck} reads: the leader's suspicion, the
 * materiel-seizure flag (wired by task 11.6) and the Cell's {@link Doctrine}. */
export interface AbortCheckContext {
  /** The Cell leader's current suspicion of being watched, in `[0, 1]`. */
  readonly leaderSuspicion: number;
  /** Whether the operation's materiel has been seized (task 11.6 wires this). */
  readonly materielSeized: boolean;
  /** The Cell's doctrine, for the pressure tolerance and leader threshold. */
  readonly doctrine: Doctrine;
}

/**
 * Decide whether the Plot aborts, and on which {@link AbortTrigger}, from its
 * accrued pressure and the context (design, Req 38.4). Pure: no mutation, no
 * draws. Returns the trigger when any of the design's conditions holds, else
 * `null`.
 *
 * The checks run in a fixed priority order so a state that trips several
 * conditions returns a deterministic trigger:
 *
 * 1. `materiel-seized` — the operation's materiel has been seized (the hardest
 *    stop: with no materiel the operation cannot proceed);
 * 2. `pressure` — `abortPressure` exceeds the doctrine's {@link abortTolerance};
 * 3. `leader-suspicion` — `leaderSuspicion` is at or above the doctrine's
 *    {@link leaderAbortThreshold}.
 *
 * The `disruption-draw` and `no-reroute` triggers come from 7.2's disruption
 * path (an `abort` draw / a `reroute` with no alternative), not from this
 * threshold check; {@link considerPlotDay} maps 7.2's `aborted` outcome to
 * them.
 */
export function abortCheck(
  plot: PlotState,
  ctx: AbortCheckContext,
): AbortTrigger | null {
  if (ctx.materielSeized) {
    return 'materiel-seized';
  }
  if (plot.abortPressure > abortTolerance(ctx.doctrine)) {
    return 'pressure';
  }
  if (ctx.leaderSuspicion >= leaderAbortThreshold(ctx.doctrine)) {
    return 'leader-suspicion';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pressure accounting (distinct keys only)
// ---------------------------------------------------------------------------

/**
 * Accrue abort pressure from a new disruption or belief key, returning a new
 * {@link PlotState} (design, Req 38.1, 38.2). Distinct keys only: a key already
 * in `pressureKeys` is a no-op (the same state value is returned), so
 * `abortPressure` always equals the number of distinct counted keys (Property
 * 27). Pure — the input is never mutated.
 *
 * The key is the stable dedupe string the design counts: a disruption key
 * (`participant-arrested:<npc>`, `channel-compromised:<chan>`,
 * `materiel-seized`) or a belief key. {@link disruptionKey} strips 7.2's
 * `delay:` / `abort:` / `no-reroute:` prefix so the same underlying disruption
 * counts once regardless of how it was answered.
 */
export function accruePressure(plot: PlotState, key: string): PlotState {
  if (plot.pressureKeys.includes(key)) {
    return plot;
  }
  return {
    ...plot,
    abortPressure: plot.abortPressure + 1,
    pressureKeys: [...plot.pressureKeys, key],
  };
}

/**
 * The belief-driven pressure hook, wired by task 19.6. A belief adopted under
 * the Hostile adaptation rules that the Station knows or suspects the Plot
 * target or a Cell member adds 1 to pressure, once per belief key (design, Req
 * 38.2). It is {@link accruePressure} under a documented name so 19.6 has an
 * explicit entry point; 19.6 computes the belief key and calls this after each
 * belief adoption, then runs {@link abortCheck}. Defaults to a no-op when the
 * belief key is already counted.
 */
export function applyBeliefPressure(plot: PlotState, beliefKey: string): PlotState {
  return accruePressure(plot, `belief:${beliefKey}`);
}

/**
 * Strip 7.2's response prefix from a `stage-disrupted` event's `cause` string
 * to recover the bare distinct-disruption key. 7.2 formats the cause as
 * `delay:<key>`, `abort:<key>` or `no-reroute:<key>` on a disrupted stage (and
 * a bare `<key>` is already stripped). The bare key — `participant-arrested:…`,
 * `channel-compromised:…` or `materiel-seized` — is what the pressure tally
 * dedupes on, so the same disruption counts once however it was answered.
 */
export function disruptionKey(cause: string): string {
  for (const prefix of ['delay:', 'abort:', 'no-reroute:'] as const) {
    if (cause.startsWith(prefix)) {
      return cause.slice(prefix.length);
    }
  }
  return cause;
}

// ---------------------------------------------------------------------------
// Applying an abort — the Turn-Pipeline seam
// ---------------------------------------------------------------------------

/**
 * The `WorldState.ended` intent an abort produces, for the Turn Pipeline to
 * apply (the module does not own `WorldState`). On abort the end outcome is
 * `success` — the Cell abandoning its operation is a WIN for the player's side
 * (design, Req 38.6) — and the cause is the {@link AbortTrigger} that fired.
 */
export interface EndedIntent {
  readonly outcome: Outcome;
  readonly at: GameTime;
  readonly cause: AbortTrigger;
}

/** The outcome tag an aborted Plot sets `WorldState.ended.outcome` to. */
export const ABORT_END_OUTCOME: Outcome = 'success';

/**
 * The structured result of applying an abort: the aborted {@link PlotState},
 * the hidden `plot-aborted` {@link SimEvent} carrying the trigger, and the
 * {@link EndedIntent} the Turn Pipeline writes to `WorldState.ended`.
 */
export interface AbortDecision {
  readonly plot: PlotState;
  readonly event: SimEvent;
  readonly ended: EndedIntent;
}

/** Deterministically mint the `plot-aborted` event id from the trigger and time. */
function abortEventId(trigger: AbortTrigger, at: GameTime): EventId {
  return `plot-evt:abort:${trigger}:${at.day}:${at.phase}`;
}

/**
 * Apply an abort trigger to a Plot (design, Req 38.5, 38.6). Pure: it returns
 * a new {@link PlotState} with `status='aborted'` and `abortCause=<trigger>`,
 * the hidden `plot-aborted` event carrying the trigger, and the
 * {@link EndedIntent} (`success`, at `at`, caused by the trigger) for the Turn
 * Pipeline to set on `WorldState.ended`. The input Plot is never mutated.
 *
 * A Plot already `aborted` (or `completed`) is still re-stamped with the given
 * trigger here — callers run {@link abortCheck} / {@link considerPlotDay} to
 * decide *whether* to abort; this function is the application step once an abort
 * is decided.
 */
export function applyAbort(
  plot: PlotState,
  trigger: AbortTrigger,
  at: GameTime,
): AbortDecision {
  const aborted: PlotState = { ...plot, status: 'aborted', abortCause: trigger };
  const event: SimEvent = {
    id: abortEventId(trigger, at),
    at,
    visibility: 'hidden',
    kind: 'plot-aborted',
    trigger,
  };
  const ended: EndedIntent = { outcome: ABORT_END_OUTCOME, at, cause: trigger };
  return { plot: aborted, event, ended };
}

// ---------------------------------------------------------------------------
// Composing the two seams for the daily path
// ---------------------------------------------------------------------------

/**
 * The result of considering a day's {@link PlotDayResult} for abort: the Plot
 * with any new pressure accrued, and an {@link AbortDecision} when the Plot
 * should abort (`null` when it stays running). The caller appends
 * `decision.event` to the day's events and applies `decision.ended` to
 * `WorldState`; when `decision` is `null` it keeps `plot` as the day's Plot.
 */
export interface DayAbortResult {
  /** The Plot after accruing this day's pressure (and, on abort, aborted). */
  readonly plot: PlotState;
  /** The abort decision, or `null` when the day leaves the Plot running. */
  readonly decision: AbortDecision | null;
}

/**
 * Compose the pressure-accrual and {@link abortCheck} seams for the daily path
 * (design: `abortCheck` runs after each disruption and in the daily tick). Pure.
 *
 * Given 7.2's {@link PlotDayResult} for a day, the time, and the abort context:
 *
 * 1. accrue pressure for the day's distinct disruption key, when the day
 *    surfaced one. 7.2 reports a disruption via a `stage-disrupted` event whose
 *    `cause` names the key; {@link disruptionKey} recovers the bare key and
 *    {@link accruePressure} dedupes it;
 * 2. if 7.2's own `outcome` is `aborted` — an `abort` draw, or a `reroute` with
 *    no alternative — the Plot aborts at once (Req 38.4). The trigger is read
 *    from the disruption event's `cause` prefix: a `no-reroute:` cause maps to
 *    `no-reroute`, anything else to `disruption-draw`;
 * 3. otherwise run {@link abortCheck} on the pressure-updated Plot; a non-null
 *    trigger aborts on the threshold (`pressure` / `leader-suspicion` /
 *    `materiel-seized`).
 *
 * On an abort it returns the {@link applyAbort} decision; otherwise `decision`
 * is `null` and `plot` is the pressure-updated (still-running) Plot.
 */
export function considerPlotDay(
  day: PlotDayResult,
  at: GameTime,
  ctx: AbortCheckContext,
): DayAbortResult {
  // 1. Accrue pressure for any distinct disruption the day surfaced.
  let plot = day.plot;
  const disrupted = day.events.find((e) => e.kind === 'stage-disrupted');
  const cause =
    disrupted !== undefined && 'cause' in disrupted
      ? (disrupted as { readonly cause: string }).cause
      : undefined;
  if (cause !== undefined) {
    plot = accruePressure(plot, disruptionKey(cause));
  }

  // 2. 7.2's disruption path already aborted the stage/Plot: an `abort` draw or
  //    a `reroute` with no alternative. Map the cause prefix to the trigger.
  if (day.outcome === 'aborted') {
    const trigger: AbortTrigger =
      cause !== undefined && cause.startsWith('no-reroute:')
        ? 'no-reroute'
        : 'disruption-draw';
    return { plot, decision: applyAbort(plot, trigger, at) };
  }

  // 3. Threshold check on the pressure-updated Plot.
  const trigger = abortCheck(plot, ctx);
  if (trigger !== null) {
    return { plot, decision: applyAbort(plot, trigger, at) };
  }

  return { plot, decision: null };
}
