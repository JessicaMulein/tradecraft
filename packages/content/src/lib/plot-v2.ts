/**
 * Template Schema v2 (plot-library).
 *
 * A strict superset of the slice Plot and Side Thread templates. Packs opt in
 * per template with `templateSchema: 2`. Schema-1 templates keep the slice
 * schema and are normalised to this shape by {@link normaliseSchema1Plot}.
 *
 * The slice loader cannot be shadowed through `LoadOptions.kinds` (earlier
 * registrations win), so v2 templates are recognised inside the existing
 * `plots/` and `side-threads/` files and stored beside the slice registries.
 */

import { z } from 'zod';

import {
  ContentIdSchema,
  ContentRefSchema,
  RangeSchema,
  TagIdSchema,
  TagQuerySchema,
} from './common.js';
import { TraceTemplateSchema, type PlotTemplate, type SideThreadTemplate } from './kinds.js';
import type { ContentError } from './pack.js';

export const TEMPLATE_SCHEMA_V2 = 2 as const;

export const PRESET_IDS = ['easy', 'standard', 'hard'] as const;
export const PresetIdSchema = z.enum(PRESET_IDS);
export type PresetId = z.infer<typeof PresetIdSchema>;

const PRESET_RANK: Readonly<Record<PresetId, number>> = {
  easy: 0,
  standard: 1,
  hard: 2,
};

/** True when `preset` is at or above `min`. */
export function presetAtLeast(preset: PresetId, min: PresetId): boolean {
  return PRESET_RANK[preset] >= PRESET_RANK[min];
}

export const PARAM_KINDS = ['npc', 'loc', 'org', 'item'] as const;
export const ParamKindSchema = z.enum(PARAM_KINDS);

export const TemplateParamSchema = z
  .object({
    kind: ParamKindSchema,
    query: TagQuerySchema,
    exclude: z.array(TagIdSchema).default([]),
    group: z.string().min(1).optional(),
    mandatory: z.boolean().default(true),
    fallback: TagQuerySchema.optional(),
  })
  .strict();
export type TemplateParam = z.infer<typeof TemplateParamSchema>;

export const RoleSlotV2Schema = z
  .object({
    query: TagQuerySchema,
    mandatory: z.boolean().default(true),
    shareable: z.boolean().default(false),
  })
  .strict();
export type RoleSlotV2 = z.infer<typeof RoleSlotV2Schema>;

export const BRANCH_CONDITION_KINDS = [
  'belief-adopted',
  'stage-disrupted',
  'participant-status',
  'alertness-at-least',
  'weighted',
  'default',
] as const;

export const BranchConditionSchema = z
  .object({
    kind: z.enum(BRANCH_CONDITION_KINDS),
    negate: z.boolean().optional(),
    value: z.number().optional(),
    weight: z.number().positive().optional(),
    stage: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    pattern: z.string().min(1).optional(),
  })
  .strict();
export type BranchCondition = z.infer<typeof BranchConditionSchema>;

/** A stage reference: a stage id, or `a | b` for sibling alternatives. */
const StageRefSchema = z.string().refine(
  (value) =>
    value
      .split('|')
      .map((part) => part.trim())
      .every((part) => part.length > 0 && ContentRefSchema.safeParse(part).success),
  'a stage reference must be a content id or "a | b" across sibling alternatives',
);

export const DisruptionWeightsSchema = z
  .object({
    delay: z.number().nonnegative(),
    reroute: z.number().nonnegative(),
    abort: z.number().nonnegative(),
  })
  .strict();

