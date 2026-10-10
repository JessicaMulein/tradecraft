/**
 * Drive sessions (street-ops task 6).
 *
 * A step quotes the phase boundaries its ticks cross. The turn pipeline
 * advances the clock by that quote. Closing the session quotes one phase when
 * none have been charged, so a drive costs at least one phase.
 */

import { z } from 'zod';

import { sceneAt, visibleNpcsAt } from '../action/action.js';
import type { ActionQuote, ResolveResult, ResolverContext } from '../action/result.js';
import type { ActionExtension } from '../extension/registry.js';
import { accrueExposure } from '../hostile/beliefs.js';
import { asTruth, revealTruth, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { balance, debit } from '../station/ledger.js';

import {
  assessBluff,
  claimsFor,
  fileStory,
  templateFits,
  type StoryTemplate,
} from './bluff.js';
import type { CheckpointKind, SpeedClass, StreetPhase } from './content.js';
import type { StreetGraph } from './graph.js';
import { pinFrontage, RELATIVES, type Relative } from './graph.js';
import { maneuversAt, type ManeuverOffer, type SurveillanceRoute } from './maneuver.js';
import { learnAid, learnDocument, learnLocal, learnTravel, type MapSheet } from './knowledge.js';
import {
  incidentForBluff,
  incidentForCheckpoint,
  incidentForTail,
  mergePlates,
  noteServices,
  parkedForTravel,
  postureOf,
  streetEvents,
  type StreetIncident,
} from './hooks.js';
import {
  alight,
  board,
  canRide,
  composureFor,
  composureTags,
  concealedCargo,
  deliveryFor,
  FOUND_PASSENGER_EXPOSURE,
  syncConcealment,
  toSpot,
  withCrossed,
  type VehicleSpot,
} from './passenger.js';
import {
  aheadLine,
  avoidanceDelta,
  checkpointDelayTicks,
  checkpointsAhead,
  checkpointsCrossed,
  policePressure,
  searchLevel,
  vehicleCheck,
  withCrackdownPosts,
  withPressureStop,
} from './checkpoint.js';
import {
  emptyStreetOpsState,
  emptyStreetOpsTruth,
  type DriveState,
  type StreetOpsState,
  type StreetOpsTruth,
  type VehicleRecord,
} from './state.js';
import { streetReplayHeader, streetSubstream } from './stream.js';
import { stepStreet, watchedExposure, type MethodOffer, type TailProfileOffer } from './tail.js';

export interface MapOffer extends MapSheet {
  readonly id: string;
  readonly title: string;
  readonly era: { readonly from: number; readonly to: number };
  readonly price: number;
  readonly at?: string;
}

export interface VehicleOffer {
  readonly id: string;
  readonly name: string;
  readonly era: { readonly from: number; readonly to: number };
  readonly speed: SpeedClass;
  readonly seats: number;
  /** How easily the vehicle is recognised. Stays on the offer, never on the player's record. */
  readonly conspicuousness: number;
  readonly spots: readonly VehicleSpot[];
}

export interface StreetOpsRuntime {
  readonly ticksPerPhase: number;
  readonly speeds: Readonly<Record<SpeedClass, number>>;
  readonly graphs: readonly StreetGraph[];
  readonly vehicles: readonly VehicleOffer[];
  readonly maneuvers: readonly ManeuverOffer[];
  readonly tails: readonly TailProfileOffer[];
  readonly methods: readonly MethodOffer[];
  readonly routes: readonly SurveillanceRoute[];
  readonly lostTimeoutPhases: number;
  readonly sightRangeM: number;
  readonly noticeBase: number;
  readonly regularRate: number;
  readonly checkpoints: readonly CheckpointKind[];
  readonly checkpointVisibleM: number;
  readonly composureRows: readonly { readonly tags: readonly string[]; readonly composure: number }[];
  readonly passengerTrustMin: number;
  readonly stories: readonly StoryTemplate[];
  readonly ledgerWindowDays: number;
  readonly bluffSuspicion: number;
  readonly maps: readonly MapOffer[];
  readonly localSegments: readonly string[];
  readonly navigationAid: boolean;
  /** Street and landmark names the narrator may use. */
  readonly streetNames: readonly string[];
  /** Attribution lines for built graphs. Authored graphs contribute none. */
  readonly attributions: readonly string[];
}

export interface DriveClock {
  readonly ticks: number;
  readonly phasesCharged: number;
}

const PHASES: readonly StreetPhase[] = ['morning', 'afternoon', 'evening', 'night'];

/** Calibrated spotting defaults. A difficulty preset overrides them when it sets the knobs. */
export const STREET_NOTICE_BASE = 0.45;
export const STREET_REGULAR_RATE = 0.35;

export function streetRates(
  preset: { readonly streetOps?: { readonly noticeBase?: number; readonly regularRate?: number } } | undefined,
): { readonly noticeBase: number; readonly regularRate: number } {
  return {
    noticeBase: preset?.streetOps?.noticeBase ?? STREET_NOTICE_BASE,
    regularRate: preset?.streetOps?.regularRate ?? STREET_REGULAR_RATE,
  };
}

/**
 * Navigation aid. A capability list is the authority when a setting profile
 * supplies one. With no list, the scenario flag decides, and it defaults off.
 */
export function navigationAidActive(capabilities: readonly string[] | undefined, flag: boolean): boolean {
  if (capabilities !== undefined) return capabilities.includes('navigation-aid');
  return flag;
}

/** Phases a tick increment charges, and the clock after the increment. */
export function chargeTicks(
  clock: DriveClock,
  added: number,
  ticksPerPhase: number,
): { readonly clock: DriveClock; readonly phases: number } {
  const ticks = clock.ticks + added;
  const before = Math.floor(clock.ticks / ticksPerPhase);
  const after = Math.floor(ticks / ticksPerPhase);
  const phases = after - before;
  return { clock: { ticks, phasesCharged: clock.phasesCharged + phases }, phases };
}

/** The closing charge: one phase when the session has not crossed a boundary. */
export function closeClock(clock: DriveClock): { readonly clock: DriveClock; readonly phases: number } {
  if (clock.phasesCharged >= 1) return { clock, phases: 0 };
  return { clock: { ticks: clock.ticks, phasesCharged: clock.phasesCharged + 1 }, phases: 1 };
}

function streetPhase(state: WorldState): StreetPhase {
  return PHASES[state.time.phase] ?? 'morning';
}

function sliceOf(state: WorldState): StreetOpsState {
  return state.ext?.streetOps ?? emptyStreetOpsState(streetReplayHeader());
}

function sameCity(graphCity: string, settingCity: string): boolean {
  if (settingCity === 'core') return graphCity.includes('vienna');
  return graphCity === settingCity || graphCity.endsWith(`/${settingCity}`) || settingCity.endsWith(`/${graphCity}`);
}

function playerCity(state: WorldState): string {
  const here = state.player.city;
  if (here !== undefined && here !== null) return here;
  return state.meta.setting.city;
}

/** The graph for the city the player is in. A frontage underfoot wins. */
export function selectStreetGraph(graphs: readonly StreetGraph[], state: WorldState): StreetGraph | undefined {
  const loc = state.player.loc;
  const direct = graphs.find((graph) => graph.frontageOf(loc) !== undefined);
  if (direct !== undefined) return direct;
  const graph = graphs.find((item) => sameCity(item.city, playerCity(state)));
  if (graph === undefined) return undefined;
  return pinFrontage(graph, loc);
}

function graphFor(runtime: StreetOpsRuntime, state: WorldState): StreetGraph | undefined {
  return selectStreetGraph(runtime.graphs, state);
}

/** Drop a session whose street is not on this city's graph, so a new drive can start. */
function sessionAtHome(state: WorldState, runtime: StreetOpsRuntime): WorldState {
  const session = state.ext?.streetOps?.session;
  if (session === undefined) return state;
  const graph = graphFor(runtime, state);
  if (graph !== undefined && graph.segments.has(session.at.segment)) return state;
  return parkedForTravel(state);
}

/** The pool car a cover is issued. A warehouse trade gets the van. Anyone else gets the staff saloon. */
export function coverVehicle(
  vehicles: readonly VehicleOffer[],
  year: number,
  cover: { readonly id: string; readonly tags?: readonly string[]; readonly fitLocationTypes?: readonly string[] },
): VehicleOffer | undefined {
  const era = vehicles.filter((vehicle) => inEra(vehicle, year)).sort((a, b) => a.id.localeCompare(b.id));
  const fits = cover.fitLocationTypes ?? [];
  const commercial = (cover.tags ?? []).includes('cover:commercial') && fits.some((fit) => fit === 'warehouse' || fit.endsWith('/warehouse'));
  if (commercial) {
    const van = era.find((vehicle) => /van|lorry/i.test(vehicle.id) || /van|lorry/i.test(vehicle.name));
    if (van !== undefined) return van;
  }
  const saloon = era.find((vehicle) => vehicle.id === 'staff-saloon' || vehicle.id.endsWith('/staff-saloon'));
  if (saloon !== undefined) return saloon;
  return era.find((vehicle) => !/van|lorry/i.test(vehicle.name)) ?? era[0];
}

function mayDrive(state: WorldState, offer: VehicleOffer, runtime: StreetOpsRuntime): boolean {
  const slice = sliceOf(state);
  if (slice.vehicles.some((vehicle) => vehicle.def === offer.id)) return true;
  return coverVehicle(runtime.vehicles, state.meta.setting.year, state.player.cover)?.id === offer.id;
}

function segmentTicks(
  graph: StreetGraph,
  segmentId: string,
  phase: StreetPhase,
  speeds: Readonly<Record<SpeedClass, number>>,
  speed: SpeedClass,
): number {
  const segment = graph.segments.get(segmentId);
  if (segment === undefined) return 1;
  const factor = Math.max(1, segment.traffic[phase]);
  const base = Math.ceil((segment.lengthM / speeds[segment.speed]) * factor);
  const scale = speeds.normal / speeds[speed];
  return Math.max(1, Math.ceil(base * scale));
}

function plateFor(id: string): string {
  const compact = id.replace(/[^a-z0-9]/gi, '').toUpperCase();
  return `P-${compact.slice(0, 6)}`;
}

function inEra(offer: VehicleOffer, year: number): boolean {
  return year >= offer.era.from && year <= offer.era.to;
}

function ownVehicle(slice: StreetOpsState, offer: VehicleOffer): VehicleRecord {
  const found = slice.vehicles.find((vehicle) => vehicle.def === offer.id);
  if (found !== undefined) return found;
  return { id: offer.id, def: offer.id, plate: plateFor(offer.id), knownBurned: false };
}

interface Step {
  readonly phases: number;
  readonly session?: DriveState;
  readonly slice: StreetOpsState;
  readonly loc?: string;
  readonly line: string;
  readonly money?: number;
  readonly turnBack?: boolean;
  readonly bluff?: {
    readonly template: StoryTemplate;
    readonly claims: readonly { readonly slot: string; readonly value: string }[];
    readonly evasive: boolean;
    readonly service: string;
    readonly place: string;
    readonly street: string;
    readonly sessionKey: string;
  };
}

function refuse(reason: string): ActionQuote {
  return { allowed: false, reason, phases: 0, money: 0 };
}

function booksOf(slice: StreetOpsState): { readonly knowledge: StreetOpsState['knowledge']; readonly mapNames: StreetOpsState['mapNames'] } {
  return { knowledge: slice.knowledge, mapNames: slice.mapNames };
}

function roadblockKind(runtime: StreetOpsRuntime): string | undefined {
  return runtime.checkpoints.find((kind) => kind.id === 'roadblock' || kind.id.endsWith('/roadblock'))?.id;
}

function haltKind(runtime: StreetOpsRuntime): CheckpointKind | undefined {
  return runtime.checkpoints.find((kind) => kind.id === 'document-halt' || kind.id.endsWith('/document-halt'));
}

/** Fixed posts plus a crackdown roadblock. Pressure zero adds no random stop. */
function driveGraph(
  graph: StreetGraph,
  state: WorldState,
  runtime: StreetOpsRuntime,
  session: DriveState,
  before: DriveState['at'],
  after: DriveState['at'],
): StreetGraph {
  const posted = withCrackdownPosts(graph, state.time.day, state.ambient?.events, roadblockKind(runtime));
  const metrics = state.ambient?.metrics;
  const pressure = metrics === undefined ? 0 : policePressure(metrics.exo.police, metrics.react.police);
  if (pressure <= 0) return posted;
  const draw = streetSubstream(state.meta.seed, 'checkpoint', `${session.sessionKey}:halt:${after.segment}`).next();
  return withPressureStop(posted, before, after, draw, pressure, haltKind(runtime));
}

function postedGraph(graph: StreetGraph, state: WorldState, runtime: StreetOpsRuntime): StreetGraph {
  return withCrackdownPosts(graph, state.time.day, state.ambient?.events, roadblockKind(runtime));
}

function seenIds(
  current: readonly string[],
  graph: StreetGraph,
  at: DriveState['at'],
  phase: StreetPhase,
  runtime: StreetOpsRuntime,
  state: WorldState,
): string[] {
  const ids = [...current];
  for (const site of checkpointsAhead(postedGraph(graph, state, runtime), at, phase, runtime.checkpoints, runtime.checkpointVisibleM)) {
    if (!ids.includes(site.id)) ids.push(site.id);
  }
  return ids;
}

function hereName(loc: string, at: string | undefined): boolean {
  if (at === undefined) return true;
  return loc === at || loc.endsWith(`/${at}`) || at.endsWith(`/${loc}`);
}

function beginStep(state: WorldState, vehicleId: string, runtime: StreetOpsRuntime): Step | string {
  const home = sessionAtHome(state, runtime);
  if (sliceOf(home).session !== undefined) return 'a drive is already open';
  state = home;
  const offer = runtime.vehicles.find((vehicle) => vehicle.id === vehicleId);
  if (offer === undefined) return 'no such vehicle';
  if (!inEra(offer, state.meta.setting.year)) return 'not available in this year';
  if (!mayDrive(state, offer, runtime)) return 'that car is not yours';
  const graph = graphFor(runtime, state);
  const frontage = graph?.frontageOf(state.player.loc);
  if (graph === undefined || frontage === undefined) return 'no usable street map';
  const slice = sliceOf(state);
  const vehicle = ownVehicle(slice, offer);
  const session: DriveState = {
    sessionKey: `${state.time.day}:${state.time.phase}:${state.player.loc}:${slice.counters.sessions}`,
    vehicle: vehicle.id,
    at: { segment: frontage.segment, dir: 'fwd', progress: frontage.at },
    speed: offer.speed,
    ticks: 0,
    phasesCharged: 0,
    path: [],
    passengers: (slice.rides[vehicle.id] ?? []).map((ride) => ride.npc),
  };
  const street = graph.segments.get(frontage.segment)?.street ?? frontage.segment;
  const travelled = learnTravel(graph, learnLocal(graph, booksOf(slice), runtime.localSegments), session.at, false);
  const line = travelled.correction === undefined ? `You pull out onto ${street}.` : `You pull out onto ${street}. ${travelled.correction}`;
  return {
    phases: 0,
    session,
    slice: {
      ...slice,
      vehicles: slice.vehicles.some((item) => item.id === vehicle.id) ? slice.vehicles : [...slice.vehicles, vehicle],
      session,
      knowledge: travelled.books.knowledge,
      mapNames: travelled.books.mapNames,
      seenCheckpoints: seenIds(slice.seenCheckpoints, graph, session.at, streetPhase(state), runtime, state),
      counters: { sessions: slice.counters.sessions + 1 },
    },
    line,
  };
}

function checkpointDelay(
  graph: StreetGraph,
  before: DriveState['at'],
  after: DriveState['at'],
  phase: StreetPhase,
  runtime: StreetOpsRuntime,
  suspicion: number,
): number {
  return checkpointsCrossed(graph, before, after, phase, runtime.checkpoints).reduce(
    (sum, site) => sum + checkpointDelayTicks(searchLevel(site.kind, suspicion)),
    0,
  );
}

function turnStep(state: WorldState, relative: Relative, street: string | undefined, runtime: StreetOpsRuntime): Step | string {
  const slice = sliceOf(state);
  const session = slice.session;
  if (session === undefined) return 'no drive session';
  const graph = graphFor(runtime, state);
  if (graph === undefined) return 'no usable street map';
  const phase = streetPhase(state);
  const suspicion = revealTruth(state.player.coverSuspicion);
  if (session.at.progress < 1 && relative === 'u-turn') {
    const ahead = checkpointsAhead(postedGraph(graph, state, runtime), session.at, phase, runtime.checkpoints, runtime.checkpointVisibleM);
    if (ahead.length === 0) return 'not at a junction';
    const charged = chargeTicks(session, 1, runtime.ticksPerPhase);
    const next: DriveState = {
      ...session,
      at: { ...session.at, dir: session.at.dir === 'fwd' ? 'rev' : 'fwd', progress: 0 },
      ticks: charged.clock.ticks,
      phasesCharged: charged.clock.phasesCharged,
    };
    return {
      phases: charged.phases,
      session: next,
      slice: { ...slice, session: next },
      line: 'You turn back.',
      turnBack: true,
    };
  }
  if (session.at.progress < 1) {
    if (relative !== 'straight') return 'not at a junction';
    const full = segmentTicks(graph, session.at.segment, phase, runtime.speeds, session.speed);
    const finished = { ...session.at, progress: 1 };
    const moving = driveGraph(graph, state, runtime, session, session.at, finished);
    const added = Math.max(1, Math.ceil(full * (1 - session.at.progress))) + checkpointDelay(moving, session.at, finished, phase, runtime, suspicion);
    const charged = chargeTicks(session, added, runtime.ticksPerPhase);
    const name = graph.segments.get(session.at.segment)?.street ?? session.at.segment;
    const next: DriveState = {
      ...session,
      at: { ...session.at, progress: 1 },
      ticks: charged.clock.ticks,
      phasesCharged: charged.clock.phasesCharged,
      path: [...session.path, finished],
    };
    const travelled = learnTravel(graph, booksOf(slice), next.at, true);
    const line = travelled.correction === undefined ? `You reach the junction on ${name}.` : `You reach the junction on ${name}. ${travelled.correction}`;
    return {
      phases: charged.phases,
      session: next,
      slice: {
        ...slice,
        session: next,
        knowledge: travelled.books.knowledge,
        mapNames: travelled.books.mapNames,
        seenCheckpoints: seenIds(slice.seenCheckpoints, graph, next.at, phase, runtime, state),
      },
      line,
    };
  }
  const options = graph.turnOptions(session.at, phase, runtime.speeds);
  const matches = options.filter((option) => option.relative === relative);
  const chosen = street === undefined ? matches[0] : matches.find((option) => option.street === street);
  if (chosen === undefined) return 'no such turn';
  const scale = runtime.speeds.normal / runtime.speeds[session.speed];
  const arrived = { segment: chosen.to.segment, dir: chosen.to.dir, progress: 1 as const };
  const moving = driveGraph(graph, state, runtime, session, session.at, arrived);
  const added = Math.max(1, Math.ceil(chosen.ticks * scale)) + checkpointDelay(moving, session.at, arrived, phase, runtime, suspicion);
  const charged = chargeTicks(session, added, runtime.ticksPerPhase);
  const next: DriveState = {
    ...session,
    at: arrived,
    ticks: charged.clock.ticks,
    phasesCharged: charged.clock.phasesCharged,
    path: [...session.path, arrived],
  };
  const travelled = learnTravel(graph, booksOf(slice), next.at, true);
  const line = travelled.correction === undefined ? `${chosen.relative} onto ${chosen.street}.` : `${chosen.relative} onto ${chosen.street}. ${travelled.correction}`;
  return {
    phases: charged.phases,
    session: next,
    slice: {
      ...slice,
      session: next,
      knowledge: travelled.books.knowledge,
      mapNames: travelled.books.mapNames,
      seenCheckpoints: seenIds(slice.seenCheckpoints, graph, next.at, phase, runtime, state),
    },
    line,
  };
}

function parkStep(state: WorldState, runtime: StreetOpsRuntime): Step | string {
  const slice = sliceOf(state);
  const session = slice.session;
  if (session === undefined) return 'no drive session';
  const graph = graphFor(runtime, state);
  if (graph === undefined) return 'no usable street map';
  const frontage = graph.frontages.find((item) => item.segment === session.at.segment);
  if (frontage === undefined) return 'no frontage on this street';
  let parkedAt = frontage.location;
  if (!knownPlace(state, parkedAt) && knownPlace(state, state.player.loc)) parkedAt = state.player.loc;
  const closed = closeClock(session);
  const parked: StreetOpsState = {
    version: slice.version,
    vehicles: slice.vehicles,
    knowledge: slice.knowledge,
    told: slice.told,
    rides: slice.rides,
    deliveries: slice.deliveries,
    notedPlates: slice.notedPlates,
    mapNames: slice.mapNames,
    seenCheckpoints: slice.seenCheckpoints,
    mapsRead: slice.mapsRead,
    counters: slice.counters,
    replay: slice.replay,
  };
  return {
    phases: closed.phases,
    slice: parked,
    loc: parkedAt,
    line: 'You park and get out.',
  };
}

const HIRE_COST = 4;
const PLATE_COST = 2;

function knownPlace(state: WorldState, loc: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.city.locations, loc);
}

