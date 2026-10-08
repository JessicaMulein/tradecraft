/**
 * Plot Stage execution: advancing the running Plot through its stages and
 * turning an executed stage's trace templates into concrete Sim events, with
 * disruption answered by delay / reroute / abort (design, "Clock, Plot and
 * Schedules"; Requirements 3.2, 3.3, 3.4).
 *
 * This is task 7.2. It owns the pure {@link executePlotDay}: given the running
 * {@link PlotState}, the current {@link GameTime}, the world context a Plot
 * step reads (the city's Locations, the generated NPCs, the Channels and Dead
 * Drops) and a {@link Prng} on the runtime/daily stream, it advances the Plot
 * one day and returns the {@link SimEvent}s the day produced together with the
 * updated {@link PlotState}. It never mutates its inputs.
 *
 * ## Where it fits — the clock hook seam
 *
 * The clock (`./clock.ts`, task 7.1) fires a `plot` day-boundary hook at each
 * day boundary: `ClockHooks.plot?: DayBoundaryHook`, where a
 * {@link DayBoundaryHook} receives a read-only {@link HookContext} and returns
 * `SimEvent[]`. A hook, though, has nowhere to *put* the Plot's new state — it
 * returns events only. So this module splits the concern:
 *
 * - {@link executePlotDay} is the pure step that both advances the state and
 *   emits the events — the thing 7.4 and the Turn Pipeline thread PlotState
 *   through;
 * - {@link plotDayBoundaryHook} adapts an {@link executePlotDay} call into the
 *   clock's `plot` hook shape by closing over a tiny mutable cell that captures
 *   the updated PlotState as a side effect, so the Turn Pipeline can read the
 *   advanced Plot back after an `advance`. The hook itself stays a pure
 *   function of its {@link HookContext} inputs for a given captured state.
 *
 * 7.1 owns the event bus and the day-boundary firing; this module only produces
 * the events and the updated state a plot hook contributes.
 *
 * ## What executes, and when
 *
 * A stage executes on a day when the Plot is `running`, the stage is still
 * `pending`, every stage it `requires` has already `produced` (its
 * prerequisites are met), and the day has reached the stage's `deadline` day
 * (Requirement 3.2 — advance by deadline and prerequisite). The earliest such
 * stage in DAG order executes; a stage whose prerequisites are unmet, or whose
 * deadline is still in the future, does not. When every stage has executed the
 * Plot is `completed` and a `plot-completed` event fires (design; Requirement
 * 29/38 ground the end state, filled by 7.4). Only one stage advances per day,
 * so the stream stays legible and deadlines pace the operation.
 *
 * ## Traces become events (Requirement 3.3)
 *
 * Each executed stage emits its {@link StageTrace}s as hidden Sim events: a
 * `meeting` at a Location, a `transmission` on a Channel, a `drop-loaded` /
 * `drop-emptied` at a Dead Drop, or an `npc-moved` movement. The content pack's
 * trace templates are prose (see `plots.yaml`), so {@link classifyTrace} reads
 * the kind from the prose's vocabulary (a "meeting"/"meets" trace, a
 * "signal"/"wireless"/"transmission" trace, a "dead drop"/"drop" trace, a
 * "courier"/"carries"/"barge" movement). Each event carries a `plot`
 * {@link TraceOrigin} (`asTruth({ kind: 'plot', stage })`) so surveillance and
 * interception can later attribute it, and the ids are minted deterministically
 * so the stream is reproducible.
 *
 * ## Disruption (Requirement 3.4)
 *
 * A stage is *disrupted* when a prerequisite is blocked: a required participant
 * is arrested or has fled, a required Channel is compromised, or the required
 * delivery (the Plot materiel) has been seized. Those inputs come from the
 * world/hostile state that later tasks own (7.4, 11.6, 19), so they enter here
 * as a {@link DisruptionContext} of small predicates — `isArrested(npc)`,
 * `isChannelCompromised(chan)`, `isMaterielSeized()` — each defaulting to
 * "nothing disrupted" so 7.2 is testable in isolation.
 *
 * When a due stage is disrupted, `onDisrupted` is drawn on the passed Prng
 * (doctrine-weighted — the stage carries `{delay, reroute, abort}` weights):
 *
 * - `delay` reschedules the stage (its deadline moves out by
 *   {@link DELAY_DAYS}); the stage stays `pending` and a `stage-disrupted`
 *   event records the delay cause;
 * - `reroute` rebinds the stage to an alternative role holder or Location and
 *   executes it, emitting a `plot-adapted` event describing the change (then
 *   the stage's traces fire as normal);
 * - `abort` — or `reroute` with no alternative available — marks the stage
 *   `disrupted` and the Plot `aborted`, emitting a `stage-disrupted` event. The
 *   global abort-pressure tally, `abortTolerance`, `leaderAbortThreshold`,
 *   `abortCheck` and setting `WorldState.ended` are task 7.4's; this task only
 *   sets the stage/Plot status and leaves a clean seam (see
 *   {@link StageOutcome}) 7.4 extends.
 *
 * ## Determinism
 *
 * Every draw comes from the passed {@link Prng} in a fixed order (the
 * disruption draw, then any reroute alternative pick), and all list choices run
 * over id-sorted candidate lists, so the same inputs always yield the same
 * events and the same updated PlotState (Requirement 1.2).
 */

