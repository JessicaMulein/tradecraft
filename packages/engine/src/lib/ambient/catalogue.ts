/**
 * City events, incidents, notices, life events, cover duties, regard rules,
 * outlets, civic orgs, stories, holidays and recollections the day tick and
 * day-0 init actually run.
 *
 * The ambient pack authors these as YAML. They are not stored on the content
 * set (caller-registered kinds are checked, not retained), so the tick reads
 * the pack files directly. A missing pack leaves the catalogues empty and the
 * tick selects nothing.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import {
  AMBIENT_HOOK_KINDS,
  CivicOrgTemplateSchema,
  CoverDutyTemplateSchema,
  LifeEventTemplateSchema,
  LOCATION_STATUS_KINDS,
  METRIC_IDS,
  HolidaySchema,
  OutletSchema,
  RecollectionTemplateSchema,
  RegardRuleSchema,
  StoryTemplateSchema,
} from './content.js';
import type { SchedulableEvent } from './events.js';
import type { IncidentTemplate } from './incidents.js';
import type { LocationStatusKind } from './locations.js';
import type { MetricDef } from './metrics.js';
import type { AmbientOutlet, CivicOrgKind, MetricId } from './state.js';

export interface CatalogueLifeEvent {
  readonly id: string;
  readonly weight: number;
  readonly excludeFor?: readonly ('principal')[];
  readonly effects: {
    readonly needs?: Partial<{ readonly money: number; readonly social: number; readonly work: number }>;
    readonly mood?: number;
    readonly work?: 'employed' | 'unemployed' | 'sick' | 'on-leave';
    readonly mice?: Partial<{ readonly money: number; readonly ideology: number; readonly coercion: number; readonly ego: number }>;
    readonly moneyNeed?: number;
    readonly deviateDays?: number;
    readonly remove?: boolean;
    readonly detain?: boolean;
    readonly death?: boolean;
  };
}

export interface CatalogueDuty {
  readonly id: string;
  readonly name: string;
  readonly phases: 1 | 2;
  readonly standing: number;
  readonly suspicion: number;
  readonly mandatory: boolean;
  readonly identities: readonly string[];
}

export interface CatalogueRegard {
  readonly warmth: number;
  readonly wariness: number;
  readonly familiarity: number;
}

export interface NpcPick {
  readonly npc?: string;
  readonly roleTitle?: string;
}

export type AuthorOp =
  | { readonly op: 'metric-delta'; readonly metric: MetricId; readonly delta: number }
  | {
      readonly op: 'crowd-modifier' | 'observation-modifier' | 'detection-modifier';
      readonly query: readonly string[];
      readonly factor: number;
    }
  | { readonly op: 'curfew'; readonly phases: readonly string[] }
  | { readonly op: 'post-notice'; readonly template: string; readonly query: readonly string[] }
  | { readonly op: 'news-development'; readonly story: string; readonly beat: string }
  | { readonly op: 'spawn-thread'; readonly tags: readonly string[]; readonly template?: string }
  | {
      readonly op: 'location-status';
      readonly query: readonly string[];
      readonly status: LocationStatusKind;
      readonly days: number;
    }
  | { readonly op: 'route-closure'; readonly query: readonly string[] }
  | {
      readonly op: 'route-checkpoint';
      readonly query: readonly string[];
      readonly detection: number;
      readonly coverRisk: number;
    }
  | {
      readonly op: 'npc-schedule-override';
      readonly who: NpcPick;
      readonly query: readonly string[];
      readonly phases: readonly string[];
    }
  | { readonly op: 'detain-npc'; readonly who: NpcPick; readonly days: number }
  | {
      readonly op: 'ambient-hook';
      readonly hook: (typeof AMBIENT_HOOK_KINDS)[number];
      readonly days?: 1 | 2;
      readonly amount?: number;
    };

export interface NoticeText {
  readonly title: string;
  readonly body: string;
}

export interface StageDef {
  readonly day: number | 'last';
  readonly ops: readonly AuthorOp[];
}

export interface AmbientCatalogue {
  readonly metrics: readonly MetricDef[];
  readonly events: readonly SchedulableEvent[];
  readonly stages: ReadonlyMap<string, readonly StageDef[]>;
  readonly incidents: readonly IncidentTemplate[];
  readonly notices: ReadonlyMap<string, NoticeText>;
  readonly lifeEvents: readonly CatalogueLifeEvent[];
  readonly duties: readonly CatalogueDuty[];
  readonly regard: Readonly<Record<string, CatalogueRegard>>;
  readonly outlets: readonly AmbientOutlet[];
  readonly orgs: readonly { readonly id: string; readonly name: string; readonly kind: CivicOrgKind }[];
  /** Story id → authored beat chain (`stories.yaml`). */
  readonly stories: ReadonlyMap<string, readonly string[]>;
  /** Holidays the day tick can announce (`holidays.yaml`). */
  readonly holidays: readonly { readonly id: string; readonly name: string; readonly month: number; readonly day: number }[];
  /** Recollection lines a quiet NPC can still offer (`recollections.yaml`). */
  readonly recollections: readonly { readonly id: string; readonly text: string }[];
  /** Template-level op used when the gate rejects a structural change. */
  readonly fallbacks: ReadonlyMap<string, AuthorOp>;
}

