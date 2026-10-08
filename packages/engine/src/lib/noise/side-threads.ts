/**
 * Side Threads: step 2 of the world generator's **noise** stream (design,
 * "Noise Generator", step 2; Requirement 29.2).
 *
 * The core generator (`../generate.ts`) builds and verifies the world — the
 * city, the orgs, the Principal NPCs, the Plot, comms and knowledge — on the
 * core PRNG stream. The noise generator then runs on a *separate* stream
 * (`derive(seed, 0x10000)`, {@link import('../generate.js').NOISE_STREAM_BASE})
 * and only ever *adds* entities and beliefs; it never mutates core entities
 * (design: "Noise only adds entities and beliefs"). This module owns the second
 * of those additions — the Side Threads — as a pure, standalone generator. Task
 * 6.4 wires it (and the other noise steps) into `generate()`'s noise stream;
 * this module does not touch `generate.ts`.
 *
 * A **Side Thread** is a self-contained minor storyline that is *not* the Plot
 * and has *no* Cell members (design, step 2; Requirement 29.2). Its job is to
 * generate plausible-but-irrelevant traces so the player must distinguish the
 * signal (the Plot) from the noise. The core pack's `side-threads.yaml` authors
 * these as templates — a penicillin-smuggling racket, a sector-crossing love
 * affair — reusing the Plot-template shape but naming only civilian and contact
 * archetypes, never a Cell role (the loader enforces that no role-slot id
 * contains `cell`, see `SideThreadTemplateSchema`).
 *
 * Each generated Side Thread carries, exactly as the design's step 2 lists:
 *
 * - **participants** — a small cast drawn from the available *non-Cell*
 *   characters: the Background NPCs (task 6.1) and the non-Cell Principal NPCs
 *   (the Chief, Station staff and starting contacts). The Cell members and the
 *   hostile officers from {@link GeneratedPrincipals} are excluded, so a Side
 *   Thread never puts a Plot/Cell actor on a noise storyline;
 * - its own true **Propositions** — city/local-level facts about its
 *   participants and the public Locations they frequent, using the Predicate
 *   Vocabulary (`LOCATED_AT`, `MEETS_AT`) in the same style as the Background
 *   NPCs' local slice. These are true facts the thread *really* produces — the
 *   noise the player has to rule out — not Rumours (task 6.3 adds those);
 * - its own **traces** — meeting/movement observations rendered from the
 *   template's stage trace templates, each pinned to a public Location, so the
 *   thread emits watchable activity;
 * - its own **Channel(s)** — noise traffic owned by a Side-Thread *participant*
 *   (never the Cell, the Station or the Hostile Service), reusing the engine's
 *   {@link Channel} shape and the same `kind`/`owner`/`schedule` conventions
 *   `generateComms` builds core channels with. A Side Thread's channel is the
 *   kind of chatter that looks like a courier line until the player works out it
 *   is only two people in love.
 *
 * Every id the module mints lives in a distinct space so it cannot collide with
 * a core entity: Side Thread ids are `thread:<n>` ({@link ThreadId}); a thread's
 * Channel ids are `chan:thread/<n>/<tag>`, namespaced under `thread/` so they
 * never clash with the core comms ids `generateComms` mints (`chan:<owner>/…`);
 * every participant ref is an existing Background- or Principal-NPC id, and
 * every Location ref is a public Location of the generated city.
 *
 * Determinism rests on drawing every choice from the passed {@link Prng} in a
 * fixed order over id-sorted lists, exactly as the city, principal, Plot, comms
 * and Background-NPC generators do, so the result is a pure function of the
 * noise seed and the content (Requirement 1.2, underpinning Property 1 — seed
 * determinism; Requirement 29.5 — the noise stream is independent of the core).
 */

