/**
 * The Journal: the player's append-only fact log, plus their own notes
 * (Requirements 33.1, 33.2; design, "Player Aids").
 *
 * The design writes the Journal as "an append-only list of `{ at, factLines,
 * refs }` built from `ActionResult`s and delivered events, plus player notes
 * `{ at, attachTo: day | EntityId | ClaimId, text }`. Flavour is excluded."
 * This module is that store.
 *
 * ## What goes in (and what stays out)
 *
 * A Journal **entry** records the Fact Lines of one action, meeting, Cable or
 * delivered event, stamped with the game time it happened and the view-safe
 * entity/Claim/Document ids it concerns (`refs`). Fact Lines are produced
 * deterministically by the Sim's predicate third-person templates with the
 * player namer — they are already rendered and view-safe — so recording them
 * never touches ground truth. The Journal records those, and the `claimsAdded`
 * ids the same action filed into the Case File.
 *
 * Flavour (the Narrator's streamed prose) is deliberately **excluded**: it is
 * stored only in transcripts and never reaches the Case File or the Journal
 * (design, "Fact vs Flavour"; "Flavour … never reaches the extractor, Case File
 * or Journal fact log"). The record methods here take Fact Lines, never
 * Narrator output, so there is nowhere for Flavour to enter.
 *
 * ## Truth isolation (Requirement 2.2)
 *
 * Like the Case File, the Journal is strictly Player-View data. It holds Fact
 * Lines (already rendered, view-safe strings), player note text, and view-safe
 * ids — never a {@link Truth} field, a true allegiance or a concealed
 * Proposition. The only engine import is the shared *shape* vocabulary (ids,
 * {@link GameTime}, the player-visible {@link SimEvent} kinds and the
 * {@link ActionResult} / {@link Observation} / {@link Proposition} shapes), not
 * any ground-truth store.
 *
 * Two requirements anchor the module:
 *
 * - **Requirement 33.1.** The Journal records the Fact Lines of every action,
 *   meeting, Cable and delivered event, grouped by day and phase.
 *   {@link Journal.recordAction} and {@link Journal.recordEvent} append the
 *   entries; {@link Journal.entries} returns them in time order, and
 *   {@link Journal.grouped} groups them by day then phase.
 * - **Requirement 33.2.** The player can add notes attached to a day, an entity
 *   or a Claim. {@link Journal.addNote} records one; {@link Journal.notes}
 *   returns them.
 */

import {
  compareTime,
  isPlayerVisibleKind,
  type ClaimId,
  type EntityId,
  type GameTime,
  type Observation,
  type Proposition,
  type SimEvent,
} from '@tradecraft/engine';
import type { ActionResult } from '@tradecraft/engine';

// ---------------------------------------------------------------------------
// Entries, notes and refs
// ---------------------------------------------------------------------------

/**
 * A reference an entry or note points at: a view-safe {@link EntityId} (an NPC,
 * Location, organisation, item, Document or `unk:` id) or a Case File
 * {@link ClaimId}. These are the ids the TUI uses to let the player jump from a
 * Journal line to the People view, the Map, a Document or the Case File. A
 * {@link ClaimId} is a plain string, so it is kept distinct from an
 * {@link EntityId} by the `claim:`-prefixed convention the Case File mints.
 */
export type JournalRef = EntityId | ClaimId;

/**
 * One Journal entry (design `{ at, factLines, refs }`). `at` is when it
 * happened (the entry is grouped by `at.day` then `at.phase`); `factLines` are
 * the already-rendered, view-safe Fact Lines; `refs` are the view-safe ids the
 * entry concerns, so the TUI can link out. A monotonic `seq` gives entries a
 * total, stable order within a single `at` and records append order (the
 * "append-only list" the design asks for).
 */
export interface JournalEntry {
  /** Append order: a monotonic sequence number, unique within one Journal. */
  readonly seq: number;
  /** When the entry's event happened (grouped by day then phase; Req 33.1). */
  readonly at: GameTime;
  /** The already-rendered, view-safe Fact Lines (no Flavour; Req 2.2). */
  readonly factLines: readonly string[];
  /** The view-safe ids this entry concerns (entities and Claims). */
  readonly refs: readonly JournalRef[];
}

