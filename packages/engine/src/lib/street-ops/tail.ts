/**
 * Tail teams (street-ops task 7.1 and 7.5).
 *
 * The slice flag `player.tailed` is the only decision the rest of the game
 * reads. The team, its vehicles and its status stay on the truth slice.
 */

import type { StreetPhase } from './content.js';
import type { StreetGraph } from './graph.js';
import type { ManeuverOffer, SurveillanceRoute } from './maneuver.js';
import { routeJustCompleted, summariseObservations } from './maneuver.js';
import { descriptorFor, spotVehicles, type SpotVehicle, type StreetObservation } from './spot.js';
import {
  emptyStreetOpsTruth,
  type StreetOpsTruth,
  type StreetPosition,
  type TailStatus,
  type TailTeam,
  type TailVehicle,
} from './state.js';
import { streetSubstream } from './stream.js';

export interface TailProfileOffer {
  readonly id: string;
  readonly service: string;
  readonly discipline: number;
  readonly team: number;
  readonly methods: readonly string[];
}

export interface MethodOffer {
  readonly id: string;
  readonly era: { readonly from: number; readonly to: number };
}

/** How the service reacts when a team loses the player. Quiet losses do not raise suspicion. */
export interface TailEscalation {
  readonly coverSuspicionDelta: number;
  readonly alert: boolean;
  readonly search: boolean;
}

export type TeamCondition = 'on' | 'lost-briefly' | 'lost' | 'handed-off' | 'burned';

const ARRIVAL_RISK_FACTOR = 0.5;
export const WATCHED_ASSET_EXPOSURE = 0.05;

export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function holdChance(input: {
  readonly discipline: number;
  readonly quality: number;
  readonly vehicles: number;
  readonly traffic: number;
}): number {
  const skill = input.discipline;
  const teamFactor = Math.min(2, 1 + 0.1 * Math.max(0, input.vehicles - 1));
  const trafficFactor = 1 / Math.max(1, input.traffic);
  return clamp01(skill * (1 - input.quality) * teamFactor * trafficFactor + input.discipline * 0.1);
}

export function classifyHold(
  chance: number,
  draw: number,
  hasBackup: boolean,
  obvious: boolean,
): TailStatus {
  if (draw < chance) return 'attached';
  const span = 1 - chance;
  const rest = span === 0 ? 1 : (draw - chance) / span;
  if (hasBackup && rest < 0.5) return 'handed-off';
  if (obvious) return 'burned';
  return 'lost';
}

export function escalation(status: TailStatus, obvious: boolean, amount: number): TailEscalation {
  if (status === 'burned') return { coverSuspicionDelta: amount, alert: true, search: true };
  if (status === 'lost' && obvious) return { coverSuspicionDelta: amount, alert: true, search: false };
  return { coverSuspicionDelta: 0, alert: false, search: false };
}

/** Attached and handed-off are the slice's tailed flag. A brief loss is not. */
export function tailedFlag(teams: Readonly<Record<string, TailTeam>>): boolean {
  return Object.values(teams).some((team) => team.status === 'attached' || team.status === 'handed-off');
}

export function teamCondition(team: TailTeam, lostTimeoutPhases: number): TeamCondition {
  if (team.status === 'attached') return 'on';
  if (team.status === 'handed-off') return 'handed-off';
  if (team.status === 'burned') return 'burned';
  if (team.lostFor < lostTimeoutPhases) return 'lost-briefly';
  return 'lost';
}

export function arrivalSuspicion(attached: boolean, risk: number): number {
  if (!attached || risk <= 0) return 0;
  return risk * ARRIVAL_RISK_FACTOR;
}

export function watchedExposure<Id extends string>(
  attached: boolean,
  present: readonly Id[],
  exposureOf: (npc: Id) => number | undefined,
): Readonly<Record<string, number>> {
  if (!attached) return {};
  const out: Record<string, number> = {};
  for (const npc of present) {
    const current = exposureOf(npc);
    if (current === undefined) continue;
    out[npc] = clamp01(current + WATCHED_ASSET_EXPOSURE);
  }
  return out;
}

function methodFits(profile: TailProfileOffer, methods: readonly MethodOffer[], year: number): boolean {
  if (profile.methods.length === 0) return false;
  return profile.methods.some((id) => {
    const method = methods.find((item) => item.id === id || item.id.endsWith(`/${id}`) || id.endsWith(`/${item.id}`));
    return method !== undefined && year >= method.era.from && year <= method.era.to;
  });
}

function live(team: TailTeam): boolean {
  return team.status === 'attached' || team.status === 'handed-off' || team.status === 'lost';
}

