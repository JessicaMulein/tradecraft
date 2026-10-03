/**
 * Tests for the world generator's `generate()` entry point (task 5.9;
 * Requirements 1.2, 1.6).
 *
 * These load the real core pack — its content, `city.yaml`, `descriptors.yaml`
 * and public-text corpora — and drive `generate()` end to end, checking the
 * invariants step 9 fixes:
 *
 * - **Acceptance (design step 10).** The generated {@link WorldState} passes the
 *   discovery-path verifier: `generate` only ever returns a verifiable world.
 * - **Determinism (Req 1.2).** The same seed and inputs produce a byte-identical
 *   WorldState across two runs. There is no intentionally non-deterministic
 *   field; the display seed is the caller's seed, so the whole state matches.
 * - **Population.** The world populates the fields the core-stream steps own:
 *   `meta.seed`, the Plot, the city, the Station block, the player's Cover
 *   Identity, and the Documents (the brief Cable, Dossiers and public texts).
 * - **GeneratorError (Req 1.6).** With an always-failing verifier injected, the
 *   retry loop exhausts the attempt limit and throws a {@link GeneratorError}
 *   that names the seed and the attempt count — exercising the failure path
 *   without needing a pathological content pack.
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
  type PublicText,
} from '@tradecraft/content';

import {
  ScenarioConfigSchema,
  type ScenarioConfig,
} from './config/scenario-config.js';
import { verifyDiscoveryPaths, type DiscoveryResult } from './city/discovery.js';
import { scheduledLocationAt } from './clock/schedules.js';
import { BACKGROUND_ID_PREFIX } from './noise/background.js';
import {
  GENERATOR_VERSION,
  GeneratorError,
  NOISE_STREAM_BASE,
  generate,
  randomSeed,
  type GenerateInputs,
} from './generate.js';

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

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

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');

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

function inputs(mole = false, p: DifficultyPreset = STANDARD): GenerateInputs {
  return {
    content,
    preset: p,
    scenario: scenario(mole),
    cityData,
    descriptors,
    publicTexts,
  };
}

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo-123', 'z', 'q1', 'w2'];

// ---------------------------------------------------------------------------
// Acceptance (the generated world passes the discovery gate)
// ---------------------------------------------------------------------------

describe('generate — returns a verifiable world (design step 10)', () => {
  // `generate` runs the discovery-path verifier (step 10) as its acceptance
  // gate and returns *only* when the gate passes; otherwise it retries and
  // ultimately throws. So a successful return with the real verifier is itself
  // the proof that the world is verifiable — the gate accepted it.
  it('succeeds (gate accepts) for every seed, with and without a mole', () => {
    for (const seed of SEEDS) {
      for (const mole of [false, true]) {
        const world = generate(seed, inputs(mole));
        expect(world.meta.seed).toBe(seed);
        // A sanity re-check that the first attempt was enough for the core pack:
        // the real verifier passes on the untouched seed.
        const result = verifyDiscoveryPathsOnFreshRun(seed, mole);
        expect(result.ok).toBe(true);
      }
    }
  });
});

/**
 * Re-run the discovery verifier against a fresh core-stream build for the seed,
 * via a counting wrapper, to witness that attempt 0 already passes for the core
 * pack (the gate is not vacuously satisfied). The wrapper records whether the
 * first call was `ok`.
 */
function verifyDiscoveryPathsOnFreshRun(
  seed: string,
  mole: boolean,
): DiscoveryResult {
  let first: DiscoveryResult | undefined;
  const spy: typeof verifyDiscoveryPaths = (args) => {
    const r = verifyDiscoveryPaths(args);
    if (first === undefined) {
      first = r;
    }
    return r;
  };
  generate(seed, inputs(mole), { verifier: spy });
  if (first === undefined) {
    throw new Error('verifier was never called');
  }
  return first;
}

// ---------------------------------------------------------------------------
// Determinism (Requirement 1.2)
// ---------------------------------------------------------------------------

