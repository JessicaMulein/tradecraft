/**
 * The City kinds (content-expansion task 1.4).
 *
 * Each is City-Scoped Content, owned by the City Pack that defines it: the
 * `CityDefinition` (`city.yaml`), its `District`s, `CityLocation`s, `CityRoute`s,
 * `Newspaper`s, `LocalOrg`s, the monthly `WeatherTables`, the `streets` name
 * pools and the `Source` bibliography. The schemas and Field Declarations here
 * follow the design's "City Definition" section.
 *
 * City kinds reference each other and the shared vocabulary by id: a
 * `CityDefinition` names its `climate` Tag, `cultureWeights` Culture Groups and
 * active `services`; a `CityLocation` names its `district`, `type` (a slice
 * Location Type), `tags` and `sources`; a `CityRoute` names two Districts.
 * The loader resolves these references and runs the City-Scoped ownership and
 * cross-city checks in task 2.1; the Field Declarations below tell it (and the
 * Pack Linter) where the Tag, Tag Query, Year Range, text, reference and
 * person-name fields live.
 *
 * Weather tables use the slice `city.yaml` weather-table format — a weighted
 * condition table — but keyed per calendar month (1–12) rather than per named
 * season, so the daily draw selects the month from the date (Req 2.6). The
 * slice schema (`WeatherConditionSchema`) is reused directly.
 *
 * `location-type` stays the slice kind registered in `../lib/registry.ts`; a
 * City Pack's city-specific Location Types are ordinary slice Location Types,
 * City-Scoped by living in the City Pack. This module does not re-register it.
 */

import { z } from 'zod';

import {
  AliasSchema,
  ContentIdSchema,
  ContentRefSchema,
  IsoDateSchema,
  TagIdSchema,
  TagQuerySchema,
  WeekdaySchema,
  YearRangeSchema,
} from '../lib/common.js';
import { WeatherConditionSchema } from '../lib/city-data.js';
import type { ContentKindRegistration } from '../lib/registry.js';

import { CONTENT_EXPANSION_OWNER } from './stub.js';

// --- shared City-kind pieces -----------------------------------------------

/**
 * How a Location relates to the real city: a real landmark (which the Sources
 * List must cover, Req 3.1), a fictional place drawn from a real one, or a
 * wholly fictional place. The `basis` drives the lint-time source and
 * historical-accuracy checks (CE-SOURCE).
 */
export const LOCATION_BASES = [
  'real-landmark',
  'real-inspired',
  'fictional',
] as const;
export const LocationBasisSchema = z.enum(LOCATION_BASES);

/** The bibliographic kinds a {@link SourceSchema} record can be. */
export const SOURCE_KINDS = [
  'book',
  'map',
  'guide',
  'archive',
  'newspaper',
  'other',
] as const;
export const SourceKindSchema = z.enum(SOURCE_KINDS);

// --- CityDefinition --------------------------------------------------------

/**
 * The city's currency: the authored name, symbol and subunit the Locale and
 * money formatter render, the `format` template, the `rounding` step money is
 * rounded to, and the `budgetScale` the scenario and Difficulty Preset money
 * fields are multiplied by at preset resolution (Req 9.6, task 3.6).
 */
export const CurrencySchema = z
  .object({
    name: z.string().min(1),
    symbol: z.string().min(1),
    subunit: z.string().min(1),
    format: z.string().min(1),
    rounding: z.number().positive('rounding step must be positive'),
    budgetScale: z.number().positive('budget scale must be positive'),
  })
  .strict();

/** One language spoken in the city, with its share of the population (0–1). */
export const CityLanguageSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    share: z.number().min(0).max(1),
  })
  .strict();

/**
 * One Culture Group's weight in the city's naming draw, optionally restricted
 * to a Year Range so a group's prevalence can change over the period. `group`
 * is a Culture Group id (resolved in task 1.6 / loader).
 */
export const CultureWeightSchema = z
  .object({
    group: ContentRefSchema,
    weight: z.number().nonnegative('a culture weight must not be negative'),
    years: YearRangeSchema.optional(),
  })
  .strict();

/** An inclusive `[min, max]` bound on a generation count. */
const BoundPairSchema = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([lo, hi]) => lo <= hi, 'bound min must be <= max');

/**
 * The optional instantiation bounds: how many Districts and Locations
 * `instantiateCity` draws (task 3.3). Omitted bounds fall back to the slice's
 * step-1 defaults.
 */
