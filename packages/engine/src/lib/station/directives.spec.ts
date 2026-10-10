/**
 * Tests for the Directive per-phase check and Standing moves (task 10.2;
 * Requirements 27.2, 27.3).
 *
 * The design fixes the behaviour: "WHEN a Directive's objective is met or its
 * deadline passes THEN the Sim SHALL adjust Standing and send a Cable", and
 * "Standing moves by the reward on success, minus the reward on failure". These
 * tests drive {@link checkDirectives} with an injected objective evaluator (the
 * truth-boundary seam) and assert the status transitions, the Standing moves and
 * the emitted `directive` events, plus determinism.
 */

import fc from 'fast-check';

import type { GameTime } from '../model/core.js';
import { checkDirectives, issueFollowOn, openingDirectives, type DirectiveStationSlice } from './directives.js';
import type { Directive } from './directive-types.js';

const T = (day: number, phase: 0 | 1 | 2 | 3 = 0): GameTime => ({ day, phase });

function directive(over: Partial<Directive> = {}): Directive {
  return {
    id: 'dir-1',
    text: 'Identify the Cell leader',
    objective: { kind: 'identify', entity: 'npc:leader' },
    deadline: T(5),
    reward: 3,
    status: 'open',
    ...over,
  };
}

function slice(
  directives: readonly Directive[],
  standing = 0,
): DirectiveStationSlice {
  return { directives, standing };
}

/** An evaluator that reports a fixed set of objectives (by id) as met. */
const metAlways = () => true;
const metNever = () => false;

describe('checkDirectives — meeting an objective before the deadline', () => {
  it('marks the Directive met, raises Standing by the reward, emits a met event', () => {
    const d = directive({ reward: 4 });
    const result = checkDirectives(slice([d], 10), T(2), metAlways);

    expect(result.directives[0].status).toBe('met');
    expect(result.standing).toBe(14);
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.kind).toBe('directive');
    expect(event.visibility).toBe('player');
    if (event.kind === 'directive') {
      expect(event.directive).toBe('dir-1');
      expect(event.status).toBe('met');
    }
  });

  it('counts a success even on the deadline phase (success beats the deadline)', () => {
    const d = directive({ deadline: T(5), reward: 2 });
    const result = checkDirectives(slice([d], 0), T(5), metAlways);

    expect(result.directives[0].status).toBe('met');
    expect(result.standing).toBe(2);
  });
});

describe('checkDirectives — unmet by the deadline', () => {
  it('marks the Directive failed, lowers Standing by the reward, emits a failed event', () => {
    const d = directive({ deadline: T(3), reward: 5 });
    const result = checkDirectives(slice([d], 10), T(3), metNever);

    expect(result.directives[0].status).toBe('failed');
    expect(result.standing).toBe(5);
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    if (event.kind === 'directive') {
      expect(event.status).toBe('failed');
    }
  });

  it('leaves an open Directive open and Standing unchanged before the deadline', () => {
    const d = directive({ deadline: T(9), reward: 5 });
    const result = checkDirectives(slice([d], 7), T(2), metNever);

    expect(result.directives[0].status).toBe('open');
    expect(result.standing).toBe(7);
    expect(result.events).toHaveLength(0);
  });
});

describe('checkDirectives — idempotence and purity', () => {
  it('does not re-settle an already met/failed Directive', () => {
    const met = directive({ id: 'a', status: 'met', reward: 3 });
    const failed = directive({ id: 'b', status: 'failed', reward: 3 });
    const result = checkDirectives(slice([met, failed], 5), T(9), metAlways);

    expect(result.standing).toBe(5);
    expect(result.events).toHaveLength(0);
    expect(result.directives[0]).toBe(met);
    expect(result.directives[1]).toBe(failed);
  });

  it('does not mutate the input slice', () => {
    const d = directive();
    const input = slice([d], 0);
    checkDirectives(input, T(9), metAlways);
    expect(d.status).toBe('open');
    expect(input.standing).toBe(0);
  });

  it('settles multiple Directives, netting the Standing moves', () => {
    const a = directive({
      id: 'a',
      reward: 4,
      deadline: T(10),
      objective: { kind: 'identify', entity: 'npc:leader' },
    }); // met
    const b = directive({
      id: 'b',
      reward: 3,
      deadline: T(1),
      objective: { kind: 'recruit', count: 2 },
    }); // failed by deadline, unmet
    // Only the identify objective is reported met.
    const result = checkDirectives(
      slice([a, b], 0),
      T(2),
      (obj) => obj.kind === 'identify',
    );
    // a is met (+4), b is failed by deadline (−3): net +1.
    expect(result.directives[0].status).toBe('met');
    expect(result.directives[1].status).toBe('failed');
    expect(result.standing).toBe(1);
    expect(result.events).toHaveLength(2);
  });
});

describe('checkDirectives — determinism (Req 1.2)', () => {
  it('is a pure function of its inputs across arbitrary slices', () => {
    const objArb = fc.constantFrom<Directive['objective']>(
      { kind: 'identify', entity: 'npc:leader' },
      { kind: 'recruit', count: 2 },
      { kind: 'arrest', entity: 'npc:courier' },
      { kind: 'intercept', channel: 'chan:numbers' },
    );
    const dirArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 8 }),
      text: fc.string(),
      objective: objArb,
      deadline: fc.record({
        day: fc.integer({ min: 0, max: 30 }),
        phase: fc.constantFrom<0 | 1 | 2 | 3>(0, 1, 2, 3),
      }),
      reward: fc.integer({ min: 0, max: 10 }),
      status: fc.constantFrom<Directive['status']>('open', 'met', 'failed'),
    });

    fc.assert(
      fc.property(
        fc.array(dirArb, { maxLength: 6 }),
        fc.double({ min: -50, max: 50, noNaN: true, noDefaultInfinity: true }),
        fc.record({
          day: fc.integer({ min: 0, max: 30 }),
          phase: fc.constantFrom<0 | 1 | 2 | 3>(0, 1, 2, 3),
        }),
        fc.boolean(),
        (dirs, standing, now, met) => {
          const evaluator = () => met;
          const a = checkDirectives(slice(dirs, standing), now, evaluator);
          const b = checkDirectives(slice(dirs, standing), now, evaluator);
          expect(a).toEqual(b);
          // Every emitted event is a player-visible directive event.
          for (const e of a.events) {
            expect(e.kind).toBe('directive');
            expect(e.visibility).toBe('player');
          }
        },
      ),
    );
  });
});

describe('the desk orders', () => {
  it('opens the game with one order and sends the next when that order closes', () => {
    const opening = openingDirectives(30);
    expect(opening).toHaveLength(1);
    expect(opening[0]?.objective).toEqual({ kind: 'recruit', count: 1 });
    expect(opening[0]?.status).toBe('open');

    const closed = [{ ...opening[0], status: 'met' as const }];
    const follow = issueFollowOn(closed, T(12));
    expect(follow?.directive.objective).toEqual({ kind: 'recruit', count: 2 });
    expect(follow?.directive.deadline.day).toBe(26);
    expect(follow?.event.kind).toBe('directive');
    if (follow?.event.kind === 'directive') {
      expect(follow.event.status).toBe('issued');
    }

    expect(issueFollowOn(opening, T(1))).toBeUndefined();
    expect(issueFollowOn([directive({ status: 'met' })], T(6))).toBeUndefined();
  });
});
