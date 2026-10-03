/**
 * Snapshot tests for the Ink Documents pane and single-Document reader (task
 * 22.9; Requirements 13.2, 13.6). These capture the rendered frame of the
 * Documents list (kind · title · date with read/unread and here markers), the
 * reader body, and the two side by side, from fixed, deterministic fixtures so
 * the snapshots stay stable.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type {
  DocumentListEntry,
  DocumentListView,
  DocumentView,
} from '@tradecraft/player-view';

import { DocumentList, DocumentsPane } from './documents.js';
import { DocumentReader } from './document-reader.js';

/** A view-safe list entry fixture. */
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

const listView: DocumentListView = {
  documents: [
    entry('doc:news', {
      kind: 'newspaper',
      title: 'The Morning Herald',
      dateLabel: 'Day 2, morning',
      read: true,
    }),
    entry('doc:brief', {
      kind: 'cable',
      title: 'Briefing Cable',
      dateLabel: 'Day 1, morning',
      read: false,
    }),
    entry('doc:book', {
      kind: 'public-text',
      title: 'A City History',
      dateLabel: 'Day 1, morning',
      obtainableHere: true,
    }),
  ],
};

/** A view-safe single-Document fixture (body with a preserved blank line). */
const cable: DocumentView = {
  id: 'doc:brief' as DocumentView['id'],
  kind: 'cable',
  title: 'Briefing Cable',
  date: { day: 1, phase: 0 },
  dateLabel: 'Day 1, morning',
  body: 'Line one.\n\nLine two.',
  read: true,
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

describe('DocumentList snapshot', () => {
  it('renders the list with markers and the cursor on the selected row', () => {
    const { lastFrame } = render(<DocumentList view={listView} selected={1} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Documents
          newspaper · The Morning Herald · Day 2, morning
      > • cable · Briefing Cable · Day 1, morning
        • public-text · A City History · Day 1, morning [here]"
    `);
  });

  it('renders the empty-state hint', () => {
    const { lastFrame } = render(
      <DocumentList view={{ documents: [] }} selected={-1} />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Documents
      No Documents to hand."
    `);
  });
});

describe('DocumentReader snapshot', () => {
  it('renders the title, meta and body with blank lines preserved', () => {
    const { lastFrame } = render(<DocumentReader document={cable} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Briefing Cable
      cable · Day 1, morning

      Line one.

      Line two."
    `);
  });
});

describe('DocumentsPane snapshot', () => {
  it('renders the list and the selected Document side by side', () => {
    const { lastFrame } = render(
      <DocumentsPane view={listView} selected={1} document={cable} />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Documents                                                 Briefing Cable
          newspaper · The Morning Herald · Day 2, morning       cable · Day 1, morning
      > • cable · Briefing Cable · Day 1, morning
        • public-text · A City History · Day 1, morning [here]  Line one.

                                                                Line two."
    `);
  });
});
