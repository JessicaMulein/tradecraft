/**
 * The save/load screen's model — a pure cursor/selection reducer and the
 * selectors behind it (design, "TUI" → the Save/load screen: lists
 * `saves.list()`, marks saves with `manifestMatches: false`, and loading one
 * shows the `manifest-mismatch` pack list and leaves the current game unchanged;
 * Requirements 13.9, 31.6). Task 22.12.
 *
 * The screen lists the saves the facade reports (`saves.list()` -> `SaveInfo[]`)
 * and lets the player move a cursor over them, load the highlighted one, or
 * cancel. The two decisions this model makes — which save is highlighted, and
 * whether loading the highlighted save is *refused* because its Content Manifest
 * no longer matches the loaded packs — are kept here as pure functions so they
 * can be unit-tested without a TTY. The {@link SaveLoadScreen} component holds
 * this {@link SaveListState}, renders the save at `state.index` as highlighted,
 * and maps each keypress to one {@link SaveListAction}.
 *
 * ## Why a presentational model (no facade calls)
 *
 * The facade's `saves` object is still a stub (`saves.list()` returns `[]`,
 * `saves.save`/`saves.load` reject): wiring it to the filesystem is a separate
 * task. So this slice is built presentationally, the way the game-over and
 * debrief screens were — it takes the save listing as a `SaveInfo[]` prop and
 * the load/save/cancel actions as callbacks. The pure save/load logic
 * (`loadSnapshot`/`diffManifests`, the `manifest-mismatch` `LoadError`) lives in
 * player-view; the owning screen supplies the differing-pack list for a
 * mismatched save as a prop (keyed by save name), since `SaveInfo` itself
 * carries only the `manifestMatches` boolean, not the pack list.
 *
 * ## The manifest-mismatch rule (Req 31.6)
 *
 * A `SaveInfo` with `manifestMatches === false` was taken under different packs.
 * Per the design, loading it is *refused*: selecting it (or pressing load on it)
 * surfaces the differing-pack list as a read-only warning and does **not**
 * change the current game. {@link canLoad} is the gate the component consults
 * before firing its `onLoad` callback.
 */

import type { SaveInfo } from '@tradecraft/player-view';

/**
 * One differing pack to show in the `manifest-mismatch` warning (design,
 * Save/load screen): the pack id and its version on the saved and loaded sides
 * (`undefined` on the side that lacks the pack). This mirrors player-view's
 * `ManifestDifference` / the `manifest-mismatch` `LoadError`'s `differing`
 * element, re-declared locally so the TUI depends only on the facade's shapes
 * (Req 13.5) and the owning screen can hand this list straight through from a
 * `diffManifests` result.
 */
export interface PackDifference {
  /** The pack id (design `differing[].id`). */
  readonly id: string;
  /** The version recorded in the save, or `undefined` if the save lacked it. */
  readonly saved?: string;
  /** The version in the loaded packs, or `undefined` if the packs lack it. */
  readonly loaded?: string;
}

/**
 * The save/load list state: the saves to show and the index of the highlighted
 * one. The cursor is clamped to `[0, saves.length - 1]`; an empty list has no
 * valid selection ({@link selectedSave} returns `undefined`).
 */
export interface SaveListState {
  /** The saves to list, in the order the facade reported them. */
  readonly saves: readonly SaveInfo[];
  /** The highlighted save's index, clamped to the list (0 when empty). */
  readonly index: number;
}

/** The initial state for a given save listing, highlighting the first save. */
export function initialSaveListState(
  saves: readonly SaveInfo[],
): SaveListState {
  return { saves, index: 0 };
}

/** A save/load action, one per keypress the component handles. */
export type SaveListAction =
  /** Move the cursor to the next/previous save (wrapping over the list). */
  | { readonly type: 'next' }
  | { readonly type: 'prev' }
  /** Jump the cursor to a save by index (clamped into range). */
  | { readonly type: 'select'; readonly index: number }
  /**
   * Replace the listing (e.g. a save was just written). The cursor is kept
   * where it is, re-clamped onto the new list.
   */
  | { readonly type: 'set-saves'; readonly saves: readonly SaveInfo[] };

/** Clamp an index into `[0, count - 1]`; `0` for an empty list. */
function clampIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  if (index < 0) {
    return 0;
  }
  if (index > count - 1) {
    return count - 1;
  }
  return Math.trunc(index);
}

/** Step an index, wrapping over a list of `count` items (identity when empty). */
function wrap(index: number, step: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return (index + step + count) % count;
}

/**
 * The pure save/load list reducer (design, Save/load screen). Applies one
 * {@link SaveListAction} to the {@link SaveListState} and returns the next
 * state; never mutates its input.
 *
 * - `next`/`prev` move the cursor one save, wrapping at the ends. Over an empty
 *   list the cursor stays at `0`.
 * - `select` jumps to an index, clamped into range.
 * - `set-saves` swaps the listing and re-clamps the cursor onto it.
 */
export function reduceSaveList(
  state: SaveListState,
  action: SaveListAction,
): SaveListState {
  switch (action.type) {
    case 'next':
      return { ...state, index: wrap(state.index, 1, state.saves.length) };
    case 'prev':
      return { ...state, index: wrap(state.index, -1, state.saves.length) };
    case 'select':
      return { ...state, index: clampIndex(action.index, state.saves.length) };
    case 'set-saves':
      return {
        saves: action.saves,
        index: clampIndex(state.index, action.saves.length),
      };
    default:
      return state;
  }
}

/** The highlighted save, or `undefined` when the listing is empty. */
export function selectedSave(state: SaveListState): SaveInfo | undefined {
  if (state.saves.length === 0) {
    return undefined;
  }
  return state.saves[clampIndex(state.index, state.saves.length)];
}

/**
 * Whether loading the given save is allowed (design, Save/load screen; Req
 * 31.6). A save whose Content Manifest no longer matches the loaded packs
 * (`manifestMatches === false`) is refused: the screen shows its differing-pack
 * list instead of loading and leaves the current game unchanged. A matching
 * save (or `undefined`, i.e. nothing selected -> trivially not loadable) is
 * handled explicitly.
 */
export function canLoad(save: SaveInfo | undefined): boolean {
  return save !== undefined && save.manifestMatches;
}
