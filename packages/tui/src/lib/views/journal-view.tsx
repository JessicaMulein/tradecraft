/**
 * The Journal view — the TUI's player aid for the recorded fact log and notes
 * (design, "Player Aids": "Journal"; Requirements 33.1, 33.2).
 *
 * The Journal records the Fact Lines of every action, meeting, Cable and
 * delivered event, grouped by day and phase (Req 33.1), plus the player's own
 * notes attached to a day, an entity or a Claim (Req 33.2). This component
 * renders that view-safe {@link JournalView}: a day-by-day, phase-by-phase
 * listing of Fact Lines, followed by the player's notes with their attachment.
 *
 * ## Presentational
 *
 * The pane is pure presentation: it takes the {@link JournalView} as a prop, so
 * it renders identically from a live projection (`EngineApi.views.journal()`) or
 * a fixture. It holds no state — the Journal is read-only — so there is no
 * reducer in this slice for it.
 *
 * ## Boundary
 *
 * The pane reads only `@tradecraft/player-view` types (Req 13.5): the view-safe
 * {@link JournalView} and the {@link noteAttachmentKind} helper. Every value is
 * an already-rendered Fact Line, note text or a view-safe id — never Flavour or
 * a truth field (Req 2.2).
 */

import type { ReactElement } from 'react';
import { Box, Text } from 'ink';
import { noteAttachmentKind, type JournalView } from '@tradecraft/player-view';

import { phaseName } from '../scene/time.js';

/** Props for {@link JournalPane}. */
export interface JournalPaneProps {
  /** The Journal view — the fact log grouped by day/phase, and the notes. */
  readonly journal: JournalView;
}

/** The element type of {@link JournalView.days} (one grouped day). */
type JournalDayRow = JournalView['days'][number];
/** The element type of a day's `phases` (one phase's entries). */
type JournalPhaseRow = JournalDayRow['phases'][number];
/** The element type of {@link JournalView.notes} (one player note). */
type JournalNoteRow = JournalView['notes'][number];

/** Render one phase within a day: a dim phase heading, then its Fact Lines. */
function PhaseBlock({
  day,
  phase,
}: {
  readonly day: number;
  readonly phase: JournalPhaseRow;
}): ReactElement {
  return (
    <Box flexDirection="column" marginLeft={2}>
      <Text dimColor>{phaseName(phase.phase)}</Text>
      {phase.entries.map((entry) => (
        <Box key={`${day}:${phase.phase}:${entry.seq}`} flexDirection="column" marginLeft={2}>
          {entry.factLines.map((line, index) => (
            // Fact Lines are a stable, ordered projection that is never
            // reordered, so an entry-scoped index is a stable key.
            <Text key={`${entry.seq}:${index}`}>{line}</Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}

/** Render one day: a bold `Day N` heading, then each phase that has entries. */
function DayBlock({ day }: { readonly day: JournalDayRow }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Day {day.day}</Text>
      {day.phases.map((phase) => (
        <PhaseBlock key={`${day.day}:${phase.phase}`} day={day.day} phase={phase} />
      ))}
    </Box>
  );
}

/** The player-facing target of a note, from its attachment kind and value. */
function noteTarget(note: JournalNoteRow): string {
  const kind = noteAttachmentKind(note.attachTo);
  switch (kind) {
    case 'day':
      return `Day ${note.attachTo}`;
    case 'claim':
      return `Claim ${note.attachTo}`;
    default:
      return String(note.attachTo);
  }
}

/** Render the player's notes, each tagged with what it is attached to. */
function NotesBlock({ notes }: { readonly notes: JournalView['notes'] }): ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Notes</Text>
      {notes.length === 0 ? (
        <Text dimColor>No notes yet.</Text>
      ) : (
        notes.map((note) => (
          <Box key={note.seq} marginLeft={2}>
            <Text>
              <Text dimColor>[{noteTarget(note)}] </Text>
              {note.text}
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
}

/**
 * The Journal pane: the fact log grouped by day then phase (Req 33.1), followed
 * by the player's notes (Req 33.2). An empty Journal shows a hint in place of
 * the day list. The notes section always renders, with its own empty hint, so
 * the player can see where notes will appear.
 */
export function JournalPane({ journal }: JournalPaneProps): ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>Journal</Text>
      {journal.days.length === 0 ? (
        <Text dimColor>Nothing recorded yet.</Text>
      ) : (
        <Box flexDirection="column">
          {journal.days.map((day) => (
            <DayBlock key={day.day} day={day} />
          ))}
        </Box>
      )}
      <NotesBlock notes={journal.notes} />
    </Box>
  );
}
