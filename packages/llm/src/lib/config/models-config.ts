/**
 * The `models.yaml` schema (Requirements 14.1, 14.2, 41.2).
 *
 * `models.yaml` maps each Model Role to a model id and the per-role sampling
 * and timeout settings the Gateway uses when it calls LM Studio's
 * OpenAI-compatible endpoint. A file holds one `endpoint`, a set of named
 * profiles — a profile is a complete role → settings mapping, so a developer
 * can swap a whole model line-up without touching code — and the `active`
 * profile the game runs. Every role must be present in every profile, including
 * the `narrator` role, which the default config points at the same model as
 * `fast` so no third model has to be resident (design "Model Configuration").
 *
 * A file also carries a `contextLength` — the token context every model loads
 * at — and a `models` map from each Load Identifier to its reasoning family and
 * its Model Sources (an MLX-preferred, GGUF-fallback download pair). A Load
 * Identifier is the stable name a model is loaded under and the model string
 * the Gateway sends; it is distinct from a Model Source, which is the specific
 * build to download. Each role's `model` names an entry in `models`.
 *
 * This module owns only the shape. The loader in `./load-models-config.ts`
 * reads and validates the file and reports each issue with its field path, and
 * the Gateway's startup check compares these model ids against the endpoint's
 * list.
 */

import { z } from 'zod';

/** The five Model Roles the Gateway routes calls to. */
export const MODEL_ROLES = [
  'voice',
  'fast',
  'narrator',
  'bookkeeping',
  'judge',
] as const;

export type Role = (typeof MODEL_ROLES)[number];

/** The reasoning modes a role may request from its model. */
export const REASONING_MODES = ['off', 'low', 'on'] as const;

export const ReasoningModeSchema = z.enum(REASONING_MODES);

export type ReasoningMode = (typeof REASONING_MODES)[number];

/**
 * The reasoning-control family a model belongs to. The Gateway chooses its
 * reasoning adapter from this family rather than by substring-matching the Load
 * Identifier, because a Load Identifier such as `qwen-moe` no longer contains
 * the family name. An unknown family keeps the Gateway's "no control" warning,
 * so the field is a free string rather than an enum (Req 21.4, 21.9).
 */
export const ModelFamilySchema = z
  .string()
  .min(1, 'a model must name a non-empty family');

/** The download format of a Model Source: MLX preferred, GGUF fallback. */
export const SOURCE_FORMATS = ['mlx', 'gguf'] as const;

export const SourceFormatSchema = z.enum(SOURCE_FORMATS);

export type SourceFormat = (typeof SOURCE_FORMATS)[number];

/**
 * One Model Source: a downloadable build of a model. `get` is the argument to
 * `lms get`; `key` is the `modelKey` the SDK lists once the build is
 * downloaded, and is what the load path passes to `loadModel`. A Model Source
 * is distinct from a Load Identifier: the Load Identifier is the stable name a
 * model is loaded under (and the model string the Gateway sends), while the
 * Source is the specific build to download (Req 21.6).
 */
export const ModelSourceSchema = z
  .object({
    format: SourceFormatSchema,
    get: z.string().min(1, 'a source must name a non-empty `lms get` argument'),
    key: z.string().min(1, 'a source must name a non-empty model key'),
  })
  .strict();

export type ModelSource = z.infer<typeof ModelSourceSchema>;

/**
 * A model entry keyed by its Load Identifier: the reasoning `family` and the
 * two Model Sources, MLX first then GGUF. The two-element tuple fixes the
 * preference order so source resolution can prefer the MLX build when it is
 * downloaded and fall back to GGUF otherwise (Req 21.6, 21.7).
 */
export const ModelEntrySchema = z
  .object({
    family: ModelFamilySchema,
    sources: z.tuple([ModelSourceSchema, ModelSourceSchema], {
      message: 'sources must be an [mlx, gguf] pair',
    }),
  })
  .strict();

