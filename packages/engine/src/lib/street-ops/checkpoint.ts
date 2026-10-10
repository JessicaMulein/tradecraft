/**
 * Checkpoint checks (street-ops task 8).
 *
 * `vehicleCheck` is pure. A higher thoroughness, a deeper search, or a weaker
 * hiding place never finds less when the draw is the same. A sector line on a
 * city street is decided here. A car at a border post uses the same function
 * through the border extension.
 */

import type { BorderExtension, BorderInput, BorderOutcome, BorderResult } from '../border/check.js';
import { requiredPapersMissing } from '../border/check.js';
import { revealTruth, type Truth } from '../model/core.js';
import type { Prng } from '../prng/prng.js';
import type { WatchList } from '../region/services.js';

import type { CheckpointKind, StreetPhase } from './content.js';
import type { StreetGraph } from './graph.js';
import type { StreetPosition } from './state.js';

export const SEARCH_LEVELS = ['none', 'visual', 'interior', 'boot', 'undercarriage'] as const;
export type SearchLevel = (typeof SEARCH_LEVELS)[number];

const SEARCH_RANK: Readonly<Record<SearchLevel, number>> = {
  none: 0,
  visual: 1,
  interior: 2,
  boot: 3,
  undercarriage: 4,
};

/** Fixed weights. Thoroughness, search depth, time hidden and suspicion raise the chance. Difficulty and composure lower it. */
const WEIGHT = { thoroughness: 1.5, search: 0.45, difficulty: 1.5, composure: 1.5, hidden: 1, suspicion: 1.5 } as const;

export interface HiddenCargo {
  readonly id: string;
  readonly difficulty: number;
  readonly endurance: number;
  readonly ticksConcealed: number;
  readonly composure: number;
  readonly kind: 'item' | 'passenger';
  /** Searches that can reach this spot. Omitted means every search can. */
  readonly reachedBy?: readonly SearchLevel[];
}

export interface VehicleCheckInput {
  readonly vehicle: { readonly id: string; readonly plate: string };
  readonly passengers: readonly { readonly id: string; readonly declared: boolean }[];
  readonly concealment: readonly HiddenCargo[];
  readonly kind: CheckpointKind;
  readonly papersValid: boolean;
  readonly onWatch: boolean;
  readonly suspicion: number;
}

export type CheckpointOutcome = BorderOutcome | 'vehicle-seized' | 'turned-back';

export interface VehicleCheckResult {
  readonly outcome: CheckpointOutcome;
  readonly ticks: number;
  readonly found: readonly string[];
  readonly suspicionDelta: number;
  readonly facts: readonly string[];
  readonly search: SearchLevel;
}

export interface DetectionInput {
  readonly thoroughness: number;
  readonly searchLevelRank: number;
  readonly suspicion: number;
  readonly ticksConcealed: number;
  readonly endurance: number;
  readonly difficulty: number;
  readonly composure: number;
}

