/**
 * The single-Document reader pane (design, "TUI": "Documents — a reader for
 * newspapers, public texts, Dossiers, Cables and seized material"; Requirement
 * 30.4).
 *
 * A thin, read-only Ink view over a Player-View {@link DocumentView}: it renders
 * the Document's title, its kind and date as a header, then the fact-layer
 * `body`, preserving blank lines so an authored Document's paragraph breaks
 * survive. The body is composed deterministically by the engine (no language
 * model) and the view carries no truth field, so this component is pure
 * presentation of view-safe data, identical for every Document kind
 * (newspaper, public text, Dossier, Cable and seized material).
 *
 * The Start screen's brief Cable reader (task 22.1) and the Documents list
 * reader (task 22.6) both render through this one component, so the body-render
 * logic lives in exactly one place.
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import type { DocumentView } from '@tradecraft/player-view';

/** Props for {@link DocumentReader}: the Document to render. */
export interface DocumentReaderProps {
  readonly document: DocumentView;
}

/**
 * Render a {@link DocumentView}: a bold title line, a dim meta line (kind ·
 * date), and the fact-layer body. Blank body lines are preserved so an authored
 * Document's paragraph breaks survive. The same render serves every Document
 * kind — newspaper, public text, Dossier, Cable and seized material — because
 * the reader is purely presentational over the view-safe `body`.
 */
export function DocumentReader({ document }: DocumentReaderProps): ReactElement {
  const lines = document.body.split('\n');
  return (
    <Box flexDirection="column">
      <Text bold>{document.title}</Text>
      <Text dimColor>
        {document.kind} · {document.dateLabel}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, index) => (
          // The body is a stable, ordered projection that is never reordered,
          // so a doc-scoped line index is a stable key.
          <Text key={`${document.id}:${index}`}>{line === '' ? ' ' : line}</Text>
        ))}
      </Box>
    </Box>
  );
}
