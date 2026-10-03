/**
 * Unit tests for the fixed judge rubric (task 23.3; Req 18.3).
 *
 * The rubric is deterministic data — the "fixed rubric" of Req 18.3 — so the
 * tests pin its shape: two variants, named unique criteria, and a bounded
 * integer scale. These guard against an accidental edit that would make a run's
 * scores non-comparable with a previous run's.
 */

import { describe, expect, it } from 'vitest';

import {
  DIALOGUE_RUBRIC,
  NARRATION_RUBRIC,
  RUBRICS,
  SCORE_MAX,
  SCORE_MIN,
  rubricForRole,
} from './rubric.js';

describe('fixed rubric', () => {
  it('exposes both variants keyed by kind', () => {
    expect(RUBRICS.dialogue).toBe(DIALOGUE_RUBRIC);
    expect(RUBRICS.narration).toBe(NARRATION_RUBRIC);
    expect(DIALOGUE_RUBRIC.kind).toBe('dialogue');
    expect(NARRATION_RUBRIC.kind).toBe('narration');
  });

  it('carries a bounded scale on each variant', () => {
    for (const rubric of [DIALOGUE_RUBRIC, NARRATION_RUBRIC]) {
      expect(rubric.scoreMin).toBe(SCORE_MIN);
      expect(rubric.scoreMax).toBe(SCORE_MAX);
      expect(rubric.scoreMin).toBeLessThan(rubric.scoreMax);
    }
  });

  it('names non-empty, unique criteria in each variant', () => {
    for (const rubric of [DIALOGUE_RUBRIC, NARRATION_RUBRIC]) {
      expect(rubric.criteria.length).toBeGreaterThan(0);
      const ids = rubric.criteria.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const c of rubric.criteria) {
        expect(c.id.length).toBeGreaterThan(0);
        expect(c.title.length).toBeGreaterThan(0);
        expect(c.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('routes voice to the dialogue rubric and narrator to narration', () => {
    expect(rubricForRole('voice')).toBe(DIALOGUE_RUBRIC);
    expect(rubricForRole('narrator')).toBe(NARRATION_RUBRIC);
  });
});
