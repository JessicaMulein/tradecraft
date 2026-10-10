/**
 * The day and phase steps that actually run city events and local incidents.
 * Selection, stage effects and the incident draw run from the clock.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCityData, type CityData } from '@tradecraft/content';

import { weatherForDay, weatherTagsFor, type City } from '../city/city.js';
import { contentPhasesOf } from '../city/time-mapping.js';
import type { LocId } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';

import { ambientBudgets } from './budgets.js';
import { calendarDate, seasonForMonth } from './calendar.js';
import { ambientCatalogue } from './catalogue.js';
import { commitStage } from './effects.js';
import { selectEvents, type EventTrigger } from './events.js';
import { selectIncidents, type IncidentSite } from './incidents.js';
import { removeOverlaysFrom } from './locations.js';
import { ambientPreset } from './preset.js';
import type { AmbientState } from './state.js';
import { ambientKeySeed } from './streams.js';

interface StoredEvent {
  readonly templateId?: string;
  readonly class?: 'exogenous' | 'reactive';
  readonly name?: string;
  readonly start?: number;
  readonly end?: number;
  readonly stage?: number;
  readonly public?: boolean;
  readonly exclusive?: readonly string[];
  readonly applied?: readonly number[];
  readonly rejected?: readonly string[];
}

function storedEvent(value: unknown): StoredEvent {
  if (value === null || typeof value !== 'object') {
    return {};
  }
  return value as StoredEvent;
}

function withEvent(events: AmbientState['events'], id: string, value: StoredEvent): AmbientState['events'] {
  return { ...events, [id]: value } as AmbientState['events'];
}

/** Select today's events, run the stage ops that are due, and drop ended overlays. */
export function stepCityEvents(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  const catalogue = ambientCatalogue();
  const day = world.time.day;
  const date = calendarDate(ambient.calendar.startDate, day);
  const preset = world.meta?.preset;
  const knobs = ambientPreset(preset?.id ?? 'standard', preset?.ambient);
  const active = Object.values(ambient.events).flatMap((value) => {
    const event = storedEvent(value);
    if (
      event.templateId === undefined ||
      event.start === undefined ||
      event.end === undefined ||
      event.start > day ||
      day >= event.end
    ) {
      return [];
    }
    return [
      {
        templateId: event.templateId,
        exclusive: event.exclusive ?? [],
        class: event.class ?? 'exogenous',
      },
    ];
  });
  const picked = selectEvents({
    day,
    season: seasonForMonth(Number(date.slice(5, 7))),
    weather: weatherTagsOf(world),
    metrics: ambient.metrics,
    active,
    history: ambient.history,
    templates: catalogue.events,
    triggers: triggersOf(ambient.triggers),
    budget: ambientBudgets(ambient.density),
    eventDensity: knobs.eventDensity,
    rng: createPrng(ambientKeySeed(world.meta.seed, 'exo', 'select', day)),
  });
  let events = ambient.events;
  let history = ambient.history;
  let triggers = [...ambient.triggers];
  for (const event of picked) {
    const template = catalogue.events.find((item) => item.id === event.templateId);
    events = withEvent(events, event.id, {
      templateId: event.templateId,
      class: event.class,
      name: event.name,
      start: event.start,
      end: event.end,
      stage: 0,
      public: true,
      exclusive: template?.exclusive ?? [],
      applied: [],
    });
    const prior = history[event.templateId] ?? [];
    history = { ...history, [event.templateId]: [...prior, day] };
    if (event.class === 'exogenous' && template !== undefined) {
      triggers = [...triggers, { key: event.id, templateTags: [template.category], day }];
    }
  }
  let current = world;
  let overlays = [...ambient.overlays];
  let inbox = [...(ambient.inbox ?? [])];
  for (const id of Object.keys(events).sort()) {
    const event = storedEvent(events[id as keyof typeof events]);
    if (event.templateId === undefined || event.start === undefined || event.end === undefined) {
      continue;
    }
    if (day >= event.end) {
      overlays = removeOverlaysFrom(overlays, id);
      current = syncAmbient(current, current.ambient?.metrics ?? ambient.metrics, overlays);
      continue;
    }
    const template = catalogue.events.find((item) => item.id === event.templateId);
    const stages = catalogue.stages.get(event.templateId) ?? [];
    const applied = new Set(event.applied ?? []);
    const rejected = [...(event.rejected ?? [])];
    let stage = event.stage ?? 0;
    let changed = false;
    for (let index = 0; index < stages.length; index += 1) {
      const stageDef = stages[index];
      if (stageDef === undefined || applied.has(index) || !stageDue(stageDef.day, event.start, event.end, day)) {
        continue;
      }
      const committed = commitStage({
        world: current,
        eventId: id,
        className: event.class ?? 'exogenous',
        category: template?.category ?? '',
        stageDay: stageDef.day,
        templateId: event.templateId,
        ops: stageDef.ops,
        metrics: current.ambient?.metrics ?? ambient.metrics,
        overlays,
      });
      current = committed.world;
      overlays = [...(current.ambient?.overlays ?? overlays)];
      inbox = [...inbox, ...committed.inbox];
      rejected.push(...committed.pending);
      applied.add(index);
      stage += 1;
      changed = true;
    }
    if (changed || day >= (event.end ?? day)) {
      events = withEvent(events, id, {
        ...event,
        stage,
        applied: [...applied].sort((a, b) => a - b),
        ...(rejected.length === 0 ? {} : { rejected }),
      });
    }
  }
  const ambientNow = current.ambient ?? ambient;
  return {
    ...current,
    ambient: {
      ...ambientNow,
      events,
      history,
      triggers,
      overlays,
      ...(inbox.length === 0 ? {} : { inbox }),
      counters: { ...ambientNow.counters, starts: picked.length },
    },
  };
}

