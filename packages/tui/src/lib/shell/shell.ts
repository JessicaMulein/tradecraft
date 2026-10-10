/**
 * The App Shell's pure state reducer (design, "TUI: App Shell"; Requirements
 * 19.3, 19.4, 19.5, 19.6, 19.7, 19.9, 19.10, 19.11).
 *
 * The App Shell owns three things: which {@link Screen} is on display, the
 * transcript the scene renders as a turn streams, and the transient UI state
 * around a turn (whether one is streaming, the status-bar alerts, the hint
 * toasts, the help overlay). This module is the pure heart of that: a single
 * {@link reduceShell} folds one {@link ShellEvent} — a global key press, an
 * explicit navigation, or one streamed {@link TurnChunk} — into the next {@link
 * ShellState}, never mutating its input. Keeping it pure and separate from the
 * Ink component is what makes the routing, the chunk handling and the streaming
 * input lock unit-testable without a TTY (the component holds this state and
 * dispatches events from key presses and the turn stream).
 *
 * ## What each event does
 *
 * - A global **key** (`{ type: 'key' }`) routes through the {@link KEY_MAP}:
 *   navigation keys swap the screen, `?` toggles the help overlay, `s`/`l` open
 *   the save/load screen, `q` requests quit (the component confirms). An unbound
 *   key is a no-op. The one turn-starting global key, `l` (load), is ignored
 *   while a turn streams (Req 19.11).
 * - An explicit **navigate** (`{ type: 'navigate' }`) sets the screen directly —
 *   the component uses it for the flows the key map does not cover (start →
 *   brief → scene, Req 19.2; opening the debrief from game-over, Req 19.7).
 * - A **turn-start** (`{ type: 'turn-start' }`) marks a turn streaming and resets
 *   the transcript to empty. While a turn is already streaming it is ignored, so
 *   no key can start a second turn mid-stream (Req 19.11).
 * - A **chunk** (`{ type: 'chunk' }`) folds one {@link TurnChunk}: `fact`,
 *   `flavour` and `speech` feed the existing {@link reduceTranscript} (Req 19.4);
 *   `interrupted` drops the attempt's Flavour and speech through the same reducer
 *   (Req 19.5); `paused` routes to the endpoint-error screen (Req 19.6); `ended`
 *   routes to the game-over screen (Req 19.7); `notification` adds a status-bar
 *   alert (Req 19.9); `hint` pushes a toast (Req 19.10); `done`/`ended` clear the
 *   streaming flag so input is accepted again (Req 19.11).
 *
 * ## Boundary
 *
 * Every type the reducer touches is a view-safe `@tradecraft/player-view` shape
 * (the {@link TurnChunk} union, the {@link Notification}) or a derived view type
 * (`./screen.ts`, `./key-map.ts`). Nothing truth-bearing is reachable (Req 13.5).
 */

import type { Notification, TurnChunk } from '@tradecraft/player-view';

import {
  emptyTranscript,
  reduceTranscript,
  type TranscriptState,
} from '../scene/transcript.js';
import { bindingFor, type ShellKeyAction } from './key-map.js';
import type { Screen } from './screen.js';

/**
 * A hint toast on the shell's display strip (design: "`hint` → a hint toast",
 * Req 19.10). A `hint` {@link TurnChunk} carries the already-rendered hint text,
 * so a shell toast is that text with a monotonic queue id — distinct from the
 * text so two toasts with the same text are still individually addressable and a
 * late dismiss cannot evict the wrong one.
 */
export interface Toast {
  /** A monotonic queue id, unique within a {@link ShellState}'s lifetime. */
  readonly id: number;
  /** The hint text to show, verbatim from the `hint` chunk. */
  readonly text: string;
}

/**
 * The App Shell's state (design `ShellState`): the active {@link Screen}, an
 * optional help overlay, whether a turn is streaming, the scene transcript, and
 * the live hint toasts. The status-bar alerts raised by `notification` chunks are
 * kept in `alerts`, and `nextToastId` hands out toast ids; both extend the design
 * sketch with the small amount of bookkeeping the pure reducer needs.
 */
