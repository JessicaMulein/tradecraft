/**
 * Regional content kinds (multi-city task 1.1; Req 16.1, 16.5, 20.2, 1.5, 10.1).
 *
 * The schemas live here, in the engine, and are registered through the content
 * loader's `LoadOptions.kinds`. The content package does not import this module.
 * Every entry carries an era range so the Region Generator can keep only the
 * entries that contain a City's era date.
 */

import {
  ContentIdSchema,
  ContentRefSchema,
  DoctrineBaseSchema,
  IsoDateSchema,
  PhaseSchema,
  ProbabilitySchema,
  WeekdaySchema,
  YearRangeSchema,
  type ContentKindRegistration,
  type FieldDeclarations,
} from '@tradecraft/content';
import { z } from 'zod';

export const TRAVEL_MODES = ['rail', 'air', 'road', 'sea'] as const;
export const TravelModeSchema = z.enum(TRAVEL_MODES);

export const DOCUMENT_OBTAINED_BY = ['station', 'consulate', 'none'] as const;
export const DOCUMENT_ISSUER_KINDS = ['station', 'consulate', 'service'] as const;

const ROLE_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;

function closedSpan(min: number, max: number, whole: boolean) {
  const bound = whole ? z.number().int().min(min).max(max) : z.number().min(min).max(max);
  return z
    .object({ min: bound, max: bound })
    .strict()
    .refine((span) => span.min <= span.max, {
      message: 'min must be <= max',
      path: ['min'],
    });
}

const CitySlotSchema = z
  .object({
    city: ContentRefSchema,
    hub: z.boolean().default(false),
  })
  .strict();

const SectorLineSchema = z
  .object({
    id: ContentIdSchema,
    a: z.string().min(1),
    b: z.string().min(1),
  })
  .strict();

const JurisdictionEntrySchema = z
  .object({
    place: z.string().min(1),
    service: ContentRefSchema,
  })
  .strict();

/**
 * A region template. `eraDate` is the date assigned to every City; `era` is
 * the template's own range (Req 1.5). Exactly one City slot is the hub.
 */
export const RegionTemplateSchema = z
  .object({
    id: ContentIdSchema,
    era: YearRangeSchema,
    eraDate: IsoDateSchema,
    cities: z.array(CitySlotSchema).min(2).max(4),
    countries: z.array(z.string().min(1)).min(1),
    sectorLines: z.array(SectorLineSchema).default([]),
    jurisdiction: z.array(JurisdictionEntrySchema).default([]),
    services: z.array(ContentRefSchema).default([]),
    rivalry: ContentRefSchema.optional(),
    routes: z.array(ContentRefSchema).default([]),
    plots: z.array(ContentRefSchema).default([]),
  })
  .strict()
  .refine((row) => row.cities.filter((slot) => slot.hub).length === 1, {
    message: 'a region template must name exactly one hub city',
    path: ['cities'],
  });
export type RegionTemplate = z.infer<typeof RegionTemplateSchema>;

const DepartureSlotSchema = z
  .object({
    weekday: WeekdaySchema,
    phase: PhaseSchema,
  })
  .strict();