export const InstantiationBoundsSchema = z
  .object({
    districts: BoundPairSchema.optional(),
    locations: BoundPairSchema.optional(),
  })
  .strict();

/**
 * A City Definition (`city.yaml`): the city's identity, period, Start Date
 * window, currency, languages, Culture-Group weights, the Service Definitions
 * active in it (`services`, Req 3.5, 19.2) and the optional instantiation
 * bounds. The generator reads this to choose a Start Date and instantiate the
 * city (tasks 3.2, 3.3, 3.8).
 */
export const CityDefinitionSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1),
    /** Narrator voice for this city. Omitted until a pack authors one. */
    styleSheet: z.string().min(1).optional(),
    country: z.string().min(1),
    climate: TagIdSchema,
    period: YearRangeSchema,
    startDates: z
      .object({ from: IsoDateSchema, to: IsoDateSchema })
      .strict()
      .refine((d) => d.from <= d.to, {
        message: 'startDates.from must be on or before startDates.to',
        path: ['from'],
      }),
    currency: CurrencySchema,
    languages: z
      .array(CityLanguageSchema)
      .min(1, 'a city must list at least one language'),
    cultureWeights: z
      .array(CultureWeightSchema)
      .min(1, 'a city must weight at least one culture group'),
    services: z
      .array(ContentRefSchema)
      .min(1, 'a city must reference at least one service'),
    instantiation: InstantiationBoundsSchema.optional(),
  })
  .strict();
export type CityDefinition = z.infer<typeof CityDefinitionSchema>;

// --- District --------------------------------------------------------------

/**
 * The occupation sector (or administrative zone) that holds a District, named
 * by `power` and the Year Range it applied — Vienna's four powers, Berlin's
 * sectors, Trieste's zones. Omitted on cities with no sector regime.
 */
export const DistrictSectorSchema = z
  .object({
    power: z.string().min(1),
    years: YearRangeSchema,
  })
  .strict();

/**
 * A District: a named node in the city's Route graph, with its aliases, prose
 * description, atmosphere tags, Tags and optional sector. The generator stamps
 * a District entity from this and keys the Route graph off `id`.
 */
export const DistrictSchema = z
  .object({
    id: ContentIdSchema,
    city: ContentRefSchema,
    name: z.string().min(1),
    aliases: z.array(AliasSchema).default([]),
    description: z.string().min(1),
    atmosphere: z.array(z.string().min(1)).default([]),
    tags: z.array(TagIdSchema).default([]),
    sector: DistrictSectorSchema.optional(),
  })
  .strict();
export type District = z.infer<typeof DistrictSchema>;

// --- CityLocation ----------------------------------------------------------

/**
 * A City Location: an authored place in the city, pinned to a District and
 * stamped from a slice Location Type. It extends the slice Location fields
 * (name, aliases, the Location Type `type`, its District, whether it is
 * `public`, description and atmosphere) with the City-Scoped additions the
 * design lists: the owning `city`, its `tags`, its `basis` (which drives the
 * Sources requirement), an optional Year Range, the `sources` that attest a
 * real landmark, and an optional weighted-fill `weight`.
 *
 * The hours, risk and dead-drop sites a generated Location carries come from
 * its Location Type, so they are not authored here.
 */
export const CityLocationSchema = z
  .object({
    // slice Location fields (Req 21.1)
    id: ContentIdSchema,
    name: z.string().min(1),
    aliases: z.array(AliasSchema).default([]),
    type: ContentRefSchema,
    district: ContentRefSchema,
    public: z.boolean(),
    description: z.string().min(1),
    atmosphere: z.array(z.string().min(1)).default([]),
    // City-Scoped additions
    city: ContentRefSchema,
    tags: z.array(TagIdSchema).default([]),
    basis: LocationBasisSchema,
    years: YearRangeSchema.optional(),
    sources: z.array(ContentRefSchema).optional(),
    weight: z.number().positive('a location weight must be positive').optional(),
  })
  .strict();
export type CityLocation = z.infer<typeof CityLocationSchema>;

// --- CityRoute -------------------------------------------------------------

/**
 * A Route between two Districts: `cost` is `0` or `1` phases (travel within a
 * District is free and needs no Route), with optional checkpoint Tags and a
 * Year Range so a sector-crossing or zone-line Route can open or close over the
 * period. `a` and `b` are District ids.
 */
