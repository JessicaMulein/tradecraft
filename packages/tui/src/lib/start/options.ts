/**
 * The start-screen's new-game options and the pure reducer that drives them
 * (design, "TUI": "Start screen: seed (shown or entered), Difficulty Preset,
 * mole toggle and narration mode"; Requirements 1.6, 34.3).
 *
 * The reducer is kept separate from the Ink component so the option logic —
 * which field is focused, cycling the preset, toggling the mole, editing the
 * seed — is a pure function that can be unit-tested without a TTY. The
 * {@link StartScreen} component holds this state and renders it; it dispatches
 * one {@link StartAction} per keypress and reads back the {@link StartState}.
 *
 * The options object the screen produces, {@link NewGameOptions}, is exactly the
 * shape the facade's `newGame` accepts, so the screen's `onStart` can be wired
 * straight to `EngineApi.newGame` by a later task without any translation.
 */

import { NARRATION_MODES, type NarrationMode } from '@tradecraft/player-view';

/**
 * The three Difficulty Presets the start screen offers (design, "Difficulty
 * Presets"; Requirement 34.3). The preset id is passed to `newGame` as a
 * string; the content pack resolves it to the concrete tuning values, so the
 * TUI only needs the id to select.
 */
export const DIFFICULTY_PRESETS = ['easy', 'standard', 'hard'] as const;

/** A Difficulty Preset id the start screen offers. */
export type DifficultyPresetId = (typeof DIFFICULTY_PRESETS)[number];

/**
 * The new-game options the start screen gathers, exactly the shape the facade's
 * `newGame` accepts (design `EngineApi.newGame`). `seed` is omitted when the
 * player leaves the seed blank, so the Sim generates and displays one (Req 1.6);
 * `preset` is the Difficulty Preset id (Req 34.3); `mole` toggles the internal
 * mole; `narration` is the Narrator mode.
 */
export interface NewGameOptions {
  readonly seed?: string;
  readonly preset: string;
  readonly mole: boolean;
  readonly narration: NarrationMode;
}

/** The four fields the start screen walks through, in display order. */
export const START_FIELDS = ['seed', 'preset', 'mole', 'narration'] as const;

/** One focusable field on the start screen. */
export type StartField = (typeof START_FIELDS)[number];

/** The start screen's full editable state. */
export interface StartState {
  /** The field the cursor is on. */
  readonly focus: StartField;
  /**
   * The seed text as entered. Empty means "no seed supplied" — the Sim will
   * generate and display one (Req 1.6). A non-empty value is sent as `seed`.
   */
  readonly seed: string;
  /** The selected Difficulty Preset id (Req 34.3). */
  readonly preset: DifficultyPresetId;
  /** Whether the internal mole is enabled. */
  readonly mole: boolean;
  /** The Narrator mode. */
  readonly narration: NarrationMode;
}

/**
 * The initial start-screen state. A caller may pass defaults — e.g. a seed the
 * Sim already generated, to show it rather than leave the field blank — and the
 * rest fall back to a sensible new-game default (standard difficulty, mole off,
 * full narration), with the cursor on the seed field.
 */
export function initialStartState(
  defaults: Partial<Omit<StartState, 'focus'>> = {},
): StartState {
  return {
    focus: 'seed',
    seed: defaults.seed ?? '',
    preset: defaults.preset ?? 'standard',
    mole: defaults.mole ?? false,
    narration: defaults.narration ?? 'full',
  };
}

/** A start-screen action, one per keypress the component handles. */
export type StartAction =
  /** Move the cursor to the next/previous field (wrapping). */
  | { readonly type: 'focus-next' }
  | { readonly type: 'focus-prev' }
  /** Cycle the focused option field left/right (preset, mole, narration). */
  | { readonly type: 'cycle-next' }
  | { readonly type: 'cycle-prev' }
  /** Append a character to the seed (only meaningful when seed is focused). */
  | { readonly type: 'seed-append'; readonly char: string }
  /** Delete the last seed character. */
  | { readonly type: 'seed-backspace' };

/** Advance an index within a list, wrapping, by `step` (+1 or -1). */
function cycle<T>(items: readonly T[], current: T, step: number): T {
  const index = items.indexOf(current);
  const base = index === -1 ? 0 : index;
  const next = (base + step + items.length) % items.length;
  return items[next] as T;
}

/** Move the focus to an adjacent field, wrapping around the list. */
function stepFocus(focus: StartField, step: number): StartField {
  return cycle(START_FIELDS, focus, step);
}

/**
 * Cycle the value of whichever option field is focused by `step` (+1 next, −1
 * previous). The seed field has no cycle behaviour (it is edited by typing), so
 * it is returned unchanged. The mole is a two-state toggle, so either direction
 * flips it.
 */
function cycleFocused(state: StartState, step: number): StartState {
  switch (state.focus) {
    case 'preset':
      return { ...state, preset: cycle(DIFFICULTY_PRESETS, state.preset, step) };
    case 'mole':
      return { ...state, mole: !state.mole };
    case 'narration':
      return { ...state, narration: cycle(NARRATION_MODES, state.narration, step) };
    case 'seed':
    default:
      return state;
  }
}

/**
 * The pure start-screen reducer (design, "Start screen"). Applies one
 * {@link StartAction} to the {@link StartState} and returns the next state;
 * never mutates its input. The {@link StartScreen} component maps each keypress
 * to an action and feeds it here, so the whole screen's behaviour is testable
 * as a pure function.
 */
export function reduceStart(state: StartState, action: StartAction): StartState {
  switch (action.type) {
    case 'focus-next':
      return { ...state, focus: stepFocus(state.focus, 1) };
    case 'focus-prev':
      return { ...state, focus: stepFocus(state.focus, -1) };
    case 'cycle-next':
      return cycleFocused(state, 1);
    case 'cycle-prev':
      return cycleFocused(state, -1);
    case 'seed-append':
      return state.focus === 'seed'
        ? { ...state, seed: state.seed + action.char }
        : state;
    case 'seed-backspace':
      return state.focus === 'seed'
        ? { ...state, seed: state.seed.slice(0, -1) }
        : state;
    default:
      return state;
  }
}

/**
 * Project the editable {@link StartState} to the {@link NewGameOptions} the
 * facade's `newGame` accepts. An empty seed is dropped (so the Sim generates and
 * displays one, Req 1.6); a non-empty seed is trimmed and sent. The preset, mole
 * and narration pass through as chosen.
 */
export function toNewGameOptions(state: StartState): NewGameOptions {
  const seed = state.seed.trim();
  return {
    ...(seed === '' ? {} : { seed }),
    preset: state.preset,
    mole: state.mole,
    narration: state.narration,
  };
}
