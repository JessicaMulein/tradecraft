/**
 * The four Day-Boundary Hooks as state reducers (slice-integration design,
 * "Engine: Day-Boundary Hooks (`engine/clock/world-hooks.ts`)"; Requirements
 * 2.2–2.5, 3.1, 3.8, 4.1, 4.5, 5.1).
 *
 * `advanceWorld` (`./advance-world.ts`, task 5.1) runs the hooks present in a
 * {@link WorldHooks} in `DAY_BOUNDARY_HOOK_ORDER` at each Day Boundary, handing
 * each the Draft the previous one returned (Req 2.2). {@link buildWorldHooks}
 * returns the production set of four reducers:
 *
 * | Hook | What it does |
 * |---|---|
 * | `plot` | Builds the live Disruption Context from the Draft (Req 4.1), runs Plot execution on the runtime stream, writes the advanced Plot and its trace events, mints a Transmission for each `transmission` trace, then runs the abort check (Req 2.3, 4.5). |
 * | `schedules` | Emits the boundary `npc-moved` moves and writes `whereabouts` (pinning out-of-play NPCs), rolls the day's Walk-in on the daily stream, gives a Walk-in NPC a Contact Channel, and stores the day's events in `scratch.dayEvents` (Req 2.4). |
 * | `hostileTick` | Runs the Hostile Full Tick on the runtime stream (`applyFullTick(dailyTickFull(projectFullTick(…), rng))`) and runs the abort check again (Req 3.1, 4.5). |
 * | `newspaper` | Composes the day's edition from `dailyMaterial(day)` plus the scratch plants and arrest articles on the daily stream, writes the Document, its Propositions, `newspapers[day]` and the Document's obtainable Locations, and emits the player-visible `newspaper` event (Req 2.5, 3.8). |
 *
 * ## PRNG streams (Req 5.1)
 *
 * The design moves the Plot disruption/reroute draws and the whole Hostile tick
 * to the **runtime** stream carried in the Draft (`ctx.rng`), and keeps the
 * Walk-in roll and the newspaper article selection on the **daily** stream for
 * the day (`ctx.dailyStreamSeed`). Weather is set by `advanceWorld`, not by a
 * hook.
 *
 * ## The abort check (Req 4.5)
 *
 * The abort check is encapsulated inside the `plot` and `hostileTick` hook
 * outputs: each runs {@link abortCheck} on the Draft's Plot with the current
 * leader suspicion, the materiel-seized flag from the Disruption Context and
 * the Cell doctrine, and on a trigger applies {@link applyAbort} — setting
 * `plot.status = 'aborted'`, emitting the hidden `plot-aborted` event and
 * writing the success End Condition to `WorldState.ended`. `advanceWorld`
 * therefore only runs the hooks in order; the Phase Step's `detectEnd` (task
 * 5.1) sees the abort the hook wrote. {@link worldAbortCheck} is also exported
 * for a caller that wants to run the same check explicitly.
 *
 * ## Purity (Req 5.6)
 *
 * Every hook reads only its arguments: the Draft and the context (including the
 * dependencies and the day scratch). Randomness comes from `ctx.rng` (runtime)
 * or a Prng built from `ctx.dailyStreamSeed` (daily); no clock, file,
 * environment or model is read. A hook writes the scratch's fields by
 * assignment (never mutating an array), which is how one hook hands values to a
 * later one.
 */

import {
  compareTime,
  revealTruth,
  type DocId,
  type EntityId,
  type GameTime,
  type LocId,
  type NpcId,
  type OrgId,
  type Proposition,
} from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import { createPrng, type Prng } from '../prng/prng.js';
import { isInterceptableKind, type Channel } from '../city/comms.js';
import type { Npc } from '../city/npc.js';
import type { StageState, StageTrace } from '../city/plot.js';
import { newRelationship } from '../recruit/asset.js';
import {
  buildTransmissions,
  generateIntercepts,
  type InterceptSource,
  type Transmission,
} from '../cipher/intercept.js';
import {
  padPoolIds,
  plotTraceInterceptId,
  plotTransmissionId,
  cellTrafficTransmissionId,
  publicTextIdsOf,
  stagePropositions,
  stageTransmissionPropositions,
} from '../cipher/world-intercepts.js';
import { composeNewspaper, dailyMaterial } from '../docs/newspaper.js';
import { publicTextLocations } from '../docs/public-text.js';
import type { NamerContext } from '../docs/namer.js';
import { projectFullTick, applyFullTick } from '../hostile/project.js';
import { dailyTickFull } from '../hostile/hostile.js';
import { executePlotDay, type PlotWorld } from './plot-execution.js';
import { liveDisruption } from './disruption.js';
import {
  abortCheck,
  applyAbort,
  type AbortDecision,
  type Doctrine,
} from './plot-abort.js';
import {
  advanceSchedules,
  rollWalkIn,
  scheduledLocationAt,
} from './schedules.js';
import { pinnedWhereabouts } from './phase-step.js';
import type {
  AdvanceWorldDeps,
  WorldHook,
  WorldHookContext,
  WorldHooks,
} from './world-types.js';