export interface ShellState {
  /** The screen currently on display (design `screen`). */
  readonly screen: Screen;
  /** The help overlay, when toggled on (design `overlay?: 'help'`). */
  readonly overlay?: 'help';
  /** True while a turn is streaming; locks turn-starting input (Req 19.11). */
  readonly streaming: boolean;
  /** The scene transcript the current/last turn accumulated (Req 19.4, 19.5). */
  readonly transcript: TranscriptState;
  /** The live hint toasts, oldest first (Req 19.10). */
  readonly toasts: readonly Toast[];
  /** The status-bar alerts raised by `notification` chunks, oldest first (Req 19.9). */
  readonly alerts: readonly Notification[];
  /** The id the next enqueued toast takes; strictly increasing. */
  readonly nextToastId: number;
}

/**
 * One event the App Shell reduces:
 *
 * - `key` — a global key the player pressed (routed through the {@link KEY_MAP}).
 * - `navigate` — set the screen directly, for the flows the key map does not
 *   cover (start → brief → scene, debrief).
 * - `turn-start` — a turn began streaming; reset the transcript and lock input.
 * - `chunk` — one streamed {@link TurnChunk} to fold.
 */
export type ShellEvent =
  | { readonly type: 'key'; readonly key: string }
  | { readonly type: 'navigate'; readonly screen: Screen }
  | { readonly type: 'turn-start' }
  | { readonly type: 'chunk'; readonly chunk: TurnChunk };

/**
 * The initial shell state: the start screen, no overlay, not streaming, an empty
 * transcript, and no toasts or alerts (design: the shell opens on `start`, Req
 * 19.2).
 */
export const initialShellState: ShellState = {
  screen: { kind: 'start' },
  streaming: false,
  transcript: emptyTranscript,
  toasts: [],
  alerts: [],
  nextToastId: 0,
};

/**
 * The global key actions that *start a turn* and so are refused while a turn
 * streams (Req 19.11; Property 58 names the turn-starting effects — `load` is the
 * only one a global key triggers directly, by starting a fresh session). The
 * scene-local turn starters (`act`, `say`, `endScene`, `retry`, `newGame`) are
 * gated by the `streaming` guard on the `turn-start` event instead.
 */
const TURN_STARTING_KEY_ACTIONS: ReadonlySet<ShellKeyAction> = new Set<ShellKeyAction>([
  'load',
]);

/** Route a global key action to the screen (or overlay) it opens. */
function applyKeyAction(state: ShellState, action: ShellKeyAction): ShellState {
  switch (action) {
    case 'open-case-file':
      return { ...state, screen: { kind: 'case-file' }, overlay: undefined };
    case 'open-documents':
      return { ...state, screen: { kind: 'documents' }, overlay: undefined };
    case 'open-workbench':
      return { ...state, screen: { kind: 'workbench' }, overlay: undefined };
    case 'open-intercepts':
      return { ...state, screen: { kind: 'intercepts' }, overlay: undefined };
    case 'open-journal':
      return { ...state, screen: { kind: 'journal' }, overlay: undefined };
    case 'open-map':
      return { ...state, screen: { kind: 'map' }, overlay: undefined };
    case 'open-streets':
      return { ...state, screen: { kind: 'streets' }, overlay: undefined };
    case 'open-city':
      return { ...state, screen: { kind: 'city' }, overlay: undefined };
    case 'open-stories':
      return { ...state, screen: { kind: 'stories' }, overlay: undefined };
    case 'open-duties':
      return { ...state, screen: { kind: 'duties' }, overlay: undefined };
    case 'open-people':
      return { ...state, screen: { kind: 'people' }, overlay: undefined };
    case 'open-region':
      return { ...state, screen: { kind: 'region' }, overlay: undefined };
    case 'open-departures':
      return { ...state, screen: { kind: 'departures' }, overlay: undefined };
    case 'open-papers':
      return { ...state, screen: { kind: 'papers' }, overlay: undefined };
    case 'open-carriage':
      return { ...state, screen: { kind: 'carriage' }, overlay: undefined };
    case 'open-feed':
      // The feed composer needs a selected turned Asset; the component supplies
      // it with an explicit `navigate`. The global `f` key is a no-op here when
      // no Asset is in hand — the shell has no selection to name.
      return state;
    case 'save':
      return { ...state, screen: { kind: 'save-load', mode: 'save' }, overlay: undefined };
    case 'load':
      return { ...state, screen: { kind: 'save-load', mode: 'load' }, overlay: undefined };
    case 'toggle-help':
      return { ...state, overlay: state.overlay === 'help' ? undefined : 'help' };
    case 'quit':
      // Quit is confirmed by the component; the reducer leaves the state as-is so
      // the pure model never tears down the session on its own.
      return state;
    default: {
      // Exhaustive: every `ShellKeyAction` is handled above.
      const _never: never = action;
      return _never;
    }
  }
}

