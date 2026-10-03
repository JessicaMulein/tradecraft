/**
 * Unit tests for the pure hint-toast queue reducer (task 22.8; design, "Help
 * and hints"; Requirement 26.6). These exercise enqueueing, dismiss/expire by
 * id, shifting the oldest and clearing — the add/dismiss/auto-expire queue the
 * component drives — all without a TTY; the component test then confirms the
 * Ink layer wires keys and the timer to these.
 */

import { describe, expect, it } from 'vitest';
import type { HintView } from '@tradecraft/player-view';
import {
  frontToast,
  initialToastQueue,
  reduceToasts,
  type ToastQueueState,
} from './toasts.js';

/** A small hint fixture with a given trigger/text. */
const hint = (trigger: string, text: string): HintView =>
  ({ trigger, text } as unknown as HintView);

describe('initialToastQueue', () => {
  it('starts empty with the first id at 0', () => {
    expect(initialToastQueue()).toEqual<ToastQueueState>({
      toasts: [],
      nextId: 0,
    });
  });
});

describe('reduceToasts add', () => {
  it('appends a toast with the next id and bumps nextId', () => {
    let s = initialToastQueue();
    s = reduceToasts(s, { type: 'add', hint: hint('first-intercept', 'A') });
    expect(s.toasts).toEqual([{ id: 0, hint: hint('first-intercept', 'A') }]);
    expect(s.nextId).toBe(1);

    s = reduceToasts(s, { type: 'add', hint: hint('low-budget', 'B') });
    expect(s.toasts.map((t) => t.id)).toEqual([0, 1]);
    expect(s.nextId).toBe(2);
  });

  it('keeps toasts in arrival order', () => {
    let s = initialToastQueue();
    s = reduceToasts(s, { type: 'add', hint: hint('a', 'A') });
    s = reduceToasts(s, { type: 'add', hint: hint('b', 'B') });
    expect(s.toasts.map((t) => t.hint.text)).toEqual(['A', 'B']);
  });

  it('does not mutate the input state', () => {
    const s = initialToastQueue();
    reduceToasts(s, { type: 'add', hint: hint('a', 'A') });
    expect(s).toEqual<ToastQueueState>({ toasts: [], nextId: 0 });
  });
});

describe('reduceToasts dismiss and expire', () => {
  const seeded = (): ToastQueueState => {
    let s = initialToastQueue();
    s = reduceToasts(s, { type: 'add', hint: hint('a', 'A') });
    s = reduceToasts(s, { type: 'add', hint: hint('b', 'B') });
    return s;
  };

  it('removes the named toast on dismiss', () => {
    const s = reduceToasts(seeded(), { type: 'dismiss', id: 0 });
    expect(s.toasts.map((t) => t.id)).toEqual([1]);
  });

  it('removes the named toast on expire', () => {
    const s = reduceToasts(seeded(), { type: 'expire', id: 1 });
    expect(s.toasts.map((t) => t.id)).toEqual([0]);
  });

  it('is a no-op for an id no longer present (a late timer)', () => {
    const s = seeded();
    const after = reduceToasts(s, { type: 'expire', id: 99 });
    expect(after).toBe(s);
  });

  it('never reuses an id after a removal', () => {
    let s = seeded();
    s = reduceToasts(s, { type: 'dismiss', id: 0 });
    s = reduceToasts(s, { type: 'add', hint: hint('c', 'C') });
    // nextId kept advancing; the new toast is id 2, not a reused 0.
    expect(s.toasts.map((t) => t.id)).toEqual([1, 2]);
    expect(s.nextId).toBe(3);
  });
});

describe('reduceToasts shift and clear', () => {
  const seeded = (): ToastQueueState => {
    let s = initialToastQueue();
    s = reduceToasts(s, { type: 'add', hint: hint('a', 'A') });
    s = reduceToasts(s, { type: 'add', hint: hint('b', 'B') });
    return s;
  };

  it('shift drops the oldest toast', () => {
    const s = reduceToasts(seeded(), { type: 'shift' });
    expect(s.toasts.map((t) => t.hint.text)).toEqual(['B']);
  });

  it('shift on an empty queue is a no-op', () => {
    const empty = initialToastQueue();
    expect(reduceToasts(empty, { type: 'shift' })).toBe(empty);
  });

  it('clear empties the queue', () => {
    const s = reduceToasts(seeded(), { type: 'clear' });
    expect(s.toasts).toEqual([]);
  });

  it('clear on an empty queue is a no-op', () => {
    const empty = initialToastQueue();
    expect(reduceToasts(empty, { type: 'clear' })).toBe(empty);
  });
});

describe('frontToast', () => {
  it('returns the oldest live toast', () => {
    let s = initialToastQueue();
    s = reduceToasts(s, { type: 'add', hint: hint('a', 'A') });
    s = reduceToasts(s, { type: 'add', hint: hint('b', 'B') });
    expect(frontToast(s)?.hint.text).toBe('A');
  });

  it('returns undefined when empty', () => {
    expect(frontToast(initialToastQueue())).toBeUndefined();
  });
});
