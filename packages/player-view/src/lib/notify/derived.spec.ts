/**
 * Unit tests for the derived player-visible events raised from player-side
 * expectations (task 16.6; Requirement 39.5).
 *
 * These drive {@link raiseDerivedEvents} with view-safe expectation inputs and
 * assert the four derived kinds are raised correctly:
 *
 * - a due arranged meeting the other party missed raises `meeting-no-show`;
 * - a player-serviced drop found unserviced raises `drop-unserviced`;
 * - an Asset silent for at least `silenceDays` raises `asset-silent`, and one
 *   below the threshold raises nothing (the consequence is only reported once it
 *   is observable);
 * - a retainer that fell due raises `retainer-due`;
 *
 * and that the raiser reads only its expectation inputs (no hidden Sim state),
 * stamps each event with the right time, and orders the result in event time.
 */

import { describe, expect, it } from 'vitest';

import type { GameTime, Phase } from '@tradecraft/engine';

import { raiseDerivedEvents, type DerivedExpectations } from './derived.js';

function time(day: number, phase: Phase): GameTime {
  return { day, phase };
}

const BASE: DerivedExpectations = { silenceDays: 3 };

describe('raiseDerivedEvents', () => {
  it('raises a meeting-no-show for a due arranged meeting the other party missed', () => {
    const events = raiseDerivedEvents({
      ...BASE,
      meetingNoShows: [{ meeting: 'meeting:npc:ana@loc:cafe#2.1', slot: time(2, 1) }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'meeting-no-show', visibility: 'player', at: time(2, 1) });
  });

  it('raises a drop-unserviced for a player-serviced drop found unserviced', () => {
    const events = raiseDerivedEvents({
      ...BASE,
      unservicedDrops: [{ drop: 'drop:alley', at: time(2, 2) }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'drop-unserviced', drop: 'drop:alley', visibility: 'player' });
  });

  it('raises asset-silent only once the silence reaches the configured period', () => {
    const below = raiseDerivedEvents({
      ...BASE,
      silences: [{ npc: 'npc:ana', days: 2, at: time(5, 0) }],
    });
    expect(below).toEqual([]);

    const atThreshold = raiseDerivedEvents({
      ...BASE,
      silences: [{ npc: 'npc:ana', days: 3, at: time(5, 0) }],
    });
    expect(atThreshold).toHaveLength(1);
    expect(atThreshold[0]).toMatchObject({ kind: 'asset-silent', npc: 'npc:ana', days: 3 });
  });

  it('raises a retainer-due with the amount', () => {
    const events = raiseDerivedEvents({
      ...BASE,
      retainersDue: [{ npc: 'npc:ana', amount: 500, at: time(4, 0) }],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'retainer-due', npc: 'npc:ana', amount: 500, at: time(4, 0) });
  });

  it('raises nothing for empty expectations (a hidden event with no consequence)', () => {
    expect(raiseDerivedEvents(BASE)).toEqual([]);
  });

  it('orders every raised event by event time', () => {
    const events = raiseDerivedEvents({
      ...BASE,
      retainersDue: [{ npc: 'npc:ana', amount: 1, at: time(5, 0) }],
      meetingNoShows: [{ meeting: 'meeting:npc:ana@loc:cafe#2.1', slot: time(2, 1) }],
      unservicedDrops: [{ drop: 'drop:alley', at: time(3, 2) }],
    });
    const days = events.map((e) => e.at.day);
    expect(days).toEqual([...days].sort((a, b) => a - b));
    expect(days).toEqual([2, 3, 5]);
  });
});
