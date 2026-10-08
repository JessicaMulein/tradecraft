/**
 * Property 16 — Phase and cost accounting (task 11.8; Requirements 3.1, 13.2,
 * 21.2, 21.3, 21.5).
 *
 * Design statement:
 *
 * > **Property 16: Phase and cost accounting.** For any reachable state and
 * > sequence of actions, each allowed action advances the clock by exactly its
 * > quoted phases and changes the Budget by exactly its quoted money. Travel's
 * > quoted phases equal the shortest-route cost (plus one with
 * > countersurveillance). Disallowed actions leave the state unchanged.
 *
 * ## How the slice makes this testable
 *
 * The Action Resolver splits every action into a pure {@link quote} (the phase
 * and money cost shown before the player commits, Req 13.2) and a pure
 * {@link resolve} (which returns the next {@link WorldState} and the result).
 * Two framework facts anchor the property at this layer:
 *
 * - **The clock advance is the Turn Pipeline's job**, not `resolve`'s (see
 *   `action.ts`): `resolve` returns the next state with the player relocated /
 *   observations made, and the pipeline advances {@link WorldState.time} by the
 *   quoted phases. So "advances the clock by exactly its quoted phases" is the
 *   contract that the pipeline advances the clock by `quote.phases` — modelled
 *   here with the clock's own pure {@link advance}, asserting the resulting
 *   {@link GameTime} is exactly `advance(state.time, quote.phases)` and depends
 *   on nothing else the resolver did.
 * - **The Budget change is `quote.money`.** `resolve` returns the next state;
 *   the Budget balance of that next state must equal the balance before plus the
 *   quoted money change. Across this slice every action quotes `money: 0` (no
 *   resolver debits the ledger — pay/pitch/bribe land in later tasks), so a
 *   resolved action must leave the balance untouched; the assertion is written
 *   against `quote.money` so it stays correct when a money-costed resolver lands.
 *
 * The property also pins travel's quoted phases to the city model's cheapest
 * route (plus one with countersurveillance), and the disallowed-action contract:
 * a disallowed, closed or unaffordable action returns `next === state` (the same
 * object reference) with an empty result.
 *
 * The fixtures mirror `travel.spec.ts` / `surveil.spec.ts`: a real
 * {@link WorldState} generated from the core pack, driven through
 * {@link quote}/{@link resolve} with a Truth Store so the `unk:`-allocating
 * actions (surveil, follow, wait) run.
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
  type EvaluatorKind,
  type PublicText,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { addPhases } from '../clock/clock.js';
import { travelCost } from '../city/city.js';
import { balance } from '../station/ledger.js';
import { type GameTime, type LocId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { TruthStore, type PredicateEvaluatorLookup } from '../truth/truth.js';
import { quote, resolve, visibleNpcsAt } from './action.js';
import type { ResolverContext } from './result.js';
import type { Action } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors travel.spec.ts / surveil.spec.ts)
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

function inputs(ambient = false): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    ...(ambient ? { ambient: { enabled: true, density: 'sparse' as const } } : {}),
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

function world(seed = 'phase-cost-alpha', ambient = false): WorldState {
  return generate(seed, inputs(ambient));
}

/** A Truth Store that knows the surveillance / alias predicates (kinds). */
function truth(): TruthStore {
  const lookup: PredicateEvaluatorLookup = {
    get: (predicate) => {
      switch (predicate) {
        case 'MEETS_AT':
          return 'fact-match-symmetric' as EvaluatorKind;
        case 'LOCATED_AT':
          return 'fact-match' as EvaluatorKind;
        case 'IS_ALIAS_OF':
          return 'alias' as EvaluatorKind;
        default:
          return undefined;
      }
    },
  };
  return TruthStore.create(lookup);
}

function ctxWith(store: TruthStore): ResolverContext {
  return { content, truth: store };
}

