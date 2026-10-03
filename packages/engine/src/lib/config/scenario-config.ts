/**
 * The `scenario.yaml` schema (Requirements 34.1, 41.1).
 *
 * `scenario.yaml` is the one file a player edits to shape a run: which
 * difficulty preset to start from (and any field-level overrides on top of it),
 * whether the internal mole is in play, which Content Packs to load, how the
 * Narrator behaves, whether hints are on, and the starting weights for the
 * recruitment, pressure and exposure maths. Every tuning knob the design's
 * Difficulty Presets table leaves to the scenario lives here, so a scenario can
 * select a named preset or override any single field without touching code
 * (Requirement 34.1).
 *
 * This module owns only the shape. The loader in `./load-scenario-config.ts`
 * reads and validates the file, then resolves the difficulty: it takes the
 * named preset from the Content Set, deep-merges `difficulty.overrides` on top,
 * and re-validates the merged result against the content package's
 * `DifficultyPresetSchema`. Each problem is reported with its file and field
 * path (Requirements 41.1, 41.2, 41.3).
 */

import { DifficultyPresetSchema } from '@tradecraft/content';
import { z } from 'zod';

/**
 * A fixed-key weight bag: an object whose named keys all map to numbers and
 * nothing else. The recruitment, pressure and exposure formulae each take a
 * small, named set of coefficients, so spelling the keys out keeps a typo in
 * `scenario.yaml` (a stray or missing weight) a load-time field error rather
 * than a silently-ignored value.
 */
function weights<const Keys extends readonly string[]>(
  keys: Keys,
): z.ZodObject<Record<Keys[number], z.ZodNumber>> {
  const shape = Object.fromEntries(
    keys.map((k) => [k, z.number()]),
  ) as Record<Keys[number], z.ZodNumber>;
  return z.object(shape).strict();
}

/**
 * A deep-partial of the Difficulty Preset schema, used for `difficulty.overrides`.
 *
 * The design writes this as `DifficultyPreset.deepPartial()`. Zod 4 dropped the
 * `deepPartial` helper, so this walks the preset schema and makes every field —
 * at every level of nesting — optional, which is exactly what an override block
 * needs: name only the fields you want to change. The walk preserves each
 * leaf's own validation (a probability still has to be in `[0, 1]`), so an
 * override is checked field-by-field even before it is merged onto the base
 * preset and re-validated.
 */
function deepPartial(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const nextShape = Object.fromEntries(
      Object.entries(shape).map(([key, value]) => [
        key,
        deepPartial(value).optional(),
      ]),
    );
    // Keep the object strict so an unknown override field is still rejected.
    // A `.refine`d object (such as the content package's RangeSchema) is still
    // a ZodObject in Zod 4, so its cross-field check is dropped here — a
    // partial override may legitimately omit one side of a pair. That is sound
    // because the merged result is re-validated against the full preset schema,
    // which re-applies every refinement.
    return z.object(nextShape).strict();
  }

  if (schema instanceof z.ZodArray) {
    // Arrays are replaced wholesale in an override, not merged element-wise, so
    // the element schema keeps its own rules; only the array itself is optional
    // (handled by the caller wrapping it in `.optional()`).
    return schema;
  }

  if (schema instanceof z.ZodOptional) {
    return deepPartial(schema.unwrap() as z.ZodTypeAny);
  }
  if (schema instanceof z.ZodNullable) {
    return deepPartial(schema.unwrap() as z.ZodTypeAny).nullable();
  }

  // A plain leaf (number, string, boolean, enum): keep its own validation.
  return schema;
}

/** The deep-partial preset used for `difficulty.overrides`. */
export const DifficultyOverridesSchema = deepPartial(
  DifficultyPresetSchema,
) as z.ZodTypeAny;

/**
 * The difficulty selection: a named preset plus optional field overrides. The
 * loader resolves this by deep-merging `overrides` onto the named preset and
 * re-validating against `DifficultyPresetSchema`.
 */
export const DifficultySelectionSchema = z
  .object({
    preset: z.string().min(1, 'difficulty.preset must name a preset'),
    overrides: DifficultyOverridesSchema.default({}),
  })
  .strict();

/** Which Content Packs to load, and from where. */
export const PacksConfigSchema = z
  .object({
    dirs: z.array(z.string()).default(['packages/content/packs/core']),
    load: z
      .array(z.string())
      .min(1, 'packs.load must name at least one pack')
      .default(['core']),
  })
  .strict();

