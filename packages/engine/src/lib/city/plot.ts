/**
 * The Plot: step 4 of the world generator's core stream (design, "World
 * Generator"; Requirements 1.1, 3.2, 3.3).
 *
 * This module owns both the running-state *shape* of a Plot — the real
 * {@link PlotState} and {@link StageState} interfaces that replace the skeleton
 * placeholder in `../model/state.ts` — and the pure {@link generatePlot} that
 * instantiates one from a Plot template.
 *
 * A Plot is the backbone of a generated game: the hostile operation the player
 * works to uncover and disrupt. The design (Clock/Plot section) fixes what a
 * Plot carries:
 *
 * - an ordered set of **Plot Stages**, each with `requires: PropId[]` and
 *   `produces: PropId[]` (the stage-graph edges), a concrete `deadline`
 *   ({@link GameTime}), the `traces` the stage emits as observable Sim events,
 *   and an `onDisrupted` weighting of the delay / reroute / abort response
 *   (doctrine-weighted — the template ships `{delay, reroute, abort}` weights
 *   the clock later draws against);
 * - the **materiel** the operation threads through its stages (an {@link
 *   ItemId}), its **leader** (the Cell leader {@link NpcId}) and its **target**
 *   (an {@link EntityId}: an NPC, Location or org).
 *
 * `generatePlot` is a pure function of the core PRNG stream, the loaded
 * {@link ContentSet}, the resolved {@link DifficultyPreset} and the generated
 * organisations and Principal NPCs (tasks 5.1, 5.2). It:
 *
 * 1. **chooses a Plot template** from `content.plotTemplates` with the PRNG;
 * 2. **binds each role slot** to a generated NPC — a slot naming the
 *    `cell-leader` archetype binds to the Cell leader NPC, `hostile-resident`
 *    to the hostile resident, and so on — so the roles the Plot runs through
 *    are the real people the player can surveil and turn;
 * 3. **mints an {@link ItemId} for each materiel slot** and binds each target
 *    slot to a concrete {@link EntityId} (an NPC, Location or org, chosen by the
 *    slot's apparent intent);
 * 4. **sizes the stage DAG** by the preset's `plot.stageCount`: the core
 *    templates ship five to six stages, and the preset guides how many run — a
 *    template with more stages than the preset asks for is clamped to a
 *    contiguous prefix (so the `requires`/`produces` chain stays rooted and
 *    connected), a template with fewer keeps all its stages;
 * 5. **computes each stage's concrete {@link GameTime} deadline** from the
 *    template's deadline *range* plus the preset's `deadlineSlackDays`,
 *    accumulated across the retained stages so later stages fall due later;
 * 6. **mints a {@link PropId} for each produced proposition** (per stage,
 *    deterministically) and threads the matching produced ids into the
 *    `requires` of the stages that name them, so the DAG's edges reference real
 *    minted ids rather than the template's bare content refs;
 * 7. **carries the trace templates and the `onDisrupted` weights** onto each
 *    retained stage, and **mints a {@link StageId}** per stage.
 *
 * The result is the Plot structure (the stage DAG, the role/materiel/target
 * bindings, the deadlines and the per-stage traces and weights) plus the
 * initial running state (`status: 'running'`, every stage `pending`). The
 * abort-pressure fields (`abortPressure`, `pressureKeys`, `abortCause`) are
 * owned by task 7.4; they are present here with their zero/empty defaults so
 * 7.4 builds on this shape in place rather than widening it, and so
 * `WorldState.plot` is a complete value from generation on.
 *
 * Determinism rests on drawing every choice from the passed {@link Prng} in a
 * fixed order over id-sorted lists, exactly as the city and principal
 * generators do, so the Plot is a pure function of the seed and the content
 * (Requirement 1.2, underpinning Property 1 — seed determinism).
 */