// ---------------------------------------------------------------------------
// buildWorldHooks
// ---------------------------------------------------------------------------

/**
 * The production Day-Boundary Hooks, keyed for {@link WorldHooks}. Each hook is
 * a pure reducer `(draft, ctx) → { state, events }`; `advanceWorld` runs the
 * present ones in `DAY_BOUNDARY_HOOK_ORDER`.
 */
export function buildWorldHooks(): Required<WorldHooks> {
  return {
    plot: plotHook,
    schedules: schedulesHook,
    hostileTick: hostileTickHook,
    newspaper: newspaperHook,
  };
}

// ---------------------------------------------------------------------------
// The abort check (Req 4.5)
// ---------------------------------------------------------------------------

/**
 * Run the Day-Boundary abort check on the Draft's Plot and, on a trigger, apply
 * the abort: set `plot.status = 'aborted'`, append the hidden `plot-aborted`
 * event and write the success End Condition to `WorldState.ended`. Returns the
 * Draft unchanged with no extra events when the Plot stays running (or has
 * already ended).
 *
 * The leader suspicion is the Hostile Service's suspicion of the Cell leader
 * (`hostile.beliefs.agentSuspicion[leader]`, 0 when none is recorded); the
 * materiel-seized flag is read from the live Disruption Context so a seizure
 * recorded earlier this turn is seen (Req 4.4); the doctrine is the Cell's.
 * A Plot already `aborted` or `completed` is left untouched — the abort has
 * already been decided — so the check never re-stamps an ended Plot.
 */
export function worldAbortCheck(
  draft: WorldState,
  at: GameTime,
): { readonly state: WorldState; readonly events: readonly SimEvent[] } {
  if (draft.plot.status !== 'running') {
    return { state: draft, events: [] };
  }
  const decision = decideAbort(draft, at);
  if (decision === null) {
    return { state: draft, events: [] };
  }
  return {
    state: {
      ...draft,
      plot: decision.plot,
      ended: draft.ended ?? {
        outcome: decision.ended.outcome,
        at: decision.ended.at,
        cause: decision.ended.cause,
      },
    },
    events: [decision.event],
  };
}

/**
 * The abort decision for the Draft's Plot, or `null` when it stays running.
 * Reads the leader suspicion, the materiel-seized flag and the doctrine as
 * {@link worldAbortCheck} documents.
 */
function decideAbort(draft: WorldState, at: GameTime): AbortDecision | null {
  const leader = revealTruth(draft.plot.leader);
  const leaderSuspicion = draft.hostile.beliefs.agentSuspicion[leader] ?? 0;
  const materielSeized = liveDisruption(draft).isMaterielSeized();
  const doctrine: Doctrine = draft.hostile.doctrine;
  const trigger = abortCheck(draft.plot, {
    leaderSuspicion,
    materielSeized,
    doctrine,
  });
  return trigger === null ? null : applyAbort(draft.plot, trigger, at);
}

// ---------------------------------------------------------------------------
// plot hook (Req 2.3, 4.1, 4.5, 5.1)
// ---------------------------------------------------------------------------

/**
 * The `plot` hook. Builds the live Disruption Context from the Draft (Req 4.1),
 * runs {@link executePlotDay} on the runtime stream, writes the advanced Plot
 * and the day's trace events, mints a Transmission (carrying its Intercept) for
 * each `transmission` trace of the stages that executed this day (Req 2.3), and
 * then runs the abort check (Req 4.5).
 */