function hireStep(state: WorldState, vehicleId: string, runtime: StreetOpsRuntime): Step | string {
  const slice = sliceOf(state);
  if (slice.session !== undefined) return 'a drive is already open';
  if (graphFor(runtime, state) === undefined) return 'no usable street map';
  const offer = runtime.vehicles.find((vehicle) => vehicle.id === vehicleId);
  if (offer === undefined) return 'no such vehicle';
  if (!inEra(offer, state.meta.setting.year)) return 'not available in this year';
  if (mayDrive(state, offer, runtime)) return 'you already have that car';
  return {
    phases: 0,
    money: HIRE_COST,
    slice: { ...slice, vehicles: [...slice.vehicles, ownVehicle(slice, offer)] },
    line: `You hire the ${offer.name}.`,
  };
}

function returnStep(state: WorldState, vehicleId: string, runtime: StreetOpsRuntime): Step | string {
  const slice = sliceOf(state);
  if (slice.session !== undefined) return 'park before you return a car';
  const offer = runtime.vehicles.find((vehicle) => vehicle.id === vehicleId);
  if (offer === undefined) return 'no such vehicle';
  if (!slice.vehicles.some((vehicle) => vehicle.def === offer.id)) return 'that car is not yours';
  const assigned = coverVehicle(runtime.vehicles, state.meta.setting.year, state.player.cover);
  if (assigned?.id === offer.id) return 'the station keeps this car on the pool';
  return {
    phases: 0,
    money: 0,
    slice: { ...slice, vehicles: slice.vehicles.filter((vehicle) => vehicle.def !== offer.id) },
    line: `You return the ${offer.name}.`,
  };
}

