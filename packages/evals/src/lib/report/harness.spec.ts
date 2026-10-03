/**
 * Unit tests for the eval harness orchestration (task 23.4; Req 18.4).
 *
 * Deterministic and offline. The harness runs the fixtures through every
 * profile in a stub two-profile {@link ModelsConfig}; the gateway and the scene
 * runner are injected, so no live model is ever reached:
 *
 *   - the **gateway factory** returns a {@link FakeGateway} and records which
 *     active config it was called with, so a test can assert the harness
 *     switched the active profile per run;
 *   - the **scene runner** is a scripted fake that records guard/timing outcomes
 *     into the collector it is handed and returns canned judge scores keyed by
 *     the active profile, so a test can assert the metrics snapshot and the
 *     per-profile scores flow into the comparison;
 *   - the **judge scorer** is a canned function that is never actually called by
 *     the fake runner (the runner returns canned results directly), proving the
 *     seam is injected rather than hard-wired.
 *
 * The test then renders the resulting comparison to confirm the two halves of
 * Req 18.4 compose: running both profiles produces a comparison the renderers
 * turn into a report naming both profiles.
 */

import { describe, expect, it } from 'vitest';

import type {
  Gateway,
  ModelsConfig,
  NarrationStream,
  RoleConfig,
} from '@tradecraft/llm';

import {
  profilesToRun,
  runEvalHarness,
  withActiveProfile,
  type ScenePlayer,
} from './harness.js';
import { renderMarkdownReport } from './report.js';
import type { ScenarioJudgeScore } from './report.js';
import type { JudgeScorer, JudgeResult } from '../judge/judge.js';
import { DIALOGUE_RUBRIC, NARRATION_RUBRIC } from '../judge/rubric.js';
import type { EvalFixture } from '../eval-fixtures/eval-fixtures.js';

// ---------------------------------------------------------------------------
// Stub config and fakes
// ---------------------------------------------------------------------------

function roleWith(model: string): RoleConfig {
  return { model, temperature: 0, maxTokens: 300, timeoutMs: 30000, reasoning: 'off' };
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
  return Object.fromEntries([...new Set(ids)].map((id) => [id, entryFor(id)]));
}

/** A profile where voice and judge differ, named by a model prefix. */
function profile(prefix: string) {
  const other = roleWith(`${prefix}-other`);
  return {
    voice: roleWith(`${prefix}-voice`),
    fast: other,
    narrator: other,
    bookkeeping: other,
    judge: roleWith(`${prefix}-judge`),
  };
}

/** A profile where the judge model equals the voice model (same-as-voice). */
function sameVoiceJudgeProfile(prefix: string) {
  const other = roleWith(`${prefix}-other`);
  const shared = roleWith(`${prefix}-shared`);
  return {
    voice: shared,
    fast: other,
    narrator: other,
    bookkeeping: other,
    judge: shared,
  };
}

/**
 * A stub two-profile config: `gemma-voice` has distinct judge/voice models,
 * `qwen-voice` has the judge model equal to its voice model (so the harness
 * should flag it). `active` starts at `gemma-voice`; the harness overrides it
 * per run.
 */
function stubConfig(): ModelsConfig {
  return {
    endpoint: 'http://localhost:1234/v1',
    contextLength: 8192,
    models: modelsFor(
      'gemma-voice',
      'gemma-other',
      'gemma-judge',
      'qwen-other',
      'qwen-shared',
    ),
    active: 'gemma-voice',
    profiles: {
      'gemma-voice': profile('gemma'),
      'qwen-voice': sameVoiceJudgeProfile('qwen'),
    },
  };
}

/** A gateway whose methods all throw — the fake runner never calls it. */
class FakeGateway implements Gateway {
  structured<T>(): Promise<T> {
    return Promise.reject(new Error('structured must not be called'));
  }
  stream(): AsyncIterable<string> {
    throw new Error('stream must not be called');
  }
  streamNarration(): NarrationStream {
    throw new Error('streamNarration must not be called');
  }
  describeCall(): never {
    throw new Error('describeCall must not be called');
  }
}

