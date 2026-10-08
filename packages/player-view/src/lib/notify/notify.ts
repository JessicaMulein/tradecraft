/**
 * The pure `notify` over player-visible events (task 16.6; design,
 * "Notifications (`player-view/notify`)"; Requirements 39.2, 39.3, 39.5, 39.7).
 *
 * `notify(events, view)` turns a turn's {@link SimEvent}s into the player-facing
 * {@link Notification}s the status bar shows and whose Fact Lines the Journal
 * records. It is **pure** and honours visibility: it acts only on player-visible
 * events and ignores every hidden one (`visibility === 'hidden'`), so a hidden
 * event that produces no player-visible event leaves the Notification stream
 * unchanged (Requirement 39.4 is a sibling concern, but `notify` must respect it
 * — Property 28). Each Notification's Fact Line is built from the content
 * template for its kind, rendered through the identity-aware player namer, so it
 * references only entities in the player's known set and carries no Truth field
 * (Requirements 39.7, 2.2).
 *
 * The player-visible event kinds `notify` turns into Notifications are exactly
 * those the design lists (Requirement 39.3): Cable arrivals, Directive issue and
 * resolution, meeting replies, meeting dues and no-shows, Walk-ins, the daily
 * newspaper, unserviced Dead Drops, Assets gone silent and retainers due. Two
 * player-visible kinds carry no Notification: `day-start` (a pure time tick with
 * no message) and `meeting-missed-by-player` and `custody-released` (observable
 * state the Journal records through other means, not a status-bar alert). Those
 * are skipped rather than mis-rendered, so the Notification stream stays exactly
 * the design's list.
 */

import { isPlayerVisibleKind, type NotificationId, type SimEvent } from '@tradecraft/engine';

import type { Notification } from './notification.js';
import {
  assetSilentFactLine,
  cableFactLine,
  directiveFactLine,
  dropUnservicedFactLine,
  meetingDueFactLine,
  meetingNoShowFactLine,
  meetingReplyFactLine,
  coverDutyDueFactLine,
  coverDutyMissedFactLine,
  coverEmployerMessageFactLine,
  dropDisturbedFactLine,
  newspaperFactLine,
  publicAnnouncementFactLine,
  retainerDueFactLine,
  walkInFactLine,
  type NotifyNamer,
} from './templates.js';
import { notifyNamer, type NotifyView } from './view.js';

/**
 * The id a Notification carries, derived deterministically from the event's own
 * id. Deriving it from the {@link SimEvent} id keeps `notify` pure (no counter,
 * no clock) and gives a stable, replay-safe id the status bar can dismiss by.
 */
export function notificationIdFor(event: SimEvent): NotificationId {
  return `notification:${event.id}`;
}

/**
 * Build the Notification for one player-visible event, or `undefined` when the
 * kind carries no status-bar alert (a bare `day-start`, a player's own missed
 * meeting, a custody release). The caller has already checked the event is
 * player-visible.
 */
