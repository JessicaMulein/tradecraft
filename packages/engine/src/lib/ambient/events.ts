/**
 * Event selection (ambient-world Req 5, 6). Exogenous draws read only the
 * exogenous metrics and the calendar. Reactive draws then compete for whatever
 * start and active capacity remains. Cooldown and exclusion remove a template
 * before the draw.
 */

import type { Prng } from '../prng/prng.js';

import type { AmbientBudgets } from './budgets.js';
import type { LocationStatusKind, Overlay } from './locations.js';
import { applyMetricDelta } from './metrics.js';
import type { Metrics, MetricId } from './state.js';
import { metricTotal } from './metrics.js';

export interface SchedulableEvent {
  readonly id: string;
  readonly category: string;
  readonly class: 'exogenous' | 'reactive';
  readonly when?: {
    readonly season?: readonly string[];
    readonly metrics?: Readonly<Record<string, string>>;
    readonly weather?: readonly string[];
  };
  readonly weight: number;
  readonly cooldownDays: number;
  readonly exclusive: readonly string[];
  readonly name: string;
  readonly durationDays: readonly [number, number];
  readonly novelty?: number;
}

export interface ActiveEvent {
  readonly templateId: string;
  readonly exclusive: readonly string[];
  readonly class: 'exogenous' | 'reactive';
}

export interface CityEvent {
  readonly id: string;
  readonly templateId: string;
  readonly class: 'exogenous' | 'reactive';
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly stage: number;
}

export interface EventTrigger {
  readonly key: string;
  readonly templateTags: readonly string[];
  readonly day: number;
}

function metricHolds(expr: string, value: number): boolean {
  const match = /^(>=|<=|>|<|==)(\d+(?:\.\d+)?)$/.exec(expr);
  if (match === null) {
    return false;
  }
  const threshold = Number(match[2]);
  switch (match[1]) {
    case '>=':
      return value >= threshold;
    case '<=':
      return value <= threshold;
    case '>':
      return value > threshold;
    case '<':
      return value < threshold;
    default:
      return value === threshold;
  }
}

function onCooldown(
  template: SchedulableEvent,
  history: Readonly<Record<string, readonly number[]>>,
  day: number,
): boolean {
  const starts = history[template.id] ?? [];
  return starts.some((start) => day - start < template.cooldownDays);
}

function excluded(template: SchedulableEvent, active: readonly ActiveEvent[]): boolean {
  return active.some((event) =>
    template.exclusive.some((tag) => event.exclusive.includes(tag) || event.templateId === tag),
  );
}

function preconditionsHold(
  template: SchedulableEvent,
  season: string,
  weather: ReadonlySet<string>,
  reading: (id: string) => number,
): boolean {
  if (template.when?.season !== undefined && !template.when.season.includes(season)) {
    return false;
  }
  if (template.when?.weather !== undefined) {
    const hit = template.when.weather.some((tag) => weather.has(tag));
    if (!hit) {
      return false;
    }
  }
  const metrics = template.when?.metrics ?? {};
  for (const [id, expr] of Object.entries(metrics)) {
    if (!metricHolds(expr, reading(id))) {
      return false;
    }
  }
  return true;
}

function weightOf(
  template: SchedulableEvent,
  history: Readonly<Record<string, readonly number[]>>,
  eventDensity: number,
): number {
  const seen = (history[template.id] ?? []).length > 0;
  const novelty = seen ? 1 : (template.novelty ?? 2);
  return template.weight * novelty * eventDensity;
}

function weightedPick<T extends { readonly id: string }>(
  rng: Prng,
  items: readonly { readonly item: T; readonly weight: number }[],
): T | undefined {
  const total = items.reduce((sum, entry) => sum + entry.weight, 0);
  if (items.length === 0 || total <= 0) {
    return undefined;
  }
  let roll = rng.next() * total;
  for (const entry of items) {
    roll -= entry.weight;
    if (roll < 0) {
      return entry.item;
    }
  }
  return items[items.length - 1]?.item;
}

