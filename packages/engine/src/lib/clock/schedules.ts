/**
 * NPC schedule advancement and Walk-ins on the daily stream (design, "Clock,
 * Plot and Schedules"; Requirements 3.5, 22.7).
 *
 * This is task 7.3. It owns two deterministic, pure concerns that plug into the
 * clock's day-boundary hook seam (`./clock.ts`, task 7.1):
 *
 * ## 1. Schedule advancement (Requirement 3.5)
 *
 * NPCs follow their generated {@link NpcSchedule}s deterministically: an NPC is
 * at a {@link LocId} on a given weekday+engine-phase (`scheduledLocation` in
 * `../city/npc.ts`). As game time advances, an NPC whose scheduled Location
 * *changes* between two times has moved; the Sim records this as a hidden
 * `npc-moved` {@link SimEvent} (`{ npc, from, to }`). {@link advanceSchedules}
 * is the pure function that, given the NPCs and two {@link GameTime}s, emits one
 * `npc-moved` for each NPC whose scheduled Location differs between them, and
 * nothing for those that did not move. It makes no random draws — schedules are
 * fully determined by the seed and the clock — so it is a pure function of its
 * inputs (Requirement 3.5: "advance NPC schedules deterministically from the
 * seed and the current state").
 *
 * The weekday and engine phase of a {@link GameTime} are resolved through the
 * engine↔content time mapping (`../city/time-mapping.ts`): `weekdayOf(t)` gives
 * the content weekday (0 Monday … 6 Sunday) the schedule entries are keyed by,
 * and `t.phase` is already the engine phase the entries carry.
 *
 * ### Per-phase vs. per-day
 *
 * Schedule changes happen at *phase* grain — an NPC can be at the office in the
 * morning and a café in the afternoon of the same day. The clock, though, fires
 * day-boundary hooks only once per day (at phase 0). So this module exposes
 * both:
 *
 * - {@link advanceSchedules} — the pure per-step function the Turn Pipeline
 *   calls on *every* phase advance (`from` = the time before the step, `to` =
 *   the time after), so a mid-day phase change still emits its `npc-moved`;
 * - the day-boundary adapter (see {@link schedulesDayBoundaryHook}) emits the
 *   movements across the *day boundary itself* (the night→morning transition
 *   into the new day), which is the one transition the clock's hook sees.
 *
 * The Turn Pipeline (a later task) owns calling {@link advanceSchedules} per
 * phase; the hook here covers the day boundary so a day-granular advance still
 * produces the boundary's movements and the day's walk-in roll in one place.
 *
 * ## 2. Walk-ins (Requirement 22.7)
 *
 * On the DAILY stream (`derive(seed, DAILY_STREAM_BASE + day)` — the same stream
 * the weather draw and newspaper selection ride, see `../city/city.ts`), there
 * is a per-day chance an NPC approaches the Station unprompted as a Walk-in. A
 * Walk-in may be genuine or a provocation (a Dangle); the player sees the same
 * `walk-in` Notification either way (design, "Hidden events and their visible
 * consequences"). So a walk-in produces two events:
 *
 * - a hidden `walk-in-approach` (`{ npc, genuine: Truth<boolean> }`) carrying
 *   the ground-truth genuineness, which the Hostile Service's Dangle management
 *   (Requirement 11.2) and later analysis read;
 * - a player-visible `walk-in` (`{ npc }`) — the notification the player
 *   receives, carrying no truth.
 *
 * {@link rollWalkIn} draws deterministically from the passed daily {@link Prng}
 * in a fixed order: first whether a walk-in occurs this day (against the
 * per-day probability), then — only if it does — which NPC approaches (a
 * uniform pick over the id-sorted candidate pool) and whether it is genuine
 * (against the genuine-walk-in probability). Same seed+day ⇒ same walk-in.
 *
 * ## Determinism
 *
 * Schedule advancement makes no draws. Walk-ins draw only from the passed daily
 * Prng, in a fixed order over id-sorted candidate lists. Same seed+day ⇒
 * identical events (Requirement 1.2).
 */

import {
  asTruth,
  type GameTime,
  type LocId,
  type NpcId,
} from '../model/core.js';
import { type Prng } from '../prng/prng.js';
import { type Npc, scheduledLocation } from '../city/npc.js';
import { scheduleWeekdayIndex } from '../city/calendar.js';
import type { EventId, SimEvent } from '../model/state.js';

// ---------------------------------------------------------------------------
// Tunables (defaults; a scenario/preset may override via options)
// ---------------------------------------------------------------------------

