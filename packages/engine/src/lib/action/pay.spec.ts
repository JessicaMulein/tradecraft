/**
 * Tests for the pay action (task 18.2; Requirements 28.2, 28.3, 28.4).
 *
 * These drive a generated {@link WorldState} from the real core pack through the
 * pay resolver and the top-level {@link quote}, checking:
 *
 * - pay requires a running Asset and a positive amount (Req 28.2);
 * - a pay to a money-motivated Asset debits the Budget, satisfies/advances the
 *   retainer and raises trust (Req 28.2);
 * - an insufficient Budget rejects the pay and leaves state unchanged (Req 28.3);
 * - a non-money Asset's trust and retainer are unaffected by a pay (Req 28.4);
 * - pay adds no Case File Claims and is deterministic;
 * - pay is routed by `quote` (no longer a not-implemented stub).
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
  type PublicText,
} from '@tradecraft/content';

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { asTruth, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { MiceProfile } from '../city/npc.js';
import { balance, createLedger } from '../station/ledger.js';
import { newRelationship, type AssetProfile, type Relationship } from '../recruit/asset.js';
import { nextDue, PAY_TRUST_GAIN } from '../recruit/retainer.js';
import { quote } from './action.js';
import { PAY_LINE, PAY_PHASE_COST, quotePay, resolvePay } from './pay.js';
import type { Observation } from './result.js';
import type { PayAction } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors confront.spec.ts)
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

function world(seed = 'pay-alpha'): WorldState {
  return generate(seed, inputs());
}

/** The render callback used in tests: observations to their lines/ids. */
function renderLines(_s: WorldState, obs: readonly Observation[]): string[] {
  return obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`));
}

const MONEY_MICE: MiceProfile = { money: 0.9, ideology: 0.2, coercion: 0.1, ego: 0.3 };
const IDEOLOGY_MICE: MiceProfile = { money: 0.2, ideology: 0.9, coercion: 0.1, ego: 0.3 };

/** A fresh Asset profile for a recruited Relationship. */
function assetProfile(): AssetProfile {
  return {
    access: asTruth({ locs: [], orgs: [], npcs: [] }),
    reliability: asTruth(0.7),
    turned: false,
    hostileControlled: asTruth(false),
  };
}

/** The first NPC in the generated world (any id). */
function anyNpc(state: WorldState): NpcId {
  const id = Object.keys(state.npcs)[0];
  if (id === undefined) {
    throw new Error('no NPCs in the generated world');
  }
  return id as NpcId;
}

/**
 * Stage an NPC as a running Asset with a given motivation and a starting ledger
 * balance, and return the state, the NPC id and the (asset) Relationship.
 */
function staged(
  base: WorldState,
  mice: MiceProfile,
  startBudget: number,
  rel: Partial<Relationship> = {},
): { state: WorldState; npc: NpcId } {
  const npc = anyNpc(base);
  const relationship: Relationship = {
    ...newRelationship(npc),
    recruited: true,
    asset: assetProfile(),
    trust: 0.5,
    ...rel,
  };
  const state: WorldState = {
    ...base,
    npcs: {
      ...base.npcs,
      [npc]: { ...base.npcs[npc], mice: asTruth(mice) },
    },
    relationships: { ...base.relationships, [npc]: relationship },
    station: { ...base.station, ledger: createLedger(startBudget) },
  };
  return { state, npc };
}

// ---------------------------------------------------------------------------
// Quote eligibility (Req 28.2)
// ---------------------------------------------------------------------------

describe('pay — quote eligibility (Req 28.2)', () => {
  it('is allowed for a running Asset with a positive amount', () => {
    const { state, npc } = staged(world(), MONEY_MICE, 5000);
    const q = quotePay(state, { kind: 'pay', npc, amount: 500 });
    expect(q.allowed).toBe(true);
    expect(q.phases).toBe(PAY_PHASE_COST);
    expect(q.money).toBe(500);
  });

  it('is not allowed for an NPC who is not a running Asset', () => {
    const base = world();
    const npc = anyNpc(base);
    const q = quotePay(base, { kind: 'pay', npc, amount: 500 });
    expect(q.allowed).toBe(false);
  });

  it('is not allowed for a non-positive amount', () => {
    const { state, npc } = staged(world(), MONEY_MICE, 5000);
    expect(quotePay(state, { kind: 'pay', npc, amount: 0 }).allowed).toBe(false);
    expect(quotePay(state, { kind: 'pay', npc, amount: -100 }).allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Resolve — pay effects (Req 28.2, 28.3, 28.4)
// ---------------------------------------------------------------------------

describe('pay — resolve (Req 28.2, 28.3, 28.4)', () => {
  it('debits the Budget, satisfies the retainer and raises trust for a money Asset', () => {
    const { state, npc } = staged(world(), MONEY_MICE, 5000, {
      retainer: { amount: 500, paidThrough: { day: 0, phase: 0 } },
    });
    const a: PayAction = { kind: 'pay', npc, amount: 500 };
    const { next, result } = resolvePay(state, a, renderLines);

    // Budget debited by exactly the amount.
    expect(balance(next.station.ledger)).toBe(5000 - 500);
    const entry = next.station.ledger.entries.at(-1);
    expect(entry?.reason).toBe('pay');
    expect(entry?.amount).toBe(-500);
    expect(entry?.ref).toBe(npc);

    // Retainer satisfied/advanced and trust raised.
    const rel = next.relationships[npc];
    expect(rel.retainer?.paidThrough).toEqual(nextDue(state.time));
    expect(rel.trust).toBeCloseTo(0.5 + PAY_TRUST_GAIN, 10);

    // A pay Fact Line, no Claims.
    expect(result.factLines).toContain(PAY_LINE);
    expect(result.claimsAdded).toEqual([]);
  });

  it('rejects the pay and leaves state unchanged on an insufficient Budget (Req 28.3)', () => {
    const { state, npc } = staged(world(), MONEY_MICE, 100);
    const a: PayAction = { kind: 'pay', npc, amount: 500 };
    const { next, result } = resolvePay(state, a, renderLines);

    expect(next).toBe(state);
    expect(balance(next.station.ledger)).toBe(100);
    expect(result.factLines).toEqual([]);
  });

  it('leaves a non-money Asset trust and retainer untouched (Req 28.4)', () => {
    const { state, npc } = staged(world(), IDEOLOGY_MICE, 5000);
    const a: PayAction = { kind: 'pay', npc, amount: 500 };
    const { next } = resolvePay(state, a, renderLines);

    // The Budget still moves (the money changed hands)...
    expect(balance(next.station.ledger)).toBe(5000 - 500);
    // ...but the retainer and trust consequences do not apply.
    const rel = next.relationships[npc];
    expect(rel.trust).toBe(0.5);
    expect(rel.retainer).toBeUndefined();
  });

  it('is deterministic: the same inputs give the same result', () => {
    const { state, npc } = staged(world(), MONEY_MICE, 5000);
    const a: PayAction = { kind: 'pay', npc, amount: 500 };
    const r1 = resolvePay(state, a, renderLines);
    const r2 = resolvePay(state, a, renderLines);
    expect(r1.next.relationships[npc]).toEqual(r2.next.relationships[npc]);
    expect(balance(r1.next.station.ledger)).toBe(balance(r2.next.station.ledger));
  });
});

// ---------------------------------------------------------------------------
// Routing through the top-level quote
// ---------------------------------------------------------------------------

describe('pay — routing', () => {
  it('is routed by quote (no longer a not-implemented stub)', () => {
    // Regardless of whether a given Location Type allows `pay`, the top-level
    // `quote` must no longer answer with the not-implemented stub reason for a
    // pay — it is wired to `quotePay`. Any rejection must come from the shared
    // Location gate or `quotePay`'s own precondition, never the stub.
    const { state, npc } = staged(world(), MONEY_MICE, 5000);
    const q = quote(state, { kind: 'pay', npc, amount: 500 }, { content });
    expect(q.reason ?? '').not.toContain('not yet implemented');
  });
});
