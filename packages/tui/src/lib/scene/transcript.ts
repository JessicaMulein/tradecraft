/**
 * The Scene transcript — a pure accumulator over the {@link TurnChunk} stream
 * (design, "TUI": "Scene (main): Fact Lines in plain style, then Flavour in dim
 * italic as it streams. Dialogue shows the speaker's name"; Requirements 13.2,
 * 13.4, 13.6).
 *
 * A turn method returns an async stream of {@link TurnChunk}s. The Scene pane
 * only needs the *renderable* ones — Fact Lines, Narrator flavour and dialogue
 * speech — collected in arrival order, plus a little control state (whether the
 * turn is done, was interrupted, or paused on an unreachable endpoint). This
 * module is that reducer, kept pure and separate from the Ink component so the
 * accumulation logic is unit-testable without a running stream: feed it chunks
 * one at a time and read back the transcript the pane renders.
 *
 * ## What each chunk does
 *
 * - `fact` / `flavour` / `speech` — appended to the transcript in order; these
 *   are the lines the Scene pane renders (fact plain, flavour and speech in the
 *   distinct dim/italic style, speech prefixed with the speaker, Req 13.6).
 * - `interrupted` — a failed attempt's sentences are being discarded, so any
 *   `flavour`/`speech` already shown for *this* turn is dropped (the design's
 *   "sentences from a failed attempt are being discarded"); committed `fact`
 *   lines stay, and the transcript is flagged `interrupted`.
 * - `done` — the turn finished normally; the transcript is flagged `done`.
 * - `paused` — an endpoint became unreachable; the error is recorded so the UI
 *   can show the endpoint-error screen (Req 16.1). It does not touch the lines.
 * - `ended` — the game ended this turn; the outcome is recorded (and `done` is
 *   implied, the stream is over).
 * - `notification` — not part of the Scene transcript (the status bar shows
 *   alerts); it is ignored here so the reducer stays a pure projection of the
 *   Scene's own text.
 */

import type { TurnChunk } from '@tradecraft/player-view';

/** One rendered line in the Scene transcript, in arrival order. */
export type TranscriptLine =
  /** A committed Fact Line, rendered plain (Req 13.6). */
  | { readonly kind: 'fact'; readonly text: string }
  /** A streamed Narrator sentence, rendered in the distinct style (Req 13.6). */
  | { readonly kind: 'flavour'; readonly text: string }
  /** A line of dialogue, tagged with the speaker's player-facing name. */
  | { readonly kind: 'speech'; readonly speaker: string; readonly text: string };

/** Why a paused turn stopped — the unreachable endpoint and its message. */
export interface TranscriptPause {
  readonly endpoint: string;
  readonly message: string;
}

/**
 * The accumulated Scene transcript for the current turn: the ordered lines the
 * pane renders plus the turn's control state.
 */
export interface TranscriptState {
  /** The renderable lines in arrival order. */
  readonly lines: readonly TranscriptLine[];
  /** True once a `done` or `ended` chunk has arrived (the turn is over). */
  readonly done: boolean;
  /** True once an `interrupted` chunk has arrived this turn. */
  readonly interrupted: boolean;
  /** The pause error, if an endpoint became unreachable (Req 16.1); else null. */
  readonly pause: TranscriptPause | null;
  /** The game's outcome tag, if the game ended this turn; else null. */
  readonly outcome: string | null;
}

/** The empty transcript a turn starts from. */
export const emptyTranscript: TranscriptState = {
  lines: [],
  done: false,
  interrupted: false,
  pause: null,
  outcome: null,
};

/** Append one renderable line to a transcript. */
function append(state: TranscriptState, line: TranscriptLine): TranscriptState {
  return { ...state, lines: [...state.lines, line] };
}

/**
 * Fold one {@link TurnChunk} into the {@link TranscriptState}, returning the
 * next state; never mutates its input. The Scene pane drives this per chunk as
 * the stream yields, then renders `state.lines`.
 */
export function reduceTranscript(
  state: TranscriptState,
  chunk: TurnChunk,
): TranscriptState {
  switch (chunk.kind) {
    case 'fact':
      return append(state, { kind: 'fact', text: chunk.text });
    case 'flavour':
      return append(state, { kind: 'flavour', text: chunk.text });
    case 'speech':
      return append(state, {
        kind: 'speech',
        speaker: chunk.speaker,
        text: chunk.text,
      });
    case 'interrupted':
      // The failed attempt's flavour/speech is discarded; committed facts stay.
      return {
        ...state,
        interrupted: true,
        lines: state.lines.filter((line) => line.kind === 'fact'),
      };
    case 'paused':
      return {
        ...state,
        pause: {
          endpoint: chunk.error.endpoint,
          message: chunk.error.message,
        },
      };
    case 'ended':
      return { ...state, done: true, outcome: chunk.outcome };
    case 'done':
      return { ...state, done: true };
    case 'notification':
      // Notifications are shown by the status bar, not the Scene transcript.
      return state;
    default:
      return state;
  }
}

/**
 * Fold a whole batch of chunks into a transcript at once (left fold over
 * {@link reduceTranscript}). Convenience for building a transcript from an
 * array of already-collected chunks — e.g. in tests, or when replaying a turn.
 */
export function collectTranscript(
  chunks: Iterable<TurnChunk>,
  initial: TranscriptState = emptyTranscript,
): TranscriptState {
  let state = initial;
  for (const chunk of chunks) {
    state = reduceTranscript(state, chunk);
  }
  return state;
}
