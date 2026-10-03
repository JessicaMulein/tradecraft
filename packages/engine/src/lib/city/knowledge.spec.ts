/**
 * Tests for knowledge assignment (task 5.5; Requirements 1.3, 1.5, 26.2).
 *
 * These load the real core pack, its `city.yaml` and `descriptors.yaml`, run
 * the full step-1→5 core stream (city, orgs, principals, Plot, comms) on one
 * PRNG stream, then run step 6/7 ({@link assignKnowledge}) and check the
 * invariants the design fixes:
 *
 * - every Principal NPC gets a Knowledge Slice; concealed NPCs get a Cover
 *   Story and a concealing Agenda (Req 1.3);
 * - a Cell member knows plot-adjacent propositions, more for the leader than
 *   for a lesser role (stage proximity, design step 6);
 * - the Station's slice carries HQ false beliefs at the preset rate within
 *   tolerance, and the Starting-Brief leads (the slice) are real-and-false
 *   mixed (Req 26.2);
 * - every true `known` proposition holds in a Truth Store built from the
 *   returned facts, and every Station false belief does not hold (Req 26.2);
 * - the mole, when enabled, is a Station staff NPC whose true allegiance is the
 *   Hostile Service, never the Chief (Req 1.5);
 * - every entity named in a slice is in that slice's known-entity set and is a
 *   real generated entity;
 * - and — the determinism that underpins Property 1 — the same seed and content
 *   produce an identical result.
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
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import {
  revealTruth,
  type EntityId,
  type GameTime,
  type NpcId,
  type Proposition,
} from '../model/core.js';
import { TruthStore } from '../truth/truth.js';
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
import {
  CELL_ROLE_PROXIMITY,
  assignKnowledge,
  slicePropsAreKnown,
  type GeneratedKnowledge,
} from './knowledge.js';

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

const STANDARD = preset('standard');
const START: GameTime = { day: 0, phase: 0 };

interface Generated {
  readonly city: City;
  readonly orgs: GeneratedOrgs;
  readonly principals: GeneratedPrincipals;
  readonly plot: PlotState;
  readonly comms: GeneratedComms;
  readonly knowledge: GeneratedKnowledge;
}

/** Run the full step-1→6/7 generation on one core stream for a seed. */
function gen(
  seed: string,
  opts: { mole?: boolean; rate?: number } = {},
  p: DifficultyPreset = STANDARD,
): Generated {
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
    { hqFalseBeliefRate: opts.rate ?? p.hqFalseBeliefRate },
    { mole: opts.mole },
  );
  return { city, orgs, principals, plot, comms, knowledge };
}

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo-123', 'z'];

/** Every entity id generated: NPCs, orgs, Locations, drops, channels, items. */
function realEntities(g: Generated): Set<EntityId> {
  const set = new Set<EntityId>();
  for (const id of Object.keys(g.principals.npcs)) set.add(id as EntityId);
  for (const id of Object.keys(g.orgs.orgs)) set.add(id as EntityId);
  for (const id of Object.keys(g.city.locations)) set.add(id as EntityId);
  // The Plot materiel is a real item.
  set.add(revealTruth(g.plot.materiel) as EntityId);
  return set;
}

/** Build a Truth Store from a knowledge result's facts. */
function truthStoreFrom(g: Generated): TruthStore {
  const store = TruthStore.create(content.predicates.evaluators);
  store.transaction((tx) => {
    for (const fact of g.knowledge.truthFacts) {
      tx.addFact(fact);
    }
  });
  return store;
}

// ---------------------------------------------------------------------------
// Every NPC gets a slice (Req 1.3)
// ---------------------------------------------------------------------------

