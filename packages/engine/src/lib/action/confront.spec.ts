/**
 * Tests for the confront-with-Claim action (task 18.3; Requirements 6.3, 6.4).
 *
 * These drive a generated {@link WorldState} from the real core pack through the
 * confront resolver and the top-level {@link quote}/{@link resolve}, checking:
 *
 * - confront requires presence, a held Case File Claim (projected onto
 *   `ctx.claims`), and that the Claim concerns the confronted NPC (Req 6.4);
 * - a successful press degrades the NPC's cover state on the Relationship and
 *   emits a cover-state Fact Line (Req 6.3);
 * - a broken cover emits an Agenda-shift Fact Line (partial admission,
 *   bargaining or flight; Req 6.4);
 * - confront adds no Case File Claims (it reads them);
 * - determinism: the same seed gives the same confront outcome;
 * - a disallowed confront leaves the state unchanged and is routed (no longer a
 *   not-implemented stub).
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

import { createPrng } from '../prng/prng.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { asTruth, type LocId, type NpcId, type OrgId, type Proposition } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { quote, resolve, visibleNpcsAt } from './action.js';
import {
  CONFRONT_PHASE_COST,
  coverStateLine,
  agendaShiftLine,
  claimConcernsNpc,
  quoteConfront,
  resolveConfront,
} from './confront.js';
import { newRelationship, type Relationship } from '../recruit/asset.js';
import type { Observation, ResolverContext } from './result.js';
import type { ConfrontAction } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors talk.spec.ts)
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

function world(seed = 'confront-alpha'): WorldState {
  return generate(seed, inputs());
}

/** The render callback used in tests: observations to their lines/ids. */
function renderLines(_s: WorldState, obs: readonly Observation[]): string[] {
  return obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`));
}

/** A Prng whose `next()` always returns the given constant (coin control). */
function fixedPrng(value: number): ReturnType<typeof createPrng> {
  const base = createPrng('ignored');
  return { ...base, next: () => value };
}

/** A Location where at least one NPC is present this phase. */
function populatedLocation(state: WorldState): { loc: LocId; npcs: NpcId[] } {
  for (const loc of Object.keys(state.city.locations) as LocId[]) {
    const npcs = visibleNpcsAt(state, loc);
    if (npcs.length > 0) {
      return { loc, npcs };
    }
  }
  throw new Error('no populated Location in the generated world at this time');
}

const CLAIM_ID = 'claim:1';

/** A Case File Claim Proposition about an NPC (its subject). */
function claimAbout(npc: NpcId): Proposition {
  return {
    id: 'prop:confront',
    predicate: 'core/WORKS_FOR',
    subject: npc,
    object: 'org:hostile' as OrgId,
  } as unknown as Proposition;
}

/**
 * Stage the player at a populated, open Location with the first present NPC
 * returned, and build a resolver context whose `claims` holds one Claim about
 * that NPC. Optionally seed a Relationship (so cover-state transitions start
 * from a known rung).
 */
function staged(
  base: WorldState,
  rel?: Partial<Relationship>,
): { state: WorldState; npc: NpcId; ctx: ResolverContext } {
  const { loc, npcs } = populatedLocation(base);
  const npc = npcs[0];
  const relationships = rel
    ? { ...base.relationships, [npc]: { ...newRelationship(npc), ...rel } }
    : base.relationships;
  const state: WorldState = {
    ...base,
    relationships,
    player: { ...base.player, loc },
    city: {
      ...base.city,
      locations: {
        ...base.city.locations,
        [loc]: {
          ...base.city.locations[loc],
          hours: { 0: true, 1: true, 2: true, 3: true },
        },
      },
    },
  };
  const ctx: ResolverContext = { content, claims: { [CLAIM_ID]: claimAbout(npc) } };
  return { state, npc, ctx };
}

/** A soft, trusting setup so the pressure check reliably succeeds. */
function soften(state: WorldState, npc: NpcId): WorldState {
  return {
    ...state,
    npcs: {
      ...state.npcs,
      [npc]: {
        ...state.npcs[npc],
        tradecraft: asTruth(0),
        securityConsciousness: asTruth(0),
        wariness: 0,
      },
    },
    relationships: {
      ...state.relationships,
      [npc]: { ...(state.relationships[npc] ?? newRelationship(npc)), trust: 1 },
    },
  };
}

// ---------------------------------------------------------------------------
// Quote eligibility (Req 6.4)
// ---------------------------------------------------------------------------

describe('confront — quote eligibility (Req 6.4)', () => {
  it('is allowed when the NPC is present and a Claim about them is held', () => {
    const { state, npc, ctx } = staged(world());
    const q = quoteConfront(state, { kind: 'confront', npc, claim: CLAIM_ID }, ctx);
    expect(q.allowed).toBe(true);
    expect(q.phases).toBe(CONFRONT_PHASE_COST);
    expect(q.money).toBe(0);
  });

  it('is not allowed when the Claim is not held', () => {
    const { state, npc } = staged(world());
    const emptyCtx: ResolverContext = { content, claims: {} };
    const q = quoteConfront(state, { kind: 'confront', npc, claim: CLAIM_ID }, emptyCtx);
    expect(q.allowed).toBe(false);
  });

  it('is not allowed when the Claim does not concern the NPC', () => {
    const { state, npc } = staged(world());
    const otherCtx: ResolverContext = {
      content,
      claims: { [CLAIM_ID]: claimAbout('npc:someone-else' as NpcId) },
    };
    const q = quoteConfront(state, { kind: 'confront', npc, claim: CLAIM_ID }, otherCtx);
    expect(q.allowed).toBe(false);
  });

  it('is not allowed when the NPC is not present', () => {
    const base = world();
    const { npc, ctx } = staged(base);
    // Move the player somewhere the NPC is not scheduled.
    const empty = Object.keys(base.city.locations).find(
      (l) => !visibleNpcsAt(base, l as LocId).includes(npc),
    ) as LocId;
    const away: WorldState = { ...base, player: { ...base.player, loc: empty } };
    const q = quoteConfront(away, { kind: 'confront', npc, claim: CLAIM_ID }, ctx);
    expect(q.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Resolve — cover-state transitions and Agenda change (Req 6.3, 6.4)
// ---------------------------------------------------------------------------

describe('confront — resolve (Req 6.3, 6.4)', () => {
  it('degrades the cover and emits a cover-state Fact Line on a success', () => {
    const base = world();
    const { npc, ctx } = staged(base, { coverState: 'intact' });
    const state = soften(base, npc);
    const a: ConfrontAction = { kind: 'confront', npc, claim: CLAIM_ID };
    // A near-zero draw clears the check against the softened NPC.
    const { next, result } = resolveConfront(state, a, fixedPrng(0), ctx, renderLines);

    const after = next.relationships[npc].coverState;
    expect(after).not.toBe('intact');
    expect(result.factLines).toContain(coverStateLine(after));
    // Confront reads Claims; it adds none.
    expect(result.claimsAdded).toEqual([]);
  });

  it('leaves the cover unchanged and renders the holding line on a failure', () => {
    const base = world();
    const { npc, ctx } = staged(base, { coverState: 'strained' });
    // A near-one draw fails every check.
    const state: WorldState = {
      ...base,
      player: { ...base.player, loc: staged(base).state.player.loc },
      relationships: {
        ...base.relationships,
        [npc]: { ...newRelationship(npc), coverState: 'strained' },
      },
    };
    const a: ConfrontAction = { kind: 'confront', npc, claim: CLAIM_ID };
    const { next, result } = resolveConfront(state, a, fixedPrng(0.999999), ctx, renderLines);
    expect(next.relationships[npc].coverState).toBe('strained');
    expect(result.factLines).toContain(coverStateLine('strained'));
  });

  it('emits an Agenda-shift Fact Line when the cover breaks (Req 6.4)', () => {
    const base = world();
    // Start one rung before cracking so a single successful step breaks it.
    const { npc, ctx } = staged(base, { coverState: 'strained' });
    const state = soften(base, npc);
    const stateCracking: WorldState = {
      ...state,
      relationships: {
        ...state.relationships,
        [npc]: { ...state.relationships[npc], coverState: 'strained' },
      },
    };
    const a: ConfrontAction = { kind: 'confront', npc, claim: CLAIM_ID };
    const { next, result } = resolveConfront(stateCracking, a, fixedPrng(0.4), ctx, renderLines);
    const after = next.relationships[npc].coverState;
    // The cover broke into cracking or blown.
    expect(['cracking', 'blown']).toContain(after);
    // Some Agenda-shift line is present alongside the cover-state line.
    const anyShift =
      result.factLines.includes(agendaShiftLine('partial-admission') ?? '') ||
      result.factLines.includes(agendaShiftLine('bargaining') ?? '') ||
      result.factLines.includes(agendaShiftLine('flight') ?? '');
    expect(anyShift).toBe(true);
  });

  it('mints a neutral relationship when the player had none', () => {
    const base = world();
    const { npc, ctx } = staged(base);
    const state = soften(
      { ...base, relationships: {} },
      npc,
    );
    // soften seeded a relationship; drop it so confront must mint one.
    const noRel: WorldState = { ...state, relationships: {} };
    const a: ConfrontAction = { kind: 'confront', npc, claim: CLAIM_ID };
    const { next } = resolveConfront(noRel, a, fixedPrng(0), ctx, renderLines);
    expect(next.relationships[npc]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Determinism and routing through the top-level resolve
// ---------------------------------------------------------------------------

describe('confront — determinism and routing', () => {
  it('is deterministic for a seed', () => {
    const base = world();
    const { npc, ctx } = staged(base, { coverState: 'intact' });
    const state = soften(base, npc);
    const a: ConfrontAction = { kind: 'confront', npc, claim: CLAIM_ID };
    const r1 = resolveConfront(state, a, createPrng('seed-confront'), ctx, renderLines);
    const r2 = resolveConfront(state, a, createPrng('seed-confront'), ctx, renderLines);
    expect(r1.next.relationships[npc].coverState).toBe(
      r2.next.relationships[npc].coverState,
    );
    expect(r1.result.factLines).toEqual(r2.result.factLines);
  });

  it('is routed by quote (not a not-implemented stub)', () => {
    // Through the top-level `quote`, confront passes the shared Location gate
    // only where the Location Type allows it; regardless, it must no longer
    // return the not-implemented stub reason — it is wired to `quoteConfront`.
    const { state, npc, ctx } = staged(world());
    const q = quote(state, { kind: 'confront', npc, claim: CLAIM_ID }, ctx);
    expect(q.reason ?? '').not.toContain('not yet implemented');
  });

  it('leaves the state unchanged when the confront is disallowed', () => {
    const { state, npc } = staged(world());
    const emptyCtx: ResolverContext = { content, claims: {} };
    const a: ConfrontAction = { kind: 'confront', npc, claim: CLAIM_ID };
    const { next } = resolve(state, a, createPrng('x'), emptyCtx);
    expect(next).toBe(state);
  });
});

describe('claimConcernsNpc', () => {
  it('is true when the NPC is the subject or the entity object', () => {
    const npc = 'npc:a' as NpcId;
    expect(claimConcernsNpc(claimAbout(npc), npc)).toBe(true);
    const asObject = {
      id: 'p',
      predicate: 'core/KNOWS',
      subject: 'npc:b' as NpcId,
      object: npc,
    } as unknown as Proposition;
    expect(claimConcernsNpc(asObject, npc)).toBe(true);
    expect(claimConcernsNpc(claimAbout('npc:other' as NpcId), npc)).toBe(false);
  });
});
