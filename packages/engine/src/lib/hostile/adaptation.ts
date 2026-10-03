/**
 * Belief-driven Plot adaptation (design, "Hostile Service AI": `dailyTick` step
 * 5, the belief-driven adaptation rules; Requirements 11.4, 11.5).
 *
 * When the Hostile Service adopts a belief that the Station knows or suspects
 * the Plot target or a Cell member, the Cell adapts its operation — it reroutes
 * a compromised role holder, retargets, or accelerates to beat the net closing
 * in — and the mounting pressure pushes the operation toward abort. The design
 * sets this out as a rules table keyed on the *shape* of each newly-adopted
 * belief; this task implements the two rows this module owns and threads them
 * through the existing Plot abort/pressure path:
 *
 * | Adopted belief | Effect |
 * |---|---|
 * | `KNOWS`/`SUSPECTS(org:station, X)`, X a Cell member | reroute/accelerate; Abort Pressure +1 |
 * | `KNOWS`/`SUSPECTS(org:station, X)`, X the Plot target | retarget/accelerate; Abort Pressure +1 |
 *
 * ## It drives the existing abort/pressure entry point
 *
 * The Abort Pressure tally and the once-per-belief-key dedupe already live in
 * `../clock/plot-abort.ts` (`applyBeliefPressure(plot, beliefKey)` → the
 * distinct-key `accruePressure`). This module does NOT re-implement a tally or
 * mutate `abortPressure` by hand — it computes which newly-adopted beliefs
 * qualify and feeds each through `applyBeliefPressure`, so the pressure
 * accounting stays Property-27-sound in the one place that owns it. The belief
 * key is `beliefKey(prop)` from `./beliefs.ts`, the same key the service's
 * belief adoption dedupes on, so a belief that was adopted once contributes to
 * pressure once.
 *
 * ## The adaptation itself, as data
 *
 * The reroute/retarget/accelerate is surfaced as a hidden `plot-adapted` event
 * (`{ change: string }`) describing the adaptation, exactly as `plot-execution`
 * surfaces its own adaptations. This leaf does not rewrite the Plot's stage DAG
 * or role bindings — that structural reroute is the Plot execution path's job on
 * the next day's tick, cued by the raised pressure and compromised state — so
 * the leaf stays Plot-structure-light: it returns the pressure-updated
 * {@link PlotState} and the `plot-adapted` events, and the daily tick runs
 * {@link import('../clock/plot-abort.js').abortCheck} / `considerPlotDay` on the
 * result as the design's "abortCheck runs after each belief adoption" requires.
 *
 * ## What qualifies (the projection)
 *
 * Which NPCs are Cell members and what the Plot target is are ground truth this
 * leaf does not own the derivation of, so the caller projects them in
 * ({@link AdaptationContext}: `stationOrg`, `cellMembers`, `target`). A belief
 * qualifies when it is a `KNOWS`/`SUSPECTS` Proposition (matched on the
 * predicate's unqualified tail, so the `core/` pack prefix does not matter) with
 * the Station as subject and a Cell member or the Plot target as object.
 *
 * ## Determinism / purity
 *
 * No draws. The qualifying beliefs are processed in a stable, id-sorted belief
 * order and each raises pressure once; the same adopted beliefs and projection
 * always yield the same adapted Plot and the same events (Requirement 1.2). The
 * leaf imports the core model, the belief key helper and the plot-abort pressure
 * hook — it stays Action-Resolver-free and does not touch the Relationship.
 */

import type { EntityId, GameTime, NpcId, Proposition } from '../model/core.js';
import type { EventId, PlotState, SimEvent } from '../model/state.js';
import { applyBeliefPressure } from '../clock/plot-abort.js';
import { beliefKey } from './beliefs.js';

// ---------------------------------------------------------------------------
// Matching a qualifying belief
// ---------------------------------------------------------------------------

/**
 * The context the adaptation reads, projected in by the caller (the leaf does
 * not own the derivation of who is a Cell member or what the target is). All
 * ground truth the service knows because it *is* the service.
 */
export interface AdaptationContext {
  /** The Station organisation id (the belief subject that drives adaptation). */
  readonly stationOrg: EntityId;
  /** The Cell member NPC ids whose compromise reroutes the operation. */
  readonly cellMembers: readonly NpcId[];
  /** The Plot's primary target entity whose compromise retargets it. */
  readonly target: EntityId;
}

/** The kind of adaptation a qualifying belief drives. */
export type AdaptationKind = 'reroute-cell-member' | 'retarget';

/**
 * The predicate tail — the part after the last `/` — so a pack prefix
 * (`core/KNOWS`) and a bare id (`KNOWS`) both match the design's belief shape.
 */
