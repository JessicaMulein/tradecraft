/**
 * The action menu's selection state and the pure reducer that drives it (design,
 * "TUI": "Here (side): the current Location, crowd, weather, visible persons and
 * allowed actions with quotes"; Requirements 13.1, 21.5).
 *
 * The menu lists the current Location's {@link ActionOption}s — every action the
 * UI offers (Req 13.1), each with its {@link ActionQuote} — and lets the player
 * move a cursor over them. The cursor logic (move down/up with wrap, clamp when
 * the option list changes length) is kept here as a pure function so it can be
 * unit-tested without a TTY; the {@link ActionMenu} component holds this state,
 * renders it, and maps each keypress to one {@link MenuAction}.
 *
 * The menu does *not* decide whether an action can be taken — the facade's
 * `quote` already answered that in each option's `allowed`/`reason`. The cursor
 * may rest on a disallowed option (so the player can read its reason, Req 21.5);
 * acting on it is the owning screen's concern, gated by the same `allowed` flag.
 */

/** The action menu's cursor state: which option is highlighted. */
export interface MenuState {
  /**
   * The index of the highlighted option within the current `ActionOption[]`.
   * `0` when the list is empty, and always clamped to a valid index for a
   * non-empty list.
   */
  readonly index: number;
}

/** The initial menu state, with the cursor on the first option. */
export function initialMenuState(): MenuState {
  return { index: 0 };
}

/** A menu action, one per keypress the component handles. */
export type MenuAction =
  /** Move the cursor to the next/previous option (wrapping). */
  | { readonly type: 'next' }
  | { readonly type: 'prev' }
  /** Jump the cursor to a specific option index (clamped into range). */
  | { readonly type: 'select'; readonly index: number }
  /**
   * Re-clamp the cursor after the option list changed length (e.g. a new turn
   * offers a different set), so it never points past the end.
   */
  | { readonly type: 'clamp' };

/** Clamp an index into `[0, count)`; `0` when the list is empty. */
function clampIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  if (index < 0) {
    return 0;
  }
  if (index >= count) {
    return count - 1;
  }
  return index;
}

/** Step the index within `count` options, wrapping around the ends. */
function wrap(index: number, step: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return (index + step + count) % count;
}

/**
 * The pure action-menu reducer. Applies one {@link MenuAction} against the
 * {@link MenuState}, given the current option count, and returns the next state;
 * never mutates its input. `count` is the length of the `ActionOption[]` the
 * component renders — passed in rather than stored, so the reducer stays a pure
 * function of (state, action, count) and the option list lives only on the
 * component as a prop.
 *
 * - `next`/`prev` move the cursor one option, wrapping at the ends.
 * - `select` jumps to an index, clamped into range.
 * - `clamp` re-clamps the current index (used when the list length changes).
 *
 * On an empty list every action resolves to index `0`.
 */
export function reduceMenu(
  state: MenuState,
  action: MenuAction,
  count: number,
): MenuState {
  switch (action.type) {
    case 'next':
      return { index: wrap(state.index, 1, count) };
    case 'prev':
      return { index: wrap(state.index, -1, count) };
    case 'select':
      return { index: clampIndex(action.index, count) };
    case 'clamp':
      return { index: clampIndex(state.index, count) };
    default:
      return state;
  }
}
