/**
 * The Feed composer (design, "TUI": "Feed composer: pick Case File Claims or
 * compose a Proposition (predicate, then subject, object, place and window,
 * chosen only from known entities). It shows `validateFeed` errors inline";
 * Requirements 13.1, 37.1, 37.2).
 *
 * The composer lets the player choose what a turned agent tells their handler.
 * It renders two modes — a selectable list of Case File Claims to toggle into
 * the feed, and a form that composes a Proposition from the player's known
 * entities — and on submit runs the injected `validateFeed` over the assembled
 * {@link FeedItem} list, showing any {@link FeedError}s inline — each tagged
 * with the failing item and field (or the feed itself for a count error) — and
 * refusing to submit while errors are present.
 *
 * ## Presentational, with the data and validator threaded in
 *
 * The composer never reaches the facade. The owning screen supplies the Claims
 * (`claims`), the known entities for composing (`options`, derived from a
 * {@link PeopleView} and the content Predicate Vocabulary), and injects the
 * `validateFeed` function — so the screen is unit-testable with a fake validator
 * that returns real {@link FeedError}s, rather than depending on the facade
 * stub's always-ok behaviour. When the assembled feed validates, the composer
 * signals it through `onSubmit(items)`. A later screen task wires `validateFeed`
 * to `EngineApi.validateFeed` and `onSubmit` to the `feed` action.
 *
 * ## Boundary
 *
 * The composer reads only `@tradecraft/player-view` types (Req 13.5): the
 * view-safe {@link ClaimView}, the facade-re-exported {@link FeedItem} /
 * {@link FeedError}, and the {@link Result} helper.
 *
 * ## Keys
 *
 * - Tab switches between the Claims and Compose modes.
 * - Up/Down move the Claim cursor (Claims mode) or the compose field focus
 *   (Compose mode); Left/Right cycle the focused compose field's option.
 * - Space toggles the highlighted Claim into/out of the feed (Claims mode).
 * - `a` stages the composed Proposition; `d` removes the last staged one
 *   (Compose mode).
 * - Enter submits: it runs `validateFeed` over the assembled items; on success
 *   it calls `onSubmit(items)`, otherwise it shows the errors inline.
 */

import { useReducer, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ClaimView, FeedError, FeedItem, Result } from '@tradecraft/player-view';

import {
  assembleFeed,
  currentComposed,
  fieldLabel,
  initialFeedState,
  reduceFeed,
  COMPOSE_FIELDS,
  type ComposeOptions,
  type FeedState,
} from './feed.js';

/** The injected validator: pure over the assembled items (facade `validateFeed`). */
export type ValidateFeed = (
  items: readonly FeedItem[],
) => Result<void, FeedError[]>;

/** Props for {@link FeedComposer}. */
export interface FeedComposerProps {
  /** The player's Case File Claims the composer can pick from. */
  readonly claims: readonly ClaimView[];
  /** The option lists the compose form cycles each field through. */
  readonly options: ComposeOptions;
  /**
   * The feed validator (the facade's `validateFeed`, or a fake in tests).
   * Injected so the composer is testable without the facade stub.
   */
  readonly validateFeed: ValidateFeed;
  /** Signalled with the assembled items once they validate. */
  readonly onSubmit?: (items: readonly FeedItem[]) => void;
}

/** Render a Proposition's object (an entity id or a literal) readably. */
function objectLabel(object: ClaimView['prop']['object']): string {
  if (typeof object === 'string') {
    return object;
  }
  switch (object.kind) {
    case 'amount':
      return String(object.value);
    case 'time':
      return `day ${object.value.day} phase ${object.value.phase}`;
    case 'text':
    default:
      return object.value;
  }
}

/** Render a Claim's Proposition as a readable `subject predicate object` line. */
function propLabel(prop: ClaimView['prop']): string {
  const base = `${prop.subject} ${prop.predicate} ${objectLabel(prop.object)}`;
  return prop.place === undefined ? base : `${base} @ ${prop.place}`;
}

/** One Claim row: cursor marker, selection checkbox and the Proposition. */
function ClaimRow({
  claim,
  focused,
  selected,
}: {
  readonly claim: ClaimView;
  readonly focused: boolean;
  readonly selected: boolean;
}): ReactElement {
  return (
    <Box>
      <Text color={focused ? 'cyan' : undefined}>
        {focused ? '> ' : '  '}
        {selected ? '[x] ' : '[ ] '}
        {propLabel(claim.prop)}
      </Text>
    </Box>
  );
}

/**
 * Where a {@link FeedError} points, rendered for the inline list. A count error
 * (`index: -1` on `field: 'items'`) is a feed-level problem, so it reads as the
 * feed itself rather than "item -1"; every other error names its 1-based item
 * number and the field at fault so the player can see exactly what failed.
 */
function errorLocation(error: FeedError): string {
  if (error.index < 0) {
    return `Feed (${error.field})`;
  }
  return `Item ${error.index + 1} (${error.field})`;
}

