/**
 * Tests for the surveil and follow actions (task 11.3; Requirements 12.5, 23.1,
 * 23.2, 23.3, 23.6, 23.7).
 *
 * These drive a generated {@link WorldState} from the real core pack through the
 * surveil/follow resolvers and the top-level {@link quote}/{@link resolve},
 * checking:
 *
 * - surveil at a Location observes the NPCs scheduled there (as `unk:` ids when
 *   unidentified) and reports surveillance `claimsAdded` (Req 23.1, 23.3, 23.4);
 * - a detection at reveal probability 1 always adds the "made" Fact Line and
 *   raises Cover Suspicion; at reveal probability 0 never shows the line
 *   (Req 23.6, 23.7);
 * - follow steps a present target and ends on a non-public Location / phase end;
 * - follow detection risk is strictly higher than surveil's (Req 23.6);
 * - a disallowed surveil (closed / wrong Location) leaves the state unchanged;
 * - determinism: the same inputs give the same result.
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
import { asTruth, revealTruth, type GameTime, type LocId, type NpcId } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import {
  TruthStore,
  type PredicateEvaluatorLookup,
} from '../truth/truth.js';
import { quote, resolve, visibleNpcsAt } from './action.js';
import {
  quoteSurveil,
  resolveSurveil,
  quoteFollow,
  resolveFollow,
  surveilDetectionBase,
  followDetectionBase,
  FOLLOW_DETECTION_FACTOR,
  FOLLOW_PHASE_COST,
  MADE_FACT_LINE,
  eventsInWindow,
} from './surveil.js';
import type { Observation, ResolverContext } from './result.js';
import type { FollowAction, ObservationSource, SurveilAction } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors read.spec.ts / identify.spec.ts)
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

function world(seed = 'surveil-alpha'): WorldState {
  return generate(seed, inputs());
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

/** The resolver context carrying content and a fresh Truth Store. */
function ctx(store: TruthStore = truth()): ResolverContext {
  return { content, truth: store };
}

/** A Prng whose `next()` always returns the given constant (for coin control). */
function fixedPrng(value: number): ReturnType<typeof createPrng> {
  const base = createPrng('ignored');
  return { ...base, next: () => value };
}

/**
 * Assert that a result has proposition Observations and that every one of them
 * carries `source` (the source its Case File Claim is filed under).
 */
function expectAllSourced(
  observations: readonly Observation[],
  source: ObservationSource,
): void {
  const sources = observations.flatMap((o) => (o.kind === 'proposition' ? [o.source] : []));
  expect(sources.length).toBeGreaterThan(0);
  expect(sources).toEqual(sources.map(() => source));
}

/**
 * A Location (and the day/phase of the given state) at which at least one NPC is
 * scheduled, so a surveil there observes someone. Searches the current phase
 * across every Location; the generated world always schedules principals
 * somewhere, so a hit is found. Returns the Location and the NPCs present.
 */
function populatedLocation(state: WorldState): { loc: LocId; npcs: NpcId[] } {
  for (const loc of Object.keys(state.city.locations) as LocId[]) {
    const npcs = visibleNpcsAt(state, loc);
    if (npcs.length > 0) {
      return { loc, npcs };
    }
  }
  throw new Error('no populated Location in the generated world at this time');
}

// ---------------------------------------------------------------------------
// Surveil observation (Req 23.1, 23.3, 23.4)
// ---------------------------------------------------------------------------

