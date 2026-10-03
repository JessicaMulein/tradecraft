/**
 * The Documents list selection — a pure reducer over a {@link DocumentListView}
 * (design, "TUI": "Documents — a reader for newspapers, public texts, Dossiers,
 * Cables and seized material"; Requirement 30.4).
 *
 * The Documents pane is a list of Document entries (newest first) with a
 * selection cursor, and a reader for whichever entry is selected. This module is
 * the cursor logic, kept pure and separate from the Ink component so navigation
 * — moving the cursor up and down, clamping to the list, resolving which
 * Document id is selected — is unit-testable without a TTY. The component holds
 * this state, dispatches one {@link DocumentListAction} per keypress, and reads
 * back the {@link DocumentListState} to render.
 *
 * The list order comes from the facade (`views.documents()` returns Documents
 * newest first); this reducer never reorders, it only tracks which row the
 * cursor is on. The selected id is what the component passes to
 * `views.document(id)` to load the {@link DocumentView} the reader renders.
 */

import type { DocumentView, DocumentListView } from '@tradecraft/player-view';

/**
 * A Document handle (the `id` of a listed Document). Derived from the view type
 * rather than imported from the engine so this module stays within the
 * tui → player-view boundary (Req 13.5).
 */
export type DocumentId = DocumentView['id'];

/** The list selection state: the full view and the cursor row. */
export interface DocumentListState {
  /** The list the pane renders, as returned by `views.documents()`. */
  readonly view: DocumentListView;
  /**
   * The selected row index, clamped to `[0, documents.length - 1]`, or `-1` when
   * the list is empty (no Document can be selected).
   */
  readonly selected: number;
}

/** A list-navigation action, one per keypress the component handles. */
export type DocumentListAction =
  /** Move the cursor to the next/previous row (clamped at the ends). */
  | { readonly type: 'select-next' }
  | { readonly type: 'select-prev' }
  /** Jump the cursor to the first/last row. */
  | { readonly type: 'select-first' }
  | { readonly type: 'select-last' }
  /** Select a specific row by index (clamped into range). */
  | { readonly type: 'select'; readonly index: number }
  /**
   * Replace the underlying list (e.g. after reading a Document flips its `read`
   * flag, or the player changes Location). The cursor is re-clamped onto the new
   * list, so it never points past the end.
   */
  | { readonly type: 'set-view'; readonly view: DocumentListView };

/**
 * The initial selection for a list: the first row selected, or `-1` when the
 * list is empty.
 */
export function initialDocumentListState(
  view: DocumentListView,
): DocumentListState {
  return { view, selected: view.documents.length === 0 ? -1 : 0 };
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
 * The pure Documents-list reducer (design, "Documents"). Applies one
 * {@link DocumentListAction} to the {@link DocumentListState} and returns the
 * next state; never mutates its input. The cursor is always clamped to the
 * current list, so an empty list selects nothing and navigation never runs off
 * either end.
 */
export function reduceDocumentList(
  state: DocumentListState,
  action: DocumentListAction,
): DocumentListState {
  const length = state.view.documents.length;
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
        selected: clamp(state.selected, action.view.documents.length),
      };
    default:
      return state;
  }
}

/**
 * The id of the currently selected Document, or `undefined` when the list is
 * empty. This is the handle the component passes to `views.document(id)` to load
 * the {@link import('@tradecraft/player-view').DocumentView} the reader renders.
 */
export function selectedDocId(
  state: DocumentListState,
): DocumentId | undefined {
  if (state.selected < 0 || state.selected >= state.view.documents.length) {
    return undefined;
  }
  return state.view.documents[state.selected]?.id;
}
