/**
 * Ambient content kinds (ambient-world Req 22). The schemas live here, in the
 * engine, and are registered through the content loader's `LoadOptions.kinds`.
 * The content package does not import this module.
 */

import {
  ContentIdSchema,
  PhaseSchema,
  TagQuerySchema,
  type ContentKindRegistration,
} from '@tradecraft/content';
import { z } from 'zod';

import { NpcIdSchema } from '../model/core.js';

export const EVENT_CATEGORIES = [
  'labour',
  'festival',
  'election',
  'crackdown',
  'weather',
  'border',
  'economic',
  'cultural',
  'accident',
] as const;

export const METRIC_IDS = ['unrest', 'police', 'shortage', 'tension', 'festivity'] as const;

export const AMBIENT_HOOK_KINDS = [
  'delay-stage',
  'reroute-location',
  'channel-outage',
  'cover-suspicion-delta',
  'informant-report',
  'detection-bonus',
] as const;

export const LOCATION_STATUS_KINDS = [
  'open',
  'closed-temporarily',
  'raided',
  'requisitioned',
  'under-renovation',
  'closed-permanently',
  'newly-opened',
] as const;

const MetricCmpSchema = z.string().regex(/^(?:>=|<=|>|<|==)\d+(?:\.\d+)?$/);

export const LocSelectorSchema = z.object({ query: TagQuerySchema }).strict();
export const RouteSelectorSchema = z.object({ query: TagQuerySchema }).strict();
export const DistrictSelectorSchema = z.object({ query: TagQuerySchema }).strict();

/** A person slot binds a registry NPC or a role-title pool, and nothing else. */
export const NpcSelectorSchema = z.union([
  z.object({ npc: NpcIdSchema }).strict(),
  z.object({ roleTitle: z.string().min(1) }).strict(),
]);

const EffectOpSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({
      op: z.literal('location-status'),
      at: LocSelectorSchema,
      status: z.enum(LOCATION_STATUS_KINDS),
      days: z.number().int().positive(),
    }).strict(),
    z.object({
      op: z.literal('crowd-modifier'),
      at: LocSelectorSchema,
      factor: z.number().positive(),
    }).strict(),
    z.object({
      op: z.literal('observation-modifier'),
      at: LocSelectorSchema,
      factor: z.number().positive(),
    }).strict(),
    z.object({
      op: z.literal('detection-modifier'),
      at: LocSelectorSchema,
      factor: z.number().positive(),
    }).strict(),
    z.object({
      op: z.literal('route-checkpoint'),
      route: RouteSelectorSchema,
      detection: z.number().min(0).max(1),
      coverRisk: z.number().min(0).max(1),
    }).strict(),
    z.object({ op: z.literal('route-closure'), route: RouteSelectorSchema }).strict(),
    z.object({
      op: z.literal('curfew'),
      phases: z.array(PhaseSchema).min(1),
      districts: DistrictSelectorSchema.optional(),
    }).strict(),
    z.object({
      op: z.literal('npc-schedule-override'),
      who: NpcSelectorSchema,
      at: LocSelectorSchema,
      phases: z.array(PhaseSchema).min(1),
    }).strict(),
    z.object({
      op: z.literal('metric-delta'),
      metric: z.enum(METRIC_IDS),
      delta: z.number(),
    }).strict(),
    z.object({ op: z.literal('spawn-thread'), tags: z.array(z.string().min(1)).min(1) }).strict(),
    z.object({
      op: z.literal('news-development'),
      story: z.string().min(1),
      beat: z.string().min(1),
    }).strict(),
    z.object({
      op: z.literal('post-notice'),
      template: z.string().min(1),
      at: LocSelectorSchema,
    }).strict(),
    z.object({
      op: z.literal('detain-npc'),
      who: NpcSelectorSchema,
      days: z.number().int().positive(),
    }).strict(),
    z.object({
      op: z.literal('ambient-hook'),
      hook: z.enum(AMBIENT_HOOK_KINDS),
      days: z.union([z.literal(1), z.literal(2)]).optional(),
      amount: z.number().optional(),
    }).strict(),
  ]),
);