const plotHook: WorldHook = (draft, ctx) => {
  const world: PlotWorld = {
    city: draft.city,
    npcs: draft.npcs,
    channels: draft.channels,
    deadDrops: draft.deadDrops,
  };
  const disruption = liveDisruption(draft);
  const result = executePlotDay(draft.plot, ctx.time, world, ctx.rng, {
    disruption,
  });

  // The advanced Plot and the transmissions minted for this day's traces.
  const transmissions = mintPlotTransmissions(
    draft,
    result.events,
    world,
    ctx,
  );
  const afterPlot: WorldState = {
    ...draft,
    plot: result.plot,
    transmissions,
    scheduled: queueObservable(draft.scheduled, result.events, ctx.time),
  };

  // The abort check reads the Plot the day left (Req 4.5).
  const abort = worldAbortCheck(afterPlot, ctx.time);
  return {
    state: abort.state,
    events: [...result.events, ...abort.events],
  };
};

/** The Sim event kinds a watcher at a Location can observe. */
const OBSERVABLE_KINDS: ReadonlySet<SimEvent['kind']> = new Set([
  'meeting',
  'npc-moved',
  'drop-loaded',
  'drop-emptied',
]);

/** How many days an observable Plot event stays on the queue after it happens. */
const OBSERVABLE_RETENTION_DAYS = 1;

/** Whether a queued event is an observable event the Plot put there. */
function isQueuedPlotEvent(event: SimEvent): boolean {
  return OBSERVABLE_KINDS.has(event.kind) && event.id.startsWith('plot-evt:');
}

/**
 * Put the day's observable Plot events (meetings, drops, moves) on the
 * `scheduled` queue, so surveillance and follows at their Location and time can
 * see them, and drop the Plot's observable events that are older than
 * {@link OBSERVABLE_RETENTION_DAYS}. Surveil and follow read their window's
 * events from `scheduled`; without this, a Plot meeting happens in the hook and
 * no watcher can ever see it, which leaves the discovery verifier's
 * surveillance route empty at runtime. The queue stays time-ordered.
 */
function queueObservable(
  queue: readonly SimEvent[],
  events: readonly SimEvent[],
  now: GameTime,
): readonly SimEvent[] {
  const fresh = events.filter((event) => OBSERVABLE_KINDS.has(event.kind));
  const kept = queue.filter(
    (event) =>
      !isQueuedPlotEvent(event) || event.at.day >= now.day - OBSERVABLE_RETENTION_DAYS,
  );
  if (fresh.length === 0 && kept.length === queue.length) {
    return queue;
  }
  const seen = new Set(kept.map((event) => event.id));
  const out = [...kept];
  for (const event of fresh) {
    if (seen.has(event.id)) {
      continue;
    }
    let i = out.length;
    while (i > 0 && compareTime(out[i - 1].at, event.at) > 0) {
      i -= 1;
    }
    out.splice(i, 0, event);
  }
  return out;
}

/**
 * Mint a {@link Transmission} (carrying its Intercept) for every `transmission`
 * SimEvent the Plot day emitted whose transmission is not already in the Draft.
 *
 * Each `transmission` trace of an executed stage runs on an interceptable
 * Channel; its stable transmission id is {@link plotTransmissionId}. World
 * assembly seeds these already, so a trace that fired within the seeded horizon
 * is deduped by id and nothing is re-minted. A trace that executes past the
 * seeded horizon is minted here on the runtime stream, exactly as the Hostile
 * tick mints its own comms traffic. The minted Intercept travels inside its
 * Transmission on `transmissions`; it is **not** written to `intercepts`, which
 * holds only what the player has collected — the intercept action collects it.
 */
function mintPlotTransmissions(
  draft: WorldState,
  events: readonly SimEvent[],
  world: PlotWorld,
  ctx: WorldHookContext,
): readonly Transmission[] {
  const sources = [
    ...plotTransmissionSources(draft, events, world, ctx),
    ...routineCellTraffic(draft, ctx),
  ];
  const existing = new Set(draft.transmissions.map((tx) => tx.id));
  const fresh = sources.filter((source) => !existing.has(source.id));
  if (fresh.length === 0) {
    return draft.transmissions;
  }
  const generated = generateIntercepts(ctx.rng, fresh, {
    channels: draft.channels,
    fieldCodes: ctx.deps.content.predicates.fieldCodes,
    allowedCiphers: draft.meta.preset.allowedCiphers,
    tradecraftErrorProbability: draft.meta.preset.tradecraftErrorProbability,
    publicTextIds: publicTextIdsOf(draft.documents),
    padIds: padPoolIds(),
    keyLookup: ctx.deps.cipherKeys,
  });
  return [
    ...draft.transmissions,
    ...buildTransmissions(fresh, generated, draft.channels),
  ];
}