/** The chosen option label for a compose field, or a dash when none. */
function chosenLabel(
  field: (typeof COMPOSE_FIELDS)[number],
  state: FeedState,
  options: ComposeOptions,
): string {
  switch (field) {
    case 'predicate':
      return options.predicates[state.selection.predicate]?.label ?? '—';
    case 'subject':
      return options.subjects[state.selection.subject]?.label ?? '—';
    case 'object':
      return options.objects[state.selection.object]?.label ?? '—';
    case 'place':
      return options.places[state.selection.place]?.label ?? '—';
    default:
      return '—';
  }
}

/**
 * The Feed composer. Renders the Claims list or the compose form by mode, drives
 * the pure {@link reduceFeed} reducer from key presses, and on Enter validates
 * the assembled feed with the injected `validateFeed`, surfacing errors inline
 * and calling `onSubmit` only when the feed validates.
 */
export function FeedComposer({
  claims,
  options,
  validateFeed,
  onSubmit,
}: FeedComposerProps): ReactElement {
  const [state, dispatch] = useReducer(
    reduceFeed,
    { claimCount: claims.length },
    initialFeedState,
  );

  // Keep the reducer's clamp bound to the current shown count.
  if (state.claimCount !== claims.length) {
    dispatch({ type: 'set-claim-count', count: claims.length });
  }

  // Re-run the validator on each render so the inline errors reflect the current
  // feed; only shown once a submit attempt set the flag.
  const items = assembleFeed(state);
  const result = validateFeed(items);
  const errors = result.ok ? [] : result.error;

  const focusedClaim = claims[state.claimCursor];

  const submit = (): void => {
    const next = validateFeed(assembleFeed(state));
    if (next.ok) {
      onSubmit?.(assembleFeed(state));
    } else {
      dispatch({ type: 'mark-errors' });
    }
  };

  useInput((input, key) => {
    if (key.tab) {
      dispatch({ type: 'mode-toggle' });
      return;
    }
    if (key.return) {
      submit();
      return;
    }
    if (state.mode === 'claims') {
      if (key.downArrow) {
        dispatch({ type: 'claim-next' });
        return;
      }
      if (key.upArrow) {
        dispatch({ type: 'claim-prev' });
        return;
      }
      if (input === ' ' && focusedClaim !== undefined) {
        dispatch({ type: 'claim-toggle', id: focusedClaim.id });
        return;
      }
      return;
    }
    // Compose mode.
    if (key.downArrow) {
      dispatch({ type: 'field-next' });
      return;
    }
    if (key.upArrow) {
      dispatch({ type: 'field-prev' });
      return;
    }
    if (key.rightArrow) {
      dispatch({ type: 'option-next', options });
      return;
    }
    if (key.leftArrow) {
      dispatch({ type: 'option-prev', options });
      return;
    }
    if (input === 'a') {
      dispatch({ type: 'compose-add', options });
      return;
    }
    if (input === 'd') {
      dispatch({ type: 'compose-remove-last' });
      return;
    }
  });

  const draft = currentComposed(state.selection, options);

  return (
    <Box flexDirection="column">
      <Text bold>Feed composer</Text>
      <Box marginTop={1}>
        <Text dimColor>
          Mode: {state.mode === 'claims' ? '[Claims] Compose' : 'Claims [Compose]'}
          {' · '}
          {items.length} item{items.length === 1 ? '' : 's'}
        </Text>
      </Box>

      {state.mode === 'claims' ? (
        <Box flexDirection="column" marginTop={1}>
          {claims.length === 0 ? (
            <Text dimColor>No Claims to pick from.</Text>
          ) : (
            claims.map((claim, index) => (
              <ClaimRow
                key={claim.id}
                claim={claim}
                focused={index === state.claimCursor}
                selected={state.selected.includes(claim.id)}
              />
            ))
          )}
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {COMPOSE_FIELDS.map((field) => (
            <Text key={field} color={state.field === field ? 'cyan' : undefined}>
              {state.field === field ? '> ' : '  '}
              {fieldLabel(field)}: {chosenLabel(field, state, options)}
            </Text>
          ))}
          <Box marginTop={1}>
            <Text dimColor>
              {draft === undefined
                ? 'Incomplete Proposition'
                : `Draft: ${draft.subject} ${draft.predicate} ${objectLabel(draft.object)}`}
            </Text>
          </Box>
          <Box>
            <Text dimColor>
              Composed: {state.composed.length} staged
            </Text>
          </Box>
        </Box>
      )}

      {state.errorsShown && errors.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="red" bold>
            Cannot submit — {errors.length} error
            {errors.length === 1 ? '' : 's'}:
          </Text>
          {errors.map((error, index) => (
            <Text key={`${index}-${error.field}-${error.reason}`} color="red">
              • {errorLocation(error)}: {error.reason}
            </Text>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>
          Tab mode · ↑/↓ {state.mode === 'claims' ? 'select' : 'field'} ·{' '}
          {state.mode === 'claims'
            ? 'Space toggle'
            : '←/→ option · a add · d remove'}{' '}
          · Enter submit
        </Text>
      </Box>
    </Box>
  );
}