describe('resolveSurveil — observing a watched Location (Req 23.1, 23.3)', () => {
  it('observes the NPCs scheduled there and reports surveillance claimsAdded', () => {
    const state = world();
    const { loc, npcs } = populatedLocation(state);
    const store = truth();
    const a: SurveilAction = { kind: 'surveil', at: loc, phases: 1 };

    // Reveal/detection off (next() = 1 ⇒ never below any probability < 1).
    const { next, result } = resolveSurveil(state, a, fixedPrng(1), store, (s, obs) =>
      obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`)),
    );

    // At least one LOCATED_AT per present NPC — so claimsAdded is non-empty.
    expect(result.claimsAdded.length).toBeGreaterThanOrEqual(npcs.length);
    // Every claimAdded corresponds to a proposition Observation.
    const propIds = result.observations
      .filter((o) => o.kind === 'proposition')
      .map((o) => (o as { prop: { id: string } }).prop.id);
    expect([...result.claimsAdded].sort()).toEqual([...propIds].sort());
    // Every proposition Observation is sourced to the watched Location.
    expectAllSourced(result.observations, { kind: 'surveillance', loc });
    // The scene names the watched Location.
    expect(result.scene.loc).toBe(loc);
    // factLines render one line per observation.
    expect(result.factLines.length).toBe(result.observations.length);
    // Nobody detected (next=1), so Cover Suspicion is unchanged.
    expect(revealTruth(next.player.coverSuspicion)).toBe(
      revealTruth(state.player.coverSuspicion),
    );
  });

  it('surfaces unidentified NPCs as unk ids and allocates them in the next state', () => {
    const state = world();
    const { loc, npcs } = populatedLocation(state);
    const store = truth();
    // Ensure at least one present NPC is unidentified (none are known at start).
    const unidentified = npcs.find((id) => !state.player.known.entities.includes(id));
    expect(unidentified).toBeDefined();

    const a: SurveilAction = { kind: 'surveil', at: loc, phases: 1 };
    const { next } = resolveSurveil(state, a, fixedPrng(1), store, () => []);

    // A unk id was allocated for the unidentified NPC, and the Truth Store
    // resolves it back.
    const unk = next.player.unkIds[unidentified as NpcId];
    expect(unk).toMatch(/^unk:\d+$/);
    expect(revealTruth(store.identityOf(unk) as never)).toBe(unidentified);
  });

  it('a 2-phase watch runs two detection checks', () => {
    const state = world();
    const { loc } = populatedLocation(state);
    const store = truth();
    const a: SurveilAction = { kind: 'surveil', at: loc, phases: 2 };
    // next=0 ⇒ every coin is a hit; reveal shows every time. Two detections ⇒
    // Cover Suspicion rose, and two "made" lines appear.
    const { next, result } = resolveSurveil(state, a, fixedPrng(0), store, (s, obs) =>
      obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`)),
    );
    const made = result.observations.filter(
      (o) => o.kind === 'message' && o.line === MADE_FACT_LINE,
    );
    expect(made.length).toBe(2);
    expect(revealTruth(next.player.coverSuspicion)).toBeGreaterThan(
      revealTruth(state.player.coverSuspicion),
    );
  });
});

// ---------------------------------------------------------------------------
// Observing Sim events (Req 23.1, 23.2, 23.3, 25.5) — surveillance observes the
// Sim events at the Location, and reports co-presence only as sightings.
// ---------------------------------------------------------------------------

/** A hidden `meeting` Sim event at a Location and time, bound to participants. */
function meetingEvent(
  loc: LocId,
  at: GameTime,
  participants: readonly NpcId[],
  id = 'ev:meeting:test',
): SimEvent {
  return {
    id,
    at,
    visibility: 'hidden',
    kind: 'meeting',
    participants,
    loc,
    origin: asTruth({ kind: 'routine' }),
  };
}

/** Two distinct NPC ids from the world (for building a meeting event). */
function twoNpcs(state: WorldState): NpcId[] {
  const ids = Object.keys(state.npcs) as NpcId[];
  if (ids.length < 2) {
    throw new Error('generated world has fewer than two NPCs');
  }
  return [ids[0], ids[1]];
}

