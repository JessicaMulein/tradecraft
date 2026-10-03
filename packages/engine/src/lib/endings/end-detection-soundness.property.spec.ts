/**
 * Feature: slice-integration, Property 41: End detection soundness.
 *
 * **Validates: Requirements 3.4, 4.5, 7.2, 7.3, 7.4, 7.8**
 *
 * The design states (slice-integration design, "Property 41: End detection
 * soundness"): for any reachable state, `detectEnd` returns a result if and
 * only if the Plot is completed, the Plot is aborted, the Cell leader is in
 * Station Custody or arrested by the Station, or the player is burned; the
 * outcome is `success` with the abort trigger or `leader-arrested` for the two
 * winning causes, and `failure` with `plot-completed` or `burned` otherwise.
 *
 * This spec exhausts the detector's input space. It takes one generated world
 * from the real core pack (as `end-conditions.spec.ts` does), confirms the base
 * state ends nothing, then builds an arbitrary that toggles the four end
 * conditions *independently* on that base so every representable combination is
 * reached:
 *
 * - `plotStatus` is one of `running` | `completed` | `aborted` — the three Plot
 *   statuses, since `plot.status` is a single field so "completed" and
 *   "aborted" cannot both literally hold. An `aborted` status carries a varied
 *   {@link AbortTrigger} as `abortCause`.
 * - `leaderArrested` puts the Cell leader in Station Custody *or* names them in
 *   `player.arrests`, varying across runs between the custody form, the raw
 *   NPC-id arrest form and the `unk:` alias arrest form — all three forms
 *   {@link leaderArrestedByStation} accepts.
 * - `burned` sets `player.burned`.
 *
 * The three toggles are orthogonal, so with `plotStatus` taking three values
 * the arbitrary covers all `3 × 2 × 2 = 12` representable combinations. For
 * each case the expected result is computed straight from the priority rule
 * (aborted → leader-arrested → completed → burned) and checked for the iff, the
 * priority and the exact outcome/cause. The spec also checks idempotence (a set
 * `ended` is returned unchanged) and a negative control (a Hostile Service hold
 * on the leader with nothing else set ends nothing).
 *
 * The core-pack load and `GenerateInputs`/`ScenarioConfig` construction mirror
 * `end-conditions.spec.ts`; the fast-check shape (a seeded `fc.record`, a
 * bounded `numRuns`) mirrors the engine's other `*.property.spec.ts` files.
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
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import {
  revealTruth,
  type EntityId,
  type GameTime,
  type NpcId,
} from '../model/core.js';
import type { AbortTrigger, WorldState } from '../model/state.js';
import { newRelationship, type Custody } from '../recruit/asset.js';
import {
  detectEnd,
  leaderArrestedByStation,
  leaderArrestEnd,
  LOSE_OUTCOME,
  WIN_OUTCOME,
  type EndCause,
  type EndCondition,
} from './end-conditions.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors end-conditions.spec.ts)
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

function loadCore(): GenerateInputs {
  const content = loadContent([CORE_DIR], ['core']);
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!content.ok || !cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('the core pack failed to load');
  }
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
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
  return {
    content: content.value,
    preset: presetOf(content.value, 'standard'),
    scenario,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

function presetOf(content: ContentSet, id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const INPUTS = loadCore();
const BASE: WorldState = generate('end-detection-soundness-alpha', INPUTS);

/** The Plot's true Cell leader. */
const LEADER: NpcId = revealTruth(BASE.plot.leader);

/** The `unk:` id the player knows the leader by, used by the alias arrest form. */
const LEADER_UNK = 'unk:7' as EntityId;

// ---------------------------------------------------------------------------
// State transforms (toggle one condition each, all orthogonal)
// ---------------------------------------------------------------------------

/** `at` moved forward by `phases` (4 phases a day). */
function later(at: GameTime, phases: number): GameTime {
  const total = at.day * 4 + at.phase + phases;
  return {
    day: Math.floor(total / 4),
    phase: (total % 4) as GameTime['phase'],
  };
}