/**
 * What a {@link JournalNote} is attached to (design `attachTo: day | EntityId |
 * ClaimId`):
 *
 * - a **day** (a `number`) — a note pinned to a calendar day;
 * - an **{@link EntityId}** — a note about a person, Location, organisation,
 *   item or Document; or
 * - a **{@link ClaimId}** — a note about a Case File Claim.
 *
 * An {@link EntityId} and a {@link ClaimId} are both strings, so the union is
 * `number | string`; the Journal preserves whichever the caller passed and the
 * TUI interprets a string by its id prefix (`claim:` for a Claim).
 */
export type NoteAttachment = number | EntityId | ClaimId;

/** The attachment-kind discriminant for a note, derived from the value. */
export type NoteAttachmentKind = 'day' | 'entity' | 'claim';

/**
 * The kind of a note's attachment: `day` for a numeric day, `claim` for a
 * `claim:`-prefixed Claim id, `entity` for any other id. Lets the TUI render a
 * note's target without re-deriving the discriminant.
 */
export function noteAttachmentKind(attachTo: NoteAttachment): NoteAttachmentKind {
  if (typeof attachTo === 'number') {
    return 'day';
  }
  return attachTo.startsWith('claim:') ? 'claim' : 'entity';
}

/**
 * One player note (design `{ at, attachTo, text }`; Requirement 33.2). `at` is
 * when the player wrote it; `attachTo` is the day, entity or Claim it hangs
 * off; `text` is the player's own words. A monotonic `seq` gives notes a stable
 * append order, matching the entry store.
 */
export interface JournalNote {
  /** Append order: a monotonic sequence number, unique within one Journal. */
  readonly seq: number;
  /** When the player wrote the note. */
  readonly at: GameTime;
  /** The day, entity or Claim the note is attached to (Req 33.2). */
  readonly attachTo: NoteAttachment;
  /** The player's note text. */
  readonly text: string;
}

/** The input to {@link Journal.addNote}: everything but the minted `seq`. */
export interface NoteInput {
  readonly at: GameTime;
  readonly attachTo: NoteAttachment;
  readonly text: string;
}

/**
 * A plain, JSON-serialisable snapshot of a {@link Journal} for the save file
 * (task 21.1; design `SaveSnapshot.journal`). It carries the stored entries and
 * notes verbatim (both already hold only view-safe strings and ids) plus the
 * two monotonic counters, so {@link Journal.fromSnapshot} rebuilds a Journal
 * whose next `seq`s continue exactly where the saved game left off — a load
 * that then appends keeps the same total order the live game would have.
 */
export interface JournalSnapshot {
  /** The stored entries, in append order. */
  readonly entries: readonly JournalEntry[];
  /** The stored notes, in append order. */
  readonly notes: readonly JournalNote[];
  /** The next entry `seq` to assign (so appends after a load continue the order). */
  readonly nextEntrySeq: number;
  /** The next note `seq` to assign. */
  readonly nextNoteSeq: number;
}

/**
 * One day's worth of grouped entries (Requirement 33.1, "grouped by day and
 * phase"): the day number and, within it, the entries of each phase that has
 * any, in phase order. A phase with no entries is omitted.
 */
export interface JournalDay {
  readonly day: number;
  readonly phases: readonly JournalPhase[];
}

/** One phase's entries within a {@link JournalDay}, in append order. */
export interface JournalPhase {
  readonly phase: GameTime['phase'];
  readonly entries: readonly JournalEntry[];
}

// ---------------------------------------------------------------------------
// Deriving Fact Lines and refs from the sources the Journal is built from
// ---------------------------------------------------------------------------

/**
 * The view-safe ids a {@link Proposition} concerns: its subject, its object
 * (only when the object is an entity id, not a literal), and its place. These
 * are the entities a Fact Line rendered from the Proposition speaks of, so the
 * player can link a Journal line back to a person, Location or Document.
 */
export function propositionRefs(prop: Proposition): JournalRef[] {
  const refs: JournalRef[] = [prop.subject];
  if (typeof prop.object === 'string') {
    refs.push(prop.object);
  }
  if (prop.place !== undefined) {
    refs.push(prop.place);
  }
  return refs;
}

/** The refs a single {@link Observation} contributes (a `message` has none). */
function observationRefs(obs: Observation): JournalRef[] {
  return obs.kind === 'proposition' ? propositionRefs(obs.prop) : [];
}

/**
 * The view-safe ids a delivered, player-visible {@link SimEvent} concerns. Only
 * player-visible event kinds reach the Journal (see {@link Journal.recordEvent}),
 * and those variants carry no {@link Truth} fields, so every id gathered here is
 * view-safe. An event kind that names no entity (a bare `day-start`) yields no
 * refs.
 */
