/**
 * Ambient prompt snapshot, recollection wording and scene labels.
 */

import { describe, expect, it } from 'vitest';

import { asTruth, type LocId, type NpcId, type Proposition } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import { resolve } from '../action/action.js';
import type { ResolverContext } from '../action/result.js';

import {
  ambientScene,
  promptFactsFor,
  recollectionLine,
  refreshPromptCache,
  selectAmbientFacts,
  type AmbientPromptFact,
} from './prompt.js';
import type { AmbientState } from './state.js';
import type { Recollection } from './memory.js';

const CAFE = 'loc:cafe' as LocId;

function fact(id: string, salience: number): AmbientPromptFact {
  return {
    salience,
    proposition: {
      id,
      subject: 'npc:ada' as NpcId,
      predicate: 'HAS_STATUS',
      object: { kind: 'text', value: id },
    },
  };
}

function ambient(extra: Partial<AmbientState> = {}): AmbientState {
  return {
    schema: 1,
    cityId: 'core',
    enabled: true,
    density: 'standard',
    calendar: { startDate: '1948-01-01', holidays: [] },
    metrics: {
      exo: { unrest: 0, police: 0, shortage: 0, tension: 0, festivity: 0 },
      react: { unrest: 0, police: 0, shortage: 0, tension: 0, festivity: 0 },
    },
    events: {},
    history: {},
    triggers: [],
    overlays: [],
    dormant: [],
    life: {},
    ties: [],
    tier: {},
    townsfolk: {},
    civicOrgs: [],
    promotionQueue: [],
    lastInteraction: {},
    memory: asTruth({}),
    regard: asTruth({}),
    informants: asTruth({}),
    stories: {},
    outlets: [],
    duties: [],
    coverStanding: asTruth(0.5),
    hookLedger: asTruth([]),
    ambientDelayDays: 0,
    coverDeltaToday: { pos: 0, neg: 0 },
    channelOutages: [],
    informantReports: [],
    detectionBonuses: {},
    tieKnowledge: {},
    falseBeliefs: {},
    gate: { solvable: [], anchors: [], slowRunsToday: 0 },
    counters: { starts: 0, incidents: 0, lifeEvents: 0, gossip: 0, promotions: 0, threads: 0 },
    ...extra,
  } as AmbientState;
}

describe('ambient prompt', () => {
  it('keeps the eight most salient facts', () => {
    const facts = Array.from({ length: 10 }, (_, i) => fact(`prop:${i}`, i / 10));
    expect(selectAmbientFacts(facts).map((item) => item.proposition.id)).toEqual([
      'prop:9',
      'prop:8',
      'prop:7',
      'prop:6',
      'prop:5',
      'prop:4',
      'prop:3',
      'prop:2',
    ]);
  });

  it('refers to an unnamed person by descriptor', () => {
    const rec: Recollection = {
      id: 'rec:1',
      kind: 'seen-with',
      at: { day: 1, phase: 1 },
      loc: CAFE,
      with: 'npc:viktor' as NpcId,
      withDescriptor: 'a porter',
      aboutPlayer: true,
      salience: 0.8,
      ground: { kind: 'witness', event: 'turn:1', loc: CAFE },
    };
    const line = recollectionLine(rec, (id) => (id === 'npc:viktor' ? 'Viktor' : 'the cafe'));
    expect(line).toContain('a porter');
    expect(line).not.toContain('Viktor');
  });

  it('does not pick up a proposition learned later the same day', () => {
    const prop: Proposition = {
      id: 'prop:tie',
      subject: 'npc:ada',
      predicate: 'HAS_STATUS',
      object: { kind: 'text', value: 'worried' },
    };
    const start = {
      time: { day: 2, phase: 1 },
      meta: { seed: 'prompt' },
      player: { loc: CAFE },
      city: { locations: {} },
      ambient: ambient({
        tieKnowledge: { 'npc:ada': [prop] },
        promptCache: { day: 2, facts: {} },
      }),
    } as unknown as WorldState;
    expect(promptFactsFor(start, 'npc:ada' as NpcId)).toEqual([]);
    const refreshed = refreshPromptCache(start);
    expect(promptFactsFor(refreshed, 'npc:ada' as NpcId).map((item) => item.proposition.id)).toEqual([
      'prop:tie',
    ]);
    const later = {
      ...refreshed,
      ambient: {
        ...refreshed.ambient!,
        tieKnowledge: {},
      },
    } as WorldState;
    expect(promptFactsFor(later, 'npc:ada' as NpcId).map((item) => item.proposition.id)).toEqual([
      'prop:tie',
    ]);
  });

  it('names a public event and prints the incident fact line with the action', () => {
    const start = {
      time: { day: 1, phase: 1 },
      player: { loc: CAFE, readDocuments: [] },
      city: {
        locations: {
          [CAFE]: { id: CAFE, name: 'Cafe', description: 'A room.', atmosphere: [], risk: 0, type: 'cafe' },
        },
      },
      npcs: {},
      whereabouts: {},
      ambient: ambient({
        events: {
          'evt:fair': { name: 'Harvest fair', start: 0, end: 3, public: true },
          'evt:raid': { name: 'The raid', public: false },
        },
        incidentLog: [{ loc: CAFE, phase: 1, factLine: 'A cart has spilled in the street.' }],
      }),
    } as unknown as WorldState;
    const scene = ambientScene(start, CAFE);
    expect(scene?.events).toEqual(['Harvest fair']);
    expect(scene?.incidents).toEqual(['A cart has spilled in the street.']);
    const resolved = resolve(start, { kind: 'wait', phases: 1 }, createPrng('wait'), {
      content: {},
    } as ResolverContext);
    expect(resolved.result.factLines).toContain('A cart has spilled in the street.');
    expect(resolved.result.scene.ambient?.events).toEqual(['Harvest fair']);
  });
});
