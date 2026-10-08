import { describe, expect, it } from 'vitest';

import { asTruth, revealTruth, type LocId, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import {
  dailyTickFull,
  INFORMANT_DETECTION_BONUS,
  initialHostileServiceState,
} from '../hostile/hostile.js';
import { detectionProbability } from '../hostile/detection.js';

import { applyHook } from './hooks.js';
import type { AmbientState, Metrics } from './state.js';

const METRIC: Metrics = {
  exo: { unrest: 0, police: 0.3, shortage: 0, tension: 0, festivity: 0 },
  react: { unrest: 0, police: 0, shortage: 0, tension: 0, festivity: 0 },
};

function world(): WorldState {
  const ambient: AmbientState = {
    schema: 1,
    cityId: 'core',
    enabled: true,
    density: 'standard',
    calendar: { startDate: '1948-01-01', holidays: [] },
    metrics: METRIC,
    events: {},
    history: {},
    triggers: [],
    overlays: [],
    dormant: [],
    life: {},
    tieKnowledge: {},
    falseBeliefs: {},
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
    coverStanding: asTruth(0),
    hookLedger: asTruth([]),
    ambientDelayDays: 0,
    coverDeltaToday: { pos: 0, neg: 0 },
    channelOutages: [],
    informantReports: [],
    detectionBonuses: {},
    gate: { solvable: [], anchors: [], slowRunsToday: 0 },
    counters: { starts: 0, incidents: 0, lifeEvents: 0, gossip: 0, promotions: 0, threads: 0 },
  };
  return {
    time: { day: 2, phase: 1 },
    meta: { preset: { id: 'standard' } },
    plot: {
      status: 'running',
      abortPressure: 4,
      stages: [
        {
          id: 'meet',
          deadline: { day: 5, phase: 1 },
          traces: [{ place: { kind: 'loc', loc: 'loc:cafe' as LocId } }],
        },
      ],
    },
    player: { coverSuspicion: asTruth(0.2) },
    hostile: { beliefs: { compromisedChannels: ['chan:kept'] } },
    city: {
      locations: {
        'loc:cafe': { type: 'cafe' },
        'loc:bar': { type: 'cafe' },
        'loc:dock': { type: 'dock' },
      },
    },
    channels: { 'chan:courier': { id: 'chan:courier' }, 'chan:radio': { id: 'chan:radio' } },
    ambient,
  } as unknown as WorldState;
}

describe('applyHook', () => {
  it('delays a stage without raising abort pressure', () => {
    const result = applyHook(world(), { kind: 'delay-stage', stage: 'meet', days: 2 });
    expect(result.applied).toBe(true);
    expect(result.next.plot.stages[0]?.deadline.day).toBe(7);
    expect(result.next.plot.abortPressure).toBe(4);
    expect(result.next.ambient?.ambientDelayDays).toBe(2);
    expect(revealTruth(result.next.ambient?.hookLedger ?? asTruth([]))).toHaveLength(1);
  });

  it('rejects a delay past the cumulative cap and leaves the plot alone', () => {
    const first = applyHook(world(), { kind: 'delay-stage', stage: 'meet', days: 2 });
    const second = applyHook(first.next, { kind: 'delay-stage', stage: 'meet', days: 1 });
    expect(second.applied).toBe(false);
    expect(second.next.plot.stages[0]?.deadline.day).toBe(7);
    expect(second.next.plot.abortPressure).toBe(4);
  });

  it('reroutes to the first other location of the same type', () => {
    const result = applyHook(world(), {
      kind: 'reroute-location',
      stage: 'meet',
      from: 'loc:cafe' as LocId,
    });
    expect(result.applied).toBe(true);
    const place = result.next.plot.stages[0]?.traces[0]?.place;
    expect(place).toEqual({ kind: 'loc', loc: 'loc:bar' });
    expect(result.next.plot.abortPressure).toBe(4);
  });

  it('rejects a reroute when no location shares the type', () => {
    const result = applyHook(world(), {
      kind: 'reroute-location',
      stage: 'meet',
      from: 'loc:dock' as LocId,
    });
    expect(result.applied).toBe(false);
    expect(result.next.plot.abortPressure).toBe(4);
  });

  it('records a channel outage without marking the channel compromised', () => {
    const start = world();
    const result = applyHook(start, {
      kind: 'channel-outage',
      channel: 'chan:radio',
      untilDay: 4,
    });
    expect(result.applied).toBe(true);
    expect(result.next.ambient?.channelOutages).toEqual([
      { channel: 'chan:radio', untilDay: 4, alternate: 'chan:courier' },
    ]);
    expect(result.next.hostile.beliefs.compromisedChannels).toEqual(['chan:kept']);
  });

  it('caps positive and negative cover suspicion separately', () => {
    const up = applyHook(world(), { kind: 'cover-suspicion-delta', amount: 0.05 });
    const capped = applyHook(up.next, { kind: 'cover-suspicion-delta', amount: 0.05 });
    const refused = applyHook(capped.next, { kind: 'cover-suspicion-delta', amount: 0.01 });
    expect(revealTruth(capped.next.player.coverSuspicion)).toBeCloseTo(0.28);
    expect(capped.next.ambient?.coverDeltaToday).toEqual({ pos: 0.08, neg: 0 });
    expect(refused.applied).toBe(false);

    const down = applyHook(capped.next, { kind: 'cover-suspicion-delta', amount: -0.05 });
    expect(down.applied).toBe(true);
    expect(down.next.ambient?.coverDeltaToday.neg).toBeCloseTo(0.05);
    expect(revealTruth(down.next.player.coverSuspicion)).toBeCloseTo(0.23);
  });

  it('hides an informant report and raises police pressure only for a police handler', () => {
    const police = applyHook(world(), {
      kind: 'informant-report',
      informant: 'npc:town-1' as NpcId,
      handler: 'police',
      seenWith: 'npc:asset' as NpcId,
    });
    expect(police.next.ambient?.informantReports[0]?.visibility).toBe('hidden');
    expect(police.next.ambient?.metrics.react.police).toBeCloseTo(0.05);

    const hostile = applyHook(world(), {
      kind: 'informant-report',
      informant: 'npc:town-2' as NpcId,
      handler: 'hostile',
      seenWith: 'npc:asset' as NpcId,
    });
    expect(hostile.next.ambient?.metrics.react.police).toBe(0);
  });

  it('stores a detection bonus for the next check', () => {
    const result = applyHook(world(), {
      kind: 'detection-bonus',
      npc: 'npc:asset' as NpcId,
      bonus: 0.1,
    });
    expect(result.next.ambient?.detectionBonuses['npc:asset']).toBeCloseTo(0.1);
  });

  it('does nothing when ambient is off', () => {
    const quiet = world();
    const bare = { ...quiet, ambient: undefined };
    const result = applyHook(bare, { kind: 'delay-stage', stage: 'meet', days: 1 });
    expect(result.applied).toBe(false);
    expect(result.next.plot.abortPressure).toBe(4);
  });
});

describe('hostile tailing step reads informant reports', () => {
  it('turns a hostile report into a detection bonus and leaves channels alone', () => {
    const state = initialHostileServiceState(createPrng('s'), {
      risk: { min: 0.3, max: 0.6 },
      security: { min: 0.3, max: 0.6 },
      deception: { min: 0.3, max: 0.6 },
    });
    const before = state.beliefs.compromisedChannels;
    const result = dailyTickFull(state, [], { day: 2, phase: 0 }, createPrng('t'), {
      surveil: 0.1,
      meeting: 0.06,
      drop: 0.04,
    }, {
      informantReports: [{ handler: 'hostile', seenWith: 'npc:asset' as NpcId }],
    });
    expect(result.spawnedDetectionBonuses).toEqual([
      { npc: 'npc:asset', bonus: INFORMANT_DETECTION_BONUS },
    ]);
    expect(result.next.beliefs.compromisedChannels).toEqual(before);

    const quiet = dailyTickFull(state, [], { day: 2, phase: 0 }, createPrng('t'), {
      surveil: 0.1,
      meeting: 0.06,
      drop: 0.04,
    });
    expect(quiet.spawnedDetectionBonuses).toEqual([]);
  });

  it('adds a stored bonus on top of the detection probability', () => {
    const state = initialHostileServiceState(createPrng('s'), {
      risk: { min: 0.3, max: 0.6 },
      security: { min: 0.3, max: 0.6 },
      deception: { min: 0.3, max: 0.6 },
    });
    const npc = 'npc:asset' as NpcId;
    const base = { surveil: 0.1, meeting: 0.06, drop: 0.04 };
    const plain = detectionProbability(state.beliefs, npc, state.doctrine, base);
    const boosted = detectionProbability(state.beliefs, npc, state.doctrine, base, 0.1);
    expect(boosted).toBeCloseTo(Math.min(1, plain + 0.1));
  });
});
