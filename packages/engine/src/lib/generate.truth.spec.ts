/**
 * Tests for task 26.4 — applying the mole and seeding the Truth Store at
 * generation (design, "World Generator", step 7 and "When the World State is
 * assembled, the Truth Store is seeded with every core and noise ground-truth
 * Proposition"; Requirements 1.5, 2.1, 27.6).
 *
 * These drive the *real* `generateGame()` path over the real core pack and
 * assert the behaviour the task owns:
 *
 * - **Mole application (Req 1.5).** When the scenario enables the mole,
 *   `generate` rewrites the designated staffer's *true* allegiance to the
 *   Hostile Service while leaving its *apparent* allegiance as `station`, and
 *   sets `station.mole`. When the mole is disabled, no NPC's true allegiance is
 *   the Hostile Service by designation and `station.mole` is absent.
 * - **Truth Store seeding (Req 2.1, 27.6).** `generateGame` returns a Truth
 *   Store already seeded so `holds` answers the mole's `REPORTS_TO` fact and
 *   every Plot Stage's key Proposition from the first turn, and records the
 *   mole's true allegiance.
 * - **False beliefs are absent.** A false belief is detectably false precisely
 *   because the Truth Store does not hold it: HQ false leads do not `holds`.
 * - **Determinism (Req 1.2).** The seeded Truth Store is a pure function of the
 *   seed: two generations yield the same fact set and the same `holds` verdicts.
 *
 * The per-stage key Propositions are read from the discovery verifier's
 * {@link TargetReport}s (its `prop` is the key operation fact each stage's
 * disjoint paths lead to), rebuilt from the identical core stream the gate
 * verified — exactly the pattern `generate.solvability.spec.ts` uses.
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

import { createPrng } from './prng/prng.js';
import { type GameTime, type OrgId, type Proposition } from './model/core.js';
import { generateCity } from './city/generate.js';
import { settingStreamSeed } from './setting/stream.js';
import { drawSetting } from './setting/setting.js';
import { isContentSetV2, type ContentSetV2 } from './setting/content-set-v2.js';
import { parseIsoDate } from '@tradecraft/content';
import {
  generateOrgs,
  generatePrincipals,
} from './city/principals.js';
import { generatePlot } from './city/plot.js';
import { generateComms } from './city/comms.js';
import { assignKnowledge, type GeneratedKnowledge } from './city/knowledge.js';
import { generateStartingBrief } from './city/starting-brief.js';
import {
  verifyDiscoveryPaths,
  type DiscoveryInputs,
  type TargetReport,
} from './city/discovery.js';
import {
  ScenarioConfigSchema,
  type ScenarioConfig,
} from './config/scenario-config.js';
import {
  generateGame,
  type GenerateInputs,
} from './generate.js';

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

const STANDARD = preset('standard');
const START: GameTime = { day: 0, phase: 0 };

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

function inputs(mole = false): GenerateInputs {
  return {
    content,
    preset: STANDARD,
    scenario: scenario(mole),
    cityData,
    descriptors,
    publicTexts,
  };
}

/**
 * Rebuild the step-1→8 core stream for a seed and run the discovery verifier —
 * the same stream `generate` hands its gate — so its {@link TargetReport}s name
 * the exact key Proposition each Plot Stage's paths lead to (and, with a mole,
 * the mole identity fact). Mirrors `generate.solvability.spec.ts`'s `gen`.
 */