export const CityRouteSchema = z
  .object({
    a: ContentRefSchema,
    b: ContentRefSchema,
    cost: z.union([z.literal(0), z.literal(1)]),
    tags: z.array(TagIdSchema).optional(),
    years: YearRangeSchema.optional(),
  })
  .strict();
export type CityRoute = z.infer<typeof CityRouteSchema>;

// --- Newspaper -------------------------------------------------------------

/**
 * A fictional newspaper: its masthead, language, political stance and register,
 * the weekdays it prints, its cover price, the Tag Query naming where it is
 * sold (`soldAt`) and an optional Year Range. Articles rendered from it use the
 * city/era Locale and the newspaper document style.
 */
export const NewspaperSchema = z
  .object({
    id: ContentIdSchema,
    city: ContentRefSchema,
    masthead: z.string().min(1),
    language: z.string().min(1),
    stance: z.string().min(1),
    register: z.string().min(1),
    days: z
      .array(WeekdaySchema)
      .min(1, 'a newspaper must print on at least one weekday'),
    price: z.number().nonnegative('a newspaper price must not be negative'),
    soldAt: TagQuerySchema,
    years: YearRangeSchema.optional(),
  })
  .strict();
export type Newspaper = z.infer<typeof NewspaperSchema>;

// --- LocalOrg --------------------------------------------------------------

/**
 * A local organisation: a fictional institution — a ministry, a bank, a café
 * chain, a trade union — with its aliases, a free-form `kind`, its Tags, the
 * Tag Queries that describe who its members are drawn from (`members`) and an
 * optional Year Range.
 */
export const LocalOrgSchema = z
  .object({
    id: ContentIdSchema,
    city: ContentRefSchema,
    name: z.string().min(1),
    aliases: z.array(AliasSchema).default([]),
    kind: z.string().min(1),
    tags: z.array(TagIdSchema).default([]),
    members: z.array(TagQuerySchema).default([]),
    years: YearRangeSchema.optional(),
  })
  .strict();
export type LocalOrg = z.infer<typeof LocalOrgSchema>;

// --- WeatherTables ---------------------------------------------------------

/**
 * One month's weighted weather table, in the slice `city.yaml` weather format:
 * a list of weighted conditions the daily stream draws from. Reuses the slice
 * {@link WeatherConditionSchema} so a condition's `id`, `label` and `weight`
 * mean exactly what the slice daily draw expects.
 */
export const MonthlyWeatherSchema = z
  .array(WeatherConditionSchema)
  .min(1, 'a month must list at least one weather condition');

/**
 * The twelve calendar months as mapping keys (1 = January … 12 = December),
 * each carrying one {@link MonthlyWeatherSchema}. Every month is required, so
 * the daily draw always has a table for the date's month (Req 2.6).
 */
export const MonthlyTablesSchema = z
  .object({
    '1': MonthlyWeatherSchema,
    '2': MonthlyWeatherSchema,
    '3': MonthlyWeatherSchema,
    '4': MonthlyWeatherSchema,
    '5': MonthlyWeatherSchema,
    '6': MonthlyWeatherSchema,
    '7': MonthlyWeatherSchema,
    '8': MonthlyWeatherSchema,
    '9': MonthlyWeatherSchema,
    '10': MonthlyWeatherSchema,
    '11': MonthlyWeatherSchema,
    '12': MonthlyWeatherSchema,
  })
  .strict();

/**
 * The city's weather tables: one weighted condition table per calendar month,
 * in the slice `city.yaml` weather-table format. The daily draw selects the
 * month from the calendar date and draws a condition from that month's table.
 */
export const WeatherTablesSchema = z
  .object({
    city: ContentRefSchema,
    months: MonthlyTablesSchema,
  })
  .strict();
export type WeatherTables = z.infer<typeof WeatherTablesSchema>;

// --- Source ----------------------------------------------------------------

/**
 * A bibliographic source: the record a `real-landmark` Location cites so its
 * historical texture can be reviewed (Req 3.1). URLs are optional; the author,
 * year and note are optional context.
 */
export const SourceSchema = z
  .object({
    id: ContentIdSchema,
    title: z.string().min(1),
    author: z.string().min(1).optional(),
    year: z.number().int().optional(),
    kind: SourceKindSchema,
    note: z.string().min(1).optional(),
  })
  .strict();
