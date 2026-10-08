/**
 * The Player-View projection shapes and the pure functions that build them
 * (design, "Engine API (`player-view/api`)", "Player Aids", "TUI"; Requirements
 * 2.2, 13.5).
 *
 * A *projection* is the view-safe slice of the engine's state the TUI renders.
 * Task 16.1 owns four of them — the scene, the "here" panel, the Documents list
 * and the Document reader — plus the Case File surface the {@link EngineApi}
 * re-exposes. Each is built by a pure function here, so the facade
 * (`./engine-api.ts`) is a thin wrapper that holds the live state and forwards.
 *
 * ## Truth isolation (Requirement 2.2; Property 3)
 *
 * Every projection in this module is built from view-safe surface only:
 *
 * - a {@link import('@tradecraft/engine').Location}'s name, description,
 *   atmosphere, risk and crowd — all facts fixed at generation, no
 *   {@link import('@tradecraft/engine').Truth} field;
 * - the day's {@link import('@tradecraft/engine').Weather} label, derived from
 *   the seed and the day on an isolated stream;
 * - a visible person's **descriptor** (if the player has not identified them) or
 *   **persona name** (if they have), via the engine's identity-aware labelling;
 * - a {@link import('@tradecraft/engine').Document}'s title, kind, date and
 *   fact-layer body — Documents carry no truth field by construction; and
 * - the {@link CaseFile}'s Claims, which are the player's own record and hold no
 *   truth value, true allegiance, MICE profile or concealed Proposition.
 *
 * Two things this module deliberately does **not** do:
 *
 * - It never reads `npc.apparentAllegiance`. Task 26.5 made apparent allegiance
 *   a cover-derived, engine-side ground-truth structure; the player learns a
 *   person's apparent affiliation only from Claims and Dossiers, so the People/
 *   scene surface here surfaces no affiliation from the NPC record at all. The
 *   scene and "here" panels label a person by name-or-descriptor and nothing
 *   more; affiliation is a People-view concern (task 16.3) sourced from the Case
 *   File.
 * - It never touches the Truth Store. The only engine imports are shape
 *   vocabulary and the pure, view-safe labelling/scene/crowd helpers.
 */

import {
  crowdAt,
  formatDate,
  isIdentified,
  relationshipTrust,
  sceneAt,
  travelCost,
  visibleNpcsAt,
  weatherForDay,
  STATION_LOCATION_TYPE,
  type AllegianceCategory,
  type CrowdLevel,
  type DeadDrop,
  type DeadDropId,
  type DistrictId,
  type Document,
  type DocId,
  type EntityId,
  type GameTime,
  type ItemId,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
  type UnkId,
  type CityWeather,
  type WorldState,
} from '@tradecraft/engine';
import type { CityData } from '@tradecraft/content';

import type { AliasResolver, CaseFile, Claim } from '../casefile/casefile.js';
import { isAliasPredicate } from '../casefile/casefile.js';
import { knownLocationStatus } from '../city/city-views.js';

function statusField(state: WorldState, loc: string): { readonly status: string } | Record<string, never> {
  const status = knownLocationStatus(state, loc);
  return status === undefined ? {} : { status };
}

// ---------------------------------------------------------------------------
// Person labels (name-or-descriptor; Requirement 23.4)
// ---------------------------------------------------------------------------

/**
 * A person as the player sees them in a scene or the "here" panel: the id the
 * player holds for them — their known `npc:` id once identified, or their
 * allocated `unk:N` id while unidentified — and the `label` the TUI shows,
 * which is the NPC's **persona name** if the player has identified them and
 * their **physical descriptor** if not.
 *
 * This is exactly the design's "known name or descriptor" (`visible: { label }`
 * in the Narrator's `SceneDescriptor`). It carries no affiliation: a person's
 * apparent allegiance is learned from Claims and Dossiers (the People view, task
 * 16.3), never read off the NPC record, so nothing truth-adjacent rides along.
 */
export interface PersonLabel {
  /** The id the player holds: a known `npc:` id or an allocated `unk:` id. */
  readonly id: EntityId;
  /** The persona name (identified) or physical descriptor (unidentified). */
  readonly label: string;
}

/**
 * The view-safe label for an NPC the player can see at a Location: their persona
 * name when identified, their descriptor summary when not. Pure read of
 * view-safe surface (`persona.name`, `descriptor.summary`, the known set); never
 * a {@link Truth} field, and never `apparentAllegiance`.
 *
 * An unidentified NPC is shown under the stable `unk:` id the player has been
 * allocated for them, if one exists (surveillance/visible-persons listing
 * allocates it); until then the raw `npc:` id is used as the handle, but the
 * label is still the descriptor, so the name never leaks.
 */
export function personLabel(state: WorldState, npc: NpcId): PersonLabel {
  const record = state.npcs[npc];
  if (isIdentified(state, npc)) {
    return { id: npc, label: record?.persona.name ?? localOf(npc) };
  }
  // Unidentified: surface the descriptor under the allocated `unk:` id if we
  // have one, else under the raw id as a handle (the label stays the
  // descriptor, so the name is never revealed).
  const unk: UnkId | undefined = state.player.unkIds[npc];
  const label = record?.descriptor.summary ?? localOf(npc);
  return { id: unk ?? npc, label };
}