import {
  type EntityId,
  type GameTime,
  type ItemId,
  type LocId,
  type NpcId,
  type Phase,
  type Proposition,
  type PropId,
  type Truth,
} from '../model/core.js';
import {
  type TraceChannelKind,
  type TraceKind,
} from '../city/plot.js';
import { type Prng } from '../prng/prng.js';
import { type City, type Location } from '../city/city.js';
import { type Npc } from '../city/npc.js';
import {
  CELL_ROLE_IDS,
  HOSTILE_ROLE_IDS,
  type GeneratedPrincipals,
} from '../city/principals.js';
import {
  CHANNEL_KINDS,
  MAX_CHANNEL_PERIOD,
  MIN_CHANNEL_PERIOD,
  type Channel,
  type ChannelKind,
  type ChannelSchedule,
} from '../city/comms.js';
import type {
  ContentSet,
  SideThreadTemplate,
  TraceTemplate,
} from '@tradecraft/content';

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * A Side Thread id. The design leaves a Side Thread id an opaque reference (it
 * appears in {@link import('../model/state.js').TraceOrigin} as
 * `{ kind: 'side-thread'; thread: ThreadId }`); this module gives it a distinct
 * `thread:` namespace so a Side Thread id reads back to its origin and cannot be
 * mistaken for an {@link EntityId}, a Plot {@link
 * import('../city/plot.js').StageId} (`stage:…`) or a Channel id. Replaces the
 * task-4.6 skeleton `ThreadId` (a bare string) under the same name.
 */
export type ThreadId = `thread:${string}`;

/** Mint a Side Thread id from its index: `thread:<n>`. */
function threadIdOf(index: number): ThreadId {
  return `thread:${index}`;
}

// ---------------------------------------------------------------------------
// SideThreadState
// ---------------------------------------------------------------------------

/**
 * One observable trace a Side Thread emits (the noise analogue of the Plot's
 * {@link import('../city/plot.js').StageTrace}). It keeps the template string
 * the trace renders from, the stage id it came from, and the *public* Location
 * it is pinned to, so task 6.4 / 7.x can turn it into a concrete Sim event
 * tagged with a `side-thread` {@link import('../model/state.js').TraceOrigin}.
 * The `participants` are the subset of the thread's cast the trace involves,
 * for rendering a who/where line.
 */
export interface SideThreadTrace {
  /** A stable index within the thread, for ordering and ids. */
  readonly index: number;
  /** The template's stage id this trace belongs to. */
  readonly stage: string;
  /** The Sim event kind this trace declares (from the template). */
  readonly kind: TraceKind;
  /** The prose summary (the template's `text`); task 26.2 emits the bound event. */
  readonly template: string;
  /** The public Location the trace is observed at. */
  readonly loc: LocId;
  /** The thread participants the trace involves (bound role holders). */
  readonly participants: readonly NpcId[];
  /** The transmission/courier Channel kind the template named, if any. */
  readonly channelKind?: TraceChannelKind;
  /** The bound materiel item the trace carries, if the template named one. */
  readonly materiel?: ItemId;
  /** The predicate ids the event makes observable (from the template). */
  readonly evidences: readonly string[];
}

/**
 * A Side Thread's running state (the design's Side Thread, the element of
 * `WorldState.sideThreads`). It replaces the task-4.6 skeleton placeholder in
 * `../model/state.ts` in place, under the same name, so every importer keeps
 * compiling.
 *
 * A Side Thread is unbranded Sim structure, not a Player View projection: the
 * player learns of it only by observing its traces and intercepting its Channel,
 * then has to work out it is noise — exactly as a Plot's stage DAG and the City
 * are structure the Sim runs against rather than truth projected to the player.
 * It carries:
 *
 * - its minted {@link ThreadId} and the `template` id it was instantiated from;
 * - its `participants` — the non-Cell cast (Background and/or non-Cell Principal
 *   NPCs). No Cell member or hostile officer ever appears here;
 * - its true `propositions` — city/local facts the thread really produces;
 * - its `traces` — the watchable activity it emits; and
 * - its `channels` — the noise-traffic Channels it owns, each owned by one of
 *   its own participants.
 */
