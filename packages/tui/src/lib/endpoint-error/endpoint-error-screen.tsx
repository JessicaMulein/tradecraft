/**
 * The endpoint-error screen — shown when a turn pauses because the LLM endpoint
 * became unreachable (design, "TUI": "Endpoint error screen: shown on a
 * `paused` chunk. It names the endpoint and message and offers retry
 * (`retry()`) or save and quit. Dialogue stays paused until one is chosen";
 * Requirements 13.10, 16.1).
 *
 * The engine streams a `paused` {@link TurnChunk} carrying the unreachable
 * endpoint's name and a message. This screen renders that error — naming the
 * endpoint plainly so the player knows which service is down — and a two-choice
 * menu: Retry, which asks the owning screen to re-run the paused turn through
 * the facade's `retry()`, and Save and Quit. The turn stays paused until the
 * player chooses one (the component does not resume anything on its own).
 *
 * ## Presentational, over a pure reducer
 *
 * Navigation is the pure reducer in `./menu.ts` (`reduceEndpointMenu`): the
 * component holds the {@link EndpointMenuState}, renders the highlighted choice,
 * and maps each keypress to one {@link EndpointMenuAction}. Up/Down move the
 * cursor (wrapping); Enter fires the chosen handler. The screen reports the
 * choice through `onRetry`/`onSaveAndQuit`; what each does — calling the
 * facade's `retry()` or triggering a save — is the owning screen's concern.
 *
 * ## Boundary
 *
 * The screen reads only `@tradecraft/player-view` types (Req 13.5): the
 * view-safe `paused` {@link TurnChunk} variant (the endpoint name and message).
 * Nothing truth-bearing is reachable.
 */

import { useReducer, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type { TurnChunk } from '@tradecraft/player-view';

import {
  ENDPOINT_CHOICES,
  initialEndpointMenuState,
  reduceEndpointMenu,
  selectedChoice,
  type EndpointChoice,
} from './menu.js';

/**
 * The `paused` {@link TurnChunk}'s error payload: the unreachable endpoint's
 * name and the message to show. Derived from the player-view `TurnChunk` union
 * so the screen stays in step with the facade's shape without importing an
 * internal type.
 */
export type PausedError = Extract<TurnChunk, { kind: 'paused' }>['error'];

/** The player-facing label for each choice. */
const CHOICE_LABELS: Readonly<Record<EndpointChoice, string>> = {
  retry: 'Retry',
  'save-and-quit': 'Save and Quit',
};

/** Props for {@link EndpointErrorScreen}. */
export interface EndpointErrorScreenProps {
  /** The paused turn's error: the unreachable endpoint and its message. */
  readonly error: PausedError;
  /**
   * Signalled when the player chooses Retry. The owning screen re-runs the
   * paused turn through the facade's `retry()`.
   */
  readonly onRetry?: () => void;
  /**
   * Signalled when the player chooses Save and Quit. The owning screen saves
   * the game and leaves.
   */
  readonly onSaveAndQuit?: () => void;
}

/** One menu row: a cursor marker and the choice's label. */
function ChoiceRow({
  label,
  highlighted,
}: {
  readonly label: string;
  readonly highlighted: boolean;
}): ReactElement {
  return (
    <Box>
      <Text color={highlighted ? 'cyan' : undefined}>
        {highlighted ? '> ' : '  '}
        {label}
      </Text>
    </Box>
  );
}

/**
 * The endpoint-error screen: a clear message naming the unreachable endpoint,
 * above a Retry / Save and Quit menu. Up/Down move the cursor (wrapping); Enter
 * fires the chosen handler. The turn stays paused until the player chooses.
 */
export function EndpointErrorScreen({
  error,
  onRetry,
  onSaveAndQuit,
}: EndpointErrorScreenProps): ReactElement {
  const [state, dispatch] = useReducer(
    reduceEndpointMenu,
    initialEndpointMenuState(),
  );

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
      const choice = selectedChoice(state);
      if (choice === 'retry') {
        onRetry?.();
      } else {
        onSaveAndQuit?.();
      }
    }
  });

  const current = selectedChoice(state);

  return (
    <Box flexDirection="column">
      <Text bold color="red">
        Endpoint unreachable
      </Text>
      <Text>The endpoint "{error.endpoint}" could not be reached.</Text>
      <Text dimColor>{error.message}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>The turn is paused. Choose how to continue:</Text>
        {ENDPOINT_CHOICES.map((choice) => (
          <ChoiceRow
            key={choice}
            label={CHOICE_LABELS[choice]}
            highlighted={choice === current}
          />
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ choose · Enter to confirm</Text>
      </Box>
    </Box>
  );
}
