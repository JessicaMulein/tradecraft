/**
 * Tests for the cable action (slice-integration task 2.2; Requirements 9.1, 9.2,
 * 9.3).
 *
 * These drive a generated {@link WorldState} from the real core pack through
 * {@link quoteCable} and {@link resolveCable}, checking:
 *
 * - at the Station, a trace on a known entity, a funds request and a report are
 *   allowed for one phase and no money (Req 9.1);
 * - a trace on an entity outside `player.known.entities` is disallowed with a
 *   reason (Req 9.2);
 * - away from the Station, or at a closed Station, every request is disallowed;
 * - resolving appends exactly `submitCable(body, time, { delayPhases })` to
 *   `station.pendingCables`, with the preset's `traceRequestDelayPhases`, and
 *   changes nothing else (Req 9.3);
 * - the appended Cable is the one `processDueCables` answers once, when its
 *   reply falls due;
 * - the same allowed and refused Cables through the top-level `quote`/`resolve`
 *   dispatch (task 2.6), with a refusal leaving the state as it was.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
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
import { addPhases } from '../clock/clock.js';
import {
  asTruth,
  timeToPhases,
  type EntityId,
  type LocId,
  type NpcId,
  type UnkId,
} from '../model/core.js';
import type { TruthAccess } from '../truth/truth.js';
import type { WorldState } from '../model/state.js';
import {
  DEFAULT_CABLE_DELAY_PHASES,
  DEFAULT_FUNDS_BASE,
  DEFAULT_FUNDS_CAP,
  processDueCables,
  submitCable,
} from '../station/cables.js';
import {
  CABLE_FUNDS_AMOUNT_REASON,
  CABLE_IDENTIFY_EVIDENCE_REASON,
  CABLE_NOT_AT_STATION_REASON,
  CABLE_PHASE_COST,
  CABLE_SENT_LINES,
  CABLE_UNKNOWN_TARGET_REASON,
  IDENTIFY_REPORT_ACK,
  cableReplyDelayPhases,
  quoteCable,
  resolveCable,
} from './cable.js';
import { quote, resolve } from './action.js';
import { STATION_LOCATION_TYPE } from './intercept.js';
import type { Observation, ResolverContext } from './result.js';
import type { CableAction, CableRequest } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors pay.spec.ts)
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

/** One generated world, shared: every test derives its own state from it. */
const BASE: WorldState = generate('cable-alpha', inputs());

