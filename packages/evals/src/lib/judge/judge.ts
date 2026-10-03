/**
 * The judge scorer (task 23.3; Req 18.3).
 *
 * Req 18.3: the harness "SHALL score in-character quality with the `judge` role
 * against a fixed rubric, and SHALL report the judge model's identity alongside
 * the scores." The design adds the guard rail: "The judge should not be the
 * model under test when comparing voice quality. The harness warns when
 * `judge.model == voice.model` and records the judge identity in every report."
 *
 * This module does three things:
 *
 *   1. **Scores** a `voice` reply or `narrator` narration against the fixed
 *      rubric for its role ({@link rubricForRole} → {@link DIALOGUE_RUBRIC} /
 *      {@link NARRATION_RUBRIC}) by asking the `judge` model for a structured
 *      verdict and parsing it with a Zod schema ({@link JudgeVerdictSchema}).
 *   2. **Records the judge's identity** — the `judge` role's model id from the
 *      active profile — on every result, so a report (23.4) can state which
 *      model judged.
 *   3. **Warns** when the judge model equals the `voice` model, because a model
 *      should not grade its own voice. This is a warning, not an error: the
 *      result carries a flag and the warning is returned; nothing throws.
 *
 * ## The gateway seam (offline, deterministic)
 *
 * The judge call goes through the same {@link Gateway} `structured` seam the
 * rest of the system uses, so it runs OFFLINE against a {@link ReplayGateway}
 * or a fake gateway in tests and never a live model. The model call is
 * injectable: {@link scoreWithJudge} takes a {@link JudgeScorer} — a function
 * that, given the rubric and the material, returns a parsed {@link
 * JudgeVerdict}. {@link gatewayJudgeScorer} is the production scorer that builds
 * the prompt, calls `gateway.structured('judge', …, JudgeVerdictSchema)` and
 * returns the validated verdict; a test passes a scorer that returns a canned
 * verdict with no gateway at all. Either way the judge model is reached only
 * through `structured`, so a run is reproducible.
 *
 * The judge identity and the same-as-voice comparison read the active profile's
 * `roles` from a {@link ModelsConfig} (the `@tradecraft/llm` config type):
 * `profiles[active].judge.model` is the identity, and it is compared to
 * `profiles[active].voice.model` for the warning.
 */

import { z } from 'zod';

import type { Gateway, ModelsConfig } from '@tradecraft/llm';

import {
  SCORE_MAX,
  SCORE_MIN,
  rubricForRole,
  type Rubric,
  type RubricCriterion,
  type RubricKind,
} from './rubric.js';

// ---------------------------------------------------------------------------
// The structured verdict the judge model returns
// ---------------------------------------------------------------------------

/**
 * One criterion's score as the judge model returns it: the criterion `id` it is
 * scoring, the integer `score` on the fixed scale, and a short `rationale`. The
 * `score` is bounded to {@link SCORE_MIN}..{@link SCORE_MAX} by the schema, so a
 * model that returns an out-of-range number is a parse failure rather than a
 * silently clamped score.
 */
export const JudgeCriterionScoreSchema = z
  .object({
    criterionId: z.string().min(1),
    score: z
      .number()
      .int('a score must be a whole number')
      .min(SCORE_MIN, `a score must be >= ${SCORE_MIN}`)
      .max(SCORE_MAX, `a score must be <= ${SCORE_MAX}`),
    rationale: z.string(),
  })
  .strict();

export type JudgeCriterionScore = z.infer<typeof JudgeCriterionScoreSchema>;

/**
 * The judge model's structured verdict: one {@link JudgeCriterionScore} per
 * criterion. The schema validates the envelope (every entry is well-formed and
 * in range); {@link scoreWithJudge} additionally checks the set of
 * `criterionId`s matches the rubric exactly, so a verdict that scored the wrong
 * or a missing criterion is caught rather than aggregated as-is.
 */
export const JudgeVerdictSchema = z
  .object({
    scores: z.array(JudgeCriterionScoreSchema).min(1),
  })
  .strict();

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

// ---------------------------------------------------------------------------
// The scored result the harness records
// ---------------------------------------------------------------------------

/**
 * One criterion's recorded score: the rubric criterion it belongs to (its `id`
 * and `title`, so a report need not re-join against the rubric) plus the
 * judge's `score` and `rationale`.
 */
export interface JudgeScore {
  /** The rubric criterion's stable id. */
  readonly criterionId: string;
  /** The criterion's human title, copied for the report. */
  readonly title: string;
  /** The judge's integer score on the fixed scale. */
  readonly score: number;
  /** The judge's short rationale. */
  readonly rationale: string;
}

