/**
 * Unit tests for the comparison report renderers (task 23.4; Req 18.4).
 *
 * Deterministic and offline. The renderers are pure string builders, so these
 * tests build a fixed {@link EvalComparison} fixture by hand (two profiles with
 * known metrics and judge scores) and pin the exact Markdown and CSV output:
 * the Markdown comparison rows, the recorded judge identity, the same-as-voice
 * warning, and the CSV header plus representative rows. Pinning the output is
 * what guards the stable column/row order and fixed number formatting the
 * report promises.
 */

import { describe, expect, it } from 'vitest';

import {
  CSV_HEADER,
  renderCsvReport,
  renderMarkdownReport,
  type EvalComparison,
  type ProfileEvalResult,
  type ScenarioJudgeScore,
} from './report.js';
import type { MechanicalMetrics } from '../metrics/mechanical-metrics.js';
import type { JudgeResult } from '../judge/judge.js';
import type { EvalFixture } from '../eval-fixtures/eval-fixtures.js';
import { DIALOGUE_RUBRIC, NARRATION_RUBRIC } from '../judge/rubric.js';

// ---------------------------------------------------------------------------
// Fixed fixtures
// ---------------------------------------------------------------------------

/** A fully-specified MechanicalMetrics with distinct, legible numbers. */
function metrics(overrides: Partial<MechanicalMetrics> = {}): MechanicalMetrics {
  return {
    leakGuardTrips: 2,
    leakGuardHits: 3,
    specificsGuardTrips: 1,
    chanceLeaks: 0,
    toldListContradictions: 4,
    refusalRate: {
      voice: { replies: 10, deflected: 1, rate: 0.1 },
      narrator: { replies: 4, deflected: 0, rate: 0 },
    },
    timeToFirstSentence: {
      voice: { samples: 10, meanMs: 1234.4, maxMs: 2000 },
      narrator: { samples: 4, meanMs: 800, maxMs: 950 },
    },
    tokensPerSecond: {
      voice: { samples: 10, totalTokens: 1000, totalDurationMs: 20000, tokensPerSec: 50 },
      narrator: { samples: 4, totalTokens: 200, totalDurationMs: 4000, tokensPerSec: 50 },
    },
    ...overrides,
  };
}

/** A dialogue judge result with the four dialogue criteria scored. */
function dialogueResult(scores: readonly number[]): JudgeResult {
  const criteria = DIALOGUE_RUBRIC.criteria;
  return {
    rubricKind: 'dialogue',
    scores: criteria.map((c, i) => ({
      criterionId: c.id,
      title: c.title,
      score: scores[i],
      rationale: 'r',
    })),
    aggregate: scores.reduce((a, b) => a + b, 0) / scores.length,
    judge: { profile: 'gemma-voice', model: 'gemma-judge' },
    judgedOwnVoice: false,
    warning: null,
  };
}

/** A narration judge result with the three narration criteria scored. */
function narrationResult(scores: readonly number[]): JudgeResult {
  const criteria = NARRATION_RUBRIC.criteria;
  return {
    rubricKind: 'narration',
    scores: criteria.map((c, i) => ({
      criterionId: c.id,
      title: c.title,
      score: scores[i],
      rationale: 'r',
    })),
    aggregate: scores.reduce((a, b) => a + b, 0) / scores.length,
    judge: { profile: 'gemma-voice', model: 'gemma-judge' },
    judgedOwnVoice: false,
    warning: null,
  };
}

/** A tiny fixture list (one dialogue scene, one narration scene). */
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
      { kind: 'say', speaker: 'narration-request', role: 'narrator', text: 'describe' },
    ],
    preconditions: 'p',
  },
];

/** Two scored outputs: a mole-interrogation voice reply, a surveillance narration. */
function profileScores(
  voiceScores: readonly number[],
  narrationScores: readonly number[],
): readonly ScenarioJudgeScore[] {
  return [
    { scenario: 'mole-interrogation', role: 'voice', result: dialogueResult(voiceScores) },
    {
      scenario: 'surveillance-narration',
      role: 'narrator',
      result: narrationResult(narrationScores),
    },
  ];
}