/**
 * The {@link InterceptSource}s for the day's Plot `transmission` traces. For
 * each `transmission` SimEvent the day emitted, the matching stage and trace
 * are found by the event's `plot` origin (the stage id) and its `intercept`
 * field (which encodes the stage/trace), and the source carries the Plot's
 * operation Propositions on the trace's Channel. A trace whose Channel is not
 * interceptable, or whose propositions are empty, is skipped.
 */
function plotTransmissionSources(
  draft: WorldState,
  events: readonly SimEvent[],
  world: PlotWorld,
  ctx: WorldHookContext,
): InterceptSource[] {
  const props = plotOperationPropositions(draft, ctx.deps);
  if (props.length === 0) {
    return [];
  }
  const out: InterceptSource[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.kind !== 'transmission') {
      continue;
    }
    const stage = stageOfTransmission(draft, event);
    if (stage === undefined) {
      continue;
    }
    const trace = transmissionTraceFor(stage, event);
    if (trace === undefined) {
      continue;
    }
    const id = plotTransmissionId(stage.id, trace.index);
    if (seen.has(id)) {
      continue;
    }
    const channel = draft.channels[event.channel];
    if (channel === undefined || !isInterceptableKind(channel.kind)) {
      continue;
    }
    const carried = stageTransmissionPropositions(props, stage);
    if (carried.length === 0) {
      continue;
    }
    seen.add(id);
    out.push({
      id,
      channel: channel.id,
      at: event.at,
      ownerKind: 'cell',
      origin: 'plot',
      propositions: carried,
    });
  }
  return out;
}

/**
 * The Cell's routine traffic for the day: every interceptable Channel a Cell
 * member owns that fires today carries one detail of the operation's next step
 * (drawn from the next unexecuted stage's key facts, {@link stagePropositions},
 * excluding the intent facts `PLANS`/`TARGETS`), signed with the sender's
 * membership. On the day before a step executes, and on the day itself, the
 * traffic also carries the go-order: the leader's `PLANS`/`TARGETS`. A Cell
 * running an operation talks; this
 * is the traffic the Station's antenna hears and the Workbench breaks. Its
 * content follows the operation, so signal evidence builds up as the Plot
 * advances rather than being on the air from day one. Nothing is sent once the
 * Plot has stopped running.
 */
/**
 * The intent a step's orders carry: the plan (`PLANS`) always, and the target
 * (`TARGETS`) only from the operation's midpoint stage on. Early steps are
 * preparation; the Cell names its target once it commits to it.
 */
function intentFor(
  pool: readonly Proposition[],
  stages: readonly StageState[],
  stage: StageState,
): Proposition[] {
  const ordered = [...stages].sort((a, b) => compareTime(a.deadline, b.deadline));
  const index = ordered.findIndex((s) => s.id === stage.id);
  const committed = index >= Math.floor(ordered.length / 2);
  return pool.filter(
    (p) => p.predicate === 'PLANS' || (committed && p.predicate === 'TARGETS'),
  );
}

/** How many days before a stage executes the Cell sends its go-order. */
const GO_ORDER_LEAD_DAYS = 1;