function predicateTail(predicate: string): string {
  const slash = predicate.lastIndexOf('/');
  return slash === -1 ? predicate : predicate.slice(slash + 1);
}

/** True when the Proposition's object is the given entity id (not a literal). */
function objectIs(prop: Proposition, entity: EntityId): boolean {
  return typeof prop.object === 'string' && prop.object === entity;
}

/**
 * Classify a belief against the adaptation rules, or `null` when it does not
 * qualify. Pure. A belief qualifies when it is a `KNOWS`/`SUSPECTS` Proposition
 * (by predicate tail) whose subject is the Station and whose object is either a
 * Cell member (→ `reroute-cell-member`) or the Plot target (→ `retarget`). The
 * Cell-member check takes priority: a target that is also a Cell member reroutes
 * the role holder, the stronger adaptation.
 */
export function classifyBelief(
  prop: Proposition,
  ctx: AdaptationContext,
): AdaptationKind | null {
  const tail = predicateTail(prop.predicate);
  if (tail !== 'KNOWS' && tail !== 'SUSPECTS') {
    return null;
  }
  if (prop.subject !== ctx.stationOrg) {
    return null;
  }
  if (typeof prop.object !== 'string') {
    return null;
  }
  if (ctx.cellMembers.includes(prop.object as NpcId)) {
    return 'reroute-cell-member';
  }
  if (objectIs(prop, ctx.target)) {
    return 'retarget';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Applying the adaptation
// ---------------------------------------------------------------------------

/** The result of adapting the Plot to a day's newly-adopted beliefs. */
export interface AdaptationResult {
  /** The Plot after the qualifying beliefs raised Abort Pressure. */
  readonly plot: PlotState;
  /** The hidden `plot-adapted` events describing each adaptation, in order. */
  readonly events: readonly SimEvent[];
}

/** Deterministically mint a `plot-adapted` event id from the belief key and time. */
function adaptEventId(key: string, at: GameTime, seq: number): EventId {
  return `hostile-evt:adapt:${at.day}:${at.phase}:${seq}`;
}

/** The human-readable `change` string a `plot-adapted` event carries. */
function changeString(kind: AdaptationKind, object: EntityId): string {
  return kind === 'reroute-cell-member'
    ? `reroute:cell-member:${object}`
    : `retarget:${object}`;
}

/**
 * Adapt the Plot to the beliefs the service newly adopted this tick (design,
 * step 5; Req 11.4, 11.5). Pure, no draws.
 *
 * For each belief that {@link classifyBelief} qualifies — the Station knowing or
 * suspecting a Cell member or the Plot target — this:
 *
 * 1. raises Abort Pressure once per belief key via the plot-abort module's
 *    {@link applyBeliefPressure} (the existing entry point that owns the
 *    distinct-key tally), so a belief adopted once presses once; and
 * 2. emits a hidden `plot-adapted` event naming the reroute/retarget.
 *
 * The beliefs are processed in a stable belief-key order so the pressure and
 * events are deterministic. The structural reroute of stage/role bindings is
 * left to the Plot execution path on the next tick (cued by the raised
 * pressure); this returns the pressure-updated {@link PlotState} and the
 * `plot-adapted` events for the daily tick to append and to run `abortCheck`
 * over. A belief that does not qualify, or whose key already pressed, adds no
 * pressure and no event.
 */
export function adaptToBeliefs(
  plot: PlotState,
  beliefs: readonly Proposition[],
  ctx: AdaptationContext,
  at: GameTime,
): AdaptationResult {
  // Qualify each belief, keep the ones that drive adaptation, and process them
  // in a stable belief-key order so pressure and events are deterministic.
  const qualifying = beliefs
    .map((prop) => ({ prop, key: beliefKey(prop), kind: classifyBelief(prop, ctx) }))
    .filter((q): q is { prop: Proposition; key: string; kind: AdaptationKind } => q.kind !== null)
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  let next = plot;
  const events: SimEvent[] = [];
  let seq = 0;
  const seen = new Set<string>();
  for (const q of qualifying) {
    if (seen.has(q.key)) {
      continue; // once per belief key, mirroring applyBeliefPressure's dedupe
    }
    seen.add(q.key);

    const before = next.abortPressure;
    next = applyBeliefPressure(next, q.key);
    // Emit the adaptation event only when the belief actually pressed (a key
    // already counted on the Plot adds nothing — the Plot already adapted to it).
    if (next.abortPressure !== before) {
      events.push({
        id: adaptEventId(q.key, at, seq),
        at,
        visibility: 'hidden',
        kind: 'plot-adapted',
        change: changeString(q.kind, q.prop.object as EntityId),
      });
      seq += 1;
    }
  }

  return { plot: next, events };
}
