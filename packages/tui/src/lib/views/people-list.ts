/**
 * The People view's list selection — a pure reducer over a
 * {@link PeopleView} (design, "Player Aids": "People view"; Requirement 33.4).
 *
 * The People pane is a list of known persons (and Unidentified Subjects) with a
 * selection cursor, so the player can scroll through everyone they know and read
 * a selected person's detail. This module is the cursor logic, kept pure and
 * separate from the Ink component so navigation — moving the cursor up and down,
 * clamping to the list, resolving which person is selected — is unit-testable
 * without a TTY. It mirrors the Documents-list reducer (task 22.6) so the two
 * list panes behave identically.
 *
 * The list order comes from the facade (`views.people()` returns people in a
 * stable, id-sorted order); this reducer never reorders, it only tracks which
 * row the cursor is on.
 */

import type { PeopleView } from '@tradecraft/player-view';

/**
 * One person entry as the People view lists it — the element type of
 * {@link PeopleView.people}. Derived from the view type rather than imported
 * from the engine so this module stays within the tui → player-view boundary
 * (Req 13.5).
 */
export type PersonRow = PeopleView['people'][number];

/** The list selection state: the full view and the cursor row. */
export interface PeopleListState {
  /** The People view the pane renders, as returned by `views.people()`. */
  readonly view: PeopleView;
  /**
   * The selected row index, clamped to `[0, people.length - 1]`, or `-1` when
   * there are no people (nothing can be selected).
   */
  readonly selected: number;
}

/** A list-navigation action, one per keypress the component handles. */
export type PeopleListAction =
  /** Move the cursor to the next/previous row (clamped at the ends). */
  | { readonly type: 'select-next' }
  | { readonly type: 'select-prev' }
  /** Jump the cursor to the first/last row. */
  | { readonly type: 'select-first' }
  | { readonly type: 'select-last' }
  /** Select a specific row by index (clamped into range). */
  | { readonly type: 'select'; readonly index: number }
  /**
   * Replace the underlying view (e.g. after a turn adds a Claim that changes a
   * person's counts, or a new person becomes known). The cursor is re-clamped
   * onto the new list, so it never points past the end.
   */
  | { readonly type: 'set-view'; readonly view: PeopleView };

/**
 * The initial selection for a People view: the first row selected, or `-1` when
 * no people are known.
 */
export function initialPeopleListState(view: PeopleView): PeopleListState {
  return { view, selected: view.people.length === 0 ? -1 : 0 };
}

/** Clamp a desired row index into `[0, length - 1]`, or `-1` for an empty list. */
function clamp(index: number, length: number): number {
  if (length === 0) {
    return -1;
  }
  if (index < 0) {
    return 0;
  }
  if (index > length - 1) {
    return length - 1;
  }
  return index;
}

/**
 * The pure People-list reducer. Applies one {@link PeopleListAction} to the
 * {@link PeopleListState} and returns the next state; never mutates its input.
 * The cursor is always clamped to the current list, so an empty list selects
 * nothing and navigation never runs off either end.
 */
export function reducePeopleList(
  state: PeopleListState,
  action: PeopleListAction,
): PeopleListState {
  const length = state.view.people.length;
  switch (action.type) {
    case 'select-next':
      return { ...state, selected: clamp(state.selected + 1, length) };
    case 'select-prev':
      return { ...state, selected: clamp(state.selected - 1, length) };
    case 'select-first':
      return { ...state, selected: clamp(0, length) };
    case 'select-last':
      return { ...state, selected: clamp(length - 1, length) };
    case 'select':
      return { ...state, selected: clamp(action.index, length) };
    case 'set-view':
      return {
        view: action.view,
        selected: clamp(state.selected, action.view.people.length),
      };
    default:
      return state;
  }
}

/**
 * The currently selected person, or `undefined` when the list is empty. This is
 * the row the detail side of the People pane renders.
 */
export function selectedPerson(state: PeopleListState): PersonRow | undefined {
  if (state.selected < 0 || state.selected >= state.view.people.length) {
    return undefined;
  }
  return state.view.people[state.selected];
}
