/**
 * Side Thread instantiation (plot-library Req 15). On failure the caller's
 * state is returned unchanged.
 */

import { isStageV2, type PlotTemplateV2, type StageV2 } from '@tradecraft/content';
import type { Prng } from '../prng/prng.js';
import { bind, bindable, type BindCity } from './bind.js';
import { checkConsistency, type ScheduleEntry } from './consistency.js';
import { expand } from './expand.js';
import { libraryPreset, type PresetSource } from './preset.js';

export interface SideThreadSpawn {
  readonly template: string;
  readonly mode: 'worldgen' | 'midgame';
  readonly bindHints?: Readonly<Record<string, string>>;
  readonly cellMembers?: ReadonlySet<string>;
}

export interface SideThreadState {
  readonly threads: readonly {
    readonly id: string;
    readonly templateId: string;
    readonly mimics?: string;
    /** Role-slot NPCs. Omitted when the template names no role. */
    readonly participants?: readonly string[];
    /** Bound location the thread's trace occupies. */
    readonly place?: string;
    /** Phase index of that trace, in the same units as plot bookings. */
    readonly at?: number;
    /** Traces the thread emits. A lookalike borrows these from the archetype it mimics. */
    readonly traces?: readonly {
      readonly kind: string;
      readonly text: string;
      readonly roles: readonly string[];
    }[];
  }[];
}

export type SideThreadResult =
  | { readonly ok: true; readonly next: SideThreadState; readonly thread: string }
  | { readonly ok: false; readonly reason: 'ineligible' | 'unbindable' | 'inconsistent' | 'unsolvable'; readonly next: SideThreadState };

export function instantiateSideThread(
  state: SideThreadState,
  spawn: SideThreadSpawn,
  templates: ReadonlyMap<string, PlotTemplateV2>,
  city: BindCity,
  preset: PresetSource,
  rng: Prng,
): SideThreadResult {
  const template =
    templates.get(spawn.template) ??
    [...templates.values()].find((item) => item.id === spawn.template);
  if (template === undefined || template.kind !== 'side-thread') {
    return { ok: false, reason: 'ineligible', next: state };
  }
  const modes = template.spawn ?? ['worldgen'];
  if (!modes.includes(spawn.mode)) {
    return { ok: false, reason: 'ineligible', next: state };
  }
  if (!bindable(template, city).ok) {
    return { ok: false, reason: 'unbindable', next: state };
  }
  const bound = bind(template, city, rng);
  if (!bound.ok) {
    return { ok: false, reason: 'unbindable', next: state };
  }
  const cell = spawn.cellMembers ?? new Set<string>();
  for (const id of Object.values(bound.bindings)) {
    if (cell.has(id)) {
      return { ok: false, reason: 'unbindable', next: state };
    }
  }
  for (const hint of Object.values(spawn.bindHints ?? {})) {
    if (cell.has(hint)) {
      return { ok: false, reason: 'unbindable', next: state };
    }
  }
  const participants: string[] = [];
  for (const [, slot] of Object.entries(template.roleSlots)) {
    const pool = city.binders('npc', slot.query).filter((id) => !cell.has(id) && !participants.includes(id));
    const chosen = pool[0];
    if (chosen === undefined) {
      if (slot.mandatory) {
        return { ok: false, reason: 'unbindable', next: state };
      }
      continue;
    }
    participants.push(chosen);
  }
  const place = Object.values(bound.bindings).find((id) => id.startsWith('loc:'));
  const deadline = template.stages.find(isStageV2)?.deadline?.max ?? 4;
  const expanded = expand(template, libraryPreset(preset), templates, rng);
  const onMap = expanded.stages.filter((stage) => !expanded.offMap.includes(stage.id));
  if (onMap.some((stage) => stage.source.traces.length === 0)) {
    return { ok: false, reason: 'unsolvable', next: state };
  }
  const traces = onMap.flatMap((stage) =>
    stage.source.traces.map((trace) => ({
      kind: trace.kind,
      text: trace.text,
      roles: trace.roles,
    })),
  );
  const thread = `thread:${state.threads.length}`;
  const added = {
    id: thread,
    templateId: template.id,
    ...(template.mimics === undefined ? {} : { mimics: template.mimics }),
    ...(participants.length === 0 ? {} : { participants }),
    ...(place === undefined ? {} : { place, at: deadline * 4 }),
    ...(traces.length === 0 ? {} : { traces }),
  };
  const conflicts = checkConsistency([], new Set(), threadSchedule([...state.threads, added]));
  if (conflicts.length > 0) {
    return { ok: false, reason: 'inconsistent', next: state };
  }
  return {
    ok: true,
    thread,
    next: { threads: [...state.threads, added] },
  };
}