function notificationForEvent(
  event: SimEvent,
  namer: NotifyNamer,
  view: NotifyView,
): Notification | undefined {
  const base = {
    id: notificationIdFor(event),
    at: event.at,
    dismissed: false,
  } as const;

  switch (event.kind) {
    case 'cable':
      return { ...base, kind: 'cable', doc: event.doc, factLine: cableFactLine() };
    case 'newspaper':
      return { ...base, kind: 'newspaper', doc: event.doc, factLine: newspaperFactLine() };
    case 'directive':
      return {
        ...base,
        kind: 'directive',
        directive: event.directive,
        status: event.status,
        factLine: directiveFactLine(namer, event.directive, event.status),
      };
    case 'meeting-reply': {
      const npc = npcForMeeting(event, view);
      return {
        ...base,
        kind: 'meeting-reply',
        npc,
        accepted: event.accepted,
        meeting: event.meeting,
        factLine: meetingReplyFactLine(namer, npc, event.accepted),
      };
    }
    case 'meeting-due':
      return { ...base, kind: 'meeting-due', meeting: event.meeting, factLine: meetingDueFactLine() };
    case 'meeting-no-show':
      return {
        ...base,
        kind: 'meeting-no-show',
        meeting: event.meeting,
        factLine: meetingNoShowFactLine(),
      };
    case 'walk-in':
      return { ...base, kind: 'walk-in', npc: event.npc, factLine: walkInFactLine(namer, event.npc) };
    case 'drop-unserviced':
      return {
        ...base,
        kind: 'drop-unserviced',
        drop: event.drop,
        factLine: dropUnservicedFactLine(namer, event.drop),
      };
    case 'asset-silent':
      return {
        ...base,
        kind: 'asset-silent',
        npc: event.npc,
        days: event.days,
        factLine: assetSilentFactLine(namer, event.npc, event.days),
      };
    case 'retainer-due':
      return {
        ...base,
        kind: 'retainer-due',
        npc: event.npc,
        amount: event.amount,
        factLine: retainerDueFactLine(namer, event.npc, event.amount),
      };
    case 'public-announcement':
      return {
        ...base,
        kind: 'public-announcement',
        text: event.text,
        factLine: publicAnnouncementFactLine(event.text),
      };
    case 'cover-duty-due':
      return {
        ...base,
        kind: 'cover-duty-due',
        duty: event.duty,
        factLine: coverDutyDueFactLine(event.duty),
      };
    case 'cover-duty-missed':
      return {
        ...base,
        kind: 'cover-duty-missed',
        duty: event.duty,
        factLine: coverDutyMissedFactLine(event.duty),
      };
    case 'cover-employer-message':
      return {
        ...base,
        kind: 'cover-employer-message',
        text: event.text,
        factLine: coverEmployerMessageFactLine(event.text),
      };
    case 'drop-disturbed':
      return {
        ...base,
        kind: 'drop-disturbed',
        drop: event.drop,
        factLine: dropDisturbedFactLine(namer, event.drop),
      };
    // Player-visible kinds that carry no status-bar Notification.
    case 'day-start':
    case 'meeting-missed-by-player':
    case 'custody-released':
      return undefined;
    default:
      return undefined;
  }
}

/**
 * The NPC a `meeting-reply` event concerns. The event payload carries only the
 * {@link import('@tradecraft/engine').MeetingId}, so we resolve the party from
 * the {@link NotifyView}'s meetings map; if the meeting is not held there (an
 * older or synthetic event) we fall back to the `<npc>@` prefix the
 * arrange-meeting resolver mints the id with (`meeting:<npc>@<loc>#…`). Either
 * way this stays a pure, view-safe read.
 */
function npcForMeeting(
  event: Extract<SimEvent, { kind: 'meeting-reply' }>,
  view: NotifyView,
): `npc:${string}` {
  const recorded = view.meetings[event.meeting];
  if (recorded !== undefined) {
    return recorded.npc;
  }
  const body = event.meeting.slice('meeting:'.length);
  const at = body.indexOf('@');
  const npcLocal = at === -1 ? body : body.slice(0, at);
  return (npcLocal.startsWith('npc:') ? npcLocal : `npc:${npcLocal}`) as `npc:${string}`;
}

/**
 * Turn a turn's events into Notifications (design `notify`). Pure, and ignores
 * `visibility === 'hidden'`: only player-visible events contribute, so the
 * stream equals `notify(events.filter(e => e.visibility === 'player'), view)`
 * (Property 28). Events are processed in input order, and each contributing
 * event yields at most one Notification; the result preserves that order.
 */
export function notify(events: readonly SimEvent[], view: NotifyView): Notification[] {
  const namer = notifyNamer(view);
  const out: Notification[] = [];
  for (const event of events) {
    if (!isPlayerVisibleKind(event.kind)) {
      continue;
    }
    const notification = notificationForEvent(event, namer, view);
    if (notification !== undefined) {
      out.push(notification);
    }
  }
  return out;
}
