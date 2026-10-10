/**
 * Evasion maneuvers and a surveillance-detection route (street-ops task 7.4).
 *
 * A maneuver is offered where its graph features hold. The offer does not
 * depend on whether a team is attached. Completing a route summarises the
 * cars the player noted. It does not say whether anyone was following.
 */

import type { GraphFeature } from './content.js';
import type { StreetGraph } from './graph.js';
import type { StreetPosition } from './state.js';

export interface ManeuverOffer {
  readonly id: string;
  readonly era: { readonly from: number; readonly to: number };
  readonly requires: readonly GraphFeature[];
  readonly quality: number;
  readonly ticks: number;
  /** How obvious the move is. A quiet loss adds no cover suspicion. */
  readonly suspicion: number;
}

export interface SurveillanceRoute {
  readonly id: string;
  readonly junctions: readonly string[];
}

export function featuresAt(graph: StreetGraph, segmentId: string): readonly GraphFeature[] {
  const segment = graph.segments.get(segmentId);
  if (segment === undefined) return [];
  const found = new Set<GraphFeature>();
  if (segment.oneWay) {
    found.add('one-way');
    found.add('contraflow');
  }
  for (const feature of segment.features ?? []) found.add(feature);
  if (graph.frontages.some((frontage) => frontage.segment === segmentId)) found.add('parking');
  if (graph.checkpoints.some((site) => site.segment === segmentId)) found.add('checkpoint');
  const degree = new Map<string, number>();
  for (const item of graph.segments.values()) {
    degree.set(item.from, (degree.get(item.from) ?? 0) + 1);
    degree.set(item.to, (degree.get(item.to) ?? 0) + 1);
  }
  if ((degree.get(segment.from) ?? 0) === 1 || (degree.get(segment.to) ?? 0) === 1) found.add('dead-end');
  return [...found].sort((a, b) => a.localeCompare(b));
}

export function maneuversAt(
  graph: StreetGraph,
  segmentId: string,
  maneuvers: readonly ManeuverOffer[],
  year: number,
): readonly ManeuverOffer[] {
  const features = new Set(featuresAt(graph, segmentId));
  return maneuvers.filter((maneuver) => {
    if (year < maneuver.era.from || year > maneuver.era.to) return false;
    return maneuver.requires.every((feature) => features.has(feature));
  });
}

export function junctionOf(graph: StreetGraph, position: StreetPosition): string | undefined {
  const segment = graph.segments.get(position.segment);
  if (segment === undefined || position.progress < 1) return undefined;
  return position.dir === 'fwd' ? segment.to : segment.from;
}

export function containsInOrder(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return false;
  let index = 0;
  for (const id of haystack) {
    if (id === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

/** The route whose junctions were just completed, if this step is the one that finished it. */
export function routeJustCompleted(
  graph: StreetGraph,
  before: readonly StreetPosition[],
  after: readonly StreetPosition[],
  routes: readonly SurveillanceRoute[],
): SurveillanceRoute | undefined {
  const previous = before.flatMap((position) => {
    const junction = junctionOf(graph, position);
    return junction === undefined ? [] : [junction];
  });
  const current = after.flatMap((position) => {
    const junction = junctionOf(graph, position);
    return junction === undefined ? [] : [junction];
  });
  return routes.find((route) => containsInOrder(current, route.junctions) && !containsInOrder(previous, route.junctions));
}

/** What the player noted on the route. No verdict about a tail. */
export function summariseObservations(lines: readonly string[]): string {
  if (lines.length === 0) return 'You noted no vehicles on the route.';
  return `On the route you noted: ${lines.join(' ')}`;
}