describe('assignKnowledge — every NPC gets a slice (Req 1.3)', () => {
  it('assigns a Knowledge Slice, Cover Story and Agenda to every Principal NPC', () => {
    for (const seed of SEEDS) {
      const { principals, knowledge } = gen(seed);
      const ids = Object.keys(principals.npcs) as NpcId[];
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        const k = knowledge.byNpc[id];
        expect(k).toBeDefined();
        expect(Array.isArray(k.knowledge.known)).toBe(true);
        expect(Array.isArray(k.knowledge.falseBeliefs)).toBe(true);
        expect(Array.isArray(k.knowledge.knownEntities)).toBe(true);
        expect(Array.isArray(k.cover.presents)).toBe(true);
        expect(Array.isArray(k.agenda.conceal)).toBe(true);
      }
    }
  });

  it('gives concealed NPCs (Cell/hostile) a Cover Story and a concealing Agenda', () => {
    for (const seed of SEEDS) {
      const { principals, knowledge } = gen(seed);
      for (const id of Object.keys(principals.npcs) as NpcId[]) {
        const npc = principals.npcs[id];
        const k = knowledge.byNpc[id];
        if (npc.role === 'cell' || npc.role === 'hostile-officer') {
          expect(k.cover.presents.length).toBeGreaterThan(0);
          // A concealed NPC conceals at least their membership.
          expect(k.agenda.conceal.length).toBeGreaterThan(0);
        } else {
          expect(k.cover.presents.length).toBe(0);
          expect(k.agenda.conceal.length).toBe(0);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Stage proximity: a Cell member knows plot-adjacent propositions
// ---------------------------------------------------------------------------

describe('assignKnowledge — Cell members know plot-adjacent propositions', () => {
  it('every Cell member knows at least their own Cell membership', () => {
    for (const seed of SEEDS) {
      const { principals, orgs, knowledge } = gen(seed);
      for (const id of principals.cell) {
        const known = knowledge.byNpc[id].knowledge.known;
        const knowsOwnMembership = known.some(
          (p) =>
            p.predicate === 'MEMBER_OF' &&
            p.subject === id &&
            p.object === orgs.cell.id,
        );
        expect(knowsOwnMembership).toBe(true);
      }
    }
  });

  it('the leader knows at least as many plot propositions as a lesser Cell role', () => {
    for (const seed of SEEDS) {
      const { principals, knowledge } = gen(seed);
      const leader = principals.cell[0];
      const leaderKnown = knowledge.byNpc[leader].knowledge.known.length;
      // Compare against the financier (lowest proximity).
      const financier = principals.cell.find((id) => {
        const a = principals.npcs[id].archetype;
        return a.endsWith('cell-financier');
      });
      expect(financier).toBeDefined();
      const financierKnown =
        knowledge.byNpc[financier as NpcId].knowledge.known.length;
      expect(leaderKnown).toBeGreaterThanOrEqual(financierKnown);
      // The proximity table backs this: leader == 1, financier < 1.
      expect(CELL_ROLE_PROXIMITY['cell-leader']).toBeGreaterThanOrEqual(
        CELL_ROLE_PROXIMITY['cell-financier'],
      );
    }
  });

  it('a Cell member knows plot propositions beyond bare membership', () => {
    // The leader, at full proximity, knows PLANS/TARGETS/etc., not only members.
    for (const seed of SEEDS) {
      const { principals, knowledge } = gen(seed);
      const leader = principals.cell[0];
      const known = knowledge.byNpc[leader].knowledge.known;
      const nonMembership = known.filter((p) => p.predicate !== 'MEMBER_OF');
      expect(nonMembership.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// The Station slice and HQ false beliefs (Req 26.2)
// ---------------------------------------------------------------------------

describe('assignKnowledge — Station slice and HQ false beliefs (Req 26.2)', () => {
  it('honours the HQ false-belief rate within tolerance across seeds', () => {
    // rate 0.0 -> no false beliefs; rate 1.0 -> all false; a mid rate ~ matches.
    for (const seed of SEEDS) {
      const zero = gen(seed, { rate: 0 }).knowledge.station;
      expect(zero.falseBeliefs.length).toBe(0);
      expect(zero.known.length).toBeGreaterThan(0);

      const all = gen(seed, { rate: 1 }).knowledge.station;
      expect(all.known.length).toBe(0);
      expect(all.falseBeliefs.length).toBeGreaterThan(0);

      const half = gen(seed, { rate: 0.5 }).knowledge.station;
      const total = half.known.length + half.falseBeliefs.length;
      expect(total).toBeGreaterThan(0);
      const share = half.falseBeliefs.length / total;
      // round(total*0.5)/total is within one proposition of 0.5.
      expect(Math.abs(share - 0.5)).toBeLessThanOrEqual(1 / total + 1e-9);
    }
  });

  it('matches round(poolSize * rate) false beliefs exactly for the standard preset', () => {
    for (const seed of SEEDS) {
      const { knowledge } = gen(seed);
      const station = knowledge.station;
      const total = station.known.length + station.falseBeliefs.length;
      const expected = Math.min(
        total,
        Math.max(0, Math.round(total * STANDARD.hqFalseBeliefRate)),
      );
      expect(station.falseBeliefs.length).toBe(expected);
    }
  });

  it('the Station slice is non-empty (the brief has leads to draw)', () => {
    for (const seed of SEEDS) {
      const station = gen(seed).knowledge.station;
      expect(station.known.length + station.falseBeliefs.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Truth: known holds, false beliefs do not (Req 26.2)
// ---------------------------------------------------------------------------

describe('assignKnowledge — truth of slices', () => {
  it('every true `known` proposition holds in a Truth Store built from the facts', () => {
    for (const seed of SEEDS) {
      const g = gen(seed);
      const store = truthStoreFrom(g);
      // NPC slices.
      for (const id of Object.keys(g.principals.npcs) as NpcId[]) {
        for (const p of g.knowledge.byNpc[id].knowledge.known) {
          expect(store.holds(p, START)).toBe(true);
        }
      }
      // Station slice true leads.
      for (const p of g.knowledge.station.known) {
        expect(store.holds(p, START)).toBe(true);
      }
    }
  });

  it('every Station HQ false belief does not hold (it is an HQ mistake)', () => {
    for (const seed of SEEDS) {
      const g = gen(seed, { rate: 0.5 });
      const store = truthStoreFrom(g);
      for (const p of g.knowledge.station.falseBeliefs) {
        expect(store.holds(p, START)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Known entities are real and complete
// ---------------------------------------------------------------------------

describe('assignKnowledge — known entities', () => {
  it('every entity named in a slice is listed in its known-entity set', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const g = gen(seed, { mole: true });
        for (const id of Object.keys(g.principals.npcs) as NpcId[]) {
          expect(slicePropsAreKnown(g.knowledge.byNpc[id].knowledge)).toBe(true);
        }
        expect(slicePropsAreKnown(g.knowledge.station)).toBe(true);
      }),
      { numRuns: 30 },
    );
  });

  it('every known entity in a slice is a real generated entity', () => {
    for (const seed of SEEDS) {
      const g = gen(seed);
      const real = realEntities(g);
      const check = (ids: readonly EntityId[]): void => {
        for (const id of ids) {
          // Known entities are NPCs, orgs, Locations or the materiel item.
          expect(real.has(id)).toBe(true);
        }
      };
      for (const id of Object.keys(g.principals.npcs) as NpcId[]) {
        check(g.knowledge.byNpc[id].knowledge.knownEntities);
      }
      check(g.knowledge.station.knownEntities);
    }
  });
});

// ---------------------------------------------------------------------------
// The mole (Req 1.5)
// ---------------------------------------------------------------------------

describe('assignKnowledge — the internal mole (Req 1.5)', () => {
  it('designates no mole when the scenario does not enable it', () => {
    for (const seed of SEEDS) {
      const { knowledge } = gen(seed, { mole: false });
      expect(knowledge.mole).toBeUndefined();
    }
  });

  it('designates a Station staff NPC (never the Chief) whose true allegiance is hostile', () => {
    for (const seed of SEEDS) {
      const { principals, orgs, knowledge } = gen(seed, { mole: true });
      const mole = knowledge.mole;
      expect(mole).toBeDefined();
      const moleId = revealTruth(mole!.npc);
      // One of the staff.
      expect(principals.staff).toContain(moleId);
      // Never the Chief.
      expect(moleId).not.toBe(principals.chief);
      // True allegiance is the Hostile Service.
      expect(revealTruth(mole!.trueAllegiance).org).toBe(orgs.hostile.id);
    }
  });

  it('writes mole ground-truth facts (REPORTS_TO / MEMBER_OF the Hostile Service) into the facts', () => {
    for (const seed of SEEDS) {
      const g = gen(seed, { mole: true });
      const mole = g.knowledge.mole!;
      const moleId = revealTruth(mole.npc);
      const reportsTo = mole.facts.find((p) => p.predicate === 'REPORTS_TO');
      const memberOf = mole.facts.find((p) => p.predicate === 'MEMBER_OF');
      expect(reportsTo?.subject).toBe(moleId);
      expect(reportsTo?.object).toBe(g.principals.hostile[0]);
      expect(memberOf?.subject).toBe(moleId);
      expect(memberOf?.object).toBe(g.orgs.hostile.id);
      // The facts are threaded into truthFacts.
      const inFacts = g.knowledge.truthFacts.some(
        (p: Proposition) => p.id === reportsTo?.id,
      );
      expect(inFacts).toBe(true);
    }
  });

  it('the mole, via its facts, reports to the Hostile Service in a Truth Store', () => {
    for (const seed of SEEDS) {
      const g = gen(seed, { mole: true });
      const store = truthStoreFrom(g);
      const moleId = revealTruth(g.knowledge.mole!.npc);
      // MEMBER_OF the Hostile Service holds (membership-transitive evaluator).
      const memberFact = g.knowledge.mole!.facts.find(
        (p) => p.predicate === 'MEMBER_OF',
      )!;
      expect(store.holds(memberFact, START)).toBe(true);
      expect(moleId.startsWith('npc:')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism (underpins Property 1)
// ---------------------------------------------------------------------------

describe('assignKnowledge — determinism', () => {
  it('produces an identical result for the same seed and content', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
        const a = gen(seed, { mole: true }).knowledge;
        const b = gen(seed, { mole: true }).knowledge;
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      }),
      { numRuns: 30 },
    );
  });

  it('different seeds generally produce different knowledge', () => {
    const a = JSON.stringify(gen('seed-one', { mole: true }).knowledge);
    const b = JSON.stringify(gen('seed-two', { mole: true }).knowledge);
    expect(a).not.toBe(b);
  });
});
