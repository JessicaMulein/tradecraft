/**
 * Location and route overlays (ambient-world Req 8). An empty overlay list
 * leaves the base location and the base routes unchanged. A closure that
 * would disconnect the district graph becomes a checkpoint instead.
 */

import type { Location, Route } from '../city/city.js';
import { contentPhasesOf } from '../city/time-mapping.js';
import type { GameTime, LocId, Phase } from '../model/core.js';

import { LOCATION_STATUS_KINDS } from './content.js';

export type LocationStatusKind = (typeof LOCATION_STATUS_KINDS)[number];

export type OverlayEffect =
  | { readonly kind: 'location-status'; readonly status: LocationStatusKind }
  | { readonly kind: 'crowd-modifier'; readonly factor: number }
  | { readonly kind: 'observation-modifier'; readonly factor: number }
  | { readonly kind: 'detection-modifier'; readonly factor: number }
  | { readonly kind: 'route-checkpoint'; readonly detection: number; readonly coverRisk: number }
  | { readonly kind: 'route-closure' }
  | { readonly kind: 'curfew'; readonly phases: readonly string[] };

export interface Overlay {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly fromDay: number;
  readonly toDay: number;
  readonly effect: OverlayEffect;
}

export interface EffectiveLocation {
  readonly location: Location;
  readonly status: LocationStatusKind;
  readonly crowdFactor: number;
  readonly observationFactor: number;
  readonly detectionFactor: number;
}

export interface EffectiveRoute extends Route {
  readonly checkpoint?: { readonly detection: number; readonly coverRisk: number };
}

const CLOSED: ReadonlySet<string> = new Set([
  'closed-temporarily',
  'raided',
  'requisitioned',
  'under-renovation',
  'closed-permanently',
]);

export function routeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function overlayActive(overlay: Overlay, t: GameTime): boolean {
  if (t.day < overlay.fromDay || t.day >= overlay.toDay) {
    return false;
  }
  if (overlay.effect.kind !== 'curfew') {
    return true;
  }
  const covered = new Set<string>(contentPhasesOf(t.phase));
  return overlay.effect.phases.some((phase) => phase === String(t.phase) || covered.has(phase));
}

function targets(overlay: Overlay, locId: string): boolean {
  return overlay.target === locId || overlay.target === 'city';
}

export function effectiveLocation(
  base: Location,
  overlays: readonly Overlay[],
  t: GameTime,
): EffectiveLocation {
  let status: LocationStatusKind = 'open';
  let crowdFactor = 1;
  let observationFactor = 1;
  let detectionFactor = 1;
  const closedPhases = new Set<Phase>();
  for (const overlay of overlays) {
    if (!overlayActive(overlay, t) || !targets(overlay, base.id)) {
      continue;
    }
    switch (overlay.effect.kind) {
      case 'location-status':
        status = overlay.effect.status;
        break;
      case 'crowd-modifier':
        crowdFactor *= overlay.effect.factor;
        break;
      case 'observation-modifier':
        observationFactor *= overlay.effect.factor;
        break;
      case 'detection-modifier':
        detectionFactor *= overlay.effect.factor;
        break;
      case 'curfew':
        if (base.public) {
          for (const phase of [0, 1, 2, 3] as const) {
            const names = new Set<string>(contentPhasesOf(phase));
            if (overlay.effect.phases.some((name) => name === String(phase) || names.has(name))) {
              closedPhases.add(phase);
            }
          }
        }
        break;
      default:
        break;
    }
  }
  const hours = { ...base.hours };
  if (CLOSED.has(status)) {
    hours[0] = false;
    hours[1] = false;
    hours[2] = false;
    hours[3] = false;
  }
  for (const phase of closedPhases) {
    hours[phase] = false;
  }
  return {
    location: {
      ...base,
      hours,
      risk: Math.min(1, Math.max(0, base.risk * detectionFactor)),
    },
    status,
    crowdFactor,
    observationFactor,
    detectionFactor,
  };
}

function componentCount(routes: readonly Route[], nodes: ReadonlySet<string>): number {
  const neighbours = new Map<string, string[]>();
  for (const route of routes) {
    const left = neighbours.get(route.a) ?? [];
    left.push(route.b);
    neighbours.set(route.a, left);
    const right = neighbours.get(route.b) ?? [];
    right.push(route.a);
    neighbours.set(route.b, right);
  }
  const seen = new Set<string>();
  let count = 0;
  for (const node of nodes) {
    if (seen.has(node)) {
      continue;
    }
    count += 1;
    const stack = [node];
    seen.add(node);
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) {
        break;
      }
      for (const next of neighbours.get(current) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
  }
  return count;
}

