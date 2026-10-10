/**
 * Bind the street-ops runtime from packs the loader already selected.
 *
 * The content loader schema-checks these files and does not keep the items.
 * This reader runs only when the scenario turns the add-on on, so a disabled
 * game never opens a street file.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import type { z } from 'zod';

import type { StoryTemplate } from './bluff.js';
import {
  CheckpointKindSchema,
  ComposureTableSchema,
  EvasionManeuverSchema,
  MapDocumentSchema,
  StreetGraphSchema,
  StreetStorySchema,
  SurveillanceMethodSchema,
  TailProfileSchema,
  VehicleSchema,
  type CheckpointKind,
} from './content.js';
import { runtimeFromScenario, type MapOffer, type StreetOpsRuntime, type VehicleOffer } from './drive.js';
import { compileStreetGraph } from './graph.js';
import type { ManeuverOffer, SurveillanceRoute } from './maneuver.js';
import type { MethodOffer, TailProfileOffer } from './tail.js';

/** Packs the demo graph needs. Present directories are added only when the add-on is on. */
export const STREET_PLAY_PACKS = [
  'era-cold-war-early',
  'lib-central-europe',
  'lib-russian',
  'city-vienna',
  'city-berlin',
  'street-ops-core',
] as const;

export function streetPlayDirs(repoRoot: string, existing: readonly string[]): string[] {
  const dirs = [...existing];
  const root = join(repoRoot, 'packages', 'content', 'packs');
  for (const id of STREET_PLAY_PACKS) {
    const dir = join(root, id);
    if (!existsSync(join(dir, 'pack.yaml'))) continue;
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs;
}

export function withStreetPack(load: readonly string[], dirs: readonly string[]): readonly string[] {
  const present = dirs.some((dir) => dir.endsWith('/street-ops-core') || dir.endsWith('\\street-ops-core'));
  if (!present || load.includes('street-ops-core')) return load;
  return [...load, 'street-ops-core'];
}

function packId(dir: string): string | undefined {
  try {
    const parsed = parse(readFileSync(join(dir, 'pack.yaml'), 'utf8')) as { id?: unknown };
    return typeof parsed.id === 'string' ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

function yamlFiles(dir: string, kindDir: string): string[] {
  const out: string[] = [];
  const nested = join(dir, kindDir);
  const single = [`${kindDir}.yaml`, `${kindDir}.yml`];
  for (const name of single) {
    const path = join(dir, name);
    if (existsSync(path)) out.push(path);
  }
  if (!existsSync(nested) || !statSync(nested).isDirectory()) return out;
  for (const name of readdirSync(nested).sort()) {
    if (name.endsWith('.yaml') || name.endsWith('.yml')) out.push(join(nested, name));
  }
  return out;
}

function itemsIn<T>(files: readonly string[], schema: z.ZodType<T>): T[] {
  const out: T[] = [];
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const record = parsed as { items?: unknown };
    const items = Array.isArray(record?.items) ? record.items : [];
    for (const item of items) {
      const result = schema.safeParse(item);
      if (result.success) out.push(result.data);
    }
  }
  return out;
}

/** Graphs, cars, tails and stories from the selected pack directories. */
export function runtimeFromLoadedPacks(
  dirs: readonly string[],
  packIds: ReadonlySet<string>,
  scenario: {
    readonly streetOps?: {
      readonly ticksPerPhase?: number;
      readonly speedMPerTick?: StreetOpsRuntime['speeds'];
      readonly lostTimeoutPhases?: number;
      readonly sightRangeM?: number;
      readonly checkpointVisibleDefaultM?: number;
      readonly navigationAid?: boolean;
    };
  },
  rates?: { readonly noticeBase?: number; readonly regularRate?: number; readonly navigationAid?: boolean },
): StreetOpsRuntime {
  const graphs = [];
  const vehicles: VehicleOffer[] = [];
  const maneuvers: ManeuverOffer[] = [];
  const tails: TailProfileOffer[] = [];
  const methods: MethodOffer[] = [];
  const checkpoints: CheckpointKind[] = [];
  const stories: StoryTemplate[] = [];
  const composureRows: { tags: readonly string[]; composure: number }[] = [];
  const maps: MapOffer[] = [];
  const routes: SurveillanceRoute[] = [];
  const attributions = new Set<string>();

  for (const dir of dirs) {
    const id = packId(dir);
    if (id === undefined || !packIds.has(id)) continue;
    for (const file of itemsIn(yamlFiles(dir, 'graphs'), StreetGraphSchema)) {
      graphs.push(compileStreetGraph(file));
      for (const source of file.sources) attributions.add(source.attribution);
      for (const route of file.routes ?? []) routes.push(route);
    }
    vehicles.push(...itemsIn(yamlFiles(dir, 'vehicles'), VehicleSchema));
    maneuvers.push(...itemsIn(yamlFiles(dir, 'maneuvers'), EvasionManeuverSchema));
    tails.push(...itemsIn(yamlFiles(dir, 'tails'), TailProfileSchema));
    methods.push(...itemsIn(yamlFiles(dir, 'methods'), SurveillanceMethodSchema));
    checkpoints.push(...itemsIn(yamlFiles(dir, 'checkpoints'), CheckpointKindSchema));
    stories.push(...itemsIn(yamlFiles(dir, 'street-stories'), StreetStorySchema));
    for (const table of itemsIn(yamlFiles(dir, 'composure'), ComposureTableSchema)) {
      composureRows.push(...table.rows);
    }
    for (const doc of itemsIn(yamlFiles(dir, 'maps'), MapDocumentSchema)) {
      maps.push({
        id: doc.id,
        title: doc.title,
        era: doc.era,
        segments: doc.segments,
        aliases: doc.aliases,
        price: doc.price,
        ...(doc.at === undefined ? {} : { at: doc.at }),
      });
    }
  }

  graphs.sort((a, b) => a.id.localeCompare(b.id));
  const lines = [...attributions].filter((line) => line.trim() !== '').sort((a, b) => a.localeCompare(b));
  return runtimeFromScenario(scenario, {
    graphs,
    vehicles,
    maneuvers,
    tails,
    methods,
    checkpoints,
    stories,
    composureRows,
    maps,
    routes,
    attributions: lines,
    ...(rates?.noticeBase === undefined ? {} : { noticeBase: rates.noticeBase }),
    ...(rates?.regularRate === undefined ? {} : { regularRate: rates.regularRate }),
    ...(rates?.navigationAid === undefined ? {} : { navigationAid: rates.navigationAid }),
  });
}
