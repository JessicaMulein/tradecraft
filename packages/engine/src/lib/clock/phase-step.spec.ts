/**
 * Smoke tests for the Phase Step (slice-integration task 4.4; Requirements
 * 1.2–1.9, 6.4). They run {@link phaseStep} on a world generated from the real
 * core pack and check each sub-step once, plus the event order, purity and
 * determinism. Task 4.5 adds one example per effect.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';

import {
  MISSED_MEETING_TRUST_DROP,
  NEUTRAL_TRUST,
} from '../action/arrange-meeting.js';
import { visibleNpcsAt } from '../action/action.js';
import { STATION_LOCATION_TYPE } from '../action/intercept.js';
import type { Meeting } from '../action/types.js';
import type { DeadDrop } from '../city/comms.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import {
  asTruth,
  timeToPhases,
  type GameTime,
  type LocId,
  type NpcId,
} from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import { MEETINGS_BEFORE_PITCH, newRelationship, type Relationship } from '../recruit/asset.js';
import { RETAINER_DECAY_PER_PHASE, RETAINER_GRACE_PHASES } from '../recruit/retainer.js';
import { CUSTODY_RELEASE_SUSPICION_PER_PHASE } from '../recruit/turn.js';
import {
  DEFAULT_FUNDS_BASE,
  DEFAULT_FUNDS_CAP,
  fundsGrantAmount,
  REPORT_STANDING_DELTA,
  submitCable,
} from '../station/cables.js';
import { balance } from '../station/ledger.js';
import type { Directive } from '../station/directive-types.js';
import { addPhases } from './clock.js';
import { phaseStep, pinnedWhereabouts, type PhaseStepDeps } from './phase-step.js';
import { scheduledLocationAt } from './schedules.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors cable.spec.ts)
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

/** One generated world at day 0, morning; every test derives its own state. */
const BASE: WorldState = generate('phase-step-alpha', INPUTS);