import {
  asTruth,
  compareTime,
  type GameTime,
  type LocId,
  type NpcId,
} from '../model/core.js';
import { type Prng } from '../prng/prng.js';
import { type City } from '../city/city.js';
import { type Npc } from '../city/npc.js';
import { type Channel, type DeadDrop } from '../city/comms.js';
import {
  type PlotState,
  type StageState,
  type StageTrace,
  type StageId,
} from '../city/plot.js';
import type {
  DeadDropId,
  EventId,
  ItemRef,
  SimEvent,
  TraceOrigin,
  TraceOriginBody,
} from '../model/state.js';
import { plotTraceInterceptId } from '../cipher/world-intercepts.js';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * How many days a `delay` disruption pushes a stage's deadline out by. A whole
 * day keeps the stage on the same phase and lets the operation retry on a later
 * boundary. Fixed here so the reschedule is deterministic.
 */
export const DELAY_DAYS = 1;

/**
 * Push one stage's deadline out by `days` and leave abort pressure untouched.
 * Ambient delay hooks call this directly so they never draw `onDisrupted` and
 * never raise Abort Pressure. Returns `undefined` when the stage is absent or
 * the plot is no longer running.
 */
export function delayStage(
  plot: PlotState,
  stageId: string,
  days: number,
): PlotState | undefined {
  if (plot.status !== 'running') {
    return undefined;
  }
  const index = plot.stages.findIndex((stage) => stage.id === stageId);
  if (index < 0) {
    return undefined;
  }
  const stage = plot.stages[index];
  if (stage === undefined) {
    return undefined;
  }
  const delayed: StageState = {
    ...stage,
    deadline: { day: stage.deadline.day + days, phase: stage.deadline.phase },
  };
  const stages = plot.stages.map((entry, i) => (i === index ? delayed : entry));
  return { ...plot, stages };
}

/**
 * The first other location of the same type as `from`, in id order. This is
 * the slice reroute's same-type rule without a draw, so an ambient reroute
 * cannot fall through into an abort.
 */
export function sameTypeAlternative(
  locations: Readonly<Record<string, { readonly type: string }>>,
  from: string,
): string | undefined {
  const type = locations[from]?.type;
  if (type === undefined) {
    return undefined;
  }
  const alternatives = Object.entries(locations)
    .filter(([id, location]) => id !== from && location.type === type)
    .map(([id]) => id)
    .sort();
  return alternatives[0];
}

// ---------------------------------------------------------------------------
// Trace classification
// ---------------------------------------------------------------------------

/**
 * The kind of Sim event a {@link StageTrace} renders to. The content pack's
 * trace templates are prose, so the kind is read from the prose rather than a
 * structured field (the trace carries only `index` and `template`): a meeting,
 * a transmission, a dead-drop load or empty, or a movement.
 */
export type TraceEventKind =
  | 'meeting'
  | 'transmission'
  | 'drop-loaded'
  | 'drop-emptied'
  | 'npc-moved';

/**
 * Classify a trace template string into the {@link TraceEventKind} it renders
 * to, by the vocabulary the core pack's `plots.yaml` uses. The checks run in a
 * fixed priority order so a trace mentioning several cues classifies
 * deterministically:
 *
 * 1. a dead-drop load/empty — "dead drop", "drop", "collects"/"recovers"
 *    (empty) vs "leaves"/"loads"/"caches" (load);
 * 2. a transmission — "signal", "wireless", "transmission", "broadcast",
 *    "numbers";
 * 3. a meeting — "meet(s)", "meeting", "introduction", "takes delivery", "lays
 *    out";
 * 4. a movement — "courier", "carries", "barge", "crosses", "moves", "walks".
 *
 * Anything that matches none of these defaults to a `meeting` — the most
 * common Plot trace, and a safe hidden event to attribute to the stage.
 */
export function classifyTrace(template: string): TraceEventKind {
  const t = template.toLowerCase();

  const mentionsDrop = /\bdead drop\b|\bdrop\b/.test(t);
  if (mentionsDrop) {
    // Recovering/collecting empties a drop; leaving/loading/caching fills it.
    if (/\b(recover|recovers|collect|collects|empties|retrieve|retrieves)\b/.test(t)) {
      return 'drop-emptied';
    }
    return 'drop-loaded';
  }

  if (/\b(signal|signals|wireless|transmission|broadcast|numbers|night schedule|recognition signal)\b/.test(t)) {
    return 'transmission';
  }

  if (/\b(meet|meets|meeting|introduction|takes delivery|lays out|back room)\b/.test(t)) {
    return 'meeting';
  }

  if (/\b(courier|carries|carry|barge|crosses|cross|moves|move|walks|walk|route|checkpoint)\b/.test(t)) {
    return 'npc-moved';
  }

  return 'meeting';
}

// ---------------------------------------------------------------------------
// World context the Plot step reads
// ---------------------------------------------------------------------------

/**
 * The slice of world state a Plot step reads to render traces into events: the
 * city's Locations, the generated NPCs, and the Channels and Dead Drops the
 * Cell runs. All read-only; {@link executePlotDay} never mutates them.
 *
 * The fields mirror the matching `WorldState` members (`city`, `npcs`,
 * `channels`, `deadDrops`), so the Turn Pipeline passes slices of the live
 * state straight through.
 */
export interface PlotWorld {
  readonly city: City;
  readonly npcs: Readonly<Record<NpcId, Npc>>;
  readonly channels: Readonly<Record<string, Channel>>;
  readonly deadDrops: Readonly<Record<string, DeadDrop>>;
}