describe('resolveSurveil — observes Sim events; co-presence is a sighting (Req 23.1)', () => {
  it('a meeting event at the Location yields a MEETS_AT contact between its participants', () => {
    const state = world();
    const { loc } = populatedLocation(state);
    // The MEETS_AT comes from the meeting event's own participants, not from
    // co-presence, so two arbitrary NPC ids suffice.
    const participants = twoNpcs(state);
    const store = truth();
    const a: SurveilAction = { kind: 'surveil', at: loc, phases: 1 };
    const events = [meetingEvent(loc, state.time, participants)];

    // next()=0 ⇒ every observation coin passes (participant tradecraft < 1).
    const { result } = resolveSurveil(
      state,
      a,
      fixedPrng(0),
      store,
      (s, obs) => obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`)),
      events,
    );

    const meets = result.observations.filter(
      (o) => o.kind === 'proposition' && o.prop.predicate === 'MEETS_AT',
    );
    expect(meets.length).toBe(1);
    // The MEETS_AT names the meeting's participants (by npc/unk id), at the loc.
    const meet = meets[0] as { prop: { place: LocId } };
    expect(meet.prop.place).toBe(loc);
    // The contact, like every sighting, is sourced to the watched Location.
    expectAllSourced(result.observations, { kind: 'surveillance', loc });
  });

  it('with no meeting event present, no MEETS_AT is produced — co-presence is only a sighting', () => {
    const state = world();
    const { loc, npcs } = populatedLocation(state);
    const store = truth();
    const a: SurveilAction = { kind: 'surveil', at: loc, phases: 1 };

    // No events supplied, and the generated world schedules none, so the only
    // observations are LOCATED_AT sightings — never a meeting, even when
    // several NPCs stand in the same square (Req 23.1).
    const { result } = resolveSurveil(state, a, fixedPrng(1), store, () => [], []);

    const meets = result.observations.filter(
      (o) => o.kind === 'proposition' && o.prop.predicate === 'MEETS_AT',
    );
    const located = result.observations.filter(
      (o) => o.kind === 'proposition' && o.prop.predicate === 'LOCATED_AT',
    );
    expect(meets.length).toBe(0);
    expect(located.length).toBeGreaterThanOrEqual(npcs.length);
  });

  it('a participant with full tradecraft slips the watch (event not observed)', () => {
    const base = world();
    const { loc } = populatedLocation(base);
    const participants = twoNpcs(base);
    // Give the first participant perfect tradecraft ⇒ observation p = 0.
    const state: WorldState = {
      ...base,
      hostile: {
        ...base.hostile,
        doctrine: { ...base.hostile.doctrine, securityConsciousness: 1 },
      },
      npcs: {
        ...base.npcs,
        [participants[0]]: {
          ...base.npcs[participants[0]],
          tradecraft: revealTruthish(1),
        },
      },
    };
    const a: SurveilAction = { kind: 'surveil', at: loc, phases: 1 };
    const events = [meetingEvent(loc, state.time, participants)];
    // next()=0 would pass any positive p, but p = base × … × (1 − 1) = 0.
    const { result } = resolveSurveil(state, a, fixedPrng(0), truth(), () => [], events);
    const meets = result.observations.filter(
      (o) => o.kind === 'proposition' && o.prop.predicate === 'MEETS_AT',
    );
    expect(meets.length).toBe(0);
  });

  it('a lax service lets even a skilled operative be seen', () => {
    const base = world();
    const { loc } = populatedLocation(base);
    const participants = twoNpcs(base);
    // Perfect tradecraft under a service that does not insist on it (security
    // 0.5) gives p = 0.5, so a draw of 0.4 observes the meeting.
    const state: WorldState = {
      ...base,
      hostile: {
        ...base.hostile,
        doctrine: { ...base.hostile.doctrine, securityConsciousness: 0.5 },
      },
      npcs: {
        ...base.npcs,
        [participants[0]]: { ...base.npcs[participants[0]], tradecraft: revealTruthish(1) },
      },
    };
    const a: SurveilAction = { kind: 'surveil', at: loc, phases: 1 };
    const events = [meetingEvent(loc, state.time, participants)];
    const { result } = resolveSurveil(state, a, fixedPrng(0.4), truth(), () => [], events);
    const meets = result.observations.filter(
      (o) => o.kind === 'proposition' && o.prop.predicate === 'MEETS_AT',
    );
    expect(meets.length).toBe(1);
  });

  it('an event outside the watched window is not observed', () => {
    const state = world();
    const { loc } = populatedLocation(state);
    const participants = twoNpcs(state);
    const a: SurveilAction = { kind: 'surveil', at: loc, phases: 1 };
    // The meeting is one day later — outside a 1-phase watch starting now.
    const later: GameTime = { day: state.time.day + 1, phase: state.time.phase };
    const events = [meetingEvent(loc, later, participants)];
    const { result } = resolveSurveil(state, a, fixedPrng(0), truth(), () => [], events);
    const meets = result.observations.filter(
      (o) => o.kind === 'proposition' && o.prop.predicate === 'MEETS_AT',
    );
    expect(meets.length).toBe(0);
  });

  it('eventsInWindow filters by Location and the half-open [from, from+phases) window', () => {
    const state = world();
    const { loc } = populatedLocation(state);
    const pair = twoNpcs(state);
    const other = (Object.keys(state.city.locations) as LocId[]).find((l) => l !== loc)!;
    const now = state.time;
    const nextPhase: GameTime = { day: now.day, phase: ((now.phase + 1) % 4) as GameTime['phase'] };
    const here = meetingEvent(loc, now, pair, 'ev:here');
    const elsewhere = meetingEvent(other, now, pair, 'ev:elsewhere');
    const nextP = meetingEvent(loc, nextPhase, pair, 'ev:next');

    // A 1-phase window sees only the here-and-now event.
    const one = eventsInWindow(state, [here, elsewhere, nextP], loc, now, 1);
    expect(one.map((e) => e.id)).toEqual(['ev:here']);
    // A 2-phase window also sees the next phase, still filtering out `other`.
    const two = eventsInWindow(state, [here, elsewhere, nextP], loc, now, 2);
    expect(two.map((e) => e.id).sort()).toEqual(['ev:here', 'ev:next']);
  });
});

// ---------------------------------------------------------------------------
// Detection and being "made" (Req 23.6, 23.7)
// ---------------------------------------------------------------------------

describe('resolveSurveil — detection and the "made" Fact Line (Req 23.6, 23.7)', () => {
  it('reveal probability 1 always shows the "made" line and raises Cover Suspicion', () => {
    const base = world();
    const { loc, npcs } = populatedLocation(base);
    // Force a present NPC's security to 1 and the preset reveal to 1 so a
    // detection is certain (base surveil rate × security = base > 0) and always
    // revealed.
    const watched = npcs[0];
    const state: WorldState = {
      ...base,
      meta: { ...base.meta, preset: { ...base.meta.preset, madeRevealProbability: 1 } },
      npcs: {
        ...base.npcs,
        [watched]: { ...base.npcs[watched], securityConsciousness: revealTruthish(1) },
      },
    };
    expect(surveilDetectionBase(state)).toBeGreaterThan(0);

    const a: SurveilAction = { kind: 'surveil', at: loc, phases: 1 };
    const { next, result } = resolveSurveil(state, a, fixedPrng(0), truth(), () => []);

    expect(
      result.observations.some(
        (o) => o.kind === 'message' && o.line === MADE_FACT_LINE,
      ),
    ).toBe(true);
    expect(revealTruth(next.player.coverSuspicion)).toBeGreaterThan(
      revealTruth(state.player.coverSuspicion),
    );
  });

  it('reveal probability 0 never shows the "made" line', () => {
    const base = world();
    const { loc, npcs } = populatedLocation(base);
    const watched = npcs[0];
    const state: WorldState = {
      ...base,
      meta: { ...base.meta, preset: { ...base.meta.preset, madeRevealProbability: 0 } },
      npcs: {
        ...base.npcs,
        [watched]: { ...base.npcs[watched], securityConsciousness: revealTruthish(1) },
      },
    };
    const a: SurveilAction = { kind: 'surveil', at: loc, phases: 1 };
    const { result } = resolveSurveil(state, a, fixedPrng(0), truth(), () => []);
    expect(
      result.observations.some(
        (o) => o.kind === 'message' && o.line === MADE_FACT_LINE,
      ),
    ).toBe(false);
  });

  it('made Fact Line only ever shows when reveal coin is under the preset probability', () => {
    const base = world();
    const { loc, npcs } = populatedLocation(base);
    const watched = npcs[0];
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (reveal) => {
          const state: WorldState = {
            ...base,
            meta: {
              ...base.meta,
              preset: { ...base.meta.preset, madeRevealProbability: reveal },
            },
            npcs: {
              ...base.npcs,
              [watched]: {
                ...base.npcs[watched],
                securityConsciousness: revealTruthish(1),
              },
            },
          };
          const a: SurveilAction = { kind: 'surveil', at: loc, phases: 1 };
          // reveal coin exactly 0: shows iff 0 < reveal, i.e. reveal > 0.
          const { result } = resolveSurveil(state, a, fixedPrng(0), truth(), () => []);
          const shown = result.observations.some(
            (o) => o.kind === 'message' && o.line === MADE_FACT_LINE,
          );
          expect(shown).toBe(reveal > 0);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Follow (Req 23.2, 23.6)
// ---------------------------------------------------------------------------

describe('follow — stepping a present target (Req 23.2)', () => {
  it('follows a target present at the player Location and observes it', () => {
    const base = world();
    const { loc, npcs } = populatedLocation(base);
    const target = npcs[0];
    // Put the player where the target is, and make that Location public so the
    // follow observes rather than ending immediately.
    const state: WorldState = {
      ...base,
      player: { ...base.player, loc },
      city: {
        ...base.city,
        locations: {
          ...base.city.locations,
          [loc]: { ...base.city.locations[loc], public: true },
        },
      },
    };

    const store = truth();
    const q = quoteFollow(state, { kind: 'follow', target }, store);
    expect(q.allowed).toBe(true);
    expect(q.phases).toBe(FOLLOW_PHASE_COST);

    const a: FollowAction = { kind: 'follow', target };
    const { result } = resolveFollow(state, a, fixedPrng(1), store, () => []);
    expect(result.claimsAdded.length).toBeGreaterThan(0);
    // Each Observation is sourced to the Location the target was followed to.
    expectAllSourced(result.observations, { kind: 'surveillance', loc });
  });

  it('ends with nothing observed when the target enters a non-public Location', () => {
    const base = world();
    const { loc, npcs } = populatedLocation(base);
    const target = npcs[0];
    const state: WorldState = {
      ...base,
      player: { ...base.player, loc },
      city: {
        ...base.city,
        locations: {
          ...base.city.locations,
          [loc]: { ...base.city.locations[loc], public: false },
        },
      },
    };
    const a: FollowAction = { kind: 'follow', target };
    const { result } = resolveFollow(state, a, fixedPrng(0), truth(), () => []);
    expect(result.claimsAdded.length).toBe(0);
    expect(result.observations.length).toBe(0);
  });

  it('rejects a target not present at the player Location', () => {
    const base = world();
    const { loc, npcs } = populatedLocation(base);
    const target = npcs[0];
    // Player is somewhere the target is not scheduled.
    const elsewhere = (Object.keys(base.city.locations) as LocId[]).find(
      (l) => !visibleNpcsAt(base, l).includes(target),
    ) as LocId;
    const state: WorldState = { ...base, player: { ...base.player, loc: elsewhere } };
    const q = quoteFollow(state, { kind: 'follow', target }, truth());
    expect(q.allowed).toBe(false);
    void loc;
  });

  it('follow detection base is strictly higher than surveil detection base', () => {
    const state = world();
    expect(followDetectionBase(state)).toBe(
      surveilDetectionBase(state) * FOLLOW_DETECTION_FACTOR,
    );
    expect(followDetectionBase(state)).toBeGreaterThan(surveilDetectionBase(state));
  });
});

// ---------------------------------------------------------------------------
// The shared gate: disallowed surveil leaves state unchanged
// ---------------------------------------------------------------------------

describe('quote/resolve — disallowed surveil leaves state unchanged', () => {
  it('a closed watched Location rejects the surveil with the state unchanged', () => {
    const base = world();
    const { loc } = populatedLocation(base);
    // Close the watched Location in the current phase.
    const closed: WorldState = {
      ...base,
      city: {
        ...base.city,
        locations: {
          ...base.city.locations,
          [loc]: {
            ...base.city.locations[loc],
            hours: { 0: false, 1: false, 2: false, 3: false },
          },
        },
      },
    };
    const a: SurveilAction = { kind: 'surveil', at: loc, phases: 1 };
    const q = quote(closed, a, ctx());
    expect(q.allowed).toBe(false);
    const { next, result } = resolve(closed, a, fixedPrng(0), ctx());
    expect(next).toBe(closed);
    expect(result.claimsAdded.length).toBe(0);
  });

  it('rejects a surveil of a non-existent Location', () => {
    const state = world();
    const q = quoteSurveil(state, {
      kind: 'surveil',
      at: 'loc:does-not-exist' as LocId,
      phases: 1,
    });
    expect(q.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('resolveSurveil — determinism', () => {
  it('the same inputs give the same next state and result', () => {
    const state = world('surveil-det');
    const { loc } = populatedLocation(state);
    const a: SurveilAction = { kind: 'surveil', at: loc, phases: 2 };

    const render = (s: WorldState, obs: readonly { kind: string }[]): string[] =>
      obs.map((o) => o.kind);
    const first = resolveSurveil(state, a, createPrng('coin'), truth(), render as never);
    const second = resolveSurveil(state, a, createPrng('coin'), truth(), render as never);

    expect(first.result.claimsAdded).toEqual(second.result.claimsAdded);
    expect(revealTruth(first.next.player.coverSuspicion)).toBe(
      revealTruth(second.next.player.coverSuspicion),
    );
    expect(first.next.player.unkIds).toEqual(second.next.player.unkIds);
  });
});

/**
 * Brand a plain number as the Truth-wrapped `securityConsciousness` the test
 * overrides. The brand is erased at runtime, so this is just the value; the cast
 * keeps the type checker happy for a test-only override.
 */
function revealTruthish(value: number): WorldState['npcs'][NpcId]['securityConsciousness'] {
  return value as WorldState['npcs'][NpcId]['securityConsciousness'];
}