/** Deps with an evaluator that meets nothing (no Directive is open in BASE). */
const DEPS: PhaseStepDeps = {
  content: INPUTS.content,
  objectives: () => () => false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run one Phase Step from the state's own time into the next phase. */
function step(state: WorldState, deps: PhaseStepDeps = DEPS) {
  return phaseStep(state, state.time, addPhases(state.time, 1), createPrng('phase-step'), deps);
}

/** The state moved to `time` (nothing else changes). */
function atTime(state: WorldState, time: GameTime): WorldState {
  return { ...state, time };
}

/** The state with `rel` written for its NPC. */
function withRel(state: WorldState, rel: Relationship): WorldState {
  return { ...state, relationships: { ...state.relationships, [rel.npc]: rel } };
}

/** A running Asset with a Contact Channel, at trust 0.5. */
function assetRel(npc: NpcId, extra: Partial<Relationship> = {}): Relationship {
  return {
    ...newRelationship(npc),
    recruited: true,
    channel: true,
    trust: 0.5,
    asset: {
      access: asTruth({ locs: [], orgs: [], npcs: [] }),
      reliability: asTruth(0.8),
      turned: false,
      hostileControlled: asTruth(false),
    },
    ...extra,
  };
}

/** The NPC ids, sorted. */
function npcIds(state: WorldState): NpcId[] {
  return (Object.keys(state.npcs) as NpcId[]).sort();
}

/** The city's Station Location. */
function stationLoc(state: WorldState): LocId {
  const loc = Object.values(state.city.locations)
    .filter((l) => l.type === STATION_LOCATION_TYPE || l.type.endsWith(`/${STATION_LOCATION_TYPE}`))
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  if (loc === undefined) {
    throw new Error('the generated city has no Station');
  }
  return loc.id;
}

/** An NPC its schedule places somewhere at `t`, with that Location. */
function scheduledSomewhere(state: WorldState, t: GameTime): { npc: NpcId; loc: LocId } {
  for (const npc of npcIds(state)) {
    const loc = scheduledLocationAt(state.npcs[npc], t);
    if (loc !== undefined) {
      return { npc, loc };
    }
  }
  throw new Error('no NPC is scheduled anywhere at that time');
}

/** The kinds of a list of events, in order. */
function kinds(events: readonly SimEvent[]): string[] {
  return events.map((e) => e.kind);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('phaseStep — schedules and pinned NPCs (Req 1.2)', () => {
  it('moves free NPCs to their scheduled places and holds out-of-play NPCs', () => {
    const [arrested, held] = npcIds(BASE);
    const to = addPhases(BASE.time, 1);
    const state = withRel(
      {
        ...BASE,
        npcs: { ...BASE.npcs, [arrested]: { ...BASE.npcs[arrested], status: asTruth('arrested') } },
      },
      { ...newRelationship(held), custody: { by: 'station', since: BASE.time, until: addPhases(BASE.time, 8) } },
    );

    const { state: next, events } = step(state);

    expect(next.time).toEqual(to);
    expect(pinnedWhereabouts(state, arrested, to)).toBe('absent');
    expect(next.whereabouts[arrested]).toBe('absent');
    expect(next.whereabouts[held]).toBe(stationLoc(BASE));
    for (const id of npcIds(next).filter((n) => n !== arrested && n !== held)) {
      expect(next.whereabouts[id]).toBe(scheduledLocationAt(next.npcs[id], to) ?? 'absent');
    }
    for (const e of events) {
      expect(e.kind).toBe('npc-moved');
      if (e.kind === 'npc-moved') {
        expect([arrested, held]).not.toContain(e.npc);
        expect(next.whereabouts[e.npc]).toBe(e.to);
      }
    }
  });

  it('keeps a walk-in at the Station for the rest of that day', () => {
    const to = addPhases(BASE.time, 1);
    const station = stationLoc(BASE);
    const visitor = npcIds(BASE).find((id) => scheduledLocationAt(BASE.npcs[id], to) !== station);
    expect(visitor).toBeDefined();
    if (visitor === undefined) {
      return;
    }
    const state = withRel(BASE, {
      ...newRelationship(visitor),
      callingAt: { loc: station, day: to.day },
    });
    const { state: next } = step(state);
    expect(next.time.day).toBe(to.day);
    expect(next.whereabouts[visitor]).toBe(station);
    expect(visibleNpcsAt(next, station)).toContain(visitor);
    const own = scheduledLocationAt(next.npcs[visitor], next.time);
    if (own !== undefined && own !== station) {
      expect(visibleNpcsAt(next, own)).not.toContain(visitor);
    }
  });

  it('emits a move once, and not again for a boundary move the schedules hook recorded', () => {
    // Day 0 is a Monday (content weekday 0), day 1 a Tuesday.
    const [locA, locB] = (Object.keys(BASE.city.locations) as LocId[]).sort();
    const [id] = npcIds(BASE);
    const mover = {
      ...BASE.npcs[id],
      schedule: {
        entries: [
          { weekday: 0, phase: 0 as const, loc: locA },
          { weekday: 0, phase: 1 as const, loc: locB },
          { weekday: 0, phase: 3 as const, loc: locB },
          { weekday: 1, phase: 0 as const, loc: locA },
        ],
      },
    };
    const world: WorldState = {
      ...BASE,
      npcs: { ...BASE.npcs, [id]: mover },
      whereabouts: { ...BASE.whereabouts, [id]: locA },
    };
    const night = atTime({ ...world, whereabouts: { ...world.whereabouts, [id]: locB } }, { day: 0, phase: 3 });
    const hooked: WorldState = { ...night, whereabouts: { ...night.whereabouts, [id]: locA } };
    const moves = (events: readonly SimEvent[]) =>
      events.filter((e) => e.kind === 'npc-moved' && e.npc === id);

    expect(moves(step(world).events)).toEqual([
      expect.objectContaining({ npc: id, from: locA, to: locB }),
    ]);
    expect(moves(step(night).events)).toEqual([
      expect.objectContaining({ npc: id, from: locB, to: locA }),
    ]);
    expect(moves(step(hooked).events)).toEqual([]);
    expect(step(hooked).state.whereabouts[id]).toBe(locA);
  });
});

describe('phaseStep — meetings (Req 1.3, 1.4, 1.8)', () => {
  it('opens a scene for a kept meeting and raises a no-show for an attended void one', () => {
    const to = addPhases(BASE.time, 1);
    const { npc, loc } = scheduledSomewhere(BASE, to);
    const other = npcIds(BASE).find((n) => n !== npc) as NpcId;
    const kept: Meeting = {
      id: `meeting:${npc}@${loc}#0.1`,
      npc,
      at: loc,
      slot: to,
      status: 'accepted',
      acceptance: 1,
    };
    const voided: Meeting = { ...kept, id: `meeting:${other}@${loc}#0.1`, npc: other, status: 'void' };
    const state = withRel(
      {
        ...BASE,
        player: { ...BASE.player, loc },
        meetings: { [kept.id]: kept, [voided.id]: voided },
      },
      assetRel(npc),
    );

    const result = step(state);

    expect(result.openScene).toEqual({ npc });
    expect(result.state.meetings[kept.id].status).toBe('kept');
    expect(result.state.relationships[npc].lastContact).toEqual(to);
    const meetingEvents = result.events.filter((e) => e.kind.startsWith('meeting'));
    expect(kinds(meetingEvents).sort()).toEqual(['meeting-due', 'meeting-no-show']);
  });
});

describe('phaseStep — Cables and Directives (Req 1.5, 1.6, 6.4)', () => {
  it('delivers each due reply as its own Cable Document, with a Dossier for a trace', () => {
    // Two reports due in the same phase would share processDueCables' doc id.
    // Trace someone whose opening file left a lead unsent, so the reply adds it.
    const held = new Set<string>();
    for (const doc of Object.values(BASE.documents)) {
      if (doc.kind === 'dossier') {
        for (const id of doc.asserts) {
          held.add(id);
        }
      }
    }
    const unsent = [...BASE.station.knowledge.known, ...BASE.station.knowledge.falseBeliefs].find(
      (prop) => prop.subject.startsWith('npc:') && !held.has(prop.id),
    );
    expect(unsent).toBeDefined();
    const now: GameTime = { day: 1, phase: 0 };
    const pending = [
      submitCable(
        { kind: 'trace', target: (unsent?.subject ?? BASE.station.chief) as NpcId },
        { day: 0, phase: 1 },
        { delayPhases: 4 },
      ),
      submitCable({ kind: 'report', body: 'The contact kept the meeting.' }, { day: 0, phase: 2 }, { delayPhases: 3 }),
      submitCable({ kind: 'report', body: 'A second meeting is arranged.' }, { day: 0, phase: 3 }, { delayPhases: 2 }),
    ];
    const state = atTime({ ...BASE, station: { ...BASE.station, pendingCables: pending } }, now);

    const { state: next, events } = step(state);

    const cables = events.filter((e) => e.kind === 'cable');
    expect(cables).toHaveLength(3);
    const docs = cables.map((e) => (e.kind === 'cable' ? e.doc : ''));
    expect(new Set(docs).size).toBe(3);
    for (const doc of docs) {
      expect(next.documents[doc as keyof typeof next.documents]?.kind).toBe('cable');
    }
    const dossiers = Object.keys(next.documents).filter((id) => id.startsWith('doc:dossier/trace-'));
    expect(dossiers).toHaveLength(1);
    expect(next.station.pendingCables).toEqual([]);
    expect(next.station.standing).toBe(BASE.station.standing + 2 * REPORT_STANDING_DELTA);
  });

  it('approves a pitch on a developed contact, and asks for more meetings otherwise', () => {
    const npc = BASE.station.chief;
    const now: GameTime = { day: 1, phase: 0 };
    const trace = () =>
      submitCable({ kind: 'trace', target: npc }, { day: 0, phase: 0 }, { delayPhases: 1 });
    const developed = atTime(
      {
        ...BASE,
        relationships: {
          ...BASE.relationships,
          [npc]: { ...newRelationship(npc), meetings: MEETINGS_BEFORE_PITCH },
        },
        station: { ...BASE.station, pendingCables: [trace()] },
      },
      now,
    );
    const cleared = step(developed);
    expect(cleared.state.relationships[npc]?.pitchApproved).toBe(true);
    const approved = Object.values(cleared.state.documents).map((doc) => doc.body).join('\n');
    expect(approved).toContain('A PITCH IS APPROVED');

    const early = atTime(
      {
        ...BASE,
        relationships: {
          ...BASE.relationships,
          [npc]: { ...newRelationship(npc), meetings: 1 },
        },
        station: { ...BASE.station, pendingCables: [trace()] },
      },
      now,
    );
    const held = step(early);
    expect(held.state.relationships[npc]?.pitchApproved).toBeUndefined();
    const waiting = Object.values(held.state.documents).map((doc) => doc.body).join('\n');
    expect(waiting).toContain('DEVELOP THE CONTACT');
  });

  it('settles a met Directive and follows its event with HQ Cable', () => {
    const directive: Directive = {
      id: 'directive:smoke',
      text: 'Recruit one Asset',
      objective: { kind: 'recruit', count: 1 },
      deadline: addPhases(BASE.time, 40),
      reward: 3,
      status: 'open',
    };
    const seen: GameTime[] = [];
    const deps: PhaseStepDeps = {
      content: INPUTS.content,
      objectives: () => (_objective, at) => {
        seen.push(at);
        return true;
      },
    };
    const state: WorldState = { ...BASE, station: { ...BASE.station, directives: [directive] } };

    const { state: next, events } = step(state, deps);

    expect(seen).toEqual([addPhases(BASE.time, 1)]);
    expect(kinds(events.filter((e) => e.kind === 'directive' || e.kind === 'cable'))).toEqual([
      'directive',
      'cable',
    ]);
    expect(next.station.directives[0].status).toBe('met');
    expect(next.station.standing).toBe(BASE.station.standing + 3);
  });
});

describe('phaseStep — retainers, silence, drops and custody (Req 1.7, 1.8)', () => {
  /** A money-motivated version of the NPC. */
  function moneyMotivated(state: WorldState, npc: NpcId): WorldState {
    const mice = asTruth({ money: 1, ideology: 0, coercion: 0, ego: 0 });
    return { ...state, npcs: { ...state.npcs, [npc]: { ...state.npcs[npc], mice } } };
  }

  it('raises retainer-due once when it falls due and decays trust one step per overdue phase', () => {
    const [due, overdue] = npcIds(BASE);
    const now: GameTime = { day: 5, phase: 0 };
    const to = addPhases(now, 1);
    // `overdue` becomes one phase past the grace period at `to`.
    const lapsed = timeToPhases(to) - RETAINER_GRACE_PHASES - 1;
    const lapsedAt: GameTime = { day: Math.floor(lapsed / 4), phase: (lapsed % 4) as GameTime['phase'] };
    let state = moneyMotivated(moneyMotivated(atTime(BASE, now), due), overdue);
    state = withRel(state, assetRel(due, { retainer: { amount: 50, paidThrough: to } }));
    state = withRel(state, assetRel(overdue, { retainer: { amount: 70, paidThrough: lapsedAt } }));

    const first = step(state);
    const second = step(first.state);

    expect(first.events.filter((e) => e.kind === 'retainer-due')).toEqual([
      expect.objectContaining({ npc: due, amount: 50, at: to }),
    ]);
    expect(second.events.filter((e) => e.kind === 'retainer-due')).toEqual([]);
    expect(first.state.relationships[overdue].trust).toBeCloseTo(0.5 - RETAINER_DECAY_PER_PHASE, 10);
    expect(second.state.relationships[overdue].trust).toBeCloseTo(0.5 - 2 * RETAINER_DECAY_PER_PHASE, 10);
    expect(first.state.relationships[due].trust).toBe(0.5);
  });

  it('raises asset-silent once per silence, and a new report starts a new one', () => {
    const [npc] = npcIds(BASE);
    const silenceDays = BASE.meta.scenario.silenceDays;
    const now: GameTime = { day: silenceDays + 1, phase: 0 };
    const lastReport = { day: 1, phase: 1 } as const; // exactly silenceDays before `now + 1`
    const state = withRel(atTime(BASE, now), assetRel(npc, { lastReport }));

    const first = step(state);
    const second = step(first.state);
    const reported = withRel(first.state, { ...first.state.relationships[npc], lastReport: first.state.time });
    const third = step(reported);

    expect(first.events.filter((e) => e.kind === 'asset-silent')).toEqual([
      expect.objectContaining({ npc, days: silenceDays }),
    ]);
    expect(first.state.relationships[npc].silenceNotified).toBe(true);
    expect(second.events.filter((e) => e.kind === 'asset-silent')).toEqual([]);
    expect(third.state.relationships[npc].silenceNotified).toBeUndefined();
  });

  it('raises drop-unserviced once at an own drop whose expected loader is out of play', () => {
    const [loader] = npcIds(BASE);
    const dropId = BASE.player.known.drops[0];
    const drop: DeadDrop = { ...BASE.deadDrops[dropId], expectedLoader: loader };
    const state: WorldState = {
      ...BASE,
      npcs: { ...BASE.npcs, [loader]: { ...BASE.npcs[loader], status: asTruth('arrested') } },
      deadDrops: { ...BASE.deadDrops, [dropId]: drop },
      player: { ...BASE.player, loc: drop.loc },
    };

    const first = step(state);
    const second = step(first.state);

    expect(first.events.filter((e) => e.kind === 'drop-unserviced')).toEqual([
      expect.objectContaining({ drop: dropId }),
    ]);
    expect('expectedLoader' in first.state.deadDrops[dropId]).toBe(false);
    expect(second.events.filter((e) => e.kind === 'drop-unserviced')).toEqual([]);
  });

  it('releases Station Custody when its hold ends, with the release suspicion', () => {
    const [npc] = npcIds(BASE);
    const to = addPhases(BASE.time, 1);
    const state = withRel(BASE, {
      ...newRelationship(npc),
      custody: { by: 'station', since: BASE.time, until: to },
    });

    const { state: next, events } = step(state);

    expect(events.filter((e) => e.kind === 'custody-released')).toEqual([
      expect.objectContaining({ npc, at: to }),
    ]);
    expect(next.relationships[npc].custody).toBeUndefined();
    expect(next.relationships[npc].suspicion).toBeCloseTo(CUSTODY_RELEASE_SUSPICION_PER_PHASE * 1, 10);
  });
});

describe('phaseStep — order, purity and determinism (Req 1.9, 5.6)', () => {
  it('appends events in sub-step order and leaves its input untouched', () => {
    const to = addPhases(BASE.time, 1);
    const { npc, loc } = scheduledSomewhere(BASE, to);
    const held = npcIds(BASE).find((n) => n !== npc) as NpcId;
    const meeting: Meeting = {
      id: `meeting:${npc}@${loc}#0.1`,
      npc,
      at: loc,
      slot: to,
      status: 'accepted',
      acceptance: 1,
    };
    const state = withRel(
      {
        ...BASE,
        player: { ...BASE.player, loc },
        meetings: { [meeting.id]: meeting },
        station: {
          ...BASE.station,
          pendingCables: [submitCable({ kind: 'funds' }, BASE.time, { delayPhases: 1 })],
        },
      },
      { ...newRelationship(held), custody: { by: 'station', since: BASE.time, until: to } },
    );
    const before = structuredClone(state);

    const a = step(state);
    const b = step(state);

    // Sub-steps 1, 2, 3 and 7: each kind's events come after the earlier ones'.
    const order = ['npc-moved', 'meeting-due', 'cable', 'custody-released'];
    const seen = kinds(a.events).filter((k) => order.includes(k));
    const rank = (k: string) => order.indexOf(k);
    expect(seen).toEqual(expect.arrayContaining(['meeting-due', 'cable', 'custody-released']));
    expect(seen).toEqual([...seen].sort((x, y) => rank(x) - rank(y)));
    expect(a.events.every((e) => timeToPhases(e.at) === timeToPhases(to))).toBe(true);
    expect(state).toEqual(before);
    expect(b).toEqual(a);
  });

  it('refuses a step that does not move the clock forward', () => {
    expect(() =>
      phaseStep(BASE, BASE.time, BASE.time, createPrng('phase-step'), DEPS),
    ).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// Task 4.5: one example per effect not already covered above
// ---------------------------------------------------------------------------

/** An NPC scheduled somewhere at `t`, plus a Location the player can stand in
 * that is *not* that place (so an accepted meeting is missed, not kept). */
function scheduledWithElsewhere(
  state: WorldState,
  t: GameTime,
): { npc: NpcId; loc: LocId; elsewhere: LocId } {
  const { npc, loc } = scheduledSomewhere(state, t);
  const elsewhere = (Object.keys(state.city.locations) as LocId[])
    .sort()
    .find((l) => l !== loc);
  if (elsewhere === undefined) {
    throw new Error('the generated city has only one Location');
  }
  return { npc, loc, elsewhere };
}

describe('phaseStep — missed meeting trust drop (Req 1.3, 24.4)', () => {
  it('drops trust on the Relationship of an NPC the player stood up', () => {
    const to = addPhases(BASE.time, 1);
    const { npc, loc, elsewhere } = scheduledWithElsewhere(BASE, to);
    const meeting: Meeting = {
      id: `meeting:${npc}@${loc}#${to.day}.${to.phase}`,
      npc,
      at: loc,
      slot: to,
      status: 'accepted',
      acceptance: 1,
    };
    // The NPC already has a Relationship carrying a numeric trust.
    const state = withRel(
      { ...BASE, player: { ...BASE.player, loc: elsewhere }, meetings: { [meeting.id]: meeting } },
      assetRel(npc, { trust: 0.7 }),
    );

    const { state: next, events } = step(state);

    expect(next.meetings[meeting.id].status).toBe('missed');
    expect(next.relationships[npc].trust).toBeCloseTo(0.7 - MISSED_MEETING_TRUST_DROP, 10);
    expect(kinds(events.filter((e) => e.kind.startsWith('meeting')))).toEqual([
      'meeting-missed-by-player',
    ]);
  });

  it('mints a Relationship at neutral-minus-drop for an NPC that had none', () => {
    const to = addPhases(BASE.time, 1);
    const { npc, loc, elsewhere } = scheduledWithElsewhere(BASE, to);
    const meeting: Meeting = {
      id: `meeting:${npc}@${loc}#${to.day}.${to.phase}`,
      npc,
      at: loc,
      slot: to,
      status: 'accepted',
      acceptance: 1,
    };
    const state: WorldState = {
      ...BASE,
      player: { ...BASE.player, loc: elsewhere },
      meetings: { [meeting.id]: meeting },
      relationships: {},
    };

    const { state: next } = step(state);

    expect(next.meetings[meeting.id].status).toBe('missed');
    expect(next.relationships[npc]).toBeDefined();
    expect(next.relationships[npc].trust).toBeCloseTo(NEUTRAL_TRUST - MISSED_MEETING_TRUST_DROP, 10);
  });
});

describe('phaseStep — funds Cables (Req 1.5)', () => {
  it('credits the ledger and composes an approval Cable when a funds grant lands', () => {
    const now: GameTime = { day: 1, phase: 0 };
    const to = addPhases(now, 1);
    const pending = submitCable({ kind: 'funds' }, { day: 0, phase: 0 }, { delayPhases: 4 });
    const state = atTime(
      { ...BASE, station: { ...BASE.station, pendingCables: [pending] } },
      now,
    );
    const expectedGrant = fundsGrantAmount(
      BASE.station.standing,
      undefined,
      DEFAULT_FUNDS_BASE,
      DEFAULT_FUNDS_CAP,
    );

    const { state: next, events } = step(state);

    const cables = events.filter((e) => e.kind === 'cable');
    expect(cables).toHaveLength(1);
    expect(expectedGrant).toBeGreaterThan(0);
    expect(balance(next.station.ledger)).toBe(balance(BASE.station.ledger) + expectedGrant);
    expect(next.station.lastFundsGrant).toEqual(to);
    const doc = cables[0].kind === 'cable' ? next.documents[cables[0].doc] : undefined;
    expect(doc?.kind).toBe('cable');
    expect(JSON.stringify(doc)).toContain('FUNDS APPROVED');
  });

  it('refuses the grant inside the cooldown, leaving the ledger untouched', () => {
    const now: GameTime = { day: 1, phase: 0 };
    const pending = submitCable({ kind: 'funds' }, { day: 0, phase: 0 }, { delayPhases: 4 });
    const state = atTime(
      {
        ...BASE,
        station: {
          ...BASE.station,
          pendingCables: [pending],
          // A grant one phase ago is well inside the two-day cooldown.
          lastFundsGrant: { day: 0, phase: 3 },
        },
      },
      now,
    );

    const { state: next, events } = step(state);

    expect(events.filter((e) => e.kind === 'cable')).toHaveLength(1);
    expect(balance(next.station.ledger)).toBe(balance(BASE.station.ledger));
    expect(next.station.lastFundsGrant).toEqual({ day: 0, phase: 3 });
    const docId = events.find((e) => e.kind === 'cable');
    const doc = docId?.kind === 'cable' ? next.documents[docId.doc] : undefined;
    expect(JSON.stringify(doc)).toContain('NO FUNDS ARE RELEASED');
  });

  it('answers a trace on a non-person target with a no-personal-file Cable and no Dossier', () => {
    const now: GameTime = { day: 1, phase: 0 };
    // An organisation id — not an `npc:` — so no personal file is held.
    const target = (Object.keys(BASE.orgs) as (keyof typeof BASE.orgs)[])[0];
    expect(target).toBeDefined();
    const pending = submitCable(
      { kind: 'trace', target },
      { day: 0, phase: 0 },
      { delayPhases: 4 },
    );
    const state = atTime(
      { ...BASE, station: { ...BASE.station, pendingCables: [pending] } },
      now,
    );

    const { state: next, events } = step(state);

    const cables = events.filter((e) => e.kind === 'cable');
    expect(cables).toHaveLength(1);
    const dossiers = Object.keys(next.documents).filter((id) =>
      id.startsWith('doc:dossier/trace-'),
    );
    expect(dossiers).toHaveLength(0);
    const doc = cables[0].kind === 'cable' ? next.documents[cables[0].doc] : undefined;
    expect(JSON.stringify(doc)).toContain('HEADQUARTERS HOLDS NO PERSONAL FILE ON THE SUBJECT');
  });
});

describe('phaseStep — failed Directive (Req 1.6, 6.4)', () => {
  it('settles a Directive whose deadline has passed and follows its event with an HQ Cable', () => {
    const to = addPhases(BASE.time, 1);
    const directive: Directive = {
      id: 'directive:lapsed',
      text: 'Recruit one Asset',
      objective: { kind: 'recruit', count: 1 },
      // The deadline is at/by the entered phase, and the objective is unmet.
      deadline: BASE.time,
      reward: 3,
      status: 'open',
    };
    const deps: PhaseStepDeps = {
      content: INPUTS.content,
      objectives: () => () => false,
    };
    const state: WorldState = { ...BASE, station: { ...BASE.station, directives: [directive] } };

    const { state: next, events } = step(state, deps);

    expect(kinds(events.filter((e) => e.kind === 'directive' || e.kind === 'cable'))).toEqual([
      'directive',
      'cable',
    ]);
    const directiveEvent = events.find((e) => e.kind === 'directive');
    expect(directiveEvent).toMatchObject({ status: 'failed', at: to });
    expect(next.station.directives[0].status).toBe('failed');
    const cableEvent = events.find((e) => e.kind === 'cable');
    const doc = cableEvent?.kind === 'cable' ? next.documents[cableEvent.doc] : undefined;
    expect(JSON.stringify(doc)).toContain('THE DEADLINE PASSED WITHOUT A RESULT');
  });
});