/** A canned judge scorer (never actually invoked by the fake runner). */
const cannedScorer: JudgeScorer = () =>
  Promise.reject(new Error('scorer should not be called by the fake runner'));

/** A dialogue result with the four criteria at a fixed score. */
function dialogueResult(profileName: string, score: number): JudgeResult {
  return {
    rubricKind: 'dialogue',
    scores: DIALOGUE_RUBRIC.criteria.map((c) => ({
      criterionId: c.id,
      title: c.title,
      score,
      rationale: 'r',
    })),
    aggregate: score,
    judge: { profile: profileName, model: `${profileName}-judge` },
    judgedOwnVoice: false,
    warning: null,
  };
}

/** A narration result with the three criteria at a fixed score. */
function narrationResult(profileName: string, score: number): JudgeResult {
  return {
    rubricKind: 'narration',
    scores: NARRATION_RUBRIC.criteria.map((c) => ({
      criterionId: c.id,
      title: c.title,
      score,
      rationale: 'r',
    })),
    aggregate: score,
    judge: { profile: profileName, model: `${profileName}-judge` },
    judgedOwnVoice: false,
    warning: null,
  };
}

const FIXTURES: readonly EvalFixture[] = [
  {
    id: 'mole-interrogation',
    scenario: 'mole-interrogation',
    seed: 's1',
    script: [{ kind: 'say', speaker: 'player', role: 'voice', text: 'q' }],
    preconditions: 'p',
  },
  {
    id: 'surveillance-narration',
    scenario: 'surveillance-narration',
    seed: 's2',
    script: [
      { kind: 'say', speaker: 'narration-request', role: 'narrator', text: 'd' },
    ],
    preconditions: 'p',
  },
];

/**
 * A scripted scene runner. It records a few guard/timing outcomes into the
 * collector it is handed (so the harness's metrics snapshot is non-trivial and
 * per-profile distinct), and returns canned judge scores. The `voice` dialogue
 * score differs by profile so the comparison shows a real difference. The
 * gateway and scorer are received but never driven — the point is the harness
 * passes them through.
 */
const scriptedRunner: ScenePlayer = async ({ config, collector }) => {
  const name = config.active;
  // Record some mechanical outcomes; qwen trips the Leak Guard more.
  const trips = name === 'qwen-voice' ? 2 : 1;
  for (let i = 0; i < trips; i++) {
    collector.recordLeakGuard({ outcome: 'deflected', regenerations: 1, hits: [{}] });
  }
  collector.recordReply('voice', { outcome: 'clean', breaks: [] });
  collector.recordTiming({ role: 'voice', ttfsMs: 1000, completionTokens: 100, durationMs: 2000 });

  const voiceScore = name === 'gemma-voice' ? 5 : 3;
  const narrationScore = name === 'gemma-voice' ? 4 : 5;
  const scores: ScenarioJudgeScore[] = [
    { scenario: 'mole-interrogation', role: 'voice', result: dialogueResult(name, voiceScore) },
    {
      scenario: 'surveillance-narration',
      role: 'narrator',
      result: narrationResult(name, narrationScore),
    },
  ];
  return scores;
};

// ---------------------------------------------------------------------------
// withActiveProfile / profilesToRun
// ---------------------------------------------------------------------------

describe('withActiveProfile', () => {
  it('returns a copy with active set, without mutating the input', () => {
    const config = stubConfig();
    const next = withActiveProfile(config, 'qwen-voice');
    expect(next.active).toBe('qwen-voice');
    expect(config.active).toBe('gemma-voice');
    expect(next.profiles).toBe(config.profiles);
  });

  it('throws for an undefined profile', () => {
    expect(() => withActiveProfile(stubConfig(), 'nope')).toThrow(/no such profile/);
  });
});

describe('profilesToRun', () => {
  it('lists every profile in sorted order', () => {
    expect(profilesToRun(stubConfig())).toEqual(['gemma-voice', 'qwen-voice']);
  });
});

// ---------------------------------------------------------------------------
// runEvalHarness — both profiles, offline
// ---------------------------------------------------------------------------

