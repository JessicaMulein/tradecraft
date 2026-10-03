/**
 * End conditions: the pure win/lose detector for a game (design, "Arrests, end
 * conditions, the debrief and the Outcome Record"; Requirements 19.3, 19.4,
 * 19.5; slice-integration Requirements 7.2, 7.3, 7.4, 7.8). Task 20.1, with
 * the standing leader check added by slice-integration task 1.4.
 *
 * A game ends on one of a small, fixed set of conditions, each with an
 * {@link Outcome} the debrief later reads:
 *
 * - **Plot abort — WIN (Req 19.4).** A Cell abandoning its operation is a win
 *   for the player's side. The abort machinery (task 7.4,
 *   `../clock/plot-abort.ts`) already produces an {@link EndedIntent} with
 *   outcome {@link ABORT_END_OUTCOME} (`success`) when {@link applyAbort} fires;
 *   this detector *includes* that path by reading the Plot's `status` — once a
 *   Plot is `aborted` the game is won. The abort cause is the Plot's
 *   `abortCause` (an {@link AbortTrigger}).
 * - **Plot disrupted — WIN (Req 19.4).** The player disrupts the operation by
 *   arresting the Cell leader (`leader-arrested`) or seizing the Plot's materiel
 *   — both end the game in success. The materiel-seizure path flows through the
 *   abort machinery (it is an abort trigger, so it surfaces as the abort WIN
 *   above). The leader arrest is a standing condition read here
 *   ({@link leaderArrestedByStation}): the leader is in Station Custody, or the
 *   Station's arrest record (`player.arrests`) names them. A Hostile Service
 *   hold on the leader is not a player win.
 * - **Plot completed — LOSE (Req 19.3).** When the Plot runs its final stage the
 *   game ends in failure (`plot-completed`): the operation succeeded.
 * - **Player burned — LOSE (Req 19.5, 19.3).** When the player is burned the
 *   game ends in failure (`burned`).
 *
 * The detector is **pure**: it reads a {@link WorldState} and returns the first
 * end condition that holds (in a fixed priority order so a state that trips
 * several is deterministic), or `null` when the game runs on. It never mutates
 * the state and takes no randomness, so the Turn Pipeline can call it after any
 * state change and write the returned condition to {@link WorldState.ended}.
 *
 * The priority order favours a WIN when a win and a loss coincide on the same
 * tick (the player's side prevailing is the better reading of a tie), then the
 * two lose conditions. Specifically: Plot aborted (win) → Cell leader arrested
 * (win) → Plot completed (lose) → burned (lose).
 *
 * ## Why a dedicated module, not the Turn Pipeline
 *
 * `WorldState.ended` is owned by the Turn Pipeline (task 16.8); this leaf does
 * not reach into the pipeline's write path. It returns the detected
 * {@link EndCondition} and the caller sets `WorldState.ended`, mirroring the
 * {@link EndedIntent} seam `applyAbort` already uses for the abort case. Keeping
 * the detection pure lets 20.4's Arrest-gate property test and the win/lose unit
 * tests pin it in isolation.
 */

import { revealTruth, type GameTime } from '../model/core.js';
import type { AbortTrigger, Outcome, WorldState } from '../model/state.js';
import { ABORT_END_OUTCOME, type EndedIntent } from '../clock/plot-abort.js';
import { inStationCustody } from '../recruit/asset.js';

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

/** The outcome tag of a won game (the player's side prevailed; Req 19.4). */
export const WIN_OUTCOME: Outcome = 'success';

/** The outcome tag of a lost game (Req 19.3, 19.5). */
export const LOSE_OUTCOME: Outcome = 'failure';

/**
 * The cause of a game end (what `WorldState.ended.cause` records). It unions the
 * Plot-abort {@link AbortTrigger} with the three non-abort causes:
 * `leader-arrested` (the player arrested the Cell leader — a disruption WIN),
 * `plot-completed` (the operation ran its final stage — a LOSE) and `burned`
 * (the player was burned — a LOSE). This is exactly the `cause` union
 * {@link WorldState.ended} carries.
 */
export type EndCause =
  | AbortTrigger
  | 'leader-arrested'
  | 'plot-completed'
  | 'burned';

/**
 * A detected end condition, the value the Turn Pipeline writes to
 * {@link WorldState.ended}: the {@link Outcome}, the time it fired and the
 * {@link EndCause}. The abort-WIN variant is structurally the Plot-abort
 * {@link EndedIntent} (same `outcome`/`at`/`cause`) widened to the broader
 * {@link EndCause}, so the pipeline applies both through one shape.
 */
export interface EndCondition {
  readonly outcome: Outcome;
  readonly at: GameTime;
  readonly cause: EndCause;
}

// ---------------------------------------------------------------------------
// The pure detector
// ---------------------------------------------------------------------------

/**
 * Widen a Plot-abort {@link EndedIntent} to an {@link EndCondition}. The intent's
 * `cause` is an {@link AbortTrigger}, a member of {@link EndCause}, so this is a
 * structural widening with no change of value — it lets a caller that already
 * holds an abort decision (from {@link applyAbort}) feed it through the same
 * `WorldState.ended` write as the detector's output.
 */
export function endConditionFromAbort(intent: EndedIntent): EndCondition {
  return { outcome: intent.outcome, at: intent.at, cause: intent.cause };
}

