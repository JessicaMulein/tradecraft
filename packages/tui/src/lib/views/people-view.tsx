/**
 * The People view — the TUI's player aid for the known persons, organisations
 * and items (design, "Player Aids": "People view"; Requirement 33.4).
 *
 * The People view shows each known person and Unidentified Subject by name or
 * descriptor, their apparent affiliation, linked aliases, last sighting, Asset
 * status, a rapport band and Claim counts (Req 33.4), plus the parallel lists of
 * known organisations and items. The pane is a selectable list of people with a
 * detail panel for the selected row, mirroring the Documents pane.
 *
 * ## Presentational
 *
 * The components are pure presentation: they take the {@link PeopleView} (and a
 * selected index) as props, so they render identically from a live projection
 * (`EngineApi.views.people()`) or a fixture. The cursor logic is the pure
 * reducer in `./people-list.ts`; the owning screen drives it and passes the
 * selected index in.
 *
 * ## Boundary
 *
 * The components read only `@tradecraft/player-view` types (Req 13.5): the
 * view-safe {@link PeopleView}. Apparent affiliation and the rapport band come
 * from the Case File and view-safe trust — never a truth field or `suspicion`
 * (Req 2.2, 33.4).
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type { PeopleView } from '@tradecraft/player-view';

import { formatTime } from '../scene/time.js';
import type { PersonRow } from './people-list.js';

/** Props for {@link PeopleList}. */
export interface PeopleListProps {
  /** The People view to list, as returned by `views.people()`. */
  readonly view: PeopleView;
  /** The selected row index, or `-1` when nothing is selected (an empty list). */
  readonly selected: number;
}

/** The identified/unidentified marker: a descriptor dot vs an identified name. */
function identityMarker(person: PersonRow): string {
  return person.identified ? ' ' : '?';
}

/** One person row: cursor, identity marker, label, rapport and Asset tag. */
function PersonListRow({
  person,
  focused,
}: {
  readonly person: PersonRow;
  readonly focused: boolean;
}): ReactElement {
  const asset = person.asset ? ' [asset]' : '';
  return (
    <Box>
      <Text color={focused ? 'cyan' : undefined}>
        {focused ? '> ' : '  '}
        {identityMarker(person)} {person.label} · {person.rapport}
        {asset}
      </Text>
    </Box>
  );
}

/**
 * The people list: one row per known person (name-or-descriptor, rapport band
 * and Asset tag) with the selection cursor. An empty list shows a hint.
 */
export function PeopleList({ view, selected }: PeopleListProps): ReactElement {
  if (view.people.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>People</Text>
        <Text dimColor>No one known yet.</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold>People</Text>
      {view.people.map((person, index) => (
        <PersonListRow key={person.id} person={person} focused={index === selected} />
      ))}
    </Box>
  );
}

/** Props for {@link PersonDetail}. */
export interface PersonDetailProps {
  /** The selected person, or `undefined` when nothing is selected. */
  readonly person?: PersonRow;
}

/**
 * The detail panel for a selected person: everything the People view lists for
 * one person (Req 33.4) — name-or-descriptor, apparent affiliation, aliases,
 * last sighting, Asset status, rapport band and the two Claim counts. When no
 * person is selected it shows a hint.
 */
export function PersonDetail({ person }: PersonDetailProps): ReactElement {
  if (person === undefined) {
    return <Text dimColor>Select a person.</Text>;
  }
  const affiliation = person.apparentAffiliation ?? 'unknown';
  const aliases = person.aliases.length === 0 ? 'none' : person.aliases.join(', ');
  const sighting =
    person.lastSighting === undefined ? 'never' : formatTime(person.lastSighting);
  return (
    <Box flexDirection="column">
      <Text bold>{person.label}</Text>
      <Text dimColor>{person.identified ? 'identified' : 'unidentified'}</Text>
      <Text>Affiliation: {affiliation}</Text>
      <Text>Aliases: {aliases}</Text>
      <Text>Last seen: {sighting}</Text>
      {person.lastKnownCity === undefined ? null : (
        <Text>Last city: {person.lastKnownCity.name}</Text>
      )}
      <Text>Asset: {person.asset ? 'yes' : 'no'}</Text>
      <Text>Rapport: {person.rapport}</Text>
      {person.recruitment === undefined ? null : <Text>{person.recruitment}</Text>}
      {person.standing === undefined ? null : <Text>{person.standing}</Text>}
      <Text>
        Claims: {person.claimsAsSubject} about · {person.claimsAsSource} from
      </Text>
    </Box>
  );
}

/** Render the parallel list of known organisations and items. */
function OrgsAndItems({ view }: { readonly view: PeopleView }): ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Organisations</Text>
      {view.orgs.length === 0 ? (
        <Text dimColor>none known</Text>
      ) : (
        view.orgs.map((org) => (
          <Box key={org.id} marginLeft={2}>
            <Text>
              {org.name} <Text dimColor>· {org.allegiance}</Text>
            </Text>
          </Box>
        ))
      )}
      <Text bold>Items</Text>
      {view.items.length === 0 ? (
        <Text dimColor>none known</Text>
      ) : (
        view.items.map((item) => (
          <Box key={item.id} marginLeft={2}>
            <Text>
              {item.id} <Text dimColor>· {item.claimCount} claims</Text>
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
}

/** Props for {@link PeoplePane}. */
export interface PeoplePaneProps {
  /** The People view to show (from `views.people()`). */
  readonly view: PeopleView;
  /** The selected row index, or `-1` when nothing is selected. */
  readonly selected: number;
  /**
   * The selected person (from the pure reducer's `selectedPerson`), or
   * `undefined` when nothing is selected. Passed in so the pane stays
   * presentational.
   */
  readonly person?: PersonRow;
}

/**
 * The People pane: the people list on the left and the selected person's detail
 * on the right, with the parallel organisation and item lists below the detail.
 * When no person is selected the detail side shows a hint.
 */
export function PeoplePane({ view, selected, person }: PeoplePaneProps): ReactElement {
  return (
    <Box flexDirection="row">
      <Box flexDirection="column" marginRight={2}>
        <PeopleList view={view} selected={selected} />
      </Box>
      <Box flexDirection="column">
        <PersonDetail person={person} />
        <OrgsAndItems view={view} />
      </Box>
    </Box>
  );
}
