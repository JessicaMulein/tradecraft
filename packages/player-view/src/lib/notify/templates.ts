/**
 * The notification content templates and the player-perspective namer (task
 * 16.6; design, "Notifications (`player-view/notify`)": "builds each
 * Notification from a content template, with the player-perspective `namer`").
 *
 * A notification's Fact Line is composed from a fixed, authored template for its
 * kind, with the view-safe entities it names rendered through the player
 * namer. The namer here is **identity-aware**: it labels an NPC by their persona
 * name only when the player has identified them, and by their physical
 * descriptor otherwise — the same rule {@link import('../api/views.js').personLabel}
 * applies to scenes. That is the load-bearing difference from the engine's
 * document namer (which always renders a persona name): a Notification must only
 * ever reference entities in the player's known set and must never spell out the
 * name of someone the player has not identified (Requirements 39.7, 2.2;
 * Property 28).
 *
 * The templates are plain functions of a {@link NotifyNamer} and the event's
 * view-safe payload. They carry no Truth read, so a rendered Fact Line is
 * view-safe by construction.
 */

import { formatDate, type GameTime } from '@tradecraft/engine';

/**
 * The player-perspective namer a template renders entity ids through. Given a
 * view-safe id (an NPC the player can see, a Location, a Document, a Directive,
 * a Dead Drop) it returns the text the player should read for it. For an NPC it
 * returns the persona name when identified and the physical descriptor when not,
 * so an unidentified person is never named.
 *
 * The namer is supplied by the caller — the Notifications layer builds it from
 * the live Player View (`WorldState` view-safe surface) — which keeps this
 * module a pure function of its inputs with no engine-state coupling.
 */
export type NotifyNamer = (id: string) => string;

/** Render a {@link GameTime} as the plain day/phase form the player reads. */
export function notifyDate(at: GameTime): string {
  return formatDate(at);
}

// ---------------------------------------------------------------------------
// Per-kind templates
// ---------------------------------------------------------------------------

/** A Cable has arrived from the Station. */
export function cableFactLine(): string {
  return 'A Cable has arrived from the Station.';
}

/** The daily newspaper edition is out. */
export function newspaperFactLine(): string {
  return "Today's newspaper is available.";
}

/** A Directive was issued, met or failed. */
export function directiveFactLine(
  namer: NotifyNamer,
  directive: string,
  status: 'issued' | 'met' | 'failed',
): string {
  const label = namer(directive);
  switch (status) {
    case 'issued':
      return `The Station has issued a Directive: ${label}.`;
    case 'met':
      return `Directive met: ${label}.`;
    case 'failed':
      return `Directive failed: ${label}.`;
  }
}

/** The other party accepted or declined an arranged meeting. */
export function meetingReplyFactLine(
  namer: NotifyNamer,
  npc: string,
  accepted: boolean,
): string {
  const who = namer(npc);
  return accepted
    ? `${who} has agreed to meet.`
    : `${who} has declined to meet.`;
}

/** An arranged meeting is due now. */
export function meetingDueFactLine(): string {
  return 'An arranged meeting is due.';
}

/** The other party did not appear at an arranged meeting. */
export function meetingNoShowFactLine(): string {
  return 'The other party did not appear at the arranged meeting.';
}

/** Someone made contact with the player unbidden. */
export function walkInFactLine(namer: NotifyNamer, npc: string): string {
  return `${namer(npc)} has made contact.`;
}

/** A Dead Drop the player expected serviced was left unserviced. */
export function dropUnservicedFactLine(namer: NotifyNamer, drop: string): string {
  return `The dead drop at ${namer(drop)} was not serviced.`;
}

/** An Asset has gone the configured silence period with no contact. */
export function assetSilentFactLine(
  namer: NotifyNamer,
  npc: string,
  days: number,
): string {
  const span = days === 1 ? '1 day' : `${days} days`;
  return `${namer(npc)} has been silent for ${span}.`;
}

/** A public announcement the Station has already heard. */
export function publicAnnouncementFactLine(text: string): string {
  return text;
}

/** A cover duty is one phase away. */
export function coverDutyDueFactLine(duty: string): string {
  return `Your employer expects you for ${duty}.`;
}

/** A mandatory cover duty was missed. */
export function coverDutyMissedFactLine(duty: string): string {
  return `Your employer notes that you missed ${duty}.`;
}

/** A message from the cover employer. */
export function coverEmployerMessageFactLine(text: string): string {
  return text;
}

/** A dead drop the player services has been disturbed. */
export function dropDisturbedFactLine(namer: NotifyNamer, drop: string): string {
  return `The dead drop at ${namer(drop)} has been disturbed.`;
}

/** A retainer is due to a money-motivated Asset. */
export function retainerDueFactLine(
  namer: NotifyNamer,
  npc: string,
  amount: number,
): string {
  return `A retainer of ${amount} is due to ${namer(npc)}.`;
}

export function departureCancelledFactLine(route: string): string {
  return `The departure on ${route} is cancelled.`;
}

export function borderOutcomeFactLine(post: string, outcome: string): string {
  return `The border at ${post} reports ${outcome}.`;
}

export function papersIssuedFactLine(): string {
  return 'Travel papers have been issued.';
}

export function visaDecisionFactLine(country: string, granted: boolean): string {
  return granted ? `A visa for ${country} is granted.` : `A visa for ${country} is refused.`;
}

export function liaisonReportFactLine(service: string): string {
  return `A report arrives from ${service}.`;
}

export function outstationReportFactLine(city: string): string {
  return `The outstation in ${city} reports in.`;
}

export function courierDeliveryFactLine(): string {
  return 'A courier delivery has arrived.';
}

export function assetArrivedFactLine(namer: NotifyNamer, npc: string): string {
  return `${namer(npc)} has arrived.`;
}

export function expelledFactLine(country: string): string {
  return `You are expelled from ${country}.`;
}