/**
 * The default per-day probability that a Walk-in occurs. The
 * {@link DifficultyPreset} does not (yet) carry a walk-in field, so this is the
 * documented default a caller may override with
 * {@link WalkInOptions.walkInProbability}. A modest daily chance keeps Walk-ins
 * an occasional event rather than a daily fixture, matching the design's "a
 * chance each day" (Requirement 22.7). When a preset grows a walk-in field a
 * later task threads it through the option.
 */
export const DEFAULT_WALK_IN_PROBABILITY = 0.1;

/**
 * The default probability that a Walk-in, once it occurs, is genuine rather than
 * a Dangle/provocation (Requirement 22.7, 11.2). Half and half by default: a
 * Walk-in is as likely to be a genuine volunteer as a hostile provocation, so
 * the player cannot assume either. Overridable via
 * {@link WalkInOptions.genuineProbability}.
 */
export const DEFAULT_GENUINE_PROBABILITY = 0.5;

// ---------------------------------------------------------------------------
// Id minting
// ---------------------------------------------------------------------------

/**
 * Deterministically mint a schedules event id from a tag, the time and a
 * per-call sequence number. The `sched-evt:` prefix keeps schedule/walk-in ids
 * distinct from the clock's `evt:` and plot's `plot-evt:` ids; when adapted into
 * the clock hook the clock re-ids each event anyway (see `clock.ts`), so this id
 * only needs to be unique and deterministic within its own stream.
 */
function schedulesEventId(tag: string, at: GameTime, seq: number): EventId {
  return `sched-evt:${tag}:${at.day}:${at.phase}:${seq}`;
}

// ---------------------------------------------------------------------------
// Schedule advancement (Requirement 3.5) — pure, no draws
// ---------------------------------------------------------------------------

/**
 * The scheduled Location of an NPC at a {@link GameTime}, resolving the weekday
 * through the engine↔content time mapping. `undefined` when the NPC's schedule
 * has no entry for that weekday+phase (the NPC is "off schedule" / wherever it
 * was).
 */
export function scheduledLocationAt(
  npc: Npc,
  time: GameTime,
  startDate?: string,
): LocId | undefined {
  const weekday = scheduleWeekdayIndex(time.day, startDate);
  return scheduledLocation(npc.schedule, weekday, time.phase);
}

/**
 * Every NPC's scheduled position at `time`, in the shape of
 * `WorldState.whereabouts`: the Location the NPC's schedule names for that
 * weekday and phase, or `'absent'` when it names none. Generation uses this to
 * initialise `whereabouts` at the start time.
 *
 * Pure and deterministic: it makes no draws, and it fills the record in
 * id-sorted order so the same NPCs always produce the same record.
 */
export function whereaboutsAt(
  npcs: Readonly<Record<NpcId, Npc>>,
  time: GameTime,
  startDate?: string,
): Record<NpcId, LocId | 'absent'> {
  const out: Record<NpcId, LocId | 'absent'> = {};
  for (const id of (Object.keys(npcs) as NpcId[]).sort()) {
    out[id] = scheduledLocationAt(npcs[id], time, startDate) ?? 'absent';
  }
  return out;
}

/**
 * Advance NPC schedules from `from` to `to`, emitting a hidden `npc-moved`
 * {@link SimEvent} for each NPC whose scheduled Location *changed* between the
 * two times (Requirement 3.5). An NPC whose scheduled Location is the same at
 * both times — or undefined at both — produces no event.
 *
 * Pure and deterministic: schedules are fixed by the seed and the clock, so no
 * random draw is made. The NPCs are iterated in id-sorted order, so the emitted
 * `npc-moved` events are in a stable, deterministic order for a given input.
 *
 * The move is emitted only when there is a concrete `from` and `to` to name: an
 * NPC appearing on schedule from "nowhere" (`undefined` → a Location) or leaving
 * the schedule (a Location → `undefined`) is not a move *between Locations*, so
 * it emits nothing — a `npc-moved` carries both endpoints by shape. A later task
 * that wants to model "arrives/leaves" can add its own events; this task emits
 * only genuine Location-to-Location movements, which is what the design's
 * `npc-moved` trace is.
 *
 * `npcs` may be the Principal NPCs, or Principal + Background — anything keyed
 * `Record<NpcId, Npc>`. Each emitted event is minted with a deterministic id at
 * `to` (the time the NPC is now at `to.loc`); the clock re-ids on adoption.
 */