/** The local part of a namespaced entity id (`npc:ana` -> `ana`). */
function localOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
}

/**
 * Label every NPC scheduled at a Location at the current time, in the engine's
 * deterministic (`visibleNpcsAt`) order. The returned list is the "visible
 * persons" the scene and "here" panels render.
 */
export function visiblePersonLabels(
  state: WorldState,
  loc: LocId,
): PersonLabel[] {
  return visibleNpcsAt(state, loc).map((npc) => personLabel(state, npc));
}

// ---------------------------------------------------------------------------
// Scene view (design, "TUI" Scene pane; the Action Resolver's SceneDescriptor)
// ---------------------------------------------------------------------------

/**
 * The scene the main pane renders (design, "TUI": "Scene (main)"): the current
 * Location's name, description and atmosphere, its risk band, the day's time and
 * weather, the crowd level, and the visible persons by name-or-descriptor.
 *
 * This is the Player-View projection of the Action Resolver's
 * {@link import('@tradecraft/engine').SceneDescriptor} — the engine builds the
 * descriptor from view-safe `WorldState` fields; this adds the Location name,
 * the resolved weather and crowd band (which need the day's draw and the loaded
 * {@link CityData}), and the person labels. The Narrator's streamed *flavour* is
 * delivered through the {@link TurnStream}, not stored here, so a `SceneView` is
 * a pure function of state and content.
 */
export interface SceneView {
  readonly location: {
    readonly id: LocId;
    readonly name: string;
    /** The public Location Type id (e.g. `kaffeehaus`). */
    readonly type: string;
    /** Public tags only: `sector:<sector>` and `type:<type id>`. */
    readonly tags: readonly string[];
    /** The District the Location sits in (id and name). */
    readonly district: { readonly id: string; readonly name: string };
    readonly description: string;
    readonly atmosphere: readonly string[];
    readonly risk: number;
  };
  readonly time: GameTime;
  /** The day's weather label (e.g. "cold and clear"). */
  readonly weather: string;
  readonly crowd: CrowdLevel;
  /** Visible persons by name-or-descriptor (design `visible: { label }`). */
  readonly visible: readonly PersonLabel[];
}

/**
 * The "here" panel the side pane renders (design, "TUI": "Here (side) — the
 * current Location, crowd, weather, visible persons and allowed actions with
 * quotes"). This projection owns the Location/crowd/weather/visible-persons
 * slice; the allowed-actions-with-quotes slice is supplied by the facade's
 * `actions()` (task 16.1's facade forwards the engine `quote`; the full
 * per-action set is fleshed out as those actions land), so the panel is a thin
 * composition of this view and the action options.
 */
export interface HereView {
  readonly location: {
    readonly id: LocId;
    readonly name: string;
    /** The public Location Type id (e.g. `kaffeehaus`). */
    readonly type: string;
    /** Public tags only: `sector:<sector>` and `type:<type id>`. */
    readonly tags: readonly string[];
    /** The District the Location sits in (id and name). */
    readonly district: { readonly id: string; readonly name: string };
    readonly atmosphere: readonly string[];
    readonly risk: number;
    /** Whether the Location is public (known from game start; Req 21.8). */
    readonly public: boolean;
    /** Status the player last saw or read. Absent until they have learned one. */
    readonly status?: string;
  };
  readonly crowd: CrowdLevel;
  readonly weather: string;
  readonly visible: readonly PersonLabel[];
}

/**
 * Resolve the day's weather for a {@link WorldState}, deterministically from the
 * seed and the day on the isolated daily stream (Requirement 21.6). View-safe:
 * weather carries no truth, and the draw cannot perturb world generation.
 */
export function weatherNow(state: WorldState, cityData: CityData): CityWeather {
  // `weatherForDay` lives on the city module; re-derived here so the view stays
  // a pure function of state + content with no stored weather to keep in sync.
  return weatherForDay(state.meta.seed, state.city, cityData, state.time.day);
}

/**
 * The crowd band at a Location right now, resolving the day's weather for the
 * caller (Requirement 21.6). A Location the city does not hold reads as `empty`
 * rather than throwing — a defensive floor, since the player's Location always
 * exists.
 */
export function crowdNow(
  state: WorldState,
  cityData: CityData,
  loc: LocId,
): CrowdLevel {
  const place = state.city.locations[loc];
  if (place === undefined) {
    return 'empty';
  }
  return crowdAt(state.city, cityData, place, state.time, weatherNow(state, cityData));
}

/**
 * The public facts about a Location's kind and place: its Location Type id, its
 * District and the public tags derived from them. All of it is published
 * content the player can already see on the map, so none is truth. A web client
 * keys its music on these without needing the Location's hidden state.
 */
