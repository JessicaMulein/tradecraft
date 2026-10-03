/**
 * The TUI start screen (design, "TUI": "Start screen: seed (shown or entered),
 * Difficulty Preset, mole toggle and narration mode, followed by the brief
 * Cable"; Requirements 1.6, 26.4, 34.3).
 *
 * The screen gathers the new-game options — the seed (shown if one was already
 * generated, or entered), the Difficulty Preset, the mole toggle and the
 * Narrator mode — and, on confirm, signals "start" with a {@link NewGameOptions}
 * object shaped exactly as the facade's `newGame` accepts. The brief Cable the
 * game opens on is rendered through {@link CableReader} once it is available.
 *
 * ## Boundary
 *
 * The screen talks to the simulation only through `@tradecraft/player-view`
 * types (Req 13.5): it imports the `NewGameOptions`/`NarrationMode` shapes and
 * the `DocumentView` the Cable reader renders, and nothing else. It does not
 * call `newGame` itself — that is passed in as the `onStart` callback and the
 * resulting `brief` as a prop — so the component is unit-testable without a live
 * engine, and a later task wires `onStart` to `EngineApi.newGame` and feeds the
 * returned `GameView.brief` back in as `brief`.
 *
 * ## Keys
 *
 * - Up/Down (or Tab/Shift+Tab) move between fields.
 * - Left/Right cycle the focused option (preset, narration) or toggle the mole.
 * - On the seed field, printable characters are typed and Backspace deletes.
 * - Enter / Return confirms and calls `onStart` with the gathered options.
 */

import { useReducer, useState, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type { DocumentView } from '@tradecraft/player-view';

import { CableReader } from './cable-reader.js';
import {
  initialStartState,
  reduceStart,
  toNewGameOptions,
  type NewGameOptions,
  type StartField,
  type StartState,
} from './options.js';

/** Props for {@link StartScreen}. */
export interface StartScreenProps {
  /**
   * The initial field values. Pass a `seed` here to show a seed the Sim already
   * generated (Req 1.6); the rest default to standard difficulty, mole on and
   * full narration.
   */
  readonly defaults?: Partial<Omit<StartState, 'focus'>>;
  /**
   * Signalled on confirm with the gathered new-game options (the facade's
   * `newGame` shape). A later task wires this to `EngineApi.newGame`.
   */
  readonly onStart: (opts: NewGameOptions) => void;
  /**
   * The brief Cable to show once the game has started (`GameView.brief`). While
   * `undefined`, the option fields are shown; once set, the brief Cable is
   * rendered through {@link CableReader} (Req 26.4). The live `newGame` wiring
   * that produces it is a later task.
   */
  readonly brief?: DocumentView;
}

/** The player-facing label for each field. */
const FIELD_LABELS: Readonly<Record<StartField, string>> = {
  seed: 'Seed',
  preset: 'Difficulty',
  mole: 'Internal mole',
  narration: 'Narration',
};

/** The displayed value for the seed field: the entry, or a "random" hint. */
function seedValue(state: StartState): string {
  return state.seed === '' ? '(random — generated on start)' : state.seed;
}

/** The displayed value for a field. */
function fieldValue(state: StartState, field: StartField): string {
  switch (field) {
    case 'seed':
      return seedValue(state);
    case 'preset':
      return state.preset;
    case 'mole':
      return state.mole ? 'on' : 'off';
    case 'narration':
      return state.narration;
    default:
      return '';
  }
}

/** One field row: a cursor marker, the label and the current value. */
function FieldRow({
  field,
  state,
}: {
  readonly field: StartField;
  readonly state: StartState;
}): ReactElement {
  const focused = state.focus === field;
  return (
    <Box>
      <Text color={focused ? 'cyan' : undefined}>
        {focused ? '> ' : '  '}
        {FIELD_LABELS[field]}: {fieldValue(state, field)}
      </Text>
    </Box>
  );
}

/**
 * The start screen. Collects the new-game options with keyboard navigation and,
 * on confirm, calls {@link StartScreenProps.onStart}. Once a {@link
 * StartScreenProps.brief} is supplied it renders the brief Cable.
 */
export function StartScreen({
  defaults,
  onStart,
  brief,
}: StartScreenProps): ReactElement {
  const [state, dispatch] = useReducer(reduceStart, initialStartState(defaults));
  const [started, setStarted] = useState(false);

  useInput((input, key) => {
    if (started) {
      return;
    }
    if (key.upArrow || (key.tab && key.shift)) {
      dispatch({ type: 'focus-prev' });
      return;
    }
    if (key.downArrow || (key.tab && !key.shift)) {
      dispatch({ type: 'focus-next' });
      return;
    }
    if (key.leftArrow) {
      dispatch({ type: 'cycle-prev' });
      return;
    }
    if (key.rightArrow) {
      dispatch({ type: 'cycle-next' });
      return;
    }
    if (key.return) {
      setStarted(true);
      onStart(toNewGameOptions(state));
      return;
    }
    if (state.focus === 'seed') {
      if (key.backspace || key.delete) {
        dispatch({ type: 'seed-backspace' });
        return;
      }
      // A printable character (no control key held) edits the seed.
      if (input !== '' && !key.ctrl && !key.meta) {
        dispatch({ type: 'seed-append', char: input });
      }
    }
  });

  if (brief !== undefined) {
    return (
      <Box flexDirection="column">
        <Text bold>Briefing Cable</Text>
        <Box marginTop={1}>
          <CableReader document={brief} />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>New Game</Text>
      <Box flexDirection="column" marginTop={1}>
        <FieldRow field="seed" state={state} />
        <FieldRow field="preset" state={state} />
        <FieldRow field="mole" state={state} />
        <FieldRow field="narration" state={state} />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ move · ←/→ change · type a seed · Enter to start
        </Text>
      </Box>
    </Box>
  );
}
