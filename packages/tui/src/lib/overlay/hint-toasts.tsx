/**
 * The hint-toast strip — transient, dismissable hints surfaced over the UI
 * (task 22.8; design, "Help and hints": "Hints are content-defined `{ trigger,
 * text }`"; Requirement 26.6).
 *
 * A hint toast shows one-off contextual guidance the first time a situation
 * occurs. The first-occurrence rule and the seen flags live upstream in the
 * player-view {@link HintStore}; this component owns only *display*: it holds
 * the toast queue with the pure {@link reduceToasts} reducer, renders the live
 * toasts, lets the player dismiss the oldest with a key, and auto-expires each
 * toast after a timeout. Nothing here touches Sim state — a toast is just a
 * {@link HintView} the owning screen enqueued.
 *
 * ## Enqueueing
 *
 * The owning screen feeds hints in through the `incoming` prop: each time it
 * fires a trigger on the {@link HintStore} and gets back a {@link HintView}, it
 * passes that view here. A `useEffect` keyed on the incoming hint's identity
 * appends it to the queue exactly once; passing `null`/`undefined` (the common
 * case — most phases raise no new hint) enqueues nothing.
 *
 * ## Auto-expire
 *
 * Each live toast schedules a one-shot timer; when it fires the toast is
 * `expire`d by its queue id. Because the reducer drops by id, a timer that fires
 * after its toast was already dismissed is a harmless no-op, and it can never
 * evict a different toast. A `durationMs` of `0` or less disables auto-expiry so
 * a test (or a "sticky" mode) can hold toasts open.
 *
 * ## Boundary
 *
 * The strip reads only `@tradecraft/player-view` types (Req 13.5): the view-safe
 * {@link HintView} (a trigger and authored text). Nothing truth-bearing is
 * reachable.
 */

import { useEffect, useReducer, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type { HintView } from '@tradecraft/player-view';

import {
  frontToast,
  initialToastQueue,
  reduceToasts,
  type Toast,
} from './toasts.js';

/** The default time a toast stays on screen before auto-expiring, in ms. */
export const DEFAULT_TOAST_DURATION_MS = 6000;

/** Props for {@link HintToasts}. */
export interface HintToastsProps {
  /**
   * The hint to enqueue, if any — the {@link HintView} the owning screen got
   * back from firing a trigger on the {@link HintStore}. Each distinct value is
   * enqueued once; `null`/`undefined` (no new hint this phase) enqueues nothing.
   */
  readonly incoming?: HintView | null;
  /**
   * How long each toast stays before auto-expiring, in ms. Defaults to
   * {@link DEFAULT_TOAST_DURATION_MS}; `0` or less disables auto-expiry.
   */
  readonly durationMs?: number;
}

/** One toast line: a lightbulb marker and the hint text. */
function ToastLine({ toast }: { readonly toast: Toast }): ReactElement {
  return (
    <Box>
      <Text color="yellow">💡 {toast.hint.text}</Text>
    </Box>
  );
}

/**
 * The hint-toast strip: the live toasts stacked oldest-first, auto-expiring
 * after `durationMs` and dismissable (oldest first) with a key press. Renders
 * nothing when the queue is empty.
 */
export function HintToasts({
  incoming,
  durationMs = DEFAULT_TOAST_DURATION_MS,
}: HintToastsProps): ReactElement | null {
  const [state, dispatch] = useReducer(reduceToasts, initialToastQueue());

  // Enqueue each incoming hint exactly once. The effect is keyed on the hint
  // object identity, so a parent that re-renders with the *same* hint does not
  // re-enqueue it, and a new hint (a fresh object from the store) does.
  useEffect(() => {
    if (incoming !== null && incoming !== undefined) {
      dispatch({ type: 'add', hint: incoming });
    }
  }, [incoming]);

  const front = frontToast(state);

  // Auto-expire the oldest toast after the timeout. Keying the effect on the
  // front toast's id arms a fresh timer whenever the front changes and clears
  // the previous one, so each toast gets exactly one countdown.
  useEffect(() => {
    if (front === undefined || durationMs <= 0) {
      return;
    }
    const id = front.id;
    const timer = setTimeout(() => {
      dispatch({ type: 'expire', id });
    }, durationMs);
    return () => {
      clearTimeout(timer);
    };
  }, [front?.id, durationMs]);

  // Any key press dismisses the oldest toast — a quick way to clear guidance
  // without reaching for a specific chord. Active only while a toast is shown so
  // it does not swallow keys the rest of the UI wants.
  useInput(
    () => {
      dispatch({ type: 'shift' });
    },
    { isActive: state.toasts.length > 0 },
  );

  if (state.toasts.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {state.toasts.map((toast) => (
        <ToastLine key={toast.id} toast={toast} />
      ))}
    </Box>
  );
}
