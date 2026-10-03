/**
 * The App Shell slice of the TUI (slice-integration task 13.1): the pure shell
 * state reducer, the {@link Screen} routing union and derived id types, and the
 * documented key map (design, "TUI: App Shell"; Requirements 19.3, 19.4, 19.5,
 * 19.6, 19.7, 19.9, 19.10, 19.11). The {@link AppShell} Ink component that holds
 * this state and renders each screen is {@link AppShell} (task 13.2).
 */

export {
  initialShellState,
  reduceShell,
  type ShellEvent,
  type ShellState,
} from './shell.js';

// The shell's hint-toast type is named `Toast`, which the overlay slice already
// exports (a different, HintView-backed shape). To keep the top-level barrel's
// `Toast` unambiguous it is re-exported here under the explicit alias
// `ShellToast`; the overlay `Toast` keeps the bare name.
export { type Toast as ShellToast } from './shell.js';

export {
  type DocId,
  type InterceptId,
  type NpcId,
  type Outcome,
  type Screen,
  type ScreenKind,
} from './screen.js';

// `PausedError` is already exported by the endpoint-error slice (both derive it
// from the same `paused` TurnChunk variant); it is intentionally not re-exported
// here so the top-level barrel has a single owner for the name.

export {
  KEY_BINDINGS,
  KEY_MAP,
  bindingFor,
  type KeyBinding,
  type ShellKeyAction,
} from './key-map.js';

export {
  AppShell,
  type AppShellDefaults,
  type AppShellProps,
} from './app-shell.js';
