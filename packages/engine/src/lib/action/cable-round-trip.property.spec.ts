/**
 * Feature: slice-integration, Property 46: Cable round trip.
 *
 * **Validates: Requirements 1.5, 9.3, 9.4**
 *
 * The design states (slice-integration design, "Property 46: Cable round
 * trip"): for any reachable state at the Station and any allowed trace, funds
 * or report Cable, the reply is delivered exactly once, at the first Phase Step
 * at or after `sentAt + traceRequestDelayPhases`, as one `cable` event with a
 * Cable Document in `documents`; before that phase no reply exists.
 *
 * ## How the property drives the round trip
 *
 * It drives the whole trip end to end through the integrated clock, so the
 * property validates the slice as assembled (Req 1.5, 9.4), not the engine
 * pieces in isolation:
 *
 * 1. The player is placed at the city's open `station-hq` Location, and an
 *    allowed Cable (`trace` on a target from `player.known.entities`, `funds`
 *    with or without an amount, or `report` with a varied body) is quoted and
 *    resolved with {@link resolveCable} / the top-level {@link resolve}. The
 *    quote must be allowed for one phase and no money (Req 9.1), and the resolve
 *    must append exactly one {@link PendingCable} whose `request` is the body,
 *    `sentAt` is now and `replyDue` is `addPhases(now, traceRequestDelayPhases)`
 *    — and change nothing else material (Req 9.3).
 * 2. The clock is then advanced with {@link advanceWorld} to one phase before
 *    `replyDue` and separately to `replyDue`, using an **empty hook set** so the
 *    only sub-system that runs is the Phase Step (`buildWorldHooks` would also
 *    fire the daily hooks, whose newspapers, Walk-ins and Hostile tick are not
 *    this property's subject). The Phase Step's Cable delivery
 *    (`clock/phase-step.ts`, sub-step 3) is the production reply path
 *    `advanceWorld` runs, so this is the integrated round trip.
 * 3. Before `replyDue` the pending Cable is still pending and no reply Document
 *    or `cable` event has appeared. At `replyDue` exactly one reply is
 *    delivered: one `cable` event and one new `cable` Document, and for a trace
 *    on an `npc:` target one new `dossier` Document as well. The pending list
 *    shrinks by exactly the delivered Cable.
 *
 * It also checks the trace-known-set gate as a negative (Req 9.2): a trace on
 * an entity outside `player.known.entities` is disallowed, so no round trip
 * ever starts.
 *
 * The core-pack load, `GenerateInputs`/`ScenarioConfig` construction and the
 * `AdvanceWorldDeps` shape mirror `clock/advance-world.spec.ts` and
 * `action/cable.spec.ts`; the fast-check shape (a seeded `fc.record`, a bounded
 * `numRuns`) mirrors the engine's other `*.property.spec.ts` files.
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

import { worldCipherKeyLookup } from '../cipher/world-intercepts.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generateGame, type GenerateInputs } from '../generate.js';
import { advanceWorld } from '../clock/advance-world.js';
import { addPhases } from '../clock/clock.js';
import type { AdvanceWorldDeps } from '../clock/world-types.js';
import {
  compareTime,
  timeToPhases,
  type DocId,
  type EntityId,
  type LocId,
  type NpcId,
} from '../model/core.js';
import type { Document } from '../docs/document.js';
import type { SimEvent, WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import type { TruthStore } from '../truth/truth.js';
import {
  CABLE_PHASE_COST,
  CABLE_UNKNOWN_TARGET_REASON,
  quoteCable,
  resolveCable,
} from './cable.js';
import { quote, resolve } from './action.js';
import { STATION_LOCATION_TYPE } from './intercept.js';
import type { Observation, ResolverContext } from './result.js';
import type { CableAction, CableRequest } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors advance-world.spec.ts / cable.spec.ts)
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
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
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
const SEED = 'cable-round-trip-alpha';
const GAME = generateGame(SEED, INPUTS);
const BASE: WorldState = GAME.world;
const TRUTH: TruthStore = GAME.truth;
const DELAY = INPUTS.preset.traceRequestDelayPhases;

/**
 * The dependencies for the clock: an **empty hook set** so the only sub-system
 * `advanceWorld` runs is the Phase Step, whose sub-step 3 is the Cable delivery
 * under test. Content, keys and Truth are the real ones.
 */
const DEPS: AdvanceWorldDeps = {
  content: INPUTS.content,
  cityData: INPUTS.cityData,
  hooks: {},
  objectives: () => () => false,
  cipherKeys: worldCipherKeyLookup(SEED, BASE.documents),
  truth: TRUTH,
};