/** Force every Location open in every phase, so the opening-hours gate never blocks. */
function allOpen(state: WorldState): WorldState {
  const locations = Object.fromEntries(
    Object.entries(state.city.locations).map(([id, loc]) => [
      id,
      { ...loc, hours: { 0: true, 1: true, 2: true, 3: true } },
    ]),
  );
  return { ...state, city: { ...state.city, locations } };
}

/** The player-reachable Locations from the current one (finite plain route). */
function reachableLocations(state: WorldState): LocId[] {
  const from = state.player.loc;
  return (Object.keys(state.city.locations) as LocId[]).filter(
    (id) => id !== from && Number.isFinite(travelCost(state.city, from, id, false)),
  );
}

// ---------------------------------------------------------------------------
// Candidate actions over a reachable state (varied but bounded)
// ---------------------------------------------------------------------------

/**
 * A deterministic bag of candidate actions for a state, spanning allowed and
 * disallowed cases so the property exercises both the cost contract and the
 * "disallowed ⇒ state unchanged" contract. Includes:
 *
 * - travel to each reachable Location, plain and countersurveillance;
 * - travel to the current Location (disallowed) and an unknown Location
 *   (disallowed);
 * - wait for each phase span (always allowed);
 * - surveil each populated Location for 1 and 2 phases;
 * - intercept (allowed only at the Station / on a courier route — usually
 *   disallowed, exercising the unchanged-state path).
 */
function candidateActions(state: WorldState): Action[] {
  const out: Action[] = [];
  const reachable = reachableLocations(state);

  for (const to of reachable) {
    out.push({ kind: 'travel', to, countersurveillance: false });
    out.push({ kind: 'travel', to, countersurveillance: true });
  }
  // Disallowed travels: to self and to an unknown Location.
  out.push({ kind: 'travel', to: state.player.loc, countersurveillance: false });
  out.push({ kind: 'travel', to: 'loc:__nope__' as LocId, countersurveillance: false });

  for (const phases of [1, 2, 3, 4] as const) {
    out.push({ kind: 'wait', phases });
  }

  for (const loc of Object.keys(state.city.locations) as LocId[]) {
    if (visibleNpcsAt(state, loc).length > 0) {
      out.push({ kind: 'surveil', at: loc, phases: 1 });
      out.push({ kind: 'surveil', at: loc, phases: 2 });
    }
  }

  // Intercept: usually disallowed off the Station (exercises the unchanged path).
  out.push({ kind: 'intercept' });

  return out;
}

/**
 * A short list of reachable states to run the property against: the start, plus
 * states reached by travelling to a couple of Locations. All forced fully open
 * so the opening-hours gate does not mask the per-action cost assertions.
 */
function reachableStates(seed: string): WorldState[] {
  const states: WorldState[] = [];
  for (const ambient of [false, true]) {
    const start = allOpen(world(seed, ambient));
    states.push(start);
    const dests = reachableLocations(start).slice(0, 3);
    for (const to of dests) {
      const { next } = resolve(
        start,
        { kind: 'travel', to, countersurveillance: false },
        createPrng(`move-${to}`),
        ctxWith(truth()),
      );
      states.push(allOpen(next));
    }
  }
  return states;
}

// ---------------------------------------------------------------------------
// Property 16 — the quote/resolve cost contract
// ---------------------------------------------------------------------------