function discoveryReports(
  seed: string,
  mole: boolean,
): { knowledge: GeneratedKnowledge; stages: readonly TargetReport[]; moleReport?: TargetReport } {
  // Mirror `generate`'s setting step (content-expansion task 3.8): step 1 (the
  // Core City) runs on the setting stream `derive(seed, 0x30000 + 0)`, so the
  // core stream (orgs onward) starts at step 2 on a fresh `createPrng(seed)`.
  const setV2 = isContentSetV2(content)
    ? (content as ContentSetV2)
    : (content as ContentSetV2);
  const settingPrng = createPrng(settingStreamSeed(seed, 0));
  const selection = drawSetting(setV2, scenario(mole).setting, settingPrng, 0);
  const startMonth = parseIsoDate(selection.startDate)?.month ?? 1;
  const { city } = generateCity(settingPrng, locationTypes, cityData, {
    startMonth,
  });

  const prng = createPrng(seed);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs);
  const { plot } = generatePlot(prng, content, STANDARD, city, orgs, principals, START);
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
    cableTemplate(),
    { city, npcs: principals.npcs, orgs: orgs.orgs },
    { startingBudget: STANDARD.startingBudget },
  );
  const discoveryInputs: DiscoveryInputs = {
    brief,
    plot,
    knowledge,
    comms,
    city,
    orgs,
    principals,
  };
  const result = verifyDiscoveryPaths(discoveryInputs);
  const out: {
    knowledge: GeneratedKnowledge;
    stages: readonly TargetReport[];
    moleReport?: TargetReport;
  } = { knowledge, stages: result.stages };
  if (result.mole !== undefined) {
    out.moleReport = result.mole;
  }
  return out;
}

function cableTemplate() {
  for (const [key, value] of content.documentTemplates) {
    if (key === 'cable-hq-directive' || key.endsWith('/cable-hq-directive')) {
      return value;
    }
  }
  throw new Error('no cable template');
}

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo-123', 'z', 'q1', 'w2'];

// ---------------------------------------------------------------------------
// The mole is applied to the NPC record (Req 1.5)
// ---------------------------------------------------------------------------

describe('generate — applies the MoleAssignment (Req 1.5)', () => {
  it('rewrites the mole\'s true allegiance to the Hostile Service, apparent stays station', () => {
    for (const seed of SEEDS) {
      const { world } = generateGame(seed, inputs(true));
      const moleId = world.station.mole;
      expect(moleId).toBeDefined();
      if (moleId === undefined) {
        throw new Error('expected a mole when enabled');
      }
      const mole = world.npcs[moleId];
      expect(mole).toBeDefined();
      // The mole is a Station staffer; its apparent allegiance stays `station`.
      expect(world.station.staff).toContain(moleId);
      expect(mole.apparentAllegiance).toBe('station');
      // Its true allegiance is now the Hostile Service org (ground truth).
      expect(mole.trueAllegiance.org).toBe(hostileOrgId(world));
    }
  });

  it('designates no mole and rewrites no allegiance when the scenario disables it', () => {
    for (const seed of SEEDS) {
      const { world } = generateGame(seed, inputs(false));
      expect(world.station.mole).toBeUndefined();
      // No Station staffer secretly serves the Hostile Service.
      const hostile = hostileOrgId(world);
      for (const staffId of world.station.staff) {
        expect(world.npcs[staffId].trueAllegiance.org).not.toBe(hostile);
      }
    }
  });
});

/** The Hostile Service org's id in the world (the org whose kind is `hostile`). */
function hostileOrgId(world: ReturnType<typeof generateGame>['world']): OrgId {
  for (const org of Object.values(world.orgs)) {
    if (org.kind === 'hostile') {
      return org.id;
    }
  }
  throw new Error('no hostile org in the world');
}

// ---------------------------------------------------------------------------
// holds answers the mole's REPORTS_TO and each stage's key Proposition (Req 2.1)
// ---------------------------------------------------------------------------