/** `state` with `custody` set on `npc`'s Relationship. */
function withCustody(
  state: WorldState,
  npc: NpcId,
  custody: Custody,
): WorldState {
  const rel = state.relationships[npc] ?? newRelationship(npc);
  return {
    ...state,
    relationships: { ...state.relationships, [npc]: { ...rel, custody } },
  };
}

/** `state` with the given entities in the Station's arrest record. */
function withArrests(
  state: WorldState,
  arrests: readonly EntityId[],
): WorldState {
  return {
    ...state,
    player: { ...state.player, arrests: [...arrests] },
  };
}

/** `state` with the leader known by {@link LEADER_UNK}. */
function withLeaderAlias(state: WorldState): WorldState {
  return {
    ...state,
    player: {
      ...state.player,
      unkIds: { ...state.player.unkIds, [LEADER]: LEADER_UNK },
    },
  };
}

/** The three forms a Station arrest of the leader can take. */
type ArrestForm = 'custody' | 'arrest-id' | 'arrest-unk';

/** Set the leader-arrested condition on `state` in the given form. */
function withLeaderArrested(state: WorldState, form: ArrestForm): WorldState {
  switch (form) {
    case 'custody':
      return withCustody(state, LEADER, {
        by: 'station',
        since: state.time,
        until: later(state.time, 4),
      });
    case 'arrest-id':
      return withArrests(state, [LEADER as unknown as EntityId]);
    case 'arrest-unk':
      return withArrests(withLeaderAlias(state), [LEADER_UNK]);
    default: {
      const never: never = form;
      throw new Error(`unknown arrest form ${String(never)}`);
    }
  }
}

/** Set the Plot status (and an abort cause when aborted). */
function withPlotStatus(
  state: WorldState,
  status: 'running' | 'completed' | 'aborted',
  abortCause: AbortTrigger,
): WorldState {
  if (status === 'aborted') {
    return { ...state, plot: { ...state.plot, status, abortCause } };
  }
  return { ...state, plot: { ...state.plot, status } };
}

/** Set the burned condition. */
function withBurned(state: WorldState, burned: boolean): WorldState {
  return { ...state, player: { ...state.player, burned } };
}

// ---------------------------------------------------------------------------
// The expected detector result from the priority rule
// ---------------------------------------------------------------------------

interface Toggles {
  readonly plotStatus: 'running' | 'completed' | 'aborted';
  readonly abortCause: AbortTrigger;
  readonly leaderArrested: boolean;
  readonly burned: boolean;
}

/**
 * The {@link EndCondition} the detector must return for `toggles`, computed
 * directly from the priority rule: aborted → leader-arrested → completed →
 * burned, else `null`.
 */
function expectedEnd(at: GameTime, toggles: Toggles): EndCondition | null {
  if (toggles.plotStatus === 'aborted') {
    return { outcome: WIN_OUTCOME, at, cause: toggles.abortCause };
  }
  if (toggles.leaderArrested) {
    return leaderArrestEnd(at);
  }
  if (toggles.plotStatus === 'completed') {
    return { outcome: LOSE_OUTCOME, at, cause: 'plot-completed' };
  }
  if (toggles.burned) {
    return { outcome: LOSE_OUTCOME, at, cause: 'burned' };
  }
  return null;
}

/** Whether any end condition holds (the right-hand side of the iff). */
function anyConditionHolds(toggles: Toggles): boolean {
  return (
    toggles.plotStatus === 'aborted' ||
    toggles.plotStatus === 'completed' ||
    toggles.leaderArrested ||
    toggles.burned
  );
}