function swapPlateStep(state: WorldState, vehicleId: string): Step | string {
  const slice = sliceOf(state);
  if (slice.session !== undefined) return 'park before you change the plates';
  const record = slice.vehicles.find((vehicle) => vehicle.def === vehicleId);
  if (record === undefined) return 'that car is not yours';
  const plate = plateFor(`${record.def}-${state.time.day}-${state.time.phase}`);
  if (plate === record.plate) return 'those plates are already fitted';
  return {
    phases: 0,
    money: PLATE_COST,
    slice: {
      ...slice,
      vehicles: slice.vehicles.map((vehicle) =>
        vehicle.def === record.def ? { ...vehicle, plate, knownBurned: false } : vehicle,
      ),
    },
    line: 'You fit new plates.',
  };
}

function lookStep(state: WorldState, mode: 'look-around' | 'check-mirror', runtime: StreetOpsRuntime): Step | string {
  const slice = sliceOf(state);
  const session = slice.session;
  if (session === undefined) return 'no drive session';
  const charged = chargeTicks(session, 1, runtime.ticksPerPhase);
  const next: DriveState = { ...session, ticks: charged.clock.ticks, phasesCharged: charged.clock.phasesCharged };
  const line = mode === 'check-mirror' ? 'You check the mirror.' : 'You look around.';
  return { phases: charged.phases, session: next, slice: { ...slice, session: next }, line };
}

