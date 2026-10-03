/**
 * The endpoint-error screen's menu selection state and the pure reducer that
 * drives it (design, "TUI": "Endpoint error screen: shown on a `paused` chunk.
 * It names the endpoint and message and offers retry (`retry()`) or save and
 * quit. Dialogue stays paused until one is chosen"; Requirements 13.10, 16.1).
 *
 * When a turn pauses because the LLM endpoint became unreachable (a `paused`
 * {@link TurnChunk}), the screen offers two choices: Retry — which re-runs the
 * paused turn through the facade's `retry()` — and Save and Quit. The cursor
 * logic (move up/down with wrap) is kept here as a pure function so it can be
 * unit-tested without a TTY; the {@link EndpointErrorScreen} component holds this
 * state, renders it, and maps each keypress to one {@link EndpointMenuAction}.
 *
 * The screen never decides *what* retry or save-and-quit do — those are the
 * owning screen's concern (it calls the facade's `retry()` or triggers a save).
 * The reducer only tracks which of the two options is highlighted.
 */

/**
 * The two choices the endpoint-error screen offers, in the order the menu lists
 * them: retry the paused turn, or save and quit (design, "Endpoint error
 * screen").
 */
export const ENDPOINT_CHOICES = ['retry', 'save-and-quit'] as const;

/** One choice on the endpoint-error screen. */
export type EndpointChoice = (typeof ENDPOINT_CHOICES)[number];

/** The endpoint-error menu's cursor state: which choice is highlighted. */
export interface EndpointMenuState {
  /** The index of the highlighted choice within {@link ENDPOINT_CHOICES}. */
  readonly index: number;
}

/** The initial menu state, with the cursor on Retry (the first choice). */
export function initialEndpointMenuState(): EndpointMenuState {
  return { index: 0 };
}

/** A menu action, one per keypress the component handles. */
export type EndpointMenuAction =
  /** Move the cursor to the next/previous choice (wrapping). */
  | { readonly type: 'next' }
  | { readonly type: 'prev' }
  /** Jump the cursor to a specific choice index (clamped into range). */
  | { readonly type: 'select'; readonly index: number };

/** The number of choices the menu offers. */
const COUNT = ENDPOINT_CHOICES.length;

/** Clamp an index into `[0, COUNT)`. */
function clampIndex(index: number): number {
  if (index < 0) {
    return 0;
  }
  if (index >= COUNT) {
    return COUNT - 1;
  }
  return index;
}

/** Step the index by `step`, wrapping around the ends of the choice list. */
function wrap(index: number, step: number): number {
  return (index + step + COUNT) % COUNT;
}

/**
 * The pure endpoint-error menu reducer. Applies one {@link EndpointMenuAction}
 * against the {@link EndpointMenuState} and returns the next state; never
 * mutates its input.
 *
 * - `next`/`prev` move the cursor one choice, wrapping at the ends.
 * - `select` jumps to an index, clamped into range.
 */
export function reduceEndpointMenu(
  state: EndpointMenuState,
  action: EndpointMenuAction,
): EndpointMenuState {
  switch (action.type) {
    case 'next':
      return { index: wrap(state.index, 1) };
    case 'prev':
      return { index: wrap(state.index, -1) };
    case 'select':
      return { index: clampIndex(action.index) };
    default:
      return state;
  }
}

/** The choice the cursor currently rests on. */
export function selectedChoice(state: EndpointMenuState): EndpointChoice {
  return ENDPOINT_CHOICES[clampIndex(state.index)];
}
