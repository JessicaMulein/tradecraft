/**
 * Unit tests for the Journal fact log and notes (task 16.2; Requirements 33.1,
 * 33.2; design, "Player Aids").
 *
 * These drive the pure {@link Journal} store and the {@link journalView}
 * projection directly with view-safe inputs — hand-built {@link ActionResult}s,
 * player-visible and hidden {@link SimEvent}s, and notes — and assert:
 *
 * - the Journal records a committed action's Fact Lines, grouped by day and
 *   phase (Req 33.1);
 * - a delivered, player-visible event's Fact Lines are recorded under the
 *   event's own day and phase (Req 33.1), and a hidden event is never recorded
 *   (Req 2.2);
 * - the player can attach a note to a day, an entity or a Claim (Req 33.2); and
 * - the projection is view-safe (Fact Lines, note text and ids only).
 *
 * The truth-isolation *property* is task 16.5; these are the example-based unit
 * tests the Journal's own correctness rests on.
 */

import { describe, expect, it } from 'vitest';

import type {
  ActionResult,
  GameTime,
  NpcId,
  Phase,
  Proposition,
  SimEvent,
} from '@tradecraft/engine';

import {
  Journal,
  eventRefs,
  noteAttachmentKind,
  propositionRefs,
} from './journal.js';
import { journalView } from './view.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function time(day: number, phase: Phase): GameTime {
  return { day, phase };
}

/** A Proposition with the given parts, for building Observations. */
function prop(
  subject: Proposition['subject'],
  predicate: string,
  object: Proposition['object'],
  place?: Proposition['place'],
): Proposition {
  return { id: `p:${subject}:${predicate}`, subject, predicate, object, place };
}

/** An ActionResult carrying the given Fact Lines, Observations and Claims. */
function actionResult(over: Partial<ActionResult> = {}): ActionResult {
  return {
    observations: [],
    factLines: [],
    scene: { loc: 'loc:cafe', description: '', atmosphere: [], risk: 0, visible: [] },
    events: [],
    claimsAdded: [],
    ...over,
  };
}

/** A player-visible event, with a `visibility` tag and the given fields. */
function playerEvent(over: Partial<SimEvent> & Pick<SimEvent, 'kind'>): SimEvent {
  return {
    id: `e:${over.kind}`,
    at: time(1, 0),
    visibility: 'player',
    ...over,
  } as SimEvent;
}

// ---------------------------------------------------------------------------
// recordAction (Req 33.1)
// ---------------------------------------------------------------------------

describe('Journal.recordAction', () => {
  it('records an action\u2019s Fact Lines with its time and refs', () => {
    const journal = new Journal();
    const subject = 'npc:viktor' as NpcId;
    const object = 'loc:cafe';
    const result = actionResult({
      factLines: ['You watch the cafe.', 'A man in a grey coat arrives.'],
      observations: [
        {
          kind: 'proposition',
          prop: prop(subject, 'LOCATED_AT', object, 'loc:cafe'),
          at: time(2, 1),
          source: { kind: 'surveillance', loc: 'loc:cafe' },
        },
        { kind: 'message', line: 'A man in a grey coat arrives.' },
      ],
      claimsAdded: ['claim:7'],
    });

    const entry = journal.recordAction(result, time(2, 1));
    expect(entry).toBeDefined();
    expect(entry?.at).toEqual(time(2, 1));
    expect(entry?.factLines).toEqual([
      'You watch the cafe.',
      'A man in a grey coat arrives.',
    ]);
    // refs: the proposition's subject + object + place, plus the added Claim.
    expect(entry?.refs).toContain(subject);
    expect(entry?.refs).toContain(object);
    expect(entry?.refs).toContain('claim:7');
    expect(journal.entryCount).toBe(1);
  });

  it('records nothing for an action that produced no Fact Lines', () => {
    const journal = new Journal();
    const entry = journal.recordAction(actionResult({ factLines: [] }), time(1, 0));
    expect(entry).toBeUndefined();
    expect(journal.entryCount).toBe(0);
  });

  it('de-duplicates refs', () => {
    const journal = new Journal();
    const npc = 'npc:ana' as NpcId;
    const result = actionResult({
      factLines: ['Line.'],
      observations: [
        {
          kind: 'proposition',
          prop: prop(npc, 'KNOWS', npc),
          at: time(1, 0),
          source: { kind: 'npc', npc },
        },
      ],
      claimsAdded: [],
    });
    const entry = journal.recordAction(result, time(1, 0));
    expect(entry?.refs).toEqual([npc]);
  });
});

