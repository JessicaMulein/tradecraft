/**
 * The eval-fixture format and the five required fixtures (task 23.1; Req 18.1,
 * 18.5).
 *
 * This mirrors `../replays/golden-replay.spec.ts`: it loads the checked-in
 * fixtures, asserts the format validates against the Zod schema, and drives each
 * fixture through the engine up to the point its scene is reached — all offline
 * and deterministic (no live model). Where the golden-replay spec pins a
 * reproduced artifact, this spec pins the *format* (every fixture is one of the
 * five scenes, carries a deterministic seed and a scripted set of player lines
 * and/or actions) and the *runnability* (the setup actions apply in order and
 * the world arrives at the scene).
 *
 * A failure here means a fixture no longer matches the format the harness
 * (23.2/23.3) relies on, or a seed/script no longer stages its scene — both must
 * be surfaced before the harness runs a model against a broken fixture.
 */

import { describe, expect, it } from 'vitest';

import {
  EVAL_SCENARIOS,
  EvalFixtureSchema,
  buildEvalFixtures,
  loadEvalFixtures,
  runFixtureSetup,
  type EvalFixture,
} from './eval-fixtures.js';

const fixtures = loadEvalFixtures();

describe('eval fixtures: format and coverage (Req 18.1, 18.5)', () => {
  it('loads the five required fixtures', () => {
    // Guards against a silently-empty suite and against a missing scene.
    expect(fixtures.length).toBe(EVAL_SCENARIOS.length);
  });

  it('covers each of the five evaluation scenes exactly once (Req 18.5)', () => {
    const scenarios = fixtures.map((f) => f.scenario).sort();
    expect(scenarios).toEqual([...EVAL_SCENARIOS].sort());
  });

  it('gives every fixture a unique id and a unique seed', () => {
    const ids = new Set(fixtures.map((f) => f.id));
    const seeds = new Set(fixtures.map((f) => f.seed));
    expect(ids.size).toBe(fixtures.length);
    expect(seeds.size).toBe(fixtures.length);
  });

  it('is deterministic: two builds produce identical fixtures', () => {
    expect(buildEvalFixtures()).toEqual(buildEvalFixtures());
  });
});

describe('eval fixtures: schema validation (Req 18.1)', () => {
  for (const fixture of fixtures) {
    describe(`fixture ${fixture.id}`, () => {
      it('validates against the fixture schema', () => {
        const parsed = EvalFixtureSchema.safeParse(fixture);
        expect(parsed.success).toBe(true);
      });

      it('carries a non-empty seed and precondition note', () => {
        expect(fixture.seed.length).toBeGreaterThan(0);
        expect(fixture.preconditions.length).toBeGreaterThan(0);
      });

      it('scripts at least one player line (a say step)', () => {
        const says = fixture.script.filter((s) => s.kind === 'say');
        expect(says.length).toBeGreaterThanOrEqual(1);
      });

      it('routes narration requests to the narrator and player lines to voice', () => {
        for (const step of fixture.script) {
          if (step.kind !== 'say') continue;
          if (step.speaker === 'narration-request') {
            expect(step.role).toBe('narrator');
          } else {
            expect(step.role).toBe('voice');
          }
        }
      });
    });
  }
});

describe('eval fixtures: schema rejects malformed fixtures', () => {
  const base: EvalFixture = fixtures[0];

  it('rejects an unknown scenario tag', () => {
    const bad = { ...base, scenario: 'not-a-scene' };
    expect(EvalFixtureSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an empty script', () => {
    const bad = { ...base, script: [] };
    expect(EvalFixtureSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an empty seed', () => {
    const bad = { ...base, seed: '' };
    expect(EvalFixtureSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a say line with empty text', () => {
    const bad = {
      ...base,
      script: [{ kind: 'say', speaker: 'player', role: 'voice', text: '' }],
    };
    expect(EvalFixtureSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a narration-request routed to the voice role', () => {
    const bad = {
      ...base,
      script: [
        { kind: 'say', speaker: 'narration-request', role: 'voice', text: 'describe it' },
      ],
    };
    expect(EvalFixtureSchema.safeParse(bad).success).toBe(false);
  });
});

describe('eval fixtures: runnable to the scene (Req 18.1)', () => {
  for (const fixture of fixtures) {
    describe(`fixture ${fixture.id}`, () => {
      it('regenerates its world and stages the setup actions', () => {
        const setup = runFixtureSetup(fixture);
        // The setup fold stopped somewhere within the script (at the first say
        // line or scene-opening act), proving the scene is reached.
        expect(setup.sceneStart).toBeGreaterThanOrEqual(0);
        expect(setup.sceneStart).toBeLessThanOrEqual(fixture.script.length);
        // The staged world is the same seed the fixture names (Req 1.2).
        expect(setup.world.meta.seed).toBe(fixture.seed);
      });

      it('is deterministic: two setups agree on the staged world', () => {
        const a = runFixtureSetup(fixture);
        const b = runFixtureSetup(fixture);
        expect(a.sceneStart).toBe(b.sceneStart);
        expect(a.world).toEqual(b.world);
      });
    });
  }
});