/**
 * The setting selection (content-expansion Req 9.1): which city the game is
 * placed in, and optionally the Start Date mapped to game day 0.
 *
 * This module owns only the shape. `city` is a bare string here — `'core'` for
 * the Core City or a loaded City id — because the schema cannot know which
 * cities a given Content Set loads. After validation, the config resolver in
 * `./load-scenario-config.ts` checks that `city` is `core` or a loaded City
 * Definition and that `startDate` (if given) lies within the city's
 * `startDates` window and the era's Period Window, reporting each failure as a
 * field error on `setting.city` or `setting.startDate` (slice Req 41.2).
 *
 * `startDate` is a strict `YYYY-MM-DD` string. The whole block defaults to
 * `{ city: 'core' }`, so a scenario that names no setting places the game in
 * the Core City and the default `config/scenario.yaml` stays valid.
 */
export const SettingConfigSchema = z
  .object({
    city: z.string().default('core'),
    startDate: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}$/,
        'setting.startDate must be an ISO date (YYYY-MM-DD)',
      )
      .optional(),
  })
  .strict()
  // Default to the Core City. Zod applies a `.default()` value verbatim when
  // the key is absent (it does not re-run the inner field defaults), so the
  // default spells out `city: 'core'` rather than relying on the inner
  // `city.default('core')` — that inner default still fills a `setting: {}`
  // block written explicitly in the file.
  .default({ city: 'core' });

/** The three narration modes the Narrator supports. */
export const NARRATION_MODES = ['full', 'brief', 'off'] as const;
export const NarrationModeSchema = z.enum(NARRATION_MODES);
export type NarrationMode = (typeof NARRATION_MODES)[number];

/**
 * The starting weights for the recruitment, pressure and exposure formulae.
 * Each sub-bag's keys match the coefficient names the design's maths uses, so a
 * scenario tunes the balance without a code change.
 */
export const RecruitmentWeightsSchema = z
  .object({
    pitch: weights(['w1', 'w2', 'w3', 'w4']),
    firstContact: weights(['a', 'b', 'c', 'd']),
    meeting: weights([
      'trust',
      'riskAversion',
      'scheduleConflict',
      'agendaInterest',
    ]),
    exposure: weights(['k1', 'k2', 'k3']),
    turn: weights(['w1', 'w2', 'w3', 'w4', 'w5']),
  })
  .strict();

/** The per-stage retry limits for the model-facing guards. */
export const RetriesConfigSchema = z
  .object({
    leakGuard: z.number().int().min(0).max(5).default(2),
    narrator: z.number().int().min(0).max(2).default(1),
    refusal: z.number().int().min(0).max(2).default(1),
    extraction: z.number().int().min(0).max(2).default(1),
    timeout: z.number().int().min(0).max(2).default(1),
  })
  .strict();

/** Where play metrics are written, and whether they are collected at all. */
export const MetricsConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    path: z.string().default('logs/metrics.jsonl'),
  })
  .strict();

/**
 * The whole validated `scenario.yaml`. Mirrors the design's `ScenarioConfig`
 * schema. `hints` is left optional so an unset value falls back to the resolved
 * preset's `hintsDefault`; every other knob has a default so a minimal scenario
 * file still produces a complete config. The difficulty here is the *selection*
 * (preset name plus overrides); the loader produces the *resolved*
 * `DifficultyPreset` separately.
 */
export const ScenarioConfigSchema = z
  .object({
    difficulty: DifficultySelectionSchema,
    setting: SettingConfigSchema,
    mole: z.boolean().default(false),
    packs: PacksConfigSchema.default({
      dirs: ['packages/content/packs/core'],
      load: ['core'],
    }),
    narration: NarrationModeSchema.default('full'),
    hints: z.boolean().optional(), // unset: preset default
    recruitment: RecruitmentWeightsSchema,
    retries: RetriesConfigSchema.default({
      leakGuard: 2,
      narrator: 1,
      refusal: 1,
      extraction: 1,
      timeout: 1,
    }),
    tokenBudget: z.number().int().min(1000).default(3000),
    custodyPhases: z.number().int().min(1).default(4),
    silenceDays: z.number().int().min(1).default(3),
    interceptRetentionDays: z.number().int().min(1).default(2),
    metrics: MetricsConfigSchema.default({
      enabled: true,
      path: 'logs/metrics.jsonl',
    }),
  })
  .strict();

/** The validated scenario config, before difficulty resolution. */
export type ScenarioConfig = z.infer<typeof ScenarioConfigSchema>;
