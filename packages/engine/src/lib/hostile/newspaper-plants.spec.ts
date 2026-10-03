/**
 * Tests for the Hostile Service's newspaper plants (task 19.4; Requirement
 * 30.2).
 *
 * These pin:
 *
 * - plant production is deterministic for the same doctrine, candidates and
 *   seed;
 * - the number of plants is weighted by `deceptionAppetite`: a blunt service
 *   (`0`) plants none, a deception-run service (`1`) plants every candidate up
 *   to the cap;
 * - the per-candidate gate is `deceptionAppetite`, drawn one coin per considered
 *   candidate in id-sorted order (so the stream is record-order-independent);
 * - a planted article is tagged `rumour` and asserts the candidate's false
 *   Proposition;
 * - the producer no-ops cleanly when there are no candidates.
 */

import { describe, expect, it } from 'vitest';

import type { GameTime, PropId, Proposition } from '../model/core.js';
import { createPrng } from '../prng/prng.js';
import type { Doctrine } from './doctrine.js';
import {
  planNewspaperPlants,
  plantCount,
  plantProbability,
  buildPlantItem,
  MAX_PLANTS_PER_DAY,
  type PlantCandidate,
  type PlantProjection,
} from './newspaper-plants.js';

const AT: GameTime = { day: 7, phase: 1 };

/** A doctrine with the given deceptionAppetite (the only field these read). */
function doctrine(deceptionAppetite: number): Doctrine {
  return { riskTolerance: 0.5, securityConsciousness: 0.5, deceptionAppetite };
}

/** A false Proposition for a candidate id. */
function falseProp(id: string): Proposition {
  return {
    id: `prop:plant/${id}` as PropId,
    subject: 'org:hostile' as Proposition['subject'],
    predicate: 'MEETS_WITH',
    object: 'npc:decoy' as Proposition['object'],
  };
}

/** A candidate plant for an id. */
function candidate(id: string): PlantCandidate {
  return {
    proposition: falseProp(id),
    headline: `Story ${id}`,
    summary: `A planted detail for ${id}.`,
  };
}

/** A projection of `n` candidates keyed `c0 … c{n-1}`. */
function projection(n: number): PlantProjection {
  const out: Record<string, PlantCandidate> = {};
  for (let i = 0; i < n; i += 1) {
    out[`c${i}`] = candidate(`c${i}`);
  }
  return out;
}

describe('plantCount', () => {
  it('is floor(deceptionAppetite × MAX_PLANTS_PER_DAY), clamped', () => {
    expect(plantCount(doctrine(0))).toBe(0);
    expect(plantCount(doctrine(1))).toBe(MAX_PLANTS_PER_DAY);
    // floor(0.5 × 3) = 1
    expect(plantCount(doctrine(0.5))).toBe(1);
    // floor(0.7 × 3) = 2
    expect(plantCount(doctrine(0.7))).toBe(2);
  });
});

describe('plantProbability', () => {
  it('is deceptionAppetite (opposite sense to the arrest article)', () => {
    expect(plantProbability(doctrine(0))).toBe(0);
    expect(plantProbability(doctrine(1))).toBe(1);
    expect(plantProbability(doctrine(0.25))).toBeCloseTo(0.25, 10);
  });
});

describe('buildPlantItem', () => {
  it('tags the article rumour and asserts the false Proposition', () => {
    const item = buildPlantItem('c0', AT.day, candidate('c0'));
    expect(item.source).toBe('rumour');
    expect(item.id).toBe(`plant/c0/${AT.day}`);
    expect(item.asserts).toEqual([falseProp('c0')]);
  });
});

describe('planNewspaperPlants', () => {
  it('plants nothing for a blunt service (deceptionAppetite = 0)', () => {
    const items = planNewspaperPlants(doctrine(0), projection(3), AT, createPrng('s'));
    expect(items).toEqual([]);
  });

  it('plants every candidate up to the cap for a deception-run service (= 1)', () => {
    const items = planNewspaperPlants(doctrine(1), projection(5), AT, createPrng('s'));
    // Considers MAX_PLANTS_PER_DAY candidates (the id-sorted prefix), each with
    // p = 1, so all are placed.
    expect(items).toHaveLength(MAX_PLANTS_PER_DAY);
    expect(items.map((i) => i.id)).toEqual([
      `plant/c0/${AT.day}`,
      `plant/c1/${AT.day}`,
      `plant/c2/${AT.day}`,
    ]);
    expect(items.every((i) => i.source === 'rumour')).toBe(true);
  });

  it('considers a doctrine-sized prefix of the id-sorted candidates', () => {
    // deceptionAppetite = 0.7 ⇒ considers 2; p = 0.7 but both land at p = 1-ish?
    // Use p = 1 slice behaviour by picking appetite that gives count 2 and p 1
    // is impossible (count<cap ⇒ appetite<1), so assert only the prefix bound.
    const items = planNewspaperPlants(doctrine(0.7), projection(5), AT, createPrng('seed'));
    // At most the considered count (2); never a candidate beyond the prefix.
    expect(items.length).toBeLessThanOrEqual(2);
    for (const item of items) {
      expect(['plant/c0/' + AT.day, 'plant/c1/' + AT.day]).toContain(item.id);
    }
  });

  it('is deterministic for the same doctrine, candidates and seed', () => {
    const run = () =>
      planNewspaperPlants(doctrine(0.9), projection(4), AT, createPrng('fixed'));
    expect(run()).toEqual(run());
  });

  it('draws one coin per considered candidate in id order, record-order independent', () => {
    const forward: PlantProjection = { c0: candidate('c0'), c1: candidate('c1'), c2: candidate('c2') };
    const reverse: PlantProjection = { c2: candidate('c2'), c1: candidate('c1'), c0: candidate('c0') };
    const a = planNewspaperPlants(doctrine(1), forward, AT, createPrng('seed'));
    const b = planNewspaperPlants(doctrine(1), reverse, AT, createPrng('seed'));
    expect(b).toEqual(a);
  });

  it('no-ops cleanly when there are no candidates', () => {
    expect(planNewspaperPlants(doctrine(1), {}, AT, createPrng('s'))).toEqual([]);
  });
});