// ---------------------------------------------------------------------------
// recordEvent (Req 33.1, 2.2)
// ---------------------------------------------------------------------------

describe('Journal.recordEvent', () => {
  it('records a delivered, player-visible event under its own day and phase', () => {
    const journal = new Journal();
    const event = playerEvent({
      kind: 'cable',
      at: time(3, 2),
      doc: 'doc:brief',
    } as Partial<SimEvent> & { kind: 'cable' });

    const entry = journal.recordEvent(event, ['A Cable arrives from the Station.']);
    expect(entry).toBeDefined();
    expect(entry?.at).toEqual(time(3, 2));
    expect(entry?.factLines).toEqual(['A Cable arrives from the Station.']);
    expect(entry?.refs).toEqual(['doc:brief']);
  });

  it('never records a hidden event', () => {
    const journal = new Journal();
    const hidden: SimEvent = {
      id: 'e:npc-moved',
      at: time(1, 0),
      visibility: 'hidden',
      kind: 'npc-moved',
      npc: 'npc:viktor' as NpcId,
      from: 'loc:cafe',
      to: 'loc:park',
    } as SimEvent;

    const entry = journal.recordEvent(hidden, ['should never appear']);
    expect(entry).toBeUndefined();
    expect(journal.entryCount).toBe(0);
  });

  it('records nothing for a player-visible event with no Fact Lines', () => {
    const journal = new Journal();
    const event = playerEvent({ kind: 'day-start' } as Partial<SimEvent> & { kind: 'day-start' });
    expect(journal.recordEvent(event, [])).toBeUndefined();
    expect(journal.entryCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Grouping by day and phase (Req 33.1)
// ---------------------------------------------------------------------------

describe('Journal.grouped and entries', () => {
  it('groups entries by day then phase, days and phases ascending', () => {
    const journal = new Journal();
    // Append out of order to prove the group/sort does the ordering.
    journal.append(time(2, 1), ['day 2 afternoon']);
    journal.append(time(1, 3), ['day 1 night']);
    journal.append(time(1, 0), ['day 1 morning a']);
    journal.append(time(1, 0), ['day 1 morning b']);

    const grouped = journal.grouped();
    expect(grouped.map((d) => d.day)).toEqual([1, 2]);

    const day1 = grouped[0];
    expect(day1.phases.map((p) => p.phase)).toEqual([0, 3]);
    // Within a phase, append order is preserved.
    expect(day1.phases[0].entries.map((e) => e.factLines[0])).toEqual([
      'day 1 morning a',
      'day 1 morning b',
    ]);

    const day2 = grouped[1];
    expect(day2.phases.map((p) => p.phase)).toEqual([1]);
  });

  it('returns entries flat, earliest first', () => {
    const journal = new Journal();
    journal.append(time(2, 0), ['later']);
    journal.append(time(1, 0), ['earlier']);
    expect(journal.entries().map((e) => e.factLines[0])).toEqual([
      'earlier',
      'later',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Notes (Req 33.2)
// ---------------------------------------------------------------------------

describe('Journal.addNote', () => {
  it('attaches a note to a day, an entity or a Claim', () => {
    const journal = new Journal();
    journal.addNote({ at: time(1, 0), attachTo: 3, text: 'check the park on day 3' });
    journal.addNote({ at: time(1, 1), attachTo: 'npc:viktor' as NpcId, text: 'cover is cracking' });
    journal.addNote({ at: time(1, 2), attachTo: 'claim:12', text: 'corroborate this' });

    const notes = journal.notes();
    expect(notes).toHaveLength(3);
    expect(noteAttachmentKind(notes[0].attachTo)).toBe('day');
    expect(noteAttachmentKind(notes[1].attachTo)).toBe('entity');
    expect(noteAttachmentKind(notes[2].attachTo)).toBe('claim');
  });

  it('filters notes by their attachment', () => {
    const journal = new Journal();
    const npc = 'npc:ana' as NpcId;
    journal.addNote({ at: time(1, 0), attachTo: npc, text: 'a' });
    journal.addNote({ at: time(1, 1), attachTo: npc, text: 'b' });
    journal.addNote({ at: time(1, 2), attachTo: 5, text: 'other' });

    expect(journal.notesFor(npc).map((n) => n.text)).toEqual(['a', 'b']);
    expect(journal.notesFor(5).map((n) => n.text)).toEqual(['other']);
  });

  it('orders notes earliest first', () => {
    const journal = new Journal();
    journal.addNote({ at: time(2, 0), attachTo: 2, text: 'second' });
    journal.addNote({ at: time(1, 0), attachTo: 1, text: 'first' });
    expect(journal.notes().map((n) => n.text)).toEqual(['first', 'second']);
  });
});

// ---------------------------------------------------------------------------
// Ref helpers
// ---------------------------------------------------------------------------

describe('propositionRefs', () => {
  it('gathers subject, entity object and place; skips a literal object', () => {
    const npc = 'npc:viktor' as NpcId;
    const withEntity = prop(npc, 'MEETS_AT', 'npc:ana' as NpcId, 'loc:cafe');
    expect(propositionRefs(withEntity)).toEqual([npc, 'npc:ana', 'loc:cafe']);

    const withLiteral = prop(npc, 'PAID', { kind: 'amount', value: 100 });
    expect(propositionRefs(withLiteral)).toEqual([npc]);
  });
});

describe('eventRefs', () => {
  it('names the entity each player-visible event concerns', () => {
    expect(
      eventRefs(playerEvent({ kind: 'newspaper', doc: 'doc:times' } as Partial<SimEvent> & { kind: 'newspaper' })),
    ).toEqual(['doc:times']);
    expect(
      eventRefs(playerEvent({ kind: 'walk-in', npc: 'npc:x' as NpcId } as Partial<SimEvent> & { kind: 'walk-in' })),
    ).toEqual(['npc:x']);
  });
});

// ---------------------------------------------------------------------------
// journalView projection (view-safety)
// ---------------------------------------------------------------------------

describe('journalView', () => {
  it('projects days, flat entries and notes, carrying only view-safe strings', () => {
    const journal = new Journal();
    journal.recordAction(
      actionResult({ factLines: ['You watch the cafe.'] }),
      time(1, 0),
    );
    journal.recordEvent(
      playerEvent({ kind: 'cable', at: time(1, 1), doc: 'doc:brief' } as Partial<SimEvent> & { kind: 'cable' }),
      ['A Cable arrives.'],
    );
    journal.addNote({ at: time(1, 1), attachTo: 'npc:viktor' as NpcId, text: 'suspect' });

    const view = journalView(journal);
    expect(view.days.map((d) => d.day)).toEqual([1]);
    expect(view.entries).toHaveLength(2);
    expect(view.notes).toHaveLength(1);

    // Everything in the serialized view is a plain string, number, id or Fact
    // Line — there is no truth-branded value to leak.
    const serialized = JSON.stringify(view);
    expect(serialized).toContain('You watch the cafe.');
    expect(serialized).toContain('A Cable arrives.');
    expect(serialized).toContain('suspect');
  });
});
