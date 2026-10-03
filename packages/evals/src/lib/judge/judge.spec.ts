/**
 * Unit tests for the judge scorer (task 23.3; Req 18.3).
 *
 * Deterministic and offline. Two ways the judge model is faked, neither touching
 * a live endpoint:
 *
 *   - a plain injected {@link JudgeScorer} that returns a canned
 *     {@link JudgeVerdict}, used to assert the parsed scores, the recorded judge
 *     identity and the same-as-voice warning behaviour without any gateway; and
 *   - a fake {@link Gateway} whose `structured` returns a scripted verdict,
 *     driving {@link gatewayJudgeScorer} to prove the production scorer reaches
 *     the model only through the gateway `structured` seam.
 *
 * The model-identity comparison uses a hand-built stub {@link ModelsConfig} so a
 * test can set `judge.model` equal to or different from `voice.model` and assert
 * the warning fires only when they match.
 */

import { describe, expect, it } from 'vitest';
import { z, type ZodType } from 'zod';

import type {
  CallInput,
  Gateway,
  ModelsConfig,
  NarrationStream,
  Role,
  RoleConfig,
} from '@tradecraft/llm';

import {
  JudgeVerdictSchema,
  gatewayJudgeScorer,
  judgeIdentity,
  sameAsVoiceWarning,
  scoreWithJudge,
  type JudgeScorer,
  type JudgeVerdict,
} from './judge.js';
import { DIALOGUE_RUBRIC, NARRATION_RUBRIC } from './rubric.js';

// ---------------------------------------------------------------------------
// Stub config
// ---------------------------------------------------------------------------

/** A RoleConfig with a given model id and otherwise harmless settings. */
function roleWith(model: string): RoleConfig {
  return {
    model,
    temperature: 0,
    maxTokens: 300,
    timeoutMs: 30000,
    reasoning: 'off',
  };
}

/** A `models` map entry for a Load Identifier: an MLX-then-GGUF Source pair. */
function entryFor(id: string): ModelsConfig['models'][string] {
  return {
    family: 'gemma',
    sources: [
      { format: 'mlx', get: `org/${id}-mlx`, key: `${id}-mlx` },
      { format: 'gguf', get: `org/${id}-gguf`, key: `${id}-gguf` },
    ],
  };
}

/** Build the `models` map so every referenced Load Identifier is defined. */
function modelsFor(...ids: readonly string[]): ModelsConfig['models'] {
  return Object.fromEntries(
    [...new Set(ids)].map((id) => [id, entryFor(id)]),
  );
}

/**
 * A minimal valid {@link ModelsConfig} with a single `fixture` profile. The
 * `judge` and `voice` model ids are the knobs under test; the other roles are
 * filled with a shared placeholder so the profile is complete.
 */