export const EventWhenSchema = z
  .object({
    season: z.array(z.enum(['spring', 'summer', 'autumn', 'winter'])).min(1).optional(),
    metrics: z.record(z.enum(METRIC_IDS), MetricCmpSchema).optional(),
    districtQuery: TagQuerySchema.optional(),
    weather: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

export const EventTemplateSchema = z
  .object({
    id: ContentIdSchema,
    category: z.enum(EVENT_CATEGORIES),
    class: z.enum(['exogenous', 'reactive']),
    when: EventWhenSchema.optional(),
    weight: z.number().positive(),
    cooldownDays: z.number().int().nonnegative(),
    exclusive: z.array(z.string().min(1)).default([]),
    name: z.string().min(1),
    durationDays: z.tuple([
      z.number().int().min(1).max(14),
      z.number().int().min(1).max(14),
    ]),
    stages: z
      .array(
        z.object({
          day: z.union([z.number().int().nonnegative(), z.literal('last')]),
          ops: z.array(EffectOpSchema).min(1),
        }).strict(),
      )
      .min(1)
      .max(7),
    fallback: EffectOpSchema.optional(),
    novelty: z.number().positive().optional(),
  })
  .strict();

export const IncidentTemplateSchema = z
  .object({
    id: ContentIdSchema,
    locQuery: TagQuerySchema,
    phases: z.array(PhaseSchema).min(1),
    factLine: z.string().min(1),
    participants: z.array(NpcSelectorSchema).default([]),
    newsworthy: z.boolean().default(false),
  })
  .strict();

export const LifeEventTemplateSchema = z
  .object({
    id: ContentIdSchema,
    text: z.string().min(1),
    weight: z.number().positive().default(1),
    excludeFor: z.array(z.enum(['principal'])).optional(),
    effects: z
      .object({
        needs: z
          .object({
            money: z.number().optional(),
            social: z.number().optional(),
            work: z.number().optional(),
          })
          .strict()
          .optional(),
        mood: z.number().optional(),
        work: z.enum(['employed', 'unemployed', 'sick', 'on-leave']).optional(),
        mice: z
          .object({
            money: z.number().optional(),
            ideology: z.number().optional(),
            coercion: z.number().optional(),
            ego: z.number().optional(),
          })
          .strict()
          .optional(),
        moneyNeed: z.number().optional(),
        deviateDays: z.number().optional(),
        remove: z.boolean().optional(),
        detain: z.boolean().optional(),
        death: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const StoryTemplateSchema = z
  .object({
    id: ContentIdSchema,
    beats: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const OutletSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1),
    slant: z.enum(['government', 'opposition', 'commercial', 'church']),
  })
  .strict();

export const NoticeTemplateSchema = z
  .object({
    id: ContentIdSchema,
    title: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();

export const CoverDutyTemplateSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1),
    phases: z.array(PhaseSchema).min(1),
    standing: z.number(),
    /** How many phases the duty occupies. Absent means one, or two when two phases are named. */
    span: z.union([z.literal(1), z.literal(2)]).optional(),
    suspicion: z.number().optional(),
    mandatory: z.boolean().optional(),
    identities: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const CivicOrgTemplateSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1),
    kind: z.enum(['police', 'press', 'union', 'party', 'employer', 'cover-employer']),
  })
  .strict();

export const HolidaySchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  })
  .strict();

export const MetricDefSchema = z
  .object({
    id: z.enum(METRIC_IDS),
    baseline: z.number().min(0).max(1),
    decay: z.number().min(0).max(1),
  })
  .strict();

export const RecollectionTemplateSchema = z
  .object({
    id: ContentIdSchema,
    text: z.string().min(1),
  })
  .strict();

export const RegardRuleSchema = z
  .object({
    id: ContentIdSchema,
    intent: z.string().min(1),
    warmth: z.number(),
    wariness: z.number(),
    familiarity: z.number().default(0),
  })
  .strict();

export const AmbientSpawnSchema = z
  .object({
    metric: z.enum(METRIC_IDS),
    above: z.number().min(0).max(1),
    tags: z.array(z.string().min(1)).optional(),
  })
  .strict();

const OWNER = '@tradecraft/engine';
const ROLES = ['extension', 'city', 'era'] as const;

function kind(
  name: string,
  dir: string,
  schema: z.ZodType,
  text: readonly string[],
): ContentKindRegistration {
  return {
    kind: name,
    dir,
    schema,
    roles: ROLES,
    cityScoped: false,
    owner: OWNER,
    fields: text.length === 0 ? {} : { text },
  };
}

export const AMBIENT_KINDS: readonly ContentKindRegistration[] = [
  kind('event-template', 'events', EventTemplateSchema, ['items[].name']),
  kind('incident-template', 'incidents', IncidentTemplateSchema, ['items[].factLine']),
  kind('life-event-template', 'life-events', LifeEventTemplateSchema, ['items[].text']),
  kind('story-template', 'stories', StoryTemplateSchema, []),
  kind('outlet', 'outlets', OutletSchema, ['items[].name']),
  kind('notice-template', 'notices', NoticeTemplateSchema, ['items[].title', 'items[].body']),
  kind('cover-duty-template', 'cover-duties', CoverDutyTemplateSchema, ['items[].name']),
  kind('civic-org-template', 'civic-orgs', CivicOrgTemplateSchema, ['items[].name']),
  kind('holiday', 'holidays', HolidaySchema, ['items[].name']),
  kind('metric-def', 'metrics', MetricDefSchema, []),
  kind('recollection-template', 'recollections', RecollectionTemplateSchema, ['items[].text']),
  kind('regard-rule', 'regard-rules', RegardRuleSchema, []),
];

/** JSON Schema for one ambient kind, derived from its Zod schema. */
export function ambientJsonSchema(kindName: string): Record<string, unknown> {
  const found = AMBIENT_KINDS.find((item) => item.kind === kindName);
  if (found === undefined) {
    throw new Error(`no ambient kind ${kindName}`);
  }
  return z.toJSONSchema(found.schema) as Record<string, unknown>;
}