export type ModelEntry = z.infer<typeof ModelEntrySchema>;

/**
 * A Load Identifier: the stable name a model is loaded under in LM Studio, and
 * the model string the Gateway sends to the endpoint. It keys the `models` map
 * and is what each role's `model` field names (Req 21.5).
 */
export const LOAD_IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const LoadIdentifierSchema = z
  .string()
  .regex(
    LOAD_IDENTIFIER_PATTERN,
    'a Load Identifier must match ^[a-z0-9][a-z0-9-]*$',
  );

/**
 * One role's model and call settings. `model` is a Load Identifier: it names an
 * entry in the config's `models` map, and is also the model string the Gateway
 * sends to the endpoint. `temperature` is bounded to the usual OpenAI 0–2
 * range; `maxTokens` and `timeoutMs` are positive integers.
 */
export const RoleConfigSchema = z
  .object({
    model: z.string().min(1, 'a role must name a non-empty Load Identifier'),
    temperature: z
      .number()
      .min(0, 'temperature must be >= 0')
      .max(2, 'temperature must be <= 2'),
    maxTokens: z
      .number()
      .int('maxTokens must be a whole number')
      .positive('maxTokens must be positive'),
    timeoutMs: z
      .number()
      .int('timeoutMs must be a whole number')
      .positive('timeoutMs must be positive'),
    reasoning: ReasoningModeSchema,
  })
  .strict();

export type RoleConfig = z.infer<typeof RoleConfigSchema>;

/**
 * A profile: every Model Role mapped to its `RoleConfig`. `narrator` is a role
 * of its own so it can be remapped in config without code, even though the
 * default points it at the `fast` model (Requirement 14.6).
 */
export const ProfileSchema = z
  .object({
    voice: RoleConfigSchema,
    fast: RoleConfigSchema,
    narrator: RoleConfigSchema,
    bookkeeping: RoleConfigSchema,
    judge: RoleConfigSchema,
  })
  .strict();

export type Profile = z.infer<typeof ProfileSchema>;

/**
 * The whole `models.yaml`: the OpenAI-compatible endpoint, the Context Length
 * every model loads at, the `models` map from Load Identifier to its family and
 * Model Sources, the named profiles, and the active profile the game runs.
 *
 * `contextLength` is the token context models load at — it sizes the KV cache
 * and is read by the Model Manager at load and preflight time (Req 22.1, 22.2).
 * `models` maps each Load Identifier to its reasoning family and its MLX/GGUF
 * Model Sources (Req 21.6).
 *
 * Two refinements:
 *   - `active` must name a defined profile, reported on the `active` field.
 *   - every role's `model` must be a key of `models`, reported at
 *     `profiles.<p>.<role>.model` (Req 21.9).
 * Both report their field path so the loader can print it (Req 41.2).
 */
export const ModelsConfigSchema = z
  .object({
    endpoint: z.url('endpoint must be a valid URL'),
    contextLength: z
      .number()
      .int('contextLength must be a whole number')
      .positive('contextLength must be positive'),
    models: z
      .record(LoadIdentifierSchema, ModelEntrySchema)
      .refine((m) => Object.keys(m).length > 0, {
        message: 'at least one model must be defined',
      }),
    profiles: z
      .record(z.string(), ProfileSchema)
      .refine((p) => Object.keys(p).length > 0, {
        message: 'at least one profile must be defined',
      }),
    active: z.string().min(1, 'active must name a profile'),
  })
  .strict()
  .refine((c) => Object.hasOwn(c.profiles, c.active), {
    path: ['active'],
    message: 'active must name a defined profile',
  })
  .superRefine((c, ctx) => {
    for (const [profileName, profile] of Object.entries(c.profiles)) {
      for (const role of MODEL_ROLES) {
        const loadId = profile[role].model;
        if (!Object.hasOwn(c.models, loadId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['profiles', profileName, role, 'model'],
            message: `${loadId} is not a defined model`,
          });
        }
      }
    }
  });

export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
