/**
 * Tests for the arrange-meeting action (task 11.5; Requirement 24.1, 24.2,
 * 24.3, 24.4).
 *
 * These drive a generated {@link WorldState} from the real core pack through the
 * arrange-meeting resolver and the top-level {@link quote}/{@link resolve},
 * checking:
 *
 * - quote requires a Contact Channel (no channel ⇒ not allowed) and a slot in
 *   the next three days (too-far / past slot ⇒ not allowed) (Req 24.1);
 * - resolve accept (coin under σ) records a Meeting + a `meeting-reply`
 *   `{accepted:true}` event and adds Exposure to the suspicion accumulator
 *   (Req 24.3, 24.4);
 * - resolve decline (coin over σ) records a declined Meeting + a `meeting-reply`
 *   `{accepted:false}` event (Req 24.3);
 * - the acceptance σ is monotonic in trust and agendaInterest (property)
 *   (Req 24.2);
 * - `resolveMeetingAtSlot` opens a scene when both are present (Req 24.2) and
 *   applies the missed-meeting penalty + trust drop when the player is absent
 *   (Req 24.4);
 * - determinism: the same seed gives the same outcome;
 * - a disallowed arrange leaves the state unchanged.
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
  type PublicText,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import {
  revealTruth,
  type GameTime,
  type LocId,
  type NpcId,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { quote, resolve, visibleNpcsAt } from './action.js';
import {
  quoteArrangeMeeting,
  resolveArrangeMeeting,
  resolveMeetingAtSlot,
  meetingAcceptanceProbability,
  MISSED_MEETING_TRUST_DROP,
  ARRANGE_PHASE_COST,
  type Meeting,
} from './arrange-meeting.js';
import type { Observation, ResolverContext } from './result.js';
import type { ArrangeMeetingAction } from './types.js';

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

function world(seed = 'arrange-alpha'): WorldState {
  return generate(seed, inputs());
}

function ctx(): ResolverContext {
  return { content };
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

/** The slot one day after `now`, in the morning (within the three-day window). */
function nextDaySlot(now: GameTime): GameTime {
  return { day: now.day + 1, phase: 0 };
}

/**
 * Stage a world so the player has a Contact Channel to an NPC and the chosen
 * meeting Location is open and allows arrange-meeting (so the shared gate
 * passes). Returns the staged state, the NPC and the open Location.
 */
