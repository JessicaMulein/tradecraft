/**
 * Tests for Dangle / Walk-in management (task 19.2; Requirements 11.1, 11.2,
 * 22.7).
 *
 * These pin:
 *
 * - `classifyWalkIn` reads the hidden `walk-in-approach` ground-truth
 *   genuineness: a genuine approach is a volunteer, a non-genuine one a Dangle;
 * - `readWalkIns` folds a day's events into the Dangles the service runs and the
 *   genuine volunteers, id-sorted and deduped, ignoring non-walk-in events;
 * - the reading is deterministic (no draws — the daily stream already decided).
 */

import { describe, expect, it } from 'vitest';

import { asTruth, type GameTime, type NpcId } from '../model/core.js';
import type { SimEvent } from '../model/state.js';
import { classifyWalkIn, readWalkIns } from './dangles.js';

const AT: GameTime = { day: 3, phase: 0 };

/** A hidden `walk-in-approach` event for `npc` with the given genuineness. */
function approach(npc: string, genuine: boolean): SimEvent {
  return {
    id: `sched-evt:walk-in-approach:${npc}`,
    at: AT,
    visibility: 'hidden',
    kind: 'walk-in-approach',
    npc: npc as NpcId,
    genuine: asTruth(genuine),
  };
}

/** A player-visible `walk-in` notification (carries no truth). */
function walkIn(npc: string): SimEvent {
  return {
    id: `sched-evt:walk-in:${npc}`,
    at: AT,
    visibility: 'player',
    kind: 'walk-in',
    npc: npc as NpcId,
  };
}

describe('classifyWalkIn', () => {
  it('reads a genuine approach as a genuine volunteer', () => {
    expect(classifyWalkIn({ npc: 'npc:a' as NpcId, genuine: asTruth(true) })).toBe(
      'genuine',
    );
  });

  it('reads a non-genuine approach as a Dangle', () => {
    expect(classifyWalkIn({ npc: 'npc:a' as NpcId, genuine: asTruth(false) })).toBe(
      'dangle',
    );
  });
});

describe('readWalkIns', () => {
  it('partitions a day`s approaches into Dangles and genuine volunteers', () => {
    const reading = readWalkIns([
      approach('npc:dangle-1', false),
      walkIn('npc:dangle-1'),
      approach('npc:genuine-1', true),
      walkIn('npc:genuine-1'),
    ]);
    expect(reading.dangles).toEqual(['npc:dangle-1']);
    expect(reading.genuine).toEqual(['npc:genuine-1']);
  });

  it('returns empty lists when there is no Walk-in', () => {
    const reading = readWalkIns([
      { id: 'e', at: AT, visibility: 'player', kind: 'day-start', weather: { summary: 'cold' } },
    ]);
    expect(reading.dangles).toHaveLength(0);
    expect(reading.genuine).toHaveLength(0);
  });

  it('ignores the player-visible walk-in notification (reads only the approach)', () => {
    // Only the player-visible walk-in, with no hidden approach, classifies nothing.
    const reading = readWalkIns([walkIn('npc:x')]);
    expect(reading.dangles).toHaveLength(0);
    expect(reading.genuine).toHaveLength(0);
  });

  it('id-sorts and dedupes multiple Dangles', () => {
    const reading = readWalkIns([
      approach('npc:c', false),
      approach('npc:a', false),
      approach('npc:a', false),
      approach('npc:b', false),
    ]);
    expect(reading.dangles).toEqual(['npc:a', 'npc:b', 'npc:c']);
  });

  it('is deterministic', () => {
    const events = [approach('npc:a', false), approach('npc:b', true)];
    expect(readWalkIns(events)).toEqual(readWalkIns(events));
  });
});
