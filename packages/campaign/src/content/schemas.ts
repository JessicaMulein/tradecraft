/**
 * Campaign content kinds (campaign-career Req 22.1, 22.4).
 *
 * The schemas live in this package and are registered through the content
 * loader's `LoadOptions.kinds`. The content package does not import them.
 * Services are not a campaign kind: a city names content-expansion Service
 * Definition ids.
 */

import {
  CipherKindSchema,
  ContentIdSchema,
  ContentRefSchema,
  SideThreadTemplateSchema,
} from '@tradecraft/content';
import { z } from 'zod';

export const RANKS = [
  'case-officer',
  'senior-case-officer',
  'deputy-chief',
  'chief-of-station',
  'controller',
] as const;
export const RankIdSchema = z.enum(RANKS);
export type RankId = z.infer<typeof RankIdSchema>;

export const MODIFIER_OPS = ['add', 'mul'] as const;

/** A numeric preset or recruitment-weight effect, clamped to `bounds`. */
export const ModifierEffectSchema = z
  .object({
    path: z.string().min(1),
    op: z.enum(MODIFIER_OPS),
    perLevel: z.number(),
    bounds: z.tuple([z.number(), z.number()]).refine(([lo, hi]) => lo <= hi, {
      message: 'bounds must be ordered',
    }),
  })
  .strict();
export type ModifierEffect = z.infer<typeof ModifierEffectSchema>;

const LevelSchema = z.number().int().min(0).max(5);

export const BackgroundSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1),
    text: z.string().min(1),
    rank: RankIdSchema,
    skills: z.record(z.string(), LevelSchema).default({}),
    languages: z.array(z.string().min(1)).default([]),
    traits: z.array(ContentRefSchema).default([]),
    factions: z.record(z.string(), z.number()).default({}),
  })
  .strict();
export type Background = z.infer<typeof BackgroundSchema>;

export const RankRowSchema = z
  .object({
    id: RankIdSchema,
    budgetScale: z.number().positive(),
    arrestAuthority: z.number().int().nonnegative(),
    stationStaff: z.number().int().positive(),
    trainingCap: LevelSchema,
    promoteAt: z.number().optional(),
    demoteBelow: z.number(),
  })
  .strict();
export type RankRow = z.infer<typeof RankRowSchema>;

const XpThresholdsSchema = z.tuple([
  z.number().nonnegative(),
  z.number().nonnegative(),
  z.number().nonnegative(),
  z.number().nonnegative(),
  z.number().nonnegative(),
]);

export const SkillSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1),
    language: z.boolean().default(false),
    xp: z
      .object({
        from: z.array(z.string().min(1)).min(1),
        perLevel: XpThresholdsSchema,
      })
      .strict(),
    effects: z.array(ModifierEffectSchema).default([]),
  })
  .strict();
export type Skill = z.infer<typeof SkillSchema>;

export const TRAIT_TRIGGER_KINDS = [
  'burned',
  'asset-arrested',
  'captured',
  'stress-at-least',
] as const;

export const TraitTriggerSchema = z
  .object({
    kind: z.enum(TRAIT_TRIGGER_KINDS),
    action: z.enum(['add', 'remove']),
    trait: ContentRefSchema.optional(),
    at: z.number().optional(),
  })
  .strict();

export const TraitSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1),
    triggers: z.array(TraitTriggerSchema).default([]),
    effects: z.array(ModifierEffectSchema).default([]),
  })
  .strict();
export type Trait = z.infer<typeof TraitSchema>;

export const FactionSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();
export type Faction = z.infer<typeof FactionSchema>;

export const HQ_ACCESS = ['cables', 'directives', 'personnel', 'legends'] as const;

export const HqCastTemplateSchema = z
  .object({
    id: ContentIdSchema,
    name: z.string().min(1),
    role: z.string().min(1),
    faction: ContentRefSchema,
    access: z.array(z.enum(HQ_ACCESS)).min(1),
  })
  .strict();
export type HqCastTemplate = z.infer<typeof HqCastTemplateSchema>;

export const RequisitionEffectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('budget-credit'), amount: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('extra-player-drop') }).strict(),
  z.object({ kind: z.literal('trace-priority') }).strict(),
  z.object({ kind: z.literal('cipher-aid') }).strict(),
  z.object({ kind: z.literal('prepared-legend') }).strict(),
  z
    .object({ kind: z.literal('language-crash-course'), skill: ContentRefSchema })
    .strict(),
]);

export const RequisitionSchema = z
  .object({
    id: ContentIdSchema,
    cost: z.number().int().nonnegative(),
    effect: RequisitionEffectSchema,
  })
  .strict();
export type Requisition = z.infer<typeof RequisitionSchema>;

export const ExfiltrationBenefitSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('extra-lead') }).strict(),
  z
    .object({
      kind: z.literal('language'),
      language: z.string().min(1),
      levels: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('faction'),
      faction: ContentRefSchema,
      amount: z.number(),
    })
    .strict(),
]);

