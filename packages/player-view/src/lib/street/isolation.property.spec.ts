/**
 * Property 5 (street-ops task 15.2). The street views, the journal and the
 * notifications are built from player-visible facts. Tail truth stays out.
 *
 * **Validates: Requirements 12.3, 13.1**
 */

import {
  compileStreetGraph,
  gridGraph,
  type ActionResult,
  type SimEvent,
  type WorldState,
} from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { Journal } from '../journal/journal.js';
import { journalView } from '../journal/view.js';
import { notify } from '../notify/notify.js';
import type { NotifyView } from '../notify/view.js';
import { streetView } from './map.js';

const FORBIDDEN = [
  'teams',
  'wasLie',
  'thoroughness',
  'vehicleContents',
  'concealment',
  'posture',
  'traces',
  'lag',
  'discipline',
];

function keysOf(value: unknown, found: Set<string>): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, found);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    found.add(key);
    keysOf(child, found);
  }
}

function world(): WorldState {
  return {
    ext: {
      streetOps: {
        knowledge: { 'h-0-0': 'driven', 'j-0-0': 'seen', 'j-1-0': 'seen' },
        mapNames: {},
        seenCheckpoints: [],
        vehicles: [{ id: 'pool', def: 'Pool coupe', plate: 'P-1', knownBurned: false }],
        told: [{ template: 'late-from-the-office', at: { day: 1, phase: 0 } }],
        rides: {},
        session: {
          vehicle: 'pool',
          at: { segment: 'h-0-0', dir: 'fwd', progress: 0.4 },
          speed: 'normal',
          ticks: 2,
          path: [{ segment: 'h-0-0', dir: 'fwd', progress: 0.4 }],
          passengers: [],
        },
      },
    },
    city: { locations: { hub: { name: 'Cafe' } } },
    time: { day: 1, phase: 1, ticksInPhase: 2 },
    player: { loc: 'hub' },
  } as unknown as WorldState;
}

describe('street truth isolation', () => {
  it('keeps tail truth out of the street view, the journal and notifications', () => {
    // Feature: street-ops, Property 5: Tail truth never reaches the view
    const graph = compileStreetGraph(gridGraph(2, 2));
    const state = world();
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), { minLength: 8, maxLength: 12 }).map((chars) => chars.join('')),
        fc.boolean(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (teamId, wasLie, thoroughness) => {
          const sentinel = `tail-secret-${teamId}`;
          const truth = {
            teams: { [sentinel]: { id: sentinel, lag: 2, discipline: thoroughness, wasLie } },
            statements: [{ id: sentinel, wasLie }],
            concealment: { pool: [{ ticksConcealed: thoroughness }] },
            traces: [{ kind: 'navigation-aid', at: { day: 1, phase: 0 } }],
          };
          const view = streetView(state, graph);
          const journal = new Journal();
          journal.recordAction(
            {
              factLines: ['A grey sedan was on Court Lane.'],
              observations: [],
              claimsAdded: [],
            } as unknown as ActionResult,
            { day: 1, phase: 1 },
          );
          const event: SimEvent = {
            id: 'street-alert-1-1',
            at: { day: 1, phase: 1 },
            visibility: 'player',
            kind: 'public-announcement',
            text: 'Police are stopping cars.',
          };
          const notes = notify([event], { npcs: {}, city: { locations: {} }, player: { known: { entities: [], channels: [], drops: [] } }, meetings: {} } as unknown as NotifyView);
          const projected = { view, journal: journalView(journal), notes, truthKeptApart: true };
          const keys = new Set<string>();
          keysOf({ view, journal: projected.journal, notes }, keys);
          for (const forbidden of FORBIDDEN) expect(keys.has(forbidden)).toBe(false);
          const text = JSON.stringify(projected);
          expect(text).not.toContain(sentinel);
          expect(Object.keys(truth.teams)).toContain(sentinel);
        },
      ),
      { numRuns: 100 },
    );
  });
});
