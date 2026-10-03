/**
 * Channels and Dead Drops: step 5 of the world generator's core stream (design,
 * "World Generator", step 5; Requirements 24.5, 25.1).
 *
 * This module owns both the *shapes* of the two comms structures a generated
 * world carries — the real {@link Channel} and {@link DeadDrop} interfaces that
 * replace the skeleton placeholders in `../model/state.ts` — and the pure
 * {@link generateComms} that instantiates them for the three organisations that
 * run operations in a game: the Plot's Cell, the Hostile Service and the
 * Station.
 *
 * A **Channel** is a communications path with a kind, an owner and a schedule
 * (Glossary: "a communications path — radio, numbers broadcast, courier, or
 * dead drop — with a schedule and an owner"). The intercept action collects
 * transmissions on known radio and numbers Channels whose time falls in the
 * Station's retention window (Requirement 25.1), so a Channel carries:
 *
 * - a `kind` — `radio`, `numbers`, `courier` or `dead-drop` — the one the
 *   design's Glossary names;
 * - an `owner` — an {@link OrgId} or {@link NpcId}; which organisation (or which
 *   person) runs the path;
 * - a `schedule` — a recurring transmission timetable the clock reads: a
 *   `period` in days, a starting {@link GameTime} and a `phase`, plus the
 *   {@link transmissionTimes} helper that enumerates the concrete {@link
 *   GameTime}s a schedule fires at over a horizon. A recurring schedule (rather
 *   than a fixed list of slots) means the clock can ask "does this Channel fire
 *   on day D?" without the generator pre-computing every slot of a long game.
 *
 * A **Dead Drop** is a concealed site at a Location used to pass items without
 * meeting (Requirement 24.5: the player services their own drops to deliver and
 * accept items, and hostile drops to copy or seize). A {@link DeadDrop}
 * carries:
 *
 * - an `id` ({@link DeadDropId}, `drop:<local>`);
 * - a `loc` — the {@link LocId} it sits at, always a Location whose Location
 *   Type allows dead drops (`allowsDeadDrops`), so the drop is at a plausible
 *   concealment site;
 * - an `owner` — the {@link OrgId} or {@link NpcId} who runs it;
 * - its `contents` — the item ids currently cached there (empty at generation
 *   for most drops; the Plot threads its materiel through one).
 *
 * `generateComms` is a pure function of the core PRNG stream, the generated
 * {@link City}, the three organisations and the Principal roster (tasks
 * 5.1–5.3) and the Plot (task 5.3). It:
 *
 * 1. gives the **Plot** a radio *or* numbers Channel owned by the Cell's
 *    radio-operator (so the Station can intercept it, Requirement 25.1), a
 *    courier Channel owned by the Cell's courier, and a dead-drop Channel; it
 *    places a **Dead Drop** at a dead-drop-allowing Location and threads the
 *    Plot's materiel into it;
 * 2. gives the **Hostile Service** a radio/numbers Channel owned by the hostile
 *    resident and a Dead Drop at another allowing Location (a hostile drop the
 *    player can copy or seize, Requirement 24.5);
 * 3. gives the **Station** a radio Channel owned by the Station org (its own
 *    comms link to HQ) and a Dead Drop at a third allowing Location.
 *
 * Every Channel owner is a real generated org or NPC, every Dead Drop sits at a
 * dead-drop-allowing Location, and the Plot, the Hostile Service and the
 * Station each get comms. Determinism rests on drawing every choice from the
 * passed {@link Prng} in a fixed order over id-sorted lists, exactly as the
 * city, principal and Plot generators do, so the result is a pure function of
 * the seed and the content (Requirement 1.2, underpinning Property 1 — seed
 * determinism).
 *
 * The result also carries, per Location, the {@link DeadDropId}s placed there,
 * so the caller can populate `Location.deadDropSites` (left empty by task 5.1).
 */

