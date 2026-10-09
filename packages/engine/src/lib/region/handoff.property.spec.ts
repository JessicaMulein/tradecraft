/**
 * Property 11 — handoff semantics (multi-city task 9.4).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { asTruth, type EntityId, type ItemId, type NpcId, type Phase } from '../model/core.js';
import type { PlotState } from '../city/plot.js';
import {
  chooseReroute,
  courierSeized,
  deadlineHolds,
  handoffDeadline,
  handoffTraces,
  recordHandoffDisruption,
  regionalArrest,
  stageReady,
} from './handoff.js';

function plot(): PlotState {
  return {
    template: 'courier',
    status: 'running',
    stages: [],
    roles: [],
    materielSlots: [],
    targetSlots: [],
    materiel: asTruth('item:box' as ItemId),
    leader: asTruth('npc:lead' as NpcId),
    target: asTruth('npc:target' as EntityId),
    abortPressure: 0,
    pressureKeys: [],
    materielSeized: false,
  };
}

describe('Property 11: handoff semantics', () => {
  it('waits for delivery, keeps the transit deadline, and counts each handoff once', () => {
    // Feature: multi-city, Property 11: Handoff semantics
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 1, max: 8 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (day, phase, transit, sameRoute, otherRoute, otherCity) => {
          const producer = { day, phase: phase as Phase };
          const deadline = handoffDeadline(producer, transit);
          expect(deadlineHolds(producer, transit, deadline)).toBe(true);
          expect(stageReady(true, 'preparing')).toBe(false);
          expect(stageReady(true, 'in-transit')).toBe(false);
          expect(stageReady(true, 'delivered')).toBe(true);
          expect(stageReady(false, undefined)).toBe(true);

          const choice = chooseReroute({
            sameRouteDeparture: sameRoute,
            otherRouteOrMode: otherRoute,
            otherCity,
          });
          if (sameRoute) {
            expect(choice).toBe('same-route');
          } else if (otherRoute) {
            expect(choice).toBe('other-route');
          } else if (otherCity) {
            expect(choice).toBe('other-city');
          } else {
            expect(choice).toBe('no-reroute');
          }

          const once = recordHandoffDisruption(plot(), 'handoff:a');
          const again = recordHandoffDisruption(once, 'handoff:a');
          const second = recordHandoffDisruption(again, 'handoff:b');
          expect(again.abortPressure).toBe(1);
          expect(second.abortPressure).toBe(2);

          const traces = handoffTraces({ from: 'city:north', to: 'city:east' });
          expect(traces.map((row) => row.site)).toEqual(['origin', 'carriage', 'destination']);
          expect(regionalArrest('npc:lead', 'npc:lead', ['npc:cell']).end).toBe(true);
          expect(regionalArrest('npc:cell', 'npc:lead', ['npc:cell'])).toEqual({
            end: false,
            pressureKey: 'participant-arrested:npc:cell',
          });
          expect(courierSeized('seizure')).toBe(true);
          expect(courierSeized('pass')).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});