export function advanceSchedules(
  npcs: Readonly<Record<NpcId, Npc>>,
  from: GameTime,
  to: GameTime,
  startDate?: string,
): readonly SimEvent[] {
  const events: SimEvent[] = [];
  let seq = 0;
  const ids = (Object.keys(npcs) as NpcId[]).sort();
  for (const id of ids) {
    const npc = npcs[id];
    const before = scheduledLocationAt(npc, from, startDate);
    const after = scheduledLocationAt(npc, to, startDate);
    // A movement needs two concrete, distinct Locations. No entry at either end
    // (or the same Location at both) is not a move between Locations.
    if (before === undefined || after === undefined || before === after) {
      continue;
    }
    events.push({
      id: schedulesEventId('move', to, seq),
      at: to,
      visibility: 'hidden',
      kind: 'npc-moved',
      npc: id,
      from: before,
      to: after,
    });
    seq += 1;
  }
  return events;
}

// ---------------------------------------------------------------------------
// Walk-ins (Requirement 22.7) — draws on the passed daily Prng
// ---------------------------------------------------------------------------

/**
 * The options {@link rollWalkIn} and {@link schedulesDayBoundaryHook} read.
 * All optional, so the minimal call uses the documented defaults.
 */
export interface WalkInOptions {
  /**
   * The per-day probability a Walk-in occurs. Defaults to
   * {@link DEFAULT_WALK_IN_PROBABILITY}. Must be in `[0, 1]`.
   */
  readonly walkInProbability?: number;
  /**
   * The probability a Walk-in, once it occurs, is genuine rather than a Dangle.
   * Defaults to {@link DEFAULT_GENUINE_PROBABILITY}. Must be in `[0, 1]`.
   */
  readonly genuineProbability?: number;
  /**
   * The NPCs eligible to approach as a Walk-in. When omitted, every NPC in
   * `npcs` is eligible. A later task may narrow this to, for example, NPCs the
   * player has not yet contacted; keeping it an injected id list leaves that
   * policy to the caller while this task stays pure and testable.
   */
  readonly candidates?: readonly NpcId[];
}

/** The outcome of a day's Walk-in roll: the events, and whether one occurred. */
export interface WalkInResult {
  /**
   * The events the Walk-in produced, in order: the hidden `walk-in-approach`
   * (carrying the ground-truth genuineness) then the player-visible `walk-in`
   * (the notification). Empty when no Walk-in occurred this day.
   */
  readonly events: readonly SimEvent[];
  /** The NPC who approached, or `undefined` when no Walk-in occurred. */
  readonly npc?: NpcId;
  /** Whether the Walk-in was genuine; `undefined` when none occurred. */
  readonly genuine?: boolean;
}

/**
 * Resolve the walk-in probability from options, validating it is in `[0, 1]`.
 */
function walkInProbabilityOf(options: WalkInOptions): number {
  const p = options.walkInProbability ?? DEFAULT_WALK_IN_PROBABILITY;
  if (!(p >= 0 && p <= 1)) {
    throw new RangeError(
      `rollWalkIn(): walkInProbability must be in [0, 1], received ${String(p)}`,
    );
  }
  return p;
}

/** Resolve the genuine probability from options, validating it is in `[0, 1]`. */
function genuineProbabilityOf(options: WalkInOptions): number {
  const p = options.genuineProbability ?? DEFAULT_GENUINE_PROBABILITY;
  if (!(p >= 0 && p <= 1)) {
    throw new RangeError(
      `rollWalkIn(): genuineProbability must be in [0, 1], received ${String(p)}`,
    );
  }
  return p;
}

/**
 * Roll the day's Walk-in on the passed daily {@link Prng} (Requirement 22.7).
 *
 * Draws in a fixed order so the stream is deterministic:
 *
 * 1. whether a Walk-in occurs this day, against the per-day probability;
 * 2. only if it does: which eligible NPC approaches (uniform over the id-sorted
 *    candidate pool), then whether the Walk-in is genuine (against the genuine
 *    probability).
 *
 * When a Walk-in occurs it emits two events at `time`: the hidden
 * `walk-in-approach` carrying the ground-truth `genuine` ({@link Truth}), then
 * the player-visible `walk-in` the player is notified of. The approach's hidden
 * genuineness is the ground truth a Dangle check reads; the visible `walk-in`
 * is identical whether the Walk-in is genuine or a provocation, so the player
 * cannot tell them apart from the notification alone (design).
 *
 * With no eligible candidates, no Walk-in is emitted even if the occurrence draw
 * succeeds — but the occurrence draw is still made first, so the daily stream
 * advances identically whether or not a candidate exists (determinism does not
 * depend on the roster). Pure with respect to its inputs; the only state touched
 * is the passed Prng.
 */
