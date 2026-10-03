/**
 * Unit tests for the pure People-list selection reducer (task 22.7; design,
 * "Player Aids": "People view"; Requirement 33.4). These exercise the cursor
 * logic as a pure function — no TTY — feeding navigation actions and reading
 * back the selected row and resolved person.
 */

import { describe, expect, it } from 'vitest';
import type { PeopleView } from '@tradecraft/player-view';

import {
  initialPeopleListState,
  reducePeopleList,
  selectedPerson,
  type PeopleListState,
  type PersonRow,
} from './people-list.js';

/** A view-safe person-row fixture (the `PeopleView.people` element shape). */
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

/** A People view over the given person rows (no orgs or items). */
function view(...people: PersonRow[]): PeopleView {
  return { people, orgs: [], items: [] };
}

const threePeople = view(person('npc:a'), person('npc:b'), person('npc:c'));

describe('initialPeopleListState', () => {
  it('selects the first row of a non-empty list', () => {
    const state = initialPeopleListState(threePeople);
    expect(state.selected).toBe(0);
    expect(selectedPerson(state)?.id).toBe('npc:a');
  });

  it('selects nothing (-1) for an empty list', () => {
    const state = initialPeopleListState(view());
    expect(state.selected).toBe(-1);
    expect(selectedPerson(state)).toBeUndefined();
  });
});

describe('reducePeopleList navigation', () => {
  it('moves the cursor down and up, resolving the selected person', () => {
    let state = initialPeopleListState(threePeople);
    state = reducePeopleList(state, { type: 'select-next' });
    expect(state.selected).toBe(1);
    expect(selectedPerson(state)?.id).toBe('npc:b');
    state = reducePeopleList(state, { type: 'select-prev' });
    expect(state.selected).toBe(0);
    expect(selectedPerson(state)?.id).toBe('npc:a');
  });

  it('clamps at the top and bottom ends', () => {
    let state = initialPeopleListState(threePeople);
    state = reducePeopleList(state, { type: 'select-prev' });
    expect(state.selected).toBe(0);
    state = reducePeopleList(state, { type: 'select-last' });
    expect(state.selected).toBe(2);
    state = reducePeopleList(state, { type: 'select-next' });
    expect(state.selected).toBe(2);
  });

  it('jumps to the first and last rows', () => {
    let state = initialPeopleListState(threePeople);
    state = reducePeopleList(state, { type: 'select-last' });
    expect(selectedPerson(state)?.id).toBe('npc:c');
    state = reducePeopleList(state, { type: 'select-first' });
    expect(selectedPerson(state)?.id).toBe('npc:a');
  });

  it('selects a specific index, clamped into range', () => {
    const state = initialPeopleListState(threePeople);
    expect(reducePeopleList(state, { type: 'select', index: 1 }).selected).toBe(1);
    expect(reducePeopleList(state, { type: 'select', index: 9 }).selected).toBe(2);
    expect(reducePeopleList(state, { type: 'select', index: -4 }).selected).toBe(0);
  });

  it('does not mutate the input state', () => {
    const before = initialPeopleListState(threePeople);
    const after = reducePeopleList(before, { type: 'select-next' });
    expect(before.selected).toBe(0);
    expect(after.selected).toBe(1);
    expect(after).not.toBe(before);
  });
});

describe('reducePeopleList set-view', () => {
  it('re-clamps the cursor onto a shorter list', () => {
    let state: PeopleListState = initialPeopleListState(threePeople);
    state = reducePeopleList(state, { type: 'select-last' });
    expect(state.selected).toBe(2);
    state = reducePeopleList(state, {
      type: 'set-view',
      view: view(person('npc:a')),
    });
    expect(state.selected).toBe(0);
    expect(selectedPerson(state)?.id).toBe('npc:a');
  });

  it('selects nothing when the new list is empty', () => {
    let state = initialPeopleListState(threePeople);
    state = reducePeopleList(state, { type: 'set-view', view: view() });
    expect(state.selected).toBe(-1);
    expect(selectedPerson(state)).toBeUndefined();
  });

  it('keeps the cursor row when the new list is long enough', () => {
    let state = initialPeopleListState(threePeople);
    state = reducePeopleList(state, { type: 'select', index: 1 });
    state = reducePeopleList(state, {
      type: 'set-view',
      view: view(
        person('npc:a'),
        person('npc:b', { claimsAsSubject: 3 }),
        person('npc:c'),
      ),
    });
    expect(state.selected).toBe(1);
    expect(selectedPerson(state)?.id).toBe('npc:b');
  });
});
