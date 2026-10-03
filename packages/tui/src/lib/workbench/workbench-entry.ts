/**
 * The Workbench's entry and shift-selection state, and the pure reducer that
 * drives it (design, "TUI": "Workbench: the selected Intercept with metadata,
 * frequency table, shift preview, and a key/plaintext entry"; Requirements 9.5,
 * 9.6).
 *
 * The Workbench lets the player do two things while they stare at a ciphertext:
 * slide a caesar shift (`0..25`) through the shift preview to eyeball a Caesar
 * (Requirement 9.6), and compose a decryption attempt — either a *key* (a
 * guessed {@link CipherSpec}) or a *plaintext* — to submit (Requirement 9.5).
 * The Sim verifies the submission; the Workbench only collects it.
 *
 * All of that interaction logic lives here as a pure function of (state,
 * action) so it can be unit-tested without a TTY: the {@link Workbench}
 * component holds this state, renders it, maps each keypress to one
 * {@link WorkbenchAction}, and on submit builds the {@link KeySubmission} with
 * {@link buildSubmission} and hands it to its `onSubmit` prop. The reducer
 * decides nothing about verification — whether the key or plaintext is correct
 * is the Sim's job (the `decrypt` action), never the client's.
 */

import {
  BOOK_SCHEMES,
  type BookScheme,
  type CipherSpec,
  type KeySubmission,
} from '@tradecraft/player-view';

/** The number of caesar shifts the preview offers, `0..25`. */
const SHIFT_COUNT = 26;

/**
 * The cipher kinds a player may submit a *key* for, in the order the entry
 * cycles through them. Mirrors the engine's {@link CipherSpec} union; the
 * component shows one at a time and the player cycles to the kind they believe
 * the Intercept uses.
 */
export const KEY_KINDS = [
  'caesar',
  'vigenere',
  'columnar',
  'book',
  'otp',
] as const;

/** A cipher kind the key entry can compose. */
export type KeyKind = (typeof KEY_KINDS)[number];

/** Which kind of submission the entry is composing. */
export type EntryMode = 'key' | 'plaintext';

/**
 * The Workbench's interaction state.
 *
 * - `shift` — the caesar shift currently highlighted in the shift preview
 *   (`0..25`); a pure view aid, it never forms part of a non-caesar submission.
 * - `mode` — whether the entry is composing a key or a plaintext.
 * - `keyKind` — the {@link CipherSpec} kind the key entry is composing (only
 *   meaningful when `mode` is `key`).
 * - `text` — the free-text field: the plaintext in `plaintext` mode, or the
 *   key's text payload in `key` mode (the Vigenère/columnar keyword, the book
 *   text id, the OTP pad id — Caesar reads its shift from `shift`, not `text`).
 */
export interface WorkbenchState {
  readonly shift: number;
  readonly mode: EntryMode;
  readonly keyKind: KeyKind;
  readonly text: string;
}

/** The initial Workbench state: shift 0, composing a caesar key, empty text. */
export function initialWorkbenchState(): WorkbenchState {
  return { shift: 0, mode: 'key', keyKind: 'caesar', text: '' };
}

/** One Workbench action, one per keypress the component handles. */
export type WorkbenchAction =
  /** Step the highlighted caesar shift up/down (wrapping `0..25`). */
  | { readonly type: 'shiftUp' }
  | { readonly type: 'shiftDown' }
  /** Jump the shift to a specific value (clamped/wrapped into `0..25`). */
  | { readonly type: 'setShift'; readonly shift: number }
  /** Toggle between composing a key and composing a plaintext. */
  | { readonly type: 'toggleMode' }
  /** Set the entry mode explicitly. */
  | { readonly type: 'setMode'; readonly mode: EntryMode }
  /** Cycle the key cipher kind to the next/previous one (wrapping). */
  | { readonly type: 'nextKind' }
  | { readonly type: 'prevKind' }
  /** Set the key cipher kind explicitly. */
  | { readonly type: 'setKind'; readonly kind: KeyKind }
  /** Replace the free-text field (the plaintext or the key's text payload). */
  | { readonly type: 'setText'; readonly text: string }
  /** Append a typed character to the free-text field. */
  | { readonly type: 'appendText'; readonly char: string }
  /** Delete the last character of the free-text field. */
  | { readonly type: 'backspaceText' };

/** Wrap a value into `[0, count)`. */
function wrap(n: number, count: number): number {
  return ((n % count) + count) % count;
}