function routineCellTraffic(draft: WorldState, ctx: WorldHookContext): InterceptSource[] {
  if (draft.plot.status !== 'running') {
    return [];
  }
  const next = [...draft.plot.stages]
    .filter((stage) => stage.status !== 'executed')
    .sort((a, b) => compareTime(a.deadline, b.deadline))[0];
  if (next === undefined) {
    return [];
  }
  const pool = plotOperationPropositions(draft, ctx.deps);
  if (pool.length === 0) {
    return [];
  }
  const members = cellMembers(draft);
  const day = ctx.time.day;
  const out: InterceptSource[] = [];
  const channels = (Object.values(draft.channels) as Channel[])
    .filter((c) => isInterceptableKind(c.kind) && members.has(c.owner))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const channel of channels) {
    const { start, period, phase } = channel.schedule;
    if (day < start.day || (day - start.day) % period !== 0) {
      continue;
    }
    const at: GameTime = { day, phase };
    const sender = pool.filter((p) => p.predicate === 'MEMBER_OF' && p.subject === channel.owner);
    // One detail of the next step per message, drawn on the runtime stream.
    // The operation's intent (PLANS/TARGETS) is never in routine traffic: it
    // goes out only in the stage transmission that sets a step in motion.
    const details = stagePropositions(pool, next).filter(
      (p) => !sender.includes(p) && p.predicate !== 'PLANS' && p.predicate !== 'TARGETS',
    );
    const detail = details.length === 0 ? [] : [details[ctx.rng.int(0, details.length - 1)]];
    // The go-order: on the day before a step executes (or that day), the
    // traffic also carries the leader's intent.
    const goOrder =
      next.deadline.day - day <= GO_ORDER_LEAD_DAYS
        ? intentFor(pool, draft.plot.stages, next)
        : [];
    out.push({
      id: cellTrafficTransmissionId(channel.id, at),
      channel: channel.id,
      at,
      ownerKind: 'cell',
      origin: 'plot',
      propositions: [...sender, ...detail, ...goOrder],
    });
  }
  return out;
}

/** The stage a Plot `transmission` event came from, read off its `plot` origin. */
function stageOfTransmission(
  draft: WorldState,
  event: Extract<SimEvent, { readonly kind: 'transmission' }>,
): StageState | undefined {
  const origin = revealTruth(event.origin);
  if (origin.kind !== 'plot') {
    return undefined;
  }
  return draft.plot.stages.find((stage) => stage.id === origin.stage);
}

/**
 * The `transmission` trace of `stage` whose minted Intercept id matches the
 * event's `intercept` field. The `transmission` SimEvent references its
 * Intercept by {@link plotTransmissionId}'s Intercept id, so the trace is the
 * one whose index reproduces it.
 */
function transmissionTraceFor(
  stage: StageState,
  event: Extract<SimEvent, { readonly kind: 'transmission' }>,
): StageTrace | undefined {
  return stage.traces.find(
    (trace) =>
      trace.kind === 'transmission' &&
      plotTraceInterceptId(stage.id, trace.index) === event.intercept,
  );
}

/**
 * The Plot's operation Propositions: the Truth Store facts about the Cell
 * members (the leader, the bound role holders and the Cell org's NPCs). This is
 * the same pool world assembly carried onto each Plot transmission trace. With
 * no Truth Store (an early caller that has not staged a draft) the pool is
 * empty and no Plot transmission is minted here — world assembly already seeded
 * the opening days' traffic.
 */