/**
 * The judge's identity, recorded on every result (Req 18.3). `model` is the
 * `judge` role's model id from the active profile — the string the report
 * states as "judged by". `profile` is the active profile name it came from, so
 * a report can show which line-up was active.
 */
export interface JudgeIdentity {
  /** The active profile name the judge model was drawn from. */
  readonly profile: string;
  /** The `judge` role's model id — who judged. */
  readonly model: string;
}

/**
 * A complete judge result for one scored reply/narration: which rubric variant
 * was applied, the per-criterion scores, a convenience aggregate, the recorded
 * judge identity, and the same-as-voice warning signal.
 *
 * `aggregate` is the arithmetic mean of the criterion scores, a single legible
 * number for a report to rank models by. It is derived, not asked of the model
 * — the judge scores criteria, the harness aggregates.
 *
 * `judgedOwnVoice` is `true` when the judge model is the same as the `voice`
 * model; `warning` carries the human message when it is (and is `null`
 * otherwise). The result is still fully scored in that case — the warning flags
 * that the comparison is weak, it does not void the scores.
 */
export interface JudgeResult {
  /** Which rubric variant graded this material. */
  readonly rubricKind: RubricKind;
  /** The per-criterion scores, in the rubric's criterion order. */
  readonly scores: readonly JudgeScore[];
  /** The arithmetic mean of the criterion scores. */
  readonly aggregate: number;
  /** Who judged (Req 18.3). */
  readonly judge: JudgeIdentity;
  /** True when the judge model equals the `voice` model. */
  readonly judgedOwnVoice: boolean;
  /** The same-as-voice warning message, or `null` when the models differ. */
  readonly warning: string | null;
}

// ---------------------------------------------------------------------------
// The injectable judge call
// ---------------------------------------------------------------------------

/**
 * The material the judge scores: the player line (or narration cue) that
 * prompted the output, the model's output under test, and any scene context the
 * judge should weigh (the observed facts a narration must stay faithful to, the
 * cover a lying officer holds). All plain strings — this is data the harness
 * assembles from a fixture run, not a model type.
 */
export interface JudgeInput {
  /** The player line or narration request the output responds to. */
  readonly prompt: string;
  /** The model output being graded (the `voice` reply or `narrator` prose). */
  readonly output: string;
  /** Optional scene context the judge should weigh (observed facts, cover). */
  readonly context?: string;
}

/**
 * The injectable model call: given a rubric and the material, return the judge
 * model's parsed {@link JudgeVerdict}. Production uses
 * {@link gatewayJudgeScorer}, which goes through the gateway `structured` seam;
 * a test passes a function that returns a canned verdict so scoring runs with no
 * gateway at all. Making this a parameter is what keeps {@link scoreWithJudge}
 * offline and deterministic.
 */
export type JudgeScorer = (
  rubric: Rubric,
  input: JudgeInput,
) => Promise<JudgeVerdict>;

/**
 * Build the production {@link JudgeScorer} over a {@link Gateway}. It renders
 * the fixed rubric and the material into a prompt and asks the `judge` role for
 * structured output validated against {@link JudgeVerdictSchema}, so the judge
 * model is reached only through the gateway seam. Pass a `ReplayGateway` and the
 * call is served from a recording with no live model; pass the live gateway and
 * it calls the endpoint.
 */
export function gatewayJudgeScorer(gateway: Gateway): JudgeScorer {
  return (rubric, input) =>
    gateway.structured('judge', buildJudgePrompt(rubric, input), JudgeVerdictSchema);
}

/**
 * Render the fixed rubric and the material into the judge prompt. Deterministic
 * in its inputs: the same rubric and material always produce the same prompt
 * (and so, through a `ReplayGateway`, the same hash). The prompt lists each
 * criterion by id with its description and the scale, states the material, and
 * asks for one score per criterion as structured JSON.
 */
