/**
 * The {@link PendingCable} data model and the {@link CableReplySpec} that says
 * what a reply will do (design, "Action Resolver": replies arrive after the
 * preset delay; Requirements 27.4, 27.5).
 *
 * This module is deliberately *dependency-light*: it imports only the core model
 * ids and the {@link CableRequest} shape from the (equally dependency-light)
 * action-types module, and nothing from `../model/state.ts`. That is what lets
 * `../model/state.ts` re-export {@link PendingCable} from here (so
 * `WorldState.station.pendingCables` carries it) without forming an import
 * cycle — the same leaf split `./directive-types.ts` uses. The submit/process
 * behaviour that needs the state module's `SimEvent` lives in `./cables.ts`,
 * which state.ts does *not* re-export.
 */

import type { GameTime } from '../model/core.js';
import type { CableRequest } from '../action/types.js';

/**
 * What a reply will do once its PendingCable comes due, decided at submit time
 * so the pending record is self-describing. The Pipeline reads this to apply the
 * reply without re-deriving it.
 *
 * - `trace`  — compose and deliver a Dossier on `target` (an entity id).
 * - `funds`  — grant up to the Standing-scaled cap (the smaller of the cap and
 *   any `requested` amount), credited to the ledger.
 * - `report` — adjust Standing by `standingDelta`.
 */
export type CableReplySpec =
  | { readonly kind: 'trace'; readonly target: string }
  | { readonly kind: 'funds'; readonly requested?: number }
  | { readonly kind: 'report'; readonly standingDelta: number };

/**
 * A Cable the player sent that is awaiting HQ's reply (design's pending-cable
 * state). Carries the originating request, when it was sent, when the reply is
 * due (sent + the preset delay) and the {@link CableReplySpec} that says what
 * the reply grants.
 *
 * This is the real interface that replaces the task-4.6 skeleton `PendingCable`
 * in `../model/state.ts`; `WorldState.station.pendingCables` is
 * `readonly PendingCable[]`.
 */
export interface PendingCable {
  /** A stable id, minted from the request and the send time. */
  readonly id: string;
  /** The request the player sent. */
  readonly request: CableRequest;
  /** When the Cable was sent. */
  readonly sentAt: GameTime;
  /** When the reply is due (sentAt + the preset delay). */
  readonly replyDue: GameTime;
  /** What the reply will do. */
  readonly reply: CableReplySpec;
}
