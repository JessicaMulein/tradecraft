/**
 * The game-over screen's model: the outcome classification and the pure
 * menu-selection reducer behind it (design, "TUI": a game-over screen "stating
 * the outcome (success, Plot failure or burned) and the end day and phase",
 * offering the debrief; Requirements 13.7, 19.4, 19.5).
 *
 * When a turn's {@link TurnChunk} stream yields an `ended` chunk the game is
 * over. The chunk carries only the public `outcome` tag (a string — the engine's
 * `Outcome`, re-exported view-safe), so the screen also takes the end day and
 * phase from the status view's `time`, and the outcome string itself is the
 * cause / ending text shown to the player. Nothing truth-bearing is reachable:
 * the debrief that reveals ground truth is a *separate* screen (task 22.11),
 * reached through the "Open Debrief" option here.
 *
 * ## Why a pure model
 *
 * The two decisions this screen makes — how to read an outcome tag as
 * success/failure, and which menu option is highlighted — are kept here as pure
 * functions so they can be unit-tested without a TTY. The {@link GameOverScreen}
 * component holds the {@link GameOverState}, renders the option at
 * `state.index` as highlighted, and maps each keypress to one
 * {@link GameOverAction}.
 */

/**
 * How an {@link Outcome} tag reads to the player (Req 13.7). The engine's
 * `Outcome` is an open string tag; the slice design calls out three player-
 * facing results — a Station success (the Plot was disrupted, Req 19.4), a Plot
 * failure (the Plot ran to completion), and being *burned* (the player's cover
 * was blown, Req 19.5). This classification drives only presentation (the banner
 * word and its colour); the raw tag is always shown as the cause text too.
 */
export type OutcomeKind = 'success' | 'plot-failure' | 'burned' | 'unknown';

/**
 * The outcome tags this screen recognises, mapped to their player-facing
 * {@link OutcomeKind}. Matching is done on a normalised (lower-cased) tag and
 * also by substring, so related engine tags (`plot-success`, `cover-burned`,
 * `plot-completed`) resolve to the right banner without an exhaustive list.
 */
const SUCCESS_HINTS = ['success', 'disrupt', 'win'] as const;
const BURNED_HINTS = ['burn', 'blown', 'exposed'] as const;
const PLOT_FAILURE_HINTS = ['plot-failure', 'plot_failure', 'completed', 'fail'] as const;

/** Normalise an outcome tag for matching: trimmed and lower-cased. */
function normalise(outcome: string): string {
  return outcome.trim().toLowerCase();
}

/**
 * Classify an {@link Outcome} tag into the player-facing {@link OutcomeKind}
 * used for the game-over banner (Req 13.7). Checks for a success or burned
 * reading first (either ends the game decisively), then a Plot failure; an
 * unrecognised tag reads `unknown` and still shows its raw text as the cause.
 */
export function classifyOutcome(outcome: string): OutcomeKind {
  const tag = normalise(outcome);
  if (BURNED_HINTS.some((h) => tag.includes(h))) {
    return 'burned';
  }
  if (SUCCESS_HINTS.some((h) => tag.includes(h))) {
    return 'success';
  }
  if (PLOT_FAILURE_HINTS.some((h) => tag.includes(h))) {
    return 'plot-failure';
  }
  return 'unknown';
}

/**
 * The player-facing headline for an {@link OutcomeKind}. `unknown` falls back to
 * a neutral "Game over" so an unrecognised tag still produces a sensible banner
 * (the raw tag is shown separately as the cause).
 */
export function outcomeHeadline(kind: OutcomeKind): string {
  switch (kind) {
    case 'success':
      return 'Success — the Plot was disrupted';
    case 'plot-failure':
      return 'Failure — the Plot ran to completion';
    case 'burned':
      return 'Burned — your cover was blown';
    case 'unknown':
    default:
      return 'Game over';
  }
}

/**
 * The three options the game-over menu offers, in display order (design, "TUI":
 * "offer the debrief", plus save and quit; Req 13.7). `debrief` navigates to the
 * debrief screen (task 22.11), `save` to the save screen, and `quit` leaves the
 * game. The owning screen supplies the callback for each; the model only tracks
 * which is highlighted.
 */
export const GAME_OVER_OPTIONS = ['debrief', 'save', 'quit'] as const;

/** One selectable option on the game-over menu. */
export type GameOverOption = (typeof GAME_OVER_OPTIONS)[number];

/** The player-facing label for each game-over option. */
export const GAME_OVER_OPTION_LABELS: Readonly<Record<GameOverOption, string>> = {
  debrief: 'Open Debrief',
  save: 'Save',
  quit: 'Quit',
};

/** The game-over menu's cursor state: which option is highlighted. */
export interface GameOverState {
  /** The index of the highlighted option within {@link GAME_OVER_OPTIONS}. */
  readonly index: number;
}

/** The initial game-over state, with the cursor on the first option (Debrief). */
export function initialGameOverState(): GameOverState {
  return { index: 0 };
}

/** A game-over menu action, one per keypress the component handles. */
export type GameOverAction =
  /** Move the cursor to the next/previous option (wrapping). */
  | { readonly type: 'next' }
  | { readonly type: 'prev' }
  /** Jump the cursor to a specific option index (clamped into range). */
  | { readonly type: 'select'; readonly index: number };

/** The number of options the menu offers. */
const OPTION_COUNT = GAME_OVER_OPTIONS.length;

/** Clamp an index into `[0, OPTION_COUNT)`. */
function clampIndex(index: number): number {
  if (index < 0) {
    return 0;
  }
  if (index >= OPTION_COUNT) {
    return OPTION_COUNT - 1;
  }
  return index;
}

/** Step the index, wrapping around the fixed option list. */
function wrap(index: number, step: number): number {
  return (index + step + OPTION_COUNT) % OPTION_COUNT;
}

/**
 * The pure game-over menu reducer. Applies one {@link GameOverAction} to the
 * {@link GameOverState} and returns the next state; never mutates its input. The
 * option list is fixed ({@link GAME_OVER_OPTIONS}), so unlike the Here menu the
 * count is not passed in.
 *
 * - `next`/`prev` move the cursor one option, wrapping at the ends.
 * - `select` jumps to an index, clamped into range.
 */
export function reduceGameOver(
  state: GameOverState,
  action: GameOverAction,
): GameOverState {
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

/** The option highlighted in a given state. */
export function selectedOption(state: GameOverState): GameOverOption {
  return GAME_OVER_OPTIONS[clampIndex(state.index)] as GameOverOption;
}