export function materialiseTeam(input: {
  readonly wanted: boolean;
  readonly truth: StreetOpsTruth;
  readonly profiles: readonly TailProfileOffer[];
  readonly methods: readonly MethodOffer[];
  readonly year: number;
  readonly sessionKey: string;
  readonly step: number;
}): StreetOpsTruth {
  if (!input.wanted) return input.truth;
  if (Object.values(input.truth.teams).some((team) => live(team))) return input.truth;
  const profile = [...input.profiles]
    .filter((item) => methodFits(item, input.methods, input.year))
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (profile === undefined) return input.truth;
  const id = `${profile.id}:${input.sessionKey}`;
  const vehicles: TailVehicle[] = [];
  for (let index = 0; index < profile.team; index += 1) {
    const role = index === 0 ? 'lead' : index === 1 ? 'backup' : 'parallel';
    const vehicleId = `${id}:${index}`;
    vehicles.push({
      id: vehicleId,
      descriptor: descriptorFor(vehicleId),
      lag: role === 'lead' ? 1 : 2,
      role,
      segment: undefined,
    });
  }
  const team: TailTeam = {
    id,
    service: profile.service,
    profile: profile.id,
    status: 'attached',
    since: input.step,
    lostFor: 0,
    obvious: false,
    vehicles,
  };
  return { ...input.truth, teams: { ...input.truth.teams, [id]: team } };
}

function pathIndex(path: readonly StreetPosition[], lag: number, jitter: number): number {
  return Math.max(0, path.length - 1 - lag + jitter);
}

function jitterFor(seed: string, sessionKey: string, vehicleId: string, step: number): number {
  const draw = streetSubstream(seed, 'tail', `${sessionKey}:jitter:${vehicleId}:${step}`).next();
  if (draw < 0.2) return -1;
  if (draw < 0.4) return 1;
  return 0;
}

function parallelSegment(graph: StreetGraph, segmentId: string): string | undefined {
  const segment = graph.segments.get(segmentId);
  if (segment === undefined) return undefined;
  for (const item of graph.segments.values()) {
    if (item.id === segmentId) continue;
    if (item.from === segment.to || item.to === segment.to || item.from === segment.from || item.to === segment.from) {
      return item.id;
    }
  }
  return undefined;
}

export function follow(input: {
  readonly seed: string;
  readonly sessionKey: string;
  readonly step: number;
  readonly path: readonly StreetPosition[];
  readonly here: string;
  readonly graph: StreetGraph;
  readonly team: TailTeam;
}): TailTeam {
  if (input.team.status === 'lost' || input.team.status === 'burned') {
    return input.team;
  }
  const vehicles = input.team.vehicles.map((vehicle) => {
    const jitter = jitterFor(input.seed, input.sessionKey, vehicle.id, input.step);
    const index = pathIndex(input.path, vehicle.lag, jitter);
    const along = input.path[index]?.segment ?? input.here;
    if (vehicle.role === 'parallel') {
      return { ...vehicle, segment: parallelSegment(input.graph, along) ?? along };
    }
    if (vehicle.role === 'backup') {
      const behind = input.path[Math.max(0, index - 1)]?.segment ?? along;
      return { ...vehicle, segment: behind };
    }
    return { ...vehicle, segment: along };
  });
  const lead = vehicles.find((vehicle) => vehicle.role === 'lead');
  return { ...input.team, vehicles, ...(lead?.segment === undefined ? {} : { lastKnown: lead.segment }) };
}

export function applyHold(team: TailTeam, status: TailStatus, obvious: boolean, step: number): TailTeam {
  if (status === 'handed-off') {
    const vehicles = team.vehicles.map((vehicle) => {
      if (vehicle.role !== 'lead') return vehicle;
      const id = `${vehicle.id}:relief:${step}`;
      return { ...vehicle, id, descriptor: descriptorFor(id) };
    });
    return { ...team, status, obvious: false, vehicles };
  }
  if (status === 'attached') return { ...team, status };
  return { ...team, status, obvious, lastKnown: team.lastKnown ?? team.vehicles[0]?.segment };
}

export interface StreetStepInput {
  readonly seed: string;
  readonly year: number;
  readonly sessionKey: string;
  readonly step: number;
  readonly phases: number;
  readonly path: readonly StreetPosition[];
  readonly here: string;
  readonly street: string;
  readonly phase: StreetPhase;
  readonly traffic: number;
  readonly attention: number;
  readonly wanted: boolean;
  readonly truth: StreetOpsTruth;
  readonly profiles: readonly TailProfileOffer[];
  readonly methods: readonly MethodOffer[];
  readonly graph: StreetGraph;
  readonly sightRangeM: number;
  readonly noticeBase: number;
  readonly regularRate: number;
  readonly lostTimeoutPhases: number;
  readonly maneuver?: ManeuverOffer;
  readonly arrivalRisk: number;
  readonly beforePath: readonly StreetPosition[];
  readonly routes: readonly SurveillanceRoute[];
  readonly noted: readonly string[];
}