function maneuverStep(state: WorldState, id: string, runtime: StreetOpsRuntime): Step | string {
  const slice = sliceOf(state);
  const session = slice.session;
  if (session === undefined) return 'no drive session';
  if (session.at.progress < 1) return 'not at a junction';
  const graph = graphFor(runtime, state);
  if (graph === undefined) return 'no usable street map';
  const offer = maneuversAt(graph, session.at.segment, runtime.maneuvers, state.meta.setting.year).find((item) => item.id === id);
  if (offer === undefined) return 'no such maneuver';
  const charged = chargeTicks(session, offer.ticks, runtime.ticksPerPhase);
  const next: DriveState = { ...session, ticks: charged.clock.ticks, phasesCharged: charged.clock.phasesCharged };
  const name = offer.id.replace(/-/g, ' ');
  return { phases: charged.phases, session: next, slice: { ...slice, session: next }, line: `You take the ${name}.` };
}

function personName(state: WorldState, npc: string): string {
  if (!npc.startsWith('npc:')) return npc;
  const found = state.npcs[npc as NpcId];
  if (found === undefined) return npc;
  return found.persona.name;
}

function namedByDirective(state: WorldState, npc: string): boolean {
  for (const directive of state.station.directives) {
    if (directive.status !== 'open') continue;
    const objective = directive.objective;
    if ((objective.kind === 'identify' || objective.kind === 'arrest') && objective.entity === npc) return true;
    if (objective.kind === 'smuggle' && objective.npc === npc) return true;
  }
  return false;
}

function rideAllowed(state: WorldState, npc: string, runtime: StreetOpsRuntime): boolean {
  if (!npc.startsWith('npc:')) return false;
  const id = npc as NpcId;
  const rel = state.relationships[id];
  return canRide({
    present: visibleNpcsAt(state, state.player.loc).includes(id),
    recruited: rel?.recruited === true || rel?.asset !== undefined,
    trust: rel?.trust ?? 0,
    trustMin: runtime.passengerTrustMin,
    namedByDirective: namedByDirective(state, npc),
  });
}

function withRides(slice: StreetOpsState, vehicle: string, rides: StreetOpsState['rides'][string], session: DriveState): StreetOpsState {
  return {
    ...slice,
    rides: { ...slice.rides, [vehicle]: rides },
    session: { ...session, passengers: rides.map((ride) => ride.npc) },
  };
}

function pickupStep(
  state: WorldState,
  npc: string,
  mode: 'declared' | 'concealed',
  spotId: string | undefined,
  runtime: StreetOpsRuntime,
): Step | string {
  const slice = sliceOf(state);
  const session = slice.session;
  if (session === undefined) return 'no drive session';
  const graph = graphFor(runtime, state);
  if (graph === undefined) return 'no usable street map';
  const curb = graph.frontageOf(state.player.loc);
  if (curb === undefined || curb.segment !== session.at.segment) return 'not at a curb';
  if (!rideAllowed(state, npc, runtime)) return 'they will not get in';
  const offer = runtime.vehicles.find((vehicle) => vehicle.id === session.vehicle);
  if (offer === undefined) return 'no such vehicle';
  const spot = mode === 'concealed' ? offer.spots.map(toSpot).find((item) => item.id === spotId) : undefined;
  const placed = board({ rides: slice.rides[session.vehicle] ?? [], seats: offer.seats, mode, npc, ...(spot === undefined ? {} : { spot }) });
  if (typeof placed === 'string') return placed;
  const charged = chargeTicks(session, 1, runtime.ticksPerPhase);
  const next: DriveState = { ...session, ticks: charged.clock.ticks, phasesCharged: charged.clock.phasesCharged };
  const name = personName(state, npc);
  const line = mode === 'concealed' ? `You hide ${name} in the ${spotId ?? 'car'}.` : `You take ${name} in the car.`;
  return { phases: charged.phases, session: { ...next, passengers: placed.map((ride) => ride.npc) }, slice: withRides(slice, session.vehicle, placed, next), line };
}

function dropoffStep(state: WorldState, npc: string, loc: string, runtime: StreetOpsRuntime): Step | string {
  const slice = sliceOf(state);
  const session = slice.session;
  if (session === undefined) return 'no drive session';
  const graph = graphFor(runtime, state);
  if (graph === undefined) return 'no usable street map';
  const curb = graph.frontages.find((frontage) => frontage.segment === session.at.segment && frontage.location === loc);
  if (curb === undefined) return 'no frontage here';
  const rides = slice.rides[session.vehicle] ?? [];
  const riding = rides.find((ride) => ride.npc === npc);
  if (riding === undefined) return 'no such passenger';
  const left = alight(rides, npc);
  if (typeof left === 'string') return left;
  const charged = chargeTicks(session, 1, runtime.ticksPerPhase);
  const next: DriveState = { ...session, ticks: charged.clock.ticks, phasesCharged: charged.clock.phasesCharged };
  const delivered = deliveryFor(riding, loc, state.time);
  const street = graph.segments.get(session.at.segment)?.street ?? session.at.segment;
  return {
    phases: charged.phases,
    session: { ...next, passengers: left.map((ride) => ride.npc) },
    slice: {
      ...withRides(slice, session.vehicle, left, next),
      deliveries: delivered === undefined ? slice.deliveries : [...slice.deliveries, delivered],
    },
    line: `You let ${personName(state, npc)} out on ${street}.`,
  };
}

function coverTags(state: WorldState): string[] {
  const cover = state.player.cover;
  const slash = cover.id.lastIndexOf('/');
  const local = slash < 0 ? cover.id : cover.id.slice(slash + 1);
  return ['cover', local, cover.title.toLowerCase(), ...cover.fitLocationTypes];
}

function sharedServices(state: WorldState, service: string): string[] {
  const shared: string[] = [];
  for (const edge of state.rivalry ?? []) {
    if (!edge.share) continue;
    if (edge.from === service && !shared.includes(edge.to)) shared.push(edge.to);
    if (edge.to === service && !shared.includes(edge.from)) shared.push(edge.from);
  }
  return shared;
}

function bluffStep(
  state: WorldState,
  action: {
    readonly template: string;
    readonly origin?: string;
    readonly destination?: string;
    readonly occupation?: string;
    readonly passengers?: string;
    readonly text?: string;
    readonly propositions?: readonly { readonly slot: string; readonly value: string }[];
  },
  runtime: StreetOpsRuntime,
): Step | string {
  const slice = sliceOf(state);
  const session = slice.session;
  if (session === undefined) return 'no drive session';
  const graph = graphFor(runtime, state);
  if (graph === undefined) return 'no usable street map';
  const phase = streetPhase(state);
  const ahead = checkpointsAhead(postedGraph(graph, state, runtime), session.at, phase, runtime.checkpoints, runtime.checkpointVisibleM);
  const post = ahead[0];
  if (post === undefined) return 'no one is asking';
  const template = runtime.stories.find((story) => story.id === action.template);
  if (template === undefined) return 'no such story';
  const papers = [...(state.player.papers ?? [])];
  const tags = coverTags(state);
  if (!templateFits(template, tags, papers)) return 'that story does not fit';
  const street = graph.segments.get(session.at.segment)?.street ?? session.at.segment;
  const told = claimsFor({
    template,
    street,
    origin: action.origin,
    destination: action.destination,
    occupation: action.occupation,
    passengers: action.passengers,
    text: action.text,
    propositions: action.propositions,
  });
  const site = graph.checkpoints.find((item) => item.id === post.id);
  const charged = chargeTicks(session, 1, runtime.ticksPerPhase);
  const next: DriveState = { ...session, ticks: charged.clock.ticks, phasesCharged: charged.clock.phasesCharged };
  return {
    phases: charged.phases,
    session: next,
    slice: {
      ...slice,
      session: next,
      told: [...slice.told, { id: `${state.time.day}:${state.time.phase}:${template.id}`, template: template.id, at: state.time }],
    },
    line: 'You give your story.',
    bluff: {
      template,
      claims: told.claims,
      evasive: told.evasive,
      service: site?.service ?? 'local',
      place: post.id,
      street,
      sessionKey: session.sessionKey,
    },
  };
}

