/**
 * Snapshot tests for the Ink Journal, Map and People views (task 22.9;
 * Requirements 13.2, 13.6). These capture the rendered frame of each player-aid
 * view from fixed, deterministic fixtures so the snapshots stay stable.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type {
  JournalView,
  MapView,
  PeopleView,
} from '@tradecraft/player-view';

import { JournalPane } from './journal-view.js';
import { MapPane } from './map-view.js';
import { PeoplePane } from './people-view.js';
import type { PersonRow } from './people-list.js';

/** A Journal view with two days, several phases and a few notes. */
const journal: JournalView = {
  days: [
    {
      day: 1,
      phases: [
        {
          phase: 0,
          entries: [
            { seq: 1, at: { day: 1, phase: 0 }, factLines: ['You arrive at the café.'], refs: [] },
          ],
        },
        {
          phase: 2,
          entries: [
            { seq: 2, at: { day: 1, phase: 2 }, factLines: ['Viktor declines the meeting.'], refs: [] },
          ],
        },
      ],
    },
    {
      day: 2,
      phases: [
        {
          phase: 0,
          entries: [
            {
              seq: 3,
              at: { day: 2, phase: 0 },
              factLines: ['The morning paper arrives.', 'A quiet week on the embankment.'],
              refs: [],
            },
          ],
        },
      ],
    },
  ],
  entries: [],
  notes: [
    { seq: 1, at: { day: 1, phase: 0 }, attachTo: 1, text: 'Watch the café on Tuesdays.' },
    { seq: 2, at: { day: 1, phase: 1 }, attachTo: 'npc:viktor', text: 'Nervous around the window.' },
    { seq: 3, at: { day: 2, phase: 0 }, attachTo: 'claim:42', text: 'Doubt this one.' },
  ],
};

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
const map: MapView = {
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

/** A view-safe person-row fixture. */
function person(id: string, overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id: id as PersonRow['id'],
    identified: true,
    label: `Person ${id}`,
    aliases: [],
    asset: false,
    rapport: 'neutral',
    claimsAsSubject: 0,
    claimsAsSource: 0,
    ...overrides,
  };
}

const people: PeopleView = {
  people: [
    person('npc:viktor', {
      label: 'Viktor Lang',
      apparentAffiliation: 'trade mission',
      rapport: 'warm',
      asset: true,
      aliases: ['unk:3'],
      lastSighting: { day: 2, phase: 1 },
      claimsAsSubject: 4,
      claimsAsSource: 2,
    }),
    person('unk:7', {
      identified: false,
      label: 'tall man in a grey coat',
      rapport: 'cold',
    }),
  ],
  orgs: [
    { id: 'org:mission' as never, name: 'Trade Mission', allegiance: 'hostile' },
  ],
  items: [{ id: 'item:ledger' as never, claimCount: 3 }],
};

/**
 * Strip ANSI colour escapes from a rendered frame. ink emits colour codes only
 * when the runner reports colour support, so snapshotting the raw frame would
 * differ between the direct `vitest` run and the `nx`/CI run; the plain text is
 * stable across both.
 */
function plain(frame: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

afterEach(() => {
  cleanup();
});

describe('JournalPane snapshot', () => {
  it('renders the fact log grouped by day/phase and the notes', () => {
    const { lastFrame } = render(<JournalPane journal={journal} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Journal
      Day 1
        morning
          You arrive at the café.
        evening
          Viktor declines the meeting.
      Day 2
        morning
          The morning paper arrives.
          A quiet week on the embankment.

      Notes
        [Day 1] Watch the café on Tuesdays.
        [npc:viktor] Nervous around the window.
        [Claim claim:42] Doubt this one."
    `);
  });
});

describe('MapPane snapshot', () => {
  it('renders the Districts, Locations, Routes and Dead Drops', () => {
    const { lastFrame } = render(<MapPane map={map} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Map
      Inner Stadt · allied
        > Café Central (café)
            open morning, afternoon · risk 2 · packed · public · 0p · drops: drop:planter
          State Library (library)
            open afternoon, evening · risk 1 · sparse · private · 2p
          routes
            → The Docks (1p)

      Known Dead Drops
        drop:planter · Café Central"
    `);
  });
});

describe('PeoplePane snapshot', () => {
  it('renders the people list, the selected detail and the org/item lists', () => {
    const { lastFrame } = render(
      <PeoplePane view={people} selected={0} person={people.people[0]} />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "People                              Viktor Lang
      >   Viktor Lang · warm [asset]      identified
        ? tall man in a grey coat · cold  Affiliation: trade mission
                                          Aliases: unk:3
                                          Last seen: Day 2, afternoon
                                          Asset: yes
                                          Rapport: warm
                                          Claims: 4 about · 2 from

                                          Organisations
                                            Trade Mission · hostile
                                          Items
                                            item:ledger · 3 claims"
    `);
  });
});
