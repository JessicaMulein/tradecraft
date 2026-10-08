/**
 * Nemesis: selection, placement, growth, resolution, and the defection pitch.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth, createPrng, type Prng } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import type { ArcFacts } from './arcs.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import {
  growNemesis,
  NEMESIS_PITCH_DOCUMENT,
  NEMESIS_RANK_CAP,
  NEMESIS_SKILL_CAP,
  placeNemesis,
  registerDefectionOffer,
  scheduleNemesisPitch,
  selectNemesis,
  settleNemesis,
} from './nemesis.js';
import type { CampaignTruth, CarriedNpc } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);

function officer(id: CarriedNpc['id'], archetype: string, status: CarriedNpc['status'] = 'at-large'): CarriedNpc {
  return {
    id,
    archetype,
    name: id,
    aliases: [],
    persona: {
      name: id,
      given: id,
      family: id,
      library: '',
      culture: '',
      gender: 'male',
      voiceTraits: [],
      mannerisms: [],
      background: 'officer',
      openness: 0.5,
    },
    descriptor: 'a coat',
    allegiance: { true: 'svc-east', apparent: 'svc-east' },
    mice: asTruth({ money: 0, ideology: 1, coercion: 0, ego: 0 }),
    loyalty: 0.4,
    service: 'svc-east',
    rank: 1,
    status,
    seen: [{ posting: 0, city: 'core' }],
  };
}

function facts(patch: Partial<ArcFacts> = {}): ArcFacts {
  return {
    postingIndex: 1,
    year: 1950,
    service: 'svc-east',
    rank: 'case-officer',
    notoriety: 0,
    heldClaims: [],
    presentClues: [],
    roster: {},
    ...patch,
  };
}

function scripted(walkIn: boolean): Prng {
  return {
    nextUint32: () => 0,
    next: () => (walkIn ? 0 : 0.9),
    int: (min) => min,
    bool: () => walkIn,
    pick: (items) => {
      const item = items[0];
      if (item === undefined) {
        throw new Error('empty pick');
      }
      return item;
    },
    shuffle: (items) => [...items],
    state: () => [0, 0, 0, 0],
  };
}

describe('nemesis', () => {
  it('picks a surviving hostile officer, or mints one for the service', () => {
    const pool = [
      officer('cp-9', 'cafe-waiter'),
      officer('cp-3', 'hostile-case-officer', 'dead'),
      officer('cp-8', 'hostile-officer'),
      officer('cp-4', 'hostile-case-officer'),
    ];
    const first = selectNemesis(pool, 'hostile-case-officer', 'svc-east', 'core', 1, 10, createPrng('nemesis'));
    const second = selectNemesis(pool, 'hostile-case-officer', 'svc-east', 'core', 1, 10, createPrng('nemesis'));
    expect(second.id).toBe(first.id);
    expect(['cp-4', 'cp-8']).toContain(first.id);
    expect(first.generated).toBe(false);
    expect(first.hostiles).toBe(pool);

    const minted = selectNemesis([officer('cp-9', 'cafe-waiter')], 'hostile-case-officer', 'svc-east', 'core', 1, 10, createPrng('mint'));
    expect(minted.generated).toBe(true);
    expect(minted.id).toBe('cp-10');
    expect(minted.hostiles.at(-1)).toMatchObject({
      id: 'cp-10',
      archetype: 'hostile-case-officer',
      service: 'svc-east',
      status: 'at-large',
      rank: 1,
    });
  });

  it('places the nemesis as a principal and a recogniser only while the stage requires that service', () => {
    const person = officer('cp-2', 'hostile-case-officer');
    const arcs: CampaignTruth['arcs'] = {
      nemesis: { bindings: { nemesis: 'cp-2' }, stage: 'shadow', clues: {} },
      'mole-hunt': { bindings: { mole: 'cp-1' }, stage: 'rumour', clues: {} },
    };
    const roster = { 'cp-2': { status: 'at-large' as const, service: 'svc-east' } };
    const placed = placeNemesis(arcs, content.arcs, content.arcThreads, person, facts({ roster }));
    expect(placed.map((row) => row.as)).toEqual(['nemesis', 'recogniser']);
    expect(placed.every((row) => row.person.id === 'cp-2' && row.contact === false)).toBe(true);

    expect(placeNemesis(arcs, content.arcs, content.arcThreads, person, facts({ service: 'svc-west', roster }))).toEqual([]);
    expect(placeNemesis(arcs, content.arcs, content.arcThreads, person, facts({ postingIndex: 0, roster }))).toEqual([]);

    for (const status of ['arrested', 'turned', 'dead'] as const) {
      const settled = settleNemesis(person, status);
      expect(settled.status).toBe(status);
      expect(settled.rank).toBe(1);
      const resolved = placeNemesis(
        arcs,
        content.arcs,
        content.arcThreads,
        settled,
        facts({ roster: { 'cp-2': { status, service: 'svc-east' } } }),
      );
      expect(resolved).toEqual([]);
    }
  });

  it('grows a survivor up to the caps and leaves rank alone when the arc resolves', () => {
    const person = officer('cp-2', 'hostile-case-officer');
    const grown = growNemesis(person);
    expect(grown.rank).toBe(2);
    expect(grown.securityConsciousness).toBe(0.1);
    expect(grown.tradecraft).toBe(0.1);

    const capped = growNemesis({
      ...person,
      rank: NEMESIS_RANK_CAP,
      securityConsciousness: NEMESIS_SKILL_CAP,
      tradecraft: 0.85,
    });
    expect(capped.rank).toBe(NEMESIS_RANK_CAP);
    expect(capped.securityConsciousness).toBe(NEMESIS_SKILL_CAP);
    expect(capped.tradecraft).toBe(NEMESIS_SKILL_CAP);

    const arrested = { ...person, status: 'arrested' as const };
    expect(growNemesis(arrested)).toBe(arrested);
    expect(settleNemesis(arrested, 'turned').status).toBe('turned');
    expect(settleNemesis(person, 'at-large').rank).toBe(2);
  });

  it('schedules a pitch only on a stage that allows one, and registers defection', () => {
    const template = content.arcs.find((arc) => arc.id === 'nemesis');
    if (template === undefined) {
      throw new Error('missing nemesis arc');
    }
    expect(scheduleNemesisPitch(template, 'shadow', scripted(true))).toBeUndefined();
    expect(scheduleNemesisPitch(template, 'duel', scripted(true))).toEqual({ kind: 'walk-in' });
    expect(scheduleNemesisPitch(template, 'duel', scripted(false))).toEqual({
      kind: 'drop-letter',
      document: NEMESIS_PITCH_DOCUMENT,
    });

    const open = registerDefectionOffer(['retire']);
    expect(open).toEqual(['retire', 'defect']);
    expect(registerDefectionOffer(open)).toBe(open);
  });
});