export interface SideThreadState {
  /** The minted Side Thread id (`thread:<n>`). */
  readonly id: ThreadId;
  /** The id of the Side Thread template this thread was instantiated from. */
  readonly template: string;
  /** The thread's cast: Background and/or non-Cell Principal NPCs only. */
  readonly participants: readonly NpcId[];
  /** The true, city/local-level Propositions the thread produces. */
  readonly propositions: readonly Proposition[];
  /** The observable traces the thread emits, each at a public Location. */
  readonly traces: readonly SideThreadTrace[];
  /** The noise-traffic Channels the thread owns (owned by its participants). */
  readonly channels: readonly Channel[];
  /** Set when ambient spawned the thread during play. Slice threads omit it. */
  readonly origin?: Truth<'emergent'>;
}

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/** The output of {@link generateSideThreads}. */
export interface GeneratedSideThreads {
  /** The Side Threads in generation order, as `WorldState.sideThreads` holds them. */
  readonly sideThreads: readonly SideThreadState[];
  /**
   * Every Side-Thread Channel keyed by id, as `WorldState.channels` holds them.
   * Task 6.4 folds these into the world's channel record alongside the core
   * comms channels; the ids are namespaced `chan:thread/…` so they never
   * collide with a core channel.
   */
  readonly channels: Readonly<Record<string, Channel>>;
}

// ---------------------------------------------------------------------------
// Count defaults
// ---------------------------------------------------------------------------

/**
 * The Side-Thread count a preset that does not set one falls back to. The real
 * count comes from the Difficulty Preset's `noiseCounts.sideThreads`
 * (Requirement 34.2); task 6.4 reads it from the resolved preset and passes it
 * to {@link generateSideThreads}. These bounds document a reasonable band for
 * callers (such as tests) that have no preset in hand.
 */
export const MIN_SIDE_THREADS = 0;
/** A sensible default Side-Thread count when no preset count is supplied. */
export const DEFAULT_SIDE_THREADS = 2;

/** The id prefix every Side Thread carries. */
export const THREAD_ID_PREFIX = 'thread';

/** The smallest and largest participant cast a Side Thread is given. */
export const MIN_THREAD_PARTICIPANTS = 2;
export const MAX_THREAD_PARTICIPANTS = 4;

// ---------------------------------------------------------------------------
// Non-Cell participant pool
// ---------------------------------------------------------------------------

/**
 * The set of archetype local ids that identify a Cell member or a hostile
 * officer — the actors a Side Thread must never involve (design, step 2;
 * Requirement 29.2). Built from {@link CELL_ROLE_IDS} and
 * {@link HOSTILE_ROLE_IDS}, the same source the comms generator reads.
 */
const EXCLUDED_ARCHETYPES: ReadonlySet<string> = new Set<string>([
  ...CELL_ROLE_IDS,
  ...HOSTILE_ROLE_IDS,
]);

/** The archetype roles a Side Thread participant may *not* hold. */
const EXCLUDED_ROLES: ReadonlySet<string> = new Set<string>([
  'cell',
  'hostile-officer',
]);

/** The bare local id of a (possibly namespaced `<pack>/<name>`) archetype id. */
function localArchetypeId(archetype: string): string {
  const slash = archetype.lastIndexOf('/');
  return slash === -1 ? archetype : archetype.slice(slash + 1);
}

/**
 * True when an NPC is eligible to appear in a Side Thread: it is neither a Cell
 * member nor a hostile officer, by either its role or its archetype. Background
 * NPCs (civilian role) and non-Cell Principals (the Chief, staff, contacts)
 * pass; the Plot/hostile roster is filtered out.
 */
export function isSideThreadEligible(npc: Npc): boolean {
  if (EXCLUDED_ROLES.has(npc.role)) {
    return false;
  }
  return !EXCLUDED_ARCHETYPES.has(localArchetypeId(npc.archetype));
}

/**
 * The id-sorted pool of non-Cell, non-hostile NPCs a Side Thread draws its cast
 * from: the Background NPCs (task 6.1) and the eligible Principal NPCs, merged
 * and de-duplicated by id. Sorting by id makes a draw against the pool a pure
 * function of the inputs regardless of record order.
 */