function drawClass(
  templates: readonly SchedulableEvent[],
  className: 'exogenous' | 'reactive',
  args: {
    readonly day: number;
    readonly season: string;
    readonly weather: ReadonlySet<string>;
    readonly metrics: Metrics;
    readonly active: readonly ActiveEvent[];
    readonly history: Readonly<Record<string, readonly number[]>>;
    readonly eventDensity: number;
    readonly rng: Prng;
  },
  room: { starts: number; active: number },
  picked: CityEvent[],
): void {
  const reading = (id: string): number => {
    const metric = id as MetricId;
    return className === 'exogenous' ? args.metrics.exo[metric] : metricTotal(args.metrics, metric);
  };
  while (room.starts > 0 && room.active > 0) {
    const pool = templates
      .filter((template) => template.class === className)
      .filter((template) => !picked.some((event) => event.templateId === template.id))
      .filter((template) => !onCooldown(template, args.history, args.day))
      .filter((template) => !excluded(template, args.active))
      .filter((template) => !excluded(template, picked.map((event) => ({
        templateId: event.templateId,
        exclusive: templates.find((item) => item.id === event.templateId)?.exclusive ?? [],
        class: event.class,
      }))))
      .filter((template) => preconditionsHold(template, args.season, args.weather, reading))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const choice = weightedPick(
      args.rng,
      pool.map((item) => ({ item, weight: weightOf(item, args.history, args.eventDensity) })),
    );
    if (choice === undefined) {
      return;
    }
    const span = args.rng.int(choice.durationDays[0], Math.max(choice.durationDays[0], choice.durationDays[1]));
    picked.push({
      id: `evt:${choice.id}-${args.day}`,
      templateId: choice.id,
      class: choice.class,
      name: choice.name,
      start: args.day,
      end: args.day + span,
      stage: 0,
    });
    room.starts -= 1;
    room.active -= 1;
  }
}

export function selectEvents(args: {
  readonly day: number;
  readonly season: string;
  readonly weather: ReadonlySet<string>;
  readonly metrics: Metrics;
  readonly active: readonly ActiveEvent[];
  readonly history: Readonly<Record<string, readonly number[]>>;
  readonly templates: readonly SchedulableEvent[];
  readonly triggers: readonly EventTrigger[];
  readonly budget: AmbientBudgets;
  readonly eventDensity: number;
  readonly rng: Prng;
}): CityEvent[] {
  const picked: CityEvent[] = [];
  const room = {
    starts: args.budget.eventStarts,
    active: Math.max(0, args.budget.activeEvents - args.active.length),
  };
  drawClass(args.templates, 'exogenous', args, room, picked);
  const yesterday = args.triggers.filter((trigger) => trigger.day === args.day - 1);
  const reactive = args.templates.filter((template) =>
    yesterday.some(
      (trigger) =>
        trigger.templateTags.includes(template.id) || trigger.templateTags.includes(template.category),
    ),
  );
  drawClass(reactive, 'reactive', args, room, picked);
  return picked;
}

export type ResolvedOp =
  | { readonly op: 'metric-delta'; readonly metric: MetricId; readonly delta: number }
  | {
      readonly op: 'location-status';
      readonly target: string;
      readonly status: LocationStatusKind;
      readonly days: number;
    }
  | {
      readonly op: 'crowd-modifier' | 'observation-modifier' | 'detection-modifier';
      readonly target: string;
      readonly factor: number;
    }
  | { readonly op: 'route-closure'; readonly target: string; readonly days: number }
  | {
      readonly op: 'route-checkpoint';
      readonly target: string;
      readonly detection: number;
      readonly coverRisk: number;
      readonly days: number;
    }
  | { readonly op: 'curfew'; readonly target: string; readonly phases: readonly string[]; readonly days: number }
  | { readonly op: 'spawn-thread'; readonly tags: readonly string[] }
  | { readonly op: 'news-development'; readonly story: string; readonly beat: string }
  | { readonly op: 'post-notice'; readonly template: string; readonly target: string }
  | { readonly op: 'detain-npc'; readonly npc: string; readonly days: number }
  | { readonly op: 'npc-schedule-override'; readonly npc: string; readonly target: string }
  | { readonly op: 'ambient-hook'; readonly hook: string };

