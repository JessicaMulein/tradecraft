/**
 * Shared primitives used across the content-kind schemas.
 *
 * Every content kind is a plain data shape loaded from YAML and validated here
 * before anything in the engine touches it (Requirements 31.1, 31.2). The
 * schemas in this file are the small building blocks — ids, semver strings,
 * template strings and the handful of closed enums — that the kind schemas in
 * the sibling files reuse so the vocabulary stays consistent across packs.
 */

import { z } from 'zod';

/**
 * A content id as written inside a pack, before the loader namespaces it to
 * `<pack>/<name>`. Lower-case words joined by hyphens keeps ids stable across
 * YAML, cross-references and the hashed Content Manifest.
 */
export const ContentIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'id must be lower-case words separated by single hyphens',
  );

/**
 * A possibly-namespaced reference to another content id, such as a persona pool
 * named by an archetype or a predicate named by a Plot stage. Accepts both the
 * bare `name` form and the `<pack>/<name>` form the loader produces, so a pack
 * may point at content a dependency defined.
 */
export const ContentRefSchema = z
  .string()
  .regex(
    /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)?[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'reference must be a content id, optionally prefixed with "<pack>/"',
  );

/**
 * A semantic version string (`major.minor.patch`). Packs declare their own
 * version here; `requires` ranges are matched against it during load.
 */
export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/, 'version must be semver "major.minor.patch"');

/**
 * A semver range such as `^1.0.0` or `>=1.2.0 <2.0.0`. Kept as a validated
 * string here; the loader is responsible for the actual range satisfaction
 * check (Requirement 31.3).
 */
export const SemverRangeSchema = z
  .string()
  .min(1, 'a dependency range must not be empty');

/**
 * A template string in the content template language: `{slot}`, `{slot.attr}`,
 * `{pick:pool-id}`, `{when}`, `{place}` and `{?slot}…{/slot}`. The schema only
 * guarantees a non-empty string; the template engine (task 2.2) parses the
 * grammar and checks that slots and pools resolve.
 */
export const TemplateStringSchema = z
  .string()
  .min(1, 'a template must not be empty');

/** A non-empty list of template strings used wherever content draws flavour. */
export const TemplatePoolSchema = z
  .array(TemplateStringSchema)
  .min(1, 'a template pool must have at least one entry');

/** The eight phases a day is divided into, used by schedules and crowd curves. */
export const PHASES = [
  'early-morning',
  'morning',
  'midday',
  'afternoon',
  'evening',
  'night',
  'late-night',
  'dead-of-night',
] as const;

export const PhaseSchema = z.enum(PHASES);

/** The seven weekdays, used by schedules, crowd curves and opening hours. */
export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export const WeekdaySchema = z.enum(WEEKDAYS);

/**
 * The allegiances a character may hold. `unknown` covers a Background NPC or
 * Unidentified Subject whose loyalty the player has not established.
 */
export const ALLEGIANCES = [
  'station',
  'hostile',
  'cell',
  'neutral',
  'unknown',
] as const;

export const AllegianceSchema = z.enum(ALLEGIANCES);

/** The MICE recruitment levers. */
export const MICE_LEVERS = ['money', 'ideology', 'coercion', 'ego'] as const;

export const MiceLeverSchema = z.enum(MICE_LEVERS);

/**
 * An inclusive numeric range used throughout content for MICE strengths,
 * wariness, deadline slack and the like. The schema rejects an inverted range
 * so a bad pack fails at load rather than at generation.
 */
export const RangeSchema = z
  .object({
    min: z.number(),
    max: z.number(),
  })
  .strict()
  .refine((r) => r.min <= r.max, {
    message: 'range min must be <= max',
    path: ['min'],
  });

/** A probability in the closed unit interval. */
export const ProbabilitySchema = z
  .number()
  .min(0, 'probability must be >= 0')
  .max(1, 'probability must be <= 1');

/** A non-negative count of in-game days. */
export const DayCountSchema = z
  .number()
  .int('a day count must be a whole number')
  .nonnegative('a day count must not be negative');

// --- period, tags and aliases ----------------------------------------------

/**
 * An inclusive year range, `{ from, to }` with `from <= to` (design,
 * `YearRange`). Year-ranged content (Locations, Routes, Newspapers, culture
 * weights, …) carries one so the generator can filter by Effective Year Range.
 * Both bounds are whole calendar years.
 */
export const YearRangeSchema = z
  .object({
    from: z.number().int('a year must be a whole number'),
    to: z.number().int('a year must be a whole number'),
  })
  .strict()
  .refine((r) => r.from <= r.to, {
    message: 'year range from must be <= to',
    path: ['from'],
  });
export type YearRange = z.infer<typeof YearRangeSchema>;

/**
 * An ISO calendar date `YYYY-MM-DD` (design, `IsoDate`). Used for a city's
 * `startDates` window and the drawn Start Date. The schema fixes the grammar
 * and rejects an impossible month or day; it does not range-check against a
 * particular era (the config resolver, task 3.1, does that).
 */
export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO "YYYY-MM-DD"')
  .refine((s) => {
    const [y, m, d] = s.split('-').map((p) => Number.parseInt(p, 10));
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    );
  }, 'date must be a real calendar date');
export type IsoDate = z.infer<typeof IsoDateSchema>;

/**
 * A Tag id, `facet:value` (design, `TagId = \`${string}:${string}\``). A Tag's
 * facet is the part before the colon; Tag Conformance checks that a Tag is
 * drawn from the vocabulary and that its facet applies to the kind it is used
 * on (tasks 1.3, 2.3). Here only the `facet:value` grammar is enforced, each
 * part being lower-case words joined by hyphens.
 */
export const TagIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'a tag must be "facet:value", each part lower-case words separated by hyphens',
  );

/**
 * A Tag Query: 1–3 Tags an entity must all carry to match (design,
 * `TagQuery = TagId[]` of length 1..3). A Required Query, a Newspaper's
 * `soldAt`, an org's `members` and an archetype schedule's `at` are all Tag
 * Queries. The length bound is the design's; the semantics (conjunction over
 * Effective Tags) are the generator's.
 */
export const TagQuerySchema = z
  .array(TagIdSchema)
  .min(1, 'a tag query needs at least one tag')
  .max(3, 'a tag query may name at most three tags');

/**
 * An alias an entity can be referred to by in prose and documents (the slice
 * `Alias`). `text` is the phrase; `distinctive` marks an alias specific enough
 * that the Leak Guard treats a bare mention of it as naming the entity (so
 * "pier" is not distinctive but "The Pier" is). City Districts and local orgs
 * carry authored aliases the generator maps straight onto their entities.
 */
export const AliasSchema = z
  .object({
    text: z.string().min(1, 'alias text must not be blank'),
    distinctive: z.boolean(),
  })
  .strict();
export type Alias = z.infer<typeof AliasSchema>;
