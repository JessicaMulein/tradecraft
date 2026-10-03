/**
 * The player-aid views slice of the TUI (task 22.7): the Ink Journal, Map and
 * People panes — the player's recorded fact log and notes, the single-city Map
 * of known Districts/Locations/Routes/Dead Drops, and the known people,
 * organisations and items — plus the pure People-list selection reducer behind
 * the People pane (Requirements 33.1, 33.2, 33.3, 33.4).
 */

export { JournalPane, type JournalPaneProps } from './journal-view.js';

export { MapPane, type MapPaneProps } from './map-view.js';

export {
  PeopleList,
  PeoplePane,
  PersonDetail,
  type PeopleListProps,
  type PeoplePaneProps,
  type PersonDetailProps,
} from './people-view.js';

export {
  initialPeopleListState,
  reducePeopleList,
  selectedPerson,
  type PeopleListAction,
  type PeopleListState,
  type PersonRow,
} from './people-list.js';
