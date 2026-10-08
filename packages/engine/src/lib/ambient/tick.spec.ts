import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { asTruth, revealTruth, type LocId, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';

import { applyHook } from './hooks.js';
import { setAmbientMetricsSink, type AmbientTimingRecord } from './metrics-log.js';
import type { AmbientState, Metrics } from './state.js';
import { stepThreads } from './threads.js';
import { threadCatalogue } from './thread-catalogue.js';
import { ambientDayBoundary, ambientPhase, ambientTurn } from './tick.js';

const METRIC: Metrics = {
  exo: { unrest: 0.2, police: 0.3, shortage: 0.2, tension: 0.3, festivity: 0.1 },
  react: { unrest: 0, police: 0, shortage: 0, tension: 0, festivity: 0 },
};

function world(ambient: boolean): WorldState {
  const state: AmbientState = {
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
    ambientDelayDays: 1,
    coverDeltaToday: { pos: 0.02, neg: 0 },
    channelOutages: [],
    informantReports: [],
    detectionBonuses: {},
    gate: { solvable: ['a'], anchors: ['a'], slowRunsToday: 4 },
    counters: { starts: 0, incidents: 0, lifeEvents: 0, gossip: 0, promotions: 0, threads: 0 },
  };
  return {
    time: { day: 1, phase: 0 },
    meta: { preset: { id: 'standard' }, seed: 'tick' },
    plot: {
      status: 'running',
      abortPressure: 3,
      stages: [
        {
          id: 'meet',
          deadline: { day: 4, phase: 0 },
          traces: [{ place: { kind: 'loc', loc: 'loc:cafe' as LocId } }],
        },
      ],
    },
    player: { coverSuspicion: asTruth(0.1) },
    hostile: { beliefs: { compromisedChannels: [], adopted: [] } },
    city: { locations: { 'loc:cafe': { type: 'cafe' }, 'loc:bar': { type: 'cafe' } } },
    channels: {},
    ...(ambient ? { ambient: state } : {}),
  } as unknown as WorldState;
}

describe('ambient tick', () => {
  it('turns a due duty and a starting public event into player events once', () => {
    const start = world(true);
    const primed = {
      ...start,
      city: { locations: {} },
      ambient: {
        ...start.ambient!,
        dutyAlerts: [{ duty: 'office-hours', kind: 'due' as const, day: 1, phase: 0 }],
        events: { 'evt:fair': { name: 'Harvest fair', start: 1, public: true } },
      },
    } as unknown as WorldState;
    const first = ambientPhase(primed);
    expect(first.events.map((event) => event.kind)).toEqual(['cover-duty-due', 'public-announcement']);
    const second = ambientPhase(first.state);
    expect(second.events.map((event) => event.kind)).toEqual([]);
  });

  it('announces a catalogue holiday on its calendar date', () => {
    const start = world(true);
    const may = { ...start, time: { day: 121, phase: 0 } } as WorldState;
    const result = ambientPhase(may);
    const named = result.events.find(
      (event) => event.kind === 'public-announcement' && 'text' in event && event.text === 'Labour day',
    );
    expect(named?.visibility).toBe('player');
    const again = ambientPhase(result.state);
    expect(
      again.events.some(
        (event) => event.kind === 'public-announcement' && 'text' in event && event.text === 'Labour day',
      ),
    ).toBe(false);
  });

  it('logs at most one incident per location and phase', () => {
    let state = world(true);
    for (let i = 0; i < 6; i += 1) {
      state = ambientPhase(state).state;
    }
    const perSite = new Map<string, number>();
    for (const incident of state.ambient?.incidentLog ?? []) {
      const key = `${incident.loc}|${incident.phase}`;
      perSite.set(key, (perSite.get(key) ?? 0) + 1);
    }
    for (const count of perSite.values()) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  it('records day and phase timings for the metrics log', () => {
    const records: AmbientTimingRecord[] = [];
    setAmbientMetricsSink({ append: (record) => records.push(record) });
    try {
      ambientDayBoundary(world(true));
      ambientPhase(world(true));
    } finally {
      setAmbientMetricsSink(undefined);
    }
    expect(records.map((record) => record.purpose)).toEqual(['ambient-day', 'ambient-phase']);
    expect(records[0]?.steps.events).toEqual(expect.any(Number));
    expect(records[1]?.steps.incidents).toEqual(expect.any(Number));
    expect(records[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('does not record timings when the scenario disables metrics', () => {
    const records: AmbientTimingRecord[] = [];
    setAmbientMetricsSink({ append: (record) => records.push(record) });
    try {
      const start = world(true);
      const disabled = {
        ...start,
        meta: { ...start.meta, scenario: { metrics: { enabled: false, path: 'logs/metrics.jsonl' } } },
      } as WorldState;
      ambientDayBoundary(disabled);
      ambientPhase(disabled);
    } finally {
      setAmbientMetricsSink(undefined);
    }
    expect(records).toEqual([]);
  });

  it('skips the day, phase and turn when ambient is off', () => {
    const quiet = world(false);
    expect(ambientDayBoundary(quiet).state).toBe(quiet);
    expect(ambientPhase(quiet).state).toBe(quiet);
    expect(ambientTurn(quiet)).toBe(quiet);
  });

  it('resets the daily cover and gate counters without touching the plot', () => {
    const start = world(true);
    const result = ambientDayBoundary(start);
    expect(result.state.plot).toEqual(start.plot);
    expect(result.state.hostile).toEqual(start.hostile);
    expect(result.state.ambient?.coverDeltaToday).toEqual({ pos: 0, neg: 0 });
    expect(result.state.ambient?.gate.slowRunsToday).toBe(0);
    expect(result.state.ambient?.ambientDelayDays).toBe(1);
    expect(result.events.map((event) => event.kind)).toEqual(['public-announcement']);
    expect(result.state.ambient?.counters.starts).toBe(1);
    expect(Object.keys(result.state.ambient?.events ?? {})).toHaveLength(1);
    expect(result.state.ambient?.metrics.exo).not.toEqual(METRIC.exo);
  });

  it('spawns one emergent thread when unrest crosses a midgame threshold', () => {
    const start = world(true);
    const heated = {
      ...start,
      npcs: { 'npc:clerk': { id: 'npc:clerk', role: 'civilian', archetype: 'cafe-waiter' } },
      ambient: {
        ...start.ambient!,
        metrics: {
          ...METRIC,
          exo: { ...METRIC.exo, unrest: 0.3 },
        },
      },
    } as unknown as WorldState;
    const catalogue = threadCatalogue(heated);
    expect(catalogue?.templates.size).toBeGreaterThanOrEqual(10);
    const spawned = stepThreads(heated, catalogue);
    expect(spawned.sideThreads).toHaveLength(1);
    expect(spawned.sideThreads?.[0]?.origin).toBe('emergent');
    expect(spawned.ambient?.counters.threads).toBe(1);
    expect(stepThreads(spawned, threadCatalogue(spawned)).sideThreads).toHaveLength(1);
  });
});

function person(id: NpcId, role: string, org: string) {
  return {
    id,
    archetype: 'role:contact',
    role,
    org,
    trueAllegiance: asTruth('cell'),
    apparentAllegiance: 'neutral',
    mice: asTruth({ money: 0.4, ideology: 0.4, coercion: 0.4, ego: 0.4 }),
    moneyNeed: asTruth(0.4),
    schedule: { entries: [] },
  };
}

describe('Property 11: Plot truth confinement', () => {
  // Feature: ambient-world, Property 11: Plot truth confinement
  it('a day tick changes the plot only through hooks already in the ledger', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 1, max: 1_000_000 }), (delays, salt) => {
        const boss = 'npc:boss' as NpcId;
        const clerk = 'npc:clerk' as NpcId;
        let current = world(true);
        current = {
          ...current,
          meta: { ...current.meta, seed: `tick-${salt}` },
          plot: {
            ...current.plot,
            leader: asTruth(boss),
            roles: [{ npc: boss, role: 'leader' }],
          },
          npcs: {
            [boss]: person(boss, 'cell', 'org:cell'),
            [clerk]: person(clerk, 'contact', 'org:station'),
          },
          orgs: {
            'org:cell': { id: 'org:cell', name: 'Cell', kind: 'cell', allegiance: 'cell' },
            'org:station': { id: 'org:station', name: 'Station', kind: 'station', allegiance: 'station' },
          },
        } as unknown as WorldState;
        for (let i = 0; i < delays; i += 1) {
          current = applyHook(current, { kind: 'delay-stage', stage: 'meet', days: 1 }).next;
        }
        const before = revealTruth(current.ambient?.hookLedger ?? asTruth([])) as { kind?: string }[];
        const ticked = ambientDayBoundary(current).state;
        const after = revealTruth(ticked.ambient?.hookLedger ?? asTruth([])) as { kind?: string }[];
        const added = after.slice(before.length);
        const plotHook = added.some(
          (entry) => entry.kind === 'delay-stage' || entry.kind === 'reroute-location',
        );
        if (plotHook) {
          expect(ticked.plot.stages).not.toEqual(current.plot.stages);
        } else {
          expect(ticked.plot.stages).toEqual(current.plot.stages);
        }
        expect(ticked.hostile).toEqual(current.hostile);
        expect(ticked.plot.status).toBe('running');
        expect(ticked.plot.abortPressure).toBe(current.plot.abortPressure);
        expect(ticked.plot.roles).toEqual(current.plot.roles);
        expect(ticked.ambient?.ambientDelayDays).toBeLessThanOrEqual(2);
        expect(ticked.ambient?.life[boss]?.removed).toBeUndefined();
        for (const id of [boss, clerk]) {
          expect(revealTruth(ticked.npcs[id]!.trueAllegiance)).toBe('cell');
          expect(ticked.npcs[id]?.apparentAllegiance).toBe('neutral');
          expect(ticked.npcs[id]?.org).toBe(current.npcs[id]?.org);
          expect(ticked.npcs[id]?.role).toBe(current.npcs[id]?.role);
        }
        expect(ticked.orgs).toEqual(current.orgs);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 12: Ambient Cover Suspicion cap', () => {
  // Feature: ambient-world, Property 12: Ambient Cover Suspicion cap
  it('keeps the day inside the positive and negative caps', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { maxLength: 8 }),
        (amounts) => {
          let current = world(true);
          for (const amount of amounts) {
            current = applyHook(current, { kind: 'cover-suspicion-delta', amount }).next;
          }
          const today = current.ambient?.coverDeltaToday;
          expect(today?.pos ?? 0).toBeLessThanOrEqual(0.08 + 1e-9);
          expect(today?.neg ?? 0).toBeLessThanOrEqual(0.08 + 1e-9);
        },
      ),
      { numRuns: 100 },
    );
  });
});
