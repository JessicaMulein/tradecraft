/**
 * Street-ops content kinds (street-ops task 2.1).
 *
 * Registered through the content loader's `LoadOptions.kinds`. The content
 * package does not import this module, and a slice load that does not pass
 * these kinds never reads a street-ops file.
 *
 * Story templates are `street-story`, not `story-template`: ambient already
 * owns that kind name, and the loader keeps the first registration.
 */

import {
  ContentIdSchema,
  ContentRefSchema,
  IsoDateSchema,
  YearRangeSchema,
  type ContentKindRegistration,
  type FieldDeclarations,
} from '@tradecraft/content';
import { z } from 'zod';

import { BORDER_OUTCOMES } from '../border/check.js';

export const SPEED_CLASSES = ['slow', 'normal', 'fast'] as const;
export type SpeedClass = (typeof SPEED_CLASSES)[number];
export const SpeedClassSchema = z.enum(SPEED_CLASSES);

/** The four drive phases. `afternoon` is the slice's midday phase. */
export const STREET_PHASES = ['morning', 'afternoon', 'evening', 'night'] as const;
export type StreetPhase = (typeof STREET_PHASES)[number];
export const StreetPhaseSchema = z.enum(STREET_PHASES);

export const GRAPH_FEATURES = [
  'one-way',
  'dead-end',
  'parking',
  'tram',
  'checkpoint',
  'contraflow',
] as const;
export const GraphFeatureSchema = z.enum(GRAPH_FEATURES);
export type GraphFeature = (typeof GRAPH_FEATURES)[number];

const TrafficSchema = z
  .object({
    morning: z.number().int().min(0),
    afternoon: z.number().int().min(0),
    evening: z.number().int().min(0),
    night: z.number().int().min(0),
  })
  .strict();

const SourceSchema = z
  .object({
    name: z.string().min(1),
    licence: z.string().min(1),
    attribution: z.string().min(1),
    retrieved: IsoDateSchema,
    url: z.string().min(1).optional(),
  })
  .strict();

const JunctionSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1).optional(),
    x: z.number(),
    y: z.number(),
    district: ContentRefSchema.optional(),
    barred: z.array(z.tuple([ContentIdSchema, ContentIdSchema])).optional(),
  })
  .strict();

const SegmentSchema = z
  .object({
    id: ContentIdSchema,
    street: z.string().min(1),
    from: ContentIdSchema,
    to: ContentIdSchema,
    lengthM: z.number().positive(),
    speed: SpeedClassSchema,
    oneWay: z.boolean(),
    lanes: z.number().int().min(1),
    traffic: TrafficSchema,
    features: z.array(GraphFeatureSchema).optional(),
    yearRange: YearRangeSchema.optional(),
    mapped: z.boolean().optional(),
    closed: z.boolean().optional(),
  })
  .strict();

const FrontageSchema = z
  .object({
    location: ContentRefSchema,
    segment: ContentIdSchema,
    at: z.number().min(0).max(1),
    side: z.enum(['left', 'right']),
  })
  .strict();

const CheckpointSiteSchema = z
  .object({
    id: ContentIdSchema,
    kind: ContentRefSchema,
    segment: ContentIdSchema,
    at: z.number().min(0).max(1),
    service: ContentRefSchema.optional(),
    visibleM: z.number().positive().optional(),
    hours: z.array(StreetPhaseSchema).min(1).optional(),
  })
  .strict();

