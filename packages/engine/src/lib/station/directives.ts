/**
 * Checking Station Directives each phase and moving the player's Standing with
 * HQ (design, "Station, Directives and Budget"; Requirements 27.2, 27.3).
 *
 * A {@link Directive} is an objective the Chief of Station hands the player: an
 * entity to identify, a number of Assets to recruit, a role to arrest, a Channel
 * to intercept — each with a deadline and a Standing reward (Requirement 27.2).
 * Its data shape and the fixed objective enum live in the dependency-light leaf
 * `./directive-types.ts` (so state.ts can re-export the interface without a
 * cycle); this module owns the *behaviour*: {@link checkDirectives} is the
 * per-phase check. When a Directive's objective is met it is marked `met` and
 * Standing rises by the reward; when the deadline passes with the objective
 * unmet it is marked `failed` and Standing falls by the reward (design:
 * "Standing moves by the reward on success, minus the reward on failure";
 * Requirement 27.3). Each transition emits a player-visible `directive` SimEvent,
 * which the Turn Pipeline turns into the Cable HQ sends (Requirement 27.3; the
 * Cable Document itself is composed when the event is delivered).
 *
 * ## The truth boundary (which side reads which objective)
 *
 * A Directive objective is checked against *facts*, and those facts live on two
 * different sides of the truth fence:
 *
 * - An **identify** or **arrest** objective is about the player's PROGRESS —
 *   has the player identified the leader, has an arrest of that role landed —
 *   and that progress lives in the Player View / Case File, never in the raw
 *   Truth Store. Reading it from truth would leak (the player might not yet
 *   *know* the leader even though the Sim does). So this module never reads the
 *   Truth Store for a progress objective. Instead {@link checkDirectives} takes
 *   an {@link ObjectiveEvaluator} the Turn Pipeline supplies, and the Pipeline —
 *   which holds both the view-side Case File and (for any truth-side objective)
 *   the Truth Store — decides per objective kind which side to read.
 * - An objective that genuinely is a function of ground truth (none of the four
 *   built-in kinds is, today) would be evaluated by the same injected callback,
 *   reading truth on the Pipeline side.
 *
 * Keeping the evaluation behind one injected predicate means this module imports
 * neither `player-view` (which the engine must not depend on) nor the Truth
 * Store, stays pure, and cannot leak: it only ever learns a boolean "is this
 * objective met at this time", computed by the caller against the correct side.
 *
 * Everything here is pure: {@link checkDirectives} returns the next Directive
 * list, the next Standing and the events to publish, mutating nothing.
 */

import { compareTime, type GameTime } from '../model/core.js';
import type { DirectiveId, EventId, SimEvent } from '../model/state.js';
import type { Directive, DirectiveObjective } from './directive-types.js';

// ---------------------------------------------------------------------------
// The objective evaluator (the truth-boundary seam)
// ---------------------------------------------------------------------------

/**
 * Decides whether a Directive objective is met at a time. Supplied by the Turn
 * Pipeline, which holds the Player View / Case File (and, for any truth-side
 * objective, the Truth Store) and so can read the correct side for each kind
 * without this module importing either (see the module doc's truth-boundary
 * note). Must be a pure function of its inputs for the per-phase check to stay
 * deterministic.
 */
export type ObjectiveEvaluator = (
  objective: DirectiveObjective,
  at: GameTime,
) => boolean;

// ---------------------------------------------------------------------------
// The per-phase check
// ---------------------------------------------------------------------------

/** The slice of `WorldState.station` the Directive check reads and rewrites. */
export interface DirectiveStationSlice {
  readonly directives: readonly Directive[];
  readonly standing: number;
}

/** The result of a per-phase Directive check. */
export interface CheckDirectivesResult {
  /** The Directives with their new statuses (same order, same ids). */
  readonly directives: readonly Directive[];
  /** The Standing after applying every met/failed move. */
  readonly standing: number;
  /** The `directive` SimEvents to publish (one per transition this phase). */
  readonly events: readonly SimEvent[];
}

/**
 * A stable, deterministic event id for a Directive transition: tagged with the
 * Directive id, the new status and the time, so re-running the same check at the
 * same time mints the same id.
 */
function directiveEventId(
  directive: DirectiveId,
  status: 'issued' | 'met' | 'failed',
  at: GameTime,
): EventId {
  return `directive-evt:${directive}:${status}:${at.day}:${at.phase}`;
}

/**
 * Mint the player-visible `directive` SimEvent for a transition. The event
 * carries no {@link import('../model/core.js').Truth} field (it is a
 * player-visible kind), only the Directive id and its new status, so the
 * Notification built from it leaks nothing.
 */