import {
  compareTime,
  timeToPhases,
  type EntityId,
  type GameTime,
  type ItemId,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
  type PropId,
  type Truth,
  asTruth,
} from '../model/core.js';
import { type Prng } from '../prng/prng.js';
import { type City } from './city.js';
import { cityScheduleBinder, type CityScheduleBinder } from './schedule-binding.js';
import { type Npc } from './npc.js';
import {
  CELL_ROLE_IDS,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from './principals.js';
import type { ContentSet, PlotTemplate, TraceTemplate } from '@tradecraft/content';

/**
 * One stage of a Plot template, as the content loader validates it. The content
 * package exports the schema but not the inferred type, so it is derived here
 * from {@link PlotTemplate} rather than imported.
 */
type PlotStage = PlotTemplate['stages'][number];

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * A Plot Stage id (`stage:<plot>/<stage>`). The design leaves a Plot Stage id
 * an opaque string; this module mints it from the chosen template id and the
 * stage's content id so it reads back to its origin and stays stable for the
 * same seed and content. Replaces the task-4.6 skeleton `StageId` under the
 * same name.
 */
export type StageId = string;

// ---------------------------------------------------------------------------
// Stage trace
// ---------------------------------------------------------------------------

/**
 * The `onDisrupted` response weighting a stage carries from its template: how
 * likely a disruption is answered by delaying, rerouting or aborting (design,
 * Clock/Plot; Requirement 3.3). The clock (task 7.2) draws against these on the
 * runtime stream; generation only carries them.
 */
export interface DisruptionWeights {
  readonly delay: number;
  readonly reroute: number;
  readonly abort: number;
}

/**
 * The kind of Sim event a {@link StageTrace} declares (design, Clock/Plot). It
 * mirrors the content {@link TraceTemplate}'s `kind`: a meeting, a transmission,
 * a dead-drop load or empty, or a movement. Task 26.2 emits exactly this kind.
 */
export type TraceKind = TraceTemplate['kind'];

/**
 * The Channel kind a transmission or courier hand-off runs on, carried from the
 * template's `channel`. Resolution to a concrete Channel id is task 26.2's (the
 * Cell's Channels are minted after the Plot in generation order), so generation
 * carries the kind and the owning participants.
 */
export type TraceChannelKind = NonNullable<TraceTemplate['channel']>;

/**
 * Where a bound trace's event happens: either a concrete generated Location —
 * resolved from the template's Location Type id or its Tag Query, preferring a
 * participant's scheduled Location in both cases — or the operation's bound
 * target slot (an {@link EntityId}). The Tag-Query and Location-Type forms both
 * resolve to a `{ kind: 'loc' }`, so everything downstream (the discovery gate,
 * the Narrator) reads one resolved shape. Absent when the template named no
 * place.
 */
export type TracePlace =
  | { readonly kind: 'loc'; readonly loc: LocId }
  | { readonly kind: 'target'; readonly entity: EntityId };

/**
 * One observable trace a stage emits, carried from the template's structured
 * {@link TraceTemplate} (design, Clock/Plot; Requirements 3.2, 3.3, 3.6). At
 * instantiation the generator binds the template's slot refs to concrete world
 * entities:
 *
 * - `kind` is the Sim event the trace becomes;
 * - `participants` are the bound role holders (the template's `roles` resolved
 *   through the Plot's role bindings), id-stable and deduped;
 * - `place` is the bound Location (from a Location Type) or target entity;
 * - `channelKind` is the transmission/courier Channel kind the template named
 *   (resolved to a concrete Channel by task 26.2);
 * - `materiel` is the bound {@link ItemId} a drop or courier carries;
 * - `evidences` are the predicate ids the event makes observable (used by the
 *   discovery-path verifier, task 26.7);
 * - `template` keeps the prose summary (the template's `text`), so the
 *   current executor (`plot-execution.ts`) renders unchanged until task 26.2
 *   emits the bound event.
 */
export interface StageTrace {
  /** The index of this trace within its stage, for a stable id and ordering. */
  readonly index: number;
  /** The Sim event kind this trace declares. */
  readonly kind: TraceKind;
  /** The bound role holders the trace involves (deduped, id-sorted-stable). */
  readonly participants: readonly NpcId[];
  /** The bound place: a Location or a target entity. Absent when none named. */
  readonly place?: TracePlace;
  /** The transmission/courier Channel kind, if the template named one. */
  readonly channelKind?: TraceChannelKind;
  /** The bound materiel item, if the template named a materiel slot. */
  readonly materiel?: ItemId;
  /** The predicate ids the event makes observable. */
  readonly evidences: readonly string[];
  /** The prose summary (the template's `text`); task 26.2 emits the bound event. */
  readonly template: string;
}

// ---------------------------------------------------------------------------
// StageState
// ---------------------------------------------------------------------------

/**
 * The lifecycle status of a Plot Stage. Generation leaves every stage
 * `pending`; the clock (task 7.2) advances a stage to `executed` when its
 * traces fire, or `disrupted` when the player interferes.
 */
export const STAGE_STATUSES = ['pending', 'executed', 'disrupted'] as const;

/** A Plot Stage's lifecycle status. */
export type StageStatus = (typeof STAGE_STATUSES)[number];

/**
 * One stage of the running Plot (the design's `StageState`, the element of
 * `PlotState.stages`). It carries the structure the generator instantiates from
 * the template — the minted {@link StageId}, the `requires`/`produces`
 * {@link PropId} edges, the concrete {@link GameTime} deadline, the traces and
 * the `onDisrupted` weights — plus the running `status` the clock advances.
 *
 * `requires` and `produces` are *minted* PropIds: the generator assigns one
 * PropId per produced proposition and rewrites each stage's `requires` to the
 * ids produced by earlier stages, so the edges form a concrete DAG over real
 * ids. `templateId` keeps the stage's content id for debugging and for the
 * discovery-path verifier (task 5.8) to key the stage's propositions.
 */
export interface StageState {
  readonly id: StageId;
  /** The stage's content id in its template (e.g. `spot-the-officer`). */
  readonly templateId: string;
  /** The minted ids of the propositions earlier stages must have produced. */
  readonly requires: readonly PropId[];
  /** The minted ids of the propositions this stage produces when it executes. */
  readonly produces: readonly PropId[];
  /** The concrete deadline this stage must execute by. */
  readonly deadline: GameTime;
  /** The observable traces the stage emits (task 7.2 renders them). */
  readonly traces: readonly StageTrace[];
  /** The doctrine-weighted disruption response (task 7.2 draws against it). */
  readonly onDisrupted: DisruptionWeights;
  /** The running lifecycle status; `pending` at generation. */
  readonly status: StageStatus;
}

// ---------------------------------------------------------------------------
// Role / materiel / target bindings
// ---------------------------------------------------------------------------

/**
 * One Plot role bound to a concrete generated NPC: the template's role-slot id,
 * the archetype it named, and the {@link NpcId} the generator bound it to. A
 * slot whose archetype has no generated Principal NPC (for example a civilian
 * `dock-worker` the Principal roster does not include) is left unbound and
 * recorded with `npc: undefined`, so the binding set is total over the
 * template's slots without inventing an NPC.
 */
export interface RoleBinding {
  readonly slot: string;
  readonly archetype: string;
  readonly npc: NpcId | undefined;
}

/**
 * One materiel slot bound to a minted {@link ItemId}: the operation's tracked
 * objects (a compromise file, a cipher component). The id is minted
 * `item:<plot>/<slot>` so it reads back to its origin.
 */
export interface MaterielBinding {
  readonly slot: string;
  readonly item: ItemId;
}

/**
 * One target slot bound to a concrete {@link EntityId}: the person, place or
 * organisation the operation aims at. The generator binds a target to an NPC,
 * a Location or an org by the slot's apparent intent (see
 * {@link bindTargetSlot}).
 */
export interface TargetBinding {
  readonly slot: string;
  readonly entity: EntityId;
}

// ---------------------------------------------------------------------------
// PlotState
// ---------------------------------------------------------------------------

/** The initial abort pressure of a freshly generated Plot (task 7.4 raises it). */
export const INITIAL_ABORT_PRESSURE = 0;

/**
 * The running state of the Plot (the design's `PlotState`), the value
 * `WorldState.plot` holds. It replaces the task-4.6 skeleton placeholder in
 * place, under the same name, so every importer keeps compiling.
 *
 * Task 5.3 owns the structure: the chosen `template` id, the ordered `stages`
 * (the stage DAG), the role/materiel/target `bindings`, the `materiel` (the
 * primary minted {@link ItemId}), the `leader` (the Cell leader) and the
 * `target` (the primary {@link EntityId}). Task 7.4 owns the abort machinery:
 * `abortPressure`, `pressureKeys` and `abortCause`. Those three are present now
 * with their zero/empty defaults — a running Plot starts under no pressure with
 * no cause — so 7.4 fills in behaviour against a stable shape rather than
 * adding fields.
 *
 * `leader`, `materiel` and `target` are branded {@link Truth}: which person
 * leads the Cell, which object is the operation's materiel and what it is aimed
 * at are ground truth the player must infer, never read from a view
 * (Requirement 2.1). The stage DAG, the deadlines and the traces are structure
 * the Sim runs against, not projected to the player, so they carry no brand.
 */
export interface PlotState {
  /** The id of the Plot template this Plot was instantiated from. */
  readonly template: string;
  /** Whether the Plot is still running, has completed, or has aborted. */
  readonly status: 'running' | 'completed' | 'aborted';
  /** The ordered stage DAG. */
  readonly stages: readonly StageState[];

  /** Every role slot bound to a generated NPC (or left unbound). */
  readonly roles: readonly RoleBinding[];
  /** Every materiel slot bound to a minted item id. */
  readonly materielSlots: readonly MaterielBinding[];
  /** Every target slot bound to a concrete entity id. */
  readonly targetSlots: readonly TargetBinding[];

  /** Ground truth: the operation's primary materiel item. */
  readonly materiel: Truth<ItemId>;
  /** Ground truth: the Cell leader who runs the operation. */
  readonly leader: Truth<NpcId>;
  /** Ground truth: the operation's primary target. */
  readonly target: Truth<EntityId>;

  // --- abort machinery (task 7.4 fills in the behaviour) ------------------
  /** Count of distinct counted disruption and belief keys. `0` at generation. */
  readonly abortPressure: number;
  /** The dedupe keys of counted disruptions and beliefs. Empty at generation. */
  readonly pressureKeys: readonly string[];
  /** Why the Plot aborted, once it has. Absent while running. */
  readonly abortCause?: string;
  /**
   * Whether the operation's materiel has been seized: taken from a hostile
   * Dead Drop by `service-drop` in `seize` mode, or from a carrier the Station
   * arrested. The live Disruption Context reports it as `isMaterielSeized()`
   * (slice-integration Req 4.4). `false` at generation.
   */
  readonly materielSeized: boolean;
}

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/** The output of {@link generatePlot}: the running {@link PlotState}. */
export interface GeneratedPlot {
  readonly plot: PlotState;
}

// ---------------------------------------------------------------------------
// Content lookup
// ---------------------------------------------------------------------------

/**
 * The bare local id of a (possibly namespaced) archetype id: the part after the
 * last `/`. The generated NPCs carry a namespaced `archetype` (`core/cell-leader`),
 * while a role slot names a bare archetype ref (`cell-leader`); comparing bare
 * local ids binds the two without the loader's namespacing getting in the way.
 */
function localArchetypeId(archetype: string): string {
  const slash = archetype.lastIndexOf('/');
  return slash === -1 ? archetype : archetype.slice(slash + 1);
}

// ---------------------------------------------------------------------------
// Template choice
// ---------------------------------------------------------------------------

/**
 * Choose a Plot template from the content set on the core stream. Templates are
 * taken in id-sorted order so the pick does not depend on registry iteration
 * order, exactly as the city and principal generators sort their inputs.
 * Throws when the content set defines no Plot template — a pack gap the smoke
 * tests should catch, not a runtime condition to paper over.
 */
export function chooseTemplate(prng: Prng, content: ContentSet): PlotTemplate {
  const templates = [...content.plotTemplates.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  if (templates.length === 0) {
    throw new Error('generatePlot(): the content set defines no Plot templates');
  }
  return prng.pick(templates);
}

// ---------------------------------------------------------------------------
// Role binding
// ---------------------------------------------------------------------------

/**
 * Index the generated Principal NPCs by their bare archetype local id, each in
 * a stable (id-sorted) list, so a role slot naming an archetype can bind to a
 * deterministic NPC of that archetype. Several NPCs may share an archetype
 * (two contacts of the same archetype never happen in the Principal roster, but
 * the index is general); the first by id is the binding.
 */
function npcsByArchetype(npcs: Readonly<Record<NpcId, Npc>>): Map<string, NpcId[]> {
  const out = new Map<string, NpcId[]>();
  const sorted = Object.values(npcs).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const npc of sorted) {
    const key = localArchetypeId(npc.archetype);
    const list = out.get(key);
    if (list === undefined) {
      out.set(key, [npc.id]);
    } else {
      list.push(npc.id);
    }
  }
  return out;
}

/**
 * Bind one role slot to a generated NPC. A slot lists one or more archetype
 * refs; the first ref (in slot order) that has a generated Principal NPC wins,
 * and binds to the first NPC of that archetype by id. A slot whose archetypes
 * are all absent from the Principal roster (a civilian the roster does not
 * carry) binds to `undefined` — recorded, not invented.
 */
function bindRoleSlot(
  slot: PlotTemplate['roleSlots'][number],
  byArchetype: Map<string, NpcId[]>,
): RoleBinding {
  for (const ref of slot.archetypes) {
    const local = localArchetypeId(ref);
    const candidates = byArchetype.get(local);
    if (candidates !== undefined && candidates.length > 0) {
      return { slot: slot.id, archetype: local, npc: candidates[0] };
    }
  }
  // No generated NPC for any of the slot's archetypes: record the first ref so
  // the binding set stays total over the template's slots.
  const first = slot.archetypes[0];
  return {
    slot: slot.id,
    archetype: first === undefined ? '' : localArchetypeId(first),
    npc: undefined,
  };
}

// ---------------------------------------------------------------------------
// Materiel / target binding
// ---------------------------------------------------------------------------

/** Turn a slot id into a slug-safe local id part. */
function slugSlot(slot: string): string {
  const slug = slot
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'slot';
}

/** Mint the item id for a materiel slot, scoped to the chosen template. */
function materielIdOf(templateId: string, slot: string): ItemId {
  return `item:${slugSlot(templateId)}/${slugSlot(slot)}` as ItemId;
}

/**
 * Bind a target slot to a concrete {@link EntityId}. A target slot's `id` reads
 * its intent — a slot id mentioning an office, room, registry or location binds
 * to a Location; one mentioning a service, directorate or org binds to an org;
 * anything else (an officer, a clerk) binds to a bound role NPC. The choice is
 * deterministic: the first matching entity in an id-sorted candidate list, so
 * the same seed and content pick the same target.
 *
 * The binding never invents an entity. When no entity of the preferred kind
 * exists, it falls back to the Cell leader (always present), so every target
 * slot resolves to a real entity in the generated world.
 */
function bindTargetSlot(
  prng: Prng,
  slot: PlotTemplate['targetSlots'][number],
  city: City,
  roles: readonly RoleBinding[],
  orgs: GeneratedOrgs,
  leader: NpcId,
): TargetBinding {
  const id = slot.id.toLowerCase();
  const looksLikePlace = /office|room|registry|site|location|house|port|building|station/.test(
    id,
  );
  const looksLikeOrg = /service|directorate|network|cell|org|agency|bureau|traffic/.test(id);

  if (looksLikePlace) {
    const locIds = (Object.keys(city.locations) as LocId[]).sort();
    if (locIds.length > 0) {
      return { slot: slot.id, entity: prng.pick(locIds) };
    }
  }
  if (looksLikeOrg) {
    const orgIds = (Object.keys(orgs.orgs) as OrgId[]).sort();
    if (orgIds.length > 0) {
      return { slot: slot.id, entity: prng.pick(orgIds) };
    }
  }
  // Default: a person. Prefer a bound role NPC; fall back to the leader.
  const boundNpcs = roles
    .map((r) => r.npc)
    .filter((n): n is NpcId => n !== undefined)
    .sort();
  if (boundNpcs.length > 0) {
    return { slot: slot.id, entity: prng.pick(boundNpcs) };
  }
  return { slot: slot.id, entity: leader };
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

/** Convert a non-negative phase count from day 0 into a {@link GameTime}. */
function gameTimeFromPhases(phases: number): GameTime {
  const day = Math.floor(phases / 4);
  const phase = (phases - day * 4) as Phase;
  return { day, phase };
}

// ---------------------------------------------------------------------------
// Stage DAG
// ---------------------------------------------------------------------------

/** Mint a Plot Stage id from the template id and the stage's content id. */
function stageIdOf(templateId: string, stageTemplateId: string): StageId {
  return `stage:${slugSlot(templateId)}/${slugSlot(stageTemplateId)}`;
}

/**
 * Mint the PropId for one produced proposition of a stage. Scoped to the
 * template, stage and the produced content ref, so it is stable and reads back
 * to its origin: `prop:<template>/<stage>/<ref>`.
 */
function propIdOf(templateId: string, stageTemplateId: string, ref: string): PropId {
  return `prop:${slugSlot(templateId)}/${slugSlot(stageTemplateId)}/${slugSlot(ref)}`;
}

// ---------------------------------------------------------------------------
// Trace binding
// ---------------------------------------------------------------------------

/**
 * The bindings {@link bindTrace} resolves a template trace's slot refs against:
 * the role slots bound to NPCs, the materiel slots bound to items, the target
 * slots bound to entities, and the city (to stamp a Location of a named type).
 * Built once per Plot by {@link generatePlot} and threaded into
 * {@link buildStages}.
 */
interface TraceBindings {
  /** role-slot id -> bound NpcId (absent for an unbound role). */
  readonly roleToNpc: ReadonlyMap<string, NpcId>;
  /** materiel-slot id -> bound ItemId. */
  readonly materielToItem: ReadonlyMap<string, ItemId>;
  /** target-slot id -> bound EntityId. */
  readonly targetToEntity: ReadonlyMap<string, EntityId>;
  /** Location Type local id -> the generated Locations of that type, id-sorted. */
  readonly locsByType: ReadonlyMap<string, readonly LocId[]>;
  /**
   * Resolve a trace's `place.query` Tag Query to the city's Locations whose
   * Effective Tags satisfy it (id-sorted), the same binder the schedule
   * generator uses. A `query`-form place binds this way instead of by a
   * hard-coded Location Type id, so any correctly-tagged city satisfies a core
   * plot's traces (content-expansion follow-up: plot trace binding by Tag
   * Query).
   */
  readonly queryBinder: CityScheduleBinder;
  /** The scheduled Locations of each bound role NPC, for place preference. */
  readonly npcScheduledLocs: ReadonlyMap<NpcId, readonly LocId[]>;
}

/** The bare local id of a (possibly namespaced) Location Type id. */
function localTypeId(type: string): string {
  const slash = type.lastIndexOf('/');
  return slash === -1 ? type : type.slice(slash + 1);
}

/**
 * Resolve a trace's structured {@link TraceTemplate} to a bound {@link
 * StageTrace} (design, Clock/Plot; Requirements 3.3, 3.6). The template's slot
 * refs resolve through {@link TraceBindings}:
 *
 * - each `roles` entry → its bound NpcId (an unbound role is dropped), deduped;
 * - `place.target` → the target slot's bound entity; `place.locationType` → a
 *   generated Location of that type, preferring one a participant is scheduled
 *   at, else the first by id;
 * - `channel` → carried as the Channel kind (task 26.2 resolves the concrete
 *   Channel, which is minted after the Plot);
 * - `materiel` → the materiel slot's bound item;
 * - `evidences` and `text` are carried through.
 *
 * The place draw is the only one that can touch `prng`, and only when a
 * Location Type resolves to several candidates with no scheduled preference, so
 * the stream order stays fixed.
 */
function bindTrace(
  prng: Prng,
  trace: TraceTemplate,
  index: number,
  bindings: TraceBindings,
): StageTrace {
  // Participants: bound role holders, in template order, deduped.
  const participants: NpcId[] = [];
  for (const role of trace.roles) {
    const npc = bindings.roleToNpc.get(role);
    if (npc !== undefined && !participants.includes(npc)) {
      participants.push(npc);
    }
  }

  // Place: a bound target entity, or a generated Location — named either by a
  // Tag Query (bound through Effective Tags) or by a Location Type id.
  let place: TracePlace | undefined;
  if (trace.place !== undefined) {
    if ('target' in trace.place) {
      const entity = bindings.targetToEntity.get(trace.place.target);
      if (entity !== undefined) {
        place = { kind: 'target', entity };
      }
    } else if ('query' in trace.place) {
      const loc = resolveQueryLocation(
        prng,
        trace.place.query,
        participants,
        bindings,
      );
      if (loc !== undefined) {
        place = { kind: 'loc', loc };
      }
    } else {
      const loc = resolvePlaceLocation(
        prng,
        localTypeId(trace.place.locationType),
        participants,
        bindings,
      );
      if (loc !== undefined) {
        place = { kind: 'loc', loc };
      }
    }
  }

  const materiel =
    trace.materiel === undefined
      ? undefined
      : bindings.materielToItem.get(trace.materiel);

  return {
    index,
    kind: trace.kind,
    participants,
    ...(place !== undefined ? { place } : {}),
    ...(trace.channel !== undefined ? { channelKind: trace.channel } : {}),
    ...(materiel !== undefined ? { materiel } : {}),
    evidences: [...trace.evidences],
    template: trace.text,
  };
}

/**
 * Pick a generated Location of `localType` for a trace, preferring one a
 * participant is scheduled at (so a meeting lands where the people actually
 * are, per the design's "preferring the role holders' scheduled Locations"),
 * else the first Location of that type by id. Returns `undefined` only when the
 * city has no Location of the type.
 */
function resolvePlaceLocation(
  prng: Prng,
  localType: string,
  participants: readonly NpcId[],
  bindings: TraceBindings,
): LocId | undefined {
  const candidates = bindings.locsByType.get(localType);
  if (candidates === undefined || candidates.length === 0) {
    return undefined;
  }
  const candidateSet = new Set(candidates);

  // Prefer a participant's scheduled Location of this type.
  for (const npc of participants) {
    const scheduled = bindings.npcScheduledLocs.get(npc);
    if (scheduled === undefined) {
      continue;
    }
    for (const loc of scheduled) {
      if (candidateSet.has(loc)) {
        return loc;
      }
    }
  }

  // No scheduled preference: draw from the type's candidates on the stream.
  return prng.pick([...candidates]);
}

/**
 * Pick a generated Location that binds a trace's Tag Query `query`, preferring
 * one a participant is scheduled at, else drawing from the query's Binders on
 * the stream (content-expansion follow-up: plot trace binding by Tag Query).
 *
 * The Binders are the city's Locations whose Effective Tags satisfy the query
 * (own Tags together with their Location Type's Tags), id-sorted by the shared
 * {@link CityScheduleBinder}. This is the portable counterpart to {@link
 * resolvePlaceLocation}: a core plot names a *function* (`[function:cafe]`)
 * rather than a specific Location Type id, so any city that tags some Location
 * for the function satisfies the trace. Returns `undefined` only when the city
 * binds no Location for the query.
 *
 * Mirrors {@link resolvePlaceLocation}'s preference and draw so the two place
 * forms consume the stream identically: a scheduled preference costs no
 * entropy, an unpreferenced draw costs exactly one `prng.pick`.
 */
function resolveQueryLocation(
  prng: Prng,
  query: readonly string[],
  participants: readonly NpcId[],
  bindings: TraceBindings,
): LocId | undefined {
  const candidates = bindings.queryBinder.binders(query).map((loc) => loc.id);
  if (candidates.length === 0) {
    return undefined;
  }
  const candidateSet = new Set(candidates);

  // Prefer a participant's scheduled Location that also binds the query.
  for (const npc of participants) {
    const scheduled = bindings.npcScheduledLocs.get(npc);
    if (scheduled === undefined) {
      continue;
    }
    for (const loc of scheduled) {
      if (candidateSet.has(loc)) {
        return loc;
      }
    }
  }

  // No scheduled preference: draw from the query's Binders on the stream.
  return prng.pick([...candidates]);
}

/**
 * Assemble the {@link TraceBindings} for a Plot from its bound role, materiel
 * and target slots and the generated city. Groups the city's Locations by their
 * bare Location Type id, builds the Tag-Query binder over the city and loaded
 * content (so a `place.query` resolves by Effective Tags), and records each
 * bound role NPC's scheduled Locations, so {@link bindTrace} can resolve a
 * `place.locationType` or a `place.query` to a concrete Location (preferring a
 * participant's scheduled one). Pure and order-stable: every map is keyed
 * deterministically and the per-type Location lists are id-sorted.
 */
function buildTraceBindings(
  roles: readonly RoleBinding[],
  materielSlots: readonly MaterielBinding[],
  targetSlots: readonly TargetBinding[],
  city: City,
  content: ContentSet,
  principals: GeneratedPrincipals,
): TraceBindings {
  const roleToNpc = new Map<string, NpcId>();
  for (const role of roles) {
    if (role.npc !== undefined) {
      roleToNpc.set(role.slot, role.npc);
    }
  }

  const materielToItem = new Map<string, ItemId>();
  for (const m of materielSlots) {
    materielToItem.set(m.slot, m.item);
  }

  const targetToEntity = new Map<string, EntityId>();
  for (const t of targetSlots) {
    targetToEntity.set(t.slot, t.entity);
  }

  // Locations grouped by their bare Location Type id, each list id-sorted.
  const locsByType = new Map<string, LocId[]>();
  for (const loc of Object.values(city.locations)) {
    const key = localTypeId(loc.type);
    const list = locsByType.get(key);
    if (list === undefined) {
      locsByType.set(key, [loc.id]);
    } else {
      list.push(loc.id);
    }
  }
  for (const list of locsByType.values()) {
    list.sort();
  }

  // Each bound role NPC's scheduled Locations (distinct, id-sorted).
  const npcScheduledLocs = new Map<NpcId, LocId[]>();
  for (const role of roles) {
    if (role.npc === undefined) {
      continue;
    }
    const npc = principals.npcs[role.npc];
    if (npc === undefined) {
      continue;
    }
    const locs = new Set<LocId>();
    for (const entry of npc.schedule.entries) {
      locs.add(entry.loc);
    }
    npcScheduledLocs.set(role.npc, [...locs].sort());
  }

  // The Tag-Query binder a `place.query` resolves through — the same resolver
  // the schedule generator uses, so a trace and a schedule read Effective Tags
  // the one way.
  const queryBinder = cityScheduleBinder(city, content);

  return {
    roleToNpc,
    materielToItem,
    targetToEntity,
    locsByType,
    queryBinder,
    npcScheduledLocs,
  };
}

/**
 * Build the stage DAG for the retained stages.
 *
 * The template's stages are taken in authored order (which is a topological
 * order of the `requires`/`produces` chain) and clamped to the preset's
 * `stageCount`: a template with more stages than the preset asks for keeps a
 * contiguous prefix, a template with fewer keeps all its stages. (Clamping a
 * prefix preserves rootedness — the first stage requires nothing — and
 * connectivity, since each kept stage's requirements are produced by an earlier
 * kept stage.)
 *
 * For each retained stage the builder:
 * - mints a {@link StageId};
 * - mints a {@link PropId} for every `produces` content ref, recording the ref
 *   → minted-id map so later stages can resolve their `requires`;
 * - rewrites `requires` to the minted ids produced by earlier retained stages,
 *   dropping a requirement whose producing stage was clamped away (so the DAG
 *   stays rooted at the retained prefix);
 * - computes a concrete {@link GameTime} deadline from the stage's deadline
 *   range plus the preset's `deadlineSlackDays`, accumulated across stages so
 *   deadlines are strictly non-decreasing down the chain;
 * - carries the trace templates and the `onDisrupted` weights.
 *
 * The deadline for stage `i` is `start + Σ_{k≤i} (draw(range_k) + slack)` days,
 * where `draw(range_k)` is a per-stage integer drawn from the template's
 * `[min, max]` day range on the core stream. Accumulating means every stage's
 * deadline is at least `deadlineSlackDays` beyond its predecessor's.
 */
function buildStages(
  prng: Prng,
  template: PlotTemplate,
  stageCount: number,
  deadlineSlackDays: number,
  start: GameTime,
  bindings: TraceBindings,
): StageState[] {
  const retained: PlotStage[] = template.stages.slice(
    0,
    Math.max(1, Math.min(stageCount, template.stages.length)),
  );

  // First pass: mint stage ids and the produced-proposition ids, so the second
  // pass can resolve each stage's requirements against earlier producers.
  const producedBy = new Map<string, PropId>(); // content ref -> minted PropId
  const retainedIds = new Set<string>();
  for (const stage of retained) {
    retainedIds.add(stage.id);
  }

  const stages: StageState[] = [];
  let deadlinePhases = timeToPhases(start);

  for (const stage of retained) {
    // Mint produced ids first (fixed order: the template's `produces` order).
    const produces: PropId[] = [];
    for (const ref of stage.produces) {
      const id = propIdOf(template.id, stage.id, ref);
      produces.push(id);
      producedBy.set(ref, id);
    }

    // Resolve requires against earlier producers; a requirement produced only
    // by a clamped-away stage is dropped so the DAG stays rooted.
    const requires: PropId[] = [];
    for (const ref of stage.requires) {
      const producerId = producedBy.get(ref);
      if (producerId !== undefined) {
        requires.push(producerId);
      }
    }

    // Deadline: draw an integer day span from the stage's range, add slack,
    // accumulate. The range is in days; a day is four phases.
    const min = Math.max(0, Math.round(stage.deadline.min));
    const max = Math.max(min, Math.round(stage.deadline.max));
    const spanDays = prng.int(min, max) + deadlineSlackDays;
    deadlinePhases += spanDays * 4;
    const deadline = gameTimeFromPhases(deadlinePhases);

    const traces: StageTrace[] = stage.traces.map((t, index) =>
      bindTrace(prng, t, index, bindings),
    );

    stages.push({
      id: stageIdOf(template.id, stage.id),
      templateId: stage.id,
      requires,
      produces,
      deadline,
      traces,
      onDisrupted: {
        delay: stage.onDisrupted.delay,
        reroute: stage.onDisrupted.reroute,
        abort: stage.onDisrupted.abort,
      },
      status: 'pending',
    });
  }

  return stages;
}

// ---------------------------------------------------------------------------
// generatePlot
// ---------------------------------------------------------------------------

/**
 * Instantiate the Plot from a Plot template as a stage DAG (design, "World
 * Generator", step 4; Requirements 1.1, 3.2, 3.3).
 *
 * `prng` must be the core stream for the current attempt, already advanced past
 * city generation, {@link generateOrgs} and {@link generatePrincipals}.
 * `principals` is that step's output — the Plot binds its roles to those NPCs —
 * and `city` provides the Locations a place-like target slot binds to.
 * `start` is the game's start time (the clamp floor for every deadline);
 * callers pass `WorldState.time` (day 0, morning) at generation.
 *
 * The draw order is fixed so the Plot is a pure function of the seed and the
 * content: choose template → bind role slots (in template order) → bind target
 * slots (in template order) → build the stage DAG (deadlines drawn in stage
 * order). Materiel ids are minted, not drawn, so they consume no entropy.
 *
 * Throws when the content set defines no Plot template (via
 * {@link chooseTemplate}); every other content gap (a role slot with no
 * generated NPC, a template with no target or materiel slots) is handled
 * gracefully, since a template is free to omit any of those.
 */
export function generatePlot(
  prng: Prng,
  content: ContentSet,
  preset: { readonly plot: { readonly stageCount: number; readonly deadlineSlackDays: number } },
  city: City,
  orgs: GeneratedOrgs,
  principals: GeneratedPrincipals,
  start: GameTime,
): GeneratedPlot {
  const template = chooseTemplate(prng, content);

  // The leader is the Cell leader NPC — the first Cell role (leader-first order
  // in principals.ts). The Cell is always fully generated, so this is present.
  const leader: NpcId = principals.cell[0];

  // Role bindings, in template order.
  const byArchetype = npcsByArchetype(principals.npcs);
  const roles: RoleBinding[] = template.roleSlots.map((slot) =>
    bindRoleSlot(slot, byArchetype),
  );

  // Materiel bindings: minted ids, in template order.
  const materielSlots: MaterielBinding[] = template.materielSlots.map((slot) => ({
    slot: slot.id,
    item: materielIdOf(template.id, slot.id),
  }));

  // Target bindings, in template order (each may draw from the stream).
  const targetSlots: TargetBinding[] = template.targetSlots.map((slot) =>
    bindTargetSlot(prng, slot, city, roles, orgs, leader),
  );

  // Trace bindings: the maps bindTrace resolves slot refs against. Built here
  // so a stage's traces bind to the Plot's bound roles, materiel, targets and
  // the generated city.
  const bindings = buildTraceBindings(roles, materielSlots, targetSlots, city, content, principals);

  // The stage DAG.
  const stages = buildStages(
    prng,
    template,
    preset.plot.stageCount,
    preset.plot.deadlineSlackDays,
    start,
    bindings,
  );

  // Primary materiel and target: the first bound slot of each, with a defensive
  // fall-back so the branded fields are always real ids.
  const primaryMateriel: ItemId =
    materielSlots[0]?.item ?? materielIdOf(template.id, 'materiel');
  const primaryTarget: EntityId = targetSlots[0]?.entity ?? leader;

  const plot: PlotState = {
    template: template.id,
    status: 'running',
    stages,
    roles,
    materielSlots,
    targetSlots,
    materiel: asTruth(primaryMateriel),
    leader: asTruth(leader),
    target: asTruth(primaryTarget),
    abortPressure: INITIAL_ABORT_PRESSURE,
    pressureKeys: [],
    // Nothing has been seized when the operation starts.
    materielSeized: false,
  };

  return { plot };
}

// ---------------------------------------------------------------------------
// Cell-role check (exported for tests / later tasks)
// ---------------------------------------------------------------------------

/** The archetype ids that identify a Cell member, for leader/role checks. */
export const CELL_ARCHETYPE_IDS: readonly string[] = CELL_ROLE_IDS;

/** True when the deadlines of a stage list are non-decreasing down the chain. */
export function deadlinesNonDecreasing(stages: readonly StageState[]): boolean {
  for (let i = 1; i < stages.length; i += 1) {
    if (compareTime(stages[i - 1].deadline, stages[i].deadline) > 0) {
      return false;
    }
  }
  return true;
}
