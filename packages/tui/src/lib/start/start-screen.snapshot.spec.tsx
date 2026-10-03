/**
 * Snapshot tests for the Ink start screen (task 22.9; Requirements 13.2, 13.6).
 * These capture the rendered frame of the new-game option fields and the brief
 * Cable surface, from fixed, deterministic fixtures so the snapshots stay
 * stable.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { DocumentView } from '@tradecraft/player-view';

import { StartScreen } from './start-screen.js';

/** A view-safe brief Cable fixture (the `GameView.brief` shape). */
const briefCable: DocumentView = {
  id: 'doc:brief',
  kind: 'cable',
  title: 'STATION BRIEF — EYES ONLY',
  date: { day: 0, phase: 0 },
  dateLabel: 'Day 0, morning',
  body: 'You arrive under commercial cover.\n\nReport to the Chief of Station.',
  read: false,
};

/**
 * Strip ANSI colour escapes from a rendered frame. ink emits colour codes only
 * when the runner reports colour support, so snapshotting the raw frame would
 * differ between the direct `vitest` run and the `nx`/CI run; the plain text is
 * stable across both.
 */
function plain(frame: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

afterEach(() => {
  cleanup();
});

describe('StartScreen snapshot', () => {
  it('renders the option fields with a supplied seed', () => {
    const { lastFrame } = render(
      <StartScreen defaults={{ seed: 'orient-express' }} onStart={vi.fn()} />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "New Game

      > Seed: orient-express
        Difficulty: standard
        Internal mole: on
        Narration: full

      ↑/↓ move · ←/→ change · type a seed · Enter to start"
    `);
  });

  it('renders the brief Cable once the game has started', () => {
    const { lastFrame } = render(
      <StartScreen onStart={vi.fn()} brief={briefCable} />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Briefing Cable

      STATION BRIEF — EYES ONLY
      cable · Day 0, morning

      You arrive under commercial cover.

      Report to the Chief of Station."
    `);
  });
});
