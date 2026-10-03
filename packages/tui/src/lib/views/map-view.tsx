/**
 * The Map view — the TUI's player aid for the single city's known geography
 * (design, "Player Aids": "Map view"; Requirement 33.3).
 *
 * The Map view shows the player's known Locations grouped by District, with each
 * Location's opening hours, risk rating, current crowd level, known Dead Drops
 * and travel cost from where the player stands, plus each District's outgoing
 * Routes with their travel costs (Req 33.3). The design draws this as a District
 * adjacency list, not a spatial map, so this component is a nested list.
 *
 * ## Presentational
 *
 * The pane is pure presentation: it takes the {@link MapView} as a prop, so it
 * renders identically from a live projection (`EngineApi.views.map()`) or a
 * fixture. It holds no state — the Map is read-only — so there is no reducer in
 * this slice for it.
 *
 * ## Boundary
 *
 * The pane reads only `@tradecraft/player-view` types (Req 13.5): the view-safe
 * {@link MapView}. Every field is a fact fixed at generation or view-safe player
 * knowledge — no truth field is reachable (Req 2.2, 33.5).
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type { MapView } from '@tradecraft/player-view';

import { phaseName } from '../scene/time.js';

/** Props for {@link MapPane}. */
export interface MapPaneProps {
  /** The Map view — known Districts, Locations, Routes and Dead Drops. */
  readonly map: MapView;
}

/** The element type of {@link MapView.districts} (one District). */
type MapDistrictRow = MapView['districts'][number];
/** The element type of a District's `locations` (one known Location). */
type MapLocationRow = MapDistrictRow['locations'][number];
/** The element type of a District's `routes` (one outgoing Route). */
type MapRouteRow = MapDistrictRow['routes'][number];

/** The four engine phases in ordinal order, for the open-hours summary. */
const PHASES = [0, 1, 2, 3] as const;

/** Summarise a Location's open hours as the phases it is open, e.g. "morning, evening". */
function openHoursLabel(hours: MapLocationRow['hours']): string {
  const open = PHASES.filter((phase) => hours[phase]).map((phase) => phaseName(phase));
  if (open.length === 0) {
    return 'closed';
  }
  if (open.length === PHASES.length) {
    return 'always open';
  }
  return `open ${open.join(', ')}`;
}

/** Render one known Location: name/type, the here marker, hours, risk, crowd, cost. */
function LocationRow({
  loc,
  here,
}: {
  readonly loc: MapLocationRow;
  readonly here: boolean;
}): ReactElement {
  const access = loc.public ? 'public' : 'private';
  const drops =
    loc.deadDrops.length === 0
      ? ''
      : ` · drops: ${loc.deadDrops.map((d) => d.id).join(', ')}`;
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text color={here ? 'cyan' : undefined}>
        {here ? '> ' : '  '}
        {loc.name} ({loc.type})
      </Text>
      <Text dimColor>
        {'    '}
        {openHoursLabel(loc.hours)} · risk {loc.risk} · {loc.crowd} · {access} · {loc.travelCost}p
        {drops}
      </Text>
    </Box>
  );
}

/** Render one District's outgoing Route as `→ Name (Np)`. */
function RouteRow({ route }: { readonly route: MapRouteRow }): ReactElement {
  return (
    <Text dimColor>
      {'    → '}
      {route.toName} ({route.cost}p)
    </Text>
  );
}

/** Render one District: its name/sector, its known Locations, then its Routes. */
function DistrictBlock({
  district,
  here,
}: {
  readonly district: MapDistrictRow;
  readonly here: string;
}): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>
        {district.name}
        {district.sector !== '' ? ` · ${district.sector}` : ''}
      </Text>
      {district.locations.map((loc) => (
        <LocationRow key={loc.id} loc={loc} here={loc.id === here} />
      ))}
      {district.routes.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor>{'  routes'}</Text>
          {district.routes.map((route) => (
            <RouteRow key={`${route.from}->${route.to}`} route={route} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * The Map pane: the known Districts, each with its known Locations (hours, risk,
 * crowd, drops and travel cost) and its outgoing Routes with costs, followed by
 * the flat list of every known Dead Drop (Req 33.3). The player's current
 * Location is marked with a cursor. An empty map (nothing known yet) shows a
 * hint.
 */
export function MapPane({ map }: MapPaneProps): ReactElement {
  if (map.districts.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Map</Text>
        <Text dimColor>No known Locations yet.</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold>Map</Text>
      {map.districts.map((district) => (
        <DistrictBlock key={district.id} district={district} here={map.here} />
      ))}
      {map.deadDrops.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Known Dead Drops</Text>
          {map.deadDrops.map((drop) => (
            <Box key={drop.id} marginLeft={2}>
              <Text dimColor>
                {drop.id} · {drop.locName}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