function plotOperationPropositions(
  draft: WorldState,
  deps: AdvanceWorldDeps,
): readonly Proposition[] {
  const truth = deps.truth;
  if (truth === undefined) {
    return [];
  }
  const members = cellMembers(draft);
  const byId = new Map<string, Proposition>();
  for (const fact of truth.facts()) {
    const prop = revealTruth(fact);
    if (members.has(prop.subject) && !byId.has(prop.id)) {
      byId.set(prop.id, prop);
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}


/**
 * The Cell members, as a set of entity ids: the Plot leader, every bound role
 * holder and every NPC whose org is the Cell org.
 */
function cellMembers(draft: WorldState): ReadonlySet<EntityId> {
  const out = new Set<EntityId>([revealTruth(draft.plot.leader)]);
  for (const role of draft.plot.roles) {
    if (role.npc !== undefined) {
      out.add(role.npc);
    }
  }
  const cellOrg = cellOrgId(draft);
  if (cellOrg !== undefined) {
    for (const npc of Object.values(draft.npcs)) {
      if (npc.org === cellOrg) {
        out.add(npc.id);
      }
    }
  }
  return out;
}

/** The Cell org id, if the world has one. */
function cellOrgId(draft: WorldState): OrgId | undefined {
  for (const org of Object.values(draft.orgs)) {
    if (org.kind === 'cell') {
      return org.id;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// schedules hook (Req 2.4, 5.1)
// ---------------------------------------------------------------------------

/**
 * The `schedules` hook. Emits the boundary `npc-moved` moves across the night→
 * morning transition into the new day and writes `whereabouts`, pinning
 * out-of-play NPCs where they are held; rolls the day's Walk-in on the daily
 * stream and, when one occurs, gives the Walk-in NPC a Contact Channel with the
 * Station (`relationships[npc].channel = true` and `player.contacts`, Req 2.4);
 * and stores the day's events into `scratch.dayEvents` for the Hostile tick.
 */
const schedulesHook: WorldHook = (draft, ctx) => {
  const events: SimEvent[] = [];

  // 1. Boundary moves and whereabouts. The clock fires this hook at phase 0 of
  //    the new day; the transition into it is from the last phase of the day
  //    before. Day 0 has no previous day, so no boundary move.
  const boundary = boundaryMoves(draft, ctx.time);
  events.push(...boundary.events);
  let state: WorldState =
    boundary.whereabouts === undefined
      ? draft
      : { ...draft, whereabouts: boundary.whereabouts };

  // 2. The day's Walk-in on the daily stream (unchanged from the slice).
  const daily = createPrng(ctx.dailyStreamSeed);
  const walkIn = rollDailyWalkIn(state, daily, ctx.time);
  events.push(...walkIn.events);
  if (walkIn.npc !== undefined) {
    state = withContactChannel(state, walkIn.npc);
  }

  // 3. Hand the day's events to the Hostile tick (assigned, not mutated).
  ctx.scratch.dayEvents = events;

  return { state, events };
};

/** A Walk-in roll outcome: the events, and the NPC who approached (if any). */
interface WalkInOutcome {
  readonly events: readonly SimEvent[];
  readonly npc?: NpcId;
}

/**
 * Roll the day's Walk-in on the daily stream, deferring to the slice's
 * {@link rollWalkIn} so the draw order and defaults are unchanged. The eligible
 * pool is the Draft's NPCs.
 */
function rollDailyWalkIn(
  draft: WorldState,
  prng: Prng,
  at: GameTime,
): WalkInOutcome {
  const result = rollWalkIn(prng, draft.npcs, at);
  return { events: result.events, npc: result.npc };
}

/**
 * Give an NPC a Contact Channel with the Station: add them to `player.contacts`
 * (membership of which is the slice's Contact Channel) and set
 * `relationships[npc].channel = true` so the Walk-in is taskable once
 * recruited. Idempotent: an NPC already a contact is not added twice.
 */
function withContactChannel(draft: WorldState, npc: NpcId): WorldState {
  const contacts = draft.player.contacts.includes(npc)
    ? draft.player.contacts
    : [...draft.player.contacts, npc];
  const rel = draft.relationships[npc] ?? newRelationship(npc);
  return {
    ...draft,
    player: { ...draft.player, contacts },
    relationships: {
      ...draft.relationships,
      [npc]: { ...rel, channel: true },
    },
  };
}

/**
 * The boundary `npc-moved` events across the night→morning transition and the
 * `whereabouts` they leave, pinning out-of-play NPCs. Mirrors the Phase Step's
 * schedule sub-step: a free NPC moves to its scheduled Location at the new day,
 * a pinned NPC is held where {@link pinnedWhereabouts} says, and a move is
 * emitted only for a free NPC that was recorded at the Location its schedule
 * had it at the previous night, so the move's `from`/`to` match the record.
 */
function boundaryMoves(
  draft: WorldState,
  to: GameTime,
): {
  readonly events: readonly SimEvent[];
  readonly whereabouts: Record<NpcId, LocId | 'absent'> | undefined;
} {
  if (to.day <= 0) {
    return { events: [], whereabouts: undefined };
  }
  const from: GameTime = { day: to.day - 1, phase: 3 };

  const free: Record<NpcId, Npc> = {};
  let whereabouts: Record<NpcId, LocId | 'absent'> | undefined;
  for (const id of (Object.keys(draft.npcs) as NpcId[]).sort()) {
    const npc = draft.npcs[id];
    const pin = pinnedWhereabouts(draft, id, to);
    if (pin === undefined) {
      free[id] = npc;
    }
    const place = pin ?? scheduledLocationAt(npc, to) ?? 'absent';
    if (draft.whereabouts[id] !== place) {
      whereabouts ??= { ...draft.whereabouts };
      whereabouts[id] = place;
    }
  }

  const recordedAtFrom = (id: NpcId): LocId | 'absent' =>
    draft.whereabouts[id] ?? scheduledLocationAt(draft.npcs[id], from) ?? 'absent';
  const events = advanceSchedules(free, from, to).filter(
    (event) =>
      event.kind !== 'npc-moved' || recordedAtFrom(event.npc) === event.from,
  );

  return { events, whereabouts };
}

// ---------------------------------------------------------------------------
// hostileTick hook (Req 3.1, 4.5, 5.1)
// ---------------------------------------------------------------------------

/**
 * The `hostileTick` hook. Runs the Hostile Full Tick on the runtime stream —
 * `applyFullTick(dailyTickFull(projectFullTick(…), ctx.rng))` (Req 3.1) — then
 * runs the abort check again, so a belief the tick's adaptation adopted or a
 * seizure it recorded can abort the Plot (Req 4.5).
 */
const hostileTickHook: WorldHook = (draft, ctx) => {
  const projection = projectFullTick(draft, ctx.time.day, ctx.scratch, ctx.deps);
  const result = dailyTickFull(
    projection.state,
    projection.candidates,
    ctx.time,
    ctx.rng,
    projection.base,
    projection.inputs,
  );
  const applied = applyFullTick(draft, result, ctx.scratch, ctx);

  const abort = worldAbortCheck(applied.state, ctx.time);
  return {
    state: abort.state,
    events: [...applied.events, ...abort.events],
  };
};

// ---------------------------------------------------------------------------
// newspaper hook (Req 2.5, 3.8, 5.1)
// ---------------------------------------------------------------------------

/**
 * The `newspaper` hook. Composes the day's edition from `dailyMaterial(day)`
 * plus the scratch's newspaper plants and arrest articles (Req 3.8) on the
 * daily stream, writes the composed Document, its Propositions,
 * `newspapers[day]` and the Document's obtainable Locations, and emits the
 * player-visible `newspaper` event (Req 2.5).
 *
 * The city-event filler is built from no weather summary here — `advanceWorld`
 * owns the weather `day-start` event; the edition's "around the city" article
 * uses the neutral phrase `dailyMaterial` falls back to. The Plot and Side
 * Thread public traces are left to a later spec's richer material; the slice's
 * edition prints the city filler, the day's plants and the arrest articles,
 * which is what the Hostile tick produced for this day.
 */
const newspaperHook: WorldHook = (draft, ctx) => {
  const template = newspaperTemplate(ctx.deps);
  if (template === undefined) {
    return { state: draft, events: [] };
  }

  const material = dailyMaterial(
    ctx.time.day,
    undefined,
    [],
    [],
    [],
  );
  const withPlants = {
    ...material,
    // The Hostile tick's planted sightings read as rumours (false), its arrest
    // articles as city events (public, true-but-withholding). Both ride the
    // day's edition.
    rumours: [...material.rumours, ...ctx.scratch.newspaperPlants],
    cityEvents: [...material.cityEvents, ...ctx.scratch.arrestArticles],
  };

  const namer: NamerContext = {
    city: draft.city,
    npcs: draft.npcs,
    orgs: draft.orgs,
  };
  const daily = createPrng(ctx.dailyStreamSeed);
  const composed = composeNewspaper(
    template,
    withPlants,
    { ...namer, date: ctx.time },
    daily,
  );

  const obtainableAt = publicTextLocations(draft.city);
  const document =
    obtainableAt.length > 0
      ? { ...composed.document, obtainableAt }
      : composed.document;

  const documentPropositions = { ...draft.documentPropositions };
  for (const prop of composed.propositions) {
    documentPropositions[prop.id] = prop;
  }

  const event: SimEvent = {
    id: `news-evt:${ctx.time.day}` as SimEvent['id'],
    at: ctx.time,
    visibility: 'player',
    kind: 'newspaper',
    doc: document.id as DocId,
  };

  return {
    state: {
      ...draft,
      documents: { ...draft.documents, [document.id]: document },
      documentPropositions,
      newspapers: { ...draft.newspapers, [ctx.time.day]: document.id as DocId },
    },
    events: [event],
  };
};

/** The first `newspaper`-kind Document template in the content set, if any. */
function newspaperTemplate(deps: AdvanceWorldDeps) {
  for (const [, template] of deps.content.documentTemplates) {
    if (template.kind === 'newspaper') {
      return template;
    }
  }
  return undefined;
}