export const StreetGraphSchema = z
  .object({
    id: ContentIdSchema,
    city: ContentRefSchema,
    origin: z.enum(['authored', 'built']).default('authored'),
    fidelity: z.enum(['modern-base', 'period-checked', 'period-authored']).optional(),
    sources: z.array(SourceSchema).default([]),
    /** Polygons in the same coordinates as the junctions. Segments outside are unmapped. */
    verifiedArea: z.array(z.array(z.tuple([z.number(), z.number()])).min(3)).optional(),
    junctions: z.array(JunctionSchema).min(1),
    segments: z.array(SegmentSchema).min(1),
    frontages: z.array(FrontageSchema).default([]),
    checkpoints: z.array(CheckpointSiteSchema).default([]),
    routes: z
      .array(
        z
          .object({
            id: ContentIdSchema,
            junctions: z.array(z.string().min(1)).min(2),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .refine((graph) => graph.origin !== 'built' || graph.sources.length > 0, {
    message: 'a built street graph needs a source list',
    path: ['sources'],
  });
export type StreetGraphFile = z.infer<typeof StreetGraphSchema>;

const SpotSchema = z
  .object({
    id: ContentIdSchema,
    capacity: z.number().int().min(0),
    search: z.number().min(0),
    endurance: z.number().min(0),
    reachedBy: z.array(z.enum(['visual', 'interior', 'boot', 'undercarriage'])).min(1).optional(),
  })
  .strict();

export const VehicleSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1),
    era: YearRangeSchema,
    speed: SpeedClassSchema,
    seats: z.number().int().min(1),
    conspicuousness: z.number().min(0).max(1),
    spots: z.array(SpotSchema).default([]),
  })
  .strict();

export const EvasionManeuverSchema = z
  .object({
    id: ContentIdSchema,
    era: YearRangeSchema,
    requires: z.array(GraphFeatureSchema).min(1),
    quality: z.number().min(0).max(1),
    ticks: z.number().int().min(1),
    suspicion: z.number().min(0),
  })
  .strict();

export const TailProfileSchema = z
  .object({
    id: ContentIdSchema,
    service: ContentRefSchema,
    discipline: z.number().min(0).max(1),
    team: z.number().int().min(1),
    methods: z.array(ContentRefSchema).default([]),
  })
  .strict();

export const SurveillanceMethodSchema = z
  .object({
    id: ContentIdSchema,
    era: YearRangeSchema,
  })
  .strict();

export const CheckpointKindSchema = z
  .object({
    id: ContentIdSchema,
    borderCheck: z.enum(BORDER_OUTCOMES),
    thoroughness: z.number().min(0).max(1),
    hours: z.array(StreetPhaseSchema).min(1),
    searches: z.array(z.enum(['visual', 'interior', 'boot', 'undercarriage'])).min(1).default(['visual', 'interior']),
    watchesAvoidance: z.boolean().default(false),
    avoidanceSuspicion: z.number().min(0).default(0),
    strictness: z.number().min(0).max(1).default(0.5),
  })
  .strict();
export type CheckpointKind = z.infer<typeof CheckpointKindSchema>;

export const StreetStorySchema = z
  .object({
    id: ContentIdSchema,
    slots: z.array(z.string().min(1)).min(1),
    fits: z.array(z.string().min(1)).default([]),
    followUps: z.array(ContentRefSchema).default([]),
  })
  .strict();

export const ComposureTableSchema = z
  .object({
    id: ContentIdSchema,
    rows: z
      .array(
        z
          .object({
            tags: z.array(z.string().min(1)).min(1),
            composure: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const MapDocumentSchema = z
  .object({
    id: ContentIdSchema,
    title: z.string().min(1),
    era: YearRangeSchema,
    segments: z.array(ContentIdSchema).default([]),
    errors: z.array(z.string().min(1)).default([]),
    /** A street name the sheet prints instead of the graph's name. */
    aliases: z.array(z.object({ segment: ContentIdSchema, street: z.string().min(1) }).strict()).default([]),
    price: z.number().int().min(0).default(0),
    /** The location that sells or holds the sheet. Omitted sheets can be read anywhere. */
    at: ContentRefSchema.optional(),
  })
  .strict();

const OWNER = '@tradecraft/engine';
const ROLES = ['extension'] as const;

function kind(
  name: string,
  dir: string,
  schema: z.ZodType,
  fields: FieldDeclarations,
): ContentKindRegistration {
  return {
    kind: name,
    dir,
    schema,
    roles: ROLES,
    cityScoped: false,
    owner: OWNER,
    fields,
  };
}

export const STREET_OPS_KINDS: readonly ContentKindRegistration[] = [
  kind('street-graph', 'graphs', StreetGraphSchema, {
    text: ['items[].segments[].street', 'items[].junctions[].name'],
    refs: [
      { path: 'items[].city', kind: 'city' },
      { path: 'items[].frontages[].location', kind: 'location' },
      { path: 'items[].checkpoints[].kind', kind: 'checkpoint-kind' },
      { path: 'items[].checkpoints[].service', kind: 'service' },
    ],
  }),
  kind('vehicle', 'vehicles', VehicleSchema, {
    years: ['items[].era'],
    text: ['items[].name'],
  }),
  kind('evasion-maneuver', 'maneuvers', EvasionManeuverSchema, {
    years: ['items[].era'],
  }),
  kind('tail-profile', 'tails', TailProfileSchema, {
    refs: [
      { path: 'items[].service', kind: 'service' },
      { path: 'items[].methods[]', kind: 'surveillance-method' },
    ],
  }),
  kind('surveillance-method', 'methods', SurveillanceMethodSchema, {
    years: ['items[].era'],
  }),
  kind('checkpoint-kind', 'checkpoints', CheckpointKindSchema, {}),
  kind('street-story', 'street-stories', StreetStorySchema, {
    text: ['items[].slots[]'],
    refs: [{ path: 'items[].followUps[]', kind: 'street-story' }],
  }),
  kind('composure-table', 'composure', ComposureTableSchema, {}),
  kind('map-document', 'maps', MapDocumentSchema, {
    years: ['items[].era'],
    text: ['items[].title', 'items[].errors[]', 'items[].aliases[].street'],
    refs: [{ path: 'items[].at', kind: 'location' }],
  }),
];

/** JSON Schema for one street-ops kind, derived from its Zod schema. */
export function streetOpsJsonSchema(kindName: string): Record<string, unknown> {
  const found = STREET_OPS_KINDS.find((item) => item.kind === kindName);
  if (found === undefined) {
    throw new Error(`no street-ops kind ${kindName}`);
  }
  return z.toJSONSchema(found.schema) as Record<string, unknown>;
}
