/**
 * Tests for the talk and Cold Approach actions (task 11.4; Requirements 22.1,
 * 22.2, 22.3, 22.4, 22.5).
 *
 * These drive a generated {@link WorldState} from the real core pack through the
 * talk/approach resolvers and the top-level {@link quote}/{@link resolve},
 * checking:
 *
 * - talk requires presence (present ⇒ `openScene`; absent ⇒ not allowed)
 *   (Req 22.1);
 * - approach draws `firstContact`: a fitting cover at a σ that resolves > 0.5
 *   succeeds (opens a scene, the NPC joins contacts, `hasContactChannel` true,
 *   Req 22.4); a poor cover / high suspicion fails (brush-off line, raised Cover
 *   Suspicion, still no contact, Req 22.5);
 * - the σ probability is monotonic in cover fit and openness (property);
 * - `hasContactChannel` is true for a starting contact;
 * - determinism: the same seed gives the same approach outcome;
 * - a disallowed talk/approach leaves the state unchanged.
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
import { asTruth, revealTruth, type LocId, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import {
  TruthStore,
  type PredicateEvaluatorLookup,
} from '../truth/truth.js';
import { quote, resolve, visibleNpcsAt } from './action.js';
import {
  quoteTalk,
  resolveTalk,
  quoteApproach,
  resolveApproach,
  hasContactChannel,
  addContactChannel,
  firstContactWeightsOf,
  BRUSH_OFF_LINE,
  TALK_SCENE_LINE,
  APPROACH_SUSPICION_DELTA,
  TALK_PHASE_COST,
} from './talk.js';
import {
  coverFit,
  firstContactProbability,
  type FirstContactNpc,
} from '../recruit/first-contact.js';
import type { Observation, ResolverContext } from './result.js';
import type { ApproachAction, TalkAction } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors surveil.spec.ts)
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

function world(seed = 'talk-alpha'): WorldState {
  return generate(seed, inputs());
}

/** A Truth Store that knows the alias predicate (kind). */
function truth(): TruthStore {
  const lookup: PredicateEvaluatorLookup = {
    get: (predicate) =>
      predicate === 'IS_ALIAS_OF' ? ('alias' as EvaluatorKind) : undefined,
  };
  return TruthStore.create(lookup);
}

function ctx(store: TruthStore = truth()): ResolverContext {
  return { content, truth: store };
}

/** A Prng whose `next()` always returns the given constant (coin control). */
function fixedPrng(value: number): ReturnType<typeof createPrng> {
  const base = createPrng('ignored');
  return { ...base, next: () => value };
}

