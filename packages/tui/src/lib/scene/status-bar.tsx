/**
 * The status bar (design, "TUI": "Status bar: day and phase, Location, Budget,
 * Standing, open Directives, the highlighted action's phase and money cost, and
 * alerts"; Requirements 13.2, 13.4, 13.6).
 *
 * A thin, read-only strip summarising the game's state: the day and phase (as a
 * readable `Day N, <phase>` string), the current Location's name, the Budget,
 * the Standing, the open Directives, and — when the action menu has an action
 * highlighted — that action's phase and money cost from its {@link ActionQuote}.
 *
 * ## Presentational, with two props the view does not carry
 *
 * The bar is pure presentation of its props. Most come from the {@link
 * StatusView}, but that view carries neither the open Directives nor the action
 * the menu currently highlights, so those arrive as separate props: `directives`
 * (the open Directives' player-facing summaries) and `highlighted` (the {@link
 * ActionOption} under the action-menu cursor, or `undefined` when nothing is
 * highlighted). The owning screen threads them in; the bar just renders.
 *
 * ## Boundary
 *
 * The bar reads only `@tradecraft/player-view` types (Req 13.5): the view-safe
 * {@link StatusView}, the {@link ActionOption} (an `Action` with its view-safe
 * {@link ActionQuote}), and the Directive summary strings. Nothing truth-bearing
 * is reachable.
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type { ActionOption, StatusView } from '@tradecraft/player-view';

import { formatTime, phaseName } from './time.js';

/** Props for {@link StatusBar}. */
export interface StatusBarProps {
  /** The day/phase, Location, Budget, Standing and ended flag. */
  readonly status: StatusView;
  /**
   * The open Directives, as player-facing summary strings. Not on {@link
   * StatusView}, so threaded in by the owning screen. Empty when none are open.
   */
  readonly directives?: readonly string[];
  /**
   * The action the action menu currently highlights, with its quote; its phase
   * and money cost are shown. `undefined` when nothing is highlighted.
   */
  readonly highlighted?: ActionOption;
  /**
   * A cover-duty notice for the status bar. Absent when no duty is due, missed,
   * or answered by the employer.
   */
  readonly dutyAlert?: string;
}

function whereLabel(status: StatusView): string {
  if (status.transit !== undefined) {
    const arrives = formatTime(status.transit.arrives);
    return `In transit → ${status.transit.destination.name} (arrives ${arrives})`;
  }
  return status.location.name;
}

function cityPrefix(status: StatusView): string {
  if (status.city === undefined || status.transit !== undefined) {
    return '';
  }
  return `${status.city.name} · `;
}
function statusWhen(status: StatusView): string {
  if (status.date === undefined) {
    return formatTime(status.time);
  }
  return `${status.date}, ${phaseName(status.time.phase)}`;
}

function costLabel(option: ActionOption): string {
  const { action, quote } = option;
  const phases = `${quote.phases} ${quote.phases === 1 ? 'phase' : 'phases'}`;
  const money = quote.money > 0 ? `, ${quote.money}` : '';
  return `${action.kind}: ${phases}${money}`;
}

/**
 * The status bar. Renders the day/phase, Location, Budget, Standing and open
 * Directives, and — when an action is highlighted — its phase and money cost.
 */
export function StatusBar({
  status,
  directives = [],
  highlighted,
  dutyAlert,
}: StatusBarProps): ReactElement {
  const directiveLabel =
    directives.length === 0 ? 'none' : directives.join('; ');
  return (
    <Box flexDirection="column">
      <Box>
        <Text>
          {cityPrefix(status)}
          {statusWhen(status)} · {whereLabel(status)} · Budget{' '}
          {status.budget} · Standing {status.standing}
        </Text>
      </Box>
      {status.followed !== undefined && status.followed.length > 0 && (
        <Box>
          <Text color="yellow">{status.followed}</Text>
        </Box>
      )}
      <Box>
        <Text dimColor>Directives: {directiveLabel}</Text>
      </Box>
      {highlighted !== undefined && (
        <Box>
          <Text dimColor>Cost — {costLabel(highlighted)}</Text>
        </Box>
      )}
      {dutyAlert !== undefined && dutyAlert.length > 0 && (
        <Box>
          <Text color="yellow">Duty: {dutyAlert}</Text>
        </Box>
      )}
    </Box>
  );
}