function apply(state: WorldState, step: Step): WorldState {
  const player = step.loc === undefined ? state.player : { ...state.player, loc: step.loc as WorldState['player']['loc'] };
  return { ...state, player, ext: { ...state.ext, streetOps: step.slice } };
}

function readMapStep(state: WorldState, id: string, runtime: StreetOpsRuntime): Step | string {
  const doc = runtime.maps.find((item) => item.id === id);
  if (doc === undefined) return 'no such map';
  const year = state.meta.setting.year;
  if (year < doc.era.from || year > doc.era.to) return 'that map is the wrong year';
  if (!hereName(state.player.loc, doc.at)) return 'the map is not sold here';
  const slice = sliceOf(state);
  const owned = slice.mapsRead.includes(doc.id);
  const price = owned ? 0 : doc.price;
  if (price > 0 && balance(state.station.ledger) < price) return 'you cannot afford the map';
  const graph = graphFor(runtime, state) ?? runtime.graphs.find((item) => item.segments.has(doc.segments[0] ?? ''));
  const learned = learnDocument(graph, booksOf(slice), doc);
  return {
    phases: 0,
    money: price,
    slice: { ...slice, knowledge: learned.knowledge, mapNames: learned.mapNames, mapsRead: owned ? slice.mapsRead : [...slice.mapsRead, doc.id] },
    line: `You study the ${doc.title}.`,
  };
}

function navigateStep(state: WorldState, runtime: StreetOpsRuntime): Step | string {
  if (!runtime.navigationAid) return 'no navigation aid';
  const graph = graphFor(runtime, state) ?? runtime.graphs[0];
  if (graph === undefined) return 'no usable street map';
  const slice = sliceOf(state);
  const learned = learnAid(graph, booksOf(slice));
  return {
    phases: 0,
    slice: { ...slice, knowledge: learned.knowledge, mapNames: learned.mapNames },
    line: 'You consult a navigation aid.',
  };
}

function quoteStep(step: Step | string): ActionQuote {
  if (typeof step === 'string') return refuse(step);
  return { allowed: true, phases: step.phases, money: step.money ?? 0 };
}

interface StreetWriter {
  streetOps(): StreetOpsTruth | undefined;
  replaceStreetOps(next: StreetOpsTruth): void;
}

function streetWriter(truth: object): StreetWriter | undefined {
  if (!('streetOps' in truth) || !('replaceStreetOps' in truth)) return undefined;
  const value = truth as { streetOps?: unknown; replaceStreetOps?: unknown };
  if (typeof value.streetOps !== 'function' || typeof value.replaceStreetOps !== 'function') return undefined;
  return value as StreetWriter;
}

function attentionFor(kind: string, speed: SpeedClass): number {
  if (kind === 'street-ops.look') return 1.5;
  if (speed === 'fast') return 0.7;
  return 1;
}

