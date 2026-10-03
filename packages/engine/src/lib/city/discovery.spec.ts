/**
 * Tests for the discovery-path verifier (task 5.8; Requirements 1.4, 26.3,
 * 27.6; Properties 2 and 19).
 *
 * These load the real core pack, its `city.yaml` and `descriptors.yaml`, run the
 * full step-1→8 core stream (city, orgs, principals, Plot, comms, knowledge,
 * Starting Brief), then run {@link verifyDiscoveryPaths} and check the
 * invariants the design and the requirements fix:
 *
 * - **Acceptance (design step 10; Property 2).** The verifier accepts a
 *   well-formed generated world: `ok` is true, every Plot Stage has a report
 *   with two node-disjoint witnesses, one human (meeting) and one signal
 *   (intercept or surveillance).
 * - **Rootedness (Property 19).** The verifier's root set equals the Starting
 *   Brief's known entities, lead Claims (by content), Channels and Documents.
 * - **Leads in the Station slice (Property 19).** Every initial lead is a member
 *   of the Station's Knowledge Slice — checked at the brief layer, re-asserted
 *   here against the verifier's root.
 * - **Mole identity (Property 19).** When a mole is enabled, the mole identity
 *   has two disjoint human/signal discovery paths.
 * - **Rejection.** A world whose signal (intercept/surveillance) or human routes
 *   are removed is rejected with a precise reason — the verifier does not
 *   always-pass.
 * - **Determinism.** The verifier makes no draws: the same world yields an
 *   identical result.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type DocumentTemplate,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { type GameTime, type EntityId } from '../model/core.js';
import { generateCity } from './generate.js';
import { type City } from './city.js';
import {
  generateOrgs,
  generatePrincipals,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from './principals.js';
import { generatePlot, type PlotState } from './plot.js';
import { generateComms, type GeneratedComms } from './comms.js';
import { assignKnowledge, type GeneratedKnowledge } from './knowledge.js';
import { generateStartingBrief, type StartingBrief } from './starting-brief.js';
import {
  discoveryPathsHold,
  discoveryRoot,
  isHumanEdge,
  isSignalEdge,
  propKey,
  verifyDiscoveryPaths,
  witnessesDisjoint,
  type DiscoveryInputs,
  type PathWitness,
} from './discovery.js';

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
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
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
  };
}

const { content, cityData, descriptors } = loadCore();
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

interface Generated {
  readonly city: City;
  readonly orgs: GeneratedOrgs;
  readonly principals: GeneratedPrincipals;
  readonly plot: PlotState;
  readonly comms: GeneratedComms;
  readonly knowledge: GeneratedKnowledge;
  readonly brief: StartingBrief;
}

/** Run the full step-1→8 generation on one core stream for a seed. */
function gen(seed: string, mole: boolean, p: DifficultyPreset = STANDARD): Generated {
  const prng = createPrng(seed);
  const { city } = generateCity(prng, locationTypes, cityData);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs);
  const { plot } = generatePlot(prng, content, p, city, orgs, principals, START);
  const comms = generateComms(prng, content, city, orgs, principals, plot, START);
  const knowledge = assignKnowledge(
    prng,
    orgs,
    principals,
    plot,
    comms,
    city,
    { hqFalseBeliefRate: p.hqFalseBeliefRate },
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
    { startingBudget: p.startingBudget },
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

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo-123', 'z', 'q1', 'w2'];

// ---------------------------------------------------------------------------
// Acceptance (design step 10; Property 2)
// ---------------------------------------------------------------------------

describe('verifyDiscoveryPaths — accepts a well-formed generated world (Property 2)', () => {
  it('is ok for every seed, with and without a mole', () => {
    for (const seed of SEEDS) {
      for (const mole of [false, true]) {
        const result = verifyDiscoveryPaths(inputsOf(gen(seed, mole)));
        expect(result.ok).toBe(true);
        expect(result.failure).toBeUndefined();
      }
    }
  });

  it('covers every Plot Stage with at least one report', () => {
    for (const seed of SEEDS) {
      const g = gen(seed, false);
      const result = verifyDiscoveryPaths(inputsOf(g));
      // The tightened verifier reports one dual-pathed witness per key fact a
      // stage's traces evidence, so a stage may contribute several reports; the
      // guarantee is that every Plot Stage is covered by at least one.
      expect(result.stages.length).toBeGreaterThanOrEqual(g.plot.stages.length);
      const stageIds = new Set(result.stages.map((s) => s.stage));
      for (const stage of g.plot.stages) {
        expect(stageIds.has(stage.id)).toBe(true);
      }
    }
  });

  it('each stage report has one human and one signal witness that are node-disjoint', () => {
    for (const seed of SEEDS) {
      const result = verifyDiscoveryPaths(inputsOf(gen(seed, false)));
      for (const report of result.stages) {
        expect(isHumanEdge(report.human.edge)).toBe(true);
        expect(isSignalEdge(report.signal.edge)).toBe(true);
        expect(witnessesDisjoint(report.human, report.signal)).toBe(true);
      }
    }
  });

  it('discoveryPathsHold agrees with the full result', () => {
    for (const seed of SEEDS) {
      for (const mole of [false, true]) {
        const inputs = inputsOf(gen(seed, mole));
        expect(discoveryPathsHold(inputs)).toBe(verifyDiscoveryPaths(inputs).ok);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Rootedness (Property 19)
// ---------------------------------------------------------------------------

describe('verifyDiscoveryPaths — root set equals the Starting Brief (Property 19)', () => {
  it("the verifier's root channels and documents equal the brief's", () => {
    for (const seed of SEEDS) {
      const g = gen(seed, false);
      const result = verifyDiscoveryPaths(inputsOf(g));
      expect([...result.root.channels].sort()).toEqual([...g.brief.channels].sort());
      const docs = new Set<string>([g.brief.cable, ...g.brief.dossiers]);
      expect([...result.root.documents].sort()).toEqual([...docs].sort());
    }
  });

  it("the root entities include every known entity the brief carries", () => {
    for (const seed of SEEDS) {
      const g = gen(seed, false);
      const root = discoveryRoot(g.brief);
      for (const e of g.brief.knownEntities as readonly EntityId[]) {
        expect(root.entities.has(e)).toBe(true);
      }
    }
  });

  it('the root leads equal the brief leads by content, each in the Station slice', () => {
    for (const seed of SEEDS) {
      const g = gen(seed, false);
      const root = discoveryRoot(g.brief);
      const briefLeadKeys = new Set(g.brief.leads.map((l) => propKey(l.prop)));
      expect(new Set(root.leads)).toEqual(briefLeadKeys);

      // Every initial lead is a member of the Station's Knowledge Slice.
      const sliceKeys = new Set(
        [...g.knowledge.station.known, ...g.knowledge.station.falseBeliefs].map(
          propKey,
        ),
      );
      for (const lead of g.brief.leads) {
        expect(sliceKeys.has(propKey(lead.prop))).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Mole identity (Property 19 mole clause)
// ---------------------------------------------------------------------------

describe('verifyDiscoveryPaths — the mole identity has two disjoint paths (Property 19)', () => {
  it('reports a dual-pathed mole target when a mole is enabled', () => {
    for (const seed of SEEDS) {
      const g = gen(seed, true);
      const result = verifyDiscoveryPaths(inputsOf(g));
      expect(result.mole).toBeDefined();
      const mole = result.mole;
      if (mole === undefined) {
        throw new Error('expected a mole report');
      }
      expect(isHumanEdge(mole.human.edge)).toBe(true);
      expect(isSignalEdge(mole.signal.edge)).toBe(true);
      expect(witnessesDisjoint(mole.human, mole.signal)).toBe(true);
      // The mole target is the mole's Hostile-Service allegiance fact.
      expect(mole.prop.subject).toBe(g.knowledge.mole?.npc);
    }
  });

  it('reports no mole target when the mole is disabled', () => {
    for (const seed of SEEDS) {
      const result = verifyDiscoveryPaths(inputsOf(gen(seed, false)));
      expect(result.mole).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Rejection — the verifier does not always-pass
// ---------------------------------------------------------------------------

describe('verifyDiscoveryPaths — rejects a world with no viable path (does not always-pass)', () => {
  it('rejects when every Channel is removed and meet Locations are hidden (no signal route)', () => {
    const g = gen('alpha', true);
    // Strip all Channels (no intercept) and make all Locations non-public (no
    // surveillance, and nobody is reachable at a known Location).
    const noChannels: GeneratedComms = { ...g.comms, channels: {} };
    const privateCity: City = {
      ...g.city,
      locations: Object.fromEntries(
        Object.entries(g.city.locations).map(([id, loc]) => [id, { ...loc, public: false }]),
      ),
    };
    const isolatedBrief: StartingBrief = {
      ...g.brief,
      knownEntities: [],
      contacts: [],
    };
    const result = verifyDiscoveryPaths({
      brief: isolatedBrief,
      plot: g.plot,
      knowledge: g.knowledge,
      comms: noChannels,
      city: privateCity,
      orgs: g.orgs,
      principals: g.principals,
    });
    expect(result.ok).toBe(false);
    expect(result.failure).toBeDefined();
    expect(result.failure?.reason.length ?? 0).toBeGreaterThan(0);
  });

  it('rejects when Channels are removed but Locations stay public (surveillance alone is not enough)', () => {
    const g = gen('bravo', false);
    // No Channels at all: MEETS_AT keeps its surveillance route, but CARRIES and
    // USES_CHANNEL lose their only signal route, so a key fact fails.
    const noChannels: GeneratedComms = { ...g.comms, channels: {} };
    const result = verifyDiscoveryPaths({ ...inputsOf(g), comms: noChannels });
    expect(result.ok).toBe(false);
    expect(result.failure?.hasHuman).toBe(true);
    expect(result.failure?.hasSignal).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism (the verifier makes no draws)
// ---------------------------------------------------------------------------

describe('verifyDiscoveryPaths — deterministic (no PRNG draws)', () => {
  it('yields an identical result for the same world', () => {
    for (const seed of SEEDS) {
      const g = gen(seed, true);
      const a = verifyDiscoveryPaths(inputsOf(g));
      const b = verifyDiscoveryPaths(inputsOf(g));
      expect(a).toEqual(b);
    }
  });

  it('witnesses stay disjoint and well-typed across the seed set (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SEEDS), fc.boolean(), (seed, mole) => {
        const result = verifyDiscoveryPaths(inputsOf(gen(seed, mole)));
        expect(result.ok).toBe(true);
        const reports = [...result.stages, ...(result.mole ? [result.mole] : [])];
        for (const r of reports) {
          // Exactly the right node is set per edge kind.
          expectWitnessShape(r.human);
          expectWitnessShape(r.signal);
          expect(witnessesDisjoint(r.human, r.signal)).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });
});

/** A witness names exactly the node its edge kind implies. */
function expectWitnessShape(w: PathWitness): void {
  if (w.edge === 'meeting') {
    expect(typeof w.npc).toBe('string');
  } else if (w.edge === 'intercept') {
    expect(typeof w.channel).toBe('string');
  } else if (w.edge === 'surveillance') {
    expect(typeof w.loc).toBe('string');
  }
}
