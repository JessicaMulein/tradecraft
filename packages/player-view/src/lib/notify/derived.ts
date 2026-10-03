/**
 * The derived player-visible events, raised at phase boundaries from player-side
 * expectations (task 16.6; design, "Notifications": "The engine raises the
 * derived player-visible events at phase boundaries. It decides them only from
 * expectations the player set up: arranged meetings, own Dead Drops, and
 * `lastContact`"; Requirement 39.5).
 *
 * A hidden event — an Asset arrested by the Hostile Service, say — must never
 * notify the player directly (Requirement 39.4). What the player *can* observe
 * is the consequence: a meeting the Asset was supposed to keep goes unattended,
 * a drop they were supposed to load is found empty, or they fall silent past the
 * configured period. {@link raiseDerivedEvents} turns those observations into
 * the four derived player-visible {@link SimEvent}s so `notify` can surface them
 * — but it reads **only player-side expectations**, never the hidden Sim state
 * that caused them. It is given:
 *
 * - the **arranged meetings** that are now due and still unresolved — the player
 *   knows they arranged them, so a no-show is observable (`meeting-no-show`);
 * - the **Dead Drops** the player serviced this boundary that another party was
 *   expected to have loaded, but found unserviced (`drop-unserviced`);
 * - the **Assets** whose last contact is now `silenceDays` or more in the past
 *   (`asset-silent`); and
 * - the **retainers** that have fallen due this boundary (`retainer-due`).
 *
 * Each input is a view-safe expectation the caller (the Turn Pipeline, task
 * 16.8) assembles from the Player View; this module turns them into events
 * deterministically, with no PRNG draw and no Truth read. Deciding them from
 * expectations rather than hidden state is exactly what keeps Requirement 39.5
 * honoured and lets Property 28 hold (a hidden event with no observable
 * consequence raises nothing here, so it leaves the Notification stream
 * unchanged).
 */

import {
  compareTime,
  type DeadDropId,
  type EventId,
  type GameTime,
  type MeetingId,
  type NpcId,
  type SimEvent,
} from '@tradecraft/engine';

/**
 * A meeting the player arranged that is now due and the other party did not
 * attend — the observable consequence of (for example) an arrested or doubled
 * Asset. The player knows they arranged it, so surfacing a no-show reveals no
 * hidden state.
 */
export interface MeetingExpectation {
  readonly meeting: MeetingId;
  /** When the meeting was due (the event is stamped with the slot). */
  readonly slot: GameTime;
}

/**
 * A Dead Drop the player serviced that another party should have loaded but was
 * found unserviced. The player's own servicing is what makes this observable.
 */
export interface DropExpectation {
  readonly drop: DeadDropId;
  /** When the player found it unserviced. */
  readonly at: GameTime;
}

/**
 * An Asset whose last contact is now `days` days in the past. The caller
 * computes `days` from the Player View's last-contact record and the current
 * day; this module only decides whether it meets the silence threshold.
 */
export interface SilenceExpectation {
  readonly npc: NpcId;
  /** Days since the player last had contact (from the Player View). */
  readonly days: number;
  /** The current time, stamped on the raised event. */
  readonly at: GameTime;
}

/** A retainer the player owes a money-motivated Asset that has fallen due. */
export interface RetainerExpectation {
  readonly npc: NpcId;
  readonly amount: number;
  /** When the retainer fell due. */
  readonly at: GameTime;
}

/**
 * The player-side expectations the raiser reads at a phase boundary. Every field
 * is a view-safe expectation the player set up; none is hidden Sim state.
 */
export interface DerivedExpectations {
  /** Meetings now due with no-shows by the other party. */
  readonly meetingNoShows?: readonly MeetingExpectation[];
  /** Dead Drops the player serviced and found unserviced. */
  readonly unservicedDrops?: readonly DropExpectation[];
  /** Assets whose last contact is now at or past the silence period. */
  readonly silences?: readonly SilenceExpectation[];
  /** Retainers that have fallen due this boundary. */
  readonly retainersDue?: readonly RetainerExpectation[];
  /**
   * The configured silence period in days (scenario `silenceDays`, default 3).
   * An Asset's silence is only reported when its `days` is at least this.
   */
  readonly silenceDays: number;
}

/** A deterministic, replay-safe event id for a derived event. */
function derivedEventId(tag: string, key: string): EventId {
  return `event:derived:${tag}:${key}`;
}

/**
 * Raise the derived player-visible events for one phase boundary from the given
 * expectations (Requirement 39.5). Pure and deterministic: no PRNG draw, no
 * clock read, no Truth read. The returned events are ordered meeting-no-shows,
 * then unserviced drops, then silences, then retainers, each in the input order,
 * and then sorted by event time so they deliver in time order with the turn's
 * other events (design, "Timing"). An expectation that does not meet its
 * threshold (a silence shorter than `silenceDays`) raises nothing.
 */
export function raiseDerivedEvents(expectations: DerivedExpectations): SimEvent[] {
  const events: SimEvent[] = [];

  for (const m of expectations.meetingNoShows ?? []) {
    events.push({
      kind: 'meeting-no-show',
      id: derivedEventId('no-show', m.meeting),
      at: m.slot,
      visibility: 'player',
      meeting: m.meeting,
    });
  }

  for (const d of expectations.unservicedDrops ?? []) {
    events.push({
      kind: 'drop-unserviced',
      id: derivedEventId('drop', d.drop),
      at: d.at,
      visibility: 'player',
      drop: d.drop,
    });
  }

  for (const s of expectations.silences ?? []) {
    if (s.days < expectations.silenceDays) {
      continue;
    }
    events.push({
      kind: 'asset-silent',
      id: derivedEventId('silent', `${s.npc}:${s.at.day}`),
      at: s.at,
      visibility: 'player',
      npc: s.npc,
      days: s.days,
    });
  }

  for (const r of expectations.retainersDue ?? []) {
    events.push({
      kind: 'retainer-due',
      id: derivedEventId('retainer', `${r.npc}:${r.at.day}.${r.at.phase}`),
      at: r.at,
      visibility: 'player',
      npc: r.npc,
      amount: r.amount,
    });
  }

  return events.sort((a, b) => compareTime(a.at, b.at));
}
