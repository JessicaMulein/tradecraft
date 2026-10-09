/**
 * Property 17 — Surveillance fidelity (dedicated formal version; task 11.9;
 * Requirements 23.1, 23.2, 23.3, 23.4, 25.5).
 *
 * The design states Property 17 as:
 *
 * > **Property 17: Surveillance fidelity.** For any reachable state and surveil,
 * > follow or wait action:
 * > - every Observation corresponds to a Sim event at the target within the
 * >   window;
 * > - every resulting Claim holds in the Truth Store at its observed time after
 * >   resolving `unk:` ids;
 * > - two sightings share an Unidentified Subject id if and only if they are the
 * >   same NPC.
 *
 * `surveil.spec.ts` (task 11.3) already covers the surveil/follow resolvers by
 * example, including the "a meeting event yields a MEETS_AT, co-presence does
 * not" cases; this is the NEW dedicated Property-17 file, driving the real
 * generated world through the three observing resolvers over fast-check-generated
 * sets of Sim events at a watched Location. Test-only — it touches no production
 * code.
 *
 * ## What is being checked, precisely
 *
 * Task 26.6 made surveillance observe the *actual Sim events* the clock emits,
 * so each Observation a surveil / follow / wait produces must trace back to a
 * real event at the watched Location and time. We generate an arbitrary set of
 * `meeting` and `npc-moved` events at a watched, otherwise-empty Location over a
 * one- or two-phase window, seed the Truth Store with the ground-truth facts
 * those events assert (so the observed Claims are *true*), run each resolver with
 * an always-observe coin, and assert:
 *
 * - **(fidelity)** every proposition Observation corresponds to an event we
 *   generated at the watched Location in the window — a `MEETS_AT` only ever
 *   from a `meeting` event's participants (never from mere co-presence), a
 *   `LOCATED_AT` only from an event that sites its subject there (Req 23.1,
 *   23.2);
 * - **(truth)** every observed Claim `holds` in the Truth Store at its observed
 *   time, after `holds` resolves its `unk:` ids back to the real NPCs (Req 23.3);
 * - **(unk ids)** every unidentified subject surfaces as an `unk:` id, and two
 *   sightings share an `unk:` id iff they denote the same NPC (Req 23.4);
 * - **(no meeting without a meeting event)** a window of only `npc-moved` events
 *   never yields a `MEETS_AT`, however many NPCs are co-present.
 *
 * We watch a Location with *no NPC scheduled at the current phase*, so the
 * resolvers' co-presence sightings contribute nothing and every Observation is
 * driven by a generated event — this keeps the ground truth we must seed exactly
 * the events' own assertions. We reuse the core-pack `world()` fixture, `truth()`,
 * `fixedPrng`, `meetingEvent` and the `eventsInWindow` convention mirrored from
 * `surveil.spec.ts`, and drive `resolveSurveil` / `resolveFollow` (surveil.ts)
 * and `waitObservations` (intercept.ts) so the three observation paths are held
 * to the same fidelity bar.
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
import {
  asTruth,
  timeToPhases,
  type GameTime,
  type LocId,
  type NpcId,
  type Phase,
  type Proposition,
  type UnkId,
} from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import {
  TruthStore,
  type PredicateEvaluatorLookup,
} from '../truth/truth.js';
import { CONTENT_WEEKDAYS, weekdayForDay } from '../city/time-mapping.js';
import type { NpcSchedule } from '../city/npc.js';
import { visibleNpcsAt } from './action.js';
import {
  resolveFollow,
  resolveSurveil,
  eventsInWindow,
  npcsScheduledAt,
} from './surveil.js';
import { waitObservations } from './intercept.js';
import type { Observation } from './result.js';
import type { FollowAction, SurveilAction, WaitAction } from './types.js';

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

function world(seed = 'surveillance-fidelity'): WorldState {
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

/** A Prng whose `next()` always returns the given constant (for coin control). */
function fixedPrng(value: number): ReturnType<typeof createPrng> {
  const base = createPrng('ignored');
  return { ...base, next: () => value };
}

