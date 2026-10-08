/**
 * Side-thread templates for the day tick (ambient-world task 10.3).
 *
 * plot-library stores these on the content set, which the clock does not
 * carry. The tick reads the coldwar-plots pack, keeps templates that can
 * spawn mid-game, and binds their location queries against the city's tags.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PlotTemplateV2Schema, type PlotTemplateV2 } from '@tradecraft/content';
import { parse } from 'yaml';

import type { BindCity } from '../plotgen/bind.js';
import type { WorldState } from '../model/state.js';

import type { ThreadCatalogue } from './threads.js';

let templates: ReadonlyMap<string, PlotTemplateV2> | undefined;
let archetypeTags: ReadonlyMap<string, readonly string[]> | undefined;

function packRoot(segments: readonly string[]): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../content/packs', ...segments),
    join(here, '../../../../../content/packs', ...segments),
    join(process.cwd(), 'packages/content/packs', ...segments),
  ];
  return candidates.find((path) => existsSync(path));
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function loadTemplates(): ReadonlyMap<string, PlotTemplateV2> {
  if (templates !== undefined) {
    return templates;
  }
  const dir = packRoot(['coldwar-plots', 'side-threads']);
  const map = new Map<string, PlotTemplateV2>();
  if (dir === undefined) {
    templates = map;
    return map;
  }
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.yaml')) {
      continue;
    }
    const parsed = parse(readFileSync(join(dir, name), 'utf8'));
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      const result = PlotTemplateV2Schema.safeParse(item);
      if (!result.success || result.data.kind !== 'side-thread') {
        continue;
      }
      const modes = result.data.spawn ?? ['worldgen'];
      if (!modes.includes('midgame') || result.data.ambient?.spawn === undefined) {
        continue;
      }
      map.set(result.data.id, result.data);
    }
  }
  templates = map;
  return map;
}

function loadArchetypeTags(): ReadonlyMap<string, readonly string[]> {
  if (archetypeTags !== undefined) {
    return archetypeTags;
  }
  const path = packRoot(['core', 'archetypes.yaml']);
  const map = new Map<string, readonly string[]>();
  if (path === undefined) {
    archetypeTags = map;
    return map;
  }
  const parsed = parse(readFileSync(path, 'utf8'));
  const items = Array.isArray(parsed) ? parsed : [];
  for (const item of items) {
    const row = record(item);
    if (row === undefined || typeof row['id'] !== 'string' || !Array.isArray(row['tags'])) {
      continue;
    }
    map.set(
      row['id'],
      row['tags'].filter((tag) => typeof tag === 'string'),
    );
  }
  archetypeTags = map;
  return map;
}

function tagsOf(world: WorldState, id: string, type: string): readonly string[] {
  const stored = world.ambient?.siteTags?.[id];
  if (stored !== undefined) {
    return stored;
  }
  const bare = type.includes('/') ? type.slice(type.lastIndexOf('/') + 1) : type;
  return [`function:${bare}`, bare];
}

function locations(world: WorldState, query: readonly string[]): string[] {
  const places = world.city?.locations ?? {};
  return Object.entries(places)
    .flatMap(([id, location]) => {
      if (location === undefined || typeof location.type !== 'string') {
        return [];
      }
      const loc = typeof location.id === 'string' ? location.id : id;
      const tags = tagsOf(world, loc, location.type);
      return query.every((tag) => tags.includes(tag)) ? [loc] : [];
    })
    .sort();
}

function archetypeTagsOf(
  archetypes: ReadonlyMap<string, readonly string[]>,
  id: string | undefined,
): readonly string[] {
  if (id === undefined) {
    return [];
  }
  return archetypes.get(id) ?? archetypes.get(id.slice(id.lastIndexOf('/') + 1)) ?? [];
}

function people(world: WorldState, query: readonly string[], archetypes: ReadonlyMap<string, readonly string[]>): string[] {
  return Object.values(world.npcs ?? {})
    .flatMap((npc) => {
      if (npc === undefined) {
        return [];
      }
      const tags = [`role:${npc.role}`, ...archetypeTagsOf(archetypes, npc.archetype)];
      return query.every((tag) => tags.includes(tag)) ? [npc.id] : [];
    })
    .sort();
}

function bindCity(world: WorldState): BindCity {
  const archetypes = loadArchetypeTags();
  return {
    binders(kind, query) {
      if (kind === 'loc') {
        return locations(world, query);
      }
      if (kind === 'npc') {
        return people(world, query, archetypes);
      }
      return [];
    },
    archetypesWithTags(query) {
      const found: string[] = [];
      for (const [id, tags] of archetypes) {
        if (query.every((tag) => tags.includes(tag))) {
          found.push(id);
        }
      }
      return found.sort();
    },
    tags(id) {
      const places = world.city?.locations ?? {};
      const found = Object.entries(places).find(
        ([key, location]) => key === id || (location !== undefined && location.id === id),
      );
      const location = found?.[1];
      if (location === undefined || typeof location.type !== 'string') {
        return [];
      }
      return tagsOf(world, id, location.type);
    },
  };
}

/** Mid-game side threads and a city binder, or undefined when the pack is absent. */
export function threadCatalogue(world: WorldState): ThreadCatalogue | undefined {
  const loaded = loadTemplates();
  if (loaded.size === 0) {
    return undefined;
  }
  return { templates: loaded, city: bindCity(world) };
}
