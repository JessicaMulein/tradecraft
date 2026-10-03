/**
 * The brief-Cable reader the Start screen reuses (design, "TUI": the Start
 * screen shows "the brief Cable", Requirement 26.4).
 *
 * This is a thin alias over the shared {@link DocumentReader} (task 22.6, the
 * full Documents reader): the Start screen opens on the game's brief Cable, and
 * a Cable is just a {@link DocumentView} like any other Document kind, so it
 * renders through the one shared reader rather than duplicating the body-render
 * logic. The `CableReader` name and props are kept so the Start screen (task
 * 22.1) and its tests go on using it unchanged.
 */

import type { ReactElement } from 'react';
import type { DocumentView } from '@tradecraft/player-view';

import { DocumentReader } from '../documents/document-reader.js';

/** Props for {@link CableReader}: the Document (a Cable) to render. */
export interface CableReaderProps {
  readonly document: DocumentView;
}

/**
 * Render a Cable {@link DocumentView} through the shared {@link DocumentReader}:
 * a bold title, a dim meta line (kind · date) and the fact-layer body with its
 * paragraph breaks preserved. Kept as a named reuse point for the Start screen's
 * brief Cable.
 */
export function CableReader({ document }: CableReaderProps): ReactElement {
  return <DocumentReader document={document} />;
}
