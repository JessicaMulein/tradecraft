/**
 * Unit tests for the pure Documents-list selection reducer (task 22.6; design,
 * "Documents"; Requirement 30.4). These exercise the cursor logic as a pure
 * function — no TTY — feeding navigation actions and reading back the selected
 * row and resolved Document id.
 */

import { describe, expect, it } from 'vitest';
import type {
  DocumentListEntry,
  DocumentListView,
} from '@tradecraft/player-view';

import {
  initialDocumentListState,
  reduceDocumentList,
  selectedDocId,
  type DocumentListState,
} from './document-list.js';

/** A view-safe list entry fixture (the `DocumentListEntry` shape). */
function entry(
  id: string,
  overrides: Partial<DocumentListEntry> = {},
): DocumentListEntry {
  return {
    id: id as DocumentListEntry['id'],
    kind: 'cable',
    title: `Document ${id}`,
    date: { day: 1, phase: 0 },
    dateLabel: 'Day 1, morning',
    read: false,
    obtainableHere: false,
    ...overrides,
  };
}

/** A list view over the given entries. */
function view(...entries: DocumentListEntry[]): DocumentListView {
  return { documents: entries };
}

const threeDocs = view(entry('doc:a'), entry('doc:b'), entry('doc:c'));

describe('initialDocumentListState', () => {
  it('selects the first row of a non-empty list', () => {
    const state = initialDocumentListState(threeDocs);
    expect(state.selected).toBe(0);
    expect(selectedDocId(state)).toBe('doc:a');
  });

  it('selects nothing (-1) for an empty list', () => {
    const state = initialDocumentListState(view());
    expect(state.selected).toBe(-1);
    expect(selectedDocId(state)).toBeUndefined();
  });
});

describe('reduceDocumentList navigation', () => {
  it('moves the cursor down and up, resolving the selected id', () => {
    let state = initialDocumentListState(threeDocs);
    state = reduceDocumentList(state, { type: 'select-next' });
    expect(state.selected).toBe(1);
    expect(selectedDocId(state)).toBe('doc:b');
    state = reduceDocumentList(state, { type: 'select-prev' });
    expect(state.selected).toBe(0);
    expect(selectedDocId(state)).toBe('doc:a');
  });

  it('clamps at the top and bottom ends', () => {
    let state = initialDocumentListState(threeDocs);
    state = reduceDocumentList(state, { type: 'select-prev' });
    // Already on the first row: prev stays put.
    expect(state.selected).toBe(0);
    state = reduceDocumentList(state, { type: 'select-last' });
    expect(state.selected).toBe(2);
    state = reduceDocumentList(state, { type: 'select-next' });
    // Already on the last row: next stays put.
    expect(state.selected).toBe(2);
  });

  it('jumps to the first and last rows', () => {
    let state = initialDocumentListState(threeDocs);
    state = reduceDocumentList(state, { type: 'select-last' });
    expect(selectedDocId(state)).toBe('doc:c');
    state = reduceDocumentList(state, { type: 'select-first' });
    expect(selectedDocId(state)).toBe('doc:a');
  });

  it('selects a specific index, clamped into range', () => {
    const state = initialDocumentListState(threeDocs);
    expect(reduceDocumentList(state, { type: 'select', index: 1 }).selected).toBe(1);
    expect(reduceDocumentList(state, { type: 'select', index: 9 }).selected).toBe(2);
    expect(reduceDocumentList(state, { type: 'select', index: -4 }).selected).toBe(0);
  });

  it('does not mutate the input state', () => {
    const before = initialDocumentListState(threeDocs);
    const after = reduceDocumentList(before, { type: 'select-next' });
    expect(before.selected).toBe(0);
    expect(after.selected).toBe(1);
    expect(after).not.toBe(before);
  });
});

describe('reduceDocumentList set-view', () => {
  it('re-clamps the cursor onto a shorter list', () => {
    let state: DocumentListState = initialDocumentListState(threeDocs);
    state = reduceDocumentList(state, { type: 'select-last' });
    expect(state.selected).toBe(2);
    // A new, shorter list arrives (e.g. after changing Location).
    state = reduceDocumentList(state, {
      type: 'set-view',
      view: view(entry('doc:a')),
    });
    expect(state.selected).toBe(0);
    expect(selectedDocId(state)).toBe('doc:a');
  });

  it('selects nothing when the new list is empty', () => {
    let state = initialDocumentListState(threeDocs);
    state = reduceDocumentList(state, { type: 'set-view', view: view() });
    expect(state.selected).toBe(-1);
    expect(selectedDocId(state)).toBeUndefined();
  });

  it('keeps the cursor row when the new list is long enough', () => {
    let state = initialDocumentListState(threeDocs);
    state = reduceDocumentList(state, { type: 'select', index: 1 });
    // The same Documents, but doc:b is now read: cursor stays on row 1.
    state = reduceDocumentList(state, {
      type: 'set-view',
      view: view(
        entry('doc:a'),
        entry('doc:b', { read: true }),
        entry('doc:c'),
      ),
    });
    expect(state.selected).toBe(1);
    expect(selectedDocId(state)).toBe('doc:b');
  });
});
