/**
 * Tests for the travel action (task 11.1; Requirements 21.3, 21.4).
 *
 * These drive a generated {@link WorldState} from the real core pack through
 * {@link quoteTravel}/{@link resolveTravel} and the top-level
 * {@link quote}/{@link resolve}, checking:
 *
 * - the quote's phase cost equals the city model's cheapest-route
 *   {@link travelCost}, and a countersurveillance route adds exactly one phase
 *   (Requirement 21.3, 21.4);
 * - resolving a travel moves `player.loc` to the destination and applies the
 *   quoted cost (money is always 0);
 * - a tailed arrival raises Cover Suspicion by `risk × factor`; an untailed
 *   arrival does not (Requirement 21.4);
 * - a countersurveillance route can shake a tail, drawn from the passed PRNG;
 * - determinism: the same inputs give the same next state;
 * - a disallowed travel (unknown/own Location) leaves the state unchanged.
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

import { createPrng } from '../prng/prng.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { travelCost } from '../city/city.js';
import { asTruth, revealTruth, type LocId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { quote, resolve } from './action.js';
import { quoteTravel, resolveTravel, COVER_SUSPICION_RISK_FACTOR } from './travel.js';
import type { TravelAction } from './types.js';
import type { ResolverContext } from './result.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures
// ---------------------------------------------------------------------------

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
  publicTexts: readonly PublicText[];
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
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

function inputs(): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return { content, preset: STANDARD, scenario, cityData, descriptors, publicTexts };
}

const CTX: ResolverContext = { content };

function world(seed = 'alpha'): WorldState {
  return generate(seed, inputs());
}

/**
 * A destination reachable from the player's current Location. The core pack's
 * city is always connected, so this throws rather than returning `undefined`,
 * keeping the tests free of non-null assertions.
 */
function reachableDestination(state: WorldState): LocId {
  const from = state.player.loc;
  for (const id of Object.keys(state.city.locations) as LocId[]) {
    if (id === from) {
      continue;
    }
    if (Number.isFinite(travelCost(state.city, from, id, false))) {
      return id;
    }
  }
  throw new Error('no reachable destination in the generated city');
}

/** Force every Location open in the current phase, so the gate never blocks. */
function allOpen(state: WorldState): WorldState {
  const locations = Object.fromEntries(
    Object.entries(state.city.locations).map(([id, loc]) => [
      id,
      { ...loc, hours: { 0: true, 1: true, 2: true, 3: true } },
    ]),
  );
  return { ...state, city: { ...state.city, locations } };
}

// ---------------------------------------------------------------------------
// quoteTravel — cost (Req 21.3, 21.4)
// ---------------------------------------------------------------------------