/** The fixed two-profile comparison these tests pin the output of. */
function comparison(): EvalComparison {
  const gemma: ProfileEvalResult = {
    profile: 'gemma-voice',
    judge: { profile: 'gemma-voice', model: 'gemma-judge' },
    metrics: metrics(),
    judgeScores: profileScores([5, 4, 4, 3], [4, 3, 5]),
    warning: null,
  };
  const qwen: ProfileEvalResult = {
    profile: 'qwen-voice',
    judge: { profile: 'qwen-voice', model: 'qwen-voice-model' },
    metrics: metrics({
      leakGuardTrips: 5,
      refusalRate: {
        voice: { replies: 10, deflected: 3, rate: 0.3 },
        narrator: { replies: 4, deflected: 0, rate: 0 },
      },
    }),
    judgeScores: profileScores([3, 3, 4, 4], [5, 4, 4]),
    // Same-as-voice: this profile's judge model equals its voice model.
    warning:
      'the judge model "qwen-voice-model" is the same as the voice model; a ' +
      'model should not grade its own voice, so these dialogue scores are a ' +
      'weak comparison',
  };
  return { profiles: [gemma, qwen], fixtures: FIXTURES };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

describe('renderMarkdownReport', () => {
  const md = renderMarkdownReport(comparison());

  it('names the profiles and fixtures in the header', () => {
    expect(md).toContain('# Model evaluation comparison');
    expect(md).toContain('Profiles compared: `gemma-voice`, `qwen-voice`.');
    expect(md).toContain(
      'Fixtures run (2): `mole-interrogation`, `surveillance-narration`.',
    );
  });

  it('records the judge identity per profile (Req 18.3)', () => {
    expect(md).toContain(
      '- **gemma-voice** — judged by `gemma-judge` (active profile `gemma-voice`).',
    );
    expect(md).toContain(
      '- **qwen-voice** — judged by `qwen-voice-model` (active profile `qwen-voice`).',
    );
  });

  it('surfaces the same-as-voice warning only for the affected profile', () => {
    expect(md).toMatch(/⚠️ the judge model "qwen-voice-model" is the same as the voice model/);
    // The gemma profile has no warning line under it.
    const gemmaBlock = md.slice(
      md.indexOf('**gemma-voice**'),
      md.indexOf('**qwen-voice**'),
    );
    expect(gemmaBlock).not.toContain('⚠️');
  });

  it('renders the mechanical metrics table with one column per profile', () => {
    expect(md).toContain('| Metric | gemma-voice | qwen-voice |');
    expect(md).toContain('| Leak Guard trips | 2 | 5 |');
    expect(md).toContain('| Told List contradictions | 4 | 4 |');
    // Per-role rows, formatted (rate as %, ms rounded, tps one decimal).
    expect(md).toContain('| Refusal rate (voice) | 10.0% | 30.0% |');
    expect(md).toContain('| Time to first sentence (mean) (voice) | 1234 ms | 1234 ms |');
    expect(md).toContain('| Time to first sentence (max) (voice) | 2000 ms | 2000 ms |');
    expect(md).toContain('| Tokens per second (voice) | 50.0 | 50.0 |');
  });

  it('renders the judge scores table: aggregate then per-criterion, per scenario', () => {
    expect(md).toContain('| Scenario | Role | Criterion | gemma-voice | qwen-voice |');
    // Dialogue aggregate: gemma (5+4+4+3)/4 = 4.00, qwen (3+3+4+4)/4 = 3.50.
    expect(md).toContain(
      '| mole-interrogation | voice | aggregate (dialogue) | 4.00 | 3.50 |',
    );
    expect(md).toContain('| mole-interrogation | voice | in-character | 5.00 | 3.00 |');
    // Narration aggregate: gemma (4+3+5)/3 = 4.00, qwen (5+4+4)/3 = 4.33.
    expect(md).toContain(
      '| surveillance-narration | narrator | aggregate (narration) | 4.00 | 4.33 |',
    );
    expect(md).toContain('| surveillance-narration | narrator | fidelity | 4.00 | 5.00 |');
  });
});

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

describe('renderCsvReport', () => {
  const csv = renderCsvReport(comparison());
  const lines = csv.split('\n');

  it('emits the documented header first', () => {
    expect(lines[0]).toBe(CSV_HEADER.join(','));
    expect(lines[0]).toBe(
      'profile,scenario,role,metric,kind,value,judge_model,warning',
    );
  });

  it('emits run-total mechanical rows with scenario * and no role', () => {
    expect(csv).toContain('gemma-voice,*,,leak-guard-trips,mechanical,2,gemma-judge,');
    expect(csv).toContain('qwen-voice,*,,leak-guard-trips,mechanical,5,qwen-voice-model,');
  });

  it('emits per-role mechanical rows with the role column set', () => {
    expect(csv).toContain(
      'gemma-voice,*,voice,refusal-rate,mechanical,10.0%,gemma-judge,',
    );
    expect(csv).toContain(
      'gemma-voice,*,voice,tokens-per-sec,mechanical,50.0,gemma-judge,',
    );
  });

  it('emits judge rows: aggregate then each criterion, per scenario/role', () => {
    expect(csv).toContain(
      'gemma-voice,mole-interrogation,voice,judge-aggregate,judge,4.00,gemma-judge,',
    );
    expect(csv).toContain(
      'gemma-voice,mole-interrogation,voice,in-character,judge,5.00,gemma-judge,',
    );
    expect(csv).toContain(
      'gemma-voice,surveillance-narration,narrator,fidelity,judge,4.00,gemma-judge,',
    );
  });

  it('repeats the same-as-voice warning (quoted) on every row of the affected profile', () => {
    const qwenRows = lines.filter((l) => l.startsWith('qwen-voice,'));
    expect(qwenRows.length).toBeGreaterThan(0);
    // Every qwen row carries the warning, quoted because it contains commas.
    for (const row of qwenRows) {
      expect(row).toContain('"the judge model ""qwen-voice-model"" is the same as the voice model');
    }
    // Gemma rows carry an empty warning column (trailing comma, nothing after).
    const gemmaRow = lines.find((l) =>
      l.startsWith('gemma-voice,*,,leak-guard-trips,'),
    );
    expect(gemmaRow?.endsWith(',gemma-judge,')).toBe(true);
  });

  it('is byte-for-byte stable for the same comparison', () => {
    expect(renderCsvReport(comparison())).toBe(csv);
  });
});