const CTX: ResolverContext = { content: INPUTS.content };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The render callback the resolver uses: observations to their lines/ids. */
function renderLines(_s: WorldState, obs: readonly Observation[]): string[] {
  return obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`));
}

/** The city's `station-hq` Location (the lowest id if there are several). */
function stationLoc(state: WorldState): LocId {
  const station = Object.values(state.city.locations)
    .filter((l) => l.type === STATION_LOCATION_TYPE || l.type.endsWith(`/${STATION_LOCATION_TYPE}`))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (station === undefined) {
    throw new Error('the generated city has no station-hq Location');
  }
  return station.id;
}

/** An entity outside the player's known set (for the trace-gate negative). */
function unknownNpc(state: WorldState): NpcId {
  const known = new Set<string>(state.player.known.entities);
  const id = Object.keys(state.npcs)
    .sort()
    .find((npc) => !known.has(npc));
  if (id === undefined) {
    throw new Error('every NPC is known');
  }
  return id as NpcId;
}

function cable(body: CableRequest): CableAction {
  return { kind: 'cable', body };
}

/**
 * Put the player at the open Station in a chosen phase (phase 1, which the core
 * Station keeps open), so a Cable can be sent, and reset the time to it so the
 * reply delay is counted from a clean start.
 */
function atStation(state: WorldState): WorldState {
  const loc = stationLoc(state);
  const start = { day: 0, phase: 1 as const };
  const at: WorldState = { ...state, time: start, player: { ...state.player, loc } };
  // Confirm the Station is open in the chosen phase, as the quote requires.
  const station = at.city.locations[loc];
  if (station.hours[start.phase] !== true) {
    // Fall back to the first open phase, keeping day 0.
    const open = Object.entries(station.hours).find(([, v]) => v === true);
    if (open === undefined) {
      throw new Error('the Station is never open');
    }
    const phase = Number(open[0]) as WorldState['time']['phase'];
    return { ...at, time: { day: 0, phase } };
  }
  return at;
}

/** The `cable` events in a turn's event stream. */
function cableEvents(events: readonly SimEvent[]): SimEvent[] {
  return events.filter((e) => e.kind === 'cable');
}

/** The DocIds a `cable` event names. */
function cableEventDocs(events: readonly SimEvent[]): DocId[] {
  return cableEvents(events).map((e) => (e as { doc: DocId }).doc);
}

/** The Documents present in `after` but not in `before`, by id. */
function newDocuments(before: WorldState, after: WorldState): Document[] {
  return Object.values(after.documents).filter(
    (d) => before.documents[d.id] === undefined,
  );
}

/**
 * Advance `from` by the whole-phase count needed to reach `to`, through
 * `advanceWorld` with the empty hook set. `to` must be at or after `from`.
 */
function advanceTo(from: WorldState, to: WorldState['time'], seed: string) {
  const phases = timeToPhases(to) - timeToPhases(from.time);
  return advanceWorld(from, Math.max(0, phases), createPrng(seed), DEPS);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const RUNS = 120;

/** A target drawn from the player's known set, for an allowed trace. */
const knownTargets: readonly EntityId[] = BASE.player.known.entities;

/** The runtime stream seed. */
const seedArb = fc.string({ minLength: 1, maxLength: 12 });

/**
 * An allowed Cable request: a trace on a known target, a funds request (with
 * and without a positive amount), or a report with a varied body.
 */
const requestArb: fc.Arbitrary<CableRequest> = fc.oneof(
  fc
    .constantFrom<EntityId>(...knownTargets)
    .map((target): CableRequest => ({ kind: 'trace', target })),
  fc.constant<CableRequest>({ kind: 'funds' }),
  fc
    .integer({ min: 1, max: 5000 })
    .map((amount): CableRequest => ({ kind: 'funds', amount })),
  fc
    .string({ maxLength: 60 })
    .map((body): CableRequest => ({ kind: 'report', body })),
);

const caseArb = fc.record({ request: requestArb, seed: seedArb });

// ---------------------------------------------------------------------------
// Property 46 — Cable round trip
// ---------------------------------------------------------------------------

describe('Property 46: Cable round trip (Req 1.5, 9.3, 9.4)', () => {
  const START = atStation(BASE);

  // Sanity: the standard preset delays replies, so there is a phase strictly
  // before the reply at which no reply exists. (A zero delay would collapse the
  // "not before" clause and is not what the slice ships.)
  it('the preset delays Cable replies by at least one phase', () => {
    expect(DELAY).toBeGreaterThan(0);
    expect(Number.isInteger(DELAY)).toBe(true);
  });

  // Quote + resolve (Req 9.1, 9.3): an allowed Cable costs one phase and no
  // money, and appends exactly one PendingCable whose request/sentAt/replyDue
  // match, changing nothing else material.
  it('quotes one phase and no money, and appends exactly one matching PendingCable', () => {
    fc.assert(
      fc.property(caseArb, ({ request }) => {
        const action = cable(request);

        const q = quoteCable(START, action);
        expect(q).toEqual({ allowed: true, phases: CABLE_PHASE_COST, money: 0 });
        // The top-level dispatch agrees.
        expect(quote(START, action, CTX)).toEqual(q);

        const { next } = resolveCable(START, action, renderLines);
        expect(next.station.pendingCables.length).toBe(
          START.station.pendingCables.length + 1,
        );
        const pending = next.station.pendingCables.at(-1);
        expect(pending?.request).toEqual(request);
        expect(pending?.sentAt).toEqual(START.time);
        expect(pending?.replyDue).toEqual(addPhases(START.time, DELAY));

        // Only the pending list moved: no money, no clock, no other field.
        expect({
          ...next,
          station: { ...next.station, pendingCables: START.station.pendingCables },
        }).toEqual(START);
      }),
      { numRuns: RUNS },
    );
  });

  // The round trip (Req 1.5, 9.4): advancing to just before replyDue delivers
  // no reply; advancing to replyDue delivers exactly one.
  it('delivers exactly one reply at replyDue through advanceWorld, and none before', () => {
    fc.assert(
      fc.property(caseArb, ({ request, seed }) => {
        const action = cable(request);
        const sent = resolveCable(START, action, renderLines).next;
        const pending = sent.station.pendingCables.at(-1);
        if (pending === undefined) {
          throw new Error('the Cable was not queued');
        }
        const replyDue = pending.replyDue;

        // --- Just before replyDue: no reply yet (Req 9.4, "not before"). ---
        if (DELAY > 1) {
          const beforeTime = addPhases(START.time, DELAY - 1);
          const before = advanceTo(sent, beforeTime, seed);
          // The clock may stop early only on an end or a scene; neither should
          // happen on this short, hook-free advance from a fresh world.
          if (before.ended !== undefined || before.openScene !== undefined) {
            return; // precondition: ignore a world that ends or opens a scene
          }
          expect(compareTime(before.state.time, replyDue)).toBeLessThan(0);
          // The Cable is still pending, and no reply has been delivered.
          const still = before.state.station.pendingCables.some(
            (p) => p.id === pending.id,
          );
          expect(still).toBe(true);
          expect(cableEvents(before.events)).toEqual([]);
          expect(newDocuments(sent, before.state)).toEqual([]);
        }

        // --- At replyDue: exactly one reply (Req 1.5, 9.4). ---
        const due = advanceTo(sent, replyDue, seed);
        if (due.ended !== undefined || due.openScene !== undefined) {
          return; // precondition: ignore a world that ends or opens a scene
        }
        expect(due.state.time).toEqual(replyDue);

        // Exactly one `cable` event, naming exactly one Document.
        const events = cableEvents(due.events);
        expect(events.length).toBe(1);
        const namedDocs = cableEventDocs(due.events);
        expect(namedDocs.length).toBe(1);

        // Exactly one new Cable Document, with the id the event named.
        const fresh = newDocuments(sent, due.state);
        const cableDocs = fresh.filter((d) => d.kind === 'cable');
        expect(cableDocs.length).toBe(1);
        expect(namedDocs).toContain(cableDocs[0].id);
        expect(due.state.documents[cableDocs[0].id]).toBeDefined();

        // A trace on an `npc:` target also delivers one Dossier.
        const dossierDocs = fresh.filter((d) => d.kind === 'dossier');
        if (request.kind === 'trace' && request.target.startsWith('npc:')) {
          expect(dossierDocs.length).toBe(1);
        } else {
          expect(dossierDocs.length).toBe(0);
        }

        // The pending list shrank by exactly the delivered Cable.
        expect(
          due.state.station.pendingCables.some((p) => p.id === pending.id),
        ).toBe(false);
        expect(due.state.station.pendingCables.length).toBe(
          sent.station.pendingCables.length - 1,
        );
      }),
      { numRuns: RUNS },
    );
  });

  // Delivered exactly once (Req 9.4): advancing one phase past replyDue delivers
  // no further reply — the Cable is answered a single time.
  it('does not deliver the reply a second time after replyDue', () => {
    fc.assert(
      fc.property(caseArb, ({ request, seed }) => {
        const sent = resolveCable(START, cable(request), renderLines).next;
        const pending = sent.station.pendingCables.at(-1);
        if (pending === undefined) {
          throw new Error('the Cable was not queued');
        }
        const due = advanceTo(sent, pending.replyDue, seed);
        if (due.ended !== undefined || due.openScene !== undefined) {
          return;
        }
        // One more phase: the already-answered Cable produces no new reply.
        const after = advanceWorld(due.state, 1, createPrng(seed), DEPS);
        if (after.ended !== undefined || after.openScene !== undefined) {
          return;
        }
        expect(cableEvents(after.events)).toEqual([]);
        expect(
          newDocuments(due.state, after.state).filter((d) => d.kind === 'cable'),
        ).toEqual([]);
      }),
      { numRuns: RUNS },
    );
  });

  // The trace gate (Req 9.2): a trace on an entity outside the known set is
  // disallowed, so no round trip ever starts.
  it('refuses a trace outside the known set, starting no round trip', () => {
    const stranger = unknownNpc(START);
    const action = cable({ kind: 'trace', target: stranger });

    const q = quoteCable(START, action);
    expect(q.allowed).toBe(false);
    expect(q.reason).toBe(CABLE_UNKNOWN_TARGET_REASON);
    expect(quote(START, action, CTX)).toEqual(q);

    // Resolving the refused Cable queues nothing, and resolve leaves the state.
    const { next } = resolveCable(START, action, renderLines);
    expect(next).toBe(START);
    const out = resolve(START, action, createPrng('cable-refused'), CTX);
    expect(out.next).toBe(START);
    expect(out.next.station.pendingCables).toEqual(START.station.pendingCables);
  });
});
