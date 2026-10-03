/**
 * The Documents pane — the TUI's reader for newspapers, public texts, Dossiers,
 * Cables and seized material (design, "TUI": "Documents — a reader for
 * newspapers, public texts, Dossiers, Cables and seized material"; Requirement
 * 30.4).
 *
 * The pane is two panes side by side: a {@link DocumentList} — the Documents the
 * player can currently open (title · kind · date, with read/unread and
 * obtainable-here markers) and a selection cursor — and a {@link DocumentReader}
 * for whichever Document is selected. Every Document kind renders the same way;
 * the reader is purely presentational over the view-safe {@link DocumentView}.
 *
 * ## Presentational
 *
 * {@link DocumentsPane} takes the {@link DocumentListView} and the already-loaded
 * selected {@link DocumentView} as props, plus the selected index and a
 * selection callback, so it renders identically whether those came from a live
 * facade or a fixture. The cursor logic itself is the pure reducer in
 * `./document-list.ts`; the screen that owns the pane drives it and feeds the
 * selected id to `views.document(id)` to load the `selected` prop.
 *
 * ## Boundary
 *
 * The pane reads only `@tradecraft/player-view` types (Req 13.5): the view-safe
 * {@link DocumentListView} and {@link DocumentView}. Nothing truth-bearing is
 * reachable — a Document carries no truth field, and its `body` is composed
 * deterministically with no language model.
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type {
  DocumentListEntry,
  DocumentListView,
  DocumentView,
} from '@tradecraft/player-view';

import { DocumentReader } from './document-reader.js';

/** Props for {@link DocumentList}. */
export interface DocumentListProps {
  /** The Documents to list, as returned by `views.documents()` (newest first). */
  readonly view: DocumentListView;
  /**
   * The selected row index, or `-1` when nothing is selected (an empty list).
   * The row at this index is highlighted with the cursor.
   */
  readonly selected: number;
}

/** The read/unread marker: a dot for unread, a space for read. */
function readMarker(entry: DocumentListEntry): string {
  return entry.read ? ' ' : '•';
}

/** One Document row: cursor, read marker, kind · title, and date / here markers. */
function DocumentRow({
  entry,
  focused,
}: {
  readonly entry: DocumentListEntry;
  readonly focused: boolean;
}): ReactElement {
  // An "obtainable here" marker so the player can see which Documents are to
  // hand at this Location versus already-read ones they carry.
  const here = entry.obtainableHere ? ' [here]' : '';
  return (
    <Box>
      <Text color={focused ? 'cyan' : undefined}>
        {focused ? '> ' : '  '}
        {readMarker(entry)} {entry.kind} · {entry.title} · {entry.dateLabel}
        {here}
      </Text>
    </Box>
  );
}

/**
 * The Documents list pane: one row per listed Document (newest first) with the
 * selection cursor on the `selected` row. Each row shows the read/unread marker,
 * the kind, title and date, and an "obtainable here" marker. An empty list shows
 * a hint instead of rows.
 */
export function DocumentList({ view, selected }: DocumentListProps): ReactElement {
  if (view.documents.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>Documents</Text>
        <Text dimColor>No Documents to hand.</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column">
      <Text bold>Documents</Text>
      <Box flexDirection="column">
        {view.documents.map((entry, index) => (
          // The list order is a stable projection from the facade (newest
          // first) and Document ids are unique, so the id is a stable key.
          <DocumentRow
            key={entry.id}
            entry={entry}
            focused={index === selected}
          />
        ))}
      </Box>
    </Box>
  );
}

/** Props for {@link DocumentsPane}. */
export interface DocumentsPaneProps {
  /** The Documents list to show (from `views.documents()`). */
  readonly view: DocumentListView;
  /** The selected row index, or `-1` when nothing is selected. */
  readonly selected: number;
  /**
   * The loaded {@link DocumentView} for the selected row (from
   * `views.document(id)`), or `undefined` when nothing is selected or the id
   * resolves to no Document. While `undefined`, the reader shows a hint.
   */
  readonly document?: DocumentView;
}

/**
 * The Documents pane: the {@link DocumentList} on the left and the
 * {@link DocumentReader} for the selected Document on the right. When no
 * Document is selected (an empty list, or an id that resolved to nothing) the
 * reader side shows a hint instead.
 */
export function DocumentsPane({
  view,
  selected,
  document,
}: DocumentsPaneProps): ReactElement {
  return (
    <Box flexDirection="row">
      <Box flexDirection="column" marginRight={2}>
        <DocumentList view={view} selected={selected} />
      </Box>
      <Box flexDirection="column">
        {document === undefined ? (
          <Text dimColor>Select a Document to read.</Text>
        ) : (
          <DocumentReader document={document} />
        )}
      </Box>
    </Box>
  );
}
