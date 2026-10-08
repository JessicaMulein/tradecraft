/**
 * Shared game-building configs for the offline test harnesses
 * (`app/game-harness-config.ts`).
 *
 * The reachable-state walk (`reachable-walk.walk.ts`) and the Scripted Full
 * Games (`scripted-games.ts`) both assemble a game through the Composition Root
 * with the Fake Seams against the real core pack. They share the repo root, the
 * deterministic {@link ScenarioConfig} and the minimal valid {@link ModelsConfig}
 * from here so a change to how the shared harnesses build a game lands in both
 * at once.
 *
 * This is a plain library module (it imports no vitest), so it is part of the
 * `@tradecraft/app` lib build and may be re-exported from the package index —
 * which is how the golden-replay recorder (`@tradecraft/evals`) reaches the
 * Scripted Full Games that depend on it, exactly as it reaches the Fake Seams.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

import { ScenarioConfigSchema, type ScenarioConfig } from '@tradecraft/engine';
import { ModelsConfigSchema, type ModelsConfig } from '@tradecraft/llm';

/**
 * The repository root the scenario's pack directories resolve against. This file
 * is at `packages/app/src/lib/`, so the repo root is four directories up. The
 * Composition Root joins `scenario.packs.dirs` (default `packages/content/packs`)
 * onto this, so the harness loads the real core pack from the checkout.
 */
export const WALK_REPO_ROOT = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

/**
 * The scenario fields a harness may change from the core defaults: which packs
 * to load, the city, and the opt-in plot-library and ambient-world features. A
 * calibration run passes these to measure the balance with those features on.
 */
export interface ScenarioOverrides {
  readonly packs?: { readonly dirs: readonly string[]; readonly load: readonly string[] };
  readonly setting?: { readonly city: string; readonly startDate?: string };
  readonly plotSelection?: { readonly enabled: boolean };
  readonly ambient?: { readonly enabled: boolean; readonly density?: 'sparse' | 'standard' | 'rich' };
  readonly mole?: boolean;
}

/**
 * A fully-specified, deterministic {@link ScenarioConfig} the harnesses generate
 * worlds from: the core pack with unit recruitment weights, like the golden
 * replay fixtures. No randomness and no fs beyond the pack load, so every walk
 * of a given seed regenerates the same world. `overrides` replaces whole
 * top-level blocks (packs, setting, plotSelection, ambient, mole).
 */
export function walkScenario(preset = 'standard', overrides: ScenarioOverrides = {}): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset },
    mole: true,
    // The loader (and the Composition Root's side-file loaders) treat each dir
    // as a pack directory, so point directly at the core pack, as the engine
    // and player-view specs' `loadCore` helpers do.
    packs: { dirs: ['packages/content/packs/core'], load: ['core'] },
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: {
        trust: 1,
        riskAversion: 1,
        scheduleConflict: 1,
        agendaInterest: 1,
      },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
    ...overrides,
  });
}

/**
 * A minimal valid {@link ModelsConfig}. The harnesses build the game with Fake
 * Seams and no gateway, so the Composition Root never constructs an endpoint
 * client and this config's model ids are never used; it only has to validate so
 * `createGame`'s type is satisfied.
 */
export function walkModels(): ModelsConfig {
  const role = {
    model: 'fake-model',
    temperature: 0,
    maxTokens: 128,
    timeoutMs: 10_000,
    reasoning: 'off' as const,
  };
  const source = { format: 'mlx' as const, get: 'org/fake', key: 'org/fake' };
  return ModelsConfigSchema.parse({
    endpoint: 'http://localhost:1234/v1',
    contextLength: 8192,
    models: {
      'fake-model': {
        family: 'none',
        sources: [source, { ...source, format: 'gguf' as const }],
      },
    },
    profiles: {
      fake: {
        voice: role,
        fast: role,
        narrator: role,
        bookkeeping: role,
        judge: role,
      },
    },
    active: 'fake',
  });
}