function resolveStep(
  state: WorldState,
  step: Step | string,
  runtime: StreetOpsRuntime,
  ctx: ResolverContext,
  action: { readonly kind: string; readonly id?: string },
): ResolveResult {
  if (typeof step === 'string') {
    return {
      next: state,
      result: {
        observations: [],
        factLines: [],
        scene: sceneAt(state, state.player.loc),
        events: [],
        claimsAdded: [],
      },
    };
  }
  let next = apply(state, step);
  const price = step.money ?? 0;
  if (price > 0) {
    const paid = debit(next.station.ledger, price, 'rental', state.time, action.kind);
    if (typeof paid === 'string') {
      return {
        next: state,
        result: {
          observations: [],
          factLines: [],
          scene: sceneAt(state, state.player.loc),
          events: [],
          claimsAdded: [],
        },
      };
    }
    next = { ...next, station: { ...next.station, ledger: paid } };
  }
  const session = step.session ?? state.ext?.streetOps?.session;
  const active = runtime.tails.length > 0 || runtime.routes.length > 0 || action.kind === 'street-ops.look' || action.kind === 'street-ops.maneuver';
  const lines = [step.line];
  const incidents: StreetIncident[] = [];
  if (session !== undefined && active) {
    const graph = graphFor(runtime, state);
    const segment = graph?.segments.get(session.at.segment);
    if (graph !== undefined && segment !== undefined) {
      const writer = ctx.truth === undefined ? undefined : streetWriter(ctx.truth);
      const truth = writer?.streetOps() ?? emptyStreetOpsTruth();
      const offer = runtime.maneuvers.find((item) => item.id === action.id);
      const arrived = step.loc;
      const risk = arrived === undefined ? 0 : (state.city.locations[arrived as WorldState['player']['loc']]?.risk ?? 0);
      const followed = stepStreet({
        seed: state.meta.seed,
        year: state.meta.setting.year,
        sessionKey: session.sessionKey,
        step: session.path.length,
        phases: step.phases,
        path: session.path,
        here: session.at.segment,
        street: segment.street,
        phase: streetPhase(state),
        traffic: segment.traffic[streetPhase(state)],
        attention: attentionFor(action.kind, session.speed),
        wanted: revealTruth(state.player.tailed),
        truth,
        profiles: runtime.tails,
        methods: runtime.methods,
        graph,
        sightRangeM: runtime.sightRangeM,
        noticeBase: runtime.noticeBase,
        regularRate: runtime.regularRate,
        lostTimeoutPhases: runtime.lostTimeoutPhases,
        ...(action.kind === 'street-ops.maneuver' && offer !== undefined ? { maneuver: offer } : {}),
        arrivalRisk: risk,
        beforePath: state.ext?.streetOps?.session?.path ?? [],
        routes: runtime.routes,
        noted: state.ext?.streetOps?.session?.noted ?? [],
      });
      writer?.replaceStreetOps(followed.truth);
      const suspicion = Math.min(1, Math.max(0, revealTruth(next.player.coverSuspicion) + followed.coverSuspicionDelta));
      const present = arrived === undefined ? [] : visibleNpcsAt(next, next.player.loc);
      const bumps = watchedExposure(followed.tailed && arrived !== undefined, present, (npc) => next.relationships[npc]?.exposure);
      let relationships = next.relationships;
      let beliefs = next.hostile.beliefs;
      for (const npc of present) {
        const exposure = bumps[npc];
        const rel = relationships[npc];
        if (exposure === undefined || rel === undefined) continue;
        relationships = { ...relationships, [npc]: { ...rel, exposure } };
        beliefs = accrueExposure(beliefs, npc, exposure);
      }
      next = {
        ...next,
        player: { ...next.player, tailed: asTruth(followed.tailed), coverSuspicion: asTruth(suspicion) },
        relationships,
        hostile: { ...next.hostile, beliefs },
      };
      lines.push(...followed.lines);
      const priorNotes = state.ext?.streetOps?.session?.noted ?? [];
      const vehicleLines = followed.observations.map((item) => item.line);
      const currentSession = next.ext?.streetOps?.session;
      if (vehicleLines.length > 0 && currentSession !== undefined && next.ext?.streetOps !== undefined) {
        const slice = next.ext.streetOps;
        next = {
          ...next,
          ext: {
            ...next.ext,
            streetOps: { ...slice, session: { ...currentSession, noted: [...priorNotes, ...vehicleLines] } },
          },
        };
      }
      if (followed.alert || followed.search || followed.coverSuspicionDelta > 0) {
        const team = Object.values(followed.truth.teams)[0];
        incidents.push(
          incidentForTail({
            service: team?.service ?? 'service:hostile',
            suspicionDelta: followed.coverSuspicionDelta,
            alert: followed.alert,
            search: followed.search,
          }),
        );
      }
    }
  }
  const driven = step.session ?? state.ext?.streetOps?.session;
  const started = state.ext?.streetOps?.session;
  const map = graphFor(runtime, state);
  const offer = driven === undefined ? undefined : runtime.vehicles.find((vehicle) => vehicle.id === driven.vehicle);
  const spots = offer === undefined ? [] : offer.spots.map(toSpot);
  let rideRecords = driven === undefined ? [] : (emptyStreetOpsTruth().concealment[driven.vehicle] ?? []);
  if (driven !== undefined && next.ext?.streetOps !== undefined) {
    const rides = next.ext.streetOps.rides[driven.vehicle] ?? [];
    const added = driven.ticks - (started?.ticks ?? 0);
    const writer = ctx.truth === undefined ? undefined : streetWriter(ctx.truth);
    const truth = writer?.streetOps() ?? emptyStreetOpsTruth();
    const synced = syncConcealment({
      nextRides: rides,
      records: truth.concealment[driven.vehicle] ?? [],
      spots,
      added,
      composureForNpc: (npc) => {
        if (!npc.startsWith('npc:')) return 0.5;
        const person = state.npcs[npc as NpcId];
        if (person === undefined) return 0.5;
        return composureFor(composureTags(person), person.persona.openness, runtime.composureRows);
      },
    });
    rideRecords = synced.records;
    writer?.replaceStreetOps({
      ...truth,
      concealment: { ...truth.concealment, [driven.vehicle]: synced.records },
    });
    lines.push(...synced.facts);
  }
  if (driven !== undefined && started !== undefined && map !== undefined && runtime.checkpoints.length > 0) {
    const phase = streetPhase(state);
    const live = driveGraph(map, state, runtime, driven, started.at, driven.at);
    if (step.turnBack === true) {
      const ahead = checkpointsAhead(live, started.at, phase, runtime.checkpoints, runtime.checkpointVisibleM);
      const extra = ahead.reduce((sum, site) => sum + avoidanceDelta(site.kind), 0);
      if (extra > 0) {
        const suspicion = Math.min(1, revealTruth(next.player.coverSuspicion) + extra);
        next = { ...next, player: { ...next.player, coverSuspicion: asTruth(suspicion) } };
      }
    } else {
      const cover = revealTruth(next.player.coverSuspicion);
      const crossed = checkpointsCrossed(live, started.at, driven.at, phase, runtime.checkpoints);
      let suspicion = cover;
      const plate = next.ext?.streetOps?.vehicles.find((item) => item.id === driven.vehicle)?.plate ?? driven.vehicle;
      const rides = next.ext?.streetOps?.rides[driven.vehicle] ?? [];
      const caught = new Set<string>();
      for (const site of crossed) {
        const checked = vehicleCheck(
          {
            vehicle: { id: driven.vehicle, plate },
            passengers: rides.filter((ride) => ride.mode === 'declared').map((ride) => ({ id: ride.npc, declared: true })),
            concealment: concealedCargo(rides, rideRecords, spots),
            kind: site.kind,
            papersValid: true,
            onWatch: false,
            suspicion: cover,
          },
          streetSubstream(state.meta.seed, 'checkpoint', `${driven.sessionKey}:${site.id}:${driven.path.length}`).next(),
        );
        lines.push(...checked.facts);
        suspicion += checked.suspicionDelta;
        for (const id of checked.found) caught.add(id);
        const siteService = map.checkpoints.find((item) => item.id === site.id)?.service ?? 'service:hostile';
        if (checked.outcome !== 'pass') {
          incidents.push(
            incidentForCheckpoint({
              service: siteService,
              plate,
              postId: site.id,
              outcome: checked.outcome,
              suspicionDelta: checked.suspicionDelta,
            }),
          );
        }
      }
      if (crossed.length > 0 && next.ext?.streetOps !== undefined) {
        const marked = withCrossed(rides).filter((ride) => !caught.has(ride.npc));
        const slice = next.ext.streetOps;
        next = {
          ...next,
          ext: {
            ...next.ext,
            streetOps: {
              ...slice,
              rides: { ...slice.rides, [driven.vehicle]: marked },
              ...(slice.session === undefined ? {} : { session: { ...slice.session, passengers: marked.map((ride) => ride.npc) } }),
            },
          },
        };
      }
      if (caught.size > 0) {
        let relationships = next.relationships;
        let beliefs = next.hostile.beliefs;
        for (const id of caught) {
          if (!id.startsWith('npc:')) continue;
          const npc = id as NpcId;
          const rel = relationships[npc];
          if (rel === undefined) continue;
          const exposure = Math.min(1, rel.exposure + FOUND_PASSENGER_EXPOSURE);
          relationships = { ...relationships, [npc]: { ...rel, exposure } };
          beliefs = accrueExposure(beliefs, npc, exposure);
        }
        const writer = ctx.truth === undefined ? undefined : streetWriter(ctx.truth);
        const truth = writer?.streetOps();
        if (writer !== undefined && truth !== undefined) {
          writer.replaceStreetOps({
            ...truth,
            concealment: {
              ...truth.concealment,
              [driven.vehicle]: (truth.concealment[driven.vehicle] ?? []).filter((record) => !caught.has(record.npc)),
            },
          });
        }
        next = { ...next, relationships, hostile: { ...next.hostile, beliefs } };
      }
      if (suspicion !== cover) {
        next = { ...next, player: { ...next.player, coverSuspicion: asTruth(Math.min(1, Math.max(0, suspicion))) } };
      }
      const seen = new Set(crossed.map((site) => site.street));
      for (const site of checkpointsAhead(map, driven.at, phase, runtime.checkpoints, runtime.checkpointVisibleM)) {
        if (seen.has(site.street)) continue;
        lines.push(aheadLine(site.street));
      }
    }
  }
  if (step.bluff !== undefined) {
    const pending = step.bluff;
    const writer = ctx.truth === undefined ? undefined : streetWriter(ctx.truth);
    const truth = writer?.streetOps() ?? emptyStreetOpsTruth();
    const rides = next.ext?.streetOps?.rides[driven?.vehicle ?? ''] ?? [];
    const tags = coverTags(state);
    const assessed = assessBluff(
      {
        template: pending.template,
        claims: pending.claims,
        evasive: pending.evasive,
        identity: state.player.cover.id,
        service: pending.service,
        sharedWith: sharedServices(state, pending.service),
        place: pending.place,
        at: state.time,
        windowDays: runtime.ledgerWindowDays,
        ledger: truth.ledger,
        tags,
        paperKinds: [...(state.player.papers ?? [])],
        truth: {
          origin: pending.street,
          passengers: rides.filter((ride) => ride.mode === 'declared').map((ride) => ride.npc),
          cargo: [],
        },
        composure: composureFor(tags, 0.5, runtime.composureRows),
        failureSuspicion: runtime.bluffSuspicion,
      },
      streetSubstream(state.meta.seed, 'bluff', `${pending.sessionKey}:${pending.template.id}:${pending.claims.map((claim) => `${claim.slot}=${claim.value}`).sort().join('|')}`).next(),
    );
    lines[0] = assessed.facts.join(' ');
    const suspicion = Math.min(1, Math.max(0, revealTruth(next.player.coverSuspicion) + assessed.suspicionDelta));
    next = { ...next, player: { ...next.player, coverSuspicion: asTruth(suspicion) } };
    writer?.replaceStreetOps({
      ...truth,
      ledger: fileStory(truth.ledger, assessed.entry, assessed.services),
      statements: [...truth.statements, { id: `${pending.sessionKey}:${pending.template.id}:${state.time.day}`, wasLie: assessed.wasLie }],
    });
    if (assessed.suspicionDelta > 0) {
      const vehicle = next.ext?.streetOps?.vehicles.find((item) => item.id === next.ext?.streetOps?.session?.vehicle);
      incidents.push(
        incidentForBluff({
          service: pending.service,
          suspicionDelta: assessed.suspicionDelta,
          plate: vehicle?.plate,
          failed: !assessed.passed,
        }),
      );
    }
  }
  let notices: ReturnType<typeof streetEvents>['events'] = [];
  if (incidents.length > 0) {
    const writer = ctx.truth === undefined ? undefined : streetWriter(ctx.truth);
    const truth = writer?.streetOps() ?? emptyStreetOpsTruth();
    const reaction = streetEvents(incidents, state.time, postureOf(truth));
    notices = reaction.events;
    const services = noteServices(next.services, incidents);
    const slice = next.ext?.streetOps;
    if (slice !== undefined && reaction.plates.length > 0) {
      next = {
        ...next,
        ext: { ...next.ext, streetOps: { ...slice, notedPlates: mergePlates(slice.notedPlates, reaction.plates) } },
      };
    }
    if (services !== undefined) next = { ...next, services };
    writer?.replaceStreetOps({ ...truth, posture: reaction.posture });
  }
  if (action.kind === 'street-ops.navigate') {
    const writer = ctx.truth === undefined ? undefined : streetWriter(ctx.truth);
    const truth = writer?.streetOps() ?? emptyStreetOpsTruth();
    writer?.replaceStreetOps({ ...truth, traces: [...truth.traces, { kind: 'navigation-aid', at: state.time }] });
  }
  return {
    next,
    result: {
      observations: lines.map((line) => ({ kind: 'message' as const, line })),
      factLines: lines,
      scene: sceneAt(next, next.player.loc),
      events: notices,
      claimsAdded: [],
    },
  };
}