import {
  revealTruth,
  timeToPhases,
  type ChannelId,
  type DeadDropId,
  type GameTime,
  type ItemId,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
} from '../model/core.js';
import { type Prng } from '../prng/prng.js';
import { type City, type Location } from './city.js';
import { type Npc } from './npc.js';
import {
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from './principals.js';
import { type PlotState } from './plot.js';
import type { ContentSet, LocationType } from '@tradecraft/content';

// ---------------------------------------------------------------------------
// Channel kind and schedule
// ---------------------------------------------------------------------------

/**
 * The kinds of communications path a {@link Channel} can be, exactly the four
 * the Glossary names (design, "Channel"): a `radio` link, a `numbers`
 * broadcast, a `courier` run, or a `dead-drop` exchange. The intercept action
 * (Requirement 25.1) collects transmissions on `radio` and `numbers` Channels;
 * {@link isInterceptableKind} is the predicate it reads.
 */
export const CHANNEL_KINDS = ['radio', 'numbers', 'courier', 'dead-drop'] as const;

/** The kind of one {@link Channel}. */
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/**
 * True when a Channel of this kind carries transmissions the Station can
 * intercept — a radio link or a numbers broadcast (Requirement 25.1). A courier
 * run is intercepted on its Route (not at the Station), and a dead-drop
 * exchange is serviced, not intercepted; neither reads as interceptable here.
 */
export function isInterceptableKind(kind: ChannelKind): boolean {
  return kind === 'radio' || kind === 'numbers';
}

/**
 * A Channel's transmission schedule: a recurring timetable the clock reads to
 * decide when the Channel fires. The schedule repeats every `period` days,
 * starting at `start`, and each firing lands at the `phase` of its day. A
 * recurring form (rather than a fixed slot list) lets the clock test an
 * arbitrary day without the generator enumerating every slot of a long game,
 * while {@link transmissionTimes} enumerates the concrete {@link GameTime}s over
 * a bounded horizon for the discovery-path verifier (task 5.8) and tests.
 *
 * The schedule is well-formed when `period >= 1`, `start.day >= 0` and `phase`
 * is a valid ordinal — {@link isWellFormedSchedule} checks exactly that.
 */
export interface ChannelSchedule {
  /** The repeat period in days; `>= 1`. A daily Channel has `period === 1`. */
  readonly period: number;
  /** The first firing of the schedule. */
  readonly start: GameTime;
  /** The phase of the day each firing lands at. */
  readonly phase: Phase;
}

/** The smallest and largest transmission periods a generated Channel uses, in days. */
export const MIN_CHANNEL_PERIOD = 1;
export const MAX_CHANNEL_PERIOD = 3;

/**
 * True when a {@link ChannelSchedule} is well-formed: a period of at least one
 * day, a non-negative integer start day, and a start phase matching the
 * schedule's firing phase (generation keeps the two in step, so the firing
 * phase is the start's phase). Read by tests and by any caller that validates a
 * loaded save.
 */
export function isWellFormedSchedule(schedule: ChannelSchedule): boolean {
  return (
    Number.isInteger(schedule.period) &&
    schedule.period >= MIN_CHANNEL_PERIOD &&
    Number.isInteger(schedule.start.day) &&
    schedule.start.day >= 0 &&
    schedule.start.phase >= 0 &&
    schedule.start.phase <= 3 &&
    schedule.phase === schedule.start.phase
  );
}

/**
 * Enumerate the concrete {@link GameTime}s a schedule fires at from its start up
 * to and including `horizon` (a day count). Firings land on
 * `start.day, start.day + period, start.day + 2·period, …` at the schedule's
 * phase. Pure and deterministic: the same schedule and horizon always yield the
 * same list, in ascending time order. A `horizon` before the start yields an
 * empty list.
 */
export function transmissionTimes(
  schedule: ChannelSchedule,
  horizonDay: number,
): readonly GameTime[] {
  const out: GameTime[] = [];
  for (let day = schedule.start.day; day <= horizonDay; day += schedule.period) {
    out.push({ day, phase: schedule.phase });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Owner
// ---------------------------------------------------------------------------

/**
 * Who owns a {@link Channel} or {@link DeadDrop}: an organisation
 * ({@link OrgId}) or a specific person ({@link NpcId}). The design's Glossary
 * says a Channel has "an owner (an org or NPC)"; this is that union.
 */
export type CommsOwner = OrgId | NpcId;

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

/**
 * A communications path (the design's `Channel`; Glossary; Requirement 25.1).
 * It carries its `kind`, its `owner` (an org or NPC) and its transmission
 * `schedule`. Replaces the task-4.6 skeleton `Channel` in `../model/state.ts`
 * under the same name, so `WorldState.channels` is a `Record<ChannelId,
 * Channel>` of these.
 *
 * A Channel is Sim structure, not a Player View projection: the player learns a
 * Channel exists by intercepting it or by a Starting-Brief lead, and infers who
 * runs it. The record itself therefore carries no {@link import(
 * '../model/core.js').Truth} brand — the inference, not the structure, is the
 * secret — matching how the Plot's stage DAG and the City are unbranded
 * structure the Sim runs against.
 *
 * For a `courier` Channel, `route` names the Location the courier run passes
 * through, so the intercept action can place a courier interception on a Route
 * during the Channel's window (Requirement 25.1, design "Intercept"). It is
 * absent for the other kinds.
 */
export interface Channel {
  readonly id: ChannelId;
  readonly kind: ChannelKind;
  readonly owner: CommsOwner;
  readonly schedule: ChannelSchedule;
  /** For a `courier` Channel, the Location its run passes through. */
  readonly route?: LocId;
}

// ---------------------------------------------------------------------------
// Dead Drop
// ---------------------------------------------------------------------------

/**
 * A concealed site at a Location used to pass items without meeting (the
 * design's `DeadDrop`; Requirement 24.5). It carries its `id`, the `loc` it sits
 * at (always a Location whose Location Type allows dead drops), its `owner` (an
 * org or NPC) and its current `contents` (the item ids cached there). Replaces
 * the task-4.6 skeleton `DeadDrop` in `../model/state.ts` under the same name,
 * so `WorldState.deadDrops` is a `Record<DeadDropId, DeadDrop>` of these.
 *
 * Servicing a drop (task 11.6) reads and rewrites `contents`: the player's own
 * drops deliver their contents and accept left items, hostile drops are copied
 * or seized. Generation seeds the Plot's drop with the operation's materiel and
 * leaves the rest empty.
 *
 * Like a {@link Channel}, a Dead Drop is unbranded Sim structure: the player
 * learns a drop exists and infers its owner; the record is not a view
 * projection.
 */
export interface DeadDrop {
  readonly id: DeadDropId;
  readonly loc: LocId;
  readonly owner: CommsOwner;
  readonly contents: readonly ItemId[];
  /**
   * The Asset expected to load this drop for the player, when a load is
   * arranged. The Hostile Full Tick projects it as one of the Asset's
   * commitments. When that Asset is out of play (arrested by the Hostile
   * Service, say), the Phase Step raises `drop-unserviced` once the player is
   * at the drop and clears the field (slice-integration Req 1.8, 3.10). Absent
   * when no load is expected; nothing in the slice sets it yet.
   */
  readonly expectedLoader?: NpcId;
}

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/**
 * The output of {@link generateComms}: the Channels and Dead Drops keyed by id
 * (as `WorldState.channels` and `WorldState.deadDrops` hold them), plus a
 * per-Location map of the drops placed there, so the caller can populate
 * `Location.deadDropSites` (left empty by city generation).
 */
export interface GeneratedComms {
  /** Every Channel keyed by id, as `WorldState.channels` holds them. */
  readonly channels: Readonly<Record<ChannelId, Channel>>;
  /** Every Dead Drop keyed by id, as `WorldState.deadDrops` holds them. */
  readonly deadDrops: Readonly<Record<DeadDropId, DeadDrop>>;
  /**
   * The Dead Drop ids placed at each Location, keyed by {@link LocId}. The
   * caller folds these into each `Location.deadDropSites`; a Location with no
   * drop has no entry.
   */
  readonly deadDropSitesByLocation: Readonly<Record<LocId, readonly DeadDropId[]>>;
  /** The Plot's Channels, in the order generated (radio/numbers, courier, dead-drop). */
  readonly plotChannels: readonly ChannelId[];
  /** The Hostile Service's Channels. */
  readonly hostileChannels: readonly ChannelId[];
  /** The Station's Channels. */
  readonly stationChannels: readonly ChannelId[];
  /** The Plot's Dead Drop (threaded with the operation's materiel). */
  readonly plotDrop: DeadDropId;
  /** The Hostile Service's Dead Drop. */
  readonly hostileDrop: DeadDropId;
  /** The Station's Dead Drop. */
  readonly stationDrop: DeadDropId;
}

// ---------------------------------------------------------------------------
// Dead-drop-allowing Locations
// ---------------------------------------------------------------------------

/**
 * The Locations in the generated city whose Location Type allows dead drops
 * (`allowsDeadDrops`), in a stable (id-sorted) order so a draw against them is
 * deterministic. The content set's Location Types are the source of the flag;
 * the city stamps a `type` id onto each Location, so this joins the two.
 *
 * The core pack marks a handful of types as dead-drop-allowing (the tobacconist
 * kiosk, library, bookshop, park, Danube port, warehouse and railway station),
 * so a generated city of 10–14 Locations always has several. The function makes
 * no assumption about which: it reads the flag off the loaded types.
 */
export function deadDropLocations(city: City, content: ContentSet): readonly Location[] {
  const allowing = new Set<string>();
  for (const type of content.locationTypes.values() as Iterable<LocationType>) {
    if (type.allowsDeadDrops) {
      allowing.add(type.id);
    }
  }
  return Object.values(city.locations)
    .filter((loc) => allowing.has(loc.type))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Id minting
// ---------------------------------------------------------------------------

/** Mint a Channel id from an owner slug and a role tag: `chan:<owner>/<tag>`. */
function channelIdOf(ownerSlug: string, tag: string): ChannelId {
  return `chan:${ownerSlug}/${tag}` as ChannelId;
}

/** Mint a Dead Drop id from an owner slug and the Location it sits at. */
function deadDropIdOf(ownerSlug: string, loc: LocId): DeadDropId {
  const locSlug = loc.replace(/^loc:/, '');
  return `drop:${ownerSlug}/${locSlug}` as DeadDropId;
}

// ---------------------------------------------------------------------------
// Schedule drawing
// ---------------------------------------------------------------------------

/**
 * Draw a well-formed {@link ChannelSchedule} on the core stream: a period in
 * `[MIN_CHANNEL_PERIOD, MAX_CHANNEL_PERIOD]` days, a start day within the first
 * `period` days of the game (so the first firing is early, and shifting it by a
 * whole period would be the same schedule), and a phase drawn from the four.
 * The firing phase is the start's phase, so {@link isWellFormedSchedule} holds.
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

// ---------------------------------------------------------------------------
// Owner resolution
// ---------------------------------------------------------------------------

/** A short, slug-safe tag for an owner, for id minting. */
function ownerSlug(owner: CommsOwner): string {
  // An entity id is `<ns>:<local>`; keep the local part, slugged.
  const local = owner.slice(owner.indexOf(':') + 1);
  const slug = local
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'owner';
}

/**
 * The {@link NpcId} of the Cell member with a given archetype local id (e.g.
 * `cell-radio-operator`, `cell-courier`), or `undefined` if the roster has
 * none. The Cell roster is always complete, so the radio-operator and courier
 * are present; the fall-back keeps the function total.
 */
function cellMemberByArchetype(
  principals: GeneratedPrincipals,
  localArchetype: string,
): NpcId | undefined {
  for (const id of principals.cell) {
    const npc: Npc | undefined = principals.npcs[id];
    if (npc === undefined) {
      continue;
    }
    const local = npc.archetype.slice(npc.archetype.lastIndexOf('/') + 1);
    if (local === localArchetype) {
      return id;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// generateComms
// ---------------------------------------------------------------------------

/**
 * Generate the Channels and Dead Drops for the Plot, the Hostile Service and the
 * Station (design, "World Generator", step 5; Requirements 24.5, 25.1).
 *
 * `prng` must be the core stream for the current attempt, already advanced past
 * city generation, {@link generateOrgs}, {@link generatePrincipals} and
 * {@link generatePlot}. The draw order is fixed so the result is a pure function
 * of the seed and the content:
 *
 * 1. the Plot's comms: a radio-or-numbers Channel (owned by the Cell's
 *    radio-operator), a courier Channel (owned by the Cell's courier, routed
 *    through a drawn Location), a dead-drop Channel (owned by the Cell org), and
 *    a Dead Drop at a dead-drop-allowing Location threaded with the Plot's
 *    materiel;
 * 2. the Hostile Service's comms: a radio-or-numbers Channel (owned by the
 *    hostile resident) and a Dead Drop at another allowing Location;
 * 3. the Station's comms: a radio Channel (owned by the Station org) and a Dead
 *    Drop at a third allowing Location.
 *
 * The three Dead Drops are placed at distinct allowing Locations when the city
 * has at least three; a smaller allowing set reuses Locations (the ids stay
 * distinct because they fold in the owner), so the function never fails for want
 * of sites. Every Channel owner is a real generated org or NPC, and every drop
 * sits at a dead-drop-allowing Location.
 *
 * The game `start` time (callers pass `WorldState.time` — day 0, morning) is the
 * floor for every schedule's first firing.
 *
 * Throws when the generated city has no dead-drop-allowing Location — that is a
 * content/city gap (the core pack always marks several types), not a runtime
 * condition to paper over.
 */
export function generateComms(
  prng: Prng,
  content: ContentSet,
  city: City,
  orgs: GeneratedOrgs,
  principals: GeneratedPrincipals,
  plot: PlotState,
  start: GameTime,
): GeneratedComms {
  const allowing = deadDropLocations(city, content);
  if (allowing.length === 0) {
    throw new Error(
      'generateComms(): the generated city has no dead-drop-allowing Location; ' +
        'check that at least one Location Type sets allowsDeadDrops',
    );
  }

  const channels: Record<ChannelId, Channel> = {};
  const deadDrops: Record<DeadDropId, DeadDrop> = {};
  const sitesByLoc = new Map<LocId, DeadDropId[]>();

  const addChannel = (channel: Channel): ChannelId => {
    channels[channel.id] = channel;
    return channel.id;
  };
  const addDrop = (drop: DeadDrop): DeadDropId => {
    deadDrops[drop.id] = drop;
    const list = sitesByLoc.get(drop.loc);
    if (list === undefined) {
      sitesByLoc.set(drop.loc, [drop.id]);
    } else {
      list.push(drop.id);
    }
    return drop.id;
  };

  // Place the three operations' drops at distinct allowing Locations when the
  // city has them; a smaller set cycles, and ids still differ by owner.
  const dropLocFor = (index: number): Location => allowing[index % allowing.length];

  // --- 1. The Plot (the Cell's comms) ------------------------------------
  // Owner people: the radio-operator carries the radio/numbers link, the
  // courier carries the courier run. Both are always in the Cell roster; fall
  // back to the Cell org if a role is somehow absent.
  const radioOperator =
    cellMemberByArchetype(principals, 'cell-radio-operator') ?? orgs.cell.id;
  const courier = cellMemberByArchetype(principals, 'cell-courier') ?? orgs.cell.id;

  // A radio or a numbers broadcast — both are interceptable (Req 25.1).
  const plotSignalKind: ChannelKind = prng.bool(0.5) ? 'radio' : 'numbers';
  const plotSignal = addChannel({
    id: channelIdOf(ownerSlug(radioOperator), 'signal'),
    kind: plotSignalKind,
    owner: radioOperator,
    schedule: drawSchedule(prng, start),
  });

  // The courier run passes through a drawn Location (any Location in the city).
  const courierRouteLoc = prng.pick(
    (Object.keys(city.locations) as LocId[]).sort(),
  );
  const plotCourier = addChannel({
    id: channelIdOf(ownerSlug(courier), 'courier'),
    kind: 'courier',
    owner: courier,
    schedule: drawSchedule(prng, start),
    route: courierRouteLoc,
  });

  // The dead-drop Channel is owned by the Cell org as a whole.
  const plotDropChannel = addChannel({
    id: channelIdOf(ownerSlug(orgs.cell.id), 'drop'),
    kind: 'dead-drop',
    owner: orgs.cell.id,
    schedule: drawSchedule(prng, start),
  });

  // The Plot's Dead Drop, threaded with the operation's materiel so the drop
  // the player can seize carries something real (Req 24.5).
  const plotDropLoc = dropLocFor(0);
  const materiel: ItemId = revealTruth(plot.materiel);
  const plotDrop = addDrop({
    id: deadDropIdOf(ownerSlug(orgs.cell.id), plotDropLoc.id),
    loc: plotDropLoc.id,
    owner: orgs.cell.id,
    contents: [materiel],
  });

  // --- 2. The Hostile Service --------------------------------------------
  const hostileResident = principals.hostile[0] ?? orgs.hostile.id;
  const hostileSignalKind: ChannelKind = prng.bool(0.5) ? 'radio' : 'numbers';
  const hostileSignal = addChannel({
    id: channelIdOf(ownerSlug(hostileResident), 'signal'),
    kind: hostileSignalKind,
    owner: hostileResident,
    schedule: drawSchedule(prng, start),
  });

  const hostileDropLoc = dropLocFor(1);
  const hostileDrop = addDrop({
    id: deadDropIdOf(ownerSlug(orgs.hostile.id), hostileDropLoc.id),
    loc: hostileDropLoc.id,
    owner: orgs.hostile.id,
    contents: [],
  });

  // --- 3. The Station -----------------------------------------------------
  const stationSignal = addChannel({
    id: channelIdOf(ownerSlug(orgs.station.id), 'signal'),
    kind: 'radio',
    owner: orgs.station.id,
    schedule: drawSchedule(prng, start),
  });

  const stationDropLoc = dropLocFor(2);
  const stationDrop = addDrop({
    id: deadDropIdOf(ownerSlug(orgs.station.id), stationDropLoc.id),
    loc: stationDropLoc.id,
    owner: orgs.station.id,
    contents: [],
  });

  const deadDropSitesByLocation: Record<LocId, readonly DeadDropId[]> = {};
  for (const [loc, ids] of sitesByLoc) {
    deadDropSitesByLocation[loc] = ids;
  }

  return {
    channels,
    deadDrops,
    deadDropSitesByLocation,
    plotChannels: [plotSignal, plotCourier, plotDropChannel],
    hostileChannels: [hostileSignal],
    stationChannels: [stationSignal],
    plotDrop,
    hostileDrop,
    stationDrop,
  };
}

// ---------------------------------------------------------------------------
// Applying drop sites to the city
// ---------------------------------------------------------------------------

/**
 * Return a copy of the city with each Location's `deadDropSites` populated from
 * a {@link GeneratedComms}. City generation leaves `deadDropSites` empty (task
 * 5.1); this is the pure step that binds the generated drops back onto their
 * Locations, so `WorldState.city.locations[l].deadDropSites` lists the drops at
 * `l`. A Location with no drop keeps its empty list. Pure: it builds a new city
 * record and never mutates the input.
 */
export function withDeadDropSites(city: City, comms: GeneratedComms): City {
  const locations: Record<LocId, Location> = {};
  for (const [id, loc] of Object.entries(city.locations) as [LocId, Location][]) {
    const sites = comms.deadDropSitesByLocation[id];
    locations[id] =
      sites === undefined ? loc : { ...loc, deadDropSites: [...sites] };
  }
  return { ...city, locations };
}

// ---------------------------------------------------------------------------
// Invariants (exported for tests / later tasks)
// ---------------------------------------------------------------------------

/** True when a Channel's owner is one of the generated orgs or NPCs. */
export function ownerIsReal(
  owner: CommsOwner,
  orgs: GeneratedOrgs,
  principals: GeneratedPrincipals,
): boolean {
  if (owner in orgs.orgs) {
    return true;
  }
  return owner in principals.npcs;
}

/** Order Channels by their time of first firing (for a stable report). */
export function compareScheduleStart(a: ChannelSchedule, b: ChannelSchedule): number {
  return timeToPhases(a.start) - timeToPhases(b.start);
}
