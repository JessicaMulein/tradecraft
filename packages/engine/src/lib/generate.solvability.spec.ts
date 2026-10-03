/**
 * Property 2 (Plot solvability) for the world generator's `generate()` entry
 * point (task 5.11; Requirement 1.4).
 *
 * The design fixes **Property 2** as: for any seed, the world `generate()`
 * returns is SOLVABLE — every Plot Stage's key operation fact (and, when a mole
 * is enabled, the mole's identity) has TWO node-disjoint discovery paths, one
 * HUMAN (a meeting edge) and one SIGNAL (an intercept or surveillance edge).
 *
 * `generate()` uses the discovery-path verifier as its acceptance gate (design,
 * step 10), so a successful `generate()` return already *implies* solvability.
 * This test does both halves of the claim for varied seeds and both mole
 * settings:
 *
 * 1. It calls `generate(seed, inputs)` and asserts the gate accepted (a world
 *    came back with the caller's seed). This witnesses the gate did not merely
 *    not-throw by luck — the real verifier is the gate.
 * 2. It rebuilds the {@link DiscoveryInputs} from a fresh step-1→8 core stream
 *    for the *same* seed — exactly the pieces `generate()`'s gate verifies — and
 *    asserts the verifier's **structural guarantees** over that world: `ok` is
 *    true, every Plot Stage is covered by a {@link TargetReport}, each report's
 *    `human` witness is a human edge, each `signal` witness is a signal edge,
 *    and the two witnesses are node-disjoint. When the mole is enabled, the mole
 *    target is present with its own disjoint human/signal witnesses.
 *
 * The core-stream rebuild mirrors `discovery.spec.ts`'s `gen()` + `inputsOf()`
 * helpers, and the `generate()` call reuses `generate.spec.ts`'s loader,
 * `GenerateInputs` and `ScenarioConfig` construction, so the DiscoveryInputs the
 * assertions read are the same world the gate accepted.
 *
 * This is a test-only task: it asserts the verifier's structural guarantees over
 * the returned world rather than merely that `generate()` did not throw.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type DocumentTemplate,
  type PublicText,
} from '@tradecraft/content';

import { createPrng } from './prng/prng.js';
import { type GameTime } from './model/core.js';
import { generateCity } from './city/generate.js';
import { type City } from './city/city.js';
import {
  generateOrgs,
  generatePrincipals,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from './city/principals.js';
import { generatePlot, type PlotState } from './city/plot.js';
import { generateComms, type GeneratedComms } from './city/comms.js';
import { assignKnowledge, type GeneratedKnowledge } from './city/knowledge.js';
import {
  generateStartingBrief,
  type StartingBrief,
} from './city/starting-brief.js';
import {
  isHumanEdge,
  isSignalEdge,
  verifyDiscoveryPaths,
  witnessesDisjoint,
  type DiscoveryInputs,
} from './city/discovery.js';
import {
  ScenarioConfigSchema,
  type ScenarioConfig,
} from './config/scenario-config.js';
import { generate, type GenerateInputs } from './generate.js';

const ENGINE_LIB = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = join(ENGINE_LIB, '..', '..', '..', 'content', 'packs', 'core');

function loadCore(): {
  content: ContentSet;
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error(
      `core pack failed to load:\n${content.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) {
    throw new Error('city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) {
    throw new Error('descriptors.yaml failed to load');
  }
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) {
    throw new Error('public texts failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { content, cityData, descriptors, publicTexts } = loadCore();
const locationTypes = [...content.locationTypes.values()];

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

function docTemplate(local: string): DocumentTemplate {
  for (const [key, value] of content.documentTemplates) {
    if (key === local || key.endsWith(`/${local}`)) {
      return value;
    }
  }
  throw new Error(`no document template ${local}`);
}

const STANDARD = preset('standard');
const CABLE_TEMPLATE = docTemplate('cable-hq-directive');
const START: GameTime = { day: 0, phase: 0 };

// ---------------------------------------------------------------------------
// generate() inputs (mirrors generate.spec.ts)
// ---------------------------------------------------------------------------

/** A minimal valid scenario config, with the mole flag the caller chooses. */
function scenario(mole: boolean): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole,
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
  });
}

function generateInputs(mole: boolean): GenerateInputs {
  return {
    content,
    preset: STANDARD,
    scenario: scenario(mole),
    cityData,
    descriptors,
    publicTexts,
  };
}

// ---------------------------------------------------------------------------
// Core-stream rebuild (mirrors discovery.spec.ts gen() + inputsOf())
// ---------------------------------------------------------------------------