function isStructural(op: ResolvedOp): boolean {
  if (op.op === 'route-closure' || op.op === 'detain-npc' || op.op === 'npc-schedule-override') {
    return true;
  }
  return op.op === 'location-status' && op.status !== 'open' && op.status !== 'newly-opened';
}

/**
 * Apply one stage's ops. Structural ops are skipped when `admit` rejects them.
 * Hooks, notices, threads and news are recorded as pending rather than run.
 */
export function applyStageOps(args: {
  readonly eventId: string;
  readonly day: number;
  readonly className: 'exogenous' | 'reactive';
  readonly ops: readonly ResolvedOp[];
  readonly metrics: Metrics;
  readonly overlays: readonly Overlay[];
  readonly admit?: (op: ResolvedOp) => 'accept' | 'reject';
}): { readonly metrics: Metrics; readonly overlays: Overlay[]; readonly pending: readonly string[] } {
  let metrics = args.metrics;
  const overlays = [...args.overlays];
  const pending: string[] = [];
  const admit = args.admit ?? (() => 'accept' as const);
  for (const op of args.ops) {
    if (isStructural(op) && admit(op) === 'reject') {
      pending.push(`rejected:${op.op}`);
      continue;
    }
    switch (op.op) {
      case 'metric-delta':
        metrics = applyMetricDelta(metrics, op.metric, op.delta, args.className === 'exogenous' ? 'exo' : 'react');
        break;
      case 'location-status':
        overlays.push({
          id: `${args.eventId}:${overlays.length}`,
          source: args.eventId,
          target: op.target,
          fromDay: args.day,
          toDay: args.day + op.days,
          effect: { kind: 'location-status', status: op.status },
        });
        break;
      case 'crowd-modifier':
      case 'observation-modifier':
      case 'detection-modifier':
        overlays.push({
          id: `${args.eventId}:${overlays.length}`,
          source: args.eventId,
          target: op.target,
          fromDay: args.day,
          toDay: args.day + 1,
          effect: { kind: op.op, factor: op.factor },
        });
        break;
      case 'route-closure':
        overlays.push({
          id: `${args.eventId}:${overlays.length}`,
          source: args.eventId,
          target: op.target,
          fromDay: args.day,
          toDay: args.day + op.days,
          effect: { kind: 'route-closure' },
        });
        break;
      case 'route-checkpoint':
        overlays.push({
          id: `${args.eventId}:${overlays.length}`,
          source: args.eventId,
          target: op.target,
          fromDay: args.day,
          toDay: args.day + op.days,
          effect: { kind: 'route-checkpoint', detection: op.detection, coverRisk: op.coverRisk },
        });
        break;
      case 'curfew':
        overlays.push({
          id: `${args.eventId}:${overlays.length}`,
          source: args.eventId,
          target: op.target,
          fromDay: args.day,
          toDay: args.day + op.days,
          effect: { kind: 'curfew', phases: op.phases },
        });
        break;
      default:
        pending.push(op.op);
        break;
    }
  }
  return { metrics, overlays, pending };
}

/** Opposition raises unrest; a government result lowers it. The draw is the caller's seeded rng. */
export function electionDelta(rng: Prng): { readonly winner: 'government' | 'opposition'; readonly unrest: number } {
  const winner = rng.bool() ? 'opposition' : 'government';
  return { winner, unrest: winner === 'opposition' ? 0.05 : -0.05 };
}