export type Source = z.infer<typeof SourceSchema>;

// --- streets ---------------------------------------------------------------

/**
 * A streets name pool: a named list of street names the generator draws
 * addresses from and Location Type `namePatterns` reference via `{pick:<pool>}`
 * (the slice `city.yaml` `streets` shape). A City Pack writes one or more pools
 * under `streets`.
 */
export const StreetsPoolSchema = z
  .object({
    id: ContentIdSchema,
    names: z
      .array(z.string().min(1))
      .min(1, 'a streets pool needs at least one name'),
  })
  .strict();
export type StreetsPool = z.infer<typeof StreetsPoolSchema>;

// --- registrations ---------------------------------------------------------

function cityKindRegistration<T>(args: {
  readonly kind: string;
  readonly dir: string;
  readonly schema: z.ZodType<T>;
  readonly fields: ContentKindRegistration['fields'];
}): ContentKindRegistration<T> {
  return {
    kind: args.kind,
    dir: args.dir,
    schema: args.schema,
    roles: ['city'],
    cityScoped: true,
    fields: args.fields,
    owner: CONTENT_EXPANSION_OWNER,
  };
}

export const cityKind = cityKindRegistration({
  kind: 'city',
  dir: 'city',
  schema: CityDefinitionSchema,
  fields: {
    tags: ['items[].climate'],
    years: ['items[].period'],
    refs: [
      { path: 'items[].cultureWeights[].group', kind: 'culture-group' },
      { path: 'items[].services[]', kind: 'service' },
    ],
  },
});

export const districtKind = cityKindRegistration({
  kind: 'district',
  dir: 'districts',
  schema: DistrictSchema,
  fields: {
    text: ['items[].description', 'items[].atmosphere[]'],
    tags: ['items[].tags[]'],
    years: ['items[].sector.years'],
    refs: [{ path: 'items[].city', kind: 'city' }],
  },
});

export const locationKind = cityKindRegistration({
  kind: 'location',
  dir: 'locations',
  schema: CityLocationSchema,
  fields: {
    text: ['items[].description', 'items[].atmosphere[]'],
    tags: ['items[].tags[]'],
    years: ['items[].years'],
    refs: [
      { path: 'items[].city', kind: 'city' },
      { path: 'items[].district', kind: 'district' },
      { path: 'items[].type', kind: 'location-type' },
      { path: 'items[].sources[]', kind: 'sources' },
    ],
  },
});

export const routeKind = cityKindRegistration({
  kind: 'route',
  dir: 'routes',
  schema: CityRouteSchema,
  fields: {
    tags: ['items[].tags[]'],
    years: ['items[].years'],
    refs: [
      { path: 'items[].a', kind: 'district' },
      { path: 'items[].b', kind: 'district' },
    ],
  },
});

export const newspaperKind = cityKindRegistration({
  kind: 'newspaper',
  dir: 'newspapers',
  schema: NewspaperSchema,
  fields: {
    text: ['items[].masthead'],
    tagQueries: ['items[].soldAt'],
    years: ['items[].years'],
    refs: [{ path: 'items[].city', kind: 'city' }],
  },
});

export const localOrgKind = cityKindRegistration({
  kind: 'local-org',
  dir: 'local-orgs',
  schema: LocalOrgSchema,
  fields: {
    text: ['items[].name'],
    tags: ['items[].tags[]'],
    tagQueries: ['items[].members[]'],
    years: ['items[].years'],
    refs: [{ path: 'items[].city', kind: 'city' }],
  },
});

export const weatherKind = cityKindRegistration({
  kind: 'weather',
  dir: 'weather',
  schema: WeatherTablesSchema,
  fields: {
    refs: [{ path: 'items[].city', kind: 'city' }],
  },
});

export const streetsKind = cityKindRegistration({
  kind: 'streets',
  dir: 'streets',
  schema: StreetsPoolSchema,
  fields: {},
});

export const sourcesKind = cityKindRegistration({
  kind: 'sources',
  dir: 'sources',
  schema: SourceSchema,
  fields: {
    text: ['items[].title', 'items[].note'],
  },
});

/** Every City kind registered by this module. */
export const CITY_KINDS = [
  cityKind,
  districtKind,
  locationKind,
  routeKind,
  newspaperKind,
  localOrgKind,
  weatherKind,
  streetsKind,
  sourcesKind,
];