describe('quoteTravel — cheapest-route cost (Req 21.3)', () => {
  it('quotes travelCost as phases, with no money cost', () => {
    const state = world();
    const to = reachableDestination(state);
    const expected = travelCost(state.city, state.player.loc, to, false);
    const q = quoteTravel(state, { kind: 'travel', to, countersurveillance: false });
    expect(q.allowed).toBe(true);
    expect(q.phases).toBe(expected);
    expect(q.money).toBe(0);
  });

  it('adds exactly one phase for a countersurveillance route (Req 21.4)', () => {
    const state = world();
    const to = reachableDestination(state);
    const plain = quoteTravel(state, { kind: 'travel', to, countersurveillance: false });
    const cs = quoteTravel(state, { kind: 'travel', to, countersurveillance: true });
    expect(cs.phases).toBe(plain.phases + 1);
  });

  it('rejects travel to the current Location and to an unknown Location', () => {
    const state = world();
    expect(
      quoteTravel(state, {
        kind: 'travel',
        to: state.player.loc,
        countersurveillance: false,
      }).allowed,
    ).toBe(false);
    expect(
      quoteTravel(state, {
        kind: 'travel',
        to: 'loc:does-not-exist' as LocId,
        countersurveillance: false,
      }).allowed,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveTravel — movement and cost
// ---------------------------------------------------------------------------

describe('resolveTravel — movement (Req 21.3)', () => {
  it('moves the player to the destination', () => {
    const state = allOpen(world());
    const to = reachableDestination(state);
    const action: TravelAction = { kind: 'travel', to, countersurveillance: false };
    const { next, result } = resolve(state, action, createPrng('t'), CTX);
    expect(next.player.loc).toBe(to);
    expect(result.scene.loc).toBe(to);
    expect(result.claimsAdded).toEqual([]);
  });

  it('is quoted exactly (money 0; phases = travelCost)', () => {
    const state = allOpen(world());
    const to = reachableDestination(state);
    const action: TravelAction = { kind: 'travel', to, countersurveillance: true };
    const q = quote(state, action, CTX);
    expect(q.money).toBe(0);
    expect(q.phases).toBe(travelCost(state.city, state.player.loc, to, true));
  });
});

// ---------------------------------------------------------------------------
// Cover Suspicion and tail persistence (Req 21.4)
// ---------------------------------------------------------------------------

describe('resolveTravel — arrival Cover Suspicion (Req 21.4)', () => {
  it('raises Cover Suspicion by risk × factor when the player is tailed', () => {
    const base = allOpen(world());
    const to = reachableDestination(base);
    const tailed: WorldState = {
      ...base,
      player: { ...base.player, tailed: asTruth(true), coverSuspicion: asTruth(0) },
    };
    const { next } = resolveTravel(
      tailed,
      { kind: 'travel', to, countersurveillance: false },
      createPrng('cs'),
    );
    const risk = base.city.locations[to].risk;
    expect(revealTruth(next.player.coverSuspicion)).toBeCloseTo(
      risk * COVER_SUSPICION_RISK_FACTOR,
      10,
    );
  });

  it('does not change Cover Suspicion when the player is not tailed', () => {
    const base = allOpen(world());
    const to = reachableDestination(base);
    const untailed: WorldState = {
      ...base,
      player: { ...base.player, tailed: asTruth(false), coverSuspicion: asTruth(0.25) },
    };
    const { next } = resolveTravel(
      untailed,
      { kind: 'travel', to, countersurveillance: false },
      createPrng('cs'),
    );
    expect(revealTruth(next.player.coverSuspicion)).toBe(0.25);
  });
});

describe('resolveTravel — countersurveillance tail persistence (Req 21.4)', () => {
  it('a CS route can shake a tail, decided by the PRNG draw', () => {
    const base = allOpen(world());
    const to = reachableDestination(base);
    const tailed: WorldState = { ...base, player: { ...base.player, tailed: asTruth(true) } };

    // Count how often the tail persists across many seeds; with the default
    // factor it should persist on roughly COUNTERSURVEILLANCE_TAIL_FACTOR of
    // draws — the point here is both outcomes occur (the draw is consulted).
    let persisted = 0;
    const runs = 200;
    for (let i = 0; i < runs; i += 1) {
      const { next } = resolveTravel(
        tailed,
        { kind: 'travel', to, countersurveillance: true },
        createPrng(`seed-${i}`),
      );
      if (revealTruth(next.player.tailed)) {
        persisted += 1;
      }
    }
    expect(persisted).toBeGreaterThan(0);
    expect(persisted).toBeLessThan(runs);
  });

  it('without CS a tail always persists', () => {
    const base = allOpen(world());
    const to = reachableDestination(base);
    const tailed: WorldState = { ...base, player: { ...base.player, tailed: asTruth(true) } };
    const { next } = resolveTravel(
      tailed,
      { kind: 'travel', to, countersurveillance: false },
      createPrng('x'),
    );
    expect(revealTruth(next.player.tailed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('resolveTravel — determinism', () => {
  it('same inputs give the same next state', () => {
    const base = allOpen(world());
    const to = reachableDestination(base);
    const tailed: WorldState = { ...base, player: { ...base.player, tailed: asTruth(true) } };
    const action: TravelAction = { kind: 'travel', to, countersurveillance: true };
    const a = resolveTravel(tailed, action, createPrng('same'));
    const b = resolveTravel(tailed, action, createPrng('same'));
    expect(a.next).toEqual(b.next);
    expect(a.result).toEqual(b.result);
  });
});

// ---------------------------------------------------------------------------
// travelCost monotonicity property
// ---------------------------------------------------------------------------

describe('travelCost — monotonic in countersurveillance (property)', () => {
  it('a CS route never costs less than the plain route', () => {
    const state = world();
    const ids = Object.keys(state.city.locations) as LocId[];
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: ids.length - 1 }),
        fc.integer({ min: 0, max: ids.length - 1 }),
        (i, j) => {
          const plain = travelCost(state.city, ids[i], ids[j], false);
          const cs = travelCost(state.city, ids[i], ids[j], true);
          // Both infinite (unreachable) or CS is plain + 1.
          if (!Number.isFinite(plain)) {
            expect(Number.isFinite(cs)).toBe(false);
          } else {
            expect(cs).toBe(plain + 1);
          }
        },
      ),
      { numRuns: 64 },
    );
  });
});