/**
 * Whether the Plot's Cell leader has been arrested by the Station: the standing
 * form of the `leader-arrested` disruption WIN (Req 19.4; slice-integration
 * Req 7.4, 7.8). Pure: reads the state, draws nothing. True when either holds:
 *
 * - **Station Custody.** The leader is in Station Custody now
 *   ({@link inStationCustody} on their Relationship). A Station arrest starts
 *   that hold (`resolveArrest`), so the check holds from the arrest onward.
 * - **The Station's arrest record.** `player.arrests` names the leader, by NPC
 *   id or by the `unk:` id the player knows them by (`player.unkIds`), since an
 *   arrest may target an Unidentified Subject. The record outlives the custody
 *   hold, so the win stands after the leader has been handed over.
 *
 * A Hostile Service hold (`custody.by === 'hostile'`, from the Hostile tick
 * arresting one of the player's Assets) is neither: `inStationCustody` rejects
 * it and only a Station arrest is recorded in `player.arrests`. So the Hostile
 * Service arresting the leader is not a player win.
 *
 * Reading `plot.leader` is a Sim decision. Only the resulting End Condition
 * crosses to the Player View.
 */
export function leaderArrestedByStation(state: WorldState): boolean {
  const leader = revealTruth(state.plot.leader);
  const rel = state.relationships[leader];
  if (rel !== undefined && inStationCustody(rel, state.time)) {
    return true;
  }
  const alias = state.player.unkIds[leader];
  return state.player.arrests.some(
    (entity) => entity === leader || (alias !== undefined && entity === alias),
  );
}

/**
 * Detect whether the game has ended, and how, from the {@link WorldState}
 * (design, Req 19.3, 19.4, 19.5; slice-integration Req 7.2, 7.3, 7.4, 7.8).
 * Pure: no mutation, no draws. Returns the first end condition that holds in
 * the fixed priority order, or `null` when the game runs on.
 *
 * The checks, in order:
 *
 * 1. **Plot aborted — WIN (Req 19.4).** `plot.status === 'aborted'`: the Cell
 *    abandoned the operation (this is the task-7.4 abort path, including the
 *    materiel-seizure disruption that flows through it). Outcome
 *    {@link WIN_OUTCOME}; cause the Plot's `abortCause` (an {@link AbortTrigger};
 *    `pressure` as a defensive fallback should it be absent).
 * 2. **Cell leader arrested — WIN (Req 19.4; slice-integration Req 7.4).**
 *    {@link leaderArrestedByStation}: the leader is in Station Custody or in the
 *    Station's arrest record. The result is {@link leaderArrestEnd}, the same
 *    End Condition the arrest resolver returns for a correct arrest of the
 *    leader, so the two paths agree on outcome, cause and shape.
 * 3. **Plot completed — LOSE (Req 19.3).** `plot.status === 'completed'`: the
 *    operation ran its final stage. Outcome {@link LOSE_OUTCOME}; cause
 *    `plot-completed`.
 * 4. **Player burned — LOSE (Req 19.5).** `player.burned`: the player's cover is
 *    blown. Outcome {@link LOSE_OUTCOME}; cause `burned`.
 *
 * Every check reads a standing WorldState fact rather than a signal from the
 * turn that caused it. So on a game not yet ended, the detector reports an End
 * Condition exactly when one of the four holds (slice-integration Req 7.8).
 *
 * `at` is the state's current {@link WorldState.time}, the time the condition is
 * observed. A game already `ended` returns that recorded condition unchanged, so
 * the detector is idempotent once a game is over.
 */
export function detectEnd(state: WorldState): EndCondition | null {
  // Idempotence: once ended, report the recorded end (the pipeline wrote it).
  if (state.ended !== undefined) {
    return {
      outcome: state.ended.outcome,
      at: state.ended.at,
      cause: state.ended.cause,
    };
  }

  const at = state.time;

  // 1. Plot aborted — WIN (Req 19.4). Includes the materiel-seizure disruption,
  //    which flows through the abort machinery (task 7.4 / 11.6).
  if (state.plot.status === 'aborted') {
    const cause = (state.plot.abortCause ?? 'pressure') as AbortTrigger;
    return { outcome: WIN_OUTCOME, at, cause };
  }

  // 2. Cell leader arrested by the Station — WIN (Req 19.4; slice-integration
  //    Req 7.4): in Station Custody, or named in the Station's arrest record.
  if (leaderArrestedByStation(state)) {
    return leaderArrestEnd(at);
  }

  // 3. Plot completed — LOSE (Req 19.3): the operation ran its final stage.
  if (state.plot.status === 'completed') {
    return { outcome: LOSE_OUTCOME, at, cause: 'plot-completed' };
  }

  // 4. Player burned — LOSE (Req 19.5).
  if (state.player.burned) {
    return { outcome: LOSE_OUTCOME, at, cause: 'burned' };
  }

  return null;
}

/**
 * The disruption-WIN end condition for arresting the Cell leader (Req 19.4).
 * Outcome {@link WIN_OUTCOME}; cause `leader-arrested`. The arrest resolver
 * returns it for a correct arrest of the leader, and {@link detectEnd} returns
 * it whenever {@link leaderArrestedByStation} holds, so the Turn Pipeline writes
 * the same value to `WorldState.ended` from either path.
 */
export function leaderArrestEnd(at: GameTime): EndCondition {
  return { outcome: WIN_OUTCOME, at, cause: 'leader-arrested' };
}

/** Re-export so callers that only need the abort outcome tag can read it here. */
export { ABORT_END_OUTCOME };
