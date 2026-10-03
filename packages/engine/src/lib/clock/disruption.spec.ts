/**
 * Tests for the live Disruption Context (slice-integration task 4.1;
 * Requirements 4.2, 4.3, 4.4).
 *
 * One example per record the predicates read, on a World State generated from
 * the real core pack:
 *
 * - a fresh world disrupts nothing;
 * - `isArrested` holds for an NPC in Station Custody, named in the Station's
 *   arrest record (by NPC id or `unk:` id, and after the hold has run out),
 *   whose status is `arrested` or `fled`, or held by the Hostile Service;
 * - `isChannelCompromised` follows `hostile.beliefs.compromisedChannels`;
 * - `isMaterielSeized` follows `plot.materielSeized`.
 *
 * Property 50 (task 5.10) checks the same agreement over reachable states.
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
import {
  asTruth,
  type ChannelId,
  type GameTime,
  type NpcId,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { NpcStatus } from '../city/npc.js';
import {
  inStationCustody,
  newRelationship,
  type Custody,
} from '../recruit/asset.js';
import { liveDisruption } from './disruption.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors end-conditions.spec.ts)
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

const BASE: WorldState = generate('disruption-alpha', inputs());

// ---------------------------------------------------------------------------
// State builders
// ---------------------------------------------------------------------------

/** The first `count` NPC ids of the world, in id order. */
function npcs(state: WorldState, count: number): NpcId[] {
  const ids = (Object.keys(state.npcs) as NpcId[]).sort();
  if (ids.length < count) {
    throw new Error(`the generated world has fewer than ${count} NPCs`);
  }
  return ids.slice(0, count);
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

/** `state` with `npc`'s status set. */
function withStatus(
  state: WorldState,
  npc: NpcId,
  status: NpcStatus,
): WorldState {
  return {
    ...state,
    npcs: {
      ...state.npcs,
      [npc]: { ...state.npcs[npc], status: asTruth<NpcStatus>(status) },
    },
  };
}

// ---------------------------------------------------------------------------
// A fresh world
// ---------------------------------------------------------------------------

describe('liveDisruption — a freshly generated world', () => {
  it('reports no NPC arrested, no Channel compromised and no materiel seized', () => {
    const ctx = liveDisruption(BASE);
    for (const npc of Object.keys(BASE.npcs) as NpcId[]) {
      expect(ctx.isArrested(npc)).toBe(false);
    }
    const channels = Object.keys(BASE.channels);
    expect(channels.length).toBeGreaterThan(0);
    for (const channel of channels) {
      expect(ctx.isChannelCompromised(channel)).toBe(false);
    }
    expect(ctx.isMaterielSeized()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isArrested (Req 4.2)
// ---------------------------------------------------------------------------

describe('liveDisruption — isArrested (Req 4.2)', () => {
  it('holds for an NPC in Station Custody', () => {
    const [held, other] = npcs(BASE, 2);
    const state = withCustody(BASE, held, {
      by: 'station',
      since: BASE.time,
      until: later(BASE.time, 4),
    });
    const ctx = liveDisruption(state);
    expect(ctx.isArrested(held)).toBe(true);
    expect(ctx.isArrested(other)).toBe(false);
  });

  it('holds from the Station arrest record once the custody hold has run out', () => {
    const [arrested, other] = npcs(BASE, 2);
    const until = later(BASE.time, 4);
    const handedOver: WorldState = {
      ...withArrests(
        withCustody(BASE, arrested, { by: 'station', since: BASE.time, until }),
        [arrested],
      ),
      time: later(until, 2),
    };
    expect(
      inStationCustody(handedOver.relationships[arrested], handedOver.time),
    ).toBe(false);
    const ctx = liveDisruption(handedOver);
    expect(ctx.isArrested(arrested)).toBe(true);
    expect(ctx.isArrested(other)).toBe(false);
  });

  it('resolves an Unidentified Subject id in the arrest record through player.unkIds', () => {
    const [arrested, other] = npcs(BASE, 2);
    const aliased: WorldState = {
      ...BASE,
      player: {
        ...BASE.player,
        unkIds: { ...BASE.player.unkIds, [arrested]: 'unk:1', [other]: 'unk:2' },
      },
    };
    const ctx = liveDisruption(withArrests(aliased, ['unk:1']));
    expect(ctx.isArrested(arrested)).toBe(true);
    expect(ctx.isArrested(other)).toBe(false);
  });

  it('holds for an NPC whose status is fled or arrested', () => {
    const [fled, arrested, active] = npcs(BASE, 3);
    const state = withStatus(
      withStatus(withStatus(BASE, fled, 'fled'), arrested, 'arrested'),
      active,
      'active',
    );
    const ctx = liveDisruption(state);
    expect(ctx.isArrested(fled)).toBe(true);
    expect(ctx.isArrested(arrested)).toBe(true);
    expect(ctx.isArrested(active)).toBe(false);
  });

  it('holds while the Hostile Service holds the NPC, and not after a bounded hold ends', () => {
    const [held, released] = npcs(BASE, 2);
    const state: WorldState = {
      ...withCustody(
        withCustody(BASE, held, { by: 'hostile', since: BASE.time }),
        released,
        { by: 'hostile', since: BASE.time, until: later(BASE.time, 2) },
      ),
      time: later(BASE.time, 3),
    };
    const ctx = liveDisruption(state);
    expect(ctx.isArrested(held)).toBe(true);
    expect(ctx.isArrested(released)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isChannelCompromised (Req 4.3)
// ---------------------------------------------------------------------------

describe('liveDisruption — isChannelCompromised (Req 4.3)', () => {
  it('holds for a Channel in the Hostile Service compromisedChannels, and only for it', () => {
    const channels = (Object.keys(BASE.channels) as ChannelId[]).sort();
    if (channels.length < 2) {
      throw new Error('the generated world has fewer than two Channels');
    }
    const [compromised, other] = channels;
    const state: WorldState = {
      ...BASE,
      hostile: {
        ...BASE.hostile,
        beliefs: { ...BASE.hostile.beliefs, compromisedChannels: [compromised] },
      },
    };
    const ctx = liveDisruption(state);
    expect(ctx.isChannelCompromised(compromised)).toBe(true);
    expect(ctx.isChannelCompromised(other)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isMaterielSeized (Req 4.4)
// ---------------------------------------------------------------------------

describe('liveDisruption — isMaterielSeized (Req 4.4)', () => {
  it('holds when the Plot records its materiel as seized', () => {
    const seized: WorldState = {
      ...BASE,
      plot: { ...BASE.plot, materielSeized: true },
    };
    expect(liveDisruption(seized).isMaterielSeized()).toBe(true);
  });
});
