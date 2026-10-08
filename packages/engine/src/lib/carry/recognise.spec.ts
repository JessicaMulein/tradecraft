/**
 * The recogniser hook and the "seen before" Fact Line (task 8.7;
 * Requirements 12.6, 13.3, 13.4).
 */

import { describe, expect, it } from 'vitest';

import { asTruth, revealTruth, type GameTime, type LocId, type NpcId } from '../model/core.js';
import { isPlayerVisibleKind, type SimEvent, type WorldState } from '../model/state.js';
import { createPrng, type Prng } from '../prng/prng.js';
import { MADE_FACT_LINE } from '../action/surveil.js';
import {
  applyRecogniserPass,
  queueCarryLines,
  seenBeforeFactLine,
  takeCarryLines,
} from './recognise.js';
import type { CarryState } from './types.js';

const AT: GameTime = { day: 4, phase: 1 };
const LOC = 'loc:cafe' as LocId;
const FACE = 'npc:cp-1' as NpcId;
const WATCHER = 'npc:cp-9' as NpcId;

function carry(over: Partial<CarryState> = {}): CarryState {
  return {
    placements: [],
    recognisers: [WATCHER],
    unk: {
      'face-1': {
        unk: 'unk:1',
        npc: FACE,
        sightings: [{ city: 'Lisbon', year: 1949 }],
      },
    },
    patternDetection: {},
    requisitions: [],
    dropped: [],
    legendOfficial: true,
    recogniserSuspicion: 0.15,
    seen: [],
    pendingLines: [],
    ...over,
  };
}

function world(options: { carry?: CarryState; reveal?: number; suspicion?: number } = {}): WorldState {
  return {
    player: { coverSuspicion: asTruth(options.suspicion ?? 0.2) },
    meta: { preset: { madeRevealProbability: options.reveal ?? 0 } },
    ...(options.carry === undefined ? {} : { carry: asTruth(options.carry) }),
  } as unknown as WorldState;
}

function drawn(seed: string, times: number): Prng {
  const rng = createPrng(seed);
  for (let i = 0; i < times; i += 1) {
    rng.next();
  }
  return rng;
}

describe('applyRecogniserPass', () => {
  it('draws nothing and returns the same state when the world has no carry', () => {
    const state = world();
    const rng = createPrng('recognise');
    const before = rng.state();
    const pass = applyRecogniserPass(state, rng, 1, [WATCHER], [FACE], AT, LOC);
    expect(pass.next).toBe(state);
    expect(pass.events).toEqual([]);
    expect(pass.made).toBe(false);
    expect(pass.seenBefore).toEqual([]);
    expect(rng.state()).toEqual(before);
  });

  it('adds recogniser suspicion and a hidden event, and no recognition line', () => {
    const state = world({ carry: carry(), reveal: 0 });
    const rng = createPrng('hit');
    const pass = applyRecogniserPass(state, rng, 1, [WATCHER], [], AT, LOC);
    expect(revealTruth(pass.next.player.coverSuspicion)).toBeCloseTo(0.35);
    expect(pass.events).toHaveLength(1);
    const event = pass.events[0] as SimEvent;
    expect(event.kind).toBe('officer-recognised');
    expect(event.visibility).toBe('hidden');
    expect(isPlayerVisibleKind(event.kind)).toBe(false);
    expect(pass.made).toBe(false);
    expect(pass.seenBefore).toEqual([]);
    expect(rng.state()).toEqual(drawn('hit', 2).state());
  });

  it('shows only the ordinary made line when the reveal coin lands', () => {
    const state = world({ carry: carry(), reveal: 1 });
    const pass = applyRecogniserPass(state, createPrng('reveal'), 1, [WATCHER], [], AT, LOC);
    expect(pass.made).toBe(true);
    expect(pass.seenBefore.join(' ')).not.toContain('recognised');
    expect(MADE_FACT_LINE).not.toContain('recognised');
  });

  it('draws one coin and no reveal coin when the detection misses', () => {
    const state = world({ carry: carry(), reveal: 1 });
    const rng = createPrng('miss');
    const pass = applyRecogniserPass(state, rng, 0, [WATCHER], [], AT, LOC);
    expect(pass.events).toEqual([]);
    expect(pass.made).toBe(false);
    expect(pass.next).toBe(state);
    expect(rng.state()).toEqual(drawn('miss', 1).state());
  });

  it('appends the seen-before line once, and never for a face with no pre-allocation', () => {
    const state = world({ carry: carry() });
    const stranger = 'npc:cp-50' as NpcId;
    const first = applyRecogniserPass(state, createPrng('seen'), 0, [], [FACE, stranger], AT, LOC);
    expect(first.seenBefore).toEqual(['You have seen this face before: Lisbon, 1949.']);
    const second = applyRecogniserPass(first.next, createPrng('seen-again'), 0, [], [FACE], AT, LOC);
    expect(second.seenBefore).toEqual([]);
    expect(second.next).toBe(first.next);
  });

  it('joins earlier sightings in year order', () => {
    expect(
      seenBeforeFactLine([
        { city: 'Vienna', year: 1951 },
        { city: 'Lisbon', year: 1949 },
      ]),
    ).toBe('You have seen this face before: Lisbon, 1949; Vienna, 1951.');
  });

  it('queues meeting lines and returns the same state once they are taken', () => {
    const state = world({ carry: carry() });
    const queued = queueCarryLines(state, ['You have seen this face before: Lisbon, 1949.']);
    const taken = takeCarryLines(queued);
    expect(taken.lines).toEqual(['You have seen this face before: Lisbon, 1949.']);
    const stored = taken.state.carry;
    expect(stored).toBeDefined();
    if (stored !== undefined) {
      expect(revealTruth(stored).pendingLines).toEqual([]);
    }
    expect(takeCarryLines(taken.state).state).toBe(taken.state);
    const bare = world();
    expect(queueCarryLines(bare, ['a line'])).toBe(bare);
  });
});
