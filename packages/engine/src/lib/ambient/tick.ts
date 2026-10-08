/**
 * Ambient day and phase steps. Both return the same world when the scenario
 * left ambient off. Event and incident draws use the ambient streams, not the
 * runtime PRNG.
 */

import type { DeadDropId, NpcId, Phase } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';

import { calendarDate, holidayIds } from './calendar.js';
import { ambientCatalogue } from './catalogue.js';
import { freshDayCounters, stepCityEvents, stepLocalIncidents } from './city-step.js';
import { settleDuties, stepCover } from './cover.js';
import { stepGossip } from './gossip.js';
import { stepLife } from './life.js';
import { stepMemory } from './memory.js';
import { recordAmbientTiming } from './metrics-log.js';
import { decayMetrics } from './metrics.js';
import { stepNews } from './news.js';
import { refreshPromptCache } from './prompt.js';
import { requestPromotion, stepPopulace } from './populace.js';
import { stepThreads } from './threads.js';
import { threadCatalogue } from './thread-catalogue.js';
import { stepTies } from './ties.js';
import { ambientTurnNotices } from './turn.js';
import type { NoticeAction } from './memory.js';

export interface AmbientTickResult {
  readonly state: WorldState;
  readonly events: readonly SimEvent[];
  /** Milliseconds spent in each step. Not stored on the world, so replay stays deterministic. */
  readonly timings: Readonly<Record<string, number>>;
}

function timed(name: string, timings: Record<string, number>, run: () => void): void {
  const started = performance.now();
  run();
  timings[name] = performance.now() - started;
}

/** Clear the daily counters and decay metrics toward the pack baselines. */
export function resetAmbientDay(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  return {
    ...world,
    ambient: {
      ...ambient,
      metrics: decayMetrics(ambient.metrics, ambientCatalogue().metrics),
      coverDeltaToday: { pos: 0, neg: 0 },
      gate: { ...ambient.gate, slowRunsToday: 0 },
      counters: freshDayCounters(ambient),
      incidentLog: [],
      ...(ambient.multiCity === true ? { pendingCouplings: [] } : {}),
    },
  };
}

/** Day boundary, before the hostile daily tick and the newspaper. */
export function ambientDayBoundary(world: WorldState): AmbientTickResult {
  const timings: Record<string, number> = {};
  if (world.ambient === undefined) {
    return { state: world, events: [], timings };
  }
  let state = world;
  timed('decay', timings, () => {
    state = resetAmbientDay(state);
  });
  timed('events', timings, () => {
    state = stepCityEvents(state);
  });
  timed('cover', timings, () => {
    state = stepCover(state);
  });
  timed('life', timings, () => {
    state = stepLife(state);
  });
  timed('threads', timings, () => {
    state = stepThreads(state, threadCatalogue(state));
  });
  timed('gossip', timings, () => {
    state = stepGossip(state);
  });
  timed('memory', timings, () => {
    state = stepMemory(state);
  });
  timed('news', timings, () => {
    state = stepNews(state);
  });
  timed('prompt', timings, () => {
    state = refreshPromptCache(state);
  });
  let notices: ReturnType<typeof takePlayerNotices> = { state, events: [] };
  timed('notices', timings, () => {
    notices = takePlayerNotices(state);
  });
  recordAmbientTiming(notices.state, 'day', timings);
  return { state: notices.state, events: notices.events, timings };
}

/** Phase boundary: agendas, townsfolk, local incidents, tie affinity. */
export function ambientPhase(world: WorldState): { state: WorldState; events: readonly SimEvent[] } {
  if (world.ambient === undefined) {
    return { state: world, events: [] };
  }
  const timings: Record<string, number> = {};
  let state = world;
  timed('populace', timings, () => {
    state = stepPopulace(state);
  });
  timed('ties', timings, () => {
    state = stepTies(state);
  });
  timed('duties', timings, () => {
    state = settleDuties(state);
  });
  let incidents: ReturnType<typeof stepLocalIncidents> = { state, events: [] };
  timed('incidents', timings, () => {
    incidents = stepLocalIncidents(state);
  });
  let notices: ReturnType<typeof takePlayerNotices> = { state: incidents.state, events: [] };
  timed('notices', timings, () => {
    notices = takePlayerNotices(incidents.state);
  });
  recordAmbientTiming(notices.state, 'phase', timings);
  return { state: notices.state, events: [...incidents.events, ...notices.events] };
}

