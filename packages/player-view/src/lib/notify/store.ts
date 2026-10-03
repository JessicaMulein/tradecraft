/**
 * The view-side Notification store (task 16.6; Requirement 39.6; design,
 * "Notifications": "The Player View SHALL expose undismissed Notifications as a
 * typed list, which the status bar SHALL show as alerts").
 *
 * Like the Journal and the hints seen-flags, the Notification list is **view
 * state**, not Sim state: it lives here, never in the {@link WorldState} or the
 * Truth Store, so pushing or dismissing a Notification cannot perturb the Sim
 * and a replay of the same seed is unaffected (Requirement 2.2). The Turn
 * Pipeline (task 16.8) pushes the Notifications `notify` produced at a turn's
 * commit; the TUI reads {@link NotificationStore.list} for the status bar and
 * calls {@link NotificationStore.dismiss} when the player clears one, and may
 * {@link NotificationStore.subscribe} to be told as each new one arrives.
 *
 * The store is append-only in the sense that a Notification is never removed —
 * dismissing one flips its `dismissed` flag rather than dropping it — so the
 * Journal and the Notification history stay consistent. `list()` returns every
 * Notification (dismissed or not) in arrival order; the status bar filters to
 * the undismissed ones.
 */

import type { NotificationId } from '@tradecraft/engine';

import type { Notification } from './notification.js';

/** A subscriber notified as each new Notification arrives. */
export type NotificationListener = (n: Notification) => void;

/**
 * A plain, JSON-serialisable snapshot of a {@link NotificationStore} for the
 * save file (task 21.1; design `SaveSnapshot.notifications` — "the full
 * Notification list"). It is simply the Notifications in arrival order, each
 * carrying its own `dismissed` flag, so {@link NotificationStore.fromSnapshot}
 * rebuilds the history and the dismissed state exactly. Subscribers are *not*
 * saved — they are live UI wiring, re-attached after a load.
 */
export type NotificationStoreSnapshot = readonly Notification[];

/**
 * The view-side Notification store. Holds the Notifications a turn delivered,
 * tracks which are dismissed, and fans each new arrival out to subscribers.
 */
export class NotificationStore {
  /** Notifications in arrival order; a dismissed one keeps its place. */
  private readonly items: Notification[] = [];

  /** The current subscribers. */
  private readonly listeners = new Set<NotificationListener>();

  /**
   * Push one delivered Notification (the Turn Pipeline's commit step). A push
   * with an id already present is ignored, so re-delivering the same event
   * (idempotent commit, replay) does not duplicate it. Returns the stored
   * Notification, or the existing one if the id was already present.
   */
  push(notification: Notification): Notification {
    const existing = this.items.find((n) => n.id === notification.id);
    if (existing !== undefined) {
      return existing;
    }
    this.items.push(notification);
    for (const listener of this.listeners) {
      listener(notification);
    }
    return notification;
  }

  /** Push many Notifications in order (a turn's worth), ignoring duplicates. */
  pushAll(notifications: readonly Notification[]): void {
    for (const n of notifications) {
      this.push(n);
    }
  }

  /**
   * Every Notification, in arrival order (design's "typed list"). A fresh
   * snapshot, so a caller cannot mutate the store through it. The status bar
   * filters this to `!n.dismissed` for its alerts (Requirement 39.6).
   */
  list(): Notification[] {
    return [...this.items];
  }

  /** The undismissed Notifications the status bar shows as alerts. */
  undismissed(): Notification[] {
    return this.items.filter((n) => !n.dismissed);
  }

  /**
   * Dismiss the Notification with the given id (Requirement 39.6). Flips its
   * `dismissed` flag in place; an unknown id is a no-op. The Notification stays
   * in the list (dismissed), so its Fact Line and the history remain.
   */
  dismiss(id: NotificationId): void {
    const index = this.items.findIndex((n) => n.id === id);
    if (index === -1) {
      return;
    }
    const current = this.items[index];
    if (current.dismissed) {
      return;
    }
    this.items[index] = { ...current, dismissed: true };
  }

  /**
   * Subscribe to new Notifications. The listener is called once per new arrival
   * (not for the backlog). Returns an unsubscribe function.
   */
  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The number of Notifications held (dismissed or not). */
  get count(): number {
    return this.items.length;
  }

  /**
   * A plain, JSON-serialisable snapshot for the save file (task 21.1): every
   * Notification in arrival order, each with its `dismissed` flag. A fresh
   * array, so the save does not alias the live store.
   */
  snapshot(): NotificationStoreSnapshot {
    return this.items.map((n) => ({ ...n }));
  }

  /**
   * Rebuild a {@link NotificationStore} from a {@link NotificationStoreSnapshot}
   * read from a save (task 21.1). The Notifications are restored in arrival
   * order with their dismissed flags; no subscribers are attached (the UI
   * re-subscribes after a load). The Notifications are defensively copied so the
   * rebuilt store does not alias the loaded save object.
   */
  static fromSnapshot(snapshot: NotificationStoreSnapshot): NotificationStore {
    const store = new NotificationStore();
    for (const n of snapshot) {
      store.items.push({ ...n });
    }
    return store;
  }
}