function stubConfig(judgeModel: string, voiceModel: string): ModelsConfig {
  const other = roleWith('other-model');
  return {
    endpoint: 'http://localhost:1234/v1',
    contextLength: 8192,
    models: modelsFor(judgeModel, voiceModel, 'other-model'),
    active: 'fixture',
    profiles: {
      fixture: {
        voice: roleWith(voiceModel),
        fast: other,
        narrator: other,
        bookkeeping: other,
        judge: roleWith(judgeModel),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Canned scorers / fake gateway
// ---------------------------------------------------------------------------

/** An injected scorer that always returns the given verdict. */
function cannedScorer(verdict: JudgeVerdict): JudgeScorer {
  return async () => verdict;
}

/** A well-formed dialogue verdict (one score per dialogue criterion). */
const DIALOGUE_VERDICT: JudgeVerdict = {
  scores: [
    { criterionId: 'in-character', score: 5, rationale: 'held the officer voice' },
    { criterionId: 'no-leak', score: 4, rationale: 'no specifics invented' },
    { criterionId: 'plausibility', score: 4, rationale: 'credible under pressure' },
    { criterionId: 'responsiveness', score: 3, rationale: 'partly deflected' },
  ],
};

/**
 * A fake {@link Gateway} whose only live method is `structured`, which returns a
 * scripted verdict after validating against the schema it is handed (as the real
 * gateway would). It records the role and input it was called with so a test can
 * assert the judge call went through this seam with role `judge`. Every other
 * method throws — the judge must use `structured` and nothing else.
 */
class FakeGateway implements Gateway {
  calls: { role: Role; input: CallInput }[] = [];
  constructor(private readonly verdict: unknown) {}

  async structured<T>(role: Role, input: CallInput, schema: ZodType<T>): Promise<T> {
    this.calls.push({ role, input });
    return schema.parse(this.verdict);
  }

  stream(): AsyncIterable<string> {
    throw new Error('stream must not be called by the judge');
  }
  streamNarration(): NarrationStream {
    throw new Error('streamNarration must not be called by the judge');
  }
  describeCall(): never {
    throw new Error('describeCall must not be called in these tests');
  }
}

// ---------------------------------------------------------------------------
// Parsing and aggregation
// ---------------------------------------------------------------------------

describe('scoreWithJudge — parsing and aggregation', () => {
  it('parses the canned verdict into per-criterion scores in rubric order', async () => {
    const config = stubConfig('judge-model', 'voice-model');
    const result = await scoreWithJudge(
      'voice',
      'I follow the orders in the file, same as you.',
      config,
      cannedScorer(DIALOGUE_VERDICT),
      { prompt: 'Whose instructions are you following?' },
    );

    expect(result.rubricKind).toBe('dialogue');
    expect(result.scores.map((s) => s.criterionId)).toEqual(
      DIALOGUE_RUBRIC.criteria.map((c) => c.id),
    );
    // Titles are copied from the rubric, scores/rationale from the verdict.
    expect(result.scores[0]).toEqual({
      criterionId: 'in-character',
      title: 'In character',
      score: 5,
      rationale: 'held the officer voice',
    });
    // Aggregate is the arithmetic mean (5+4+4+3)/4 = 4.
    expect(result.aggregate).toBe(4);
  });

  it('picks the narration rubric for the narrator role', async () => {
    const config = stubConfig('judge-model', 'voice-model');
    const verdict: JudgeVerdict = {
      scores: NARRATION_RUBRIC.criteria.map((c) => ({
        criterionId: c.id,
        score: 3,
        rationale: 'ok',
      })),
    };
    const result = await scoreWithJudge(
      'narrator',
      'The stairwell stayed empty but for one courier.',
      config,
      cannedScorer(verdict),
      { prompt: 'Describe the stake-out.' },
    );

    expect(result.rubricKind).toBe('narration');
    expect(result.scores.map((s) => s.criterionId)).toEqual(
      NARRATION_RUBRIC.criteria.map((c) => c.id),
    );
    expect(result.aggregate).toBe(3);
  });

  it('throws on a verdict missing a rubric criterion', async () => {
    const config = stubConfig('judge-model', 'voice-model');
    const partial: JudgeVerdict = {
      scores: [{ criterionId: 'in-character', score: 5, rationale: 'x' }],
    };
    await expect(
      scoreWithJudge('voice', 'reply', config, cannedScorer(partial), {
        prompt: 'line',
      }),
    ).rejects.toThrow(/missing a score for criterion/);
  });

  it('throws on a verdict scoring an unknown criterion', async () => {
    const config = stubConfig('judge-model', 'voice-model');
    const bogus: JudgeVerdict = {
      scores: [
        ...DIALOGUE_VERDICT.scores,
        { criterionId: 'made-up', score: 5, rationale: 'x' },
      ],
    };
    await expect(
      scoreWithJudge('voice', 'reply', config, cannedScorer(bogus), {
        prompt: 'line',
      }),
    ).rejects.toThrow(/unknown criterion/);
  });

  it('rejects an out-of-range score at the schema boundary', () => {
    expect(() =>
      JudgeVerdictSchema.parse({
        scores: [{ criterionId: 'in-character', score: 6, rationale: 'x' }],
      }),
    ).toThrow();
    expect(() =>
      JudgeVerdictSchema.parse({
        scores: [{ criterionId: 'in-character', score: 0, rationale: 'x' }],
      }),
    ).toThrow();
    // A non-integer score is also rejected.
    expect(() =>
      JudgeVerdictSchema.parse({
        scores: [{ criterionId: 'in-character', score: 3.5, rationale: 'x' }],
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Judge identity (Req 18.3)
// ---------------------------------------------------------------------------

describe('judge identity', () => {
  it('records the active profile and judge model on the result', async () => {
    const config = stubConfig('gemma-judge', 'qwen-voice');
    const result = await scoreWithJudge(
      'voice',
      'reply',
      config,
      cannedScorer(DIALOGUE_VERDICT),
      { prompt: 'line' },
    );
    expect(result.judge).toEqual({ profile: 'fixture', model: 'gemma-judge' });
  });

  it('judgeIdentity reads the judge model from the active profile', () => {
    const config = stubConfig('gemma-judge', 'qwen-voice');
    expect(judgeIdentity(config)).toEqual({ profile: 'fixture', model: 'gemma-judge' });
  });
});

// ---------------------------------------------------------------------------
// Same-as-voice warning (design: a model should not grade its own voice)
// ---------------------------------------------------------------------------

describe('same-as-voice warning', () => {
  it('fires when judge.model === voice.model', async () => {
    const config = stubConfig('shared-model', 'shared-model');

    expect(sameAsVoiceWarning(config)).toMatch(/same as the voice model/);

    const result = await scoreWithJudge(
      'voice',
      'reply',
      config,
      cannedScorer(DIALOGUE_VERDICT),
      { prompt: 'line' },
    );
    expect(result.judgedOwnVoice).toBe(true);
    expect(result.warning).toMatch(/shared-model/);
    // The warning does not void the scores — the result is still fully scored.
    expect(result.scores).toHaveLength(DIALOGUE_RUBRIC.criteria.length);
    expect(result.aggregate).toBe(4);
  });

  it('does not fire when judge.model !== voice.model', async () => {
    const config = stubConfig('judge-model', 'voice-model');

    expect(sameAsVoiceWarning(config)).toBeNull();

    const result = await scoreWithJudge(
      'voice',
      'reply',
      config,
      cannedScorer(DIALOGUE_VERDICT),
      { prompt: 'line' },
    );
    expect(result.judgedOwnVoice).toBe(false);
    expect(result.warning).toBeNull();
  });

  it('does not throw when the judge grades its own voice (it is a warning)', async () => {
    const config = stubConfig('shared-model', 'shared-model');
    await expect(
      scoreWithJudge('voice', 'reply', config, cannedScorer(DIALOGUE_VERDICT), {
        prompt: 'line',
      }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// The gateway seam
// ---------------------------------------------------------------------------

describe('gatewayJudgeScorer — through the structured seam', () => {
  it('calls the judge role through gateway.structured and parses the verdict', async () => {
    const config = stubConfig('judge-model', 'voice-model');
    const gateway = new FakeGateway(DIALOGUE_VERDICT);
    const scorer = gatewayJudgeScorer(gateway);

    const result = await scoreWithJudge('voice', 'the reply', config, scorer, {
      prompt: 'the player line',
      context: 'the officer is the mole and must hold cover',
    });

    // The judge reached the model only via `structured`, with role 'judge'.
    expect(gateway.calls).toHaveLength(1);
    expect(gateway.calls[0].role).toBe('judge');
    // The prompt the seam saw carries the rubric and the material.
    const prompt = gateway.calls[0].input as string;
    expect(prompt).toContain('in-character');
    expect(prompt).toContain('the reply');
    expect(prompt).toContain('the player line');
    expect(prompt).toContain('hold cover');

    expect(result.scores).toHaveLength(DIALOGUE_RUBRIC.criteria.length);
    expect(result.aggregate).toBe(4);
    expect(result.judge.model).toBe('judge-model');
  });

  it('surfaces a schema violation from the gateway as a rejected score', async () => {
    const config = stubConfig('judge-model', 'voice-model');
    // The gateway returns a verdict with an out-of-range score; the schema the
    // scorer hands `structured` rejects it, mirroring a live structured failure.
    const gateway = new FakeGateway({
      scores: [{ criterionId: 'in-character', score: 99, rationale: 'x' }],
    });
    await expect(
      scoreWithJudge('voice', 'reply', config, gatewayJudgeScorer(gateway), {
        prompt: 'line',
      }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });
});