export const StageV2Schema = z
  .object({
    id: ContentIdSchema,
    cell: ContentRefSchema.optional(),
    requires: z.array(StageRefSchema).default([]),
    produces: z.array(ContentRefSchema).default([]),
    deadline: RangeSchema.optional(),
    traces: z.array(TraceTemplateSchema).default([]),
    onDisrupted: DisruptionWeightsSchema.optional(),
    optional: z.object({ weight: z.number().positive() }).strict().optional(),
    city: z.string().min(1).optional(),
    fallback: ContentRefSchema.optional(),
    handoff: z
      .object({
        from: ContentRefSchema,
        carrier: z.string().min(1).optional(),
        modes: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type StageV2 = z.infer<typeof StageV2Schema>;

export const AlternativeSchema = z
  .object({
    id: ContentIdSchema,
    weight: z.number().positive().optional(),
    when: z.array(BranchConditionSchema).default([]),
    stages: z.array(StageV2Schema).min(1),
  })
  .strict();
export type Alternative = z.infer<typeof AlternativeSchema>;

export const BranchPointSchema = z
  .object({
    branch: ContentIdSchema,
    resolve: z.enum(['static', 'runtime']),
    after: z.array(ContentRefSchema).default([]),
    alternatives: z.array(AlternativeSchema).min(2),
  })
  .strict();
export type BranchPoint = z.infer<typeof BranchPointSchema>;

export const SubPlotEmbedSchema = z
  .object({
    subplot: z
      .object({
        template: z.string().min(1),
        as: ContentIdSchema,
        map: z.record(
          z.string(),
          z.union([z.string(), z.object({ $any: TagQuerySchema }).strict()]),
        ),
      })
      .strict(),
  })
  .strict();
export type SubPlotEmbed = z.infer<typeof SubPlotEmbedSchema>;

export const StageEntrySchema = z.union([
  StageV2Schema,
  BranchPointSchema,
  SubPlotEmbedSchema,
]);
export type StageEntry = z.infer<typeof StageEntrySchema>;

export function isStageV2(entry: StageEntry): entry is StageV2 {
  return 'id' in entry;
}
export function isBranchPoint(entry: StageEntry): entry is BranchPoint {
  return 'branch' in entry;
}
export function isSubPlotEmbed(entry: StageEntry): entry is SubPlotEmbed {
  return 'subplot' in entry;
}

export const OUTCOME_KINDS = [
  'arrest-role',
  'seize-item',
  'abort',
  'protect-until',
  'identify-role',
  'stage-completed',
  'entity-status',
] as const;

export const OutcomeConditionSchema = z
  .object({
    kind: z.enum(OUTCOME_KINDS),
    role: z.string().min(1).optional(),
    item: z.string().min(1).optional(),
    entity: z.string().min(1).optional(),
    stage: z.string().min(1).optional(),
    until: z.union([z.literal('final-deadline'), z.number()]).optional(),
    status: z.string().min(1).optional(),
  })
  .strict();
export type OutcomeCondition = z.infer<typeof OutcomeConditionSchema>;

export const TWIST_KINDS = ['false-flag', 'facade', 'inside-man'] as const;

export const TwistSchema = z
  .object({
    kind: z.enum(TWIST_KINDS),
    mandatory: z.boolean().default(false),
    facadeStages: z.array(ContentRefSchema).default([]),
    facadeTraceRate: z.number().positive().optional(),
    decoy: z
      .object({
        kind: z.literal('org'),
        query: TagQuerySchema,
      })
      .strict()
      .optional(),
    insideRole: ContentRefSchema.optional(),
    propositions: z
      .array(
        z
          .object({
            predicate: z.string().min(1),
            subject: z.string().min(1),
            object: z.string().min(1),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type TwistDecl = z.infer<typeof TwistSchema>;

export const CellSpecSchema = z
  .object({
    id: ContentIdSchema,
    roles: z.array(ContentRefSchema).min(1),
  })
  .strict();

export const PresetOverrideSchema = z
  .object({
    optionalWeights: z.record(z.string(), z.number().positive()).optional(),
    branchWeights: z.record(z.string(), z.number().positive()).optional(),
    tradecraft: z.number().optional(),
    facadeTraceRate: z.number().positive().optional(),
  })
  .strict();

export const PlotTemplateV2Schema = z
  .object({
    id: ContentIdSchema,
    templateSchema: z.literal(TEMPLATE_SCHEMA_V2),
    kind: z.enum(['plot', 'side-thread']),
    displayName: z.string().min(1),
    archetype: z.string().min(1),
    era: z.object({ from: z.number().int(), to: z.number().int() }).strict(),
    minPreset: PresetIdSchema.default('easy'),
    subOnly: z.boolean().default(false),
    selection: z.object({ weight: z.number().positive() }).strict().default({ weight: 1 }),
    concurrency: z
      .object({
        tags: z.array(z.string().min(1)).default([]),
        allowWith: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .default({ tags: [], allowWith: [] }),
    params: z.record(z.string(), TemplateParamSchema).default({}),
    roleSlots: z.record(z.string(), RoleSlotV2Schema).default({}),
    cells: z.array(CellSpecSchema).default([]),
    cutouts: z
      .array(
        z
          .object({
            role: ContentRefSchema,
            links: z.array(ContentRefSchema).min(2),
          })
          .strict(),
      )
      .default([]),
    materiel: z.string().min(1).optional(),
    stages: z.array(StageEntrySchema).min(1),
    stageCount: z
      .object({
        min: z.number().int().positive(),
        max: z.number().int().positive(),
      })
      .strict(),
    outcomes: z
      .object({
        success: z.array(OutcomeConditionSchema).default([]),
        failure: z.array(OutcomeConditionSchema).default([]),
      })
      .strict()
      .default({ success: [], failure: [] }),
    twist: TwistSchema.optional(),
    difficulty: z
      .object({
        easy: PresetOverrideSchema.optional(),
        standard: PresetOverrideSchema.optional(),
        hard: PresetOverrideSchema.optional(),
      })
      .strict()
      .optional(),
    secondary: z
      .object({
        standingPenalty: z.number().nonnegative(),
        standingReward: z.number().nonnegative(),
        damageReport: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    cityRoles: z.record(z.string(), z.object({ not: z.string().optional() }).strict()).optional(),
    mimics: z.string().min(1).optional(),
    spawn: z.array(z.enum(['worldgen', 'midgame'])).optional(),
    ambient: z
      .object({
        spawn: z
          .object({
            metric: z.string().min(1),
            above: z.number(),
            tags: z.array(z.string()).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    allowedProperNouns: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type PlotTemplateV2 = z.infer<typeof PlotTemplateV2Schema>;

export const PlotItemSchema = z
  .object({
    id: ContentIdSchema,
    pool: z.string().min(1),
    tags: z.array(TagIdSchema).min(1),
    description: z.string().min(1),
  })
  .strict();
export type PlotItem = z.infer<typeof PlotItemSchema>;

export const ProperNounFileSchema = z
  .object({
    nouns: z.array(z.string().min(1)).default([]),
  })
  .strict();

/** True when a raw YAML item declares Template Schema v2. */
export function isTemplateSchemaV2(item: unknown): boolean {
  return (
    typeof item === 'object' &&
    item !== null &&
    (item as { templateSchema?: unknown }).templateSchema === TEMPLATE_SCHEMA_V2
  );
}

const DEFAULT_OUTCOMES = {
  success: [
    { kind: 'arrest-role' as const, role: 'leader' },
    { kind: 'seize-item' as const, item: 'materiel' },
    { kind: 'abort' as const },
  ],
  failure: [{ kind: 'stage-completed' as const, stage: 'final' }],
};

/**
 * Map a slice template onto v2: one Cell, every stage required, no branches,
 * no Sub-Plots, no Twist, and the slice's default outcomes.
 */
export function normaliseSchema1Plot(
  template: PlotTemplate | SideThreadTemplate,
  kind: 'plot' | 'side-thread' = 'plot',
): PlotTemplateV2 {
  const roleIds = template.roleSlots.map((slot) => slot.id);
  const last = template.stages[template.stages.length - 1]?.id ?? 'final';
  return {
    id: template.id,
    templateSchema: 2,
    kind,
    displayName: template.id,
    archetype: 'slice',
    era: { from: 1945, to: 1965 },
    minPreset: 'easy',
    subOnly: false,
    selection: { weight: 1 },
    concurrency: { tags: [], allowWith: [] },
    params: {},
    roleSlots: Object.fromEntries(
      roleIds.map((id) => [id, { query: ['role:cell'], mandatory: true, shareable: false }]),
    ),
    cells: roleIds.length > 0 ? [{ id: 'cell', roles: roleIds }] : [],
    cutouts: [],
    materiel: template.materielSlots[0]?.id,
    stages: template.stages.map((stage) => ({
      id: stage.id,
      requires: stage.requires,
      produces: stage.produces,
      deadline: stage.deadline,
      traces: stage.traces,
      onDisrupted: stage.onDisrupted,
    })),
    stageCount: { min: 1, max: Math.max(1, template.stages.length) },
    outcomes: {
      success: DEFAULT_OUTCOMES.success,
      failure: [{ kind: 'stage-completed', stage: last }],
    },
    allowedProperNouns: [],
  };
}

// ---------------------------------------------------------------------------
// Structural checks
// ---------------------------------------------------------------------------

export interface FlatStage {
  readonly id: string;
  readonly entry: StageV2;
  readonly branch?: string;
  readonly alternative?: string;
}

/** Walk stage entries, including stages nested in alternatives. */
export function flattenStages(entries: readonly StageEntry[]): FlatStage[] {
  const out: FlatStage[] = [];
  for (const entry of entries) {
    if (isStageV2(entry)) {
      out.push({ id: entry.id, entry });
    } else if (isBranchPoint(entry)) {
      for (const alt of entry.alternatives) {
        for (const stage of alt.stages) {
          out.push({
            id: stage.id,
            entry: stage,
            branch: entry.branch,
            alternative: alt.id,
          });
        }
      }
    }
  }
  return out;
}

/** Product of runtime-alternative counts. Static branches do not multiply. */
export function runtimeConfigurationCount(entries: readonly StageEntry[]): number {
  let product = 1;
  for (const entry of entries) {
    if (isBranchPoint(entry) && entry.resolve === 'runtime') {
      product *= entry.alternatives.length;
    }
  }
  return product;
}

interface Edge {
  readonly from: string;
  readonly to: string;
}

function stageEdges(entries: readonly StageEntry[]): Edge[] {
  const edges: Edge[] = [];
  const flat = flattenStages(entries);
  const ids = new Set(flat.map((s) => s.id));
  for (const stage of flat) {
    for (const req of stage.entry.requires) {
      for (const part of req.split('|').map((p) => p.trim())) {
        if (ids.has(part)) {
          edges.push({ from: part, to: stage.id });
        }
      }
    }
  }
  return edges;
}

function hasCycle(ids: readonly string[], edges: readonly Edge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const id of ids) {
    adj.set(id, []);
  }
  for (const edge of edges) {
    adj.get(edge.from)?.push(edge.to);
  }
  const color = new Map<string, 0 | 1 | 2>();
  const visit = (id: string): boolean => {
    const mark = color.get(id) ?? 0;
    if (mark === 1) {
      return true;
    }
    if (mark === 2) {
      return false;
    }
    color.set(id, 1);
    for (const next of adj.get(id) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    color.set(id, 2);
    return false;
  };
  return ids.some((id) => visit(id));
}

/** Words that may be capitalised mid-sentence without being a person name. */
export const COMMON_PROPER_NOUNS: readonly string[] = [
  'I',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'Mr',
  'Mrs',
  'Dr',
  'HQ',
];

const SLOT = /\{[^{}]*\}/g;

/**
 * Capitalised tokens in `text` that are not sentence-initial and are in
 * neither `allowed` nor the common-word allowlist.
 */
export function unexpectedProperNouns(
  text: string,
  allowed: ReadonlySet<string>,
): string[] {
  const stripped = text.replace(SLOT, ' ');
  const found: string[] = [];
  const sentences = stripped.split(/(?<=[.!?])\s+|\n+/);
  for (const sentence of sentences) {
    const tokens = sentence.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
    tokens.forEach((token, index) => {
      const capitalised = token[0] === token[0]?.toUpperCase() && token[0] !== token[0]?.toLowerCase();
      if (!capitalised || index === 0) {
        return;
      }
      if (allowed.has(token) || COMMON_PROPER_NOUNS.includes(token)) {
        return;
      }
      found.push(token);
    });
  }
  return found;
}

/** The slice of the Tag Vocabulary the v2 checks read. */
export interface VocabularyView {
  /** Tag id → the kinds it may appear on. */
  readonly tagAppliesTo: ReadonlyMap<string, ReadonlySet<string>>;
  readonly requiredQueries: readonly { readonly query: readonly string[] }[];
}

export interface PlotCheckInput {
  readonly template: PlotTemplateV2;
  readonly file: string;
  readonly pack: string;
  readonly vocabulary?: VocabularyView;
  readonly templates?: ReadonlyMap<string, PlotTemplateV2>;
  readonly itemTagSets?: readonly (readonly string[])[];
  readonly packNouns?: readonly string[];
}

function err(input: PlotCheckInput, path: string, message: string): ContentError {
  return { pack: input.pack, file: input.file, path, message };
}

function queriesEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((tag, i) => tag === right[i]);
}

function queryIsRequired(query: readonly string[], vocabulary: VocabularyView | undefined): boolean {
  if (vocabulary === undefined) {
    return true;
  }
  return vocabulary.requiredQueries.some((rq) => queriesEqual(rq.query, query));
}

/**
 * Static checks from the design's table. Each failure is a {@link ContentError}
 * naming pack, file and path.
 */
export function checkPlotTemplateV2(input: PlotCheckInput): ContentError[] {
  const errors: ContentError[] = [];
  const { template } = input;
  const push = (path: string, message: string): void => {
    errors.push(err(input, path, message));
  };

  if (template.era.from > template.era.to) {
    push('era', 'era.from must not be after era.to');
  }
  if (template.stageCount.min > template.stageCount.max) {
    push('stageCount', 'stageCount.min must not exceed stageCount.max');
  }

  const flat = flattenStages(template.stages);
  const ids = flat.map((s) => s.id);
  const idSet = new Set<string>();
  for (const id of ids) {
    if (idSet.has(id)) {
      push(`stages.${id}`, `duplicate stage id "${id}"`);
    }
    idSet.add(id);
  }
  if (hasCycle(ids, stageEdges(template.stages))) {
    push('stages', 'the stage graph has a cycle');
  }
  if (runtimeConfigurationCount(template.stages) > 32) {
    push('stages', 'more than 32 runtime branch configurations');
  }

  for (const entry of template.stages) {
    if (!isBranchPoint(entry) || entry.resolve !== 'runtime') {
      continue;
    }
    const last = entry.alternatives[entry.alternatives.length - 1];
    const defaults = entry.alternatives.filter((alt) =>
      alt.when.some((cond) => cond.kind === 'default'),
    );
    if (defaults.length !== 1 || last === undefined || !last.when.some((c) => c.kind === 'default')) {
      push(
        `stages.${entry.branch}`,
        'a runtime branch needs exactly one default alternative, declared last',
      );
    }
  }

  for (const stage of flat) {
    for (const req of stage.entry.requires) {
      if (!req.includes('|')) {
        continue;
      }
      const parts = req.split('|').map((p) => p.trim());
      const owners = parts.map((part) => flat.find((s) => s.id === part));
      if (owners.some((o) => o === undefined)) {
        push(`${stage.id}.requires`, `unresolvable cross-branch reference "${req}"`);
        continue;
      }
      const branch = owners[0]?.branch;
      const same =
        branch !== undefined &&
        owners.every((o) => o?.branch === branch && o?.alternative !== owners[0]?.alternative);
      if (!same) {
        push(`${stage.id}.requires`, `"${req}" must name sibling alternatives of one branch`);
      }
    }
  }

  if (template.kind === 'plot' && !template.subOnly) {
    if (template.cells.length < 1 || template.cells.length > 3) {
      push('cells', 'a plot declares 1–3 cells');
    }
  }
  const cellIds = new Set(template.cells.map((c) => c.id));
  for (const cutout of template.cutouts) {
    for (const link of cutout.links) {
      if (!cellIds.has(link)) {
        push('cutouts', `cutout links unknown cell "${link}"`);
      }
    }
  }

  if (template.twist !== undefined) {
    if (template.twist.propositions.length < 1 && template.twist.kind !== 'inside-man') {
      push('twist.propositions', 'a twist needs at least one twist proposition');
    }
    if (template.twist.kind === 'false-flag' && template.twist.decoy === undefined) {
      push('twist.decoy', 'a false-flag twist needs a decoy organisation');
    }
    if (template.twist.kind === 'facade' && template.twist.facadeStages.length < 1) {
      push('twist.facadeStages', 'a facade twist names its facade stages');
    }
    if (template.twist.kind === 'inside-man' && template.twist.insideRole === undefined) {
      push('twist.insideRole', 'an inside-man twist names the inside role');
    }
  }

  const vocab = input.vocabulary;

  const checkQuery = (path: string, query: readonly string[], kind: string): void => {
    if (vocab === undefined) {
      return;
    }
    if (query.length < 1 || query.length > 3) {
      push(path, 'a tag query has 1–3 tags');
    }
    for (const tag of query) {
      const applies = vocab.tagAppliesTo.get(tag);
      if (applies === undefined) {
        push(path, `tag "${tag}" is not in the vocabulary`);
        continue;
      }
      const kindOk =
        applies.has(kind) ||
        (kind === 'loc' && (applies.has('location') || applies.has('location-type'))) ||
        (kind === 'npc' && applies.has('archetype')) ||
        (kind === 'item' && (applies.has('plot-item') || applies.has('technology')));
      if (!kindOk) {
        push(path, `facet of "${tag}" does not apply to ${kind}`);
      }
    }
  };

  for (const [name, param] of Object.entries(template.params)) {
    checkQuery(`params.${name}.query`, param.query, param.kind);
    if (param.kind !== 'item' && param.mandatory && !queryIsRequired(param.query, vocab)) {
      push(`params.${name}.query`, 'a mandatory parameter query must equal a required query');
    }
    if (!param.mandatory) {
      if (param.fallback === undefined) {
        push(`params.${name}.fallback`, 'a non-mandatory parameter needs a fallback query');
      } else if (!queryIsRequired(param.fallback, vocab)) {
        push(`params.${name}.fallback`, 'the fallback query must equal a required query');
      }
    }
    if (param.kind === 'item' && input.itemTagSets !== undefined) {
      const hit = input.itemTagSets.some((tags) => param.query.every((tag) => tags.includes(tag)));
      if (!hit) {
        push(`params.${name}.query`, 'no plot item binds this query');
      }
    }
  }
  for (const [name, slot] of Object.entries(template.roleSlots)) {
    checkQuery(`roleSlots.${name}.query`, slot.query, 'npc');
    if (slot.mandatory && !queryIsRequired(slot.query, vocab)) {
      push(`roleSlots.${name}.query`, 'a mandatory role query must equal a required query');
    }
  }

  const localCity = template.cityRoles === undefined ? undefined : Object.keys(template.cityRoles)[0];
  for (const stage of flat) {
    for (const trace of stage.entry.traces) {
      if (trace.place !== undefined && 'query' in trace.place) {
        checkQuery(`${stage.id}.traces.place.query`, trace.place.query, 'loc');
      }
    }
  }
  for (const stage of flat) {
    if (stage.entry.city !== undefined && localCity !== undefined && stage.entry.city !== localCity) {
      const referenced = [...template.outcomes.success, ...template.outcomes.failure].some(
        (cond) => cond.stage === stage.id,
      );
      if (referenced && stage.entry.fallback === undefined) {
        push(
          `outcomes`,
          `outcome references off-map stage "${stage.id}" which has no fallback`,
        );
      }
    }
  }

  if (template.twist?.kind === 'facade') {
    const facade = new Set(template.twist.facadeStages);
    for (const cond of template.outcomes.success) {
      if (
        (cond.stage !== undefined && facade.has(cond.stage)) ||
        (cond.role !== undefined && facade.has(cond.role))
      ) {
        push('outcomes.success', 'facade success conditions must reference real elements');
      }
    }
  }

  const allowed = new Set([
    ...(input.packNouns ?? []),
    ...template.allowedProperNouns,
  ]);
  const texts: { path: string; text: string }[] = [{ path: 'displayName', text: template.displayName }];
  for (const stage of flat) {
    stage.entry.traces.forEach((trace, i) => {
      texts.push({ path: `${stage.id}.traces[${i}].text`, text: trace.text });
    });
  }
  for (const text of texts) {
    for (const noun of unexpectedProperNouns(text.text, allowed)) {
      push(text.path, `capitalised token "${noun}" is not an allowed proper noun`);
    }
  }

  if (template.subOnly && template.kind !== 'plot' && template.kind !== 'side-thread') {
    push('subOnly', 'subOnly is only valid on a template');
  }

  const depth = subplotDepth(template, input.templates ?? new Map(), new Set());
  if (depth === 'recursive') {
    push('stages', 'sub-plot embedding is recursive');
  } else if (depth > 2) {
    push('stages', 'sub-plot nesting exceeds depth 2');
  }

  return errors;
}

function subplotDepth(
  template: PlotTemplateV2,
  templates: ReadonlyMap<string, PlotTemplateV2>,
  stack: Set<string>,
): number | 'recursive' {
  if (stack.has(template.id)) {
    return 'recursive';
  }
  const next = new Set(stack);
  next.add(template.id);
  let max = 0;
  for (const entry of template.stages) {
    if (!isSubPlotEmbed(entry)) {
      continue;
    }
    const child = templates.get(entry.subplot.template);
    if (child === undefined) {
      continue;
    }
    const inner = subplotDepth(child, templates, next);
    if (inner === 'recursive') {
      return 'recursive';
    }
    max = Math.max(max, 1 + inner);
  }
  return max;
}