const DriveSchema = z.object({ kind: z.literal('street-ops.drive'), vehicle: z.string().min(1) }).strict();
const TurnSchema = z
  .object({
    kind: z.literal('street-ops.turn'),
    relative: z.enum(RELATIVES),
    street: z.string().min(1).optional(),
  })
  .strict();
const ParkSchema = z.object({ kind: z.literal('street-ops.park') }).strict();
const LookSchema = z
  .object({ kind: z.literal('street-ops.look'), mode: z.enum(['look-around', 'check-mirror']) })
  .strict();
const ManeuverSchema = z.object({ kind: z.literal('street-ops.maneuver'), id: z.string().min(1) }).strict();
const PickupSchema = z
  .object({
    kind: z.literal('street-ops.pickup'),
    npc: z.string().min(1),
    mode: z.enum(['declared', 'concealed']),
    spot: z.string().min(1).optional(),
  })
  .strict();
const DropoffSchema = z
  .object({
    kind: z.literal('street-ops.dropoff'),
    npc: z.string().min(1),
    loc: z.string().min(1),
  })
  .strict();
const BluffSchema = z
  .object({
    kind: z.literal('street-ops.bluff'),
    template: z.string().min(1),
    origin: z.string().optional(),
    destination: z.string().optional(),
    occupation: z.string().optional(),
    passengers: z.string().optional(),
    text: z.string().optional(),
    flavour: z.string().optional(),
    propositions: z.array(z.object({ slot: z.string().min(1), value: z.string() }).strict()).optional(),
  })
  .strict();
const ReadMapSchema = z.object({ kind: z.literal('street-ops.read-map'), id: z.string().min(1) }).strict();
const NavigateSchema = z.object({ kind: z.literal('street-ops.navigate') }).strict();
const HireSchema = z.object({ kind: z.literal('street-ops.hire'), vehicle: z.string().min(1) }).strict();
const ReturnSchema = z.object({ kind: z.literal('street-ops.return'), vehicle: z.string().min(1) }).strict();
const SwapPlateSchema = z.object({ kind: z.literal('street-ops.swap-plate'), vehicle: z.string().min(1) }).strict();

function extension<A extends { readonly kind: `${string}.${string}` }>(
  kind: A['kind'],
  schema: z.ZodType<A>,
  phaseAccounting: 'standard' | 'sub-phase',
  step: (state: WorldState, action: A, runtime: StreetOpsRuntime) => Step | string,
  runtime: StreetOpsRuntime,
): ActionExtension<A> {
  return {
    kind,
    schema,
    phaseAccounting,
    quote(state, action) {
      return quoteStep(step(state, action, runtime));
    },
    resolve(state, action, _rng, ctx) {
      return resolveStep(state, step(state, action, runtime), runtime, ctx, action);
    },
  };
}

export function driveActions(runtime: StreetOpsRuntime): readonly ActionExtension[] {
  return [
    extension('street-ops.drive', DriveSchema, 'standard', (state, action, rt) => beginStep(state, action.vehicle, rt), runtime),
    extension(
      'street-ops.turn',
      TurnSchema,
      'sub-phase',
      (state, action, rt) => turnStep(state, action.relative, action.street, rt),
      runtime,
    ),
    extension('street-ops.park', ParkSchema, 'standard', (state, _action, rt) => parkStep(state, rt), runtime),
    extension(
      'street-ops.look',
      LookSchema,
      'sub-phase',
      (state, action, rt) => lookStep(state, action.mode, rt),
      runtime,
    ),
    extension(
      'street-ops.maneuver',
      ManeuverSchema,
      'sub-phase',
      (state, action, rt) => maneuverStep(state, action.id, rt),
      runtime,
    ),
    extension(
      'street-ops.pickup',
      PickupSchema,
      'sub-phase',
      (state, action, rt) => pickupStep(state, action.npc, action.mode, action.spot, rt),
      runtime,
    ),
    extension(
      'street-ops.dropoff',
      DropoffSchema,
      'sub-phase',
      (state, action, rt) => dropoffStep(state, action.npc, action.loc, rt),
      runtime,
    ),
    extension(
      'street-ops.bluff',
      BluffSchema,
      'sub-phase',
      (state, action, rt) => bluffStep(state, action, rt),
      runtime,
    ),
    extension('street-ops.read-map', ReadMapSchema, 'standard', (state, action, rt) => readMapStep(state, action.id, rt), runtime),
    extension('street-ops.navigate', NavigateSchema, 'standard', (state, _action, rt) => navigateStep(state, rt), runtime),
    extension('street-ops.hire', HireSchema, 'standard', (state, action, rt) => hireStep(state, action.vehicle, rt), runtime),
    extension('street-ops.return', ReturnSchema, 'standard', (state, action, rt) => returnStep(state, action.vehicle, rt), runtime),
    extension('street-ops.swap-plate', SwapPlateSchema, 'standard', (state, action) => swapPlateStep(state, action.vehicle), runtime),
  ];
}