function locationPublicFacts(
  state: WorldState,
  loc: LocId,
): {
  readonly type: string;
  readonly tags: readonly string[];
  readonly district: { readonly id: string; readonly name: string };
} {
  const place = state.city.locations[loc];
  if (place === undefined) {
    return { type: '', tags: [], district: { id: '', name: '' } };
  }
  const district = state.city.districts[place.district];
  const tags = [`type:${place.type}`];
  if (district !== undefined) {
    tags.unshift(`sector:${district.sector}`);
  }
  return {
    type: place.type,
    tags,
    district: { id: place.district, name: district?.name ?? '' },
  };
}

/**
 * Build the {@link SceneView} for the player's current Location (or an explicit
 * Location, for a scene opened elsewhere). Composes the engine's
 * {@link sceneAt} descriptor with the Location name, the resolved weather and
 * crowd, and the visible-person labels.
 */
export function sceneView(
  state: WorldState,
  cityData: CityData,
  loc: LocId = state.player.loc,
): SceneView {
  const descriptor = sceneAt(state, loc);
  const place = state.city.locations[loc];
  return {
    location: {
      id: loc,
      name: place?.name ?? localOf(loc),
      ...locationPublicFacts(state, loc),
      description: descriptor.description,
      atmosphere: [...descriptor.atmosphere],
      risk: descriptor.risk,
    },
    time: state.time,
    weather: weatherNow(state, cityData).label,
    crowd: crowdNow(state, cityData, loc),
    visible: visiblePersonLabels(state, loc),
  };
}

/** Build the {@link HereView} for the player's current Location. */
export function hereView(
  state: WorldState,
  cityData: CityData,
  loc: LocId = state.player.loc,
): HereView {
  const place = state.city.locations[loc];
  return {
    location: {
      id: loc,
      name: place?.name ?? localOf(loc),
      ...locationPublicFacts(state, loc),
      atmosphere: place === undefined ? [] : [...place.atmosphere],
      risk: place?.risk ?? 0,
      public: place?.public ?? false,
      ...statusField(state, loc),
    },
    crowd: crowdNow(state, cityData, loc),
    weather: weatherNow(state, cityData).label,
    visible: visiblePersonLabels(state, loc),
  };
}

// ---------------------------------------------------------------------------
// Documents (design, "TUI": "Documents — a reader for newspapers, public
// texts, Dossiers, Cables and seized material")
// ---------------------------------------------------------------------------

/**
 * One entry in the Documents list: the handle and metadata the reader lists,
 * with a `read` flag so the TUI can mark unread Documents. The body is omitted
 * from the list (it is loaded by {@link documentView} on open) to keep the list
 * cheap. A Document carries no truth field, so every field here is view-safe.
 */
export interface DocumentListEntry {
  readonly id: DocId;
  readonly kind: Document['kind'];
  readonly title: string;
  readonly date: GameTime;
  /** The player-facing date string (`Day N, <phase>`). */
  readonly dateLabel: string;
  /** True once the player has read the Document (Requirement 30.4). */
  readonly read: boolean;
  /** Whether the Document is obtainable at the player's current Location. */
  readonly obtainableHere: boolean;
}

/**
 * The Documents list the reader shows (design "Documents"): the Documents the
 * player can currently open, newest first. A Document is listable when it is in
 * hand — it has already been read, or it is obtainable at the player's current
 * Location (a kiosk, library or bookshop for a public text; a delivered Dossier
 * or Cable has no `obtainableAt` and is always in hand).
 */
export interface DocumentListView {
  readonly documents: readonly DocumentListEntry[];
}

/**
 * The Document reader (design "Documents"): a single Document's metadata and its
 * rendered fact-layer `body`. The Narrator may elaborate around the body but
 * never contradict it; the body itself is composed deterministically with no
 * language model, so it is view-safe.
 */
export interface DocumentView {
  readonly id: DocId;
  readonly kind: Document['kind'];
  readonly title: string;
  readonly date: GameTime;
  readonly dateLabel: string;
  readonly body: string;
  readonly read: boolean;
}

/**
 * Whether a Document is obtainable at a Location: a Document with no
 * `obtainableAt` is "in hand" (a delivered Dossier or Cable) and obtainable
 * anywhere; one with an `obtainableAt` list is obtainable only at those
 * Locations. Mirrors the read action's obtainability rule.
 */
export function obtainableAt(doc: Document, loc: LocId): boolean {
  return doc.obtainableAt === undefined || doc.obtainableAt.includes(loc);
}

/**
 * Whether the player can currently see a Document in their list: it has been
 * read before (so it is in hand), or it is obtainable at their current
 * Location. Delivered Documents (no `obtainableAt`) are always visible.
 */
function listableFor(state: WorldState, doc: Document): boolean {
  if (state.player.readDocuments.includes(doc.id)) {
    return true;
  }
  return obtainableAt(doc, state.player.loc);
}

