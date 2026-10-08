/**
 * Component tests for the Ink Map pane (task 22.7; design, "Player Aids": "Map
 * view"; Requirement 33.3). These render the real component with
 * ink-testing-library and assert: known Locations are grouped by District with
 * their hours, risk, crowd, travel cost and Dead Drops; Routes are shown with
 * costs; the player's current Location is marked; and the empty state renders.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { MapView } from '@tradecraft/player-view';

import { MapPane } from './map-view.js';

afterEach(() => {
  cleanup();
});

type MapLocationRow = MapView['districts'][number]['locations'][number];

/** A known-Location fixture with sensible defaults. */
function loc(id: string, overrides: Partial<MapLocationRow> = {}): MapLocationRow {
  return {
    id: id as MapLocationRow['id'],
    name: `Location ${id}`,
    type: 'café',
    public: true,
    risk: 1,
    hours: { 0: true, 1: true, 2: false, 3: false },
    crowd: 'sparse',
    deadDrops: [],
    travelCost: 1,
    ...overrides,
  };
}

/** A Map view with one District holding two Locations and one Route, plus drops. */
const populated: MapView = {
  here: 'loc:cafe' as MapView['here'],
  districts: [
    {
      id: 'dist:inner' as MapView['districts'][number]['id'],
      name: 'Inner Stadt',
      sector: 'allied',
      locations: [
        loc('loc:cafe', {
          name: 'Café Central',
          type: 'café',
          risk: 2,
          crowd: 'packed',
          travelCost: 0,
          deadDrops: [{ id: 'drop:planter' as never, loc: 'loc:cafe' as never, locName: 'Café Central' }],
        }),
        loc('loc:library', {
          name: 'State Library',
          type: 'library',
          public: false,
          hours: { 0: false, 1: true, 2: true, 3: false },
          crowd: 'sparse',
          travelCost: 2,
        }),
      ],
      routes: [
        {
          from: 'dist:inner' as never,
          to: 'dist:docks' as never,
          fromName: 'Inner Stadt',
          toName: 'The Docks',
          cost: 1,
        },
      ],
    },
  ],
  deadDrops: [
    { id: 'drop:planter' as never, loc: 'loc:cafe' as never, locName: 'Café Central' },
  ],
};

describe('MapPane', () => {
  it('groups known Locations by District with their details', () => {
    const { lastFrame } = render(<MapPane map={populated} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Inner Stadt');
    expect(frame).toContain('allied');
    expect(frame).toContain('Café Central');
    expect(frame).toContain('(café)');
    expect(frame).toContain('State Library');
    expect(frame).toContain('(library)');
    // Conditions: risk, crowd and travel cost.
    expect(frame).toContain('risk 2');
    expect(frame).toContain('packed');
    expect(frame).toContain('0p');
    expect(frame).toContain('sparse');
    expect(frame).toContain('2p');
  });

  it('shows opening hours and Dead Drops on a Location', () => {
    const { lastFrame } = render(<MapPane map={populated} />);
    const frame = lastFrame() ?? '';
    // The café is open morning + afternoon only.
    expect(frame).toContain('open morning, afternoon');
    // Its known drop is listed inline and in the flat list.
    expect(frame).toContain('drops: drop:planter');
    expect(frame).toContain('Known Dead Drops');
  });

  it('shows outgoing Routes with their costs', () => {
    const { lastFrame } = render(<MapPane map={populated} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('The Docks');
    expect(frame).toContain('(1p)');
  });

  it('shows a status the player has learned', () => {
    const closed = {
      ...populated,
      districts: populated.districts.map((district) => ({
        ...district,
        locations: district.locations.map((place) =>
          place.id === populated.here ? { ...place, status: 'closed-temporarily' } : place,
        ),
      })),
    };
    const { lastFrame } = render(<MapPane map={closed} />);
    expect(lastFrame() ?? '').toContain('closed-temporarily');
  });

  it('marks the current Location with a cursor', () => {
    const { lastFrame } = render(<MapPane map={populated} />);
    const lines = (lastFrame() ?? '').split('\n');
    const cafeLine = lines.find((l) => l.includes('Café Central')) ?? '';
    const libLine = lines.find((l) => l.includes('State Library')) ?? '';
    expect(cafeLine).toContain('>');
    expect(libLine).not.toContain('>');
  });

  it('shows a hint for an empty map', () => {
    const { lastFrame } = render(
      <MapPane map={{ here: 'loc:none' as MapView['here'], districts: [], deadDrops: [] }} />,
    );
    expect(lastFrame() ?? '').toContain('No known Locations yet.');
  });
});
