/**
 * The Documents slice of the TUI (task 22.6): the Ink Documents pane — a list of
 * newspapers, public texts, Dossiers, Cables and seized material with a
 * selection cursor, and the single-Document reader for the selected entry — plus
 * the pure selection reducer behind the list (Requirement 30.4).
 */

export {
  DocumentReader,
  type DocumentReaderProps,
} from './document-reader.js';

export {
  DocumentList,
  DocumentsPane,
  type DocumentListProps,
  type DocumentsPaneProps,
} from './documents.js';

export {
  initialDocumentListState,
  reduceDocumentList,
  selectedDocId,
  type DocumentId,
  type DocumentListAction,
  type DocumentListState,
} from './document-list.js';