/** Push a hint toast, assigning it the next id (Req 19.10). */
function pushToast(state: ShellState, text: string): ShellState {
  return {
    ...state,
    toasts: [...state.toasts, { id: state.nextToastId, text }],
    nextToastId: state.nextToastId + 1,
  };
}

/** Fold one {@link TurnChunk} into the shell state. */
function reduceChunk(state: ShellState, chunk: TurnChunk): ShellState {
  switch (chunk.kind) {
    // Renderable scene lines and the discard flag go through the existing
    // transcript reducer, which the shell owns a copy of per turn (Req 19.4,
    // 19.5).
    case 'fact':
    case 'flavour':
    case 'speech':
    case 'interrupted':
      return { ...state, transcript: reduceTranscript(state.transcript, chunk) };
    // A notification becomes a status-bar alert (Req 19.9); it also updates the
    // transcript's own view of control state (a no-op there) for consistency.
    case 'notification':
      return {
        ...state,
        alerts: [...state.alerts, chunk.n],
        transcript: reduceTranscript(state.transcript, chunk),
      };
    // A hint becomes a toast, shown once (the pipeline already fires each hint a
    // single time; Req 19.10).
    case 'hint':
      return pushToast(state, chunk.text);
    // An unreachable endpoint pauses the turn: route to the endpoint-error
    // screen with its error, and release the input lock so Retry/Save-and-Quit
    // are reachable (Req 19.6, 19.11).
    case 'paused':
      return {
        ...state,
        screen: { kind: 'endpoint-error', error: chunk.error },
        streaming: false,
        transcript: reduceTranscript(state.transcript, chunk),
      };
    // The game ended: route to the game-over screen with the outcome, and end
    // the stream (Req 19.7, 19.11).
    case 'ended':
      return {
        ...state,
        screen: { kind: 'game-over', outcome: chunk.outcome },
        streaming: false,
        transcript: reduceTranscript(state.transcript, chunk),
      };
    // The turn finished normally: fold `done` into the transcript and unlock
    // input (Req 19.11).
    case 'done':
      return {
        ...state,
        streaming: false,
        transcript: reduceTranscript(state.transcript, chunk),
      };
    default: {
      // Exhaustive over the `TurnChunk` union.
      const _never: never = chunk;
      return _never;
    }
  }
}

/**
 * The pure App Shell reducer. Folds one {@link ShellEvent} into the {@link
 * ShellState} and returns the next state; never mutates its input.
 *
 * The streaming input lock (Req 19.11) is enforced here in one place: while
 * `state.streaming` is true, a `turn-start` event and any key bound to a
 * turn-starting action are dropped, so no key press can begin a second turn
 * before the first stream's `done`, `paused` or `ended` chunk has arrived.
 * Navigation keys, the help toggle and save stay live while a turn streams —
 * they do not start a turn — so the player can still look around.
 */
export function reduceShell(state: ShellState, event: ShellEvent): ShellState {
  switch (event.type) {
    case 'navigate':
      return { ...state, screen: event.screen, overlay: undefined };
    case 'turn-start':
      // Ignore a turn start while a turn is already streaming (Req 19.11).
      return state.streaming
        ? state
        : { ...state, streaming: true, transcript: emptyTranscript };
    case 'chunk':
      return reduceChunk(state, event.chunk);
    case 'key': {
      const binding = bindingFor(event.key);
      if (binding === undefined) {
        return state; // An unbound key is a no-op.
      }
      // While a turn streams, refuse a key that would start a new turn (Req
      // 19.11); non-turn-starting keys (navigation, help, save) stay live.
      if (state.streaming && TURN_STARTING_KEY_ACTIONS.has(binding.action)) {
        return state;
      }
      return applyKeyAction(state, binding.action);
    }
    default: {
      // Exhaustive over the `ShellEvent` union.
      const _never: never = event;
      return _never;
    }
  }
}