const METRICS: readonly MetricDef[] = [
  { id: 'unrest', baseline: 0.2, decay: 0.05 },
  { id: 'police', baseline: 0.3, decay: 0.05 },
  { id: 'shortage', baseline: 0.2, decay: 0.05 },
  { id: 'tension', baseline: 0.3, decay: 0.05 },
  { id: 'festivity', baseline: 0.1, decay: 0.05 },
];

let cached: AmbientCatalogue | undefined;

function packFile(name: string): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../content/packs/ambient', name),
    join(here, '../../../../../content/packs/ambient', name),
    join(process.cwd(), 'packages/content/packs/ambient', name),
  ];
  return candidates.find((path) => existsSync(path));
}

function readYaml(name: string): unknown {
  const path = packFile(name);
  if (path === undefined) {
    return [];
  }
  return parse(readFileSync(path, 'utf8'));
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function metricId(value: unknown): MetricId | undefined {
  return METRIC_IDS.find((id) => id === value);
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function authorOp(value: unknown): AuthorOp | undefined {
  const row = record(value);
  if (row === undefined || typeof row['op'] !== 'string') {
    return undefined;
  }
  if (row['op'] === 'metric-delta') {
    const metric = metricId(row['metric']);
    if (metric === undefined || typeof row['delta'] !== 'number') {
      return undefined;
    }
    return { op: 'metric-delta', metric, delta: row['delta'] };
  }
  if (row['op'] === 'crowd-modifier' || row['op'] === 'observation-modifier' || row['op'] === 'detection-modifier') {
    const at = record(row['at']);
    const query = strings(at?.['query']);
    if (query.length === 0 || typeof row['factor'] !== 'number') {
      return undefined;
    }
    return { op: row['op'], query, factor: row['factor'] };
  }
  if (row['op'] === 'curfew') {
    const phases = strings(row['phases']);
    return phases.length === 0 ? undefined : { op: 'curfew', phases };
  }
  if (row['op'] === 'post-notice') {
    const at = record(row['at']);
    const query = strings(at?.['query']);
    if (typeof row['template'] !== 'string' || query.length === 0) {
      return undefined;
    }
    return { op: 'post-notice', template: row['template'], query };
  }
  if (row['op'] === 'news-development' && typeof row['story'] === 'string' && typeof row['beat'] === 'string') {
    return { op: 'news-development', story: row['story'], beat: row['beat'] };
  }
  if (row['op'] === 'spawn-thread') {
    const tags = strings(row['tags']);
    if (tags.length === 0) {
      return undefined;
    }
    return {
      op: 'spawn-thread',
      tags,
      ...(typeof row['template'] === 'string' ? { template: row['template'] } : {}),
    };
  }
  if (row['op'] === 'location-status') {
    const query = queryOf(row['at']);
    const status = LOCATION_STATUS_KINDS.find((kind) => kind === row['status']);
    if (query.length === 0 || status === undefined || typeof row['days'] !== 'number' || row['days'] <= 0) {
      return undefined;
    }
    return { op: 'location-status', query, status, days: row['days'] };
  }
  if (row['op'] === 'route-closure') {
    const query = queryOf(row['route']);
    return query.length === 0 ? undefined : { op: 'route-closure', query };
  }
  if (row['op'] === 'route-checkpoint') {
    const query = queryOf(row['route']);
    if (
      query.length === 0 ||
      typeof row['detection'] !== 'number' ||
      typeof row['coverRisk'] !== 'number'
    ) {
      return undefined;
    }
    return { op: 'route-checkpoint', query, detection: row['detection'], coverRisk: row['coverRisk'] };
  }
  if (row['op'] === 'npc-schedule-override') {
    const who = whoOf(row['who']);
    const query = queryOf(row['at']);
    const phases = strings(row['phases']);
    if (who === undefined || query.length === 0 || phases.length === 0) {
      return undefined;
    }
    return { op: 'npc-schedule-override', who, query, phases };
  }
  if (row['op'] === 'detain-npc') {
    const who = whoOf(row['who']);
    if (who === undefined || typeof row['days'] !== 'number' || row['days'] <= 0) {
      return undefined;
    }
    return { op: 'detain-npc', who, days: row['days'] };
  }
  if (row['op'] === 'ambient-hook') {
    const hook = AMBIENT_HOOK_KINDS.find((kind) => kind === row['hook']);
    if (hook === undefined) {
      return undefined;
    }
    const days = row['days'] === 1 || row['days'] === 2 ? row['days'] : undefined;
    return {
      op: 'ambient-hook',
      hook,
      ...(days === undefined ? {} : { days }),
      ...(typeof row['amount'] === 'number' ? { amount: row['amount'] } : {}),
    };
  }
  return undefined;
}

function queryOf(value: unknown): string[] {
  return strings(record(value)?.['query']);
}

function whoOf(value: unknown): NpcPick | undefined {
  const row = record(value);
  if (row === undefined) {
    return undefined;
  }
  if (typeof row['npc'] === 'string') {
    return { npc: row['npc'] };
  }
  if (typeof row['roleTitle'] === 'string') {
    return { roleTitle: row['roleTitle'] };
  }
  return undefined;
}

function stagesOf(value: unknown): StageDef[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const stages: StageDef[] = [];
  for (const item of value) {
    const row = record(item);
    if (row === undefined) {
      continue;
    }
    const day = row['day'] === 'last' || typeof row['day'] === 'number' ? row['day'] : undefined;
    if (day === undefined) {
      continue;
    }
    const ops = Array.isArray(row['ops']) ? row['ops'].flatMap((op) => {
      const parsed = authorOp(op);
      return parsed === undefined ? [] : [parsed];
    }) : [];
    stages.push({ day, ops });
  }
  return stages;
}

function eventOf(
  value: unknown,
): { readonly event: SchedulableEvent; readonly stages: readonly StageDef[]; readonly fallback?: AuthorOp } | undefined {
  const row = record(value);
  if (row === undefined || typeof row['id'] !== 'string') {
    return undefined;
  }
  if (row['class'] !== 'exogenous' && row['class'] !== 'reactive') {
    return undefined;
  }
  if (typeof row['weight'] !== 'number' || typeof row['cooldownDays'] !== 'number' || typeof row['name'] !== 'string') {
    return undefined;
  }
  const duration = row['durationDays'];
  if (!Array.isArray(duration) || duration.length < 2 || typeof duration[0] !== 'number' || typeof duration[1] !== 'number') {
    return undefined;
  }
  const when = whenOf(row['when']);
  const fallback = authorOp(row['fallback']);
  return {
    ...(fallback === undefined ? {} : { fallback }),
    event: {
      id: row['id'],
      category: typeof row['category'] === 'string' ? row['category'] : row['id'],
      class: row['class'],
      weight: row['weight'],
      cooldownDays: row['cooldownDays'],
      exclusive: strings(row['exclusive']),
      name: row['name'],
      durationDays: [duration[0], duration[1]],
      ...(when === undefined ? {} : { when }),
    },
    stages: stagesOf(row['stages']),
  };
}

function whenOf(value: unknown): SchedulableEvent['when'] | undefined {
  const row = record(value);
  if (row === undefined) {
    return undefined;
  }
  const season = strings(row['season']);
  const weather = strings(row['weather']);
  const metrics = record(row['metrics']);
  const metricEntries: Record<string, string> = {};
  if (metrics !== undefined) {
    for (const [id, expr] of Object.entries(metrics)) {
      if (typeof expr === 'string') {
        metricEntries[id] = expr;
      }
    }
  }
  if (season.length === 0 && weather.length === 0 && Object.keys(metricEntries).length === 0) {
    return undefined;
  }
  return {
    ...(season.length === 0 ? {} : { season }),
    ...(weather.length === 0 ? {} : { weather }),
    ...(Object.keys(metricEntries).length === 0 ? {} : { metrics: metricEntries }),
  };
}

function incidentOf(value: unknown): IncidentTemplate | undefined {
  const row = record(value);
  if (row === undefined || typeof row['id'] !== 'string' || typeof row['factLine'] !== 'string') {
    return undefined;
  }
  const locQuery = Array.isArray(row['locQuery']) ? row['locQuery'].filter((tag) => typeof tag === 'string') : [];
  const phases = Array.isArray(row['phases']) ? row['phases'].filter((phase) => typeof phase === 'string') : [];
  if (locQuery.length === 0 || phases.length === 0) {
    return undefined;
  }
  return { id: row['id'], locQuery, phases, factLine: row['factLine'] };
}

function lifeEventsOf(items: unknown): CatalogueLifeEvent[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const events: CatalogueLifeEvent[] = [];
  for (const item of items) {
    const parsed = LifeEventTemplateSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    events.push({
      id: parsed.data.id,
      weight: parsed.data.weight,
      ...(parsed.data.excludeFor === undefined ? {} : { excludeFor: parsed.data.excludeFor }),
      effects: parsed.data.effects ?? {},
    });
  }
  return events;
}

function dutiesOf(items: unknown): CatalogueDuty[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const duties: CatalogueDuty[] = [];
  for (const item of items) {
    const parsed = CoverDutyTemplateSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    const span = parsed.data.span ?? (parsed.data.phases.length >= 2 ? 2 : 1);
    duties.push({
      id: parsed.data.id,
      name: parsed.data.name,
      phases: span,
      standing: parsed.data.standing,
      suspicion: parsed.data.suspicion ?? 0.02,
      mandatory: parsed.data.mandatory ?? false,
      identities: parsed.data.identities ?? ['*'],
    });
  }
  return duties;
}

function regardOf(items: unknown): Record<string, CatalogueRegard> {
  if (!Array.isArray(items)) {
    return {};
  }
  const rules: Record<string, CatalogueRegard> = {};
  for (const item of items) {
    const parsed = RegardRuleSchema.safeParse(item);
    if (!parsed.success) {
      continue;
    }
    rules[parsed.data.intent] = {
      warmth: parsed.data.warmth,
      wariness: parsed.data.wariness,
      familiarity: parsed.data.familiarity,
    };
  }
  return rules;
}

function outletsOf(items: unknown): AmbientOutlet[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const outlets: AmbientOutlet[] = [];
  for (const item of items) {
    const parsed = OutletSchema.safeParse(item);
    if (parsed.success) {
      outlets.push(parsed.data);
    }
  }
  return outlets;
}

function storiesOf(items: unknown): Map<string, readonly string[]> {
  const stories = new Map<string, readonly string[]>();
  if (!Array.isArray(items)) {
    return stories;
  }
  for (const item of items) {
    const parsed = StoryTemplateSchema.safeParse(item);
    if (parsed.success) {
      stories.set(parsed.data.id, parsed.data.beats);
    }
  }
  return stories;
}

function holidaysOf(
  items: unknown,
): { id: string; name: string; month: number; day: number }[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const holidays: { id: string; name: string; month: number; day: number }[] = [];
  for (const item of items) {
    const parsed = HolidaySchema.safeParse(item);
    if (parsed.success) {
      holidays.push(parsed.data);
    }
  }
  return holidays;
}

function recollectionsOf(items: unknown): { id: string; text: string }[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const lines: { id: string; text: string }[] = [];
  for (const item of items) {
    const parsed = RecollectionTemplateSchema.safeParse(item);
    if (parsed.success) {
      lines.push(parsed.data);
    }
  }
  return lines;
}

function orgsOf(items: unknown): { id: string; name: string; kind: CivicOrgKind }[] {
  if (!Array.isArray(items)) {
    return [];
  }
  const orgs: { id: string; name: string; kind: CivicOrgKind }[] = [];
  for (const item of items) {
    const parsed = CivicOrgTemplateSchema.safeParse(item);
    if (!parsed.success || parsed.data.kind === 'press' || parsed.data.kind === 'cover-employer') {
      continue;
    }
    orgs.push(parsed.data);
  }
  return orgs;
}

export function ambientCatalogue(): AmbientCatalogue {
  if (cached !== undefined) {
    return cached;
  }
  const events: SchedulableEvent[] = [];
  const stages = new Map<string, readonly StageDef[]>();
  const fallbacks = new Map<string, AuthorOp>();
  const parsedEvents = readYaml('events/events.yaml');
  if (Array.isArray(parsedEvents)) {
    for (const item of parsedEvents) {
      const parsed = eventOf(item);
      if (parsed === undefined) {
        continue;
      }
      events.push(parsed.event);
      stages.set(parsed.event.id, parsed.stages);
      if (parsed.fallback !== undefined) {
        fallbacks.set(parsed.event.id, parsed.fallback);
      }
    }
  }
  const incidents: IncidentTemplate[] = [];
  const parsedIncidents = readYaml('incidents/incidents.yaml');
  if (Array.isArray(parsedIncidents)) {
    for (const item of parsedIncidents) {
      const parsed = incidentOf(item);
      if (parsed !== undefined) {
        incidents.push(parsed);
      }
    }
  }
  const notices = new Map<string, NoticeText>();
  const parsedNotices = readYaml('notices/notices.yaml');
  if (Array.isArray(parsedNotices)) {
    for (const item of parsedNotices) {
      const row = record(item);
      if (
        row !== undefined &&
        typeof row['id'] === 'string' &&
        typeof row['title'] === 'string' &&
        typeof row['body'] === 'string'
      ) {
        notices.set(row['id'], { title: row['title'], body: row['body'] });
      }
    }
  }
  cached = {
    metrics: METRICS,
    events,
    stages,
    incidents,
    notices,
    lifeEvents: lifeEventsOf(readYaml('life-events/life-events.yaml')),
    duties: dutiesOf(readYaml('cover-duties/cover-duties.yaml')),
    regard: regardOf(readYaml('regard-rules/regard-rules.yaml')),
    outlets: outletsOf(readYaml('outlets/outlets.yaml')),
    orgs: orgsOf(readYaml('civic-orgs/civic-orgs.yaml')),
    stories: storiesOf(readYaml('stories/stories.yaml')),
    holidays: holidaysOf(readYaml('holidays/holidays.yaml')),
    recollections: recollectionsOf(readYaml('recollections/recollections.yaml')),
    fallbacks,
  };
  return cached;
}
