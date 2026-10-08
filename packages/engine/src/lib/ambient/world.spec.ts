/**
 * Metrics, calendar, overlays, event selection and local incidents.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Location, Route } from '../city/city.js';
import type { WorldState } from '../model/state.js';
import { travelCost } from '../city/city.js';
import { createPrng } from '../prng/prng.js';

import { ambientBudgets } from './budgets.js';
import { calendarDate, calendarDay, seasonForMonth } from './calendar.js';
import {
  applyStageOps,
  electionDelta,
  selectEvents,
  type SchedulableEvent,
} from './events.js';
import { selectIncidents } from './incidents.js';
import {
  activateDormant,
  announceLocation,
  effectiveLocation,
  effectiveRoutes,
  learnAnnouncedStatus,
  observeLocation,
  raidDrop,
  rememberStatus,
  removeOverlaysFrom,
  serviceDrop,
  type Overlay,
} from './locations.js';
import { applyMetricDelta, applyPlayerDelta, decayMetrics, metricTotal } from './metrics.js';
import type { Metrics } from './state.js';

const zero = (): Metrics => ({
  exo: { unrest: 0.2, police: 0.3, shortage: 0.2, tension: 0.3, festivity: 0.1 },
  react: { unrest: 0, police: 0, shortage: 0, tension: 0, festivity: 0 },
});

const cafe = {
  id: 'loc:cafe',
  name: 'Cafe',
  aliases: [],
  type: 'cafe',
  district: 'dist:centre',
  public: true,
  description: 'A cafe.',
  atmosphere: [],
  hours: { 0: true, 1: true, 2: true, 3: true },
  risk: 0.2,
  deadDropSites: [],
} as unknown as Location;

function event(id: string, overrides: Partial<SchedulableEvent> = {}): SchedulableEvent {
  return {
    id,
    category: 'labour',
    class: 'exogenous',
    weight: 1,
    cooldownDays: 0,
    exclusive: [],
    name: id,
    durationDays: [2, 2],
    ...overrides,
  };
}

describe('city metrics and calendar', () => {
  it('clamps the total and decays each component toward its rest', () => {
    const high: Metrics = {
      exo: { ...zero().exo, unrest: 0.9 },
      react: { ...zero().react, unrest: 0.4 },
    };
    expect(metricTotal(high, 'unrest')).toBe(1);
    const decayed = decayMetrics(high, [{ id: 'unrest', baseline: 0.2, decay: 0.1 }]);
    expect(decayed.exo.unrest).toBeCloseTo(0.8);
    expect(decayed.react.unrest).toBeCloseTo(0.3);
    const exo = applyMetricDelta(zero(), 'police', 0.1, 'exo');
    expect(exo.exo.police).toBeCloseTo(0.4);
    expect(exo.react.police).toBe(0);
    const player = applyPlayerDelta(zero(), 'police', 0.1);
    expect(player.react.police).toBeCloseTo(0.1);
    expect(player.exo.police).toBeCloseTo(0.3);
  });

  it('maps days onto the start date, the season and a holiday', () => {
    expect(calendarDate('1948-01-01', 0)).toBe('1948-01-01');
    expect(seasonForMonth(1)).toBe('winter');
    expect(seasonForMonth(5)).toBe('spring');
    const may = calendarDay('1948-01-01', 121, [{ id: 'labour-day', month: 5, day: 1 }]);
    expect(may.date).toBe('1948-05-01');
    expect(may.season).toBe('spring');
    expect(may.holidays).toEqual(['labour-day']);
  });
});

describe('overlays', () => {
  const t = { day: 1, phase: 1 as const };

  it('closes a location and restores it when the event ends', () => {
    const overlay: Overlay = {
      id: 'ov-1',
      source: 'evt:strike-1',
      target: 'loc:cafe',
      fromDay: 1,
      toDay: 4,
      effect: { kind: 'location-status', status: 'closed-temporarily' },
    };
    const closed = effectiveLocation(cafe, [overlay], t);
    expect(closed.status).toBe('closed-temporarily');
    expect(closed.location.hours[1]).toBe(false);
    const restored = effectiveLocation(cafe, removeOverlaysFrom([overlay], 'evt:strike-1'), t);
    expect(restored.location.hours).toEqual(cafe.hours);
    expect(restored.status).toBe('open');
  });

  it('turns a disconnecting closure into a checkpoint and keeps travel finite', () => {
    const routes: Route[] = [
      { a: 'dist:a' as Route['a'], b: 'dist:b' as Route['b'], cost: 1 },
    ];
    const closure: Overlay = {
      id: 'ov-route',
      source: 'evt:border-1',
      target: 'dist:a|dist:b',
      fromDay: 0,
      toDay: 3,
      effect: { kind: 'route-closure' },
    };
    const effective = effectiveRoutes(routes, [closure], t);
    expect(effective).toHaveLength(1);
    expect(effective[0]?.checkpoint).toEqual({ detection: 0.5, coverRisk: 0.1 });
    const city = {
      locations: {
        'loc:a': { ...cafe, id: 'loc:a', district: 'dist:a' },
        'loc:b': { ...cafe, id: 'loc:b', district: 'dist:b' },
      },
      districts: { 'dist:a': { id: 'dist:a' }, 'dist:b': { id: 'dist:b' } },
      routes,
      displayName: 'City',
      crowdModels: {},
      startMonth: 1,
    };
    expect(
      travelCost(city as unknown as Parameters<typeof travelCost>[0], 'loc:a' as Location['id'], 'loc:b' as Location['id'], false, effective),
    ).toBe(1);
  });

  it('activates a dormant place, raids a drop and remembers a status', () => {
    expect(activateDormant(['loc:yard'], 'loc:yard').activated).toBe(true);
    expect(announceLocation(['loc:cafe'], 'loc:yard', true)).toEqual(['loc:cafe', 'loc:yard']);
    expect(announceLocation(['loc:cafe'], 'loc:yard', false)).toEqual(['loc:cafe']);
    const raided = raidDrop({ id: 'drop:1', unavailable: false, pendingDisturbance: false, playerItems: ['item:film'] });
    expect(raided.event).toBe('drop-raided');
    expect(raided.seized).toEqual(['item:film']);
    expect(serviceDrop(raided.drop).event).toBe('drop-disturbed');
    expect(rememberStatus({}, 'loc:cafe', 'raided')['loc:cafe']).toBe('raided');
  });
});

describe('event selection and incidents', () => {
  const budget = ambientBudgets('standard');

  it('keeps exogenous draws independent of the reactive component', () => {
    // Feature: ambient-world, Property 4: Exogenous calendar independence
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (react) => {
        const templates = [event('strike', { when: { metrics: { unrest: '>=0.1' } } })];
        const base = zero();
        const other: Metrics = { ...base, react: { ...base.react, unrest: react } };
        const left = selectEvents({
          day: 3,
          season: 'spring',
          weather: new Set(),
          metrics: base,
          active: [],
          history: {},
          templates,
          triggers: [],
          budget,
          eventDensity: 1,
          rng: createPrng('exo'),
        });
        const right = selectEvents({
          day: 3,
          season: 'spring',
          weather: new Set(),
          metrics: other,
          active: [],
          history: {},
          templates,
          triggers: [],
          budget,
          eventDensity: 1,
          rng: createPrng('exo'),
        });
        expect(left.map((item) => item.templateId)).toEqual(right.map((item) => item.templateId));
        expect(left.every((item) => item.class === 'exogenous')).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('skips a template on cooldown or sharing an exclusion tag', () => {
    // Feature: ambient-world, Property 7: Cooldown and exclusion
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (day) => {
        const cooling = event('cooling', { cooldownDays: 10 });
        const grouped = event('grouped', { exclusive: ['labour-major'] });
        const picked = selectEvents({
          day,
          season: 'spring',
          weather: new Set(),
          metrics: zero(),
          active: [{ templateId: 'other', exclusive: ['labour-major'], class: 'exogenous' }],
          history: { cooling: [0] },
          templates: [cooling, grouped, event('open')],
          triggers: [],
          budget,
          eventDensity: 1,
          rng: createPrng(`cool-${day}`),
        });
        const ids = picked.map((item) => item.templateId);
        expect(ids).not.toContain('cooling');
        expect(ids).not.toContain('grouped');
      }),
      { numRuns: 100 },
    );
  });

  it('restores a location after its overlays leave', () => {
    // Feature: ambient-world, Property 8: Overlay reversibility
    fc.assert(
      fc.property(
        fc.constantFrom(
          'closed-temporarily',
          'raided',
          'requisitioned',
          'under-renovation',
          'closed-permanently',
        ),
        (status) => {
          const overlay: Overlay = {
            id: 'ov',
            source: 'evt:one',
            target: cafe.id,
            fromDay: 0,
            toDay: 5,
            effect: { kind: 'location-status', status },
          };
          const during = effectiveLocation(cafe, [overlay], { day: 1, phase: 0 });
          expect(during.location.hours[0]).toBe(false);
          const after = effectiveLocation(cafe, removeOverlaysFrom([overlay], overlay.source), {
            day: 1,
            phase: 0,
          });
          expect(after.location).toEqual(cafe);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('never increases the number of route components', () => {
    // Feature: ambient-world, Property 9: Effective location soundness
    const routes: Route[] = [
      { a: 'dist:a' as Route['a'], b: 'dist:b' as Route['b'], cost: 1 },
      { a: 'dist:b' as Route['a'], b: 'dist:c' as Route['b'], cost: 1 },
    ];
    fc.assert(
      fc.property(fc.constantFrom('dist:a|dist:b', 'dist:b|dist:c'), (target) => {
        const overlay: Overlay = {
          id: 'ov',
          source: 'evt:border',
          target,
          fromDay: 0,
          toDay: 2,
          effect: { kind: 'route-closure' },
        };
        const effective = effectiveRoutes(routes, [overlay], { day: 0, phase: 0 });
        expect(effective.length).toBeGreaterThan(0);
        const open = effectiveLocation(cafe, [], { day: 0, phase: 0 });
        expect(open.location).toEqual(cafe);
        expect(open.status).toBe('open');
      }),
      { numRuns: 100 },
    );
  });

  it('draws a hidden incident inside the cap and an election delta', () => {
    const incidents = selectIncidents({
      sites: [
        { id: 'loc:cafe', tags: ['function:cafe'] },
        { id: 'loc:park', tags: ['function:park'] },
      ],
      phase: 'morning',
      templates: [
        { id: 'stir', locQuery: ['function:cafe'], phases: ['morning'], factLine: 'A stir.' },
      ],
      cap: 1,
      rng: createPrng('local'),
    });
    expect(incidents.length).toBeLessThanOrEqual(1);
    for (const incident of incidents) {
      expect(incident.visibility).toBe('hidden');
      expect(incident.loc).toBe('loc:cafe');
    }
    const first = electionDelta(createPrng('poll'));
    const second = electionDelta(createPrng('poll'));
    expect(second).toEqual(first);
    expect(Math.abs(first.unrest)).toBeCloseTo(0.05);
  });

  it('writes an exogenous delta and skips a rejected closure', () => {
    const applied = applyStageOps({
      eventId: 'evt:strike-3',
      day: 3,
      className: 'exogenous',
      metrics: zero(),
      overlays: [],
      ops: [
        { op: 'metric-delta', metric: 'unrest', delta: 0.1 },
        { op: 'route-closure', target: 'district:a|district:b', days: 2 },
        { op: 'ambient-hook', hook: 'delay-stage' },
      ],
      admit: (op) => (op.op === 'route-closure' ? 'reject' : 'accept'),
    });
    expect(applied.metrics.exo.unrest).toBeCloseTo(0.3);
    expect(applied.overlays).toEqual([]);
    expect(applied.pending).toEqual(['rejected:route-closure', 'ambient-hook']);
  });
});

describe('learned location status', () => {
  function world(): WorldState {
    return {
      time: { day: 2, phase: 1 },
      city: { locations: { 'loc:cafe': cafe } },
      ambient: {
        overlays: [
          {
            id: 'ov:1',
            source: 'evt:raid',
            target: 'loc:cafe',
            fromDay: 0,
            toDay: 9,
            effect: { kind: 'location-status', status: 'raided' },
          },
        ],
        lastKnownStatus: { 'loc:cafe': 'open' },
      },
    } as unknown as WorldState;
  }

  it('keeps a previously learned status until the player sees the place', () => {
    const start = world();
    expect(start.ambient?.lastKnownStatus?.['loc:cafe']).toBe('open');
    const seen = observeLocation(start, 'loc:cafe' as Location['id']);
    expect(seen.ambient?.lastKnownStatus?.['loc:cafe']).toBe('raided');
  });

  it('learns a status a notice names, and ignores a text that names none', () => {
    const start = world();
    const same = learnAnnouncedStatus(start, 'The office is quiet.');
    expect(same).toBe(start);
    const learned = learnAnnouncedStatus(start, 'The Cafe is closed temporarily.');
    expect(learned.ambient?.lastKnownStatus?.['loc:cafe']).toBe('closed-temporarily');
  });
});