const noRender = (): string[] => [];

// ---------------------------------------------------------------------------
// Watched Location + NPC palette
// ---------------------------------------------------------------------------

/**
 * A *public, open* Location with **no NPC scheduled at the current phase**, so a
 * surveil / follow / wait there sees nobody by co-presence and every Observation
 * is driven by a generated Sim event. We restamp a real Location to guarantee it
 * is empty, public and open regardless of the generated schedule.
 */
const WATCHED: LocId = (() => {
  const base = world();
  return (Object.keys(base.city.locations) as LocId[])[0];
})();

/** Restamp the watched Location empty-of-schedule, public and open everywhere. */
function withEmptyWatchedLocation(base: WorldState): WorldState {
  const loc = base.city.locations[WATCHED];
  // Strip any NPC scheduled at the watched Location this phase so co-presence
  // contributes nothing — the generated events are the only observation driver.
  const npcs = { ...base.npcs };
  const present = npcsScheduledAt(base, WATCHED);
  for (const id of present) {
    const npc = npcs[id];
    // Move the NPC's whole schedule off the watched Location by blanking it; a
    // schedule read for the watched Location then returns something else/none.
    npcs[id] = { ...npc, schedule: emptySchedule(npc.schedule) };
  }
  return {
    ...base,
    npcs,
    city: {
      ...base.city,
      locations: {
        ...base.city.locations,
        [WATCHED]: {
          ...loc,
          public: true,
          hours: { 0: true, 1: true, 2: true, 3: true },
        },
      },
    },
  };
}

/** The current weekday ordinal for a state's day (matches the resolvers' read). */
function weekdayOf(state: WorldState): number {
  return CONTENT_WEEKDAYS.indexOf(weekdayForDay(state.time.day));
}

/**
 * A schedule with every entry pointing at the watched Location dropped, so no
 * NPC is co-present there at any time. Other entries are left untouched; a
 * missing `(weekday, phase)` reads as "not scheduled" (`scheduledLocation`
 * returns `undefined`).
 */
function emptySchedule(schedule: NpcSchedule): NpcSchedule {
  return {
    ...schedule,
    entries: schedule.entries.filter((e) => e.loc !== WATCHED),
  };
}