export interface StreetStepResult {
  readonly truth: StreetOpsTruth;
  readonly tailed: boolean;
  readonly coverSuspicionDelta: number;
  readonly alert: boolean;
  readonly search: boolean;
  readonly lines: readonly string[];
  readonly observations: readonly StreetObservation[];
  readonly present: readonly SpotVehicle[];
}

function expire(truth: StreetOpsTruth, phases: number, timeout: number): StreetOpsTruth {
  if (phases <= 0) return truth;
  const teams: Record<string, TailTeam> = {};
  for (const team of Object.values(truth.teams)) {
    if (team.status !== 'lost' && team.status !== 'burned') {
      teams[team.id] = team;
      continue;
    }
    const lostFor = team.lostFor + phases;
    if (lostFor >= timeout) continue;
    teams[team.id] = { ...team, lostFor };
  }
  return { ...truth, teams };
}

export function stepStreet(input: StreetStepInput): StreetStepResult {
  const withdrawn: Record<string, TailTeam> = {};
  for (const team of Object.values(input.truth.teams)) {
    if (!input.wanted && (team.status === 'attached' || team.status === 'handed-off')) {
      withdrawn[team.id] = { ...team, status: 'lost', obvious: false };
    } else {
      withdrawn[team.id] = team;
    }
  }
  let truth = materialiseTeam({
    wanted: input.wanted,
    truth: { ...input.truth, teams: withdrawn },
    profiles: input.profiles,
    methods: input.methods,
    year: input.year,
    sessionKey: input.sessionKey,
    step: input.step,
  });
  const teams: Record<string, TailTeam> = {};
  let coverSuspicionDelta = 0;
  let alert = false;
  let search = false;
  for (const team of Object.values(truth.teams)) {
    let next = follow({
      seed: input.seed,
      sessionKey: input.sessionKey,
      step: input.step,
      path: input.path,
      here: input.here,
      graph: input.graph,
      team,
    });
    if (input.maneuver !== undefined && (next.status === 'attached' || next.status === 'handed-off')) {
      const profile = input.profiles.find((item) => item.id === next.profile);
      const discipline = profile?.discipline ?? 0.5;
      const chance = holdChance({
        discipline,
        quality: input.maneuver.quality,
        vehicles: next.vehicles.length,
        traffic: input.traffic,
      });
      const rolled = streetSubstream(input.seed, 'tail', `${input.sessionKey}:hold:${next.id}:${input.step}`).next();
      const obvious = input.maneuver.suspicion >= 0.5;
      const status = classifyHold(chance, rolled, next.vehicles.some((vehicle) => vehicle.role === 'backup'), obvious);
      next = applyHold(next, status, obvious, input.step);
      const reaction = escalation(status, obvious, input.maneuver.suspicion);
      coverSuspicionDelta += reaction.coverSuspicionDelta;
      alert = alert || reaction.alert;
      search = search || reaction.search;
    }
    teams[next.id] = next;
  }
  truth = expire({ ...truth, teams }, input.phases, input.lostTimeoutPhases);
  const watching = tailedFlag(truth.teams);
  const tailed = watching || (input.wanted && Object.keys(truth.teams).length === 0);
  coverSuspicionDelta += arrivalSuspicion(watching, input.arrivalRisk);
  const tails: SpotVehicle[] = [];
  for (const team of Object.values(truth.teams)) {
    if (team.status === 'burned') continue;
    const profile = input.profiles.find((item) => item.id === team.profile);
    for (const vehicle of team.vehicles) {
      if (vehicle.segment === undefined) continue;
      tails.push({
        id: vehicle.id,
        segment: vehicle.segment,
        descriptor: vehicle.descriptor,
        discipline: profile?.discipline ?? 0.5,
        conspicuousness: 0.4,
      });
    }
  }
  const spotted = spotVehicles({
    seed: input.seed,
    sessionKey: input.sessionKey,
    step: input.step,
    segment: input.here,
    street: input.street,
    traffic: input.traffic,
    attention: input.attention,
    noticeBase: input.noticeBase,
    regularRate: input.regularRate,
    sightRangeM: input.sightRangeM,
    graph: input.graph,
    tails,
  });
  const lines = spotted.noticed.map((item) => item.line);
  const finished = routeJustCompleted(input.graph, input.beforePath, input.path, input.routes);
  if (finished !== undefined) lines.push(summariseObservations([...input.noted, ...lines]));
  return {
    truth,
    tailed,
    coverSuspicionDelta,
    alert,
    search,
    lines,
    observations: spotted.noticed,
    present: spotted.present,
  };
}

export function emptyTruth(): StreetOpsTruth {
  return emptyStreetOpsTruth();
}
