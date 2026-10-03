/**
 * Cue Map validation (design, "Cue Map and Cue Manifest"; Requirement 15;
 * Property 12). The YAML is parsed by the launcher and handed over as plain
 * data; this module validates it with Zod and checks the cross-references.
 */

import { z } from 'zod';

import { validatePredicate } from '../../shared/cue/predicate.js';
import type { CueDef, CueMap, Predicate, Rule, TakeMeta } from '../../shared/cue/types.js';

const Transition = z.union([
  z.strictObject({
    type: z.literal('crossfade'),
    seconds: z.number().min(0).max(30),
    boundary: z.enum(['phrase', 'immediate']).optional(),
  }),
  z.strictObject({ type: z.literal('cut') }),
  z.strictObject({ type: z.literal('after-stinger') }),
]);

const Slice = z.strictObject({
  section: z.string().min(1).optional(),
  start: z.number().min(0).optional(),
  end: z.number().min(0).optional(),
});

const CueDefSchema = z.strictObject({
  kind: z.enum(['music', 'stinger', 'ambience']).default('music'),
  file: z.string().min(1).optional(),
  from: z.string().min(1).optional(),
  take: z.number().int().min(1).optional(),
  slice: Slice.optional(),
  loop: z.union([z.literal('none'), z.strictObject({ section: z.string().min(1) })]).optional(),
  duck: z.boolean().optional(),
  fadeOut: z.number().min(0).max(60).optional(),
  gain: z.number().min(0).max(2).optional(),
});

const RuleSchema = z.strictObject({
  name: z.string().optional(),
  when: z.unknown(),
  music: z.string().min(1).optional(),
  stinger: z.string().min(1).optional(),
  ambience: z.string().min(1).optional(),
  transition: Transition.optional(),
  duck: z.boolean().optional(),
  holdSeconds: z.number().min(0).max(600).optional(),
});

const CueMapSchema = z.strictObject({
  version: z.literal(1),
  cues: z.record(z.string().min(1), CueDefSchema),
  rules: z.array(RuleSchema).min(1),
});

export class CueMapError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(issues.join('\n'));
    this.name = 'CueMapError';
    this.issues = issues;
  }
}

/** Validate a parsed Cue Map document. Throws {@link CueMapError} with every issue. */
export function parseCueMap(raw: unknown): CueMap {
  const parsed = CueMapSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CueMapError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const { cues, rules, version } = parsed.data;
  const issues: string[] = [];

  for (const [id, def] of Object.entries(cues)) {
    if (def.file === undefined && def.from === undefined) {
      issues.push(`cues.${id}: needs \`file\` or \`from\``);
    }
    if (def.file !== undefined && def.from !== undefined) {
      issues.push(`cues.${id}: \`file\` and \`from\` are exclusive`);
    }
    if (def.from !== undefined) {
      if (cues[def.from] === undefined) {
        issues.push(`cues.${id}.from: unknown cue \`${def.from}\``);
      }
      if (def.slice === undefined) {
        issues.push(`cues.${id}: a Derived Cue needs a \`slice\``);
      }
      if (cues[def.from]?.from !== undefined) {
        issues.push(`cues.${id}.from: a Derived Cue stays within one Take of a recorded cue`);
      }
    }
    if (def.slice !== undefined && def.from === undefined) {
      issues.push(`cues.${id}.slice: only a Derived Cue has a slice`);
    }
  }

  rules.forEach((rule, i) => {
    const at = `rules[${i}]`;
    issues.push(...validatePredicate(rule.when, `${at}.when`));
    if (rule.music === undefined && rule.stinger === undefined && rule.ambience === undefined) {
      issues.push(`${at}: names no music, stinger or ambience`);
    }
    if (rule.music !== undefined && rule.music !== 'silence' && cues[rule.music] === undefined) {
      issues.push(`${at}.music: unknown cue \`${rule.music}\``);
    }
    if (rule.stinger !== undefined && cues[rule.stinger] === undefined) {
      issues.push(`${at}.stinger: unknown cue \`${rule.stinger}\``);
    }
    if (rule.ambience !== undefined && rule.ambience !== 'off' && cues[rule.ambience] === undefined) {
      issues.push(`${at}.ambience: unknown cue \`${rule.ambience}\``);
    }
  });

  if (issues.length > 0) {
    throw new CueMapError(issues);
  }

  const outCues: Record<string, CueDef> = {};
  for (const [id, def] of Object.entries(cues)) {
    outCues[id] = stripUndefined(def) as CueDef;
  }
  const outRules: Rule[] = rules.map((r) => stripUndefined({ ...r, when: r.when as Predicate }) as Rule);
  return { version, cues: outCues, rules: outRules };
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

// ---------------------------------------------------------------------------
// take-meta.yaml
// ---------------------------------------------------------------------------

const TakeMetaSchema = z.strictObject({
  bpm: z.number().positive().optional(),
  beatsPerPhrase: z.number().int().positive().optional(),
  firstBeatOffset: z.number().min(0).optional(),
  loopStart: z.number().min(0).optional(),
  loopEnd: z.number().min(0).optional(),
  sections: z.record(z.string(), z.tuple([z.number().min(0), z.number().min(0)])).optional(),
});

const TakeMetaFileSchema = z.record(z.string(), z.record(z.string(), TakeMetaSchema));

/** `stem -> take number -> meta`. A bad file is an error, an absent one is empty. */
export function parseTakeMeta(raw: unknown): ReadonlyMap<string, ReadonlyMap<number, TakeMeta>> {
  const out = new Map<string, Map<number, TakeMeta>>();
  if (raw === undefined || raw === null) {
    return out;
  }
  const parsed = TakeMetaFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CueMapError(
      parsed.error.issues.map((i) => `take-meta: ${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  for (const [stem, takes] of Object.entries(parsed.data)) {
    const m = new Map<number, TakeMeta>();
    for (const [n, meta] of Object.entries(takes)) {
      m.set(Number(n), stripUndefined(meta) as TakeMeta);
    }
    out.set(stem.normalize('NFC'), m);
  }
  return out;
}