export function rollWalkIn(
  prng: Prng,
  npcs: Readonly<Record<NpcId, Npc>>,
  time: GameTime,
  options: WalkInOptions = {},
): WalkInResult {
  const walkInProbability = walkInProbabilityOf(options);
  const genuineProbability = genuineProbabilityOf(options);

  // Draw 1: does a Walk-in occur today?
  const occurs = prng.bool(walkInProbability);
  if (!occurs) {
    return { events: [] };
  }

  // The eligible candidate pool, id-sorted for a deterministic pick.
  const pool = (options.candidates ?? (Object.keys(npcs) as NpcId[]))
    .filter((id) => npcs[id] !== undefined)
    .slice()
    .sort();
  if (pool.length === 0) {
    return { events: [] };
  }

  // Draw 2: which NPC approaches. Draw 3: is it genuine?
  const npc = prng.pick(pool);
  const genuine = prng.bool(genuineProbability);

  const events: SimEvent[] = [
    {
      id: schedulesEventId('walk-in-approach', time, 0),
      at: time,
      visibility: 'hidden',
      kind: 'walk-in-approach',
      npc,
      genuine: asTruth(genuine),
    },
    {
      id: schedulesEventId('walk-in', time, 1),
      at: time,
      visibility: 'player',
      kind: 'walk-in',
      npc,
    },
  ];
  return { events, npc, genuine };
}

// ---------------------------------------------------------------------------
// The clock hook adapter
// ---------------------------------------------------------------------------

/**
 * The world context the schedules day-boundary hook closes over: the NPCs whose
 * schedules advance and who may walk in. Read-only; the hook never mutates it.
 */
export interface SchedulesWorld {
  /** The NPCs — Principal, or Principal + Background — keyed by id. */
  readonly npcs: Readonly<Record<NpcId, Npc>>;
  /** Game day 0's calendar date, so a holiday uses the Sunday column. */
  readonly startDate?: string;
}

/**
 * Adapt the schedules concerns into the clock's `schedules` day-boundary hook
 * (`ClockHooks.schedules: DayBoundaryHook`). The returned hook, on each day
 * boundary, builds a {@link Prng} from the context's `dailyStreamSeed` and:
 *
 * 1. emits the day's schedule movements across the day boundary itself — from
 *    the last phase of the previous day to the first phase of the new day — so
 *    a day-granular advance still produces the boundary's `npc-moved` events
 *    (per-phase mid-day movements are the Turn Pipeline's job via
 *    {@link advanceSchedules}, which it calls on each phase step);
 * 2. rolls the day's Walk-in on the daily stream and emits its events.
 *
 * The walk-in roll draws on the daily stream *after* the schedule movements are
 * computed (schedule advancement makes no draws, so draw order is just the
 * walk-in's own fixed order). `world` and `options` are closed over at build
 * time; the hook is otherwise a pure function of its {@link HookContext}.
 *
 * Mirrors `plotDayBoundaryHook` in `./plot-execution.ts`: a closure over the
 * world context, fitting the events-only hook contract the clock (task 7.1)
 * fixed. The context type is kept structural (`{ time; dailyStreamSeed }`) so
 * this module does not import the clock for a value, only matches its
 * {@link import('./clock.js').HookContext} shape.
 *
 * @deprecated The events-only day-boundary adapter. The game path uses the
 * `schedules` state reducer in `./world-hooks.ts` (`buildWorldHooks`), run by
 * `advanceWorld` (`./advance-world.ts`), which writes `whereabouts` and the
 * Walk-in's Contact Channel to the Draft and not only its events. Kept for the
 * existing clock tests and golden replays.
 */
export function schedulesDayBoundaryHook(
  world: SchedulesWorld,
  makePrng: (dailyStreamSeed: string) => Prng,
  options: WalkInOptions = {},
): (ctx: { readonly time: GameTime; readonly dailyStreamSeed: string }) => readonly SimEvent[] {
  return (ctx) => {
    const events: SimEvent[] = [];

    // The day boundary the clock fires on is the first phase (phase 0) of the
    // new day. The transition into it is from the last phase of the previous
    // day. On day 0 there is no previous day, so no boundary movement.
    if (ctx.time.day > 0) {
      const prevNight: GameTime = { day: ctx.time.day - 1, phase: 3 };
      events.push(...advanceSchedules(world.npcs, prevNight, ctx.time, world.startDate));
    }

    const prng = makePrng(ctx.dailyStreamSeed);
    const walkIn = rollWalkIn(prng, world.npcs, ctx.time, options);
    events.push(...walkIn.events);

    return events;
  };
}
