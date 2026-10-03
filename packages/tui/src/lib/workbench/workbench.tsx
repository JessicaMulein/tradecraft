/**
 * The Workbench — the TUI's cryptanalysis pane (design, "TUI": "Workbench: the
 * selected Intercept with metadata, frequency table, shift preview, and a
 * key/plaintext entry"; Requirements 9.5, 9.6, 25.3).
 *
 * The pane shows everything the analyst works from on one captured Intercept:
 * its traffic metadata (Channel, owner, direction, length, call sign, any
 * revealed tradecraft error), the ciphertext, the letter-frequency table, and
 * the caesar shift preview with the currently-selected shift read back
 * (Requirement 9.6). Below the aids sits the entry: the player composes either
 * a *key* (a guessed cipher spec) or a *plaintext*, and on confirm the Workbench
 * builds a {@link KeySubmission} and hands it to its `onSubmit` prop
 * (Requirement 9.5). The Workbench never verifies the submission — that is the
 * Sim's job (the `decrypt` action); the pane only collects it.
 *
 * ## Presentational + pure reducer
 *
 * The interaction logic (shift selection, mode/kind cycling, text entry, and
 * building the submission) is the pure reducer in `./workbench-entry.ts`, so it
 * is unit-tested without a TTY. This component holds that state with
 * {@link useReducer}, renders it against the {@link WorkbenchView}, maps each
 * keypress to one {@link WorkbenchAction}, and calls `onSubmit` with the built
 * submission on Enter.
 *
 * ## Boundary
 *
 * The pane reads only `@tradecraft/player-view` types (Req 13.5): the view-safe
 * {@link WorkbenchView} and the {@link KeySubmission} shape it builds (both
 * re-exported through the facade). Nothing truth-bearing is reachable — the
 * {@link WorkbenchView} carries no cipher spec and no plaintext, so the player
 * genuinely has to break the cipher.
 */

