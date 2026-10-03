/**
 * Property test for **Property 19 — Starting Brief rootedness** (task 5.12;
 * Requirements 1.4, 26.2, 26.3, 27.6).
 *
 * These load the real core pack, its `city.yaml` and `descriptors.yaml`, run the
 * full step-1→8 core stream (city, orgs, principals, Plot, comms, knowledge,
 * Starting Brief), then build {@link DiscoveryInputs} and exercise
 * {@link verifyDiscoveryPaths} / {@link discoveryRoot} as fast-check properties
 * over varied seeds. Property 19 fixes three clauses, each tested here:
 *
 * - **Clause 1 — the root *is* the brief.** The verifier's root set equals the
 *   Starting Brief's known entities (a superset — the root adds the Chief and
 *   lead participants defensively), its lead Claims (by content key), its
 *   Channels and its Documents (the Cable and any Dossiers), as sets.
 * - **Clause 2 — leads ⊆ the Station slice (Req 26.2).** Every initial lead's
 *   content key is a member of the Station's Knowledge Slice — its true
 *   Propositions or its HQ false beliefs.
 * - **Clause 3 — mole dual-path.** When a mole is enabled, the result's mole
 *   target is defined with a human (meeting) and a signal (intercept/
 *   surveillance) witness that are node-disjoint.
 *
 * This file owns a filename distinct from `starting-brief.spec.ts` and
 * `discovery.spec.ts` to avoid concurrent-edit collisions; it reuses the same
 * loader + full-pipeline helper pattern those files use. It is a test-only
 * artefact and asserts against the real generators — no mocks, no stubs.
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
  discoveryRoot,
  isHumanEdge,
  isSignalEdge,
  propKey,
  verifyDiscoveryPaths,
  witnessesDisjoint,
  type DiscoveryInputs,
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

/**
 * A varied seed arbitrary: short alphanumeric strings (plus some punctuation the
 * briefing-cable ref sanitiser tolerates). Non-empty so `createPrng` always has
 * material to fold.
 */
const seedArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => s.trim().length > 0);

// ---------------------------------------------------------------------------
// Property 19, clause 1 — the verifier's root equals the Starting Brief
// ---------------------------------------------------------------------------

describe('Property 19 — Starting Brief rootedness: the root is the brief (clause 1)', () => {
  it('root channels, documents, lead Claims and known entities track the brief (Req 1.4, 26.3, 27.6)', () => {
    fc.assert(
      fc.property(seedArb, fc.boolean(), (seed, mole) => {
        const g = gen(seed, mole);
        const brief = g.brief;

        // The verifier's own root and the standalone discoveryRoot agree, and
        // both are what the clause reads.
        const root = verifyDiscoveryPaths(inputsOf(g)).root;
        expect(discoveryRoot(brief)).toEqual(root);

        // Channels: equal as sets.
        expect(new Set(root.channels)).toEqual(new Set(brief.channels));

        // Documents: the Cable plus any Dossiers, as a set.
        const briefDocs = new Set<string>([brief.cable, ...brief.dossiers]);
        expect(new Set(root.documents)).toEqual(briefDocs);

        // Known entities: the root is a superset of every entity the brief
        // carries (the root adds the Chief and lead participants defensively).
        for (const e of brief.knownEntities as readonly EntityId[]) {
          expect(root.entities.has(e)).toBe(true);
        }

        // Lead Claims: equal, keyed by content, to the brief's leads.
        const briefLeadKeys = new Set(brief.leads.map((l) => propKey(l.prop)));
        expect(new Set(root.leads)).toEqual(briefLeadKeys);
      }),
      { numRuns: 40 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 19, clause 2 — every lead is a member of the Station slice (Req 26.2)
// ---------------------------------------------------------------------------

describe('Property 19 — Starting Brief rootedness: leads ⊆ Station slice (clause 2)', () => {
  it('every initial lead key is in the Station slice (true Propositions or false beliefs) (Req 26.2)', () => {
    fc.assert(
      fc.property(seedArb, fc.boolean(), (seed, mole) => {
        const g = gen(seed, mole);
        const sliceKeys = new Set(
          [
            ...g.knowledge.station.known,
            ...g.knowledge.station.falseBeliefs,
          ].map(propKey),
        );
        for (const lead of g.brief.leads) {
          expect(sliceKeys.has(propKey(lead.prop))).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 19, clause 3 — the mole identity has two disjoint discovery paths
// ---------------------------------------------------------------------------

describe('Property 19 — Starting Brief rootedness: mole dual-path (clause 3)', () => {
  it('a mole-enabled world reports a node-disjoint human + signal mole target (Req 1.4, 26.3, 27.6)', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const g = gen(seed, true);
        const result = verifyDiscoveryPaths(inputsOf(g));
        const mole = result.mole;
        expect(mole).toBeDefined();
        if (mole === undefined) {
          throw new Error('expected a mole report when a mole is enabled');
        }
        expect(isHumanEdge(mole.human.edge)).toBe(true);
        expect(isSignalEdge(mole.signal.edge)).toBe(true);
        expect(witnessesDisjoint(mole.human, mole.signal)).toBe(true);
        // The mole target concerns the mole NPC's allegiance.
        expect(mole.prop.subject).toBe(g.knowledge.mole?.npc);
      }),
      { numRuns: 40 },
    );
  });

  it('a mole-disabled world reports no mole target', () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const result = verifyDiscoveryPaths(inputsOf(gen(seed, false)));
        expect(result.mole).toBeUndefined();
      }),
      { numRuns: 30 },
    );
  });
});