export function eventRefs(event: SimEvent): JournalRef[] {
  switch (event.kind) {
    case 'newspaper':
    case 'cable':
      return [event.doc];
    case 'directive':
      return [event.directive];
    case 'walk-in':
    case 'asset-silent':
    case 'retainer-due':
    case 'custody-released':
      return [event.npc];
    case 'meeting-reply':
    case 'meeting-due':
    case 'meeting-no-show':
    case 'meeting-missed-by-player':
      return [event.meeting];
    case 'drop-unserviced':
      return [event.drop];
    default:
      return [];
  }
}

/** De-duplicate a ref list, preserving first-seen order. */
function dedupeRefs(refs: readonly JournalRef[]): JournalRef[] {
  return [...new Set(refs)];
}

// ---------------------------------------------------------------------------
// The Journal store
// ---------------------------------------------------------------------------

/**
 * The append-only Journal store (Requirements 33.1, 33.2). It accumulates
 * entries from the actions and delivered events a turn commits, and the notes
 * the player writes, and reads them back in time order or grouped by day and
 * phase.
 *
 * The store is append-only: entries and notes are never removed or rewritten,
 * matching the design's "append-only list". Each read returns a fresh, read-
 * only snapshot, so a caller cannot reach in and mutate stored entries.
 */
export class Journal {
  /** Entries in append order. */
  private readonly entryList: JournalEntry[] = [];

  /** Notes in append order. */
  private readonly noteList: JournalNote[] = [];

  /** Monotonic counter behind entry `seq`s. */
  private nextEntrySeq = 1;

  /** Monotonic counter behind note `seq`s. */
  private nextNoteSeq = 1;

  /**
   * Record the Fact Lines of one committed {@link ActionResult} (Requirement
   * 33.1). The entry is stamped with `at` — the game time the action resolved,
   * which the Turn Pipeline (task 16.8) supplies — and carries the result's
   * already-rendered `factLines` and the refs drawn from its Observations and
   * the Case File Claims it added. An action that produced no Fact Lines records
   * no entry (there is nothing for the player to read).
   *
   * Flavour is never passed here: `factLines` are the Sim's deterministic Fact
   * Lines, and the Narrator's streamed prose is delivered through the Turn
   * stream, not this method — so no Flavour can enter the log (Req 2.2).
   */
  recordAction(result: ActionResult, at: GameTime): JournalEntry | undefined {
    if (result.factLines.length === 0) {
      return undefined;
    }
    const refs = dedupeRefs([
      ...result.observations.flatMap(observationRefs),
      ...result.claimsAdded,
    ]);
    return this.append(at, result.factLines, refs);
  }

  /**
   * Record the Fact Line(s) of one delivered, player-visible {@link SimEvent}
   * (Requirement 33.1: "meeting, Cable and delivered event"). The caller renders
   * the event's Fact Line(s) through the content templates and the player namer
   * (task 16.6's `notify`) and hands them here with the event; the entry is
   * stamped with the event's own `at`, so it groups under the day and phase the
   * event happened (design, task 16.6: "Write Fact Lines to the Journal under
   * each event's own day and phase").
   *
   * A hidden event is never recorded: it is off-screen simulation the player
   * must infer, and recording it would leak. {@link isPlayerVisibleKind} gates
   * this, and the player-visible variants carry no {@link Truth} fields, so the
   * refs gathered are view-safe. An empty `factLines` records nothing.
   */
  recordEvent(event: SimEvent, factLines: readonly string[]): JournalEntry | undefined {
    if (!isPlayerVisibleKind(event.kind) || factLines.length === 0) {
      return undefined;
    }
    return this.append(event.at, factLines, dedupeRefs(eventRefs(event)));
  }

  /**
   * Append an entry directly from already-rendered Fact Lines and refs. The
   * lower-level seam the Turn Pipeline uses when it has composed the Fact Lines
   * itself; {@link recordAction} and {@link recordEvent} are the common paths.
   * An empty `factLines` records nothing.
   */
  append(
    at: GameTime,
    factLines: readonly string[],
    refs: readonly JournalRef[] = [],
  ): JournalEntry | undefined {
    if (factLines.length === 0) {
      return undefined;
    }
    const entry: JournalEntry = {
      seq: this.nextEntrySeq,
      at,
      factLines: [...factLines],
      refs: dedupeRefs(refs),
    };
    this.nextEntrySeq += 1;
    this.entryList.push(entry);
    return entry;
  }