export const ExfiltrationSchema = z
  .object({
    id: ContentIdSchema,
    archetype: ContentRefSchema,
    cost: z.number().int().nonnegative(),
    benefit: ExfiltrationBenefitSchema,
  })
  .strict();
export type Exfiltration = z.infer<typeof ExfiltrationSchema>;

const PERSON_STATUSES = ['at-large', 'arrested', 'turned', 'dead'] as const;

export const ARC_CONDITION_KINDS = [
  'posting-index-at-least',
  'year-between',
  'service-is',
  'stage-done',
  'clue-held',
  'clue-present',
  'rank-at-least',
  'notoriety-at-least',
  'person-status',
] as const;

export const ArcConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('posting-index-at-least'), n: z.number().int().nonnegative() }).strict(),
  z
    .object({
      kind: z.literal('year-between'),
      from: z.number().int(),
      to: z.number().int(),
    })
    .strict()
    .refine((span) => span.from <= span.to, { message: 'year span must be ordered' }),
  z.object({ kind: z.literal('service-is'), slot: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('stage-done'), stage: ContentIdSchema }).strict(),
  z.object({ kind: z.literal('clue-held'), clue: ContentIdSchema }).strict(),
  z.object({ kind: z.literal('clue-present'), clue: ContentIdSchema }).strict(),
  z.object({ kind: z.literal('rank-at-least'), rank: RankIdSchema }).strict(),
  z
    .object({ kind: z.literal('notoriety-at-least'), value: z.number().min(0).max(1) })
    .strict(),
  z
    .object({
      kind: z.literal('person-status'),
      slot: z.string().min(1),
      in: z.array(z.enum(PERSON_STATUSES)).min(1),
    })
    .strict(),
]);
export type ArcCondition = z.infer<typeof ArcConditionSchema>;

export const ArcBindSchema = z
  .object({
    from: z.enum(['carried-hostile', 'hq-cast']),
    else: z.literal('generate').optional(),
    archetype: ContentRefSchema.optional(),
  })
  .strict();

export const ArcStageSchema = z
  .object({
    id: ContentIdSchema,
    when: z.array(ArcConditionSchema).default([]),
    thread: ContentRefSchema,
    advance: z.array(ArcConditionSchema).default([]),
    allowsPitch: z.boolean().default(false),
  })
  .strict();

export const ArcTemplateSchema = z
  .object({
    id: ContentIdSchema,
    priority: z.number().int(),
    binds: z.record(z.string(), ArcBindSchema).default({}),
    stages: z.array(ArcStageSchema).min(1),
    traits: z.array(ContentRefSchema).default([]),
    resolve: z.array(ArcConditionSchema).default([]),
  })
  .strict();
export type ArcTemplate = z.infer<typeof ArcTemplateSchema>;

export const ArcClueSchema = z
  .object({
    id: ContentIdSchema,
    prop: z.string().min(1),
  })
  .strict();

export const ArcSlotSchema = z
  .object({
    id: ContentIdSchema,
    binding: z.string().min(1),
  })
  .strict();

/** A Side Thread plus the clues and arc-binding slots a campaign thread carries. */
export const ArcThreadTemplateSchema = SideThreadTemplateSchema.extend({
  clues: z.array(ArcClueSchema).default([]),
  slots: z.array(ArcSlotSchema).default([]),
}).strict();
export type ArcThreadTemplate = z.infer<typeof ArcThreadTemplateSchema>;

const YearSpanSchema = z
  .tuple([z.number().int(), z.number().int()])
  .refine(([from, to]) => from <= to, { message: 'epoch years must be ordered' });

const TensionSpanSchema = z
  .tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
  .refine(([lo, hi]) => lo <= hi, { message: 'tension range must be ordered' });

export const EpochSchema = z
  .object({
    id: ContentIdSchema,
    years: YearSpanSchema,
    ciphers: z.array(CipherKindSchema).min(1),
    flags: z.array(z.string().min(1)).default([]),
    tension: TensionSpanSchema,
    events: z.array(ContentRefSchema).default([]),
  })
  .strict();
export type Epoch = z.infer<typeof EpochSchema>;

export const ReviewWeightsSchema = z
  .object({
    id: ContentIdSchema,
    outcome: z
      .object({
        success: z.number(),
        'failure-plot': z.number(),
        'failure-burned': z.number(),
      })
      .strict(),
    standing: z.number(),
    directiveMet: z.number(),
    directiveFailed: z.number(),
    wrongful: z.number(),
    assetLost: z.number(),
    faction: z.number(),
  })
  .strict();
export type ReviewWeights = z.infer<typeof ReviewWeightsSchema>;

export const CAMPAIGN_TEXT_USES = [
  'review',
  'capture',
  'accusation',
  'personal-file',
  'background-event',
] as const;

export const CampaignTextSchema = z
  .object({
    id: ContentIdSchema,
    use: z.enum(CAMPAIGN_TEXT_USES),
    title: z.string().min(1),
    body: z.string().min(1),
  })
  .strict();
export type CampaignText = z.infer<typeof CampaignTextSchema>;
