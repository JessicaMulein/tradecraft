/**
 * The App Shell's {@link Screen} union — the screens the shell routes between,
 * each a view-safe description of what is on screen right now (design, "TUI: App
 * Shell"; Requirements 19.2, 19.3, 19.6, 19.7).
 *
 * A `Screen` is a pure data value: the reducer in `./shell.ts` swaps the current
 * screen in response to a key press or a turn chunk, and the {@link
 * import('@tradecraft/player-view').EngineApi}-backed shell component renders the
 * matching Ink screen for the active variant. Every payload a screen carries is
 * already view-safe — a {@link GameView} brief Cable, a derived branded id, a
 * `paused` chunk's error, the public outcome tag — so nothing truth-bearing is
 * reachable across the `tui → player-view` boundary (Req 13.5).
 *
 * ## Why the ids are derived, not imported
 *
 * The engine's branded ids (`DocId`, `InterceptId`, `NpcId`) live in
 * `@tradecraft/engine`, which the TUI must not import (the dependency-cruiser
 * `tui-imports-only-player-view` rule). The player-view views re-export them
 * structurally on their `id` fields, so this module derives each id type from
 * the view that carries it — exactly as the Documents slice derives its
 * `DocumentId` from `DocumentView['id']`. The ids stay the same branded type the
 * facade accepts, with no engine import.
 */

import type {
  DocumentView,
  GameView,
  PeopleView,
  TurnChunk,
  WorkbenchView,
} from '@tradecraft/player-view';

/**
 * A Document id, as the facade accepts it (`EngineApi.views.document(id)`).
 * Derived from the view's `id` field so the shell names it without importing the
 * engine's branded `DocId`.
 */
export type DocId = DocumentView['id'];

/**
 * An Intercept id, as the facade accepts it (`EngineApi.views.workbench(id)`).
 * Derived from {@link WorkbenchView}'s `id` field.
 */
export type InterceptId = WorkbenchView['id'];

/**
 * An NPC id — the person a feed is composed for. Derived from the People view's
 * person-entry `id` field (the known `npc:`/`unk:` id the People view holds).
 */
export type NpcId = PeopleView['people'][number]['id'];

/**
 * The public outcome tag an `ended` turn carries (design: the game-over screen
 * reads the outcome tag). Derived from the `ended` {@link TurnChunk} variant, in
 * step with the facade's own shape, the same way the endpoint-error slice
 * derives its `PausedError`.
 */
export type Outcome = Extract<TurnChunk, { kind: 'ended' }>['outcome'];

/**
 * The `paused` turn chunk's error payload (the unreachable endpoint and its
 * message). Derived from the `paused` {@link TurnChunk} variant so the shell's
 * endpoint-error screen names it without an internal import.
 */
export type PausedError = Extract<TurnChunk, { kind: 'paused' }>['error'];

/**
 * The screens the App Shell routes between (design, "TUI: App Shell"). Each
 * variant is tagged by `kind` and carries only the view-safe data its screen
 * needs:
 *
 * - `start` — the new-game start screen the shell opens on (Req 19.2).
 * - `brief` — the Starting Brief Cable and the in-person-briefing offer, holding
 *   the {@link GameView} `newGame` returned (Req 19.2).
 * - `scene` — the main scene, Here panel and action menu (Req 19.3).
 * - `case-file`, `journal`, `map`, `people` — the standalone view screens.
 * - `documents` — the Documents list, optionally opened on a Document (`open`).
 * - `workbench` — the Workbench, optionally opened on an Intercept.
 * - `feed` — the feed composer for a turned Asset (`asset`).
 * - `save-load` — the save or load screen, in the chosen `mode`.
 * - `endpoint-error` — shown on a `paused` chunk, carrying its error (Req 19.6).
 * - `game-over` — shown on an `ended` chunk, carrying the outcome (Req 19.7).
 * - `debrief` — the end-of-game debrief, opened from `game-over` (Req 19.7).
 */
export type Screen =
  | { readonly kind: 'start' }
  | { readonly kind: 'brief'; readonly view: GameView }
  | { readonly kind: 'scene' }
  | { readonly kind: 'case-file' }
  | { readonly kind: 'documents'; readonly open?: DocId }
  | { readonly kind: 'workbench'; readonly intercept?: InterceptId }
  | { readonly kind: 'journal' }
  | { readonly kind: 'map' }
  | { readonly kind: 'city' }
  | { readonly kind: 'stories' }
  | { readonly kind: 'duties' }
  | { readonly kind: 'people' }
  | { readonly kind: 'feed'; readonly asset: NpcId }
  | { readonly kind: 'save-load'; readonly mode: 'save' | 'load' }
  | { readonly kind: 'endpoint-error'; readonly error: PausedError }
  | { readonly kind: 'game-over'; readonly outcome: Outcome }
  | { readonly kind: 'debrief' };

/** Every {@link Screen} `kind`, for exhaustive handling and tests. */
export type ScreenKind = Screen['kind'];