/** Catalogue candidates. Empty when street-ops is not bound to the context. */
export function driveCandidates(
  state: WorldState,
  ctx: ResolverContext,
): readonly {
  readonly kind: string;
  readonly vehicle?: string;
  readonly relative?: Relative;
  readonly street?: string;
  readonly id?: string;
  readonly mode?: 'look-around' | 'check-mirror' | 'declared' | 'concealed';
  readonly npc?: string;
  readonly spot?: string;
  readonly loc?: string;
  readonly template?: string;
}[] {
  const runtime = ctx.extensions === undefined ? undefined : runtimeFor(ctx.extensions);
  if (runtime === undefined) return [];
  state = sessionAtHome(state, runtime);
  const session = state.ext?.streetOps?.session;
  if (session === undefined) {
    if (graphFor(runtime, state) === undefined && runtime.maps.length === 0) return [];
    const year = state.meta.setting.year;
    const slice = sliceOf(state);
    const assigned = coverVehicle(runtime.vehicles, year, state.player.cover);
    const owned = new Set(slice.vehicles.map((vehicle) => vehicle.def));
    const onAStreet = graphFor(runtime, state) !== undefined;
    const drives = onAStreet
      ? runtime.vehicles
          .filter((vehicle) => inEra(vehicle, year) && (vehicle.id === assigned?.id || owned.has(vehicle.id)))
          .map((vehicle) => ({ kind: 'street-ops.drive' as const, vehicle: vehicle.id }))
      : [];
    const hires = onAStreet
      ? runtime.vehicles
          .filter((vehicle) => inEra(vehicle, year) && vehicle.id !== assigned?.id && !owned.has(vehicle.id))
          .map((vehicle) => ({ kind: 'street-ops.hire' as const, vehicle: vehicle.id }))
      : [];
    const returns = onAStreet
      ? slice.vehicles
          .filter((vehicle) => assigned === undefined || vehicle.def !== assigned.id)
          .map((vehicle) => ({ kind: 'street-ops.return' as const, vehicle: vehicle.def }))
      : [];
    const plates = onAStreet
      ? slice.vehicles.map((vehicle) => ({ kind: 'street-ops.swap-plate' as const, vehicle: vehicle.def }))
      : [];
    const maps = runtime.maps
      .filter((doc) => year >= doc.era.from && year <= doc.era.to && hereName(state.player.loc, doc.at))
      .filter((doc) => !(state.ext?.streetOps?.mapsRead ?? []).includes(doc.id))
      .map((doc) => ({ kind: 'street-ops.read-map' as const, id: doc.id }));
    const aid = runtime.navigationAid ? [{ kind: 'street-ops.navigate' as const }] : [];
    return [...drives, ...hires, ...returns, ...plates, ...maps, ...aid];
  }
  const graph = graphFor(runtime, state);
  if (graph === undefined) return [{ kind: 'street-ops.park' }];
  const riding = passengerCandidates(state, runtime, graph, session);
  const stories = bluffCandidates(state, runtime, graph, session);
  if (session.at.progress < 1) {
    const ahead = checkpointsAhead(postedGraph(graph, state, runtime), session.at, streetPhase(state), runtime.checkpoints, runtime.checkpointVisibleM);
    return [
      { kind: 'street-ops.turn', relative: 'straight' },
      ...(ahead.length > 0 ? [{ kind: 'street-ops.turn' as const, relative: 'u-turn' as const }] : []),
      { kind: 'street-ops.look', mode: 'look-around' as const },
      { kind: 'street-ops.look', mode: 'check-mirror' as const },
      { kind: 'street-ops.park' },
      ...riding,
      ...stories,
    ];
  }
  const options = graph.turnOptions(session.at, streetPhase(state), runtime.speeds);
  const maneuvers = maneuversAt(graph, session.at.segment, runtime.maneuvers, state.meta.setting.year);
  return [
    ...options.map((option) => ({ kind: 'street-ops.turn', relative: option.relative, street: option.street })),
    ...maneuvers.map((maneuver) => ({ kind: 'street-ops.maneuver', id: maneuver.id })),
    { kind: 'street-ops.look', mode: 'look-around' },
    { kind: 'street-ops.look', mode: 'check-mirror' },
    { kind: 'street-ops.park' },
    ...riding,
    ...stories,
  ];
}

function bluffCandidates(
  state: WorldState,
  runtime: StreetOpsRuntime,
  graph: StreetGraph,
  session: DriveState,
): { kind: 'street-ops.bluff'; template: string }[] {
  const ahead = checkpointsAhead(postedGraph(graph, state, runtime), session.at, streetPhase(state), runtime.checkpoints, runtime.checkpointVisibleM);
  if (ahead.length === 0) return [];
  const papers = [...(state.player.papers ?? [])];
  const tags = coverTags(state);
  return runtime.stories
    .filter((story) => templateFits(story, tags, papers))
    .map((story) => ({ kind: 'street-ops.bluff' as const, template: story.id }));
}

function passengerCandidates(
  state: WorldState,
  runtime: StreetOpsRuntime,
  graph: StreetGraph,
  session: DriveState,
): { kind: 'street-ops.pickup' | 'street-ops.dropoff'; npc: string; mode?: 'declared' | 'concealed'; spot?: string; loc?: string }[] {
  const offer = runtime.vehicles.find((vehicle) => vehicle.id === session.vehicle);
  const rides = state.ext?.streetOps?.rides[session.vehicle] ?? [];
  const out: { kind: 'street-ops.pickup' | 'street-ops.dropoff'; npc: string; mode?: 'declared' | 'concealed'; spot?: string; loc?: string }[] = [];
  const curb = graph.frontageOf(state.player.loc);
  if (offer !== undefined && curb !== undefined && curb.segment === session.at.segment) {
    for (const npc of visibleNpcsAt(state, state.player.loc)) {
      if (!rideAllowed(state, npc, runtime)) continue;
      const seated = board({ rides, seats: offer.seats, mode: 'declared', npc });
      if (typeof seated !== 'string') out.push({ kind: 'street-ops.pickup', npc, mode: 'declared' });
      for (const spot of offer.spots) {
        const hidden = board({ rides, seats: offer.seats, mode: 'concealed', npc, spot: toSpot(spot) });
        if (typeof hidden !== 'string') out.push({ kind: 'street-ops.pickup', npc, mode: 'concealed', spot: spot.id });
      }
    }
  }
  for (const ride of rides) {
    for (const frontage of graph.frontages) {
      if (frontage.segment !== session.at.segment) continue;
      out.push({ kind: 'street-ops.dropoff', npc: ride.npc, loc: frontage.location });
    }
  }
  return out;
}

const RUNTIMES = new WeakMap<object, StreetOpsRuntime>();

export function bindStreetRuntime(registry: object, runtime: StreetOpsRuntime): void {
  RUNTIMES.set(registry, runtime);
}

export function runtimeFor(registry: object): StreetOpsRuntime | undefined {
  return RUNTIMES.get(registry);
}

export function runtimeFromScenario(
  scenario: {
    readonly streetOps?: {
      readonly ticksPerPhase?: number;
      readonly speedMPerTick?: Readonly<Record<SpeedClass, number>>;
      readonly lostTimeoutPhases?: number;
      readonly sightRangeM?: number;
      readonly checkpointVisibleDefaultM?: number;
      readonly navigationAid?: boolean;
    };
  },
  extra?: Partial<StreetOpsRuntime>,
): StreetOpsRuntime {
  return {
    ticksPerPhase: extra?.ticksPerPhase ?? scenario.streetOps?.ticksPerPhase ?? 360,
    speeds: extra?.speeds ?? scenario.streetOps?.speedMPerTick ?? { slow: 5, normal: 10, fast: 16 },
    graphs: extra?.graphs ?? [],
    vehicles: extra?.vehicles ?? [],
    maneuvers: extra?.maneuvers ?? [],
    tails: extra?.tails ?? [],
    methods: extra?.methods ?? [],
    routes: extra?.routes ?? [],
    lostTimeoutPhases: extra?.lostTimeoutPhases ?? scenario.streetOps?.lostTimeoutPhases ?? 2,
    sightRangeM: extra?.sightRangeM ?? scenario.streetOps?.sightRangeM ?? 250,
    noticeBase: extra?.noticeBase ?? STREET_NOTICE_BASE,
    regularRate: extra?.regularRate ?? STREET_REGULAR_RATE,
    checkpoints: extra?.checkpoints ?? [],
    checkpointVisibleM: extra?.checkpointVisibleM ?? scenario.streetOps?.checkpointVisibleDefaultM ?? 120,
    composureRows: extra?.composureRows ?? [],
    passengerTrustMin: extra?.passengerTrustMin ?? 0.5,
    stories: extra?.stories ?? [],
    ledgerWindowDays: extra?.ledgerWindowDays ?? 14,
    bluffSuspicion: extra?.bluffSuspicion ?? 0.2,
    maps: extra?.maps ?? [],
    localSegments: extra?.localSegments ?? [],
    navigationAid: extra?.navigationAid ?? scenario.streetOps?.navigationAid === true,
    streetNames: extra?.streetNames ?? namesFrom(extra?.graphs ?? []),
    attributions: extra?.attributions ?? [],
  };
}

function namesFrom(graphs: readonly StreetGraph[]): string[] {
  const names = new Set<string>();
  for (const graph of graphs) {
    for (const segment of graph.segments.values()) names.add(segment.street);
    for (const junction of graph.junctions.values()) {
      if (junction.name !== undefined && junction.name !== '') names.add(junction.name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