describe('generate — determinism (Req 1.2)', () => {
  it('is byte-identical across two runs with the same seed and inputs', () => {
    for (const seed of SEEDS) {
      for (const mole of [false, true]) {
        const a = generate(seed, inputs(mole));
        const b = generate(seed, inputs(mole));
        expect(a).toEqual(b);
      }
    }
  });

  it('different seeds produce different worlds', () => {
    const a = generate('alpha', inputs());
    const b = generate('bravo', inputs());
    expect(a).not.toEqual(b);
  });

  it('stays identical across the seed set (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SEEDS), fc.boolean(), (seed, mole) => {
        const a = generate(seed, inputs(mole));
        const b = generate(seed, inputs(mole));
        expect(a).toEqual(b);
      }),
      { numRuns: 24 },
    );
  });
});

// ---------------------------------------------------------------------------
// Population (the fields the core-stream steps own)
// ---------------------------------------------------------------------------

describe('generate — populates the world (steps 1–9)', () => {
  it('records the seed, generator version and resolved preset/scenario on meta', () => {
    const world = generate('alpha', inputs());
    expect(world.meta.seed).toBe('alpha');
    expect(world.meta.generatorVersion).toBe(GENERATOR_VERSION);
    expect(world.meta.preset).toBe(STANDARD);
    expect(world.meta.content).toBe(content.manifest);
    expect(world.meta.scenario.mole).toBe(false);
  });

  it('populates the city, Plot, orgs and NPCs', () => {
    const world = generate('alpha', inputs());
    expect(Object.keys(world.city.locations).length).toBeGreaterThan(0);
    expect(world.plot.stages.length).toBeGreaterThan(0);
    expect(Object.keys(world.orgs).length).toBe(3);
    expect(Object.keys(world.npcs).length).toBeGreaterThan(0);
    expect(world.city.locations[world.player.loc]).toBeDefined();
  });

  it('populates the Station block, with a mole only when enabled', () => {
    const noMole = generate('alpha', inputs(false));
    expect(noMole.station.chief).toBeDefined();
    expect(noMole.station.staff.length).toBeGreaterThanOrEqual(2);
    expect(noMole.station.ledger.start).toBe(STANDARD.startingBudget);
    expect(noMole.station.mole).toBeUndefined();

    const withMole = generate('alpha', inputs(true));
    expect(withMole.station.mole).toBeDefined();
  });

  it('populates the player Cover Identity and known sets from the brief', () => {
    const world = generate('alpha', inputs());
    expect(world.player.cover.title.length).toBeGreaterThan(0);
    expect(world.player.cover.employerOrg.length).toBeGreaterThan(0);
    expect(world.player.known.entities.length).toBeGreaterThan(0);
    expect(world.player.known.channels.length).toBeGreaterThanOrEqual(1);
    expect(world.player.known.drops.length).toBeGreaterThanOrEqual(1);
    expect(world.player.contacts.length).toBeGreaterThanOrEqual(2);
    expect(world.player.burned).toBe(false);
  });

  it('populates documents with the brief Cable, Dossiers and public texts', () => {
    const world = generate('alpha', inputs());
    const docs = Object.values(world.documents);
    const kinds = new Set(docs.map((d) => d.kind));
    expect(kinds.has('cable')).toBe(true);
    expect(kinds.has('dossier')).toBe(true);
    expect(kinds.has('public-text')).toBe(true);
    // The brief Cable is a real Document keyed in the map.
    const cables = docs.filter((d) => d.kind === 'cable');
    expect(cables.length).toBeGreaterThanOrEqual(1);
    // Every public text is obtainable at a reading Location.
    for (const doc of docs.filter((d) => d.kind === 'public-text')) {
      expect((doc.obtainableAt?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it('leaves later-task sub-structures as empty placeholders', () => {
    const world = generate('alpha', inputs());
    expect(world.relationships).toEqual({});
    // `sideThreads` is no longer an empty placeholder: task 6.4 wires the noise
    // stream into generate(), so a generated world carries its Side Threads.
    // (See generate.noise.spec.ts for the noise pipeline's own coverage.)
    expect(world.sideThreads.length).toBe(STANDARD.noiseCounts.sideThreads);
    // `transmissions` is no longer an empty placeholder: task 26.3 seeds the
    // real ciphertext Intercepts for the world's interceptable firings. The
    // player has collected none yet, so `intercepts` still starts empty.
    // (See world-intercepts.spec.ts for the seeding's own coverage.)
    expect(world.transmissions.length).toBeGreaterThan(0);
    expect(world.intercepts).toEqual({});
    expect(world.meetings).toEqual({});
    expect(world.newspapers).toEqual({});
    expect(world.scheduled).toEqual([]);
    expect(world.ended).toBeUndefined();
  });

  it('serialises the core PRNG state onto rng (4 non-zero-capable words)', () => {
    const world = generate('alpha', inputs());
    expect(world.rng).toHaveLength(4);
    expect(world.rng.some((w) => w !== 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Generation defaults of the slice-integration World State fields
// ---------------------------------------------------------------------------

describe('generate — defaults for the slice-integration World State fields', () => {
  it('places every NPC, Background NPCs included, where its schedule puts it at the start', () => {
    for (const seed of ['alpha', 'bravo']) {
      const world = generate(seed, inputs(true));
      const ids = Object.keys(world.npcs).sort();
      expect(
        ids.some((id) => id.startsWith(`npc:${BACKGROUND_ID_PREFIX}-`)),
      ).toBe(true);
      expect(Object.keys(world.whereabouts).sort()).toEqual(ids);
      let placed = 0;
      for (const npc of Object.values(world.npcs)) {
        const loc = scheduledLocationAt(npc, world.time) ?? 'absent';
        expect(world.whereabouts[npc.id]).toBe(loc);
        if (loc !== 'absent') {
          expect(world.city.locations[loc]).toBeDefined();
          placed += 1;
        }
      }
      // Some NPCs are out and about at the start, so the check is not vacuous.
      expect(placed).toBeGreaterThan(0);
    }
  });

  it('starts the Told Lists, arrests, mole projection and feed log empty, with no scene open', () => {
    const world = generate('alpha', inputs(true));
    expect(world.told).toEqual({});
    expect(world.player.arrests).toEqual([]);
    expect(world.player.scene).toBeUndefined();
    expect(world.station.reportable).toEqual([]);
    expect(world.hostile.feedLog).toEqual([]);
  });

  it('starts with the materiel not seized and no traffic broken', () => {
    const world = generate('alpha', inputs(true));
    expect(world.plot.materielSeized).toBe(false);
    for (const transmission of world.transmissions) {
      expect(transmission.intercept.broken).toBeUndefined();
    }
  });

  it('starts every NPC, Background NPCs included, at large', () => {
    const world = generate('alpha', inputs(true));
    const npcs = Object.values(world.npcs);
    expect(
      npcs.some((npc) => npc.id.startsWith(`npc:${BACKGROUND_ID_PREFIX}-`)),
    ).toBe(true);
    for (const npc of npcs) {
      expect(npc.status).toBe('active');
    }
  });
});

// ---------------------------------------------------------------------------
// GeneratorError after the attempt limit (Requirement 1.6)
// ---------------------------------------------------------------------------

describe('generate — GeneratorError after the attempt limit (Req 1.6)', () => {
  /** A verifier that always rejects, with a seed-independent failing target. */
  const alwaysFail: typeof verifyDiscoveryPaths = (): DiscoveryResult => ({
    ok: false,
    root: {
      entities: new Set(),
      channels: new Set(),
      documents: new Set(),
      leads: new Set(),
    },
    stages: [],
    single: [],
    failure: {
      kind: 'stage',
      stage: 'stage:forced-failure',
      reason: 'forced failure for the attempt-limit test',
      hasHuman: false,
      hasSignal: false,
    },
  });

  it('throws a GeneratorError naming the seed after exhausting attempts', () => {
    expect(() =>
      generate('alpha', inputs(), { verifier: alwaysFail }),
    ).toThrowError(GeneratorError);
  });

  it('the error names the seed, the city, the attempt count and the failing reason', () => {
    try {
      // Isolate one setting attempt so the error's attempt count is the core
      // ceiling; the generator otherwise retries across setting attempts too
      // (content-expansion Req 9.9), which is exercised below.
      generate('doomed-seed', inputs(), {
        verifier: alwaysFail,
        maxSettingAttempts: 1,
      });
      throw new Error('expected generate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GeneratorError);
      const gen = err as GeneratorError;
      expect(gen.seed).toBe('doomed-seed');
      // With the setting step wired in, the outer loop raises the error once
      // every setting attempt (and its core retries) is exhausted; its attempt
      // count is the setting ceiling and its phase is `setting`
      // (content-expansion Req 9.9).
      expect(gen.phase).toBe('setting');
      expect(gen.attempts).toBe(1);
      expect(gen.city).toBe('core');
      expect(gen.message).toContain('doomed-seed');
      expect(gen.lastFailure?.reason).toContain('forced failure');
    }
  });

  it('respects a lower injected core attempt ceiling', () => {
    let calls = 0;
    const counting: typeof verifyDiscoveryPaths = (args) => {
      calls += 1;
      return alwaysFail(args);
    };
    expect(() =>
      generate('alpha', inputs(), {
        verifier: counting,
        maxAttempts: 3,
        // One setting attempt, so the core verifier runs exactly the core
        // ceiling number of times rather than once per setting attempt.
        maxSettingAttempts: 1,
      }),
    ).toThrowError(GeneratorError);
    expect(calls).toBe(3);
  });

  it('retries across setting attempts before giving up (content-expansion Req 9.9)', () => {
    let calls = 0;
    const counting: typeof verifyDiscoveryPaths = (args) => {
      calls += 1;
      return alwaysFail(args);
    };
    // 2 setting attempts × 2 core attempts each ⇒ the core verifier runs 4
    // times before the setting-phase GeneratorError is thrown.
    try {
      generate('alpha', inputs(), {
        verifier: counting,
        maxAttempts: 2,
        maxSettingAttempts: 2,
      });
      throw new Error('expected generate to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GeneratorError);
      const gen = err as GeneratorError;
      expect(gen.phase).toBe('setting');
      expect(gen.attempts).toBe(2);
    }
    expect(calls).toBe(4);
  });

  it('succeeds on a later attempt when the gate passes after a retry', () => {
    let calls = 0;
    // Fail the first two attempts, then defer to the real verifier.
    const flaky: typeof verifyDiscoveryPaths = (args) => {
      calls += 1;
      if (calls <= 2) {
        return alwaysFail(args);
      }
      return verifyDiscoveryPaths(args);
    };
    const world = generate('alpha', inputs(), { verifier: flaky });
    // The display seed is still the caller's seed even though the world was
    // drawn from derive('alpha', 2).
    expect(world.meta.seed).toBe('alpha');
    expect(calls).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// randomSeed and the stream registry
// ---------------------------------------------------------------------------

describe('randomSeed — fresh display seeds (design step 9)', () => {
  it('mints a non-empty, readable seed, varying across calls', () => {
    const a = randomSeed();
    const b = randomSeed();
    expect(a.length).toBeGreaterThan(0);
    expect(/^[a-z0-9]+$/.test(a)).toBe(true);
    // Two fresh seeds are overwhelmingly unlikely to collide.
    expect(a).not.toBe(b);
  });

  it('a minted seed drives a deterministic world', () => {
    const seed = randomSeed();
    const a = generate(seed, inputs());
    const b = generate(seed, inputs());
    expect(a).toEqual(b);
  });
});

describe('stream registry constants', () => {
  it('names the noise stream base without using it here', () => {
    expect(NOISE_STREAM_BASE).toBe(0x10000);
  });
});