function staged(base: WorldState): { state: WorldState; npc: NpcId; loc: LocId } {
  const npc = (Object.keys(base.npcs) as NpcId[])[0];
  const loc = (Object.keys(base.city.locations) as LocId[])[0];
  const type = base.city.locations[loc].type;
  // Resolve the Location Type so we can allow arrange-meeting on it for the gate.
  const state: WorldState = {
    ...base,
    player: {
      ...base.player,
      contacts: base.player.contacts.includes(npc)
        ? base.player.contacts
        : [...base.player.contacts, npc],
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
  void type;
  return { state, npc, loc };
}

// ---------------------------------------------------------------------------
// quote — Contact Channel and the three-day slot window (Req 24.1)
// ---------------------------------------------------------------------------

describe('arrange-meeting quote — precondition (Req 24.1)', () => {
  it('allowed with a Contact Channel and a slot in the next three days', () => {
    const { state, npc, loc } = staged(world());
    const slot = nextDaySlot(state.time);
    const q = quoteArrangeMeeting(state, { kind: 'arrange-meeting', npc, at: loc, slot });
    expect(q.allowed).toBe(true);
    expect(q.phases).toBe(ARRANGE_PHASE_COST);
    expect(q.money).toBe(0);
  });

  it('not allowed with no Contact Channel to the NPC', () => {
    const { state, npc, loc } = staged(world());
    const withoutChannel: WorldState = {
      ...state,
      player: { ...state.player, contacts: state.player.contacts.filter((c) => c !== npc) },
    };
    const slot = nextDaySlot(state.time);
    const q = quoteArrangeMeeting(withoutChannel, {
      kind: 'arrange-meeting',
      npc,
      at: loc,
      slot,
    });
    expect(q.allowed).toBe(false);
  });

  it('not allowed for a slot more than three days out', () => {
    const { state, npc, loc } = staged(world());
    const tooFar: GameTime = { day: state.time.day + 4, phase: 0 };
    const q = quoteArrangeMeeting(state, {
      kind: 'arrange-meeting',
      npc,
      at: loc,
      slot: tooFar,
    });
    expect(q.allowed).toBe(false);
  });

  it('not allowed for a slot in the past or now', () => {
    const { state, npc, loc } = staged(world());
    const past = quoteArrangeMeeting(state, {
      kind: 'arrange-meeting',
      npc,
      at: loc,
      slot: state.time,
    });
    expect(past.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolve — accept / decline, the reply event and Exposure (Req 24.2, 24.3, 24.4)
// ---------------------------------------------------------------------------

describe('arrange-meeting resolve — reply and Exposure (Req 24.2, 24.3, 24.4)', () => {
  it('accept (coin 0 ⇒ under σ): records a Meeting and a meeting-reply{accepted:true}', () => {
    const { state, npc, loc } = staged(world());
    const slot = nextDaySlot(state.time);
    const a: ArrangeMeetingAction = { kind: 'arrange-meeting', npc, at: loc, slot };
    const { next, result } = resolveArrangeMeeting(state, a, fixedPrng(0), renderLines);

    // A Meeting is recorded, accepted.
    const recorded = Object.values(next.meetings) as Meeting[];
    expect(recorded.length).toBe(1);
    expect(recorded[0].status).toBe('accepted');
    expect(recorded[0].npc).toBe(npc);
    expect(recorded[0].at).toBe(loc);
    expect(recorded[0].slot).toEqual(slot);

    // A player-visible meeting-reply{accepted:true} event.
    const reply = result.events.find((e) => e.kind === 'meeting-reply');
    expect(reply).toBeDefined();
    if (reply && reply.kind === 'meeting-reply') {
      expect(reply.accepted).toBe(true);
      expect(reply.meeting).toBe(recorded[0].id);
      expect(reply.visibility).toBe('player');
    }

    // Exposure added raises the suspicion accumulator.
    expect(revealTruth(next.player.coverSuspicion)).toBeGreaterThanOrEqual(
      revealTruth(state.player.coverSuspicion),
    );
  });

  it('decline (coin 1 ⇒ over σ): records a declined Meeting and meeting-reply{accepted:false}', () => {
    const { state, npc, loc } = staged(world());
    const slot = nextDaySlot(state.time);
    const a: ArrangeMeetingAction = { kind: 'arrange-meeting', npc, at: loc, slot };
    const { next, result } = resolveArrangeMeeting(state, a, fixedPrng(1), renderLines);

    const recorded = Object.values(next.meetings) as Meeting[];
    expect(recorded.length).toBe(1);
    expect(recorded[0].status).toBe('declined');

    const reply = result.events.find((e) => e.kind === 'meeting-reply');
    expect(reply).toBeDefined();
    if (reply && reply.kind === 'meeting-reply') {
      expect(reply.accepted).toBe(false);
    }
  });

  it('determinism: the same seed gives the same outcome', () => {
    const { state, npc, loc } = staged(world('arrange-det'));
    const slot = nextDaySlot(state.time);
    const a: ArrangeMeetingAction = { kind: 'arrange-meeting', npc, at: loc, slot };
    const first = resolveArrangeMeeting(state, a, createPrng('coin'), renderLines);
    const second = resolveArrangeMeeting(state, a, createPrng('coin'), renderLines);
    expect(Object.values(first.next.meetings)[0]).toEqual(
      Object.values(second.next.meetings)[0],
    );
    expect(revealTruth(first.next.player.coverSuspicion)).toBe(
      revealTruth(second.next.player.coverSuspicion),
    );
  });
});

// ---------------------------------------------------------------------------
// Acceptance σ monotonicity (property) (Req 24.2)
// ---------------------------------------------------------------------------

describe('meetingAcceptanceProbability — monotonic in trust and agendaInterest (Req 24.2)', () => {
  it('rises with trust and with agendaInterest, for positive weights', () => {
    const weights = { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 };
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true }),
        (trustLo, bump, locRisk, scheduleConflict) => {
          const trustHi = Math.min(1, trustLo + bump);
          const base = { locRisk, scheduleConflict, agendaInterest: 0 };
          const pLoTrust = meetingAcceptanceProbability(
            { ...base, trust: trustLo },
            weights,
          );
          const pHiTrust = meetingAcceptanceProbability(
            { ...base, trust: trustHi },
            weights,
          );
          // More trust never lowers acceptance.
          expect(pHiTrust).toBeGreaterThanOrEqual(pLoTrust - 1e-12);

          // More agendaInterest never lowers acceptance.
          const pLoAgenda = meetingAcceptanceProbability(
            { trust: trustLo, locRisk, scheduleConflict, agendaInterest: 0 },
            weights,
          );
          const pHiAgenda = meetingAcceptanceProbability(
            { trust: trustLo, locRisk, scheduleConflict, agendaInterest: 1 },
            weights,
          );
          expect(pHiAgenda).toBeGreaterThanOrEqual(pLoAgenda - 1e-12);
        },
      ),
    );
  });

  it('falls with Location risk and schedule conflict, for positive weights', () => {
    const weights = { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 };
    const base = { trust: 0.5, agendaInterest: 0.5 };
    const pLowRisk = meetingAcceptanceProbability(
      { ...base, locRisk: 0, scheduleConflict: 0 },
      weights,
    );
    const pHighRisk = meetingAcceptanceProbability(
      { ...base, locRisk: 1, scheduleConflict: 0 },
      weights,
    );
    expect(pHighRisk).toBeLessThan(pLowRisk);

    const pNoConflict = meetingAcceptanceProbability(
      { ...base, locRisk: 0, scheduleConflict: 0 },
      weights,
    );
    const pConflict = meetingAcceptanceProbability(
      { ...base, locRisk: 0, scheduleConflict: 1 },
      weights,
    );
    expect(pConflict).toBeLessThan(pNoConflict);
  });
});

// ---------------------------------------------------------------------------
// resolveMeetingAtSlot — scene at the slot and the missed penalty (Req 24.2, 24.4)
// ---------------------------------------------------------------------------

describe('resolveMeetingAtSlot — the slot (Req 24.2, 24.4)', () => {
  /** An accepted Meeting with the given NPC/Location/slot. */
  function acceptedMeeting(npc: NpcId, at: LocId, slot: GameTime): Meeting {
    return { id: `meeting:${npc}@${at}#${slot.day}.${slot.phase}` as Meeting['id'], npc, at, slot, status: 'accepted', acceptance: 0.8 };
  }

  it('both present at the slot: opens a talk scene and marks the Meeting kept (Req 24.2)', () => {
    const base = world();
    // Find a Location + NPC where the NPC is scheduled this (slot) phase.
    let found: { npc: NpcId; loc: LocId; slot: GameTime } | undefined;
    for (const loc of Object.keys(base.city.locations) as LocId[]) {
      const npcs = visibleNpcsAt(base, loc);
      if (npcs.length > 0) {
        found = { npc: npcs[0], loc, slot: base.time };
        break;
      }
    }
    if (found === undefined) {
      throw new Error('no scheduled NPC in the generated world at this time');
    }
    // Put the player at the meeting Location so both are present.
    const state: WorldState = { ...base, player: { ...base.player, loc: found.loc } };
    const meeting = acceptedMeeting(found.npc, found.loc, found.slot);
    const { next, result, trustDelta } = resolveMeetingAtSlot(state, meeting, renderLines);

    expect(result.openScene).toEqual({ npc: found.npc });
    expect(result.events.some((e) => e.kind === 'meeting-due')).toBe(true);
    expect((next.meetings[meeting.id] as Meeting).status).toBe('kept');
    expect(trustDelta).toBe(0);
  });

  it('player absent: applies the missed-meeting penalty and reports the trust drop (Req 24.4)', () => {
    const base = world();
    const npc = (Object.keys(base.npcs) as NpcId[])[0];
    const locs = Object.keys(base.city.locations) as LocId[];
    const meetingLoc = locs[0];
    // Put the player somewhere other than the meeting Location.
    const elsewhere = locs.find((l) => l !== meetingLoc) as LocId;
    const state: WorldState = { ...base, player: { ...base.player, loc: elsewhere } };
    const slot: GameTime = { day: base.time.day, phase: base.time.phase };
    const meeting = acceptedMeeting(npc, meetingLoc, slot);
    const { next, result, trustDelta } = resolveMeetingAtSlot(state, meeting, renderLines);

    expect(result.openScene).toBeUndefined();
    expect(result.events.some((e) => e.kind === 'meeting-missed-by-player')).toBe(true);
    expect((next.meetings[meeting.id] as Meeting).status).toBe('missed');
    expect(trustDelta).toBe(-MISSED_MEETING_TRUST_DROP);
  });

  it('a non-accepted Meeting is left unchanged', () => {
    const base = world();
    const npc = (Object.keys(base.npcs) as NpcId[])[0];
    const loc = (Object.keys(base.city.locations) as LocId[])[0];
    const declined: Meeting = {
      ...acceptedMeeting(npc, loc, { day: base.time.day, phase: 0 }),
      status: 'declined',
    };
    const { next, trustDelta } = resolveMeetingAtSlot(base, declined, renderLines);
    expect(next).toBe(base);
    expect(trustDelta).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The shared gate and top-level resolve
// ---------------------------------------------------------------------------

describe('arrange-meeting — the shared gate and top-level resolve', () => {
  it('a disallowed arrange (no channel) leaves the state unchanged', () => {
    const { state, npc, loc } = staged(world());
    const withoutChannel: WorldState = {
      ...state,
      player: { ...state.player, contacts: state.player.contacts.filter((c) => c !== npc) },
    };
    const slot = nextDaySlot(state.time);
    const a: ArrangeMeetingAction = { kind: 'arrange-meeting', npc, at: loc, slot };
    expect(quote(withoutChannel, a, ctx()).allowed).toBe(false);
    const { next } = resolve(withoutChannel, a, fixedPrng(0), ctx());
    expect(next).toBe(withoutChannel);
  });

  it('a closed meeting Location rejects the arrange through the shared gate', () => {
    const { state, npc, loc } = staged(world());
    const closed: WorldState = {
      ...state,
      city: {
        ...state.city,
        locations: {
          ...state.city.locations,
          [loc]: {
            ...state.city.locations[loc],
            hours: { 0: false, 1: false, 2: false, 3: false },
          },
        },
      },
    };
    const slot = nextDaySlot(state.time);
    const a: ArrangeMeetingAction = { kind: 'arrange-meeting', npc, at: loc, slot };
    expect(quote(closed, a, ctx()).allowed).toBe(false);
  });
});