export const IntercityRouteTemplateSchema = z
  .object({
    id: ContentIdSchema,
    era: YearRangeSchema,
    mode: TravelModeSchema,
    terminals: z.array(z.string().min(1)).min(2),
    timetable: z.union([z.string().min(1), z.array(DepartureSlotSchema).min(1)]),
    duration: z.number().int().min(1).max(8),
    fare: z.number().nonnegative(),
    borders: z.array(ContentRefSchema).default([]),
    cancellingWeather: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type IntercityRouteTemplate = z.infer<typeof IntercityRouteTemplateSchema>;

const CountryPairSchema = z
  .object({
    kind: z.literal('countries'),
    a: z.string().min(1),
    b: z.string().min(1),
  })
  .strict();

const SectorBorderSchema = z
  .object({
    kind: z.literal('sector-line'),
    line: ContentIdSchema,
  })
  .strict();

export const BorderSchema = z
  .object({
    id: ContentIdSchema,
    era: YearRangeSchema,
    between: z.union([CountryPairSchema, SectorBorderSchema]),
  })
  .strict();
export type Border = z.infer<typeof BorderSchema>;

export const BorderPostSchema = z
  .object({
    id: ContentIdSchema,
    era: YearRangeSchema,
    border: ContentRefSchema,
    service: ContentRefSchema,
    strictness: ProbabilitySchema,
    documents: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type BorderPost = z.infer<typeof BorderPostSchema>;

export const TravelDocumentKindSchema = z
  .object({
    id: ContentIdSchema,
    era: YearRangeSchema,
    issuers: z.array(z.enum(DOCUMENT_ISSUER_KINDS)).min(1),
    validityDays: z.number().int().positive(),
    baseQuality: ProbabilitySchema,
    cost: z.number().nonnegative(),
    obtainableBy: z.enum(DOCUMENT_OBTAINED_BY),
  })
  .strict();
export type TravelDocumentKind = z.infer<typeof TravelDocumentKindSchema>;

const LiaisonAgendaSchema = z
  .object({
    conceal: z.array(z.string().min(1)).default([]),
    promote: z.array(z.string().min(1)).default([]),
    obtain: z.array(z.string().min(1)).default([]),
  })
  .strict();

/**
 * Fields a region adds to a content-expansion Service Definition: where it
 * resides, doctrine overrides, officer names and the liaison agenda.
 */
export const ServiceExtensionSchema = z
  .object({
    id: ContentIdSchema,
    era: YearRangeSchema,
    service: ContentRefSchema,
    residency: z.array(ContentRefSchema).default([]),
    doctrine: DoctrineBaseSchema.optional(),
    naming: z.array(z.string().min(1)).default([]),
    liaisonAgenda: LiaisonAgendaSchema.default({ conceal: [], promote: [], obtain: [] }),
  })
  .strict();
export type ServiceExtension = z.infer<typeof ServiceExtensionSchema>;

const RivalryEdgeSchema = z
  .object({
    from: ContentRefSchema,
    to: ContentRefSchema,
    share: z.boolean(),
    delayPhases: z.number().int().nonnegative(),
  })
  .strict();

export const RivalryTableSchema = z
  .object({
    id: ContentIdSchema,
    era: YearRangeSchema,
    edges: z.array(RivalryEdgeSchema).min(1),
  })
  .strict();
export type RivalryTable = z.infer<typeof RivalryTableSchema>;

/**
 * Every Req 20.2 field, keyed by a Difficulty Preset id (`preset`).
 */
export const RegionalPresetSchema = z
  .object({
    id: ContentIdSchema,
    era: YearRangeSchema,
    preset: ContentIdSchema,
    cityCount: closedSpan(2, 4, true),
    borderStrictness: closedSpan(0, 1, false),
    watchListSensitivity: z.number().nonnegative(),
    detentionPhases: z.number().int().nonnegative(),
    contrabandCashThreshold: z.number().nonnegative(),
    papersDelay: z.number().int().nonnegative(),
    papersCost: z.number().nonnegative(),
    communicationLatency: z
      .object({
        sameCountry: z.number().int().nonnegative(),
        crossBorder: z.number().int().nonnegative(),
        acrossCurtain: z.number().int().nonnegative(),
      })
      .strict(),
    liaisonReliability: closedSpan(0, 1, false),
    liaisonTrustThreshold: ProbabilitySchema,
    penetrationProbability: ProbabilitySchema,
    rivalryIntensity: ProbabilitySchema,
    verifierAttemptLimit: z.number().int().positive(),
  })
  .strict();
export type RegionalPreset = z.infer<typeof RegionalPresetSchema>;

export const CrossCityHandoffSchema = z
  .object({
    from: ContentIdSchema,
    carrier: z.enum(['courier-line', 'cell-member']),
    modes: z.array(TravelModeSchema).min(1),
  })
  .strict();

export const CityRoleConstraintSchema = z
  .object({
    not: z.literal('hub').optional(),
  })
  .strict();

/**
 * Canonical Cross-City Stage Hook (Req 10.1). Plot templates declare these
 * fields; `fallback` is read only in single-city play.
 */
export const CrossCityStageHookSchema = z
  .object({
    id: ContentIdSchema,
    era: YearRangeSchema,
    city: z.string().regex(ROLE_NAME, 'city role must be a role name'),
    handoff: CrossCityHandoffSchema.optional(),
    cityRoles: z.record(z.string().regex(ROLE_NAME), CityRoleConstraintSchema),
    fallback: ContentIdSchema.optional(),
  })
  .strict();
export type CrossCityStageHook = z.infer<typeof CrossCityStageHookSchema>;

const OWNER = '@tradecraft/engine';
const ROLES = ['extension'] as const;
const ERA: FieldDeclarations = { years: ['items[].era'] };

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

export const REGION_KINDS: readonly ContentKindRegistration[] = [
  kind('region-template', 'region-templates', RegionTemplateSchema, {
    ...ERA,
    text: ['items[].countries[]'],
    refs: [
      { path: 'items[].cities[].city', kind: 'city' },
      { path: 'items[].jurisdiction[].service', kind: 'service' },
      { path: 'items[].services[]', kind: 'service' },
      { path: 'items[].rivalry', kind: 'rivalry-table' },
      { path: 'items[].routes[]', kind: 'intercity-route-template' },
      { path: 'items[].plots[]', kind: 'plot-template' },
    ],
  }),
  kind('intercity-route-template', 'intercity-routes', IntercityRouteTemplateSchema, {
    ...ERA,
    text: ['items[].terminals[]', 'items[].cancellingWeather[]'],
    refs: [{ path: 'items[].borders[]', kind: 'border' }],
  }),
  kind('border', 'borders', BorderSchema, {
    ...ERA,
    text: ['items[].between.a', 'items[].between.b'],
  }),
  kind('border-post', 'border-posts', BorderPostSchema, {
    ...ERA,
    text: ['items[].documents[]'],
    refs: [
      { path: 'items[].border', kind: 'border' },
      { path: 'items[].service', kind: 'service' },
    ],
  }),
  kind('travel-document-kind', 'travel-documents', TravelDocumentKindSchema, ERA),
  kind('service-extension', 'service-extensions', ServiceExtensionSchema, {
    ...ERA,
    names: ['items[].naming[]'],
    refs: [
      { path: 'items[].service', kind: 'service' },
      { path: 'items[].residency[]', kind: 'city' },
    ],
  }),
  kind('rivalry-table', 'rivalry-tables', RivalryTableSchema, {
    ...ERA,
    refs: [
      { path: 'items[].edges[].from', kind: 'service' },
      { path: 'items[].edges[].to', kind: 'service' },
    ],
  }),
  kind('regional-preset', 'regional-presets', RegionalPresetSchema, {
    ...ERA,
    refs: [{ path: 'items[].preset', kind: 'difficulty-preset' }],
  }),
  kind('cross-city-stage-hook', 'cross-city-hooks', CrossCityStageHookSchema, ERA),
];

/** JSON Schema for one regional kind, derived from its Zod schema. */
export function regionJsonSchema(kindName: string): Record<string, unknown> {
  const found = REGION_KINDS.find((item) => item.kind === kindName);
  if (found === undefined) {
    throw new Error(`no regional kind ${kindName}`);
  }
  return z.toJSONSchema(found.schema) as Record<string, unknown>;
}
