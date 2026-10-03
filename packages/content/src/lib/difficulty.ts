/**
 * Difficulty Presets.
 *
 * A preset is the concrete knob setting that makes a game easy, standard or
 * hard. Every field in Requirement 34.2 appears here, matching the design's
 * Difficulty Presets table, so the scenario config can pick a preset or
 * override any single field (Requirement 34.1). `scenario.yaml` deep-merges
 * overrides onto a named preset and re-validates against this schema.
 */

import { z } from 'zod';
import {
  ContentIdSchema,
  DayCountSchema,
  ProbabilitySchema,
  RangeSchema,
} from './common.js';

/**
 * The cipher kinds a preset may allow. The columns in the design's table are
 * drawn from this set (easy: the first four; standard: adds `otp`; hard: all).
 */
export const CIPHER_KINDS = [
  'caesar',
  'vigenere',
  'columnar',
  'book',
  'otp',
] as const;
export const CipherKindSchema = z.enum(CIPHER_KINDS);

/** Plot stage count and the deadline slack, in days, the generator works with. */
export const PlotShapeSchema = z
  .object({
    stageCount: z
      .number()
      .int('stageCount must be an integer')
      .positive('stageCount must be positive'),
    deadlineSlackDays: DayCountSchema,
  })
  .strict();

/** The headcounts of the noise stream: Background NPCs, Side Threads, Rumours. */
export const NoiseCountsSchema = z
  .object({
    backgroundNpcs: z.number().int().nonnegative(),
    sideThreads: z.number().int().nonnegative(),
    rumours: z.number().int().nonnegative(),
  })
  .strict();

/**
 * The noise-to-plot traffic ratio, expressed as the two sides of `noise : plot`
 * so the design's "1 : 1", "2 : 1" and "4 : 1" survive as data rather than a
 * lossy float.
 */
export const NoiseTrafficRatioSchema = z
  .object({
    noise: z.number().int().positive(),
    plot: z.number().int().positive(),
  })
  .strict();

/** Hostile Service doctrine ranges: risk tolerance, security and deception. */
export const DoctrineRangesSchema = z
  .object({
    risk: RangeSchema,
    security: RangeSchema,
    deception: RangeSchema,
  })
  .strict();

/** Base detection probabilities for the three observable player activities. */
export const DetectionBaseSchema = z
  .object({
    surveil: ProbabilitySchema,
    meeting: ProbabilitySchema,
    drop: ProbabilitySchema,
  })
  .strict();

/**
 * The arrest gate's threshold and the penalty for a wrongful arrest. The
 * penalty carries both the Standing (authority) cost and whether a wrongful
 * arrest raises Hostile Service alertness, which the hard preset does.
 */
export const ArrestRulesSchema = z
  .object({
    threshold: z
      .number()
      .int('arrest threshold must be an integer')
      .positive('arrest threshold must be positive'),
    wrongfulAuthorityPenalty: z
      .number()
      .int('the wrongful-arrest penalty must be an integer')
      .nonpositive('the wrongful-arrest penalty must be <= 0'),
    wrongfulRaisesAlertness: z.boolean(),
  })
  .strict();

/**
 * A full Difficulty Preset. Named presets (`easy`, `standard`, `hard`) ship in
 * the core pack's `difficulty.yaml`; a scenario may also supply custom values
 * that validate against this same schema.
 */
export const DifficultyPresetSchema = z
  .object({
    id: ContentIdSchema,
    plot: PlotShapeSchema,
    noiseCounts: NoiseCountsSchema,
    noiseTrafficRatio: NoiseTrafficRatioSchema,
    hqFalseBeliefRate: ProbabilitySchema,
    doctrine: DoctrineRangesSchema,
    detectionBase: DetectionBaseSchema,
    madeRevealProbability: ProbabilitySchema,
    tradecraftErrorProbability: ProbabilitySchema,
    allowedCiphers: z
      .array(CipherKindSchema)
      .min(1, 'a preset must allow at least one cipher'),
    arrest: ArrestRulesSchema,
    startingBudget: z
      .number()
      .int('the starting Budget must be an integer')
      .nonnegative('the starting Budget must not be negative'),
    traceRequestDelayPhases: z
      .number()
      .int('the trace-request delay must be an integer number of phases')
      .nonnegative('the trace-request delay must not be negative'),
    coverSuspicionBurnThreshold: ProbabilitySchema,
    hintsDefault: z.boolean(),
  })
  .strict();
export type DifficultyPreset = z.infer<typeof DifficultyPresetSchema>;

/** A `difficulty.yaml` file is a list of named presets. */
export const DifficultyFileSchema = z
  .array(DifficultyPresetSchema)
  .min(1, 'difficulty.yaml must define at least one preset');
