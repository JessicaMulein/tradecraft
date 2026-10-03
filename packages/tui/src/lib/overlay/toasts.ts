/**
 * The hint-toast queue and the pure reducer that drives it (task 22.8; design,
 * "Help and hints": "Hints are content-defined `{ trigger, text }`. Seen flags
 * live in the view state, not the Sim"; Requirement 26.6).
 *
 * A hint toast is a transient, dismissable message that surfaces contextual
 * guidance the first time a situation occurs. The *first-occurrence* rule and
 * the seen flags live upstream in the player-view {@link HintStore}: the TUI
 * fires a trigger, the store returns a {@link HintView} the first time (and
 * `undefined` thereafter), and the TUI enqueues that {@link HintView} here for
 * display. This module owns only the *display* queue — which hints are on
 * screen, in what order, and when they leave — so none of it touches Sim state.
 *
 * The queue logic is a pure function of (state, action) so it can be unit-tested
 * without a TTY: the {@link HintToasts} component holds this state with
 * {@link useReducer}, renders the live toasts, and dispatches `dismiss`/`expire`
 * from key presses and a timer. Each toast carries a monotonic `id` so a
 * dismiss/expire names exactly one toast even when two share a trigger text, and
 * so a timer that fires late cannot evict a newer toast that reused a slot.
 */

import type { HintView } from '@tradecraft/player-view';

/** A hint toast on the display queue: a {@link HintView} with a queue identity. */
export interface Toast {
  /**
   * A monotonic queue id, unique within a {@link ToastQueueState}'s lifetime.
   * Distinct from the hint's `trigger` so two toasts with the same trigger text
   * are still individually addressable, and a stale timer cannot evict the
   * wrong one.
   */
  readonly id: number;
  /** The hint to show — its trigger and rendered text, straight from the store. */
  readonly hint: HintView;
}

/**
 * The toast queue's state: the live toasts in arrival order, and the next id to
 * assign. `nextId` only ever increases, so ids are never reused within a
 * session even as toasts come and go.
 */
export interface ToastQueueState {
  /** The toasts currently on screen, oldest first. */
  readonly toasts: readonly Toast[];
  /** The id the next enqueued toast will take; strictly increasing. */
  readonly nextId: number;
}

/** The initial, empty toast queue. */
export function initialToastQueue(): ToastQueueState {
  return { toasts: [], nextId: 0 };
}

/** One toast-queue action. */
export type ToastAction =
  /** Enqueue a new hint toast (assigned the next id). */
  | { readonly type: 'add'; readonly hint: HintView }
  /** Remove a toast the player dismissed, by its queue id. */
  | { readonly type: 'dismiss'; readonly id: number }
  /** Remove a toast whose display timer elapsed, by its queue id. */
  | { readonly type: 'expire'; readonly id: number }
  /** Remove the oldest toast (dismiss/expire without naming an id). */
  | { readonly type: 'shift' }
  /** Clear every live toast at once. */
  | { readonly type: 'clear' };

/**
 * The pure toast-queue reducer. Applies one {@link ToastAction} against the
 * {@link ToastQueueState} and returns the next state; never mutates its input.
 *
 * - `add` appends a toast with the next id and bumps `nextId`.
 * - `dismiss`/`expire` remove the named toast; both drop one toast by id and
 *   differ only in intent (a key press vs. a timer), so they share behaviour.
 *   Naming an id that is no longer present is a no-op — a late timer that fires
 *   after its toast already left harms nothing.
 * - `shift` removes the oldest toast, if any.
 * - `clear` empties the queue.
 *
 * `nextId` is preserved across removals and only advances on `add`, so an id is
 * never reused for a different hint within the queue's lifetime.
 */
export function reduceToasts(
  state: ToastQueueState,
  action: ToastAction,
): ToastQueueState {
  switch (action.type) {
    case 'add':
      return {
        toasts: [...state.toasts, { id: state.nextId, hint: action.hint }],
        nextId: state.nextId + 1,
      };
    case 'dismiss':
    case 'expire': {
      const toasts = state.toasts.filter((t) => t.id !== action.id);
      // Keep the same object when nothing matched so callers can skip a render.
      return toasts.length === state.toasts.length
        ? state
        : { ...state, toasts };
    }
    case 'shift':
      return state.toasts.length === 0
        ? state
        : { ...state, toasts: state.toasts.slice(1) };
    case 'clear':
      return state.toasts.length === 0 ? state : { ...state, toasts: [] };
    default:
      return state;
  }
}

/** The oldest live toast, or `undefined` when the queue is empty. */
export function frontToast(state: ToastQueueState): Toast | undefined {
  return state.toasts[0];
}