  /**
   * Add a player note attached to a day, entity or Claim (Requirement 33.2).
   * Returns the recorded note. The text is stored verbatim (trimming and length
   * limits are a TUI concern); an empty text is still recorded, so the player's
   * intent is never silently dropped.
   */
  addNote(input: NoteInput): JournalNote {
    const note: JournalNote = {
      seq: this.nextNoteSeq,
      at: input.at,
      attachTo: input.attachTo,
      text: input.text,
    };
    this.nextNoteSeq += 1;
    this.noteList.push(note);
    return note;
  }

  /** The number of entries in the Journal. */
  get entryCount(): number {
    return this.entryList.length;
  }

  /** The number of notes in the Journal. */
  get noteCount(): number {
    return this.noteList.length;
  }

  /**
   * Every entry, earliest first, ties broken by append order (`seq`). A fresh
   * snapshot; mutating it does not touch the store.
   */
  entries(): JournalEntry[] {
    return [...this.entryList].sort(compareEntries);
  }

  /**
   * Every note, earliest first, ties broken by append order (`seq`). A fresh
   * snapshot.
   */
  notes(): JournalNote[] {
    return [...this.noteList].sort(compareNotes);
  }

  /** The notes attached to a given day, entity or Claim, in time order. */
  notesFor(attachTo: NoteAttachment): JournalNote[] {
    return this.notes().filter((note) => note.attachTo === attachTo);
  }

  /**
   * Every entry grouped by day then phase (Requirement 33.1, "grouped by day
   * and phase"). Days are returned earliest first; within a day, only the phases
   * that have entries appear, in phase order; within a phase, entries keep their
   * append order. A fresh snapshot built from {@link entries}.
   */
  grouped(): JournalDay[] {
    const byDay = new Map<number, Map<GameTime['phase'], JournalEntry[]>>();
    for (const entry of this.entries()) {
      let phases = byDay.get(entry.at.day);
      if (phases === undefined) {
        phases = new Map();
        byDay.set(entry.at.day, phases);
      }
      const bucket = phases.get(entry.at.phase);
      if (bucket === undefined) {
        phases.set(entry.at.phase, [entry]);
      } else {
        bucket.push(entry);
      }
    }

    return [...byDay.keys()]
      .sort((a, b) => a - b)
      .map((day) => {
        const phases = byDay.get(day) as Map<GameTime['phase'], JournalEntry[]>;
        const ordered = [...phases.keys()]
          .sort((a, b) => a - b)
          .map((phase) => ({ phase, entries: phases.get(phase) as JournalEntry[] }));
        return { day, phases: ordered };
      });
  }

  /**
   * A plain, JSON-serialisable snapshot for the save file (task 21.1). The
   * entries and notes are copied in append order (not time order), and the two
   * `seq` counters are carried, so {@link Journal.fromSnapshot} rebuilds a store
   * that is equal to this one and whose later appends keep the same ordering the
   * live game would have produced.
   */
  snapshot(): JournalSnapshot {
    return {
      entries: this.entryList.map((e) => ({ ...e, factLines: [...e.factLines], refs: [...e.refs] })),
      notes: this.noteList.map((n) => ({ ...n })),
      nextEntrySeq: this.nextEntrySeq,
      nextNoteSeq: this.nextNoteSeq,
    };
  }

  /**
   * Rebuild a {@link Journal} from a {@link JournalSnapshot} read from a save
   * (task 21.1). The entries and notes are defensively copied so the rebuilt
   * store does not alias the loaded save object, and the `seq` counters are
   * restored so a later append continues the saved order.
   */
  static fromSnapshot(snapshot: JournalSnapshot): Journal {
    const journal = new Journal();
    for (const entry of snapshot.entries) {
      journal.entryList.push({
        ...entry,
        factLines: [...entry.factLines],
        refs: [...entry.refs],
      });
    }
    for (const note of snapshot.notes) {
      journal.noteList.push({ ...note });
    }
    journal.nextEntrySeq = snapshot.nextEntrySeq;
    journal.nextNoteSeq = snapshot.nextNoteSeq;
    return journal;
  }
}

/** Order entries by time, ties broken by append order. */
function compareEntries(a: JournalEntry, b: JournalEntry): number {
  const byTime = compareTime(a.at, b.at);
  return byTime !== 0 ? byTime : a.seq - b.seq;
}

/** Order notes by time, ties broken by append order. */
function compareNotes(a: JournalNote, b: JournalNote): number {
  const byTime = compareTime(a.at, b.at);
  return byTime !== 0 ? byTime : a.seq - b.seq;
}
