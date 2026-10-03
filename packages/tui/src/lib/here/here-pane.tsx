/**
 * The Here pane — the TUI's side pane (design, "TUI": "Here (side): the current
 * Location, crowd, weather, visible persons and allowed actions with quotes";
 * Requirements 21.5, 21.7).
 *
 * This pane renders the Location-and-conditions slice of the {@link HereView}:
 * the current Location (name, atmosphere tags, risk and whether it is public),
 * the crowd band, the day's weather, and the persons visible here, each by their
 * player-facing {@link PersonLabel} — a known name or a descriptor, never a true
 * name (Req 21.7). The allowed-actions-with-quotes slice is a sibling component,
 * {@link ActionMenu}, which the owning screen stacks beside this one; keeping the
 * two separate mirrors the view/action split in {@link HereView} and the facade's
 * `actions()`.
 *
 * ## Presentational
 *
 * The pane is pure presentation: it takes the {@link HereView} as a prop, so it
 * renders identically from a live projection or a fixture. The owning screen
 * fetches the view (`EngineApi.views.here()`) and threads it in.
 *
 * ## Boundary
 *
 * The pane reads only `@tradecraft/player-view` types (Req 13.5): the view-safe
 * {@link HereView} and its {@link PersonLabel}s. Nothing truth-bearing is
 * reachable — visible persons arrive already labelled by name-or-descriptor.
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type { HereView } from '@tradecraft/player-view';

/** Props for {@link HerePane}. */
export interface HerePaneProps {
  /** The "here" view — Location, crowd, weather and visible persons. */
  readonly here: HereView;
}

/**
 * The Here pane: the current Location and conditions above the visible persons.
 * The allowed actions are rendered by {@link ActionMenu}, stacked beside this
 * pane by the owning screen.
 */
export function HerePane({ here }: HerePaneProps): ReactElement {
  const { location } = here;
  const atmosphere = location.atmosphere.join(', ');
  const access = location.public ? 'public' : 'private';
  const visible =
    here.visible.length === 0
      ? 'no one in sight'
      : here.visible.map((p) => p.label).join(', ');
  return (
    <Box flexDirection="column">
      <Text bold>{location.name}</Text>
      {atmosphere !== '' && <Text dimColor>{atmosphere}</Text>}
      <Text dimColor>
        {here.weather} · {here.crowd} · risk {location.risk} · {access}
      </Text>
      <Text dimColor>Here: {visible}</Text>
    </Box>
  );
}