export function sideThreadParticipantPool(
  principals: GeneratedPrincipals,
  background: Readonly<Record<NpcId, Npc>>,
): Npc[] {
  const byId = new Map<NpcId, Npc>();
  for (const npc of Object.values(principals.npcs)) {
    if (isSideThreadEligible(npc)) {
      byId.set(npc.id, npc);
    }
  }
  for (const npc of Object.values(background)) {
    if (isSideThreadEligible(npc)) {
      byId.set(npc.id, npc);
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Template choice
// ---------------------------------------------------------------------------

/**
 * The Side Thread templates in the content set, id-sorted so the draw order is a
 * pure function of the content. The core pack ships at least two
 * (Requirement 31.7).
 */
export function sideThreadTemplates(content: ContentSet): SideThreadTemplate[] {
  return [...content.sideThreadTemplates.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

// ---------------------------------------------------------------------------
// Public Locations
// ---------------------------------------------------------------------------

/** The public Locations of a city, id-sorted, for deterministic trace pinning. */
function publicLocations(city: City): Location[] {
  return Object.values(city.locations)
    .filter((l) => l.public)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Slugging and id minting (mirrors ../city/comms.ts and ../noise/background.ts)
// ---------------------------------------------------------------------------

/** Turn an arbitrary tag into a slug-safe id fragment. */
function slug(value: string): string {
  const s = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'x';
}

/**
 * Mint a Channel id for a Side Thread, namespaced under `thread/` so it never
 * collides with a core comms channel (`chan:<owner>/<tag>`): `chan:thread/<n>/<tag>`.
 */
function threadChannelId(threadIndex: number, tag: string): string {
  return `chan:thread/${threadIndex}/${slug(tag)}`;
}

/** Mint a stable PropId for a Side-Thread fact: `prop:thread/<n>/<tag>`. */
function threadPropId(threadIndex: number, tag: string): PropId {
  return `prop:thread/${threadIndex}/${slug(tag)}`;
}

/** Mint a stable materiel ItemId for a Side Thread: `item:thread/<n>/<slot>`. */
function threadItemId(threadIndex: number, slotId: string): ItemId {
  return `item:thread/${threadIndex}/${slug(slotId)}` as ItemId;
}

/** The bare local id of a (possibly namespaced `<pack>/<name>`) content id. */
function localTypeId(type: string): string {
  const slash = type.lastIndexOf('/');
  return slash === -1 ? type : type.slice(slash + 1);
}

/**
 * Resolve a template trace's `roles` to bound cast members (deduped, in
 * template order). When the trace names no role that binds to the cast, fall
 * back to one or two drawn cast members so the trace still involves real
 * participants — a pair when the cast allows (the common meeting case), else
 * the one. The draw mirrors the original cast-pairing so the stream order and
 * determinism hold.
 */
function resolveThreadRoles(
  trace: TraceTemplate,
  roleToNpc: ReadonlyMap<string, NpcId>,
  participants: readonly NpcId[],
  prng: Prng,
): NpcId[] {
  const bound: NpcId[] = [];
  for (const role of trace.roles) {
    const npc = roleToNpc.get(role);
    if (npc !== undefined && !bound.includes(npc)) {
      bound.push(npc);
    }
  }
  if (bound.length > 0) {
    return bound;
  }

  // Fallback: draw one or two distinct cast members.
  if (participants.length >= 2) {
    const a = prng.pick(participants);
    let b = prng.pick(participants);
    let guard = 0;
    while (b === a && guard < participants.length) {
      b = prng.pick(participants);
      guard += 1;
    }
    return b === a ? [a] : [a, b];
  }
  return [participants[0]];
}

/**
 * Resolve a template trace's `place` to a public Location: a public Location of
 * the named Location Type when the trace named one and the city has it, else a
 * drawn public Location (the fallback for a `target` place or an unstocked
 * type). Always returns a public Location, since the caller guards on a
 * non-empty public list.
 */
function resolveThreadLocation(
  trace: TraceTemplate,
  publicsByType: ReadonlyMap<string, readonly Location[]>,
  publics: readonly Location[],
  prng: Prng,
): LocId {
  if (trace.place !== undefined && 'locationType' in trace.place) {
    const candidates = publicsByType.get(localTypeId(trace.place.locationType));
    if (candidates !== undefined && candidates.length > 0) {
      return prng.pick([...candidates]).id;
    }
  }
  return prng.pick(publics).id;
}

// ---------------------------------------------------------------------------
// Schedule drawing (mirrors ../city/comms.ts drawSchedule)
// ---------------------------------------------------------------------------

/**
 * Draw a well-formed {@link ChannelSchedule} on the noise stream, exactly as
 * `generateComms` draws core channel schedules: a period in
 * `[MIN_CHANNEL_PERIOD, MAX_CHANNEL_PERIOD]` days, a start day within the first
 * `period` days, and a phase drawn from the four. The firing phase is the
 * start's phase, so `isWellFormedSchedule` holds.
 */
function drawSchedule(prng: Prng, start: GameTime): ChannelSchedule {
  const period = prng.int(MIN_CHANNEL_PERIOD, MAX_CHANNEL_PERIOD);
  const dayOffset = prng.int(0, period - 1);
  const phase = prng.int(0, 3) as Phase;
  return {
    period,
    start: { day: start.day + dayOffset, phase },
    phase,
  };
}

/**
 * The noise-channel kinds a Side Thread's traffic may take. A Side Thread is
 * civilian chatter, so it leans on the everyday kinds — a `courier` run (a note
 * passed hand to hand) or a `radio`/`numbers` murmur that reads like signal
 * until ruled out — never a `dead-drop` exchange (which is operational tradecraft
 * the Cell and the Hostile Service use). Drawn id-stably from {@link
 * CHANNEL_KINDS}.
 */
const NOISE_CHANNEL_KINDS: readonly ChannelKind[] = CHANNEL_KINDS.filter(
  (k) => k !== 'dead-drop',
);

// ---------------------------------------------------------------------------
// Building one Side Thread
// ---------------------------------------------------------------------------

/**
 * Build one Side Thread from a template and the shared participant pool.
 *
 * The draw order per thread is fixed so the result is a pure function of the
 * noise stream:
 *
 * 1. the **cast** — a size in `[MIN_THREAD_PARTICIPANTS,
 *    MAX_THREAD_PARTICIPANTS]` (clamped to the pool), then that many distinct
 *    participants drawn from the id-sorted pool by a shuffled prefix;
 * 2. the **traces** — one per stage trace template, each pinned to a drawn
 *    public Location and attributed to a drawn pair (or single) of the cast;
 * 3. the **propositions** — a `LOCATED_AT` per (participant, trace Location) and
 *    a `MEETS_AT` per trace that involves a pair, all true city/local facts;
 * 4. the **channel** — one noise-traffic Channel owned by the first cast member,
 *    of a drawn non-dead-drop kind, with a drawn schedule (and a drawn route
 *    Location when it is a courier run).
 *
 * When the pool is too thin to seat `MIN_THREAD_PARTICIPANTS`, the thread takes
 * whatever the pool offers (possibly empty); when the city has no public
 * Location, traces and propositions that need one are skipped — the thread still
 * carries its cast and a channel, and the caller's count is honoured.
 */
function buildSideThread(
  prng: Prng,
  template: SideThreadTemplate,
  index: number,
  pool: readonly Npc[],
  publics: readonly Location[],
  start: GameTime,
): SideThreadState {
  const id = threadIdOf(index);

  // 1. Cast: a size in range (clamped to the pool), drawn as a shuffled prefix
  //    of the id-sorted pool so the members are distinct and deterministic.
  const target = prng.int(MIN_THREAD_PARTICIPANTS, MAX_THREAD_PARTICIPANTS);
  const castSize = Math.min(target, pool.length);
  const participants: NpcId[] =
    castSize === 0 ? [] : prng.shuffle(pool).slice(0, castSize).map((n) => n.id);

  // 1b. Bind the template's role slots to the cast. Each role-slot id maps to a
  //     distinct cast member where the cast allows (cycling the cast when the
  //     template names more roles than the thread seats), so a trace's `roles`
  //     resolve to real thread participants. Materiel slots mint stable ids.
  const roleToNpc = new Map<string, NpcId>();
  template.roleSlots.forEach((slot, i) => {
    if (participants.length > 0) {
      roleToNpc.set(slot.id, participants[i % participants.length]);
    }
  });
  const materielToItem = new Map<string, ItemId>();
  for (const slot of template.materielSlots) {
    materielToItem.set(slot.id, threadItemId(index, slot.id));
  }

  // Public Locations grouped by their bare Location Type id, for binding a
  // trace's `place.locationType` to a concrete public Location.
  const publicsByType = new Map<string, Location[]>();
  for (const loc of publics) {
    const key = localTypeId(loc.type);
    const list = publicsByType.get(key);
    if (list === undefined) {
      publicsByType.set(key, [loc]);
    } else {
      list.push(loc);
    }
  }

  // 2. Traces: one per structured template trace, bound to cast members and a
  //    public Location. Collect the (participant, loc) sightings and the (pair,
  //    loc) meetings as we go, so the propositions mirror the traces.
  const traces: SideThreadTrace[] = [];
  const sightings: Array<{ npc: NpcId; loc: LocId }> = [];
  const meetings: Array<{ a: NpcId; b: NpcId; loc: LocId }> = [];

  let traceIndex = 0;
  for (const stage of template.stages) {
    for (const tt of stage.traces) {
      if (publics.length === 0 || participants.length === 0) {
        continue;
      }

      // Participants: the template's bound roles, deduped. Fall back to a drawn
      // cast member when the trace named no (bound) role, so a trace always has
      // someone and the spec's "names only cast participants" holds.
      const involved = resolveThreadRoles(tt, roleToNpc, participants, prng);

      // Location: prefer a public Location of the trace's named Location Type;
      // otherwise (a target place, or an unstocked type) draw any public one.
      const loc = resolveThreadLocation(tt, publicsByType, publics, prng);

      const materiel =
        tt.materiel === undefined ? undefined : materielToItem.get(tt.materiel);

      traces.push({
        index: traceIndex,
        stage: stage.id,
        kind: tt.kind,
        template: tt.text,
        loc,
        participants: involved,
        ...(tt.channel !== undefined ? { channelKind: tt.channel } : {}),
        ...(materiel !== undefined ? { materiel } : {}),
        evidences: [...tt.evidences],
      });
      traceIndex += 1;

      if (involved.length === 2) {
        meetings.push({ a: involved[0], b: involved[1], loc });
      } else {
        sightings.push({ npc: involved[0], loc });
      }
    }
  }

  // 3. Propositions: true city/local facts mirroring the traces. A sighting is
  //    a LOCATED_AT (place optional per the vocabulary); a meeting is a
  //    MEETS_AT, which requires both a place and a time window — pin it to the
  //    thread's start so the window is well-formed. Ids are stable and scoped
  //    to the thread, so two threads never share a PropId.
  const propositions: Proposition[] = [];
  let sightingSeq = 0;
  for (const { npc, loc } of sightings) {
    propositions.push({
      id: threadPropId(index, `located/${sightingSeq}/${npc}`),
      subject: npc,
      predicate: 'LOCATED_AT',
      object: npc,
      place: loc,
    });
    sightingSeq += 1;
  }
  let meetingSeq = 0;
  for (const { a, b, loc } of meetings) {
    propositions.push({
      id: threadPropId(index, `meets/${meetingSeq}/${a}/${b}`),
      subject: a,
      predicate: 'MEETS_AT',
      object: b,
      place: loc,
      window: { from: start },
    });
    meetingSeq += 1;
  }

  // 4. Channel: one noise-traffic Channel owned by a participant (the first cast
  //    member when the thread has one), of a drawn non-dead-drop kind. A courier
  //    run names a public Location as its route, mirroring generateComms.
  const channels: Channel[] = [];
  if (participants.length > 0) {
    const owner = participants[0];
    const kind = prng.pick(NOISE_CHANNEL_KINDS);
    const schedule = drawSchedule(prng, start);
    const channel: Channel = {
      id: threadChannelId(index, 'traffic') as Channel['id'],
      kind,
      owner,
      schedule,
      ...(kind === 'courier' && publics.length > 0
        ? { route: prng.pick(publics).id }
        : {}),
    };
    channels.push(channel);
  }

  return {
    id,
    template: template.id,
    participants,
    propositions,
    traces,
    channels,
  };
}

// ---------------------------------------------------------------------------
// generateSideThreads
// ---------------------------------------------------------------------------

/**
 * Generate the Side Threads from the content set's Side Thread templates
 * (design, "Noise Generator", step 2; Requirement 29.2).
 *
 * `prng` must be the **noise** stream for the current attempt
 * (`derive(seed, 0x10000)`), independent of the core stream so changing noise
 * settings leaves the core world untouched (Requirement 29.5). `count` is the
 * Side-Thread count from the Difficulty Preset's `noiseCounts.sideThreads`; task
 * 6.4 reads it from the resolved preset. `principals` is the core-stream
 * Principal roster (its Cell members and hostile officers are *excluded* from
 * every thread's cast); `background` is the Background-NPC record from task 6.1
 * (its civilians are the main participant pool). `start` is the game's start
 * time, the floor for every channel schedule.
 *
 * The Side Thread templates are cycled in id-sorted order so the roster is a
 * pure function of the content and the count: with `k` templates, the `i`-th
 * thread is instantiated from template `i mod k`. Each thread gets a distinct
 * `thread:<i>` id, a non-Cell cast, its own true Propositions, traces at public
 * Locations and a noise-traffic Channel. The result is a pure function of the
 * noise seed, the city, the roster and the content.
 *
 * Throws if `count` is negative or non-integer (a programming error), or if a
 * positive count is requested while the content set defines no Side Thread
 * template (a pack gap the smoke tests should catch).
 */
export function generateSideThreads(
  prng: Prng,
  content: ContentSet,
  city: City,
  principals: GeneratedPrincipals,
  background: Readonly<Record<NpcId, Npc>>,
  count: number,
  start: GameTime,
): GeneratedSideThreads {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(
      `generateSideThreads(): count must be a non-negative integer, received ${String(count)}`,
    );
  }

  const templates = sideThreadTemplates(content);
  if (count > 0 && templates.length === 0) {
    throw new Error(
      'generateSideThreads(): the content set defines no Side Thread templates',
    );
  }

  const pool = sideThreadParticipantPool(principals, background);
  const publics = publicLocations(city);

  const sideThreads: SideThreadState[] = [];
  for (let i = 0; i < count; i += 1) {
    const template = templates[i % templates.length];
    sideThreads.push(buildSideThread(prng, template, i, pool, publics, start));
  }

  const channels: Record<string, Channel> = {};
  for (const thread of sideThreads) {
    for (const channel of thread.channels) {
      channels[channel.id] = channel;
    }
  }

  return { sideThreads, channels };
}

// ---------------------------------------------------------------------------
// Invariants (exported for tests / later tasks)
// ---------------------------------------------------------------------------

/**
 * True when none of the Side Thread's participants is a Cell member or a
 * hostile officer, given the Principal roster. The id sets come from
 * {@link GeneratedPrincipals.cell} and `.hostile` — the authoritative Cell and
 * hostile rosters — so this is the direct check of Requirement 29.2's "no Cell
 * participants".
 */
export function threadHasNoCellOrHostile(
  thread: SideThreadState,
  principals: GeneratedPrincipals,
): boolean {
  const forbidden = new Set<NpcId>([...principals.cell, ...principals.hostile]);
  return thread.participants.every((p) => !forbidden.has(p));
}

/** Every entity id a Side Thread's propositions name (subjects, objects, places). */
export function threadPropositionEntities(thread: SideThreadState): Set<EntityId> {
  const out = new Set<EntityId>();
  for (const p of thread.propositions) {
    out.add(p.subject);
    if (typeof p.object === 'string') {
      out.add(p.object);
    }
    if (p.place !== undefined) {
      out.add(p.place);
    }
  }
  return out;
}