describe('runEvalHarness', () => {
  it('runs both profiles, switching the active profile per run', async () => {
    const seenActive: string[] = [];
    const comparison = await runEvalHarness(stubConfig(), {
      gatewayFactory: (config) => {
        seenActive.push(config.active);
        return new FakeGateway();
      },
      scenePlayer: scriptedRunner,
      scorer: cannedScorer,
      fixtures: FIXTURES,
    });

    // The gateway factory saw each profile's active config, in sorted order.
    expect(seenActive).toEqual(['gemma-voice', 'qwen-voice']);
    expect(comparison.profiles.map((p) => p.profile)).toEqual([
      'gemma-voice',
      'qwen-voice',
    ]);
    expect(comparison.fixtures).toBe(FIXTURES);
  });

  it('records the judge identity and same-as-voice warning per profile from the config', async () => {
    const comparison = await runEvalHarness(stubConfig(), {
      gatewayFactory: () => new FakeGateway(),
      scenePlayer: scriptedRunner,
      scorer: cannedScorer,
      fixtures: FIXTURES,
    });

    const [gemma, qwen] = comparison.profiles;
    expect(gemma.judge).toEqual({ profile: 'gemma-voice', model: 'gemma-judge' });
    expect(gemma.warning).toBeNull();

    // qwen's judge model equals its voice model, so the warning fires.
    expect(qwen.judge).toEqual({ profile: 'qwen-voice', model: 'qwen-shared' });
    expect(qwen.warning).toMatch(/same as the voice model/);
    expect(qwen.warning).toMatch(/qwen-shared/);
  });

  it('aggregates the metrics the scene runner recorded into each profile', async () => {
    const comparison = await runEvalHarness(stubConfig(), {
      gatewayFactory: () => new FakeGateway(),
      scenePlayer: scriptedRunner,
      scorer: cannedScorer,
      fixtures: FIXTURES,
    });

    const [gemma, qwen] = comparison.profiles;
    // gemma recorded one leak-guard trip, qwen two.
    expect(gemma.metrics.leakGuardTrips).toBe(1);
    expect(qwen.metrics.leakGuardTrips).toBe(2);
    // Both recorded one voice reply and one timing sample.
    expect(gemma.metrics.refusalRate.voice.replies).toBe(1);
    expect(gemma.metrics.timeToFirstSentence.voice.meanMs).toBe(1000);
    expect(gemma.metrics.tokensPerSecond.voice.tokensPerSec).toBe(50);
  });

  it('carries the per-profile judge scores into the comparison', async () => {
    const comparison = await runEvalHarness(stubConfig(), {
      gatewayFactory: () => new FakeGateway(),
      scenePlayer: scriptedRunner,
      scorer: cannedScorer,
      fixtures: FIXTURES,
    });

    const gemmaVoice = comparison.profiles[0].judgeScores.find(
      (s) => s.scenario === 'mole-interrogation' && s.role === 'voice',
    );
    const qwenVoice = comparison.profiles[1].judgeScores.find(
      (s) => s.scenario === 'mole-interrogation' && s.role === 'voice',
    );
    expect(gemmaVoice?.result.aggregate).toBe(5);
    expect(qwenVoice?.result.aggregate).toBe(3);
  });

  it('produces a comparison the renderer turns into a both-profile report', async () => {
    const comparison = await runEvalHarness(stubConfig(), {
      gatewayFactory: () => new FakeGateway(),
      scenePlayer: scriptedRunner,
      scorer: cannedScorer,
      fixtures: FIXTURES,
    });

    const md = renderMarkdownReport(comparison);
    expect(md).toContain('Profiles compared: `gemma-voice`, `qwen-voice`.');
    expect(md).toContain('| mole-interrogation | voice | aggregate (dialogue) | 5.00 | 3.00 |');
    expect(md).toMatch(/⚠️ the judge model "qwen-shared" is the same as the voice model/);
  });

  it('defaults to the five required fixtures when none are passed', async () => {
    const comparison = await runEvalHarness(stubConfig(), {
      gatewayFactory: () => new FakeGateway(),
      // A runner that ignores fixtures and records nothing, returning no scores.
      scenePlayer: async () => [],
      scorer: cannedScorer,
    });
    // loadEvalFixtures() returns the five required scenes.
    expect(comparison.fixtures).toHaveLength(5);
  });
});