function directiveEvent(
  directive: DirectiveId,
  status: 'issued' | 'met' | 'failed',
  at: GameTime,
): SimEvent {
  return {
    id: directiveEventId(directive, status, at),
    at,
    visibility: 'player',
    kind: 'directive',
    directive,
    status,
  };
}

/**
 * Check every active Directive's objective at `at` and settle Standing
 * (Requirements 27.2, 27.3). Pure: the input slice is untouched.
 *
 * For each `open` Directive, in list order:
 *
 * 1. If the objective is met (per the injected {@link ObjectiveEvaluator}), the
 *    Directive is marked `met` and Standing rises by its `reward`. Meeting the
 *    objective wins even on the deadline phase — success is checked before the
 *    deadline lapses.
 * 2. Otherwise, if the deadline has passed (`at` is at or after the deadline),
 *    the Directive is marked `failed` and Standing falls by its `reward`.
 * 3. Otherwise the Directive stays `open` and Standing is unchanged.
 *
 * Already-settled (`met`/`failed`) Directives are left exactly as they are, so
 * the check is idempotent: running it again after a settle re-emits nothing.
 * Each settle appends one player-visible `directive` event (`met`/`failed`),
 * which the Turn Pipeline delivers as the HQ Cable (Requirement 27.3).
 */
export function checkDirectives(
  station: DirectiveStationSlice,
  at: GameTime,
  isObjectiveMet: ObjectiveEvaluator,
): CheckDirectivesResult {
  const events: SimEvent[] = [];
  let standing = station.standing;

  const directives = station.directives.map((directive) => {
    if (directive.status !== 'open') {
      return directive;
    }
    if (isObjectiveMet(directive.objective, at)) {
      standing += directive.reward;
      events.push(directiveEvent(directive.id, 'met', at));
      return { ...directive, status: 'met' as const };
    }
    if (compareTime(at, directive.deadline) >= 0) {
      standing -= directive.reward;
      events.push(directiveEvent(directive.id, 'failed', at));
      return { ...directive, status: 'failed' as const };
    }
    return directive;
  });

  return { directives, standing, events };
}

// ---------------------------------------------------------------------------
// The desk's standing orders
// ---------------------------------------------------------------------------

/**
 * The orders HQ issues, in order. Each asks the player to develop a source.
 * None of them names a person the player has not already found.
 */
const DIRECTIVE_LADDER: readonly {
  readonly id: DirectiveId;
  readonly text: string;
  readonly count: number;
  readonly reward: number;
  readonly span: number;
}[] = [
  {
    id: 'dir:develop-a-source',
    text: 'Develop one source and report the recruitment',
    count: 1,
    reward: 2,
    span: 12,
  },
  {
    id: 'dir:develop-a-second-source',
    text: 'Develop a second source and report the recruitment',
    count: 2,
    reward: 2,
    span: 14,
  },
  {
    id: 'dir:develop-a-third-source',
    text: 'Develop a third source and report the recruitment',
    count: 3,
    reward: 2,
    span: 14,
  },
];

/** The first order, dated from day 0. The deadline sits inside the operation. */
export function openingDirectives(horizonDay: number): readonly Directive[] {
  const first = DIRECTIVE_LADDER[0];
  if (first === undefined) {
    return [];
  }
  const day = Math.max(8, Math.min(16, Math.floor(horizonDay / 3) || 8));
  return [
    {
      id: first.id,
      text: first.text,
      objective: { kind: 'recruit', count: first.count },
      deadline: { day, phase: 0 },
      reward: first.reward,
      status: 'open',
    },
  ];
}

/**
 * The next order, once the ladder's current one has closed. A desk that was
 * never on this ladder (a test directive, an empty list) is left alone.
 */
export function issueFollowOn(
  existing: readonly Directive[],
  at: GameTime,
): { readonly directive: Directive; readonly event: SimEvent } | undefined {
  if (existing.some((directive) => directive.status === 'open')) {
    return undefined;
  }
  const onLadder = existing.some((directive) =>
    DIRECTIVE_LADDER.some((step) => step.id === directive.id),
  );
  if (!onLadder) {
    return undefined;
  }
  const next = DIRECTIVE_LADDER.find(
    (step) => !existing.some((directive) => directive.id === step.id),
  );
  if (next === undefined) {
    return undefined;
  }
  const directive: Directive = {
    id: next.id,
    text: next.text,
    objective: { kind: 'recruit', count: next.count },
    deadline: { day: at.day + next.span, phase: 0 },
    reward: next.reward,
    status: 'open',
  };
  return { directive, event: directiveEvent(directive.id, 'issued', at) };
}