export function buildJudgePrompt(rubric: Rubric, input: JudgeInput): string {
  const lines: string[] = [];
  lines.push(
    `You are the evaluation judge. Score the following ${rubric.kind} output ` +
      `against a fixed rubric. Each criterion is scored as an integer from ` +
      `${rubric.scoreMin} (poor) to ${rubric.scoreMax} (excellent).`,
  );
  lines.push('');
  lines.push('Rubric criteria:');
  for (const c of rubric.criteria) {
    lines.push(`- ${c.id} (${c.title}): ${c.description}`);
  }
  lines.push('');
  if (input.context !== undefined && input.context.length > 0) {
    lines.push('Scene context (ground truth to weigh against):');
    lines.push(input.context);
    lines.push('');
  }
  lines.push('Player line / narration request:');
  lines.push(input.prompt);
  lines.push('');
  lines.push('Output under test:');
  lines.push(input.output);
  lines.push('');
  lines.push(
    'Return JSON with a "scores" array holding one entry per criterion, each ' +
      'with its "criterionId", an integer "score" in range, and a short ' +
      '"rationale".',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Judge identity and the same-as-voice warning (read from the config)
// ---------------------------------------------------------------------------

/**
 * The judge identity from a {@link ModelsConfig}: the active profile name and
 * its `judge` role's model id (Req 18.3 — "report the judge model's identity").
 */
export function judgeIdentity(config: ModelsConfig): JudgeIdentity {
  const profile = config.active;
  return { profile, model: config.profiles[profile].judge.model };
}

/**
 * The same-as-voice warning message, or `null` when the judge and voice models
 * differ. A model should not grade its own voice (design), so when
 * `profiles[active].judge.model === profiles[active].voice.model` the harness
 * surfaces a warning naming the model. This is a warning only — it never throws.
 */
export function sameAsVoiceWarning(config: ModelsConfig): string | null {
  const profile = config.profiles[config.active];
  if (profile.judge.model === profile.voice.model) {
    return (
      `the judge model "${profile.judge.model}" is the same as the voice ` +
      `model; a model should not grade its own voice, so these dialogue ` +
      `scores are a weak comparison`
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** The arithmetic mean of the criterion scores (an empty list means 0). */
function meanScore(scores: readonly JudgeScore[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((sum, s) => sum + s.score, 0) / scores.length;
}

/**
 * Match a verdict's criterion scores to the rubric's criteria, in rubric order,
 * and throw when the two sets do not line up exactly. The judge must score every
 * criterion once and no criterion the rubric does not name — a verdict that
 * dropped, duplicated or invented a criterion is a judge failure to catch, not
 * something to aggregate silently.
 */
function alignScores(
  rubric: Rubric,
  verdict: JudgeVerdict,
): readonly JudgeScore[] {
  const byId = new Map<string, JudgeCriterionScore>();
  for (const entry of verdict.scores) {
    if (byId.has(entry.criterionId)) {
      throw new Error(
        `judge verdict scored criterion "${entry.criterionId}" more than once`,
      );
    }
    byId.set(entry.criterionId, entry);
  }

  const expected = new Set(rubric.criteria.map((c) => c.id));
  for (const id of byId.keys()) {
    if (!expected.has(id)) {
      throw new Error(
        `judge verdict scored unknown criterion "${id}" (not in the ` +
          `${rubric.kind} rubric)`,
      );
    }
  }

  return rubric.criteria.map((criterion: RubricCriterion) => {
    const entry = byId.get(criterion.id);
    if (entry === undefined) {
      throw new Error(
        `judge verdict is missing a score for criterion "${criterion.id}"`,
      );
    }
    return {
      criterionId: criterion.id,
      title: criterion.title,
      score: entry.score,
      rationale: entry.rationale,
    };
  });
}

/** Options for {@link scoreWithJudge}. */
export interface ScoreOptions {
  /**
   * The player line / narration request the output responds to and the scene
   * context the judge weighs against. The output under test is passed
   * separately so the call reads naturally.
   */
  readonly prompt: string;
  /** Optional scene context (observed facts, held cover) for the judge. */
  readonly context?: string;
}

/**
 * Score one `voice` reply or `narrator` narration against the fixed rubric for
 * its role, returning the full {@link JudgeResult} (Req 18.3).
 *
 * The rubric variant is chosen by `role` ({@link rubricForRole}). The judge
 * model is called through the injected {@link JudgeScorer} — the gateway
 * `structured` seam in production, a canned verdict in tests — so this is
 * offline and deterministic in the scorer. The parsed verdict is aligned to the
 * rubric's criteria (a mis-scored verdict throws), aggregated to a mean, and
 * stamped with the judge identity and the same-as-voice warning read from
 * `config`. The warning never throws: a result where the judge grades its own
 * voice is fully scored, with `judgedOwnVoice: true` and a `warning` message.
 */
export async function scoreWithJudge(
  role: 'voice' | 'narrator',
  output: string,
  config: ModelsConfig,
  scorer: JudgeScorer,
  options: ScoreOptions,
): Promise<JudgeResult> {
  const rubric = rubricForRole(role);
  const input: JudgeInput = {
    prompt: options.prompt,
    output,
    ...(options.context !== undefined ? { context: options.context } : {}),
  };

  const verdict = await scorer(rubric, input);
  const scores = alignScores(rubric, verdict);

  const warning = sameAsVoiceWarning(config);

  return {
    rubricKind: rubric.kind,
    scores,
    aggregate: meanScore(scores),
    judge: judgeIdentity(config),
    judgedOwnVoice: warning !== null,
    warning,
  };
}