function syncAmbient(world: WorldState, metrics: AmbientState['metrics'], overlays: AmbientState['overlays']): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  return { ...world, ambient: { ...ambient, metrics, overlays } };
}

function stageDue(day: number | 'last' | undefined, start: number, end: number, today: number): boolean {
  if (day === 'last') {
    return today === Math.max(start, end - 1);
  }
  return day === today - start;
}

function triggersOf(values: readonly unknown[]): EventTrigger[] {
  return values.flatMap((value) => {
    if (value === null || typeof value !== 'object') {
      return [];
    }
    const row = value as { readonly key?: unknown; readonly templateTags?: unknown; readonly day?: unknown };
    if (typeof row.key !== 'string' || typeof row.day !== 'number' || !Array.isArray(row.templateTags)) {
      return [];
    }
    return [
      {
        key: row.key,
        day: row.day,
        templateTags: row.templateTags.filter((tag) => typeof tag === 'string'),
      },
    ];
  });
}

function tagsOf(world: WorldState, id: string, type: string): readonly string[] {
  const stored = world.ambient?.siteTags?.[id];
  if (stored !== undefined) {
    return stored;
  }
  const bare = type.includes('/') ? type.slice(type.lastIndexOf('/') + 1) : type;
  return [`function:${bare}`, bare];
}

let cityData: CityData | undefined | null;

function corePackDir(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../content/packs/core'),
    join(here, '../../../../../content/packs/core'),
    join(process.cwd(), 'packages/content/packs/core'),
  ];
  return candidates.find((path) => existsSync(join(path, 'city.yaml')));
}

function cityTables(): CityData | undefined {
  if (cityData !== undefined) {
    return cityData === null ? undefined : cityData;
  }
  const dir = corePackDir();
  if (dir === undefined) {
    cityData = null;
    return undefined;
  }
  const loaded = loadCityData(dir);
  if (!loaded.ok) {
    cityData = null;
    return undefined;
  }
  cityData = loaded.value;
  return loaded.value;
}

/** Tags the day's drawn condition carries. Empty when the city tables cannot be read. */
export function weatherTagsOf(world: WorldState): ReadonlySet<string> {
  const tables = cityTables();
  const city = world.city;
  if (tables === undefined || city === undefined || typeof city.startMonth !== 'number') {
    return new Set();
  }
  try {
    const weather = weatherForDay(
      world.meta.seed,
      city as City,
      tables,
      world.time.day,
      world.meta.setting.startDate,
    );
    return weatherTagsFor(weather.condition, tables);
  } catch {
    return new Set();
  }
}

function sitesOf(world: WorldState): IncidentSite[] {
  const locations = world.city?.locations ?? {};
  return Object.entries(locations).flatMap(([id, location]) => {
    if (location === undefined || typeof location.type !== 'string') {
      return [];
    }
    const loc = typeof location.id === 'string' ? location.id : id;
    return [{ id: loc, tags: tagsOf(world, loc, location.type) }];
  });
}

/** One incident draw per location for this engine phase, inside the density cap. */
export function stepLocalIncidents(world: WorldState): { readonly state: WorldState; readonly events: readonly SimEvent[] } {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return { state: world, events: [] };
  }
  const catalogue = ambientCatalogue();
  if (catalogue.incidents.length === 0) {
    return { state: world, events: [] };
  }
  const budget = ambientBudgets(ambient.density).incidentsPerDay;
  let remaining = budget - ambient.counters.incidents;
  if (remaining <= 0) {
    return { state: world, events: [] };
  }
  const phase = world.time.phase;
  const seen = new Set((ambient.incidentLog ?? []).map((incident) => `${incident.loc}|${incident.phase}`));
  const open = sitesOf(world).filter((site) => !seen.has(`${site.id}|${phase}`));
  if (open.length === 0) {
    return { state: world, events: [] };
  }
  const drawn = [];
  for (const contentPhase of contentPhasesOf(phase)) {
    if (remaining <= 0) {
      break;
    }
    const batch = selectIncidents({
      sites: open.filter((site) => !seen.has(`${site.id}|${phase}`)),
      phase: contentPhase,
      templates: catalogue.incidents,
      cap: remaining,
      rng: createPrng(ambientKeySeed(world.meta.seed, 'local', `${phase}:${contentPhase}`, world.time.day)),
    });
    for (const incident of batch) {
      seen.add(`${incident.loc}|${phase}`);
      drawn.push(incident);
      remaining -= 1;
    }
  }
  if (drawn.length === 0) {
    return { state: world, events: [] };
  }
  const log = [...(ambient.incidentLog ?? [])];
  const events: SimEvent[] = [];
  for (const incident of drawn) {
    log.push({ loc: incident.loc, phase, factLine: incident.factLine });
    events.push({
      id: `incident:${incident.loc}:${world.time.day}:${phase}:${incident.templateId}`,
      at: world.time,
      visibility: 'hidden',
      kind: 'incident',
      loc: incident.loc as LocId,
      factLine: incident.factLine,
    });
  }
  return {
    state: {
      ...world,
      ambient: {
        ...ambient,
        incidentLog: log,
        counters: { ...ambient.counters, incidents: ambient.counters.incidents + drawn.length },
      },
    },
    events,
  };
}

export function freshDayCounters(ambient: AmbientState): AmbientState['counters'] {
  return {
    ...ambient.counters,
    starts: 0,
    incidents: 0,
    lifeEvents: 0,
    promotions: 0,
    gossip: 0,
    threads: 0,
  };
}