/** The render callback used in tests: observations to their lines/ids. */
function renderLines(_s: WorldState, obs: readonly Observation[]): string[] {
  return obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`));
}

/** The first Location stamped from a Location Type (bare or namespaced id). */
function locOfType(state: WorldState, type: string): LocId {
  const loc = Object.values(state.city.locations)
    .filter((l) => l.type === type || l.type.endsWith(`/${type}`))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  if (loc === undefined) {
    throw new Error(`the generated city has no ${type} Location`);
  }
  return loc.id;
}

/** Put the player at a Location. */
function at(state: WorldState, loc: LocId): WorldState {
  return { ...state, player: { ...state.player, loc } };
}

/** Put the player at the Station (the city's `station-hq` Location). */
function atStation(state: WorldState): WorldState {
  return at(state, locOfType(state, STATION_LOCATION_TYPE));
}

/** `open` (the player at the Station) with the Station closed in the current phase. */
function withStationClosed(open: WorldState): WorldState {
  const station = open.city.locations[open.player.loc];
  return {
    ...open,
    city: {
      ...open.city,
      locations: {
        ...open.city.locations,
        [station.id]: {
          ...station,
          hours: { ...station.hours, [open.time.phase]: false },
        },
      },
    },
  };
}

/** An NPC the player does not know (outside `player.known.entities`). */
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

/** One request of each kind the player can send from the Station. */
function sampleRequests(state: WorldState): CableRequest[] {
  return [
    { kind: 'trace', target: state.station.chief },
    { kind: 'funds' },
    { kind: 'funds', amount: 250 },
    { kind: 'report', body: 'Contact made. Awaiting instructions.' },
  ];
}

// ---------------------------------------------------------------------------
// Quote (Req 9.1, 9.2)
// ---------------------------------------------------------------------------

describe('cable — quote at the Station (Req 9.1, 9.2)', () => {
  const state = atStation(BASE);

  it('allows a trace on every entity in the known set, for one phase and no money', () => {
    expect(state.player.known.entities.length).toBeGreaterThan(0);
    for (const target of state.player.known.entities) {
      const q = quoteCable(state, cable({ kind: 'trace', target }));
      expect(q).toEqual({ allowed: true, phases: CABLE_PHASE_COST, money: 0 });
    }
    expect(CABLE_PHASE_COST).toBe(1);
  });

  it('disallows a trace on an entity outside the known set, with a reason', () => {
    const stranger = unknownNpc(state);
    // An Unidentified Subject the player has seen is still outside the set.
    const seen: WorldState = {
      ...state,
      player: {
        ...state.player,
        unkIds: { ...state.player.unkIds, [stranger]: 'unk:1' },
      },
    };
    const targets: Array<[WorldState, EntityId]> = [
      [state, stranger],
      [seen, 'unk:1'],
      [state, 'npc:no-such-person'],
    ];
    for (const [s, target] of targets) {
      const q = quoteCable(s, cable({ kind: 'trace', target }));
      expect(q.allowed).toBe(false);
      expect(q.reason).toBe(CABLE_UNKNOWN_TARGET_REASON);
      expect(q.phases).toBe(0);
      expect(q.money).toBe(0);
    }
  });

  it('allows funds requests, with or without an amount, and reports', () => {
    const requests: CableRequest[] = [
      { kind: 'funds' },
      { kind: 'funds', amount: 250 },
      { kind: 'funds', amount: 12.5 },
      { kind: 'report', body: 'Contact made. Awaiting instructions.' },
      { kind: 'report', body: '' },
    ];
    for (const body of requests) {
      expect(quoteCable(state, cable(body))).toEqual({
        allowed: true,
        phases: CABLE_PHASE_COST,
        money: 0,
      });
    }
  });

  it('disallows a funds request naming a non-positive or non-finite amount', () => {
    for (const amount of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const q = quoteCable(state, cable({ kind: 'funds', amount }));
      expect(q.allowed).toBe(false);
      expect(q.reason).toBe(CABLE_FUNDS_AMOUNT_REASON);
    }
  });
});

describe('cable — quote away from the Station', () => {
  it('disallows every request elsewhere, including an embassy', () => {
    const publicLoc = Object.values(BASE.city.locations)
      .filter((l) => l.public)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    expect(publicLoc).toBeDefined();
    const elsewhere = [
      at(BASE, publicLoc.id),
      at(BASE, locOfType(BASE, 'embassy')),
    ];
    for (const state of elsewhere) {
      for (const body of sampleRequests(state)) {
        const q = quoteCable(state, cable(body));
        expect(q.allowed).toBe(false);
        expect(q.reason).toBe(CABLE_NOT_AT_STATION_REASON);
        expect(q.phases).toBe(0);
        expect(q.money).toBe(0);
      }
    }
  });

  it('disallows every request while the Station is closed', () => {
    const open = atStation(BASE);
    const station = open.city.locations[open.player.loc];
    const closed = withStationClosed(open);
    for (const body of sampleRequests(closed)) {
      const q = quoteCable(closed, cable(body));
      expect(q.allowed).toBe(false);
      expect(q.reason).toBe(`${station.name} is closed in this phase`);
    }
  });
});

// ---------------------------------------------------------------------------
// Resolve (Req 9.3)
// ---------------------------------------------------------------------------

describe('cable — resolve (Req 9.3)', () => {
  const state = atStation(BASE);

  it('appends submitCable(body, time, { delayPhases: traceRequestDelayPhases }) and nothing else', () => {
    for (const body of sampleRequests(state)) {
      const { next } = resolveCable(state, cable(body), renderLines);

      const expected = submitCable(body, state.time, {
        delayPhases: STANDARD.traceRequestDelayPhases,
      });
      expect(next.station.pendingCables).toEqual([
        ...state.station.pendingCables,
        expected,
      ]);

      const pending = next.station.pendingCables.at(-1);
      expect(pending?.request).toEqual(body);
      expect(pending?.sentAt).toEqual(state.time);
      expect(
        timeToPhases(pending?.replyDue ?? state.time) -
          timeToPhases(state.time),
      ).toBe(STANDARD.traceRequestDelayPhases);

      // Only the pending list moved: no money, no Standing, no clock, no other field.
      expect({
        ...next,
        station: {
          ...next.station,
          pendingCables: state.station.pendingCables,
        },
      }).toEqual(state);
      // The input state is not mutated.
      expect(state.station.pendingCables).toEqual(BASE.station.pendingCables);
    }
  });

  it('plays a confirmation Fact Line and adds no Claims or events', () => {
    for (const body of sampleRequests(state)) {
      const { result } = resolveCable(state, cable(body), renderLines);
      expect(result.observations).toEqual([
        { kind: 'message', line: CABLE_SENT_LINES[body.kind] },
      ]);
      expect(result.factLines).toEqual([CABLE_SENT_LINES[body.kind]]);
      expect(result.claimsAdded).toEqual([]);
      expect(result.events).toEqual([]);
      expect(result.openScene).toBeUndefined();
      expect(result.scene.loc).toBe(state.player.loc);
    }
  });

  it('appends after Cables already pending, in send order', () => {
    const first = resolveCable(
      state,
      cable({ kind: 'funds' }),
      renderLines,
    ).next;
    const later: WorldState = { ...first, time: addPhases(first.time, 1) };
    const second = resolveCable(
      later,
      cable({ kind: 'trace', target: state.station.chief }),
      renderLines,
    ).next;

    expect(second.station.pendingCables.map((p) => p.request.kind)).toEqual([
      'funds',
      'trace',
    ]);
    expect(second.station.pendingCables.map((p) => p.sentAt)).toEqual([
      state.time,
      later.time,
    ]);
  });

  it('uses the Difficulty Preset delay', () => {
    for (const id of ['easy', 'standard', 'hard']) {
      const p = preset(id);
      const s: WorldState = { ...state, meta: { ...state.meta, preset: p } };
      const pending = resolveCable(
        s,
        cable({ kind: 'report', body: 'quiet' }),
        renderLines,
      ).next.station.pendingCables.at(-1);
      expect(pending?.replyDue).toEqual(
        addPhases(s.time, p.traceRequestDelayPhases),
      );
    }
    // A malformed delay falls back to the documented default.
    const broken: WorldState = {
      ...state,
      meta: {
        ...state.meta,
        preset: { ...STANDARD, traceRequestDelayPhases: -1 },
      },
    };
    expect(cableReplyDelayPhases(broken)).toBe(DEFAULT_CABLE_DELAY_PHASES);
  });

  it('leaves the state unchanged for a disallowed Cable', () => {
    const disallowed: Array<[WorldState, CableRequest]> = [
      [state, { kind: 'trace', target: unknownNpc(state) }],
      [state, { kind: 'funds', amount: -1 }],
      [
        at(BASE, locOfType(BASE, 'embassy')),
        { kind: 'report', body: 'from the legation' },
      ],
    ];
    for (const [s, body] of disallowed) {
      const { next, result } = resolveCable(s, cable(body), renderLines);
      expect(next).toBe(s);
      expect(result.observations).toEqual([]);
      expect(result.factLines).toEqual([]);
      expect(result.claimsAdded).toEqual([]);
    }
  });

  it('is deterministic: the same inputs give the same result', () => {
    const a = cable({ kind: 'trace', target: state.station.chief });
    expect(resolveCable(state, a, renderLines)).toEqual(
      resolveCable(state, a, renderLines),
    );
  });
});

// ---------------------------------------------------------------------------
// The appended Cable is the one the reply step answers (Req 9.3 → Req 1.5)
// ---------------------------------------------------------------------------

describe('cable — the pending Cable falls due after the delay', () => {
  it('gets exactly one reply, at sentAt + traceRequestDelayPhases and not before', () => {
    const state = atStation(BASE);
    const target = state.station.chief;
    const { next } = resolveCable(
      state,
      cable({ kind: 'trace', target }),
      renderLines,
    );
    const delay = STANDARD.traceRequestDelayPhases;
    const funds = { base: DEFAULT_FUNDS_BASE, cap: DEFAULT_FUNDS_CAP };
    // The standard preset delays replies, so there is a phase before the reply.
    expect(delay).toBeGreaterThan(0);

    const early = processDueCables(
      next.station,
      addPhases(state.time, delay - 1),
      funds,
    );
    expect(early.replies).toHaveLength(0);
    expect(early.pendingCables).toEqual(next.station.pendingCables);

    const due = processDueCables(
      next.station,
      addPhases(state.time, delay),
      funds,
    );
    expect(due.replies).toHaveLength(1);
    expect(due.replies[0].traceTarget).toBe(target);
    expect(due.events.map((e) => e.kind)).toEqual(['cable']);
    expect(due.pendingCables).toHaveLength(state.station.pendingCables.length);
  });
});

// ---------------------------------------------------------------------------
// Through the top-level quote/resolve dispatch (Req 9.1, 9.2, 9.3; task 2.6)
// ---------------------------------------------------------------------------

describe('cable through the top-level quote and resolve', () => {
  const CTX: ResolverContext = { content };
  const state = atStation(BASE);

  it('allows a trace on a known entity, funds and a report from the Station, for 1 phase and no money (Req 9.1)', () => {
    for (const body of sampleRequests(state)) {
      expect(quote(state, cable(body), CTX), body.kind).toEqual({
        allowed: true,
        phases: CABLE_PHASE_COST,
        money: 0,
      });
    }
  });

  it('refuses each disallowed Cable with its reason, and resolve leaves the state as it was (Req 9.2)', () => {
    const stranger = unknownNpc(state);
    // An Unidentified Subject the player has seen is still outside the known set.
    const seen: WorldState = {
      ...state,
      player: {
        ...state.player,
        unkIds: { ...state.player.unkIds, [stranger]: 'unk:1' },
      },
    };
    const closed = withStationClosed(state);
    const closedReason = `${closed.city.locations[closed.player.loc].name} is closed in this phase`;
    const refused: readonly (readonly [WorldState, CableRequest, string])[] = [
      [state, { kind: 'trace', target: stranger }, CABLE_UNKNOWN_TARGET_REASON],
      [seen, { kind: 'trace', target: 'unk:1' }, CABLE_UNKNOWN_TARGET_REASON],
      [state, { kind: 'funds', amount: 0 }, CABLE_FUNDS_AMOUNT_REASON],
      [state, { kind: 'funds', amount: Number.NaN }, CABLE_FUNDS_AMOUNT_REASON],
      [
        at(BASE, locOfType(BASE, 'embassy')),
        { kind: 'report', body: 'from the legation' },
        CABLE_NOT_AT_STATION_REASON,
      ],
      [closed, { kind: 'report', body: 'after hours' }, closedReason],
    ];
    for (const [s, body, reason] of refused) {
      const a = cable(body);
      expect(quote(s, a, CTX)).toEqual({ allowed: false, reason, phases: 0, money: 0 });
      const out = resolve(s, a, createPrng('cable-refused'), CTX);
      expect(out.next).toBe(s);
      expect(out.result.observations).toEqual([]);
      expect(out.result.factLines).toEqual([]);
      expect(out.ended).toBeUndefined();
    }
  });

  it('routes an allowed Cable to the cable resolver, queuing the submitted Cable (Req 9.3)', () => {
    for (const body of sampleRequests(state)) {
      const out = resolve(state, cable(body), createPrng('cable-sent'), CTX);
      expect(out.next.station.pendingCables).toEqual([
        ...state.station.pendingCables,
        submitCable(body, state.time, {
          delayPhases: STANDARD.traceRequestDelayPhases,
        }),
      ]);
      expect(out.result.factLines).toEqual([CABLE_SENT_LINES[body.kind]]);
      expect(out.result.claimsAdded).toEqual([]);
      // No money moves, and the clock is left to the Turn Pipeline.
      expect(out.next.station.ledger).toBe(state.station.ledger);
      expect(out.next.time).toEqual(state.time);
      expect(out.ended).toBeUndefined();
    }
  });
});

describe('cable — identification reports', () => {
  const state = atStation(BASE);
  const role = state.plot.roles.find((item) => item.npc !== undefined);
  if (role?.npc === undefined) {
    throw new Error('the generated plot has no bound role');
  }
  const holder = role.npc;
  const stranger = Object.keys(state.npcs)
    .sort()
    .find((id) => id !== holder) as NpcId;
  const threshold = STANDARD.arrest.threshold;
  const identify = (entity: EntityId): CableRequest => ({
    kind: 'report',
    body: 'I believe this person holds the role.',
    identify: { entity, roleTag: role.slot },
  });

  it('keeps the quote and the acknowledgement independent of who the truth store names', () => {
    // Feature: plot-library, Property 11: Identification is truth-blind
    fc.assert(
      fc.property(fc.integer({ min: 0, max: threshold + 4 }), fc.boolean(), (evidence, flip) => {
        const shared = { [holder]: evidence, [stranger]: evidence };
        const truth = {
          identityOf: (id: UnkId) => (id === 'unk:4' ? asTruth(flip ? stranger : holder) : undefined),
        } as unknown as TruthAccess;
        const plain: ResolverContext = { content, arrestEvidence: shared };
        const mutated: ResolverContext = { content, arrestEvidence: shared, truth };
        expect(quoteCable(state, cable(identify(holder)), mutated)).toEqual(
          quoteCable(state, cable(identify(holder)), plain),
        );
        expect(quoteCable(state, cable(identify(stranger)), mutated)).toEqual(
          quoteCable(state, cable(identify(holder)), plain),
        );
        expect(quoteCable(state, cable(identify(holder)), plain).allowed).toBe(evidence >= threshold);
        if (evidence < threshold) {
          return;
        }
        const right = resolveCable(state, cable(identify(holder)), renderLines, mutated);
        const wrong = resolveCable(state, cable(identify(stranger)), renderLines, mutated);
        expect(right.result.factLines).toEqual([IDENTIFY_REPORT_ACK]);
        expect(wrong.result.factLines).toEqual(right.result.factLines);
      }),
      { numRuns: 100 },
    );
  });

  it('allows the report only from the evidence count, for the holder and a stranger alike', () => {
    const below: ResolverContext = {
      content,
      arrestEvidence: { [holder]: threshold - 1, [stranger]: threshold - 1 },
    };
    const met: ResolverContext = {
      content,
      arrestEvidence: { [holder]: threshold, [stranger]: threshold },
    };
    expect(quoteCable(state, cable(identify(holder)), below)).toEqual({
      allowed: false,
      reason: CABLE_IDENTIFY_EVIDENCE_REASON,
      phases: 0,
      money: 0,
    });
    expect(quoteCable(state, cable(identify(stranger)), below)).toEqual(
      quoteCable(state, cable(identify(holder)), below),
    );
    expect(quoteCable(state, cable(identify(holder)), met)).toEqual({
      allowed: true,
      phases: CABLE_PHASE_COST,
      money: 0,
    });
    expect(quoteCable(state, cable(identify(stranger)), met)).toEqual(
      quoteCable(state, cable(identify(holder)), met),
    );
  });

  it('acknowledges a correct and a wrong report with the same line', () => {
    const ctx: ResolverContext = {
      content,
      arrestEvidence: { [holder]: threshold, [stranger]: threshold },
    };
    const right = resolveCable(state, cable(identify(holder)), renderLines, ctx);
    const wrong = resolveCable(state, cable(identify(stranger)), renderLines, ctx);
    expect(right.result.factLines).toEqual([IDENTIFY_REPORT_ACK]);
    expect(wrong.result.factLines).toEqual(right.result.factLines);
    expect(right.next.player.identifications).toEqual([
      { entity: holder, roleTag: role.slot, correct: true },
    ]);
    expect(wrong.next.player.identifications).toEqual([
      { entity: stranger, roleTag: role.slot, correct: false },
    ]);
    expect(right.next.player.arrestAuthority).toBe(state.player.arrestAuthority);
    expect(wrong.next.player.arrestAuthority).toBe(
      state.player.arrestAuthority + STANDARD.arrest.wrongfulAuthorityPenalty,
    );
    expect(right.next.station.pendingCables.at(-1)?.reply).toEqual(
      wrong.next.station.pendingCables.at(-1)?.reply,
    );
  });

  it('resolves an unidentified subject to the role holder before judging the report', () => {
    const unk: UnkId = 'unk:4';
    const ctx: ResolverContext = {
      content,
      arrestEvidence: { [unk]: threshold },
      truth: {
        identityOf: (id: UnkId) => (id === unk ? asTruth(holder) : undefined),
      } as unknown as TruthAccess,
    };
    const out = resolveCable(state, cable(identify(unk)), renderLines, ctx);
    expect(out.result.factLines).toEqual([IDENTIFY_REPORT_ACK]);
    expect(out.next.player.identifications).toEqual([
      { entity: unk, roleTag: role.slot, correct: true },
    ]);
    expect(out.next.player.arrestAuthority).toBe(state.player.arrestAuthority);
  });
});