/** Order Documents newest first, ties broken by id for a total, stable order. */
function compareByDateDesc(a: Document, b: Document): number {
  if (a.date.day !== b.date.day) {
    return b.date.day - a.date.day;
  }
  if (a.date.phase !== b.date.phase) {
    return b.date.phase - a.date.phase;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Build the {@link DocumentListView} for the player's current state. */
export function documentListView(state: WorldState): DocumentListView {
  const read = new Set<DocId>(state.player.readDocuments);
  const documents = Object.values(state.documents)
    .filter((doc) => listableFor(state, doc))
    .sort(compareByDateDesc)
    .map((doc) => ({
      id: doc.id,
      kind: doc.kind,
      title: doc.title,
      date: doc.date,
      dateLabel: formatDate(doc.date),
      read: read.has(doc.id),
      obtainableHere: obtainableAt(doc, state.player.loc),
    }));
  return { documents };
}

/**
 * Build the {@link DocumentView} for a Document, or `undefined` if the id names
 * no Document the state holds. Reading a Document (adding its Claims to the Case
 * File) is the `read` *action*'s job (task 9.2); this projection only renders
 * the Document for display, so it is a pure read.
 */
export function documentView(
  state: WorldState,
  id: DocId,
): DocumentView | undefined {
  const doc = state.documents[id];
  if (doc === undefined) {
    return undefined;
  }
  return {
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    date: doc.date,
    dateLabel: formatDate(doc.date),
    body: doc.body,
    read: state.player.readDocuments.includes(doc.id),
  };
}

// ---------------------------------------------------------------------------
// Case File view (design "Engine API" `caseFile`; the view-safe Claim slice)
// ---------------------------------------------------------------------------

/**
 * A Claim as the Case File view presents it (design `ClaimView`). It is the Case
 * File's own {@link Claim} shape — source, Proposition, observation time, hedge
 * flag, the player's grade and links, and the computed relation — which already
 * holds no truth value. Exposed under the design's name so the TUI reads a
 * `ClaimView[]`.
 */
export type ClaimView = Claim;

/**
 * The filter the Case File list accepts (design `CaseFileFilter`): by the entity
 * a Claim concerns, by source kind, and by the player's grade. An omitted field
 * does not filter on that axis.
 */
export interface CaseFileFilter {
  /** Keep only Claims whose subject or object is this entity (alias-resolved). */
  readonly entity?: EntityId;
  /** Keep only Claims from this source kind (`npc`, `intercept`, …). */
  readonly source?: Claim['source']['kind'];
  /** Keep only Claims the player graded to this value. */
  readonly grade?: NonNullable<Claim['grade']>;
}

/**
 * The Case File Claims matching a filter, in the Case File's own order
 * (observation time, then id). The entity filter is alias-aware: it keeps a
 * Claim whose alias-resolved subject or object matches the alias-resolved
 * filter entity, so a filter on `npc:viktor` also catches Claims about an
 * `unk:` id the player has linked to him. Pure over the Case File's view-safe
 * Claims.
 */
export function listClaims(cf: CaseFile, filter: CaseFileFilter = {}): ClaimView[] {
  const canon = cf.aliases();
  const target = filter.entity === undefined ? undefined : canon(filter.entity);
  return cf.list().filter((claim) => {
    if (filter.source !== undefined && claim.source.kind !== filter.source) {
      return false;
    }
    if (filter.grade !== undefined && !sameGrade(claim.grade, filter.grade)) {
      return false;
    }
    if (target !== undefined && !concernsEntity(claim, target, canon)) {
      return false;
    }
    return true;
  });
}

/**
 * Compare two Admiralty Grades by value. A Grade is a `{ reliability,
 * credibility }` object, so a filter grade and a Claim's grade must match on
 * both parts rather than by reference. An undefined Claim grade never matches a
 * filter grade.
 */
function sameGrade(
  a: Claim['grade'] | undefined,
  b: NonNullable<Claim['grade']>,
): boolean {
  return a !== undefined && a.reliability === b.reliability && a.credibility === b.credibility;
}

/** True when a Claim's alias-resolved subject or object is `target`. */
function concernsEntity(
  claim: Claim,
  target: EntityId,
  canon: (id: EntityId) => EntityId,
): boolean {
  if (canon(claim.prop.subject) === target) {
    return true;
  }
  const { object } = claim.prop;
  return typeof object === 'string' && canon(object) === target;
}

// ---------------------------------------------------------------------------
// Map view (design, "Player Aids": "Map view"; Requirements 33.3, 33.5)
// ---------------------------------------------------------------------------
//
// The Map view is a *Player View projection* (Req 33.5): it is built purely
// from the engine's view-safe city model (`WorldState.city` — the Districts,
// Locations and Routes, all facts fixed at generation) and the player's own
// view-safe knowledge (`player.known.drops`, `player.loc`, the public-Location
// flag). It reads no Truth field and no Case File truth. The TUI draws a
// District adjacency list with travel costs, not a spatial map (design).

/** A known Dead Drop as the Map view lists it (design: "known Dead Drops"). */
export interface MapDeadDrop {
  readonly id: DeadDropId;
  /** The Location the drop sits at. */
  readonly loc: LocId;
  /** The Location's player-facing name, for display. */
  readonly locName: string;
}

/**
 * One known Location on the Map (design: "known Locations by District … opening
 * hours, risk ratings, current crowd levels, known Dead Drops and the last
 * visit to each Location").
 *
 * `hours` is the per-phase open/closed table fixed at generation; `risk` is the
 * Location's risk rating; `crowd` is the band *right now*, derived from the
 * day's weather draw; `deadDrops` are the Dead Drops at this Location the player
 * knows about (a subset of the Location's sites, filtered to `player.known`);
 * `lastVisit` is when the player was last here, or `undefined` until the Sim
 * tracks visits. Every field is view-safe.
 */
export interface MapLocation {
  readonly id: LocId;
  readonly name: string;
  readonly type: string;
  /** Whether the Location is public (known from game start; Req 21.8). */
  readonly public: boolean;
  readonly risk: number;
  /** Open (`true`) or closed (`false`) in each of the four engine phases. */
  readonly hours: Readonly<Record<Phase, boolean>>;
  /** The crowd band at this Location right now. */
  readonly crowd: CrowdLevel;
  /** The known Dead Drops at this Location. */
  readonly deadDrops: readonly MapDeadDrop[];
  /** The travel cost in phases from the player's current Location. */
  readonly travelCost: number;
  /**
   * When the player last visited this Location, or `undefined` if never (or
   * until the Turn Pipeline tracks visits — the Sim does not record last-visit
   * yet, so this is a documented seam the player-aid shape already carries).
   */
  readonly lastVisit?: GameTime;
  /** Status last seen or read. Omitted until the player has learned one. */
  readonly status?: string;
}

/** A Route on the Map, with its phase cost (design: "Routes with travel costs"). */
export interface MapRoute {
  readonly from: DistrictId;
  readonly to: DistrictId;
  readonly fromName: string;
  readonly toName: string;
  /** The Route's phase cost (`0` or `1`). */
  readonly cost: number;
}

/**
 * One District on the Map, with the known Locations that sit in it and the
 * Routes that leave it (design: "known Locations grouped by District … a
 * District adjacency list with costs").
 */
export interface MapDistrict {
  readonly id: DistrictId;
  readonly name: string;
  readonly sector: string;
  /** The known Locations in this District, ordered by id. */
  readonly locations: readonly MapLocation[];
  /** The Routes leaving this District, with their costs (adjacency list). */
  readonly routes: readonly MapRoute[];
}

/**
 * The Map view (design, "Player Aids"; Requirements 33.3, 33.5): the player's
 * known Locations grouped by District, each District's outgoing Routes with
 * their travel costs, and every known Dead Drop in one list. The player's
 * current Location is named so the TUI can mark it and quote travel from it.
 */
export interface MapView {
  /** The current Location the costs and crowd are measured from. */
  readonly here: LocId;
  /** Districts that hold at least one known Location, ordered by id. */
  readonly districts: readonly MapDistrict[];
  /** Every known Dead Drop, ordered by id. */
  readonly deadDrops: readonly MapDeadDrop[];
}

/**
 * Whether the player knows about a Location: it is public (known from game
 * start, Req 21.8), it is the player's own Station, or it is in the player's
 * known-entity set (learned through play). Pure read of view-safe surface.
 *
 * The Station is not public and the Starting Brief does not list it among the
 * known entities, but the player reports there and it is the only place
 * `intercept` and `cable` are allowed, so the Map shows it and the action
 * catalogue offers travel to it.
 */
export function isKnownLocation(state: WorldState, loc: LocId): boolean {
  const place = state.city.locations[loc];
  if (place === undefined) {
    return false;
  }
  return (
    place.public ||
    isStationLocationType(place.type) ||
    state.player.known.entities.includes(loc)
  );
}

/**
 * Whether a Location Type id is the Station HQ type, bare or namespaced: the
 * rule the engine's `isAtStation` applies to the player's Location.
 */
function isStationLocationType(type: string): boolean {
  return (
    type === STATION_LOCATION_TYPE || type.endsWith(`/${STATION_LOCATION_TYPE}`)
  );
}

/** Order ids for a total, stable listing. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Build the {@link MapView} for the player's current state (design, "Player
 * Aids"; Requirements 33.3, 33.5).
 *
 * A pure projection: it reads the city's Districts, Locations and Routes and the
 * player's known set and known drops, resolves the crowd band for each known
 * Location from the day's weather, and groups the known Locations by District.
 * Each District lists only its *known* Locations and its outgoing Routes with
 * their phase costs (the adjacency list the TUI draws). Known Dead Drops are the
 * drops the player holds in `player.known.drops`, surfaced both under their
 * Location and in a flat list. No Truth field is read.
 */
export function mapView(state: WorldState, cityData: CityData): MapView {
  const here = state.player.loc;
  const knownDrops = new Set<DeadDropId>(state.player.known.drops);

  // Resolve a known Dead Drop to its view shape, or `undefined` if the state
  // holds no such drop (a stale id) or it is not actually at a Location.
  const dropView = (id: DeadDropId): MapDeadDrop | undefined => {
    const drop: DeadDrop | undefined = state.deadDrops[id];
    if (drop === undefined) {
      return undefined;
    }
    const place = state.city.locations[drop.loc];
    return {
      id,
      loc: drop.loc,
      locName: place?.name ?? localOf(drop.loc),
    };
  };

  const allKnownDrops: MapDeadDrop[] = [...knownDrops]
    .map(dropView)
    .filter((d): d is MapDeadDrop => d !== undefined)
    .sort((a, b) => compareIds(a.id, b.id));

  // Group known Locations by their District.
  const byDistrict = new Map<DistrictId, MapLocation[]>();
  const locations = Object.values(state.city.locations)
    .filter((loc) => isKnownLocation(state, loc.id))
    .sort((a, b) => compareIds(a.id, b.id));

  for (const loc of locations) {
    const drops = loc.deadDropSites
      .filter((id) => knownDrops.has(id))
      .map(dropView)
      .filter((d): d is MapDeadDrop => d !== undefined)
      .sort((a, b) => compareIds(a.id, b.id));
    const entry: MapLocation = {
      id: loc.id,
      name: loc.name,
      type: loc.type,
      public: loc.public,
      risk: loc.risk,
      hours: loc.hours,
      crowd: crowdNow(state, cityData, loc.id),
      deadDrops: drops,
      travelCost: travelCost(state.city, here, loc.id, false),
      ...statusField(state, loc.id),
    };
    const bucket = byDistrict.get(loc.district);
    if (bucket === undefined) {
      byDistrict.set(loc.district, [entry]);
    } else {
      bucket.push(entry);
    }
  }

  // Outgoing Routes per District, with the neighbour's name for display.
  const routesByDistrict = new Map<DistrictId, MapRoute[]>();
  const nameOfDistrict = (id: DistrictId): string =>
    state.city.districts[id]?.name ?? localOf(id);
  const addRoute = (from: DistrictId, to: DistrictId, cost: number): void => {
    const route: MapRoute = {
      from,
      to,
      fromName: nameOfDistrict(from),
      toName: nameOfDistrict(to),
      cost,
    };
    const bucket = routesByDistrict.get(from);
    if (bucket === undefined) {
      routesByDistrict.set(from, [route]);
    } else {
      bucket.push(route);
    }
  };
  for (const route of state.city.routes) {
    // Routes are undirected; list the edge from both of its Districts.
    addRoute(route.a, route.b, route.cost);
    addRoute(route.b, route.a, route.cost);
  }

  const districts: MapDistrict[] = [...byDistrict.entries()]
    .map(([id, locs]) => {
      const district = state.city.districts[id];
      const routes = (routesByDistrict.get(id) ?? [])
        .slice()
        .sort((a, b) => compareIds(a.to, b.to));
      return {
        id,
        name: district?.name ?? localOf(id),
        sector: district?.sector ?? '',
        locations: locs.sort((a, b) => compareIds(a.id, b.id)),
        routes,
      };
    })
    .sort((a, b) => compareIds(a.id, b.id));

  return { here, districts, deadDrops: allKnownDrops };
}

// ---------------------------------------------------------------------------
// People view (design, "Player Aids": "People view"; Requirements 33.4, 33.5)
// ---------------------------------------------------------------------------
//
// The People view is a *Player View projection* (Req 33.5). It is built from
// two view-safe sources only:
//
//  - the engine's view-safe person surface — the persona name (once
//    identified), the physical descriptor, and the known/`unk:` listing; and
//  - the player's Case File — the Claims, from which it derives apparent
//    affiliation (Req 2.2, 33.4: from Claims and Dossiers only), linked aliases
//    (held `IS_ALIAS_OF` Claims), last sighting (the latest observation time of
//    a Claim concerning the person) and the Claim counts.
//
// Three things it deliberately does NOT read (Property 3; Req 2.2, 33.4):
//
//  - `npc.apparentAllegiance`. Task 26.5 made apparent allegiance a cover-
//    derived, engine-side ground-truth structure; the player's view of a
//    person's affiliation comes from Claims and Dossiers alone, never off the
//    NPC record. The affiliation here is resolved from Case File Claims.
//  - the true allegiance and the MICE profile — Truth-branded, never in view.
//  - the relationship *suspicion* — the design is explicit that the rapport
//    band is from trust and "suspicion is not shown". Only `relationshipTrust`
//    (view-safe) is read; the suspicion scalar never crosses into this view.

/**
 * A rapport band (design, "People view": "a rapport band (cold, neutral, warm
 * or trusted, from trust; suspicion is not shown)"). Derived from the
 * relationship *trust* alone.
 */
export type RapportBand = 'cold' | 'neutral' | 'warm' | 'trusted';

/** The trust thresholds that map a `[0, 1]` trust value to a {@link RapportBand}. */
const RAPPORT_THRESHOLDS: ReadonlyArray<{ readonly max: number; readonly band: RapportBand }> = [
  { max: 0.25, band: 'cold' },
  { max: 0.5, band: 'neutral' },
  { max: 0.75, band: 'warm' },
  { max: Infinity, band: 'trusted' },
];

/** Map a trust value in `[0, 1]` to its {@link RapportBand}. */
export function rapportBandOf(trust: number): RapportBand {
  for (const { max, band } of RAPPORT_THRESHOLDS) {
    if (trust < max) {
      return band;
    }
  }
  return 'trusted';
}

/**
 * One person on the People view (design, "People view"; Requirement 33.4): a
 * known NPC or an Unidentified Subject, with everything the design lists.
 *
 * `id` is the id the player holds: the `npc:` id once identified, or the
 * allocated `unk:` id while not. `identified` says which. `label` is the persona
 * name (identified) or the physical descriptor (not) — never the name of an
 * unidentified person. `apparentAffiliation` is derived from Case File Claims
 * and Dossiers only (never the NPC record), `undefined` when no Claim asserts an
 * affiliation. `aliases` are the other ids the player's held `IS_ALIAS_OF`
 * Claims merge onto this person. `lastSighting` is the latest observation time
 * of a Claim concerning them, `undefined` if none. `asset` is `true` when the
 * player has recruited them (view-safe recruited flag), `false` otherwise.
 * `rapport` is the band from trust (suspicion is never shown). The two Claim
 * counts are how many Case File Claims name this person as *subject* and how
 * many come from them as a *source*.
 */
export interface PersonEntry {
  readonly id: EntityId;
  readonly identified: boolean;
  readonly label: string;
  /** Apparent affiliation from Claims and Dossiers only (never the NPC record). */
  readonly apparentAffiliation?: string;
  /** Other ids merged onto this person by held `IS_ALIAS_OF` Claims. */
  readonly aliases: readonly EntityId[];
  /** The latest observation time of a Claim concerning the person. */
  readonly lastSighting?: GameTime;
  /** Whether the player has recruited this person as an Asset. */
  readonly asset: boolean;
  /** The rapport band from trust (suspicion is not shown). */
  readonly rapport: RapportBand;
  /** How many Case File Claims name this person as their subject. */
  readonly claimsAsSubject: number;
  /** How many Case File Claims come from this person as a source. */
  readonly claimsAsSource: number;
}

/** A known organisation on the People view (design: "a parallel list of known organisations"). */
export interface OrgEntry {
  readonly id: OrgId;
  readonly name: string;
  /** The apparent-allegiance category the org projects (view-safe). */
  readonly allegiance: AllegianceCategory;
}

/** A known item on the People view (design: "and items"). */
export interface ItemEntry {
  readonly id: ItemId;
  /** How many Case File Claims name this item as their subject or object. */
  readonly claimCount: number;
}

/**
 * The People view (design, "Player Aids"; Requirements 33.4, 33.5): the known
 * NPCs and Unidentified Subjects, plus the parallel lists of known
 * organisations and items.
 */
export interface PeopleView {
  readonly people: readonly PersonEntry[];
  readonly orgs: readonly OrgEntry[];
  readonly items: readonly ItemEntry[];
}

/** The local name of a namespaced predicate (`core/MEMBER_OF` -> `MEMBER_OF`). */
function localPredicate(predicate: string): string {
  const slash = predicate.lastIndexOf('/');
  return slash === -1 ? predicate : predicate.slice(slash + 1);
}

/**
 * The apparent affiliation a set of Claims asserts about a person, derived from
 * Claims and Dossiers only (Req 2.2, 33.4). HQ and sources record affiliation
 * the way the Dossier composer does:
 *
 *  - a `MEMBER_OF` Claim whose object is a known org names that org's
 *    apparent-allegiance category; and
 *  - a `WORKS_FOR` Claim whose object is a text literal names cover employment.
 *
 * The first such Claim (in the Case File's stable order) wins; with neither, the
 * person has no affiliation on record and this returns `undefined`. Nothing is
 * read off the NPC record, so this can only ever surface what a Claim says.
 */
function apparentAffiliationFromClaims(
  claims: readonly Claim[],
  orgs: WorldState['orgs'],
): string | undefined {
  for (const claim of claims) {
    const predicate = localPredicate(claim.prop.predicate);
    if (predicate === 'MEMBER_OF' && typeof claim.prop.object === 'string') {
      const org = orgs[claim.prop.object as OrgId];
      if (org !== undefined) {
        return org.allegiance;
      }
    }
  }
  for (const claim of claims) {
    const predicate = localPredicate(claim.prop.predicate);
    const { object } = claim.prop;
    if (predicate === 'WORKS_FOR' && typeof object === 'object' && object.kind === 'text') {
      return `employed by ${object.value}`;
    }
  }
  return undefined;
}

/**
 * The view-safe recruited flag for an NPC: `true` when the relationship record
 * carries a truthy `recruited` field. `Relationship` is a task-18 skeleton, so
 * this reads the field defensively (if present) and never widens the shape —
 * mirroring how `relationshipTrust` reads `trust`. The recruited flag is
 * view-safe (the player knows whom they have recruited); the Asset's hidden
 * reliability and loyalty are not read here.
 */
function isAsset(state: WorldState, npc: NpcId): boolean {
  const rel = state.relationships[npc] as { readonly recruited?: boolean } | undefined;
  return rel?.recruited === true;
}

/**
 * The {@link NpcId}s the player holds knowledge of as *people*: every NPC the
 * player has identified (an `npc:` id in `player.known.entities`) and every NPC
 * the player has observed but not identified (a key in the `unk:` allocation
 * table). Returned as a de-duplicated, id-sorted list of NPC ids; whether each
 * is shown by name or descriptor is decided per entry by {@link isIdentified}.
 */
function knownPeopleNpcs(state: WorldState): NpcId[] {
  const ids = new Set<NpcId>();
  for (const id of state.player.known.entities) {
    if (id.startsWith('npc:') && state.npcs[id as NpcId] !== undefined) {
      ids.add(id as NpcId);
    }
  }
  for (const npc of Object.keys(state.player.unkIds) as NpcId[]) {
    if (state.npcs[npc] !== undefined) {
      ids.add(npc);
    }
  }
  return [...ids].sort(compareIds);
}

/**
 * Build the {@link PeopleView} for the player's current state (design, "Player
 * Aids"; Requirements 33.4, 33.5).
 *
 * A pure projection over the engine's view-safe person surface and the Case
 * File. For each known person it resolves name-or-descriptor, apparent
 * affiliation (from Claims and Dossiers only), linked aliases (held
 * `IS_ALIAS_OF` Claims), the last sighting (latest Claim observation time), the
 * recruited (Asset) flag, the rapport band (from trust; suspicion is not read),
 * and the two Claim counts. It never reads `npc.apparentAllegiance`, the true
 * allegiance, the MICE profile or the relationship suspicion.
 */
export function peopleView(state: WorldState, caseFile: CaseFile): PeopleView {
  const claims = caseFile.list();
  const canon: AliasResolver = caseFile.aliases();

  // Pre-index Claims by their alias-resolved subject/object and by their NPC
  // source, so each person's counts and affiliation are one pass over Claims.
  const people = knownPeopleNpcs(state).map((npc): PersonEntry => {
    const canonId = canon(npc);
    const concerning: Claim[] = [];
    let claimsAsSubject = 0;
    let claimsAsSource = 0;
    const aliasIds = new Set<EntityId>();
    let lastSighting: GameTime | undefined;

    for (const claim of claims) {
      const subj = canon(claim.prop.subject);
      const obj =
        typeof claim.prop.object === 'string' ? canon(claim.prop.object) : undefined;
      const touchesPerson = subj === canonId || obj === canonId;

      if (touchesPerson) {
        concerning.push(claim);
        if (lastSighting === undefined || compareTimeDesc(claim.observedAt, lastSighting) > 0) {
          lastSighting = claim.observedAt;
        }
      }
      if (subj === canonId) {
        claimsAsSubject += 1;
      }
      if (claim.source.kind === 'npc' && canon(claim.source.npc) === canonId) {
        claimsAsSource += 1;
      }
      // Collect alias ids from held IS_ALIAS_OF Claims that touch this person.
      if (isAliasPredicate(claim.prop.predicate) && touchesPerson) {
        const { subject, object } = claim.prop;
        if (subject !== npc) {
          aliasIds.add(subject);
        }
        if (typeof object === 'string' && object !== npc) {
          aliasIds.add(object);
        }
      }
    }

    const label = personLabel(state, npc);
    return {
      id: label.id,
      identified: isIdentified(state, npc),
      label: label.label,
      apparentAffiliation: apparentAffiliationFromClaims(concerning, state.orgs),
      aliases: [...aliasIds].sort(compareIds),
      lastSighting,
      asset: isAsset(state, npc),
      rapport: rapportBandOf(relationshipTrust(state, npc)),
      claimsAsSubject,
      claimsAsSource,
    };
  });

  // The parallel list of known organisations (view-safe: name + apparent
  // allegiance category; membership is never listed).
  const orgs: OrgEntry[] = (state.player.known.entities.filter((id) => id.startsWith('org:')) as OrgId[])
    .filter((id) => state.orgs[id] !== undefined)
    .sort(compareIds)
    .map((id) => {
      const org = state.orgs[id];
      return { id, name: org.name, allegiance: org.allegiance };
    });

  // The parallel list of known items, with how many Claims mention each.
  const items: ItemEntry[] = (state.player.known.entities.filter((id) => id.startsWith('item:')) as ItemId[])
    .sort(compareIds)
    .map((id) => {
      const canonId = canon(id);
      let claimCount = 0;
      for (const claim of claims) {
        const subj = canon(claim.prop.subject);
        const obj =
          typeof claim.prop.object === 'string' ? canon(claim.prop.object) : undefined;
        if (subj === canonId || obj === canonId) {
          claimCount += 1;
        }
      }
      return { id, claimCount };
    });

  return { people, orgs, items };
}

/**
 * Compare two {@link GameTime}s, later first. Positive when `a` is later than
 * `b`. Used to pick the latest sighting without pulling in the engine's
 * `compareTime` (which orders earliest-first).
 */
function compareTimeDesc(a: GameTime, b: GameTime): number {
  if (a.day !== b.day) {
    return a.day - b.day;
  }
  return a.phase - b.phase;
}