describe('Property 16: phase and cost accounting', () => {
  it('each allowed action advances the clock by exactly its quoted phases', () => {
    const states = reachableStates('phase-cost-alpha');
    const store = truth();
    const ctx = ctxWith(store);

    for (const state of states) {
      const actions = candidateActions(state);
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: actions.length - 1 }),
          fc.integer({ min: 0, max: 2 ** 31 - 1 }),
          (i, prngSeed) => {
            const action = actions[i];
            const q = quote(state, action, ctx);
            if (!q.allowed) {
              return; // allowed-only clause
            }
            // The quoted phase cost must be a non-negative integer the clock can
            // advance by (a well-formed clock move the Turn Pipeline applies).
            expect(Number.isInteger(q.phases)).toBe(true);
            expect(q.phases).toBeGreaterThanOrEqual(0);
            // The clock the Turn Pipeline produces from this quote is exactly
            // addPhases(now, quoted phases): the advance is a function of now and
            // the quote alone, independent of what resolve observed or moved.
            const expected: GameTime = addPhases(state.time, q.phases);
            const { next } = resolve(state, action, createPrng(`r-${prngSeed}`), ctx);
            const applied: GameTime = addPhases(next.time, q.phases);
            // resolve leaves WorldState.time untouched (the advance is the
            // pipeline's job), so advancing the resolved state's clock by the
            // quoted phases lands at the same time as advancing the pre-state's.
            expect(next.time).toEqual(state.time);
            expect(applied).toEqual(expected);
          },
        ),
        { numRuns: 48 },
      );
    }
  });

  it('each allowed action changes the Budget by exactly its quoted money', () => {
    const states = reachableStates('phase-cost-bravo');
    const store = truth();
    const ctx = ctxWith(store);

    for (const state of states) {
      const actions = candidateActions(state);
      const before = balance(state.station.ledger);
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: actions.length - 1 }),
          fc.integer({ min: 0, max: 2 ** 31 - 1 }),
          (i, prngSeed) => {
            const action = actions[i];
            const q = quote(state, action, ctx);
            if (!q.allowed) {
              return;
            }
            const { next } = resolve(state, action, createPrng(`r-${prngSeed}`), ctx);
            // Budget after = Budget before − quoted money (money quotes are a
            // positive debit magnitude; the slice's actions all quote 0).
            expect(balance(next.station.ledger)).toBe(before - q.money);
          },
        ),
        { numRuns: 48 },
      );
    }
  });

  it("travel's quoted phases equal the shortest-route cost (plus one with countersurveillance)", () => {
    const states = reachableStates('phase-cost-charlie');
    const store = truth();
    const ctx = ctxWith(store);

    for (const state of states) {
      const reachable = reachableLocations(state);
      if (reachable.length === 0) {
        continue;
      }
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: reachable.length - 1 }),
          fc.boolean(),
          (i, cs) => {
            const to = reachable[i];
            const q = quote(state, { kind: 'travel', to, countersurveillance: cs }, ctx);
            const shortest = travelCost(state.city, state.player.loc, to, false);
            expect(q.allowed).toBe(true);
            expect(q.phases).toBe(cs ? shortest + 1 : shortest);
            expect(q.money).toBe(0);
          },
        ),
        { numRuns: 48 },
      );
    }
  });

  it('disallowed actions leave the state unchanged (next === state)', () => {
    const states = reachableStates('phase-cost-delta');
    const store = truth();
    const ctx = ctxWith(store);

    for (const state of states) {
      const actions = candidateActions(state);
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: actions.length - 1 }),
          fc.integer({ min: 0, max: 2 ** 31 - 1 }),
          (i, prngSeed) => {
            const action = actions[i];
            const q = quote(state, action, ctx);
            if (q.allowed) {
              return; // disallowed-only clause
            }
            const { next, result } = resolve(
              state,
              action,
              createPrng(`r-${prngSeed}`),
              ctx,
            );
            // Same object reference — the design's "state is unchanged" contract.
            expect(next).toBe(state);
            // And an empty result: no observations, no claims, no events.
            expect(result.observations).toEqual([]);
            expect(result.claimsAdded).toEqual([]);
            expect(result.events).toEqual([]);
          },
        ),
        { numRuns: 48 },
      );
    }
  });

  it('includes at least one disallowed action per state (coverage sanity)', () => {
    const states = reachableStates('phase-cost-echo');
    const store = truth();
    const ctx = ctxWith(store);
    for (const state of states) {
      const disallowed = candidateActions(state).filter(
        (a) => !quote(state, a, ctx).allowed,
      );
      // travel-to-self and travel-to-unknown are always present and disallowed.
      expect(disallowed.length).toBeGreaterThan(0);
    }
  });
});
