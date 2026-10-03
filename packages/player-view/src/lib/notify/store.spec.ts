/**
 * Unit tests for the view-side {@link NotificationStore} (task 16.6; Requirement
 * 39.6).
 *
 * The store holds the Notifications a turn delivered, exposes the undismissed
 * ones for the status bar, flips a dismissed flag in place, de-duplicates by id
 * (so an idempotent re-delivery does not double up), and fans new arrivals out
 * to subscribers.
 */

import { describe, expect, it, vi } from 'vitest';

import type { GameTime, Phase } from '@tradecraft/engine';

import type { Notification } from './notification.js';
import { NotificationStore } from './store.js';

function time(day: number, phase: Phase): GameTime {
  return { day, phase };
}

function cable(id: string): Notification {
  return { id, at: time(1, 0), factLine: 'A Cable has arrived.', dismissed: false, kind: 'cable', doc: 'doc:brief' };
}

describe('NotificationStore', () => {
  it('lists pushed Notifications in arrival order', () => {
    const store = new NotificationStore();
    store.pushAll([cable('n:1'), cable('n:2')]);
    expect(store.list().map((n) => n.id)).toEqual(['n:1', 'n:2']);
  });

  it('exposes undismissed Notifications as the status-bar alerts', () => {
    const store = new NotificationStore();
    store.pushAll([cable('n:1'), cable('n:2')]);
    store.dismiss('n:1');
    expect(store.undismissed().map((n) => n.id)).toEqual(['n:2']);
    // The dismissed one stays in the full history.
    expect(store.list().map((n) => n.id)).toEqual(['n:1', 'n:2']);
    expect(store.list().find((n) => n.id === 'n:1')?.dismissed).toBe(true);
  });

  it('ignores a push with an id already present (idempotent re-delivery)', () => {
    const store = new NotificationStore();
    store.push(cable('n:1'));
    store.push(cable('n:1'));
    expect(store.count).toBe(1);
  });

  it('dismissing an unknown id is a no-op', () => {
    const store = new NotificationStore();
    store.push(cable('n:1'));
    store.dismiss('n:nope');
    expect(store.undismissed()).toHaveLength(1);
  });

  it('fans new arrivals out to subscribers and stops after unsubscribe', () => {
    const store = new NotificationStore();
    const seen = vi.fn();
    const off = store.subscribe(seen);
    store.push(cable('n:1'));
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    store.push(cable('n:2'));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('does not call a subscriber for the backlog, only new arrivals', () => {
    const store = new NotificationStore();
    store.push(cable('n:1'));
    const seen = vi.fn();
    store.subscribe(seen);
    expect(seen).not.toHaveBeenCalled();
    store.push(cable('n:2'));
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
