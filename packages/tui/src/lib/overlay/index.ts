/**
 * The "overlay" slice of the TUI (task 22.8): the player aids layered over the
 * main screen — the toggleable {@link HelpOverlay} that lists the current
 * Location's actions with their costs plus the glossary (design, "Help and
 * hints"; Requirement 26.5), and the {@link HintToasts} strip of transient,
 * dismissable contextual hints driven by the pure {@link reduceToasts} queue
 * reducer (Requirement 26.6).
 */

export {
  HelpOverlay,
  HELP_TOGGLE_KEY,
  type HelpOverlayProps,
} from './help-overlay.js';

export {
  HintToasts,
  DEFAULT_TOAST_DURATION_MS,
  type HintToastsProps,
} from './hint-toasts.js';

export {
  initialToastQueue,
  reduceToasts,
  frontToast,
  type Toast,
  type ToastQueueState,
  type ToastAction,
} from './toasts.js';
