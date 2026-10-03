/**
 * Unit tests for the Feed composer's pure reducer (task 22.14; Requirements
 * 13.1, 37.1, 37.2). These exercise mode switching, Claim list navigation and
 * toggling, compose-form field focus and option cycling, staging and removing
 * composed Propositions, and the {@link assembleFeed} projection to the
 * {@link FeedItem} list — all without a TTY or a live engine.
 */

import { describe, expect, it } from 'vitest';

import {
  assembleFeed,
  COMPOSE_FIELDS,
  currentComposed,
  FEED_MODES,
  initialFeedState,
  reduceFeed,
  type ComposeOptions,
  type FeedState,
} from './feed.js';

/** A small compose-option set the reducer can cycle in tests. */
const options: ComposeOptions = {
  predicates: [
    { value: 'core/MEMBER_OF', label: 'MEMBER_OF' },
    { value: 'core/MEETS_AT', label: 'MEETS_AT' },
  ],
  subjects: [
    { value: 'npc:ana', label: 'Ana' },
    { value: 'npc:viktor', label: 'Viktor' },
  ],
  objects: [
    { value: 'org:cell', label: 'The Cell' },
    { value: { kind: 'text', value: 'the drop' }, label: '"the drop"' },
  ],
  places: [
    { value: undefined, label: '(none)' },
    { value: 'loc:pier', label: 'The Pier' },
  ],
};

describe('initialFeedState', () => {
  it('starts in claims mode with nothing selected or composed', () => {
    const state = initialFeedState({ claimCount: 3 });
    expect(state.mode).toBe('claims');
    expect(state.selected).toEqual([]);
    expect(state.composed).toEqual([]);
    expect(state.claimCount).toBe(3);
    expect(state.errorsShown).toBe(false);
  });

  it('exposes both modes in a stable order', () => {
    expect(FEED_MODES).toEqual(['claims', 'compose']);
  });
});

describe('reduceFeed: mode switching', () => {
  it('toggles between the two modes', () => {
    let state = initialFeedState();
    state = reduceFeed(state, { type: 'mode-toggle' });
    expect(state.mode).toBe('compose');
    state = reduceFeed(state, { type: 'mode-toggle' });
    expect(state.mode).toBe('claims');
  });
});

describe('reduceFeed: Claim navigation and toggling', () => {
  it('moves the cursor within bounds and does not wrap', () => {
    let state = initialFeedState({ claimCount: 2 });
    state = reduceFeed(state, { type: 'claim-prev' });
    expect(state.claimCursor).toBe(0);
    state = reduceFeed(state, { type: 'claim-next' });
    state = reduceFeed(state, { type: 'claim-next' });
    expect(state.claimCursor).toBe(1);
  });

  it('re-clamps the cursor when the shown count shrinks', () => {
    let state = initialFeedState({ claimCount: 3 });
    state = reduceFeed(state, { type: 'claim-next' });
    state = reduceFeed(state, { type: 'claim-next' });
    expect(state.claimCursor).toBe(2);
    state = reduceFeed(state, { type: 'set-claim-count', count: 1 });
    expect(state.claimCount).toBe(1);
    expect(state.claimCursor).toBe(0);
  });

  it('toggles a Claim id in and back out, preserving order', () => {
    let state = initialFeedState();
    state = reduceFeed(state, { type: 'claim-toggle', id: 'claim:a' });
    state = reduceFeed(state, { type: 'claim-toggle', id: 'claim:b' });
    expect(state.selected).toEqual(['claim:a', 'claim:b']);
    state = reduceFeed(state, { type: 'claim-toggle', id: 'claim:a' });
    expect(state.selected).toEqual(['claim:b']);
  });

  it('clears the surfaced-errors flag when the feed changes', () => {
    let state: FeedState = {
      ...initialFeedState(),
      errorsShown: true,
    };
    state = reduceFeed(state, { type: 'claim-toggle', id: 'claim:a' });
    expect(state.errorsShown).toBe(false);
  });
});

describe('reduceFeed: compose form', () => {
  it('cycles the focused field through COMPOSE_FIELDS', () => {
    let state = initialFeedState();
    expect(state.field).toBe('predicate');
    for (let i = 1; i < COMPOSE_FIELDS.length; i += 1) {
      state = reduceFeed(state, { type: 'field-next' });
      expect(state.field).toBe(COMPOSE_FIELDS[i]);
    }
    state = reduceFeed(state, { type: 'field-next' });
    expect(state.field).toBe('predicate');
  });

  it('cycles the focused field option wrapping at the end', () => {
    let state = initialFeedState();
    expect(state.selection.predicate).toBe(0);
    state = reduceFeed(state, { type: 'option-next', options });
    expect(state.selection.predicate).toBe(1);
    state = reduceFeed(state, { type: 'option-next', options });
    expect(state.selection.predicate).toBe(0);
    state = reduceFeed(state, { type: 'option-prev', options });
    expect(state.selection.predicate).toBe(1);
  });

  it('builds the current composed Proposition from the chosen options', () => {
    const state = initialFeedState();
    const prop = currentComposed(state.selection, options);
    expect(prop).toEqual({
      predicate: 'core/MEMBER_OF',
      subject: 'npc:ana',
      object: 'org:cell',
    });
  });

  it('includes a place only when one is chosen', () => {
    let state = initialFeedState();
    // focus place and pick the second option (loc:pier)
    state = { ...state, field: 'place' };
    state = reduceFeed(state, { type: 'option-next', options });
    const prop = currentComposed(state.selection, options);
    expect(prop?.place).toBe('loc:pier');
  });

  it('stages and removes composed Propositions', () => {
    let state = initialFeedState();
    state = reduceFeed(state, { type: 'compose-add', options });
    expect(state.composed).toHaveLength(1);
    state = reduceFeed(state, { type: 'compose-remove-last' });
    expect(state.composed).toHaveLength(0);
    // Removing from empty is a no-op.
    const same = reduceFeed(state, { type: 'compose-remove-last' });
    expect(same).toBe(state);
  });

  it('refuses to stage when a required field has no option', () => {
    const empty: ComposeOptions = {
      predicates: [],
      subjects: [],
      objects: [],
      places: [{ value: undefined, label: '(none)' }],
    };
    const state = initialFeedState();
    const next = reduceFeed(state, { type: 'compose-add', options: empty });
    expect(next.composed).toHaveLength(0);
  });
});

describe('reduceFeed: error flag', () => {
  it('marks and clears the surfaced-errors flag', () => {
    let state = initialFeedState();
    state = reduceFeed(state, { type: 'mark-errors' });
    expect(state.errorsShown).toBe(true);
    state = reduceFeed(state, { type: 'clear-errors' });
    expect(state.errorsShown).toBe(false);
  });
});

describe('assembleFeed', () => {
  it('assembles claim items followed by composed items', () => {
    let state = initialFeedState();
    state = reduceFeed(state, { type: 'claim-toggle', id: 'claim:a' });
    state = reduceFeed(state, { type: 'compose-add', options });
    expect(assembleFeed(state)).toEqual([
      { from: 'claim', claim: 'claim:a' },
      {
        from: 'composed',
        prop: {
          predicate: 'core/MEMBER_OF',
          subject: 'npc:ana',
          object: 'org:cell',
        },
      },
    ]);
  });

  it('is empty when nothing is selected or composed', () => {
    expect(assembleFeed(initialFeedState())).toEqual([]);
  });
});
