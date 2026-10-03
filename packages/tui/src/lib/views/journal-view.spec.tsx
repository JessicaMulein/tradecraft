/**
 * Component tests for the Ink Journal pane (task 22.7; design, "Player Aids":
 * "Journal"; Requirements 33.1, 33.2). These render the real component with
 * ink-testing-library and assert: the fact log is grouped by day and phase with
 * each entry's Fact Lines shown, the player's notes are listed with their
 * attachment target (day, entity or Claim), and the empty states render.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { JournalView } from '@tradecraft/player-view';

import { JournalPane } from './journal-view.js';

afterEach(() => {
  cleanup();
});

/** A Journal view with two days, several phases and a few notes. */
const populated: JournalView = {
  days: [
    {
      day: 1,
      phases: [
        {
          phase: 0,
          entries: [
            { seq: 1, at: { day: 1, phase: 0 }, factLines: ['You arrive at the café.'], refs: [] },
          ],
        },
        {
          phase: 2,
          entries: [
            { seq: 2, at: { day: 1, phase: 2 }, factLines: ['Viktor declines the meeting.'], refs: [] },
          ],
        },
      ],
    },
    {
      day: 2,
      phases: [
        {
          phase: 0,
          entries: [
            {
              seq: 3,
              at: { day: 2, phase: 0 },
              factLines: ['The morning paper arrives.', 'A quiet week on the embankment.'],
              refs: [],
            },
          ],
        },
      ],
    },
  ],
  entries: [],
  notes: [
    { seq: 1, at: { day: 1, phase: 0 }, attachTo: 1, text: 'Watch the café on Tuesdays.' },
    { seq: 2, at: { day: 1, phase: 1 }, attachTo: 'npc:viktor', text: 'Nervous around the window.' },
    { seq: 3, at: { day: 2, phase: 0 }, attachTo: 'claim:42', text: 'Doubt this one.' },
  ],
};

describe('JournalPane fact log', () => {
  it('groups entries by day and phase and shows their Fact Lines', () => {
    const { lastFrame } = render(<JournalPane journal={populated} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Day 1');
    expect(frame).toContain('Day 2');
    expect(frame).toContain('morning');
    expect(frame).toContain('evening');
    expect(frame).toContain('You arrive at the café.');
    expect(frame).toContain('Viktor declines the meeting.');
    expect(frame).toContain('The morning paper arrives.');
    expect(frame).toContain('A quiet week on the embankment.');
  });
});

describe('JournalPane notes', () => {
  it('lists each note with its attachment target', () => {
    const { lastFrame } = render(<JournalPane journal={populated} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Notes');
    expect(frame).toContain('Watch the café on Tuesdays.');
    expect(frame).toContain('Day 1');
    expect(frame).toContain('npc:viktor');
    expect(frame).toContain('Nervous around the window.');
    expect(frame).toContain('Claim claim:42');
    expect(frame).toContain('Doubt this one.');
  });
});

describe('JournalPane empty states', () => {
  it('shows a hint for an empty fact log and an empty notes list', () => {
    const { lastFrame } = render(
      <JournalPane journal={{ days: [], entries: [], notes: [] }} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Nothing recorded yet.');
    expect(frame).toContain('No notes yet.');
  });
});