export function effectiveRoutes(
  base: readonly Route[],
  overlays: readonly Overlay[],
  t: GameTime,
): EffectiveRoute[] {
  let routes: Route[] = [...base];
  const checkpoints = new Map<string, { detection: number; coverRisk: number }>();
  const nodes = new Set<string>();
  for (const route of base) {
    nodes.add(route.a);
    nodes.add(route.b);
  }
  const originalComponents = componentCount(base, nodes);
  for (const overlay of overlays) {
    if (!overlayActive(overlay, t)) {
      continue;
    }
    if (overlay.effect.kind === 'route-closure') {
      const without = routes.filter((route) => routeKey(route.a, route.b) !== overlay.target);
      if (componentCount(without, nodes) <= originalComponents) {
        routes = without;
      } else {
        const existing = checkpoints.get(overlay.target);
        checkpoints.set(overlay.target, existing ?? { detection: 0.5, coverRisk: 0.1 });
      }
    }
    if (overlay.effect.kind === 'route-checkpoint') {
      checkpoints.set(overlay.target, {
        detection: overlay.effect.detection,
        coverRisk: overlay.effect.coverRisk,
      });
    }
  }
  return routes.map((route) => {
    const checkpoint = checkpoints.get(routeKey(route.a, route.b));
    return checkpoint === undefined ? { ...route } : { ...route, checkpoint };
  });
}

export function removeOverlaysFrom(overlays: readonly Overlay[], source: string): Overlay[] {
  return overlays.filter((overlay) => overlay.source !== source);
}

export function activateDormant(
  dormant: readonly string[],
  loc: string,
): { readonly dormant: readonly string[]; readonly activated: boolean } {
  if (!dormant.includes(loc)) {
    return { dormant, activated: false };
  }
  return { dormant: dormant.filter((id) => id !== loc), activated: true };
}

export function announceLocation(
  known: readonly string[],
  loc: string,
  isPublic: boolean,
): readonly string[] {
  if (!isPublic || known.includes(loc)) {
    return known;
  }
  return [...known, loc];
}

export interface DropSiteState {
  readonly id: string;
  readonly unavailable: boolean;
  readonly pendingDisturbance: boolean;
  readonly playerItems: readonly string[];
}

export function raidDrop(drop: DropSiteState): {
  readonly drop: DropSiteState;
  readonly event: 'drop-raided';
  readonly seized: readonly string[];
} {
  return {
    drop: { ...drop, unavailable: true, pendingDisturbance: true, playerItems: [] },
    event: 'drop-raided',
    seized: drop.playerItems,
  };
}

export function serviceDrop(drop: DropSiteState): {
  readonly drop: DropSiteState;
  readonly event?: 'drop-disturbed';
} {
  if (!drop.pendingDisturbance) {
    return { drop };
  }
  return {
    drop: { ...drop, pendingDisturbance: false },
    event: 'drop-disturbed',
  };
}

/** The location fields these updates read. Callers pass the world. */
interface SeenWorld {
  readonly time: GameTime;
  readonly city: { readonly locations: Readonly<Record<string, Location>> };
  readonly ambient?: {
    readonly overlays: readonly Overlay[];
    readonly lastKnownStatus?: Readonly<Record<string, string>>;
  };
}

/** Record the status the player can see by standing at a Location. */
export function observeLocation<W extends SeenWorld>(world: W, loc: LocId): W {
  const ambient = world.ambient;
  const place = world.city.locations[loc];
  if (ambient === undefined || place === undefined) {
    return world;
  }
  const status =
    ambient.overlays.length === 0 ? 'open' : effectiveLocation(place, ambient.overlays, world.time).status;
  if (ambient.lastKnownStatus?.[loc] === status) {
    return world;
  }
  return {
    ...world,
    ambient: {
      ...ambient,
      lastKnownStatus: { ...ambient.lastKnownStatus, [loc]: status },
    },
  };
}

/**
 * Record a status a Document or Notice states by name. A text that does not
 * name both a place and a status leaves the world unchanged, so a live overlay
 * is not copied onto the map.
 */
export function learnAnnouncedStatus<W extends SeenWorld>(world: W, text: string): W {
  const ambient = world.ambient;
  if (ambient === undefined || text.length === 0) {
    return world;
  }
  const lower = text.toLowerCase();
  const ranked = [...LOCATION_STATUS_KINDS].sort((a, b) => b.length - a.length);
  const status = ranked.find(
    (kind) => kind !== 'open' && (lower.includes(kind) || lower.includes(kind.replaceAll('-', ' '))),
  );
  if (status === undefined) {
    return world;
  }
  let known = ambient.lastKnownStatus;
  let changed = false;
  for (const place of Object.values(world.city.locations).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!lower.includes(place.name.toLowerCase()) || known?.[place.id] === status) {
      continue;
    }
    known = { ...known, [place.id]: status };
    changed = true;
  }
  if (!changed || known === undefined) {
    return world;
  }
  return { ...world, ambient: { ...ambient, lastKnownStatus: known } };
}

export function rememberStatus(
  known: Readonly<Record<string, string>>,
  loc: string,
  status: string,
): Record<string, string> {
  return { ...known, [loc]: status };
}