/** Build the state for a set of toggles on the base generated world. */
function stateFor(toggles: Toggles, arrestForm: ArrestForm): WorldState {
  let state = withPlotStatus(BASE, toggles.plotStatus, toggles.abortCause);
  if (toggles.leaderArrested) {
    state = withLeaderArrested(state, arrestForm);
  }
  state = withBurned(state, toggles.burned);
  return state;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const RUNS = 200;

const ABORT_CAUSES: readonly AbortTrigger[] = [
  'pressure',
  'leader-suspicion',
  'materiel-seized',
  'disruption-draw',
  'no-reroute',
];

const togglesArb: fc.Arbitrary<Toggles> = fc.record({
  plotStatus: fc.constantFrom('running', 'completed', 'aborted'),
  abortCause: fc.constantFrom(...ABORT_CAUSES),
  leaderArrested: fc.boolean(),
  burned: fc.boolean(),
});

const arrestFormArb: fc.Arbitrary<ArrestForm> = fc.constantFrom(
  'custody',
  'arrest-id',
  'arrest-unk',
);

const caseArb = fc.record({ toggles: togglesArb, arrestForm: arrestFormArb });

// ---------------------------------------------------------------------------
// Property 41 — End detection soundness
// ---------------------------------------------------------------------------

describe('Property 41: End detection soundness (Req 3.4, 4.5, 7.2, 7.3, 7.4, 7.8)', () => {
  // The base generated world must satisfy no end condition, so the toggles are
  // the sole cause of any end the property observes.
  it('ends nothing in a freshly generated world', () => {
    expect(BASE.plot.status).toBe('running');
    expect(BASE.player.burned).toBe(false);
    expect(BASE.player.arrests).toEqual([]);
    expect(leaderArrestedByStation(BASE)).toBe(false);
    expect(detectEnd(BASE)).toBeNull();
  });

  // The iff (Req 7.8): detectEnd is non-null exactly when at least one of the
  // four conditions holds, and null when none holds.
  it('returns a result iff at least one end condition holds', () => {
    fc.assert(
      fc.property(caseArb, ({ toggles, arrestForm }) => {
        const state = stateFor(toggles, arrestForm);
        const end = detectEnd(state);
        expect(end !== null).toBe(anyConditionHolds(toggles));
      }),
      { numRuns: RUNS },
    );
  });

  // The priority and the exact outcome/cause (Req 7.2, 7.3, 7.4): when several
  // conditions hold, the returned condition is the highest-priority one, with
  // the win/lose outcome and cause the rule names.
  it('returns the highest-priority condition with the right outcome and cause', () => {
    fc.assert(
      fc.property(caseArb, ({ toggles, arrestForm }) => {
        const state = stateFor(toggles, arrestForm);
        expect(detectEnd(state)).toEqual(expectedEnd(state.time, toggles));
      }),
      { numRuns: RUNS },
    );
  });

  // Every representable combination is reached, so the iff and priority checks
  // above are exhaustive over the detector's input space. With three plot
  // statuses and two orthogonal booleans there are 12 combinations; the arrest
  // form varies them further.
  it('covers all 12 representable toggle combinations', () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(caseArb, ({ toggles }) => {
        seen.add(
          `${toggles.plotStatus}:${toggles.leaderArrested}:${toggles.burned}`,
        );
        return true;
      }),
      { numRuns: RUNS },
    );
    expect(seen.size).toBe(12);
  });

  // Idempotence: once `ended` is set, detectEnd returns it unchanged, whatever
  // the standing conditions say.
  it('returns a set ended condition unchanged, ignoring standing conditions', () => {
    fc.assert(
      fc.property(
        caseArb,
        fc.record({
          outcome: fc.constantFrom(WIN_OUTCOME, LOSE_OUTCOME),
          cause: fc.constantFrom<EndCause>(
            'leader-arrested',
            'plot-completed',
            'burned',
            'pressure',
            'materiel-seized',
          ),
        }),
        ({ toggles, arrestForm }, recorded) => {
          const base = stateFor(toggles, arrestForm);
          const ended: EndCondition = { ...recorded, at: base.time };
          const state: WorldState = { ...base, ended };
          expect(detectEnd(state)).toEqual(ended);
        },
      ),
      { numRuns: RUNS },
    );
  });

  // Negative control (Req 7.4, 7.8): a Hostile Service hold on the leader is not
  // a player win, so with nothing else set the game ends nothing.
  it('ends nothing when only a Hostile Service hold on the leader is set', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (bounded) => {
          const custody: Custody = bounded
            ? { by: 'hostile', since: BASE.time, until: later(BASE.time, 4) }
            : { by: 'hostile', since: BASE.time };
          const state = withCustody(BASE, LEADER, custody);
          expect(leaderArrestedByStation(state)).toBe(false);
          expect(detectEnd(state)).toBeNull();
        },
      ),
      { numRuns: 50 },
    );
  });
});