/**
 * The pure Workbench reducer. Applies one {@link WorkbenchAction} against the
 * {@link WorkbenchState} and returns the next state; never mutates its input.
 *
 * - `shiftUp`/`shiftDown`/`setShift` move the highlighted caesar shift,
 *   wrapping `0..25`.
 * - `toggleMode`/`setMode` switch between key and plaintext entry.
 * - `nextKind`/`prevKind`/`setKind` choose the key's cipher kind, wrapping the
 *   {@link KEY_KINDS} list.
 * - `setText` replaces the free-text field.
 *
 * Switching mode or kind never clears the text field — the player may paste
 * once and try it as a plaintext and as a key payload — so the reducer only
 * ever changes the field named by the action.
 */
export function reduceWorkbench(
  state: WorkbenchState,
  action: WorkbenchAction,
): WorkbenchState {
  switch (action.type) {
    case 'shiftUp':
      return { ...state, shift: wrap(state.shift + 1, SHIFT_COUNT) };
    case 'shiftDown':
      return { ...state, shift: wrap(state.shift - 1, SHIFT_COUNT) };
    case 'setShift':
      return { ...state, shift: wrap(Math.trunc(action.shift), SHIFT_COUNT) };
    case 'toggleMode':
      return { ...state, mode: state.mode === 'key' ? 'plaintext' : 'key' };
    case 'setMode':
      return { ...state, mode: action.mode };
    case 'nextKind':
      return { ...state, keyKind: stepKind(state.keyKind, 1) };
    case 'prevKind':
      return { ...state, keyKind: stepKind(state.keyKind, -1) };
    case 'setKind':
      return { ...state, keyKind: action.kind };
    case 'setText':
      return { ...state, text: action.text };
    case 'appendText':
      return { ...state, text: state.text + action.char };
    case 'backspaceText':
      return { ...state, text: state.text.slice(0, -1) };
    default:
      return state;
  }
}

/** Step the key kind by `step` through {@link KEY_KINDS}, wrapping. */
function stepKind(kind: KeyKind, step: number): KeyKind {
  const i = KEY_KINDS.indexOf(kind);
  return KEY_KINDS[wrap(i + step, KEY_KINDS.length)];
}

/**
 * Build the {@link CipherSpec} the key entry currently composes, or `undefined`
 * when the entry is incomplete (a Vigenère/columnar keyword, book text id or
 * OTP pad id with no text yet). A Caesar key reads its shift from `state.shift`
 * and so is always buildable; the book scheme defaults to the slice's single
 * {@link BOOK_SCHEMES} entry.
 */
export function buildKeySpec(state: WorkbenchState): CipherSpec | undefined {
  const text = state.text.trim();
  switch (state.keyKind) {
    case 'caesar':
      return { kind: 'caesar', shift: state.shift };
    case 'vigenere':
      return text === '' ? undefined : { kind: 'vigenere', key: text };
    case 'columnar':
      return text === '' ? undefined : { kind: 'columnar', key: text };
    case 'book': {
      if (text === '') {
        return undefined;
      }
      const scheme: BookScheme = BOOK_SCHEMES[0];
      // The text payload names the public-text DocId the book cipher keys to.
      // `DocId` is a branded string the TUI cannot import across the facade
      // boundary, so the player-entered id is widened to the `book` spec here;
      // the Sim validates the reference when it verifies the submission.
      return { kind: 'book', textId: text, scheme } as CipherSpec;
    }
    case 'otp':
      return text === '' ? undefined : { kind: 'otp', padId: text };
    default:
      return undefined;
  }
}

/**
 * Build the {@link KeySubmission} the Workbench would submit from the current
 * state, or `undefined` when it is not yet submittable.
 *
 * - In `plaintext` mode the submission is the trimmed text; an empty field is
 *   not submittable.
 * - In `key` mode the submission wraps the {@link CipherSpec} from
 *   {@link buildKeySpec}; an incomplete key is not submittable.
 *
 * Pure: it reads only the state and never decides whether the submission is
 * *correct* — the Sim verifies that (the `decrypt` action; Requirement 9.5).
 */
export function buildSubmission(state: WorkbenchState): KeySubmission | undefined {
  if (state.mode === 'plaintext') {
    const text = state.text.trim();
    return text === '' ? undefined : { kind: 'plaintext', text };
  }
  const spec = buildKeySpec(state);
  return spec === undefined ? undefined : { kind: 'key', spec };
}