function asPhase(phase: number): Phase {
  if (phase === 1 || phase === 2 || phase === 3) {
    return phase;
  }
  return 0;
}

function eventName(value: unknown): { readonly name?: string; readonly start?: number } {
  if (value === null || typeof value !== 'object') {
    return {};
  }
  const record = value as { readonly name?: unknown; readonly start?: unknown; readonly public?: unknown };
  if (record.public === false || typeof record.name !== 'string') {
    return {};
  }
  return {
    name: record.name,
    ...(typeof record.start === 'number' ? { start: record.start } : {}),
  };
}

/** Turn queued duty alerts, employer notes and new public events into player events. */
export function takePlayerNotices(world: WorldState): { state: WorldState; events: SimEvent[] } {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return { state: world, events: [] };
  }
  const events: SimEvent[] = [];
  for (const alert of ambient.dutyAlerts ?? []) {
    const kind = alert.kind === 'due' ? 'cover-duty-due' : 'cover-duty-missed';
    events.push({
      id: `${kind}:${alert.duty}:${alert.day}:${alert.phase}`,
      at: { day: alert.day, phase: asPhase(alert.phase) },
      visibility: 'player',
      kind,
      duty: alert.duty,
    });
  }
  for (const message of ambient.coverMessages ?? []) {
    events.push({
      id: `cover-employer-message:${message.day}:${message.phase}:${events.length}`,
      at: { day: message.day, phase: asPhase(message.phase) },
      visibility: 'player',
      kind: 'cover-employer-message',
      text: message.text,
    });
  }
  for (const drop of ambient.disturbedDrops ?? []) {
    events.push({
      id: `drop-disturbed:${drop.drop}:${drop.day}:${drop.phase}`,
      at: { day: drop.day, phase: asPhase(drop.phase) },
      visibility: 'player',
      kind: 'drop-disturbed',
      drop: drop.drop as DeadDropId,
    });
  }
  const announced = new Set(ambient.announced ?? []);
  for (const id of Object.keys(ambient.events).sort()) {
    const record = eventName(ambient.events[id as keyof typeof ambient.events]);
    if (record.name === undefined || record.start !== world.time.day || announced.has(id)) {
      continue;
    }
    announced.add(id);
    events.push({
      id: `public-announcement:${id}:${world.time.day}`,
      at: world.time,
      visibility: 'player',
      kind: 'public-announcement',
      text: record.name,
    });
  }
  const holidayCatalogue = ambientCatalogue().holidays;
  const today = calendarDate(ambient.calendar.startDate, world.time.day);
  for (const id of holidayIds(holidayCatalogue, today)) {
    const key = `holiday:${id}`;
    if (announced.has(key)) {
      continue;
    }
    announced.add(key);
    const name = holidayCatalogue.find((holiday) => holiday.id === id)?.name ?? id;
    events.push({
      id: `public-announcement:${key}:${world.time.day}`,
      at: world.time,
      visibility: 'player',
      kind: 'public-announcement',
      text: name,
    });
  }
  const pending =
    (ambient.dutyAlerts?.length ?? 0) +
    (ambient.coverMessages?.length ?? 0) +
    (ambient.disturbedDrops?.length ?? 0);
  const announcedChanged = announced.size !== (ambient.announced?.length ?? 0);
  if (events.length === 0 && pending === 0 && !announcedChanged) {
    return { state: world, events: [] };
  }
  return {
    state: {
      ...world,
      ambient: {
        ...ambient,
        dutyAlerts: [],
        coverMessages: [],
        disturbedDrops: [],
        announced: [...announced].sort(),
      },
    },
    events,
  };
}

/** Inside the turn draft. Talk and approach promote a townsfolk NPC immediately. */
export function ambientTurn(world: WorldState, action?: NoticeAction): WorldState {
  if (world.ambient === undefined) {
    return world;
  }
  const noticed = ambientTurnNotices(world, action);
  if (action === undefined || (action.kind !== 'talk' && action.kind !== 'approach') || action.npc === undefined) {
    return noticed;
  }
  return requestPromotion(noticed, action.npc as NpcId, true);
}
