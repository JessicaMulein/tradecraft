/**
 * The design's success-or-error `Result<T, E>`, for engine functions that
 * either produce a value or report what went wrong (for example
 * `validateFeedItems` in `../action/feed-validation.ts`).
 *
 * The shape is structurally identical to player-view's `Result` (in
 * `player-view/src/lib/api/types.ts`), so an engine result can be returned
 * through the Engine API facade without a translation step. The engine cannot
 * import player-view, so the type is declared here and the two stay in step by
 * shape.
 */

/**
 * A success-or-error result. `ok: true` carries a `value`; `ok: false` carries
 * an `error`.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