/** Three distinct NPC ids from the world (for building meeting participants). */
function npcPalette(state: WorldState): NpcId[] {
  const ids = (Object.keys(state.npcs) as NpcId[]).slice().sort();
  if (ids.length < 3) {
    throw new Error('generated world has fewer than three NPCs');
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Event helpers (mirror surveil.spec.ts's meetingEvent)
// ---------------------------------------------------------------------------

/** A hidden `meeting` Sim event at a Location and time, bound to participants. */
function meetingEvent(
  loc: LocId,
  at: GameTime,
  participants: readonly NpcId[],
  id: string,
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

/** A hidden `npc-moved` Sim event: an NPC arrives at `to` at a time. */
function moveEvent(to: LocId, at: GameTime, npc: NpcId, from: LocId, id: string): SimEvent {
  return { id, at, visibility: 'hidden', kind: 'npc-moved', npc, from, to };
}

// ---------------------------------------------------------------------------
// Arbitraries: a set of Sim events at the watched Location over a window
// ---------------------------------------------------------------------------

/** A generated event: a meeting of 2–3 NPCs, or a single-NPC move, at a phase offset. */
type GenEvent =
  | { readonly tag: 'meeting'; readonly who: readonly number[]; readonly phaseOffset: number }
  | { readonly tag: 'move' | 'terminal' | 'carriage'; readonly who: number; readonly phaseOffset: number };

function genEventArb(npcCount: number): fc.Arbitrary<GenEvent> {
  const idx = fc.integer({ min: 0, max: npcCount - 1 });
  const meeting = fc
    .uniqueArray(idx, { minLength: 2, maxLength: 3 })
    .chain((who) =>
      fc.record({
        tag: fc.constant('meeting' as const),
        who: fc.constant(who),
        phaseOffset: fc.integer({ min: 0, max: 1 }),
      }),
    );
  const move = fc.record({
    tag: fc.constantFrom('move' as const, 'terminal' as const, 'carriage' as const),
    who: idx,
    phaseOffset: fc.integer({ min: 0, max: 1 }),
  });
  return fc.oneof(meeting, move);
}

/** The watch's phase span: 1 or 2 phases. */
const phasesArb: fc.Arbitrary<1 | 2> = fc.constantFrom(1, 2);

/**
 * Materialise generated events at the watched Location over the window starting
 * at `from`. A `phaseOffset` of 1 is only kept when the watch spans two phases
 * (so every materialised event falls inside the window and is observable).
 */
function materialise(
  gen: readonly GenEvent[],
  palette: readonly NpcId[],
  from: GameTime,
  phases: 1 | 2,
  elsewhere: LocId,
): SimEvent[] {
  const out: SimEvent[] = [];
  gen.forEach((g, i) => {
    const offset = g.phaseOffset < phases ? g.phaseOffset : 0;
    const at = atOffset(from, offset);
    if (g.tag === 'meeting') {
      const who = g.who.map((n) => palette[n]);
      out.push(meetingEvent(WATCHED, at, who, `ev:meet:${i}`));
    } else {
      out.push(moveEvent(WATCHED, at, palette[g.who], elsewhere, `ev:move:${i}`));
    }
  });
  return out;
}

/** The time `offset` phases after `from`. */
function atOffset(from: GameTime, offset: number): GameTime {
  const total = timeToPhases(from) + offset;
  return { day: Math.floor(total / 4), phase: (total % 4) as Phase };
}

// ---------------------------------------------------------------------------
// Seeding ground truth: the facts the generated events assert
// ---------------------------------------------------------------------------

/**
 * Seed the Truth Store with the ground-truth facts the generated events assert,
 * so every Claim the resolvers produce is in fact *true* at its observed time
 * (Req 23.3). A `meeting` asserts a symmetric `MEETS_AT` between each pair of
 * participants and a `LOCATED_AT` of each; an `npc-moved` asserts a `LOCATED_AT`
 * of the mover. The facts use the real NPC ids (ground truth), and `holds`
 * resolves the observed `unk:` ids back to these before it evaluates.
 */
function seedTruth(store: TruthStore, events: readonly SimEvent[]): void {
  for (const event of events) {
    if (event.kind === 'meeting') {
      const window = { from: event.at };
      for (const p of event.participants) {
        store.addFact({
          id: `truth:located:${p}@${event.loc}:${event.at.day}.${event.at.phase}`,
          subject: p,
          predicate: 'LOCATED_AT',
          object: p,
          place: event.loc,
          window,
        });
      }
      const ps = event.participants;
      for (let i = 0; i < ps.length; i += 1) {
        for (let j = i + 1; j < ps.length; j += 1) {
          store.addFact({
            id: `truth:meets:${ps[i]}+${ps[j]}@${event.loc}:${event.at.day}.${event.at.phase}`,
            subject: ps[i],
            predicate: 'MEETS_AT',
            object: ps[j],
            place: event.loc,
            window,
          });
        }
      }
    } else if (event.kind === 'npc-moved') {
      store.addFact({
        id: `truth:located:${event.npc}@${event.to}:${event.at.day}.${event.at.phase}`,
        subject: event.npc,
        predicate: 'LOCATED_AT',
        object: event.npc,
        place: event.to,
        window: { from: event.at },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Fidelity assertions, shared by the three observing paths
// ---------------------------------------------------------------------------

/** The proposition Observations of a result (drops the `message` ones). */
function propositions(observations: readonly Observation[]): Proposition[] {
  return observations
    .filter((o): o is Extract<Observation, { kind: 'proposition' }> => o.kind === 'proposition')
    .map((o) => o.prop);
}

/**
 * Assert the surveillance-fidelity invariants for a resolver run: the observed
 * Observations, the next state (for `unk:` resolution) and the Truth Store that
 * was seeded with the generated events' ground truth.
 */
function assertFidelity(
  next: WorldState,
  store: TruthStore,
  observations: readonly Observation[],
  events: readonly SimEvent[],
  windowed: readonly SimEvent[],
  extraSightings: ReadonlySet<string> = new Set(),
): void {
  const props = propositions(observations);

  // The real NPCs a MEETS_AT may legitimately connect: the unordered pairs that
  // actually met in the window (Req 23.1 — a meeting Claim matches a real
  // meeting event).
  const metPairs = new Set<string>();
  // The (NPC, Location, time) sightings an event legitimately supports.
  const sightings = new Set<string>();
  for (const event of windowed) {
    if (event.kind === 'meeting') {
      for (const p of event.participants) {
        sightings.add(`${p}@${event.loc}:${event.at.day}.${event.at.phase}`);
      }
      const ps = event.participants;
      for (let i = 0; i < ps.length; i += 1) {
        for (let j = i + 1; j < ps.length; j += 1) {
          metPairs.add(pairKey(ps[i], ps[j]));
        }
      }
    } else if (event.kind === 'npc-moved') {
      sightings.add(`${event.npc}@${event.to}:${event.at.day}.${event.at.phase}`);
    }
  }
  // Co-presence sightings legitimately supported by the schedule (a surveil /
  // follow sights the NPCs scheduled at the watched Location, at the watch's
  // start time) — these are real "the NPC is here now" facts, not events.
  for (const key of extraSightings) {
    sightings.add(key);
  }

  for (const prop of props) {
    // (unk ids) Every subject/object is an `npc:` or an `unk:` id (Req 23.4).
    expectIdShape(prop.subject);
    expectIdShape(prop.object as string);

    // Every surveillance Proposition carries a window (the event's time); assert
    // it so the observed time is well-defined.
    expect(prop.window).toBeDefined();
    const observedAt = (prop.window as { from: GameTime }).from;

    // (truth) The Claim holds in the Truth Store at its observed time, after
    // `holds` resolves its `unk:` ids (Req 23.3). The observed time is the
    // Proposition's window start (the event's own time).
    expect(store.holds(prop, observedAt)).toBe(true);

    // (fidelity) Resolve the Claim's ids to real NPCs and check it traces to a
    // real event at the watched Location in the window.
    const subject = resolveId(next, store, prop.subject);
    const object = resolveId(next, store, prop.object as string);
    const key = `${prop.place}:${observedAt.day}.${observedAt.phase}`;
    if (prop.predicate === 'MEETS_AT') {
      // A MEETS_AT only ever from a real meeting event's participants.
      expect(prop.place).toBe(WATCHED);
      expect(metPairs.has(pairKey(subject, object))).toBe(true);
    } else if (prop.predicate === 'LOCATED_AT') {
      expect(prop.place).toBe(WATCHED);
      expect(sightings.has(`${subject}@${key}`)).toBe(true);
    } else {
      throw new Error(`unexpected surveillance predicate ${prop.predicate}`);
    }
  }

  // (unk ids) Two sightings share an `unk:` id iff they are the same NPC: the
  // id → NPC map is injective (no two NPCs share a `unk:` id) and well-defined
  // (one NPC never gets two `unk:` ids), so the player's own allocation table is
  // a bijection on the observed strangers.
  assertUnkBijection(next, store, events);
}

/** The order-independent key for an unordered NPC pair. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** A subject/object id must be a real `npc:` id or an `unk:` id (Req 23.4). */
function expectIdShape(id: string): void {
  expect(id.startsWith('npc:') || /^unk:\d+$/.test(id)).toBe(true);
}

/** Resolve a view id to its real NPC: an `unk:` id through the Truth Store. */
function resolveId(state: WorldState, store: TruthStore, id: string): string {
  if (!id.startsWith('unk:')) {
    return id;
  }
  const npc = store.identityOf(id as UnkId);
  return npc === undefined ? id : (npc as unknown as string);
}

/**
 * Assert the `unk:` allocation is a bijection: every `unk:` id surfaced resolves
 * to exactly one NPC, and no two NPCs share a `unk:` id — so two sightings carry
 * the same `unk:` id iff they are the same NPC (Req 23.4). We read the player's
 * own allocation table (NPC → `unk:`), which the resolvers fill as they observe
 * strangers.
 */
function assertUnkBijection(state: WorldState, store: TruthStore, events: readonly SimEvent[]): void {
  const npcToUnk = state.player.unkIds;
  const seenUnk = new Map<string, NpcId>();
  for (const [npc, unk] of Object.entries(npcToUnk)) {
    // No two NPCs share a `unk:` id.
    expect(seenUnk.has(unk)).toBe(false);
    seenUnk.set(unk, npc as NpcId);
    // The Truth Store resolves the `unk:` id back to that same NPC.
    expect(store.identityOf(unk as UnkId) as unknown as string).toBe(npc);
  }
  void events;
}

// ---------------------------------------------------------------------------
// Property 17
// ---------------------------------------------------------------------------

describe('Property 17: surveillance fidelity (Req 23.1, 23.2, 23.3, 23.4, 25.5)', () => {
  const BASE = withEmptyWatchedLocation(world());
  const PALETTE = npcPalette(BASE);
  const ELSEWHERE = (Object.keys(BASE.city.locations) as LocId[]).find((l) => l !== WATCHED)!;

  it('watches an empty, public, open Location (no co-presence to confound the test)', () => {
    expect(npcsScheduledAt(BASE, WATCHED)).toEqual([]);
    expect(BASE.city.locations[WATCHED].public).toBe(true);
    expect(visibleNpcsAt(BASE, WATCHED)).toEqual([]);
  });

  const eventsArb = fc.array(genEventArb(PALETTE.length), { minLength: 0, maxLength: 6 });

  it('surveil: every Observation traces to a real event, holds at its time, uses unk ids', () => {
    fc.assert(
      fc.property(eventsArb, phasesArb, (gen, phases) => {
        const events = materialise(gen, PALETTE, BASE.time, phases, ELSEWHERE);
        const store = truth();
        seedTruth(store, events);
        const a: SurveilAction = { kind: 'surveil', at: WATCHED, phases };
        const { next, result } = resolveSurveil(
          BASE,
          a,
          fixedPrng(0),
          store,
          noRender,
          events,
        );
        const windowed = eventsInWindow(BASE, events, WATCHED, BASE.time, phases);
        assertFidelity(next, store, result.observations, events, windowed);
        // Non-vacuity: with an always-observe coin, every windowed event is
        // observed, so at least one Observation per windowed event.
        if (windowed.length > 0) {
          expect(result.observations.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('follow: every Observation traces to a real event, holds at its time, uses unk ids', () => {
    // Follow steps the target's one scheduled Location this phase. Put a target
    // on the watched Location and the player with it, so the follow observes the
    // watched Location's events over the current phase (a 1-phase window).
    fc.assert(
      fc.property(eventsArb, (gen) => {
        const target = PALETTE[0];
        const base: WorldState = {
          ...BASE,
          player: { ...BASE.player, loc: WATCHED },
          npcs: {
            ...BASE.npcs,
            [target]: {
              ...BASE.npcs[target],
              schedule: scheduleAt(
                BASE.npcs[target].schedule,
                weekdayOf(BASE),
                BASE.time,
                WATCHED,
              ),
            },
          },
        };
        const events = materialise(gen, PALETTE, base.time, 1, ELSEWHERE);
        const store = truth();
        seedTruth(store, events);
        // The follow emits a co-presence LOCATED_AT sighting of each NPC
        // scheduled at the watched Location this phase (the target among them);
        // seed its ground truth so that sighting Claim is true at its observed
        // time (Req 23.3), and record the sightings as legitimate for the
        // fidelity trace-back.
        const copresent = npcsScheduledAt(base, WATCHED);
        const extra = new Set<string>();
        for (const id of copresent) {
          store.addFact({
            id: `truth:located:${id}@${WATCHED}:${base.time.day}.${base.time.phase}`,
            subject: id,
            predicate: 'LOCATED_AT',
            object: id,
            place: WATCHED,
            window: { from: base.time },
          });
          extra.add(`${id}@${WATCHED}:${base.time.day}.${base.time.phase}`);
        }
        const a: FollowAction = { kind: 'follow', target };
        const { next, result } = resolveFollow(base, a, fixedPrng(0), store, noRender, events);
        const windowed = eventsInWindow(base, events, WATCHED, base.time, 1);
        assertFidelity(next, store, result.observations, events, windowed, extra);
      }),
    );
  });

  it('wait: every passive Observation traces to a real event, holds at its time, uses unk ids', () => {
    fc.assert(
      fc.property(eventsArb, phasesArb, (gen, phases) => {
        const base: WorldState = { ...BASE, player: { ...BASE.player, loc: WATCHED } };
        const events = materialise(gen, PALETTE, base.time, phases, ELSEWHERE);
        const store = truth();
        seedTruth(store, events);
        const a: WaitAction = { kind: 'wait', phases };
        const { next, observations } = waitObservations(base, a, store, events);
        // Wait observes only a *reduced* subset of the window's events, so the
        // reference set is the window — every Observation must still trace to one
        // of its events (a subset relation), and all the per-event invariants hold.
        const windowed = eventsInWindow(base, events, WATCHED, base.time, phases);
        assertFidelity(next, store, observations, events, windowed);
      }),
    );
  });

  it('no meeting event ⇒ no MEETS_AT, however many NPCs are co-present (Req 23.1)', () => {
    const movesArb = fc.array(
      fc.record({
        who: fc.integer({ min: 0, max: PALETTE.length - 1 }),
        phaseOffset: fc.integer({ min: 0, max: 1 }),
      }),
      { minLength: 1, maxLength: 6 },
    );
    fc.assert(
      fc.property(movesArb, phasesArb, (moves, phases) => {
        const events = moves.map((m, i) =>
          moveEvent(WATCHED, atOffset(BASE.time, m.phaseOffset < phases ? m.phaseOffset : 0), PALETTE[m.who], ELSEWHERE, `ev:move:${i}`),
        );
        const store = truth();
        seedTruth(store, events);
        const a: SurveilAction = { kind: 'surveil', at: WATCHED, phases };
        const { result } = resolveSurveil(BASE, a, fixedPrng(0), store, noRender, events);
        const meets = propositions(result.observations).filter((p) => p.predicate === 'MEETS_AT');
        expect(meets.length).toBe(0);
      }),
    );
  });
});

/**
 * Set the `(weekday, phase)` entry at `at` to `loc`, replacing any existing one,
 * so the follow target has exactly one scheduled Location this phase for the
 * follow to step to. Entries at other `(weekday, phase)` slots are left as-is.
 */
function scheduleAt(schedule: NpcSchedule, weekday: number, at: GameTime, loc: LocId): NpcSchedule {
  const kept = schedule.entries.filter(
    (e) => !(e.weekday === weekday && e.phase === at.phase),
  );
  return { ...schedule, entries: [...kept, { weekday, phase: at.phase, loc }] };
}