describe('generate — seeds the Truth Store so holds answers from turn one (Req 2.1, 27.6)', () => {
  it('holds the mole\'s REPORTS_TO fact (and every mole fact)', () => {
    for (const seed of SEEDS) {
      const { world, truth } = generateGame(seed, inputs(true));
      const { knowledge } = discoveryReports(seed, true);
      expect(knowledge.mole).toBeDefined();
      if (knowledge.mole === undefined) {
        throw new Error('expected a mole');
      }
      const reportsTo = knowledge.mole.facts.find((f) => f.predicate === 'REPORTS_TO');
      expect(reportsTo).toBeDefined();
      if (reportsTo === undefined) {
        throw new Error('mole has no REPORTS_TO fact');
      }
      // The mole's REPORTS_TO the hostile resident holds in the seeded store.
      expect(truth.holds(reportsTo, START)).toBe(true);
      // Every mole fact (REPORTS_TO and MEMBER_OF the Hostile Service) holds.
      for (const fact of knowledge.mole.facts) {
        expect(truth.holds(fact, START)).toBe(true);
      }
      // The mole's true allegiance is recorded as ground truth.
      const moleId = world.station.mole;
      if (moleId === undefined) {
        throw new Error('expected a mole on the station block');
      }
      const allegiance = truth.allegiance(moleId);
      expect(allegiance).toBeDefined();
      expect(allegiance?.org).toBe('org:hostile');
    }
  });

  it('holds every Plot Stage\'s key Proposition', () => {
    for (const seed of SEEDS) {
      for (const mole of [false, true]) {
        const { truth } = generateGame(seed, inputs(mole));
        const { stages, moleReport } = discoveryReports(seed, mole);
        expect(stages.length).toBeGreaterThan(0);
        // Each Plot Stage's key operation fact holds in the seeded store.
        for (const report of stages) {
          expect(truth.holds(report.prop, START)).toBe(true);
        }
        // When a mole is enabled, its identity fact (the discovery target) holds.
        if (mole) {
          expect(moleReport).toBeDefined();
          if (moleReport === undefined) {
            throw new Error('expected a mole report');
          }
          expect(truth.holds(moleReport.prop, START)).toBe(true);
        }
      }
    }
  });

  it('seeds every core and noise ground-truth Proposition', () => {
    for (const seed of SEEDS) {
      const { world, truth } = generateGame(seed, inputs(true));
      const { knowledge } = discoveryReports(seed, true);
      // Every true known fact across the slices and the mole facts holds.
      for (const fact of knowledge.truthFacts) {
        expect(truth.holds(fact, START)).toBe(true);
      }
      // Every Side Thread's true Proposition (the noise ground truth) holds.
      const threadProps: Proposition[] = world.sideThreads.flatMap(
        (t) => [...t.propositions],
      );
      for (const prop of threadProps) {
        expect(truth.holds(prop, START)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// False beliefs are detectably false (absent from the store)
// ---------------------------------------------------------------------------

describe('generate — HQ false beliefs are not seeded (so they are detectably false)', () => {
  it('does not hold a Station false belief that is absent from the truth fact set', () => {
    // `holds` matches by content (subject/predicate/object/place), not id, so a
    // false belief only fails to hold when no *true* fact shares its content.
    const contentKey = (p: Proposition): string =>
      JSON.stringify([p.subject, p.predicate, p.object, p.place ?? null]);

    let checked = 0;
    for (const seed of SEEDS) {
      const { truth } = generateGame(seed, inputs());
      const { knowledge } = discoveryReports(seed, false);
      const trueKeys = new Set(knowledge.truthFacts.map(contentKey));
      // Only beliefs whose content coincides with no true fact are genuinely
      // false; those must not hold in the seeded store.
      const genuinelyFalse = knowledge.station.falseBeliefs.filter(
        (f) => !trueKeys.has(contentKey(f)),
      );
      for (const belief of genuinelyFalse) {
        expect(truth.holds(belief, START)).toBe(false);
        checked += 1;
      }
    }
    // The core pack's standard preset manufactures HQ false leads, so at least
    // one genuinely-false belief was exercised across the seed set.
    expect(checked).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism (Req 1.2): the seeded store is a pure function of the seed
// ---------------------------------------------------------------------------

describe('generate — the seeded Truth Store is deterministic (Req 1.2)', () => {
  it('two generations yield the same fact set and the same holds verdicts', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SEEDS), fc.boolean(), (seed, mole) => {
        const a = generateGame(seed, inputs(mole));
        const b = generateGame(seed, inputs(mole));
        // The fact lists are byte-identical (snapshot compares plain data).
        expect(a.truth.snapshot().facts).toEqual(b.truth.snapshot().facts);
        // And holds agrees on every seeded fact.
        for (const fact of a.truth.snapshot().facts) {
          expect(a.truth.holds(fact, START)).toBe(b.truth.holds(fact, START));
        }
      }),
      { numRuns: 24 },
    );
  });
});