// ---------------------------------------------------------------------------
// Disruption seam (predicates owned by later tasks)
// ---------------------------------------------------------------------------

/**
 * The disruption inputs a stage reads to decide whether it is blocked
 * (Requirement 3.4). The real predicates come from the world/hostile state that
 * tasks 7.4, 11.6 and 19 own — which participant is arrested or has fled, which
 * Channel the Station has compromised, whether the Plot materiel has been
 * seized — so they enter here as small predicates, each defaulting to "nothing
 * disrupted" (see {@link NO_DISRUPTION}) so this task is testable in isolation
 * and the later tasks wire the live state in.
 */
export interface DisruptionContext {
  /** True when a required participant NPC is arrested or has fled. */
  readonly isArrested: (npc: NpcId) => boolean;
  /** True when a required Channel is compromised (in the Station's beliefs). */
  readonly isChannelCompromised: (channel: string) => boolean;
  /** True when the Plot's required materiel delivery has been seized. */
  readonly isMaterielSeized: () => boolean;
}

/** The default disruption context: nothing is disrupted. */
export const NO_DISRUPTION: DisruptionContext = {
  isArrested: () => false,
  isChannelCompromised: () => false,
  isMaterielSeized: () => false,
};

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/**
 * The outcome of considering one stage on a day. `executed` and `rerouted`
 * carry the stage's trace events; `delayed` and `aborted` carry a disruption
 * event. The tag is the clean seam task 7.4 reads to tally abort pressure and
 * decide `WorldState.ended` without this module reaching into its territory.
 */
export type StageOutcome =
  | 'executed'
  | 'rerouted'
  | 'delayed'
  | 'aborted'
  | 'none';

/** The output of {@link executePlotDay}: the updated Plot and the day's events. */
export interface PlotDayResult {
  /** The Plot after the day's step. A new value; the input is never mutated. */
  readonly plot: PlotState;
  /** The events the day produced, in deterministic order. */
  readonly events: readonly SimEvent[];
  /** What happened to the Plot this day (the seam task 7.4 reads). */
  readonly outcome: StageOutcome;
}

// ---------------------------------------------------------------------------
// Id minting
// ---------------------------------------------------------------------------

/**
 * Deterministically mint a plot event id from the stage, the current time and a
 * per-day sequence number. The `plot-evt:` prefix keeps plot-minted ids
 * distinct from the clock's `evt:` ids; when adapted into the clock hook the
 * clock re-ids each event anyway (see `clock.ts`), so this id only needs to be
 * unique and deterministic within the day's own stream.
 */
function plotEventId(stage: StageId, at: GameTime, seq: number): EventId {
  return `plot-evt:${stage}:${at.day}:${at.phase}:${seq}`;
}

/** Build a `plot` {@link TraceOrigin} for a stage. */
function plotOrigin(stage: StageId): TraceOrigin {
  const body: TraceOriginBody = { kind: 'plot', stage };
  return asTruth(body);
}

// ---------------------------------------------------------------------------
// Binding helpers (resolve concrete entities for a trace)
// ---------------------------------------------------------------------------

/** The bound NPCs of the Plot, id-sorted, for a deterministic default participant list. */
function boundNpcs(plot: PlotState): NpcId[] {
  const set = new Set<NpcId>();
  for (const role of plot.roles) {
    if (role.npc !== undefined) {
      set.add(role.npc);
    }
  }
  // The leader is always a real NPC; include it so a trace always has a person.
  set.add(plot.leader as unknown as NpcId);
  return [...set].sort();
}