function logistic(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** The chance a search finds this hiding place. Monotonic in the weights above. */
export function detectionChance(input: DetectionInput): number {
  const ratio = input.endurance <= 0 ? 4 : Math.min(4, Math.max(0, input.ticksConcealed) / input.endurance);
  const z =
    WEIGHT.thoroughness * input.thoroughness +
    WEIGHT.search * input.searchLevelRank -
    WEIGHT.difficulty * input.difficulty -
    WEIGHT.composure * input.composure +
    WEIGHT.hidden * ratio +
    WEIGHT.suspicion * input.suspicion;
  return logistic(z);
}

export function searchLevel(kind: CheckpointKind, suspicion: number): SearchLevel {
  const target = Math.min(4, Math.round((kind.thoroughness + kind.strictness + Math.max(0, suspicion)) * 2));
  const allowed = kind.searches.map((level) => ({ level, rank: SEARCH_RANK[level] }));
  const open = allowed.filter((item) => item.rank <= Math.max(target, 1));
  const pool = open.length > 0 ? open : allowed;
  return pool.reduce((best, item) => (item.rank > best.rank ? item : best)).level;
}

export function checkpointDelayTicks(level: SearchLevel): number {
  return SEARCH_RANK[level] * 2;
}

function reached(cargo: HiddenCargo, level: SearchLevel): boolean {
  if (level === 'none') return false;
  if (cargo.reachedBy === undefined) return true;
  return cargo.reachedBy.includes(level);
}

function factFor(outcome: CheckpointOutcome, street: string): string {
  if (outcome === 'pass') return `The ${street} checkpoint waves you through.`;
  if (outcome === 'secondary') return `The ${street} checkpoint holds you for a second look.`;
  if (outcome === 'seizure') return `The ${street} checkpoint takes something from the car.`;
  if (outcome === 'refused' || outcome === 'turned-back') return `The ${street} checkpoint turns you back.`;
  if (outcome === 'vehicle-seized') return `The ${street} checkpoint seizes the car.`;
  return `The ${street} checkpoint detains you.`;
}

function floorOutcome(floor: BorderOutcome, found: CheckpointOutcome): CheckpointOutcome {
  if (found === 'vehicle-seized' || found === 'turned-back') return found;
  const rank = { pass: 0, secondary: 1, seizure: 2, detained: 3, refused: 4 };
  return rank[found] >= rank[floor] ? found : floor;
}

/**
 * One vehicle check. `draw` is in `[0, 1)`. The same draw and a harder search
 * find everything the easier search found.
 */
export function vehicleCheck(input: VehicleCheckInput, draw: number): VehicleCheckResult {
  const street = input.kind.id;
  const search = searchLevel(input.kind, input.suspicion);
  const ticks = checkpointDelayTicks(search);
  if (!input.papersValid && input.onWatch) {
    return { outcome: 'detained', ticks, found: [], suspicionDelta: 0.3, facts: [`The ${street} checkpoint detains you.`], search };
  }
  if (!input.papersValid) {
    return { outcome: 'refused', ticks, found: [], suspicionDelta: 0, facts: [`The ${street} checkpoint turns you back.`], search };
  }
  if (input.onWatch) {
    return { outcome: 'detained', ticks, found: [], suspicionDelta: 0.3, facts: [`The ${street} checkpoint detains you.`], search };
  }
  const rank = SEARCH_RANK[search];
  const found = input.concealment.filter((cargo) => {
    if (!reached(cargo, search)) return false;
    if (cargo.kind === 'passenger' && cargo.ticksConcealed > cargo.endurance) return true;
    const chance = detectionChance({
      thoroughness: input.kind.thoroughness,
      searchLevelRank: rank,
      suspicion: input.suspicion,
      ticksConcealed: cargo.ticksConcealed,
      endurance: cargo.endurance,
      difficulty: cargo.difficulty,
      composure: cargo.composure,
    });
    return draw < chance;
  });
  const passenger = found.find((cargo) => cargo.kind === 'passenger');
  if (passenger !== undefined) {
    return {
      outcome: 'vehicle-seized',
      ticks,
      found: found.map((cargo) => cargo.id),
      suspicionDelta: 0.3,
      facts: [`The ${street} checkpoint seizes the car.`],
      search,
    };
  }
  if (found.length > 0) {
    return {
      outcome: floorOutcome(input.kind.borderCheck, 'seizure'),
      ticks,
      found: found.map((cargo) => cargo.id),
      suspicionDelta: 0.2,
      facts: [`The ${street} checkpoint takes something from the car.`],
      search,
    };
  }
  const outcome = floorOutcome(input.kind.borderCheck, input.suspicion >= 0.6 ? 'secondary' : 'pass');
  return { outcome, ticks, found: [], suspicionDelta: outcome === 'pass' ? 0 : 0.05, facts: [factFor(outcome, street)], search };
}

/** Cover suspicion for turning back. Zero unless the post watches for it. */
export function avoidanceDelta(kind: Pick<CheckpointKind, 'watchesAvoidance' | 'avoidanceSuspicion'>): number {
  if (!kind.watchesAvoidance) return 0;
  return kind.avoidanceSuspicion;
}

/** A random stop when the draw falls under the police-pressure reading. Pressure zero never stops anyone. */
export function randomStop(draw: number, pressure: number, kind: CheckpointKind): CheckpointKind | undefined {
  if (pressure <= 0 || draw >= pressure) return undefined;
  return kind;
}

/** Police pressure on the 0–1 scale the random-stop draw uses. */
export function policePressure(exo: number, react: number): number {
  const sum = exo + react;
  if (sum <= 0) return 0;
  if (sum >= 1) return 1;
  return sum;
}

function stableIndex(id: string, length: number): number {
  let hash = 0;
  for (const ch of id) hash = Math.imul(hash, 33) + ch.charCodeAt(0);
  const index = hash % length;
  return index < 0 ? index + length : index;
}

function crackdownIds(events: Readonly<Record<string, unknown>>, day: number): string[] {
  const ids: string[] = [];
  for (const value of Object.values(events)) {
    if (value === null || typeof value !== 'object') continue;
    const event = value as { templateId?: unknown; name?: unknown; start?: unknown; end?: unknown };
    const templateId = typeof event.templateId === 'string' ? event.templateId : undefined;
    const name = typeof event.name === 'string' ? event.name : undefined;
    const label = `${templateId ?? ''} ${name ?? ''}`.toLowerCase();
    if (!label.includes('crackdown') && !label.includes('curfew')) continue;
    if (typeof event.start !== 'number' || typeof event.end !== 'number') continue;
    if (event.start > day || day >= event.end) continue;
    const id = templateId ?? name;
    if (id !== undefined) ids.push(id);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

/**
 * A crackdown that is running today places one roadblock on a stable mapped street.
 * No active crackdown, or no roadblock kind, leaves the graph unchanged.
 */
export function withCrackdownPosts(
  graph: StreetGraph,
  day: number,
  events: Readonly<Record<string, unknown>> | undefined,
  kindId: string | undefined,
): StreetGraph {
  if (kindId === undefined || events === undefined) return graph;
  const mapped = [...graph.segments.values()]
    .filter((segment) => segment.mapped && !segment.closed)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (mapped.length === 0) return graph;
  const sites: { id: string; kind: string; segment: string; at: number }[] = [];
  for (const id of crackdownIds(events, day)) {
    const segment = mapped[stableIndex(id, mapped.length)];
    if (segment === undefined) continue;
    sites.push({ id: `roadblock-${id}`, kind: kindId, segment: segment.id, at: 0.5 });
  }
  if (sites.length === 0) return graph;
  return { ...graph, checkpoints: [...graph.checkpoints, ...sites] };
}

function haltAt(before: StreetPosition, after: StreetPosition): number {
  if (before.segment !== after.segment) return 0.5;
  const here = before.dir === 'fwd' ? before.progress : 1 - before.progress;
  const end = before.dir === 'fwd' ? 1 : 0;
  return here + (end - here) / 2;
}

/** A pressure stop on the street this step travels, when the draw falls under the reading. */
export function withPressureStop(
  graph: StreetGraph,
  before: StreetPosition,
  after: StreetPosition,
  draw: number,
  pressure: number,
  kind: CheckpointKind | undefined,
): StreetGraph {
  if (kind === undefined || randomStop(draw, pressure, kind) === undefined) return graph;
  return {
    ...graph,
    checkpoints: [
      ...graph.checkpoints,
      { id: `halt-${after.segment}`, kind: kind.id, segment: after.segment, at: haltAt(before, after) },
    ],
  };
}

function physical(position: StreetPosition): number {
  return position.dir === 'fwd' ? position.progress : 1 - position.progress;
}

export function distanceToCheckpoint(position: StreetPosition, at: number, lengthM: number): number | undefined {
  const here = physical(position);
  const ahead = position.dir === 'fwd' ? at - here : here - at;
  if (ahead < -1e-9) return undefined;
  return Math.max(0, ahead) * lengthM;
}

function passed(before: StreetPosition, after: StreetPosition, at: number): boolean {
  const from = physical(before);
  const to = physical(after);
  if (before.dir === 'fwd') return from < at && to >= at - 1e-9;
  return from > at && to <= at + 1e-9;
}

export function crossesCheckpoint(before: StreetPosition, after: StreetPosition, siteSegment: string, at: number): boolean {
  if (after.segment !== siteSegment) return false;
  if (before.segment !== siteSegment) {
    const start: StreetPosition = { segment: after.segment, dir: after.dir, progress: 0 };
    return passed(start, after, at);
  }
  if (before.dir !== after.dir) return false;
  return passed(before, after, at);
}

export interface AheadCheckpoint {
  readonly id: string;
  readonly kind: CheckpointKind;
  readonly street: string;
  readonly distanceM: number;
  readonly band: 'near' | 'far';
}

function kindOf(id: string, kinds: readonly CheckpointKind[]): CheckpointKind | undefined {
  return kinds.find((kind) => kind.id === id || id.endsWith(`/${kind.id}`) || kind.id.endsWith(`/${id}`));
}

function open(kind: CheckpointKind, phase: StreetPhase, siteHours: readonly StreetPhase[] | undefined): boolean {
  const hours = siteHours ?? kind.hours;
  return hours.includes(phase);
}

export function checkpointsAhead(
  graph: StreetGraph,
  position: StreetPosition,
  phase: StreetPhase,
  kinds: readonly CheckpointKind[],
  defaultVisibleM: number,
): readonly AheadCheckpoint[] {
  const segment = graph.segments.get(position.segment);
  if (segment === undefined) return [];
  const ahead: AheadCheckpoint[] = [];
  for (const site of graph.checkpoints) {
    if (site.segment !== position.segment) continue;
    const kind = kindOf(site.kind, kinds);
    if (kind === undefined || !open(kind, phase, site.hours)) continue;
    const distance = distanceToCheckpoint(position, site.at, segment.lengthM);
    const visible = site.visibleM ?? defaultVisibleM;
    if (distance === undefined || distance > visible) continue;
    ahead.push({
      id: site.id,
      kind,
      street: segment.street,
      distanceM: distance,
      band: distance <= visible / 2 ? 'near' : 'far',
    });
  }
  return ahead;
}

export function checkpointsCrossed(
  graph: StreetGraph,
  before: StreetPosition,
  after: StreetPosition,
  phase: StreetPhase,
  kinds: readonly CheckpointKind[],
): readonly AheadCheckpoint[] {
  const crossed: AheadCheckpoint[] = [];
  for (const site of graph.checkpoints) {
    const onAfter = site.segment === after.segment && before.segment !== after.segment;
    const onBefore = site.segment === before.segment && before.segment === after.segment;
    if (!onAfter && !onBefore) continue;
    const moving = onAfter ? { segment: after.segment, dir: after.dir, progress: 0 } : before;
    if (!crossesCheckpoint(moving, after, site.segment, site.at)) continue;
    const kind = kindOf(site.kind, kinds);
    const segment = graph.segments.get(site.segment);
    if (kind === undefined || segment === undefined || !open(kind, phase, site.hours)) continue;
    crossed.push({ id: site.id, kind, street: segment.street, distanceM: 0, band: 'near' });
  }
  return crossed;
}

export function aheadLine(street: string): string {
  return `A checkpoint is ahead on ${street}.`;
}

function watchHit(input: BorderInput, plate: string): boolean {
  const watch = revealTruth(input.watch as Truth<WatchList>);
  if (watch.persons.includes(input.traveller.identity as (typeof watch.persons)[number])) return true;
  return watch.descriptors.includes(plate) || watch.descriptors.includes(input.traveller.descriptor);
}

/** The border seam for a traveller in a car. On foot it does not apply, and the ordinary check runs. */
export function vehicleBorderExtension(kind: CheckpointKind): BorderExtension {
  return {
    id: 'street-ops.vehicle',
    applies(traveller) {
      return traveller.vehicle?.plate !== undefined;
    },
    check(input: BorderInput, rng: Prng): BorderResult {
      const plate = input.traveller.vehicle?.plate ?? '';
      const result = vehicleCheck(
        {
          vehicle: { id: plate, plate },
          passengers: [],
          concealment: [],
          kind: { ...kind, strictness: input.post.strictness, thoroughness: Math.max(kind.thoroughness, input.post.strictness) },
          papersValid: !requiredPapersMissing(input),
          onWatch: watchHit(input, plate),
          suspicion: input.post.strictness,
        },
        rng.next(),
      );
      const outcome: BorderOutcome = result.outcome === 'vehicle-seized' ? 'detained' : result.outcome === 'turned-back' ? 'refused' : result.outcome;
      return {
        outcome,
        seized: result.found,
        suspicionDelta: result.suspicionDelta,
        phasesAdded: result.outcome === 'detained' || result.outcome === 'vehicle-seized' ? input.rules.detentionPhases : result.ticks > 0 ? 1 : 0,
        detail: result,
      };
    },
  };
}

/** A car at a border post. On foot the extension does not apply. */
export const VEHICLE_BORDER: BorderExtension = vehicleBorderExtension({
  id: 'border',
  borderCheck: 'pass',
  thoroughness: 0.5,
  hours: ['morning', 'afternoon', 'evening', 'night'],
  searches: ['visual', 'interior', 'boot'],
  watchesAvoidance: false,
  avoidanceSuspicion: 0,
  strictness: 0.5,
});