function threadSchedule(threads: SideThreadState['threads']): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (const thread of threads) {
    if (thread.place === undefined || thread.at === undefined) {
      continue;
    }
    for (const npc of thread.participants ?? []) {
      entries.push({
        npc,
        at: thread.at,
        place: thread.place,
        source: thread.id,
        precedence: 100,
      });
    }
  }
  return entries;
}

/** How many lookalike threads a noise pass should place first. */
export function lookalikeCount(share: number, sideThreadCount: number, available: number): number {
  return Math.min(available, Math.round(share * sideThreadCount));
}

/**
 * The first traced stage of a plot whose archetype the lookalike mimics.
 * That stage is the archetype's trace pool.
 */
export function archetypeTracePool(plots: readonly PlotTemplateV2[], archetype: string): StageV2['traces'] {
  for (const plot of plots) {
    if (plot.kind !== 'plot' || plot.archetype !== archetype) {
      continue;
    }
    for (const entry of plot.stages) {
      if (isStageV2(entry) && entry.traces.length > 0) {
        return entry.traces;
      }
    }
  }
  return [];
}

/** Point borrowed traces at the side thread's own roles, never a Cell role. */
export function borrowArchetypeTraces(thread: PlotTemplateV2, pool: StageV2['traces']): PlotTemplateV2 {
  if (pool.length === 0) {
    return thread;
  }
  const slots = Object.keys(thread.roleSlots);
  const borrowed = pool.map((trace) => ({
    ...trace,
    evidences: trace.evidences ?? [],
    roles: slots.length === 0 ? [] : trace.roles.map((role) => (slots.includes(role) ? role : slots[0] ?? role)),
  }));
  let replaced = false;
  return {
    ...thread,
    stages: thread.stages.map((entry) => {
      if (replaced || !isStageV2(entry)) {
        return entry;
      }
      replaced = true;
      return { ...entry, traces: borrowed };
    }),
  };
}

export interface LookalikeFill {
  readonly threads: readonly PlotTemplateV2[];
  readonly plots: readonly PlotTemplateV2[];
  readonly city: BindCity;
  readonly preset: PresetSource;
  readonly share: number;
  readonly sideThreadCount: number;
  readonly cellMembers?: ReadonlySet<string>;
}

/**
 * Place the lookalike share on the noise stream. Each template borrows the
 * trace pool of the archetype it mimics, then goes through {@link instantiateSideThread}.
 */
export function fillLookalikeShare(input: LookalikeFill, rng: Prng): SideThreadState['threads'] {
  const lookalikes = input.threads.filter(
    (template) =>
      template.kind === 'side-thread' &&
      template.mimics !== undefined &&
      (template.spawn ?? ['worldgen']).includes('worldgen'),
  );
  const count = lookalikeCount(input.share, input.sideThreadCount, lookalikes.length);
  const map = new Map<string, PlotTemplateV2>();
  for (const template of lookalikes) {
    const mimics = template.mimics;
    const pool = mimics === undefined ? [] : archetypeTracePool(input.plots, mimics);
    map.set(template.id, borrowArchetypeTraces(template, pool));
  }
  let state: SideThreadState = { threads: [] };
  for (const template of lookalikes.slice(0, count)) {
    const result = instantiateSideThread(
      state,
      { template: template.id, mode: 'worldgen', cellMembers: input.cellMembers },
      map,
      input.city,
      input.preset,
      rng,
    );
    if (result.ok) {
      state = result.next;
    }
  }
  return state.threads;
}