/** The Dead Drops owned by a bound role NPC or the leader, id-sorted. */
function plotDrops(plot: PlotState, world: PlotWorld): DeadDrop[] {
  const owners = new Set<string>(boundNpcs(plot));
  return Object.values(world.deadDrops)
    .filter((d) => owners.has(d.owner))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The city's Locations, id-sorted, for a deterministic default meeting place. */
function sortedLocations(world: PlotWorld): LocId[] {
  return (Object.keys(world.city.locations) as LocId[]).sort();
}

// ---------------------------------------------------------------------------
// Resolving a bound trace's concrete entities
// ---------------------------------------------------------------------------

/**
 * The concrete Location a bound trace happens at, resolved from the trace's
 * bound {@link StageTrace.place} (task 26.1) and any reroute rebinding:
 *
 * - a reroute `reboundLoc` always wins (the reroute moved the stage's place);
 * - a `{ kind: 'loc' }` place is the Location the generator stamped from the
 *   template's Location Type;
 * - a `{ kind: 'target' }` place uses the bound target when it is a Location
 *   (`loc:…`) — the operation lands the event on the place it is aimed at;
 * - otherwise the trace named no usable Location, so a deterministic default is
 *   taken: a participant's scheduled Location when known, else the first city
 *   Location by id. `undefined` only when the city has no Location at all.
 */
function resolveTraceLoc(
  trace: StageTrace,
  participants: readonly NpcId[],
  world: PlotWorld,
  cursor: RenderCursor,
): LocId | undefined {
  if (cursor.reboundLoc !== undefined) {
    return cursor.reboundLoc;
  }
  if (trace.place !== undefined) {
    if (trace.place.kind === 'loc') {
      return trace.place.loc;
    }
    if (trace.place.entity.startsWith('loc:')) {
      return trace.place.entity as LocId;
    }
  }
  // No bound Location: fall back to a participant's scheduled Location, then the
  // first city Location by id, so the event still has a legible place.
  const locs = sortedLocations(world);
  for (const npc of participants) {
    const sched = world.npcs[npc]?.schedule.entries;
    if (sched !== undefined) {
      for (const entry of sched) {
        if (world.city.locations[entry.loc] !== undefined) {
          return entry.loc;
        }
      }
    }
  }
  return locs.length > 0 ? locs[0] : undefined;
}

/**
 * The bound participants of a trace with any reroute rebinding applied: a
 * reroute replaces the lead participant with its `reboundNpc` (dropping a
 * now-duplicate), so the stage's traces land on the alternative role holder.
 * Falls back to the id-sorted bound Plot NPCs when the trace named none, so a
 * trace always involves at least the leader.
 */
function resolveTraceParticipants(
  trace: StageTrace,
  plot: PlotState,
  cursor: RenderCursor,
): NpcId[] {
  const bound = trace.participants.length > 0 ? [...trace.participants] : boundNpcs(plot);
  if (cursor.reboundNpc !== undefined && bound.length > 0) {
    const rebound: NpcId[] = [cursor.reboundNpc, ...bound.slice(1)];
    return rebound.filter((n, i, a) => a.indexOf(n) === i);
  }
  return bound;
}

/**
 * Resolve a transmission/courier trace's {@link StageTrace.channelKind} to the
 * concrete {@link Channel} the event runs on (task 26.2). The template carried
 * only the kind because the Cell's Channels are minted *after* the Plot (comms
 * generation, task 5.3); here, with the live `world`, the concrete Channel is
 * the one of that kind owned by one of the trace's own participants, else by any
 * bound Plot NPC (the Cell's owner set). Candidates are
 * id-sorted so the pick is deterministic; `undefined` when the Cell runs no
 * Channel of that kind in this world.
 */
function resolveTraceChannel(
  trace: StageTrace,
  participants: readonly NpcId[],
  plot: PlotState,
  world: PlotWorld,
): Channel | undefined {
  if (trace.channelKind === undefined) {
    return undefined;
  }
  const kind = trace.channelKind;
  const ofKind = Object.values(world.channels)
    .filter((c) => c.kind === kind)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (ofKind.length === 0) {
    return undefined;
  }
  // Prefer a Channel owned by one of this trace's own participants.
  const owned = new Set<string>(participants);
  const byParticipant = ofKind.find((c) => owned.has(c.owner));
  if (byParticipant !== undefined) {
    return byParticipant;
  }
  // Else a Channel owned by any bound Plot NPC (the Cell's Channel of the kind).
  const plotOwners = new Set<string>(boundNpcs(plot));
  const byPlot = ofKind.find((c) => plotOwners.has(c.owner));
  return byPlot ?? ofKind[0];
}

// ---------------------------------------------------------------------------
// Rendering one trace into a SimEvent
// ---------------------------------------------------------------------------

/**
 * The mutable cursor a stage's trace rendering threads: the per-day sequence
 * number (for ids) and the rebound participant/location a reroute installed.
 * Kept local to one {@link executePlotDay} call.
 */
interface RenderCursor {
  seq: number;
  /** A rerouted replacement participant, if a reroute rebound a role holder. */
  readonly reboundNpc?: NpcId;
  /** A rerouted replacement Location, if a reroute rebound a place. */
  readonly reboundLoc?: LocId;
}

/**
 * Render one {@link StageTrace} into exactly the hidden {@link SimEvent} its
 * template declares (Requirement 3.6), bound to the role holders, place, Channel
 * and materiel the trace names (task 26.1 resolved these at generation). The
 * event's `kind` is the trace's own `kind` — no longer re-read from the prose —
 * and its payload comes from the trace's bound fields rather than index-modulo
 * picks over the whole Plot:
 *
 * - a `meeting` names the trace's bound participants at its bound Location;
 * - a `transmission` runs on the concrete Channel of the trace's
 *   {@link StageTrace.channelKind}, owned by a participant (resolved here, since
 *   the Cell's Channels are minted after the Plot); the intercept id stays the
 *   deterministic placeholder (minting real ciphertext is task 26.3);
 * - a `drop-loaded` / `drop-emptied` works the bound drop at the trace's place,
 *   carrying the trace's bound materiel;
 * - an `npc-moved` moves the bound participant to the trace's bound Location.
 *
 * Any reroute rebinding on `cursor` is applied (an alternative participant or
 * Location). Returns `undefined` only when the trace cannot land anywhere — a
 * transmission with no Channel of its kind, or a place-needing event in a city
 * with no Location — which a generated world does not produce.
 */
function renderTrace(
  stage: StageState,
  trace: StageTrace,
  plot: PlotState,
  world: PlotWorld,
  cursor: RenderCursor,
): SimEvent | undefined {
  const kind = trace.kind;
  const origin = plotOrigin(stage.id);
  const at = stage.deadline;
  const id = plotEventId(stage.id, at, cursor.seq);
  cursor.seq += 1;

  const participants = resolveTraceParticipants(trace, plot, cursor);

  switch (kind) {
    case 'meeting': {
      const loc = resolveTraceLoc(trace, participants, world, cursor);
      if (loc === undefined) {
        return undefined;
      }
      return {
        id,
        at,
        visibility: 'hidden',
        kind: 'meeting',
        participants,
        loc,
        origin,
      };
    }
    case 'transmission': {
      const channel = resolveTraceChannel(trace, participants, plot, world);
      if (channel === undefined) {
        return undefined;
      }
      // The real ciphertext Intercept is minted by the Cipher Engine at world
      // assembly (task 26.3), keyed to this stage/trace; the SimEvent references
      // it by computing the same id, so the `transmission` event points at the
      // Intercept the player can actually collect off the Channel.
      const intercept = plotTraceInterceptId(stage.id, trace.index);
      return {
        id,
        at,
        visibility: 'hidden',
        kind: 'transmission',
        channel: channel.id,
        intercept,
        origin,
      };
    }
    case 'drop-loaded':
    case 'drop-emptied': {
      const loc = resolveTraceLoc(trace, participants, world, cursor);
      // The bound drop is the one at the trace's place; else a drop owned by a
      // bound Plot NPC (the Cell's drop). `undefined` only when neither exists.
      const drop = resolveTraceDrop(loc, plot, world);
      if (drop === undefined) {
        return undefined;
      }
      const by = participants.length > 0 ? participants[0] : (plot.leader as unknown as NpcId);
      // The items the drop carries: the trace's bound materiel when it named
      // one, else the drop's current contents.
      const items: ItemRef[] =
        trace.materiel !== undefined
          ? [{ item: trace.materiel }]
          : drop.contents.map((item) => ({ item }));
      return {
        id,
        at,
        visibility: 'hidden',
        kind,
        drop: drop.id as DeadDropId,
        by,
        items,
        origin,
      };
    }
    case 'npc-moved': {
      const locs = sortedLocations(world);
      if (locs.length === 0) {
        return undefined;
      }
      const npc = participants.length > 0 ? participants[0] : boundNpcs(plot)[0];
      const to = resolveTraceLoc(trace, participants, world, cursor) ?? locs[0];
      // The move originates at the participant's other scheduled Location when
      // known, else a second city Location, so from/to differ where possible.
      const from = moveOrigin(npc, to, world) ?? to;
      return { id, at, visibility: 'hidden', kind: 'npc-moved', npc, from, to };
    }
    default: {
      return undefined;
    }
  }
}

/**
 * The concrete Dead Drop a drop trace works: the drop at the trace's bound
 * Location when one sits there, else a drop owned by a bound Plot NPC (the
 * Cell's drop), else the first Plot drop by id. `undefined` only when the world
 * has no suitable drop at all.
 */
function resolveTraceDrop(
  loc: LocId | undefined,
  plot: PlotState,
  world: PlotWorld,
): DeadDrop | undefined {
  if (loc !== undefined) {
    const atLoc = Object.values(world.deadDrops)
      .filter((d) => d.loc === loc)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (atLoc.length > 0) {
      return atLoc[0];
    }
  }
  const drops = plotDrops(plot, world);
  return drops.length > 0 ? drops[0] : undefined;
}

/**
 * A plausible origin Location for an `npc-moved` to `to`: a Location the NPC is
 * scheduled at that is not `to`, else a city Location other than `to`.
 * `undefined` when the city has only `to`, so the caller collapses from/to.
 */
function moveOrigin(npc: NpcId, to: LocId, world: PlotWorld): LocId | undefined {
  const sched = world.npcs[npc]?.schedule.entries;
  if (sched !== undefined) {
    for (const entry of sched) {
      if (entry.loc !== to && world.city.locations[entry.loc] !== undefined) {
        return entry.loc;
      }
    }
  }
  const other = sortedLocations(world).find((l) => l !== to);
  return other;
}

// ---------------------------------------------------------------------------
// Stage selection
// ---------------------------------------------------------------------------

/** The set of PropIds produced by stages that have already executed. */
function producedProps(plot: PlotState): Set<string> {
  const out = new Set<string>();
  for (const stage of plot.stages) {
    if (stage.status === 'executed') {
      for (const p of stage.produces) {
        out.add(p);
      }
    }
  }
  return out;
}

/** True when every prerequisite PropId of `stage` has been produced. */
function prerequisitesMet(stage: StageState, produced: Set<string>): boolean {
  return stage.requires.every((req) => produced.has(req));
}

/**
 * The index of the earliest stage eligible to run on `time`: still `pending`,
 * with its prerequisites met and its deadline day reached. `-1` when none is
 * due. Stages are considered in DAG order (the array order), so the Plot
 * advances one well-rooted step at a time.
 */
function dueStageIndex(plot: PlotState, time: GameTime): number {
  const produced = producedProps(plot);
  for (let i = 0; i < plot.stages.length; i += 1) {
    const stage = plot.stages[i];
    if (stage.status !== 'pending') {
      continue;
    }
    if (!prerequisitesMet(stage, produced)) {
      continue;
    }
    // Due when the current day has reached the stage's deadline day. Comparing
    // by day (not phase) keeps the step on a day boundary, where the clock
    // fires the plot hook.
    if (time.day >= stage.deadline.day) {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Disruption
// ---------------------------------------------------------------------------

/**
 * Whether a stage is disrupted, and why. A stage is disrupted when a required
 * participant is arrested/fled, a required Channel is compromised, or the Plot
 * materiel has been seized (Requirement 3.4). The cause string is a stable,
 * human-readable key the `stage-disrupted` event carries.
 */
function disruptionCause(
  stage: StageState,
  plot: PlotState,
  world: PlotWorld,
  disruption: DisruptionContext,
): string | undefined {
  // A participant in the stage's OWN traces arrested or fled (Requirement 3.7).
  // The stage is blocked only by its own role holders, not by every bound Plot
  // NPC — a later stage's handler being arrested does not block this one.
  for (const npc of stageParticipants(stage)) {
    if (disruption.isArrested(npc)) {
      return `participant-arrested:${npc}`;
    }
  }
  // A Channel the stage's OWN traces use compromised (Requirement 3.7). Only a
  // Channel one of this stage's transmission/courier traces runs on counts.
  for (const channel of stageChannels(stage, plot, world)) {
    if (disruption.isChannelCompromised(channel.id)) {
      return `channel-compromised:${channel.id}`;
    }
  }
  // A delivery the stage's OWN traces collect seized (Requirement 3.7). The
  // materiel-seizure predicate reads the Plot materiel; this stage is disrupted
  // only when one of its own drop-emptied traces collects a bound delivery, so
  // seizing the materiel blocks the stage that lifts it, not every stage.
  if (disruption.isMaterielSeized() && stageCollectsDelivery(stage)) {
    return 'materiel-seized';
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// A stage's own participants / Channels / deliveries (Requirement 3.7)
// ---------------------------------------------------------------------------

/**
 * The NPCs the stage's own traces involve, deduped and id-sorted — the role
 * holders a disruption to the stage must touch (Requirement 3.7). A stage with
 * no bound participant on any trace yields the empty set, so an empty stage is
 * never disrupted by an unrelated arrest.
 */
function stageParticipants(stage: StageState): NpcId[] {
  const set = new Set<NpcId>();
  for (const trace of stage.traces) {
    for (const npc of trace.participants) {
      set.add(npc);
    }
  }
  return [...set].sort();
}

/**
 * The concrete Channels the stage's own transmission/courier traces run on
 * (Requirement 3.7), resolved the same way {@link renderTrace} resolves a
 * trace's Channel. Only these count toward the stage's compromise, so a
 * compromised Channel another stage uses does not block this one.
 */
function stageChannels(stage: StageState, plot: PlotState, world: PlotWorld): Channel[] {
  const byId = new Map<string, Channel>();
  for (const trace of stage.traces) {
    if (trace.channelKind === undefined) {
      continue;
    }
    const channel = resolveTraceChannel(trace, trace.participants, plot, world);
    if (channel !== undefined) {
      byId.set(channel.id, channel);
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * True when the stage's own traces collect a delivery — a `drop-emptied` trace
 * that lifts a bound materiel (Requirement 3.7). A stage that only loads a drop,
 * or carries no materiel, does not collect a delivery and so is not disrupted by
 * a materiel seizure.
 */
function stageCollectsDelivery(stage: StageState): boolean {
  return stage.traces.some(
    (trace) => trace.kind === 'drop-emptied' && trace.materiel !== undefined,
  );
}

/**
 * Draw a disruption response from the stage's doctrine-weighted `onDisrupted`
 * weights on the passed Prng. The three weights need not sum to one; they are
 * normalised here, so a template can carry raw doctrine weights. A degenerate
 * all-zero weighting defaults to `abort` (the safe, operation-ending choice).
 * One draw per disrupted stage, in a fixed order, so the stream is
 * deterministic.
 */
export function drawDisruption(
  prng: Prng,
  weights: StageState['onDisrupted'],
): 'delay' | 'reroute' | 'abort' {
  const delay = Math.max(0, weights.delay);
  const reroute = Math.max(0, weights.reroute);
  const abort = Math.max(0, weights.abort);
  const total = delay + reroute + abort;
  if (total <= 0) {
    return 'abort';
  }
  const roll = prng.next() * total;
  if (roll < delay) {
    return 'delay';
  }
  if (roll < delay + reroute) {
    return 'reroute';
  }
  return 'abort';
}

/**
 * Find an alternative binding for a rerouted stage: a bound role NPC other than
 * the ones currently blocked, or a Location of the same type as the stage's
 * default meeting place, drawn on the passed Prng. Returns `undefined` when no
 * alternative exists — the design's "`reroute` with no alternative" case, which
 * the caller treats as an abort.
 *
 * The alternative is a replacement participant when the Plot has a spare bound
 * NPC not currently arrested, else a replacement Location when the city has a
 * second Location of the default's type. The draw order is fixed: the NPC
 * candidate list first, then the Location candidate list.
 */
function findReroute(
  stage: StageState,
  plot: PlotState,
  world: PlotWorld,
  disruption: DisruptionContext,
  prng: Prng,
): { readonly npc?: NpcId; readonly loc?: LocId } | undefined {
  // An alternative role holder: a bound Plot NPC that is not arrested and is
  // not the leader (the leader cannot be rerouted away from).
  const leader = plot.leader as unknown as NpcId;
  const altNpcs = boundNpcs(plot)
    .filter((n) => n !== leader && !disruption.isArrested(n))
    .sort();
  if (altNpcs.length > 0) {
    return { npc: prng.pick(altNpcs) };
  }

  // An alternative Location of the same type as the default meeting place.
  const locs = sortedLocations(world);
  if (locs.length > 0) {
    const defaultLoc = locs[0];
    const defaultType = world.city.locations[defaultLoc]?.type;
    const altLocs = locs
      .filter((l) => l !== defaultLoc && world.city.locations[l]?.type === defaultType)
      .sort();
    if (altLocs.length > 0) {
      return { loc: prng.pick(altLocs) };
    }
    // No same-type alternative, but a different Location still reroutes a place.
    const otherLocs = locs.filter((l) => l !== defaultLoc).sort();
    if (otherLocs.length > 0) {
      return { loc: prng.pick(otherLocs) };
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Stage execution (the trace -> events step)
// ---------------------------------------------------------------------------

/**
 * Execute a stage: emit a `stage-executed` event, then every trace rendered to
 * its Sim event (meetings, transmissions, drops, movements). The `cursor`
 * carries any reroute rebinding so a rerouted stage's traces land on the
 * alternative participant/Location. Returns the events in order.
 */
function executeStageEvents(
  stage: StageState,
  plot: PlotState,
  world: PlotWorld,
  cursor: RenderCursor,
): SimEvent[] {
  const events: SimEvent[] = [];
  events.push({
    id: plotEventId(stage.id, stage.deadline, cursor.seq),
    at: stage.deadline,
    visibility: 'hidden',
    kind: 'stage-executed',
    stage: stage.id,
  });
  cursor.seq += 1;

  for (const trace of stage.traces) {
    const event = renderTrace(stage, trace, plot, world, cursor);
    if (event !== undefined) {
      events.push(event);
    }
  }
  return events;
}

/** Replace a stage in the Plot's stage list, returning a new stages array. */
function withStage(plot: PlotState, index: number, next: StageState): StageState[] {
  const stages = [...plot.stages];
  stages[index] = next;
  return stages;
}

/** True when every stage of the Plot has executed. */
function allExecuted(stages: readonly StageState[]): boolean {
  return stages.every((s) => s.status === 'executed');
}

// ---------------------------------------------------------------------------
// executePlotDay — the pure step
// ---------------------------------------------------------------------------

/**
 * The options {@link executePlotDay} reads beyond the required Plot, time,
 * world and Prng. All optional, so the minimal disruption-free call is
 * `executePlotDay(plot, time, world, prng)`.
 */
export interface ExecutePlotDayOptions {
  /**
   * The disruption predicates for this day. Defaults to {@link NO_DISRUPTION}
   * — nothing is disrupted — so the step is testable in isolation; 7.4/11.6/19
   * wire the live predicates.
   */
  readonly disruption?: DisruptionContext;
}

/**
 * Advance the running Plot one day and return the day's events with the updated
 * Plot (design, "Clock, Plot and Schedules"; Requirements 3.2, 3.3, 3.4).
 *
 * Pure: it never mutates `plot`, `world` or `options`, and draws only from the
 * passed `prng` (in a fixed order: the disruption draw, then any reroute pick).
 * It is the step a `plot` day-boundary hook adapts (see
 * {@link plotDayBoundaryHook}).
 *
 * On a given day it finds the earliest stage due to run (pending,
 * prerequisites met, deadline day reached). If none is due — or the Plot has
 * ended — it returns the Plot unchanged with no events (`outcome: 'none'`).
 * Otherwise it checks the stage for disruption:
 *
 * - undisrupted: the stage executes, its traces fire as events, and if that was
 *   the last stage the Plot completes with a `plot-completed` event
 *   (`outcome: 'executed'`);
 * - disrupted: `onDisrupted` is drawn, and the stage is delayed
 *   (`outcome: 'delayed'`), rerouted and executed (`outcome: 'rerouted'`), or
 *   aborted (`outcome: 'aborted'`) — a `reroute` with no alternative aborts.
 *
 * The abort case sets the stage `disrupted` and the Plot `aborted` and emits a
 * `stage-disrupted` event; the global abort-pressure accounting and
 * `WorldState.ended` are left to task 7.4, which reads {@link PlotDayResult}'s
 * `outcome` seam.
 */
export function executePlotDay(
  plot: PlotState,
  time: GameTime,
  world: PlotWorld,
  prng: Prng,
  options: ExecutePlotDayOptions = {},
): PlotDayResult {
  const disruption = options.disruption ?? NO_DISRUPTION;

  // A Plot that is not running does nothing.
  if (plot.status !== 'running') {
    return { plot, events: [], outcome: 'none' };
  }

  const index = dueStageIndex(plot, time);
  if (index === -1) {
    return { plot, events: [], outcome: 'none' };
  }

  const stage = plot.stages[index];
  const cause = disruptionCause(stage, plot, world, disruption);

  // --- Undisrupted: execute the stage and its traces ----------------------
  if (cause === undefined) {
    const cursor: RenderCursor = { seq: 0 };
    const events = executeStageEvents(stage, plot, world, cursor);
    const executedStage: StageState = { ...stage, status: 'executed' };
    const stages = withStage(plot, index, executedStage);

    if (allExecuted(stages)) {
      const completed: PlotState = { ...plot, stages, status: 'completed' };
      events.push({
        id: plotEventId(stage.id, stage.deadline, cursor.seq),
        at: stage.deadline,
        visibility: 'hidden',
        kind: 'plot-completed',
      });
      return { plot: completed, events, outcome: 'executed' };
    }

    return { plot: { ...plot, stages }, events, outcome: 'executed' };
  }

  // --- Disrupted: draw the doctrine-weighted response ---------------------
  const response = drawDisruption(prng, stage.onDisrupted);

  if (response === 'delay') {
    const delayed: StageState = {
      ...stage,
      deadline: { day: stage.deadline.day + DELAY_DAYS, phase: stage.deadline.phase },
    };
    const stages = withStage(plot, index, delayed);
    const events: SimEvent[] = [
      {
        id: plotEventId(stage.id, time, 0),
        at: time,
        visibility: 'hidden',
        kind: 'stage-disrupted',
        stage: stage.id,
        cause: `delay:${cause}`,
      },
    ];
    return { plot: { ...plot, stages }, events, outcome: 'delayed' };
  }

  if (response === 'reroute') {
    const alt = findReroute(stage, plot, world, disruption, prng);
    if (alt !== undefined) {
      const change =
        alt.npc !== undefined
          ? `reroute:${stage.id}:participant:${alt.npc}`
          : `reroute:${stage.id}:location:${alt.loc ?? ''}`;
      const events: SimEvent[] = [
        { id: plotEventId(stage.id, time, 0), at: time, visibility: 'hidden', kind: 'plot-adapted', change },
      ];
      const cursor: RenderCursor = { seq: 1, reboundNpc: alt.npc, reboundLoc: alt.loc };
      events.push(...executeStageEvents(stage, plot, world, cursor));
      const executedStage: StageState = { ...stage, status: 'executed' };
      const stages = withStage(plot, index, executedStage);

      if (allExecuted(stages)) {
        const completed: PlotState = { ...plot, stages, status: 'completed' };
        events.push({
          id: plotEventId(stage.id, stage.deadline, cursor.seq),
          at: stage.deadline,
          visibility: 'hidden',
          kind: 'plot-completed',
        });
        return { plot: completed, events, outcome: 'rerouted' };
      }
      return { plot: { ...plot, stages }, events, outcome: 'rerouted' };
    }
    // Reroute with no alternative behaves as an abort (design).
    return abortStage(plot, index, stage, time, `no-reroute:${cause}`);
  }

  // response === 'abort'
  return abortStage(plot, index, stage, time, `abort:${cause}`);
}

/**
 * Mark a stage `disrupted` and the Plot `aborted`, emitting a `stage-disrupted`
 * event. This task sets the stage/Plot status only; the global abort-pressure
 * tally, `abortTolerance`/`leaderAbortThreshold`/`abortCheck`, the hidden
 * `plot-aborted` event and setting `WorldState.ended` are task 7.4's, which
 * reads the `aborted` {@link StageOutcome} seam.
 */
function abortStage(
  plot: PlotState,
  index: number,
  stage: StageState,
  time: GameTime,
  cause: string,
): PlotDayResult {
  const disruptedStage: StageState = { ...stage, status: 'disrupted' };
  const stages = withStage(plot, index, disruptedStage);
  const events: SimEvent[] = [
    {
      id: plotEventId(stage.id, time, 0),
      at: time,
      visibility: 'hidden',
      kind: 'stage-disrupted',
      stage: stage.id,
      cause,
    },
  ];
  return {
    plot: { ...plot, stages, status: 'aborted' },
    events,
    outcome: 'aborted',
  };
}

// ---------------------------------------------------------------------------
// The clock hook adapter
// ---------------------------------------------------------------------------

/**
 * A mutable cell that captures the Plot state across a clock `advance`. The
 * clock's `plot` day-boundary hook returns events only, so to thread the
 * advanced {@link PlotState} back out of an `advance` the hook writes it here as
 * a controlled side effect. The Turn Pipeline creates one cell, builds a hook
 * from it, runs `advance`, then reads the final Plot from the cell.
 */
export interface PlotStateCell {
  plot: PlotState;
}

/**
 * Adapt {@link executePlotDay} into the clock's `plot` day-boundary hook
 * (`ClockHooks.plot`). The returned hook, on each day boundary, runs a Plot day
 * against the current Plot held in `cell`, writes the advanced Plot back into
 * `cell`, and returns the day's events for the clock to append. The hook builds
 * its Prng from the context's `dailyStreamSeed` so every disruption draw rides
 * the deterministic daily stream the clock supplies.
 *
 * `world` and `options` are closed over at build time (the world is read-only
 * within a day); `cell` carries the evolving Plot. This keeps `executePlotDay`
 * a pure function while still fitting the events-only hook contract 7.1 fixed.
 *
 * @deprecated The events-only day-boundary adapter. The game path uses the
 * `plot` state reducer in `./world-hooks.ts` (`buildWorldHooks`), run by
 * `advanceWorld` (`./advance-world.ts`), which applies the Plot's state
 * changes to the Draft and not only its events. Kept for the existing clock
 * tests and golden replays.
 */
export function plotDayBoundaryHook(
  cell: PlotStateCell,
  world: PlotWorld,
  makePrng: (dailyStreamSeed: string) => Prng,
  options: ExecutePlotDayOptions = {},
): (ctx: { readonly time: GameTime; readonly dailyStreamSeed: string }) => readonly SimEvent[] {
  return (ctx) => {
    const prng = makePrng(ctx.dailyStreamSeed);
    const result = executePlotDay(cell.plot, ctx.time, world, prng, options);
    cell.plot = result.plot;
    return result.events;
  };
}

// ---------------------------------------------------------------------------
// Read helpers (exported for tests / later tasks)
// ---------------------------------------------------------------------------

/** True when the Plot has run every stage to completion. */
export function plotIsComplete(plot: PlotState): boolean {
  return plot.status === 'completed';
}

/** The stages that have yet to execute (still `pending`). */
export function pendingStages(plot: PlotState): readonly StageState[] {
  return plot.stages.filter((s) => s.status === 'pending');
}

/** Order two times earliest-first (re-exported convenience over `compareTime`). */
export function earliest(a: GameTime, b: GameTime): GameTime {
  return compareTime(a, b) <= 0 ? a : b;
}
