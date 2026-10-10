/**
 * Street-ops cross-reference checks (street-ops task 2.1).
 *
 * The slice loader schema-checks caller-registered kinds and does not keep the
 * items. This check reads those items: a tail profile must name a loaded
 * Service, a graph checkpoint must name a checkpoint kind, and a maneuver's
 * required graph features must exist on a loaded graph.
 */

import type { ContentError } from '@tradecraft/content';

import type { GraphFeature } from './content.js';
import { GRAPH_FEATURES } from './content.js';

export interface StreetOpsSource {
  readonly pack: string;
  readonly file: string;
  readonly kind: string;
  readonly items: readonly unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function issue(source: StreetOpsSource, path: string, message: string): ContentError {
  return { pack: source.pack, file: source.file, path, message };
}

function refResolves(ref: string, pack: string, ids: ReadonlySet<string>): boolean {
  if (ids.has(ref)) return true;
  return !ref.includes('/') && ids.has(`${pack}/${ref}`);
}

function featuresOf(graph: Record<string, unknown>): Set<GraphFeature> {
  const found = new Set<GraphFeature>();
  const segments = Array.isArray(graph.segments) ? graph.segments : [];
  const junctions = Array.isArray(graph.junctions) ? graph.junctions : [];
  const degree = new Map<string, number>();
  for (const segment of segments) {
    if (!isRecord(segment)) continue;
    if (segment.oneWay === true) found.add('one-way');
    if (typeof segment.from === 'string') degree.set(segment.from, (degree.get(segment.from) ?? 0) + 1);
    if (typeof segment.to === 'string') degree.set(segment.to, (degree.get(segment.to) ?? 0) + 1);
    if (Array.isArray(segment.features)) {
      for (const feature of segment.features) {
        if ((GRAPH_FEATURES as readonly string[]).includes(String(feature))) {
          found.add(feature as GraphFeature);
        }
      }
    }
  }
  const frontages = Array.isArray(graph.frontages) ? graph.frontages : [];
  if (frontages.length > 0) found.add('parking');
  const checkpoints = Array.isArray(graph.checkpoints) ? graph.checkpoints : [];
  if (checkpoints.length > 0) found.add('checkpoint');
  for (const junction of junctions) {
    if (!isRecord(junction) || typeof junction.id !== 'string') continue;
    if ((degree.get(junction.id) ?? 0) === 1) found.add('dead-end');
  }
  if (found.has('one-way')) found.add('contraflow');
  return found;
}

/** Refuse dangling services, checkpoint kinds and maneuver features. */
export function checkStreetOpsContent(
  sources: readonly StreetOpsSource[],
  services: ReadonlySet<string>,
): ContentError[] {
  const errors: ContentError[] = [];
  const checkpointKinds = new Set<string>();
  const graphFeatures = new Set<GraphFeature>();
  let graphs = 0;

  for (const source of sources) {
    if (source.kind !== 'checkpoint-kind') continue;
    source.items.forEach((item, index) => {
      if (isRecord(item) && typeof item.id === 'string') {
        checkpointKinds.add(item.id);
        checkpointKinds.add(`${source.pack}/${item.id}`);
      } else {
        errors.push(issue(source, `[${index}].id`, 'checkpoint kind needs an id'));
      }
    });
  }

  for (const source of sources) {
    if (source.kind === 'street-graph') {
      graphs += source.items.length;
      for (const item of source.items) {
        if (isRecord(item)) {
          for (const feature of featuresOf(item)) graphFeatures.add(feature);
        }
      }
    }
    source.items.forEach((item, index) => {
      if (!isRecord(item)) return;
      if (source.kind === 'tail-profile' && typeof item.service === 'string') {
        if (!refResolves(item.service, source.pack, services)) {
          errors.push(
            issue(
              source,
              `[${index}].service`,
              `service "${item.service}" does not resolve to any loaded content`,
            ),
          );
        }
      }
      if (source.kind === 'street-graph' && Array.isArray(item.checkpoints)) {
        item.checkpoints.forEach((site, siteIndex) => {
          if (!isRecord(site) || typeof site.kind !== 'string') return;
          if (!refResolves(site.kind, source.pack, checkpointKinds)) {
            errors.push(
              issue(
                source,
                `[${index}].checkpoints[${siteIndex}].kind`,
                `checkpoint kind "${site.kind}" does not resolve to any loaded content`,
              ),
            );
          }
        });
      }
      if (source.kind === 'evasion-maneuver' && graphs > 0 && Array.isArray(item.requires)) {
        item.requires.forEach((feature, featureIndex) => {
          if (typeof feature !== 'string') return;
          if (!graphFeatures.has(feature as GraphFeature)) {
            errors.push(
              issue(
                source,
                `[${index}].requires[${featureIndex}]`,
                `graph feature "${feature}" is not present on a loaded street graph`,
              ),
            );
          }
        });
      }
    });
  }
  return errors;
}
