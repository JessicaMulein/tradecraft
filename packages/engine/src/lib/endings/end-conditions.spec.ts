/**
 * Tests for the standing leader check in {@link detectEnd} (slice-integration
 * task 1.4; Requirements 7.2, 7.3, 7.4, 7.8).
 *
 * These drive a generated {@link WorldState} from the real core pack and check:
 *
 * - a Plot leader in Station Custody, or named in the Station's arrest record
 *   (`player.arrests`, by NPC id or by the player's `unk:` id for them), is a
 *   `leader-arrested` success;
 * - a Hostile Service hold on the leader, or a Station arrest of anyone else,
 *   ends nothing;
 * - the detector agrees with `resolveArrest` on a correct arrest of the leader;
 * - the priority order is aborted, leader arrested, completed, burned.
 *
 * The remaining win/lose cases (abort, completion, burn, idempotence) are
 * covered in `../action/arrest.spec.ts`.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

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

import {
  TruthStore,
  type Allegiance,
  type PredicateEvaluatorLookup,
} from '../truth/truth.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import {
  asTruth,
  revealTruth,
  type GameTime,
  type NpcId,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import {
  inStationCustody,
  newRelationship,
  type Custody,
} from '../recruit/asset.js';
import { resolveArrest } from '../action/arrest.js';
import type { Observation, ResolverContext } from '../action/result.js';
import {
  detectEnd,
  leaderArrestEnd,
  leaderArrestedByStation,
  LOSE_OUTCOME,
  WIN_OUTCOME,
} from './end-conditions.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors arrest.spec.ts)
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
    difficulty: { preset: STANDARD.id },
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
    content,
    preset: STANDARD,
    scenario,
    cityData,
    descriptors,
    publicTexts,
  };
}

const BASE: WorldState = generate('end-conditions-alpha', inputs());

/** A Truth Store that answers the alias predicate (all `resolveArrest` needs). */
function truth(): TruthStore {
  const lookup: PredicateEvaluatorLookup = {
    get: (predicate) =>
      predicate === 'IS_ALIAS_OF' ? ('alias' as EvaluatorKind) : undefined,
  };
  return TruthStore.create(lookup);
}

