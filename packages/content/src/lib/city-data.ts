/**
 * The `city.yaml` content kind: the city geography the world generator stamps
 * Districts, Locations and Routes from, plus the seasonal weather tables the
 * daily PRNG stream reads (design, "Content Packs"; Requirements 21.1, 21.6).
 *
 * `city.yaml` is deliberately outside the main pack-kind table — the loader
 * tolerates its presence without parsing it (see {@link import('./loader.js')}),
 * because its shape serves the engine's world generator rather than the shared
 * content vocabulary. This module gives it the one thing it still needs to be
 * used safely: a Zod schema and a small, filesystem-reading loader, so the
 * engine consumes a validated {@link CityData} value instead of hand-parsing
 * YAML across the package boundary. Keeping the parse here honours the rule
 * that `content` is the only package that reads pack files from disk.
 *
 * The schema captures the fields the city generator reads:
 *
 * - `districts` — the nodes of the Route graph, each with a `sector` tag.
 * - `streets` and `namePools` — the name pools Location Type `namePatterns`
 *   draw from (via `{pick:<pool>}`) and the generator uses for addresses.
 * - `weather.seasons` — one weighted condition table per season, keyed by the
 *   months it covers; the daily stream draws a condition per day.
 * - `weather.tags` — the weather tags a Location Type's `weatherModifiers`
 *   match on.
 *
 * Validation is intentionally permissive about *extra* keys the authored file
 * may carry for flavour or future tasks (sector notes, district `character`
 * prose), so it uses non-strict objects: the generator reads only the fields it
 * needs and ignores the rest, and a later task can tighten this without
 * breaking the authored file.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { ContentIdSchema } from './common.js';

// --- sectors ---------------------------------------------------------------

/**
 * One occupying power's sector (or the jointly administered international
 * zone). Only `id` is read by the generator today; `power`, `label` and `note`
 * are period texture carried through for later tasks and the Narrator.
 */
export const CitySectorSchema = z
  .object({
    id: ContentIdSchema,
    power: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    note: z.string().optional(),
  })
  .loose();
export type CitySector = z.infer<typeof CitySectorSchema>;

// --- districts -------------------------------------------------------------

/**
 * One District: a named node in the Route graph, tagged with the sector that
 * holds it. `number` and `character` are period texture; the generator keys off
 * `id`, `name` and `sector`.
 */
export const CityDistrictSchema = z
  .object({
    id: ContentIdSchema,
    number: z.number().int().optional(),
    name: z.string().min(1),
    sector: ContentIdSchema,
    character: z.string().optional(),
  })
  .loose();
export type CityDistrict = z.infer<typeof CityDistrictSchema>;

// --- weather ---------------------------------------------------------------

/**
 * One weather condition in a season's table: a stable `id` (matched by Location
 * Type `weatherModifiers`), a human `label` for Fact Lines and the Narrator,
 * and a positive `weight` for the daily weighted draw.
 */
export const WeatherConditionSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    weight: z.number().positive(),
  })
  .strict();
export type WeatherCondition = z.infer<typeof WeatherConditionSchema>;

/**
 * One season: the calendar months it covers (1 = January … 12 = December) and
 * its weighted condition table. The daily stream maps the day's month to a
 * season and draws one condition from this table.
 */
export const WeatherSeasonSchema = z
  .object({
    months: z
      .array(z.number().int().min(1).max(12))
      .min(1, 'a season must cover at least one month'),
    conditions: z
      .array(WeatherConditionSchema)
      .min(1, 'a season must list at least one weather condition'),
  })
  .strict();
export type WeatherSeason = z.infer<typeof WeatherSeasonSchema>;

/**
 * The weather tables: a named map of seasons plus the flat list of weather tags
 * Location Type `weatherModifiers` match on. Non-strict so an authored file may
 * carry extra season names; the generator reads whichever months a day lands
 * in.
 */
export const CityWeatherSchema = z
  .object({
    seasons: z
      .record(z.string(), WeatherSeasonSchema)
      .refine((s) => Object.keys(s).length > 0, {
        message: 'weather.seasons must define at least one season',
      }),
    tags: z.array(z.string().min(1)).default([]),
  })
  .loose();
export type CityWeather = z.infer<typeof CityWeatherSchema>;

// --- name pools ------------------------------------------------------------

/** A map from pool id to its list of names, as used by `{pick:<pool>}`. */
const NamePoolMapSchema = z.record(
  z.string(),
  z.array(z.string().min(1)).min(1, 'a name pool must have at least one entry'),
);

// --- city data -------------------------------------------------------------

/**
 * The validated `city.yaml`: the city's identity, its sectors and districts,
 * the street and Location-name pools, and the seasonal weather tables. This is
 * the shape the engine's world generator consumes (Requirements 21.1, 21.6).
 */
export const CityDataSchema = z
  .object({
    id: ContentIdSchema,
    displayName: z.string().min(1),
    era: z.string().optional(),
    occupation: z.string().optional(),
    sectors: z.array(CitySectorSchema).default([]),
    districts: z
      .array(CityDistrictSchema)
      .min(1, 'a city must define at least one district'),
    streets: NamePoolMapSchema.default({}),
    namePools: NamePoolMapSchema.default({}),
    weather: CityWeatherSchema,
  })
  .loose();
export type CityData = z.infer<typeof CityDataSchema>;

/** The default name of the city file inside a pack directory. */
export const CITY_FILE = 'city.yaml';

/**
 * The outcome of loading `city.yaml`: either the validated {@link CityData} or
 * a located error (file plus field path plus message), mirroring the loader's
 * {@link import('./pack.js').ContentError} style so the engine can report it
 * uniformly.
 */
export type CityDataResult =
  | { readonly ok: true; readonly value: CityData }
  | {
      readonly ok: false;
      readonly errors: ReadonlyArray<{
        readonly file: string;
        readonly path: string;
        readonly message: string;
      }>;
    };

/** Format a Zod issue path as the dotted/bracketed string used in errors. */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') {
      out += `[${key}]`;
    } else {
      out += out === '' ? String(key) : `.${String(key)}`;
    }
  }
  return out;
}

/**
 * Read and validate `city.yaml` from a pack directory.
 *
 * `packDir` is the directory that holds `city.yaml` (for the slice,
 * `packages/content/packs/core`). A missing file, malformed YAML or a schema
 * violation is returned as a located error rather than thrown, so the engine's
 * generator can surface it the same way it surfaces a content load failure.
 */
export function loadCityData(packDir: string): CityDataResult {
  const file = CITY_FILE;
  const fullPath = join(packDir, file);

  let text: string;
  try {
    text = readFileSync(fullPath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      errors: [
        { file, path: '', message: err instanceof Error ? err.message : String(err) },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    return {
      ok: false,
      errors: [
        { file, path: '', message: err instanceof Error ? err.message : String(err) },
      ],
    };
  }

  const result = CityDataSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => ({
        file,
        path: formatPath(issue.path),
        message: issue.message,
      })),
    };
  }

  return { ok: true, value: result.data };
}

/** Parse already-read `city.yaml` content (for tests and in-memory use). */
export function parseCityData(value: unknown): CityData {
  return CityDataSchema.parse(value);
}