import { useReducer, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type {
  FrequencyEntry,
  KeySubmission,
  WorkbenchView,
} from '@tradecraft/player-view';

import {
  buildSubmission,
  initialWorkbenchState,
  reduceWorkbench,
  type KeyKind,
  type WorkbenchState,
} from './workbench-entry.js';

/** Props for {@link Workbench}. */
export interface WorkbenchProps {
  /** The selected Intercept's view-safe analyst surface. */
  readonly view: WorkbenchView;
  /**
   * Signalled on confirm with the composed {@link KeySubmission} (a key or a
   * plaintext). A later task wires this to the facade's `decrypt` action; the
   * Sim verifies it (Requirement 9.5), never this component.
   */
  readonly onSubmit: (submission: KeySubmission) => void;
}

/** The metadata header: Channel, owner, direction, length, call sign, error. */
function WorkbenchHeader({ view }: { readonly view: WorkbenchView }): ReactElement {
  const callsign = view.callsign !== undefined ? ` · ${view.callsign}` : '';
  return (
    <Box flexDirection="column">
      <Text bold>Intercept {view.id}</Text>
      <Text dimColor>
        {view.channel} · {view.owner} · {view.direction} · {view.length} chars
        {callsign}
      </Text>
      {view.header !== undefined && (
        <Text color="yellow">header crib: {view.header}</Text>
      )}
      {view.tradecraftError !== undefined && (
        <Text color="yellow">
          tradecraft error: {describeError(view.tradecraftError)}
        </Text>
      )}
    </Box>
  );
}

/** A one-line description of a revealed tradecraft error (Req 9.4). */
function describeError(error: NonNullable<WorkbenchView['tradecraftError']>): string {
  switch (error.kind) {
    case 'pad-reuse':
      return `pad reuse (shared with ${error.with})`;
    case 'fixed-header':
      return `fixed header "${error.header}"`;
    default:
      return 'unknown';
  }
}

/** The frequency table as a compact row of letter:count pairs with counts > 0. */
function FrequencyTable({
  frequency,
}: {
  readonly frequency: readonly FrequencyEntry[];
}): ReactElement {
  const present = frequency.filter((e) => e.count > 0);
  const cells =
    present.length === 0
      ? '(no letters)'
      : present.map((e) => `${e.letter}:${e.count}`).join('  ');
  return (
    <Box flexDirection="column">
      <Text bold>Frequency</Text>
      <Text>{cells}</Text>
    </Box>
  );
}

/** The ciphertext and the shift preview read back at the selected shift. */
function ShiftPreview({
  view,
  shift,
}: {
  readonly view: WorkbenchView;
  readonly shift: number;
}): ReactElement {
  const row = view.shiftPreview[shift];
  return (
    <Box flexDirection="column">
      <Text bold>Ciphertext</Text>
      <Text>{view.ciphertext}</Text>
      <Text bold>Shift preview (shift {shift})</Text>
      <Text>{row?.text ?? ''}</Text>
    </Box>
  );
}

/** The player-facing label for a key cipher kind. */
const KIND_LABELS: Readonly<Record<KeyKind, string>> = {
  caesar: 'Caesar',
  vigenere: 'Vigenère',
  columnar: 'Columnar',
  book: 'Book',
  otp: 'One-time pad',
};

/** The entry footer: mode, the key kind or plaintext field, and the submit hint. */
function EntryPanel({ state }: { readonly state: WorkbenchState }): ReactElement {
  const submittable = buildSubmission(state) !== undefined;
  if (state.mode === 'plaintext') {
    return (
      <Box flexDirection="column">
        <Text bold>Submit: plaintext</Text>
        <Text>plaintext: {state.text === '' ? '(empty)' : state.text}</Text>
        <Text dimColor>{submitHint(submittable)}</Text>
      </Box>
    );
  }
  // Key mode: show the chosen kind and its payload.
  const payload =
    state.keyKind === 'caesar'
      ? `shift ${state.shift}`
      : state.text === ''
        ? '(empty)'
        : state.text;
  return (
    <Box flexDirection="column">
      <Text bold>Submit: key</Text>
      <Text>
        cipher: {KIND_LABELS[state.keyKind]} · {payload}
      </Text>
      <Text dimColor>{submitHint(submittable)}</Text>
    </Box>
  );
}

/** The submit/keys hint line, reflecting whether a submission is ready. */
function submitHint(submittable: boolean): string {
  const ready = submittable ? 'Enter to submit' : 'Enter (incomplete)';
  return `↑/↓ shift · Tab mode · ←/→ cipher · type key/plaintext · ${ready}`;
}

/**
 * The Workbench pane: the {@link WorkbenchView} metadata, frequency table and
 * shift preview above the key/plaintext entry. Holds the entry state with the
 * pure reducer and calls {@link WorkbenchProps.onSubmit} with the built
 * {@link KeySubmission} on Enter.
 */
export function Workbench({ view, onSubmit }: WorkbenchProps): ReactElement {
  const [state, dispatch] = useReducer(reduceWorkbench, initialWorkbenchState());

  useInput((input, key) => {
    if (key.upArrow) {
      dispatch({ type: 'shiftUp' });
      return;
    }
    if (key.downArrow) {
      dispatch({ type: 'shiftDown' });
      return;
    }
    if (key.tab) {
      dispatch({ type: 'toggleMode' });
      return;
    }
    if (key.leftArrow) {
      dispatch({ type: 'prevKind' });
      return;
    }
    if (key.rightArrow) {
      dispatch({ type: 'nextKind' });
      return;
    }
    if (key.return) {
      const submission = buildSubmission(state);
      if (submission !== undefined) {
        onSubmit(submission);
      }
      return;
    }
    if (key.backspace || key.delete) {
      dispatch({ type: 'backspaceText' });
      return;
    }
    // A printable character (no control key held) edits the text field. The
    // reducer appends from its own current state, so a burst of keystrokes
    // before a re-render accumulates correctly rather than racing a stale
    // closure value.
    if (input !== '' && !key.ctrl && !key.meta) {
      dispatch({ type: 'appendText', char: input });
    }
  });

  return (
    <Box flexDirection="column">
      <WorkbenchHeader view={view} />
      <Box marginTop={1}>
        <FrequencyTable frequency={view.frequency} />
      </Box>
      <Box marginTop={1}>
        <ShiftPreview view={view} shift={state.shift} />
      </Box>
      <Box marginTop={1}>
        <EntryPanel state={state} />
      </Box>
    </Box>
  );
}
