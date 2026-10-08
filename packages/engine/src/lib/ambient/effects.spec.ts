import { describe, expect, it } from 'vitest';

import { asTruth, type LocId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';

import { ambientBudgets } from './budgets.js';
import type { AuthorOp } from './catalogue.js';
import { commitStage } from './effects.js';
import { selectEvents } from './events.js';
import { routeKey } from './locations.js';
import type { RegionGraph } from '../region/verify.js';
import type { AmbientState, Metrics } from './state.js';
import { weatherTagsOf } from './city-step.js';

const METRIC: Metrics = {
  exo: { unrest: 0.2, police: 0.3, shortage: 0.2, tension: 0.3, festivity: 0.1 },
  react: { unrest: 0, police: 0, shortage: 0, tension: 0, festivity: 0 },
};

function ambient(gate?: Partial<AmbientState['gate']>): AmbientState {
  return {
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
    coverStanding: asTruth(0.5),
    hookLedger: asTruth([]),
    ambientDelayDays: 0,
    coverDeltaToday: { pos: 0, neg: 0 },
    channelOutages: [],
    informantReports: [],
    detectionBonuses: {},
    gate: { solvable: ['keep'], anchors: [], slowRunsToday: 0, ...gate },
    counters: { starts: 0, incidents: 0, lifeEvents: 0, gossip: 0, promotions: 0, threads: 0 },
  };
}

function world(gate?: Partial<AmbientState['gate']>): WorldState {
  const clerk = { id: 'npc:clerk', role: 'contact', archetype: 'cafe-waiter' };
  return {
    time: { day: 1, phase: 0 },
    meta: { preset: { id: 'standard' }, seed: 'effects' },
    plot: {
      status: 'running',
      stages: [
        {
          id: 'meet',
          deadline: { day: 4, phase: 0 },
          traces: [{ place: { kind: 'loc', loc: 'loc:bar' as LocId } }],
        },
      ],
      roles: [{ npc: 'npc:boss' }],
    },
    player: { coverSuspicion: asTruth(0.1) },
    npcs: {
      'npc:clerk': clerk,
      'npc:boss': { id: 'npc:boss', role: 'cell', archetype: 'leader' },
    },
    city: {
      startMonth: 1,
      locations: {
        'loc:bar': { id: 'loc:bar', type: 'cafe' },
        'loc:cafe': { id: 'loc:cafe', type: 'cafe' },
        'loc:park': { id: 'loc:park', type: 'park' },
      },
      districts: {
        'district:inner': { id: 'district:inner', sector: 'international' },
        'district:outer': { id: 'district:outer', sector: 'american' },
      },
      routes: [{ a: 'district:inner', b: 'district:outer', cost: 1 }],
    },
    channels: { 'chan:radio': { id: 'chan:radio' } },
    ambient: ambient(gate),
  } as unknown as WorldState;
}

function run(
  state: WorldState,
  op: AuthorOp,
  extra?: { readonly category?: string; readonly stageDay?: number | 'last'; readonly fallback?: AuthorOp },
) {
  return commitStage({
    world: state,
    eventId: 'evt:t',
    className: 'exogenous',
    category: extra?.category ?? 'labour',
    stageDay: extra?.stageDay ?? 0,
    templateId: 'labour-1',
    ops: [op],
    metrics: state.ambient?.metrics ?? METRIC,
    overlays: [],
    ...(extra?.fallback === undefined ? {} : { fallback: extra.fallback }),
  });
}

describe('stage effect ops', () => {
  it('applies a metric delta on the event class component', () => {
    const result = run(world(), { op: 'metric-delta', metric: 'unrest', delta: 0.04 });
    expect(result.world.ambient?.metrics.exo.unrest).toBeCloseTo(0.24);
  });

  it('applies a crowd modifier for one day', () => {
    const result = run(world(), { op: 'crowd-modifier', query: ['function:cafe'], factor: 1.4 });
    expect(result.world.ambient?.overlays[0]?.effect).toEqual({ kind: 'crowd-modifier', factor: 1.4 });
  });

  it('applies an observation modifier', () => {
    const result = run(world(), { op: 'observation-modifier', query: ['function:cafe'], factor: 1.2 });
    expect(result.world.ambient?.overlays[0]?.effect).toEqual({ kind: 'observation-modifier', factor: 1.2 });
  });

  it('applies a detection modifier', () => {
    const result = run(world(), { op: 'detection-modifier', query: ['function:park'], factor: 1.5 });
    expect(result.world.ambient?.overlays[0]?.effect).toEqual({ kind: 'detection-modifier', factor: 1.5 });
    expect(result.world.ambient?.overlays[0]?.target).toBe('loc:park');
  });

  it('applies a city curfew', () => {
    const result = run(world(), { op: 'curfew', phases: ['evening', 'night'] });
    expect(result.world.ambient?.overlays[0]?.effect).toEqual({
      kind: 'curfew',
      phases: ['evening', 'night'],
    });
  });

  it('queues a post-notice', () => {
    const result = run(world(), { op: 'post-notice', template: 'curfew-order', query: ['function:cafe'] });
    expect(result.inbox[0]).toMatchObject({ op: 'post-notice', template: 'curfew-order' });
  });

  it('queues a news development', () => {
    const result = run(world(), { op: 'news-development', story: 'strike', beat: 'announced' });
    expect(result.inbox).toEqual([{ op: 'news-development', story: 'strike', beat: 'announced' }]);
  });

  it('queues a spawn-thread', () => {
    const result = run(world(), { op: 'spawn-thread', tags: ['labour'] });
    expect(result.inbox).toEqual([{ op: 'spawn-thread', tags: ['labour'] }]);
  });

  it('opens a location without asking the gate', () => {
    const start = world({ anchors: ['loc:park'], slowRunsToday: 1 });
    const result = run(start, {
      op: 'location-status',
      query: ['function:park'],
      status: 'newly-opened',
      days: 2,
    });
    expect(result.world.ambient?.overlays[0]?.effect).toEqual({ kind: 'location-status', status: 'newly-opened' });
    expect(result.world.ambient?.gate.slowRunsToday).toBe(1);
  });

  it('closes a location the plot does not anchor', () => {
    const result = run(world(), {
      op: 'location-status',
      query: ['function:park'],
      status: 'closed-temporarily',
      days: 2,
    });
    expect(result.world.ambient?.overlays[0]?.effect).toEqual({
      kind: 'location-status',
      status: 'closed-temporarily',
    });
    expect(result.world.ambient?.gate.slowRunsToday).toBe(0);
  });

  it('rejects an anchored closure and applies the template fallback', () => {
    const start = world({ anchors: ['loc:park'] });
    const result = run(
      start,
      { op: 'location-status', query: ['function:park'], status: 'closed-temporarily', days: 2 },
      { fallback: { op: 'crowd-modifier', query: ['function:cafe'], factor: 0.7 } },
    );
    expect(result.world.ambient?.overlays.map((overlay) => overlay.effect.kind)).toEqual(['crowd-modifier']);
    expect(result.pending[0]).toBe('gate-reject:location-status');
    expect(result.world.ambient?.gate.slowRunsToday).toBe(1);
  });

  it('re-checks an anchored closure against the witnesses stored on the gate', () => {
    const kept = {
      key: 'keep',
      human: { edge: 'meeting' as const, node: 'npc:clerk' },
      signal: { edge: 'surveillance' as const, node: 'loc:cafe' },
    };
    const accepted = run(world({ anchors: ['loc:park'], witnesses: [kept] }), {
      op: 'location-status',
      query: ['function:park'],
      status: 'closed-temporarily',
      days: 2,
    });
    expect(accepted.world.ambient?.overlays[0]?.effect).toMatchObject({ status: 'closed-temporarily' });
    expect(accepted.pending).not.toContain('gate-reject:location-status');
    expect(accepted.world.ambient?.gate.slowRunsToday).toBe(1);

    const rejected = run(
      world({
        anchors: ['loc:park'],
        witnesses: [{ ...kept, signal: { edge: 'surveillance' as const, node: 'loc:park' } }],
      }),
      { op: 'location-status', query: ['function:park'], status: 'closed-temporarily', days: 2 },
    );
    expect(rejected.world.ambient?.overlays).toEqual([]);
    expect(rejected.pending).toContain('gate-reject:location-status');
    expect(rejected.world.ambient?.gate.slowRunsToday).toBe(1);
  });

  it('puts a checkpoint on a route into a tagged sector', () => {
    const result = run(
      world(),
      { op: 'route-checkpoint', query: ['sector:international'], detection: 0.4, coverRisk: 0.2 },
      { category: 'border' },
    );
    expect(result.world.ambient?.overlays[0]).toMatchObject({
      target: routeKey('district:inner', 'district:outer'),
      effect: { kind: 'route-checkpoint', detection: 0.4, coverRisk: 0.2 },
    });
  });

  it('closes a route the plot does not anchor', () => {
    const result = run(world(), { op: 'route-closure', query: ['sector:international'] }, { category: 'border' });
    expect(result.world.ambient?.overlays[0]?.effect).toEqual({ kind: 'route-closure' });
  });

  it('rejects a route closure that touches an anchor', () => {
    const start = world({ anchors: ['district:inner'] });
    const result = run(start, { op: 'route-closure', query: ['sector:international'] });
    expect(result.world.ambient?.overlays).toEqual([]);
    expect(result.pending).toContain('gate-reject:route-closure');
    expect(result.world.ambient?.gate.slowRunsToday).toBe(1);
  });

  it('overrides a civilian schedule', () => {
    const result = run(world(), {
      op: 'npc-schedule-override',
      who: { roleTitle: 'waiter' },
      query: ['function:cafe'],
      phases: ['evening'],
    });
    const deviation = result.world.ambient?.life['npc:clerk']?.deviations[0];
    expect(deviation).toMatchObject({ untilDay: 3, weekday: 1, phase: 2 });
    expect(['loc:bar', 'loc:cafe']).toContain(deviation?.loc);
    expect(result.world.ambient?.life['npc:boss']).toBeUndefined();
  });

  it('does not override a principal', () => {
    const start = world();
    const result = run(start, {
      op: 'npc-schedule-override',
      who: { npc: 'npc:boss' },
      query: ['function:cafe'],
      phases: ['morning'],
    });
    expect(result.world.ambient?.life['npc:boss']).toBeUndefined();
    expect(result.world.ambient?.gate.slowRunsToday).toBe(0);
  });

  it('detains a civilian without changing the npc', () => {
    const start = world();
    const clerk = start.npcs['npc:clerk'];
    const result = run(start, { op: 'detain-npc', who: { npc: 'npc:clerk' }, days: 1 });
    expect(result.world.ambient?.life['npc:clerk']?.removed).toBe('detained');
    expect(result.world.npcs['npc:clerk']).toBe(clerk);
  });

  it('rejects detaining an anchored npc', () => {
    const result = run(world({ anchors: ['npc:clerk'] }), { op: 'detain-npc', who: { npc: 'npc:clerk' }, days: 1 });
    expect(result.world.ambient?.life['npc:clerk']).toBeUndefined();
    expect(result.world.ambient?.gate.slowRunsToday).toBe(1);
  });

  it('does not detain once the daily gate cap is spent', () => {
    const result = run(world({ anchors: ['npc:clerk'], slowRunsToday: 6 }), {
      op: 'detain-npc',
      who: { npc: 'npc:clerk' },
      days: 1,
    });
    expect(result.world.ambient?.life['npc:clerk']).toBeUndefined();
    expect(result.world.ambient?.gate.slowRunsToday).toBe(6);
    expect(result.pending).toContain('gate-reject:detain-npc');
  });

  it('does not detain a principal', () => {
    const result = run(world(), { op: 'detain-npc', who: { npc: 'npc:boss' }, days: 1 });
    expect(result.world.ambient?.life['npc:boss']).toBeUndefined();
    expect(result.world.ambient?.gate.slowRunsToday).toBe(0);
  });

  it('sends cover suspicion through the hook gateway', () => {
    const result = run(world(), { op: 'ambient-hook', hook: 'cover-suspicion-delta', amount: 0.02 });
    expect(result.world.ambient?.coverDeltaToday.pos).toBeCloseTo(0.02);
    expect(result.world.ambient?.hookLedger).toBeDefined();
  });

  it('sends a plot delay through the hook gateway', () => {
    const result = run(world(), { op: 'ambient-hook', hook: 'delay-stage', days: 1 });
    expect(result.world.plot.stages[0]?.deadline.day).toBe(5);
  });

  it('sends a reroute through the hook gateway', () => {
    const result = run(world(), { op: 'ambient-hook', hook: 'reroute-location' });
    const place = result.world.plot.stages[0]?.traces[0]?.place;
    expect(place).toMatchObject({ kind: 'loc', loc: 'loc:cafe' });
  });

  it('sends a channel outage through the hook gateway when it misses every anchor', () => {
    const result = run(world(), { op: 'ambient-hook', hook: 'channel-outage', days: 1 });
    expect(result.world.ambient?.channelOutages[0]).toMatchObject({ channel: 'chan:radio', untilDay: 2 });
  });

  it('rejects a channel outage that touches an anchor', () => {
    const result = run(world({ anchors: ['chan:radio'] }), { op: 'ambient-hook', hook: 'channel-outage', days: 1 });
    expect(result.world.ambient?.channelOutages).toEqual([]);
    expect(result.pending).toContain('gate-reject:channel-outage');
  });

  it('sends an informant report through the hook gateway', () => {
    const result = run(world(), { op: 'ambient-hook', hook: 'informant-report' });
    expect(result.world.ambient?.informantReports[0]).toMatchObject({
      informant: 'npc:boss',
      handler: 'police',
    });
  });

  it('re-checks an anchored closure against the regional verifier', () => {
    const region: RegionGraph = {
      papers: [],
      obtainablePapers: [],
      knownLocs: ['loc:cafe', 'loc:park'],
      targets: [
        {
          key: 'keep',
          paths: [
            { role: 'human', edge: 'meeting', node: 'npc:clerk' },
            { role: 'signal', edge: 'surveillance', node: 'loc:park' },
            { role: 'signal', edge: 'surveillance', node: 'loc:cafe' },
          ],
        },
      ],
      jurisdiction: [{ city: 'city:home', permitsArrest: true }],
      success: ['arrest'],
      handoffAt: [],
      abortRoutes: [],
    };
    const start = world({ anchors: ['loc:park'] });
    const armed = {
      ...start,
      ambient: { ...start.ambient, multiCity: true as const, region },
    } as WorldState;
    const accepted = run(armed, {
      op: 'location-status',
      query: ['function:park'],
      status: 'closed-temporarily',
      days: 2,
    });
    expect(accepted.world.ambient?.overlays[0]?.effect).toMatchObject({ status: 'closed-temporarily' });
    expect(accepted.pending).not.toContain('gate-reject:location-status');
    expect(accepted.world.ambient?.gate.slowRunsToday).toBe(1);
    expect(accepted.world.ambient?.region?.targets[0]?.paths.some((path) => path.node === 'loc:park')).toBe(false);

    const onlyPark: RegionGraph = {
      ...region,
      targets: [
        {
          key: 'keep',
          paths: [
            { role: 'human', edge: 'meeting', node: 'npc:clerk' },
            { role: 'signal', edge: 'surveillance', node: 'loc:park' },
          ],
        },
      ],
    };
    const rejected = run(
      { ...start, ambient: { ...start.ambient, multiCity: true as const, region: onlyPark } } as WorldState,
      { op: 'location-status', query: ['function:park'], status: 'closed-temporarily', days: 2 },
    );
    expect(rejected.world.ambient?.overlays).toEqual([]);
    expect(rejected.pending).toContain('gate-reject:location-status');
    expect(rejected.world.ambient?.region?.targets[0]?.paths.some((path) => path.node === 'loc:park')).toBe(true);
  });

  it('sends a detection bonus through the hook gateway', () => {
    const result = run(world(), { op: 'ambient-hook', hook: 'detection-bonus', amount: 0.1 });
    expect(result.world.ambient?.detectionBonuses['npc:boss']).toBeCloseTo(0.1);
  });

  it('draws an election result onto unrest', () => {
    const result = run(world(), { op: 'metric-delta', metric: 'tension', delta: 0.01 }, {
      category: 'election',
      stageDay: 'last',
    });
    const delta = (result.world.ambient?.metrics.exo.unrest ?? 0) - METRIC.exo.unrest;
    expect(Math.abs(Math.abs(delta) - 0.05)).toBeLessThan(1e-9);
    expect(result.election).toBe(delta > 0 ? 'opposition' : 'government');
  });

  it('requires the day weather before a weather event can start', () => {
    const tags = weatherTagsOf(world());
    expect(tags.size).toBeGreaterThan(0);
    const missed = [...tags][0] === 'rain' ? 'snow' : 'rain';
    const template = {
      id: 'weather-x',
      category: 'weather',
      class: 'exogenous' as const,
      weight: 5,
      cooldownDays: 0,
      exclusive: [],
      name: 'Storm',
      durationDays: [2, 2] as const,
    };
    const args = {
      day: 1,
      season: 'winter',
      metrics: METRIC,
      active: [],
      history: {},
      triggers: [],
      budget: ambientBudgets('standard'),
      eventDensity: 1,
      rng: createPrng('weather'),
    };
    expect(
      selectEvents({ ...args, weather: tags, templates: [{ ...template, when: { weather: [missed] } }] }),
    ).toEqual([]);
    expect(
      selectEvents({
        ...args,
        weather: tags,
        rng: createPrng('weather'),
        templates: [{ ...template, when: { weather: [...tags] } }],
      }).map((event) => event.templateId),
    ).toEqual(['weather-x']);
  });
});