interface Generated {
  readonly city: City;
  readonly orgs: GeneratedOrgs;
  readonly principals: GeneratedPrincipals;
  readonly plot: PlotState;
  readonly comms: GeneratedComms;
  readonly knowledge: GeneratedKnowledge;
  readonly brief: StartingBrief;
}

/**
 * Run the full step-1→8 core stream for a seed — the same stream `generate()`
 * hands to its discovery gate — so the verifier reads the world the gate
 * verified.
 */
function gen(seed: string, mole: boolean): Generated {
  const prng = createPrng(seed);
  const { city } = generateCity(prng, locationTypes, cityData);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs);
  const { plot } = generatePlot(
    prng,
    content,
    STANDARD,
    city,
    orgs,
    principals,
    START,
  );
  const comms = generateComms(prng, content, city, orgs, principals, plot, START);
  const knowledge = assignKnowledge(
    prng,
    orgs,
    principals,
    plot,
    comms,
    city,
    { hqFalseBeliefRate: STANDARD.hqFalseBeliefRate },
    { mole },
  );
  const { brief } = generateStartingBrief(
    seed,
    content,
    city,
    principals,
    comms,
    knowledge.station,
    CABLE_TEMPLATE,
    { city, npcs: principals.npcs, orgs: orgs.orgs },
    { startingBudget: STANDARD.startingBudget },
  );
  return { city, orgs, principals, plot, comms, knowledge, brief };
}

function inputsOf(g: Generated): DiscoveryInputs {
  return {
    brief: g.brief,
    plot: g.plot,
    knowledge: g.knowledge,
    comms: g.comms,
    city: g.city,
    orgs: g.orgs,
    principals: g.principals,
  };
}

/**
 * Assert the structural guarantees of a solvable world over its DiscoveryInputs:
 * the verifier is `ok`, every Plot Stage is covered by a report, and each
 * report pairs a human edge with a node-disjoint signal edge.
 */
function assertSolvable(g: Generated, mole: boolean): void {
  const result = verifyDiscoveryPaths(inputsOf(g));

  // The gate accepts: a solvable world.
  expect(result.ok).toBe(true);
  expect(result.failure).toBeUndefined();

  // Every Plot Stage is covered by at least one report. The tightened verifier
  // reports one dual-pathed witness per key fact a stage's traces evidence, so a
  // stage may contribute several reports; every Plot Stage must appear.
  expect(result.stages.length).toBeGreaterThanOrEqual(g.plot.stages.length);
  const coveredStageIds = new Set(result.stages.map((s) => s.stage));
  for (const stage of g.plot.stages) {
    expect(coveredStageIds.has(stage.id)).toBe(true);
  }

  // Each stage report: one human edge + one node-disjoint signal edge.
  for (const report of result.stages) {
    expect(isHumanEdge(report.human.edge)).toBe(true);
    expect(isSignalEdge(report.signal.edge)).toBe(true);
    expect(witnessesDisjoint(report.human, report.signal)).toBe(true);
  }

  // Mole clause: when enabled, the mole identity has disjoint human/signal
  // witnesses; when disabled, no mole target is reported.
  if (mole) {
    expect(result.mole).toBeDefined();
    const moleReport = result.mole;
    if (moleReport === undefined) {
      throw new Error('expected a mole report when the mole is enabled');
    }
    expect(isHumanEdge(moleReport.human.edge)).toBe(true);
    expect(isSignalEdge(moleReport.signal.edge)).toBe(true);
    expect(witnessesDisjoint(moleReport.human, moleReport.signal)).toBe(true);
  } else {
    expect(result.mole).toBeUndefined();
  }
}

// A varied, non-empty seed set to drive the property over.
const SEEDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo-123',
  'z',
  'q1',
  'w2',
  'seed-99',
  'fox-trot',
];

// ---------------------------------------------------------------------------
// Property 2 — Plot solvability (Requirement 1.4)
// ---------------------------------------------------------------------------

describe('generate — Property 2: the returned world is solvable (Req 1.4)', () => {
  it('every Plot Stage (and the mole, when enabled) has disjoint human + signal paths', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SEEDS), fc.boolean(), (seed, mole) => {
        // The gate accepted this seed: generate() returns only a verifiable
        // world. The returned seed echoes the caller's, so we know the world is
        // the one the gate verified.
        const world = generate(seed, generateInputs(mole));
        expect(world.meta.seed).toBe(seed);

        // Assert the verifier's structural guarantees over the same world the
        // gate verified (rebuilt from the identical core stream).
        assertSolvable(gen(seed, mole), mole);
      }),
      { numRuns: 40 },
    );
  });
});
