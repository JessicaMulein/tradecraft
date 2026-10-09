/**
 * The {@link Notification} union (task 16.6; design, "Notifications
 * (`player-view/notify`)"; Requirement 39.6).
 *
 * A Notification is the player-facing record of a player-visible event: a Cable
 * arriving, a Directive issued or resolved, a meeting accepted/declined/no-show,
 * a Walk-in, the daily newspaper, an unserviced Dead Drop, an Asset gone silent
 * or a retainer falling due (Requirement 39.3). Each carries its own typed
 * payload plus the four shared fields the design fixes — the minted `id`, the
 * game time `at` the event happened, the already-rendered `factLine`, and the
 * `dismissed` flag the status bar reads (Requirement 39.6).
 *
 * ## Truth isolation (Requirements 2.2, 39.7)
 *
 * Every variant references only view-safe ids — a {@link DocId}, a
 * {@link DirectiveId}, a {@link MeetingId}, a {@link DeadDropId}, or an NPC id
 * the player can see — and a plain amount or day count. None carries a
 * {@link import('@tradecraft/engine').Truth} field, a true allegiance or a
 * concealed Proposition, because the player-visible {@link SimEvent} variants a
 * Notification is built from (and the player-side expectations the derived
 * events are raised from) carry none either. That is what lets Property 28 hold:
 * a Notification built by `notify` references only entities in the player's
 * known set and contains no truth-branded field.
 */

import type {
  CityId,
  DeadDropId,
  DirectiveId,
  DocId,
  GameTime,
  HandoffId,
  MeetingId,
  NotificationId,
  NpcId,
  ServiceId,
  TravelDocId,
} from '@tradecraft/engine';

/**
 * The fields every {@link Notification} carries, regardless of kind (design:
 * `{ id; at; factLine; dismissed }`).
 */
export interface NotificationBase {
  /** The view-minted id, stable for dismissal (Requirement 39.6). */
  readonly id: NotificationId;
  /** When the underlying event happened (the event's own day and phase). */
  readonly at: GameTime;
  /** The already-rendered, view-safe Fact Line (no Flavour, no Truth). */
  readonly factLine: string;
  /** Whether the player has dismissed it; the status bar shows undismissed. */
  readonly dismissed: boolean;
}

/**
 * A player-facing Notification (design's `Notification` union; Requirements
 * 39.3, 39.6). The discriminated variants match the design one-for-one:
 *
 * - `cable` — a Cable arrived from the Station (`doc`).
 * - `directive` — a Directive was issued, met or failed (`directive`, `status`).
 * - `meeting-reply` — the other party accepted or declined (`npc`, `accepted`,
 *   `meeting`).
 * - `meeting-due` — an arranged meeting is due now (`meeting`).
 * - `meeting-no-show` — the other party failed to appear (`meeting`).
 * - `walk-in` — someone made contact unbidden (`npc`).
 * - `newspaper` — the daily edition is out (`doc`).
 * - `drop-unserviced` — a Dead Drop the player expected serviced was not
 *   (`drop`).
 * - `asset-silent` — an Asset has gone `days` with no contact (`npc`, `days`).
 * - `retainer-due` — a retainer of `amount` is due (`npc`, `amount`).
 */
export type Notification = NotificationBase &
  (
    | { readonly kind: 'cable'; readonly doc: DocId }
    | {
        readonly kind: 'directive';
        readonly directive: DirectiveId;
        readonly status: 'issued' | 'met' | 'failed';
      }
    | {
        readonly kind: 'meeting-reply';
        readonly npc: NpcId;
        readonly accepted: boolean;
        readonly meeting: MeetingId;
      }
    | { readonly kind: 'meeting-due'; readonly meeting: MeetingId }
    | { readonly kind: 'meeting-no-show'; readonly meeting: MeetingId }
    | { readonly kind: 'walk-in'; readonly npc: NpcId }
    | { readonly kind: 'newspaper'; readonly doc: DocId }
    | { readonly kind: 'drop-unserviced'; readonly drop: DeadDropId }
    | { readonly kind: 'asset-silent'; readonly npc: NpcId; readonly days: number }
    | { readonly kind: 'retainer-due'; readonly npc: NpcId; readonly amount: number }
    | { readonly kind: 'public-announcement'; readonly text: string }
    | { readonly kind: 'cover-duty-due' | 'cover-duty-missed'; readonly duty: string }
    | { readonly kind: 'cover-employer-message'; readonly text: string }
    | { readonly kind: 'drop-disturbed'; readonly drop: DeadDropId }
    | { readonly kind: 'departure-cancelled'; readonly route: string }
    | { readonly kind: 'border-outcome'; readonly post: string; readonly outcome: string }
    | { readonly kind: 'papers-issued'; readonly doc: TravelDocId }
    | { readonly kind: 'visa-decision'; readonly country: string; readonly granted: boolean }
    | { readonly kind: 'liaison-report'; readonly service: ServiceId }
    | { readonly kind: 'outstation-report'; readonly city: CityId }
    | { readonly kind: 'courier-delivery'; readonly handoff: HandoffId }
    | { readonly kind: 'asset-arrived'; readonly npc: NpcId }
    | { readonly kind: 'expelled'; readonly country: string }
  );

/** The discriminant of a {@link Notification}. */
export type NotificationKind = Notification['kind'];