/** The render callback `resolveArrest` takes: observations to plain lines. */
function renderLines(_s: WorldState, obs: readonly Observation[]): string[] {
  return obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`));
}

/** The Plot's true Cell leader. */
function leaderOf(state: WorldState): NpcId {
  return revealTruth(state.plot.leader);
}

/** Some NPC other than the Plot leader. */
function someoneElse(state: WorldState): NpcId {
  const leader = leaderOf(state);
  const other = (Object.keys(state.npcs) as NpcId[])
    .sort()
    .find((id) => id !== leader);
  if (other === undefined) {
    throw new Error('the generated world has no NPC besides the leader');
  }
  return other;
}

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
  arrests: WorldState['player']['arrests'],
): WorldState {
  return { ...state, player: { ...state.player, arrests } };
}

/** `state` with the leader held in Station Custody until a day from now. */
function leaderInStationCustody(state: WorldState): WorldState {
  return withCustody(state, leaderOf(state), {
    by: 'station',
    since: state.time,
    until: later(state.time, 4),
  });
}

// ---------------------------------------------------------------------------
// The leader check (Req 7.4, 7.8)
// ---------------------------------------------------------------------------

describe('detectEnd — the Cell leader arrested by the Station (Req 7.4, 7.8)', () => {
  it('runs on in a freshly generated world', () => {
    expect(BASE.player.arrests).toEqual([]);
    expect(leaderArrestedByStation(BASE)).toBe(false);
    expect(detectEnd(BASE)).toBeNull();
  });

  it('is a leader-arrested success while the leader is in Station Custody', () => {
    const state = leaderInStationCustody(BASE);
    expect(leaderArrestedByStation(state)).toBe(true);
    expect(detectEnd(state)).toEqual({
      outcome: WIN_OUTCOME,
      at: state.time,
      cause: 'leader-arrested',
    });
  });

  it('stays a success from the arrest record once the custody hold has run out', () => {
    const leader = leaderOf(BASE);
    const since = BASE.time;
    const until = later(since, 4);
    const handedOver: WorldState = {
      ...withArrests(
        withCustody(BASE, leader, { by: 'station', since, until }),
        [leader],
      ),
      time: later(until, 2),
    };
    expect(
      inStationCustody(handedOver.relationships[leader], handedOver.time),
    ).toBe(false);
    expect(detectEnd(handedOver)).toEqual(leaderArrestEnd(handedOver.time));
  });

  it('is a success when the arrest record names the leader by an Unidentified Subject id', () => {
    const leader = leaderOf(BASE);
    const other = someoneElse(BASE);
    const aliased: WorldState = {
      ...BASE,
      player: {
        ...BASE.player,
        unkIds: { ...BASE.player.unkIds, [leader]: 'unk:1', [other]: 'unk:2' },
      },
    };
    expect(detectEnd(withArrests(aliased, ['unk:1']))).toEqual(
      leaderArrestEnd(BASE.time),
    );
    // Someone else's unk: id in the record is not the leader.
    expect(detectEnd(withArrests(aliased, ['unk:2']))).toBeNull();
  });

  it('does not treat a Hostile Service hold on the leader as a player win', () => {
    const leader = leaderOf(BASE);
    const open = withCustody(BASE, leader, { by: 'hostile', since: BASE.time });
    const bounded = withCustody(BASE, leader, {
      by: 'hostile',
      since: BASE.time,
      until: later(BASE.time, 4),
    });
    expect(leaderArrestedByStation(open)).toBe(false);
    expect(detectEnd(open)).toBeNull();
    expect(detectEnd(bounded)).toBeNull();
  });

  it('does not end the game when the Station arrests someone other than the leader', () => {
    const other = someoneElse(BASE);
    const state = withArrests(
      withCustody(BASE, other, {
        by: 'station',
        since: BASE.time,
        until: later(BASE.time, 4),
      }),
      [other],
    );
    expect(detectEnd(state)).toBeNull();
  });

  it('agrees with resolveArrest on a correct arrest of the leader', () => {
    const leader = leaderOf(BASE);
    const cell = Object.values(BASE.orgs).find((org) => org.kind === 'cell');
    if (cell === undefined) {
      throw new Error('no cell org in the generated world');
    }
    // Make the arrest unambiguously correct: the leader truly serves the Cell.
    const state: WorldState = {
      ...BASE,
      npcs: {
        ...BASE.npcs,
        [leader]: {
          ...BASE.npcs[leader],
          trueAllegiance: asTruth<Allegiance>({ org: cell.id }),
        },
      },
    };
    const ctx: ResolverContext = { content, truth: truth() };
    const { next, ended } = resolveArrest(
      state,
      { kind: 'arrest', npc: leader },
      ctx,
      renderLines,
    );
    expect(ended).toEqual(leaderArrestEnd(state.time));
    expect(detectEnd(next)).toEqual(ended);
  });
});

// ---------------------------------------------------------------------------
// Priority order (Req 7.2, 7.3, 7.4, 7.8)
// ---------------------------------------------------------------------------

describe('detectEnd — priority: aborted, leader arrested, completed, burned', () => {
  it('reports a Plot abort ahead of a leader arrest', () => {
    const base = leaderInStationCustody(BASE);
    const state: WorldState = {
      ...base,
      plot: { ...base.plot, status: 'aborted', abortCause: 'materiel-seized' },
    };
    expect(detectEnd(state)).toEqual({
      outcome: WIN_OUTCOME,
      at: state.time,
      cause: 'materiel-seized',
    });
  });

  it('reports a leader arrest ahead of a completed Plot and a burn', () => {
    const base = leaderInStationCustody(BASE);
    const completed: WorldState = {
      ...base,
      plot: { ...base.plot, status: 'completed' },
    };
    const burned: WorldState = {
      ...base,
      player: { ...base.player, burned: true },
    };
    expect(detectEnd(completed)).toEqual(leaderArrestEnd(base.time));
    expect(detectEnd(burned)).toEqual(leaderArrestEnd(base.time));
  });

  it('reports a completed Plot ahead of a burn', () => {
    const state: WorldState = {
      ...BASE,
      plot: { ...BASE.plot, status: 'completed' },
      player: { ...BASE.player, burned: true },
    };
    expect(detectEnd(state)).toEqual({
      outcome: LOSE_OUTCOME,
      at: state.time,
      cause: 'plot-completed',
    });
  });
});