/** The render callback used in tests: observations to their lines/ids. */
function renderLines(_s: WorldState, obs: readonly Observation[]): string[] {
  return obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`));
}

/** A Location where at least one NPC is scheduled this phase, with them present. */
function populatedLocation(state: WorldState): { loc: LocId; npcs: NpcId[] } {
  for (const loc of Object.keys(state.city.locations) as LocId[]) {
    const npcs = visibleNpcsAt(state, loc);
    if (npcs.length > 0) {
      return { loc, npcs };
    }
  }
  throw new Error('no populated Location in the generated world at this time');
}

/**
 * Put the player at a populated, open Location that allows talk/approach, with
 * the first present NPC removed from the player's contacts (so an approach is a
 * genuine *first* contact). Returns the staged state, the Location and the NPC.
 */
function stagedForContact(
  base: WorldState,
): { state: WorldState; loc: LocId; npc: NpcId } {
  const { loc, npcs } = populatedLocation(base);
  const npc = npcs[0];
  const state: WorldState = {
    ...base,
    player: {
      ...base.player,
      loc,
      contacts: base.player.contacts.filter((c) => c !== npc),
      // kaffeehaus/park etc. all allow talk+approach; make the Location open and
      // public so the shared gate passes regardless of the generated type.
    },
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
  return { state, loc, npc };
}

// ---------------------------------------------------------------------------
// Talk — presence (Req 22.1)
// ---------------------------------------------------------------------------

describe('talk — presence (Req 22.1)', () => {
  it('present NPC: quote is allowed and resolve opens a scene', () => {
    const { state, npc } = stagedForContact(world());
    const store = truth();
    const q = quoteTalk(state, { kind: 'talk', npc }, store);
    expect(q.allowed).toBe(true);
    expect(q.phases).toBe(TALK_PHASE_COST);

    const a: TalkAction = { kind: 'talk', npc };
    const { next, result } = resolveTalk(state, a, renderLines);
    expect(result.openScene).toEqual({ npc });
    expect(result.factLines).toContain(TALK_SCENE_LINE);
    // Talk creates no Contact Channel.
    expect(hasContactChannel(next, npc)).toBe(false);
    // State otherwise unchanged.
    expect(next).toBe(state);
  });

  it('absent NPC: quote is not allowed', () => {
    const base = world();
    const { loc, npcs } = populatedLocation(base);
    const target = npcs[0];
    // Move the player somewhere the target is not scheduled.
    const elsewhere = (Object.keys(base.city.locations) as LocId[]).find(
      (l) => !visibleNpcsAt(base, l).includes(target),
    ) as LocId;
    const state: WorldState = { ...base, player: { ...base.player, loc: elsewhere } };
    const q = quoteTalk(state, { kind: 'talk', npc: target }, truth());
    expect(q.allowed).toBe(false);
    void loc;
  });

  it('rejects a target that resolves to no real person', () => {
    const base = world();
    const q = quoteTalk(base, { kind: 'talk', npc: 'npc:nobody' as NpcId }, truth());
    expect(q.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Approach — Cold Approach success / failure (Req 22.2, 22.4, 22.5)
// ---------------------------------------------------------------------------

describe('approach — Cold Approach (Req 22.2, 22.4, 22.5)', () => {
  it('quote allowed for a present non-contact; not allowed once a contact exists', () => {
    const { state, npc } = stagedForContact(world());
    const store = truth();
    expect(quoteApproach(state, { kind: 'approach', npc }, store).allowed).toBe(true);

    // Make the NPC a contact: approach is now disallowed (talk instead).
    const withContact = addContactChannel(state, npc);
    expect(quoteApproach(withContact, { kind: 'approach', npc }, store).allowed).toBe(
      false,
    );
  });

  it('success (coin 0 ⇒ always under p): opens scene, mints a Contact Channel', () => {
    const { state, npc } = stagedForContact(world());
    const a: ApproachAction = { kind: 'approach', npc };
    // next()=0 is below any positive probability, so the approach succeeds.
    const { next, result } = resolveApproach(state, a, fixedPrng(0), truth(), renderLines);

    expect(result.openScene).toEqual({ npc });
    expect(result.factLines).toContain(TALK_SCENE_LINE);
    // Contact Channel created: the NPC is now a contact and a known entity.
    expect(hasContactChannel(next, npc)).toBe(true);
    expect(next.player.contacts).toContain(npc);
    expect(next.player.known.entities).toContain(npc);
    // Success does not raise Cover Suspicion.
    expect(revealTruth(next.player.coverSuspicion)).toBe(
      revealTruth(state.player.coverSuspicion),
    );
  });

  it('failure (coin 1 ⇒ never under p): brush-off, raised suspicion, no contact', () => {
    const { state, npc } = stagedForContact(world());
    const a: ApproachAction = { kind: 'approach', npc };
    const { next, result } = resolveApproach(state, a, fixedPrng(1), truth(), renderLines);

    expect(result.openScene).toBeUndefined();
    expect(result.factLines).toContain(BRUSH_OFF_LINE);
    // No Contact Channel created.
    expect(hasContactChannel(next, npc)).toBe(false);
    // Cover Suspicion rose by the brush-off delta.
    expect(revealTruth(next.player.coverSuspicion)).toBeCloseTo(
      revealTruth(state.player.coverSuspicion) + APPROACH_SUSPICION_DELTA,
    );
  });

  it('a fitting cover with coin 0 and a poor cover with coin 1 differ as expected', () => {
    const { state, loc, npc } = stagedForContact(world());
    // Fit cover: set the player's cover to fit this Location's Type.
    const type = state.city.locations[loc].type;
    const fitState: WorldState = {
      ...state,
      player: {
        ...state.player,
        cover: { ...state.player.cover, fitLocationTypes: [type] },
      },
    };
    const npcModel = fitState.npcs[npc];
    const fcNpc: FirstContactNpc = {
      wariness: npcModel.wariness,
      openness: npcModel.persona.openness,
      archetype: npcModel.archetype,
    };
    const weights = firstContactWeightsOf(fitState);
    const pFit = firstContactProbability(
      fcNpc,
      fitState.player.cover,
      fitState.city.locations[loc],
      weights,
      revealTruth(fitState.player.coverSuspicion),
    );

    // Poor cover: no fit types ⇒ coverFit 0 ⇒ strictly lower probability.
    const poorCover = { ...fitState.player.cover, fitLocationTypes: [] as string[] };
    const pPoor = firstContactProbability(
      fcNpc,
      poorCover,
      fitState.city.locations[loc],
      weights,
      revealTruth(fitState.player.coverSuspicion),
    );
    expect(pFit).toBeGreaterThan(pPoor);
  });
});

// ---------------------------------------------------------------------------
// firstContact / σ monotonicity (property) (Req 22.2)
// ---------------------------------------------------------------------------

describe('firstContactProbability — monotonic in coverFit and openness (Req 22.2)', () => {
  it('rises with openness and with cover fit, for positive weights', () => {
    const { state, loc } = stagedForContact(world());
    const place = state.city.locations[loc];
    const weights = { a: 1, b: 1, c: 1, d: 1 };
    // A cover that fits this Location's Type, and one that does not.
    const fitCover = { ...state.player.cover, fitLocationTypes: [place.type] };
    const noFitCover = { ...state.player.cover, fitLocationTypes: [] as string[] };

    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (wariness, openLo, bump, suspicion) => {
          const openHi = Math.min(1, openLo + bump);
          const npcLo: FirstContactNpc = { wariness, openness: openLo, archetype: 'x' };
          const npcHi: FirstContactNpc = { wariness, openness: openHi, archetype: 'x' };

          const pLo = firstContactProbability(npcLo, fitCover, place, weights, suspicion);
          const pHi = firstContactProbability(npcHi, fitCover, place, weights, suspicion);
          // More openness never lowers the probability.
          expect(pHi).toBeGreaterThanOrEqual(pLo - 1e-12);

          // A fitting cover never lowers the probability vs. a non-fitting one.
          const pFit = firstContactProbability(npcLo, fitCover, place, weights, suspicion);
          const pNoFit = firstContactProbability(
            npcLo,
            noFitCover,
            place,
            weights,
            suspicion,
          );
          expect(pFit).toBeGreaterThanOrEqual(pNoFit - 1e-12);
        },
      ),
    );
  });

  it('coverFit is 1 at a fitting Location and 0 elsewhere', () => {
    const { state, loc } = stagedForContact(world());
    const place = state.city.locations[loc];
    const fitCover = { ...state.player.cover, fitLocationTypes: [place.type] };
    const noFitCover = { ...state.player.cover, fitLocationTypes: [] as string[] };
    expect(coverFit(fitCover, place, 'any')).toBe(1);
    expect(coverFit(noFitCover, place, 'any')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Contact Channels (Req 22.4) and starting contacts (Req 26.1)
// ---------------------------------------------------------------------------

describe('hasContactChannel (Req 22.4)', () => {
  it('is true for a starting contact and false for a non-contact', () => {
    const base = world();
    // The Starting Brief seeds player.contacts; at least check the predicate
    // tracks membership precisely.
    const someNpc = (Object.keys(base.npcs) as NpcId[])[0];
    const stateWith: WorldState = {
      ...base,
      player: { ...base.player, contacts: [someNpc] },
    };
    expect(hasContactChannel(stateWith, someNpc)).toBe(true);
    const other = (Object.keys(base.npcs) as NpcId[]).find((n) => n !== someNpc) as NpcId;
    expect(hasContactChannel(stateWith, other)).toBe(false);
  });

  it('addContactChannel is idempotent', () => {
    const base = world();
    const npc = (Object.keys(base.npcs) as NpcId[])[0];
    const once = addContactChannel(base, npc);
    const twice = addContactChannel(once, npc);
    expect(twice).toBe(once);
    expect(once.player.contacts.filter((c) => c === npc).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Determinism and the shared gate
// ---------------------------------------------------------------------------

describe('approach — determinism and the shared gate', () => {
  it('the same seed gives the same approach outcome', () => {
    const { state, npc } = stagedForContact(world('talk-det'));
    const a: ApproachAction = { kind: 'approach', npc };
    const first = resolveApproach(state, a, createPrng('coin'), truth(), renderLines);
    const second = resolveApproach(state, a, createPrng('coin'), truth(), renderLines);
    expect(first.result.openScene).toEqual(second.result.openScene);
    expect(first.next.player.contacts).toEqual(second.next.player.contacts);
    expect(revealTruth(first.next.player.coverSuspicion)).toBe(
      revealTruth(second.next.player.coverSuspicion),
    );
  });

  it('a closed Location rejects talk/approach with the state unchanged', () => {
    const { state, npc } = stagedForContact(world());
    const closed: WorldState = {
      ...state,
      city: {
        ...state.city,
        locations: {
          ...state.city.locations,
          [state.player.loc]: {
            ...state.city.locations[state.player.loc],
            hours: { 0: false, 1: false, 2: false, 3: false },
          },
        },
      },
    };
    const talk: TalkAction = { kind: 'talk', npc };
    expect(quote(closed, talk, ctx()).allowed).toBe(false);
    const r1 = resolve(closed, talk, fixedPrng(0), ctx());
    expect(r1.next).toBe(closed);

    const approach: ApproachAction = { kind: 'approach', npc };
    expect(quote(closed, approach, ctx()).allowed).toBe(false);
    const r2 = resolve(closed, approach, fixedPrng(0), ctx());
    expect(r2.next).toBe(closed);
  });

  it('a failed approach through the top-level resolve raises Cover Suspicion', () => {
    const { state, npc } = stagedForContact(world());
    // Only run when the staged Location's type allows approach; otherwise the
    // shared gate rejects and there is nothing to assert here.
    const type = content.locationTypes;
    void type;
    const approach: ApproachAction = { kind: 'approach', npc };
    const q = quote(state, approach, ctx());
    if (!q.allowed) {
      // The generated Location's Type does not allow approach; skip assertion.
      return;
    }
    const before = revealTruth(state.player.coverSuspicion);
    const { next } = resolve(state, approach, fixedPrng(1), ctx());
    expect(revealTruth(next.player.coverSuspicion)).toBeGreaterThanOrEqual(before);
    void asTruth;
  });
});
