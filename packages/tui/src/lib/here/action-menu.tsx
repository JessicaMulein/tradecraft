/**
 * The action menu — the "allowed actions with quotes" half of the Here pane
 * (design, "TUI": "Here (side): … and allowed actions with quotes"; Requirements
 * 13.1, 21.5).
 *
 * The menu lists the current Location's {@link ActionOption}s — every action the
 * UI offers (Req 13.1), as produced by the facade's `actions()` — one row each,
 * showing the action kind and its {@link ActionQuote}. An allowed option shows
 * its phase and money cost; a disallowed option is dimmed and shows the quote's
 * `reason` so the player always sees *why* it cannot be taken (Req 21.5). A
 * cursor highlights one row.
 *
 * ## Presentational, over a pure reducer
 *
 * Navigation is a pure reducer in `./menu.ts` (`reduceMenu`): the component holds
 * the {@link MenuState}, renders the row at `state.index` as highlighted, and
 * maps each keypress to one {@link MenuAction}. Up/Down move the cursor
 * (wrapping); Enter signals the highlighted option through `onChoose`. The option
 * list itself is a prop, so acting is the owning screen's concern — the menu only
 * reports the chosen option, and the screen gates on its `allowed` flag.
 *
 * The cursor may rest on a disallowed option so its reason can be read (Req
 * 21.5); choosing one still fires `onChoose`, and the owning screen declines it.
 *
 * ## Boundary
 *
 * The menu reads only `@tradecraft/player-view` types (Req 13.5): the view-safe
 * {@link ActionOption} (an `Action` kind with its {@link ActionQuote}). Nothing
 * truth-bearing is reachable.
 */

import { useEffect, useReducer, type ReactElement } from 'react';
import { Box, Text, useInput } from 'ink';
import { describeCatalogueAction, type ActionOption } from '@tradecraft/player-view';

import { initialMenuState, reduceMenu, type MenuState } from './menu.js';

/** Props for {@link ActionMenu}. */
export interface ActionMenuProps {
  /**
   * The actions the current Location offers, with their quotes (the facade's
   * `actions()` result). Rendered in order; disallowed ones show their reason.
   */
  readonly options: readonly ActionOption[];
  /**
   * Signalled with the highlighted option when the player confirms (Enter). The
   * owning screen gates on the option's `quote.allowed` before acting.
   */
  readonly onChoose?: (option: ActionOption) => void;
  /**
   * Names a row from what the player knows. When omitted, the row uses the
   * shared catalogue phrase.
   */
  readonly label?: (option: ActionOption) => string;
}

/** An allowed action's cost, e.g. "1 phase" or "2 phases, 20". */
function allowedCost(phases: number, money: number): string {
  const phaseLabel = `${phases} ${phases === 1 ? 'phase' : 'phases'}`;
  return money > 0 ? `${phaseLabel}, ${money}` : phaseLabel;
}

/** The row name. Street actions use the same phrases as the web shell. */
function actionLabel(option: ActionOption, label?: (option: ActionOption) => string): string {
  return label === undefined ? describeCatalogueAction(option.action) : label(option);
}

/**
 * One row per allowed action. Disallowed actions collapse to one line per kind
 * and reason, so twenty copies of the same refusal do not fill the menu.
 */
function menuRows(
  options: readonly ActionOption[],
  label?: (option: ActionOption) => string,
): { readonly option: ActionOption; readonly label: string }[] {
  const rows: { option: ActionOption; label: string }[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    if (!option.quote.allowed) {
      const key = `${option.action.kind}\0${option.quote.reason ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    rows.push({ option, label: actionLabel(option, label) });
  }
  return rows;
}

/** The quote summary for a row: the cost when allowed, the reason when not. */
function quoteLabel(option: ActionOption): string {
  const { allowed, reason, phases, money } = option.quote;
  if (allowed) {
    return allowedCost(phases, money);
  }
  // Disallowed options always surface *why* (Req 21.5); fall back to a plain
  // "unavailable" when the quote carried no reason string.
  return reason === undefined || reason === '' ? 'unavailable' : reason;
}

/** One menu row: a cursor marker, the action kind and its quote summary. */
function ActionRow({
  option,
  label,
  highlighted,
}: {
  readonly option: ActionOption;
  readonly label: string;
  readonly highlighted: boolean;
}): ReactElement {
  const allowed = option.quote.allowed;
  return (
    <Box>
      <Text
        color={highlighted ? 'cyan' : undefined}
        // Disallowed options read dim so the eye skips them, but the row — and
        // its reason — is still shown (Req 21.5).
        dimColor={!allowed}
      >
        {highlighted ? '> ' : '  '}
        {label} — {quoteLabel(option)}
      </Text>
    </Box>
  );
}

/**
 * The action menu: a cursored list of the Location's {@link ActionOption}s. Each
 * row shows the action kind and its quote — the cost when allowed, the reason
 * when not (Req 21.5). Up/Down move the cursor (wrapping); Enter chooses the
 * highlighted option.
 */
export function ActionMenu({ options, onChoose, label }: ActionMenuProps): ReactElement {
  const rows = menuRows(options, label);
  const [state, dispatch] = useReducer(
    (s: MenuState, a: Parameters<typeof reduceMenu>[1]) =>
      reduceMenu(s, a, rows.length),
    initialMenuState(),
  );

  // Re-clamp the cursor if the option list changes length under it (a new turn
  // may offer a different set), so it never points past the end.
  useEffect(() => {
    dispatch({ type: 'clamp' });
  }, [rows.length]);

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
      const chosen = rows[state.index]?.option;
      if (chosen !== undefined) {
        onChoose?.(chosen);
      }
    }
  });

  if (rows.length === 0) {
    return (
      <Box>
        <Text dimColor>No actions available here.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => (
        // The option list is rendered in order and keyed by position; the
        // action kind alone is not unique (two talks at a Location differ only
        // by target), so the stable list index is the key.
        <ActionRow
          key={index}
          option={row.option}
          label={row.label}
          highlighted={index === state.index}
        />
      ))}
    </Box>
  );
}
