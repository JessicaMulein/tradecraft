/**
 * Component tests for the Ink Documents pane (task 22.6; design, "Documents";
 * Requirement 30.4). These render the real components with ink-testing-library
 * and assert: the list shows each entry's kind, title and date with the
 * read/unread and obtainable-here markers and the selection cursor, and the
 * reader renders the selected Document's title, meta (kind · date) and body —
 * across several Document kinds (cable, newspaper, dossier).
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

/** A view-safe single-Document fixture. */
function doc(overrides: Partial<DocumentView> = {}): DocumentView {
  return {
    id: 'doc:brief' as DocumentView['id'],
    kind: 'cable',
    title: 'Briefing Cable',
    date: { day: 1, phase: 0 },
    dateLabel: 'Day 1, morning',
    body: 'Line one.\n\nLine two.',
    read: true,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('DocumentList', () => {
  const view: DocumentListView = {
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

  it('renders each entry with its kind, title and date', () => {
    const { lastFrame } = render(<DocumentList view={view} selected={0} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('newspaper');
    expect(frame).toContain('The Morning Herald');
    expect(frame).toContain('Day 2, morning');
    expect(frame).toContain('cable');
    expect(frame).toContain('Briefing Cable');
    expect(frame).toContain('public-text');
    expect(frame).toContain('A City History');
  });

  it('marks unread Documents and the obtainable-here one', () => {
    const { lastFrame } = render(<DocumentList view={view} selected={0} />);
    const frame = lastFrame() ?? '';
    // The unread Cable carries the unread dot; the obtainable public text is
    // tagged [here].
    expect(frame).toContain('•');
    expect(frame).toContain('[here]');
    // The read newspaper's row does not advertise itself as unread or here.
    const newspaperLine = (frame.split('\n').find((l) => l.includes('Morning Herald'))) ?? '';
    expect(newspaperLine).not.toContain('•');
    expect(newspaperLine).not.toContain('[here]');
  });

  it('shows the selection cursor on the selected row', () => {
    const { lastFrame } = render(<DocumentList view={view} selected={1} />);
    const lines = (lastFrame() ?? '').split('\n');
    const cableLine = lines.find((l) => l.includes('Briefing Cable')) ?? '';
    const newsLine = lines.find((l) => l.includes('Morning Herald')) ?? '';
    expect(cableLine).toContain('>');
    expect(newsLine).not.toContain('>');
  });

  it('shows a hint for an empty list', () => {
    const { lastFrame } = render(
      <DocumentList view={{ documents: [] }} selected={-1} />,
    );
    expect(lastFrame() ?? '').toContain('No Documents to hand.');
  });
});

describe('DocumentReader across kinds', () => {
  it('renders a Cable: title, meta (kind · date) and body', () => {
    const { lastFrame } = render(<DocumentReader document={doc()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Briefing Cable');
    expect(frame).toContain('cable · Day 1, morning');
    expect(frame).toContain('Line one.');
    expect(frame).toContain('Line two.');
  });

  it('renders a newspaper edition', () => {
    const edition = doc({
      id: 'doc:news' as DocumentView['id'],
      kind: 'newspaper',
      title: 'The Morning Herald',
      dateLabel: 'Day 2, morning',
      body: 'LEAD STORY\n\nA quiet week on the embankment.',
    });
    const { lastFrame } = render(<DocumentReader document={edition} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('The Morning Herald');
    expect(frame).toContain('newspaper · Day 2, morning');
    expect(frame).toContain('LEAD STORY');
    expect(frame).toContain('A quiet week on the embankment.');
  });

  it('renders a Dossier', () => {
    const dossier = doc({
      id: 'doc:dossier' as DocumentView['id'],
      kind: 'dossier',
      title: 'Dossier: A. Petrova',
      body: 'Known associate of the trade mission.',
    });
    const { lastFrame } = render(<DocumentReader document={dossier} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Dossier: A. Petrova');
    expect(frame).toContain('dossier · Day 1, morning');
    expect(frame).toContain('Known associate of the trade mission.');
  });
});

describe('DocumentsPane', () => {
  const view: DocumentListView = {
    documents: [
      entry('doc:news', { kind: 'newspaper', title: 'The Morning Herald' }),
      entry('doc:brief', { kind: 'cable', title: 'Briefing Cable' }),
    ],
  };

  it('shows the list and the selected Document side by side', () => {
    const selected = doc({ title: 'Briefing Cable', body: 'The brief.' });
    const { lastFrame } = render(
      <DocumentsPane view={view} selected={1} document={selected} />,
    );
    const frame = lastFrame() ?? '';
    // The list row and the reader body both appear.
    expect(frame).toContain('The Morning Herald');
    expect(frame).toContain('The brief.');
  });

  it('shows a hint on the reader side when nothing is selected', () => {
    const { lastFrame } = render(
      <DocumentsPane view={view} selected={-1} document={undefined} />,
    );
    expect(lastFrame() ?? '').toContain('Select a Document to read.');
  });
});
