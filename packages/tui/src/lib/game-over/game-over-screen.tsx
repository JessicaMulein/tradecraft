/**
 * The TUI game-over screen (design, "TUI": when the game ends, show "a game-over
 * screen stating the outcome (success, Plot failure or burned) and the end day
 * and phase", offering the debrief; Requirements 13.7, 19.4, 19.5).
 *
 * Shown once the turn stream yields an `ended` {@link TurnChunk}. It states the
 * outcome as a headline banner (classified success / Plot failure / burned, Req
 * 13.7), the end day and phase (read from the status view's `time`), and the
 * cause / ending text (the outcome tag the engine ended on). Below the banner it
 * offers a three-item menu — Open Debrief, Save, Quit — driven by the pure
 * reducer in `./game-over.ts`.
 *
 * ## Boundary
 *
 * The screen talks to the simulation only through `@tradecraft/player-view`
 * types (Req 13.5): the `ended` chunk's view-safe `Outcome` tag and the status
 * view's `time`. It does not call `views.debrief()`, `save()` or quit itself —
 * those are the `onDebrief`/`onSave`/`onQuit` callbacks a later task wires to the
 * facade — so the component is unit-testable without a live engine. "Open
 * Debrief" navigates to the debrief screen (task 22.11); nothing truth-bearing
 * is reachable from here.
 *
 * ## Keys
 *
 * - Up/Down move between the three options (wrapping).
 * - Enter confirms the highlighted option, firing its callback.
 */

import { useReducer, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';

import { formatTime, type TimeLike } from '../scene/time.js';
import {
  GAME_OVER_OPTIONS,
  GAME_OVER_OPTION_LABELS,
  classifyOutcome,
  initialGameOverState,
  outcomeHeadline,
  reduceGameOver,
  selectedOption,
  type GameOverOption,
  type GameOverState,
  type OutcomeKind,
} from './game-over.js';

/** Props for {@link GameOverScreen}. */
export interface GameOverScreenProps {
  /**
   * The public outcome tag the game ended on (the `ended` chunk's `outcome`).
   * Classified for the banner and shown verbatim as the cause / ending text.
   */
  readonly outcome: string;
  /**
   * The end day and phase (the status view's `time` at the ending turn). Shown
   * as "Day N, <phase>" (Req 13.7).
   */
  readonly endedAt: TimeLike;
  /**
   * Navigate to the debrief screen (task 22.11), which renders
   * `views.debrief()`. Fired when the player chooses "Open Debrief".
   */
  readonly onDebrief?: () => void;
  /** Open the save screen. Fired when the player chooses "Save". */
  readonly onSave?: () => void;
  /** Leave the game. Fired when the player chooses "Quit". */
  readonly onQuit?: () => void;
}

/** The banner colour for each outcome reading. */
const BANNER_COLOUR: Readonly<Record<OutcomeKind, string | undefined>> = {
  success: 'green',
  'plot-failure': 'red',
  burned: 'red',
  unknown: 'yellow',
};

/** One menu row: a cursor marker and the option label. */
function OptionRow({
  option,
  highlighted,
}: {
  readonly option: GameOverOption;
  readonly highlighted: boolean;
}): ReactElement {
  return (
    <Box>
      <Text color={highlighted ? 'cyan' : undefined}>
        {highlighted ? '> ' : '  '}
        {GAME_OVER_OPTION_LABELS[option]}
      </Text>
    </Box>
  );
}

/**
 * The game-over screen. States the outcome, the end day and phase, and the cause
 * text, then offers the Debrief / Save / Quit menu. Up/Down move the cursor
 * (wrapping); Enter fires the highlighted option's callback.
 */
export function GameOverScreen({
  outcome,
  endedAt,
  onDebrief,
  onSave,
  onQuit,
}: GameOverScreenProps): ReactElement {
  const [state, dispatch] = useReducer(reduceGameOver, initialGameOverState());

  const kind = classifyOutcome(outcome);

  const confirm = (chosen: GameOverOption): void => {
    switch (chosen) {
      case 'debrief':
        onDebrief?.();
        return;
      case 'save':
        onSave?.();
        return;
      case 'quit':
        onQuit?.();
        return;
      default:
        return;
    }
  };

  useInput((_input, key) => {
    if (key.upArrow) {
      dispatch({ type: 'prev' });
      return;
    }
    if (key.downArrow) {
      dispatch({ type: 'next' });
      return;
    }
    if (key.return) {
      confirm(selectedOption(state));
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color={BANNER_COLOUR[kind]}>
        {outcomeHeadline(kind)}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>Ended {formatTime(endedAt)}</Text>
        <Text dimColor>Cause: {outcome}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {GAME_OVER_OPTIONS.map((option, index) => (
          <OptionRow
            key={option}
            option={option}
            highlighted={index === state.index}
          />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move · Enter to choose</Text>
      </Box>
    </Box>
  );
}

/** Re-exported for the owning screen; the current cursor option. */
export type { GameOverState };
