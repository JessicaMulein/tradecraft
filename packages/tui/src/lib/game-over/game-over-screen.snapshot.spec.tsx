/**
 * Inline-snapshot tests for the Ink game-over screen (task 22.15; design, "TUI":
 * the game-over screen states the outcome and the end day/phase and offers the
 * debrief; Requirements 13.7). These render the real component with
 * ink-testing-library 4.0.0 and capture `lastFrame()` as an inline snapshot for
 * two meaningful states — a classified success and a burned failure — so the
 * exact banner, end day/phase, cause line and menu layout stay under review.
 *
 * The screen reads a clock only through its `endedAt` prop, so every fixture
 * passes a fixed day/phase; nothing here touches `Date.now`/`Math.random`.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';

import { GameOverScreen } from './game-over-screen.js';

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

describe('GameOverScreen snapshots', () => {
  it('renders a classified success outcome', () => {
    const { lastFrame } = render(
      <GameOverScreen outcome="success" endedAt={{ day: 12, phase: 2 }} />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Success — the Plot was disrupted

      Ended Day 12, evening
      Cause: success

      > Open Debrief
        Save
        Quit

      ↑/↓ move · Enter to choose"
    `);
  });

  it('renders a burned failure outcome', () => {
    const { lastFrame } = render(
      <GameOverScreen outcome="cover-burned" endedAt={{ day: 3, phase: 3 }} />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Burned — your cover was blown

      Ended Day 3, night
      Cause: cover-burned

      > Open Debrief
        Save
        Quit

      ↑/↓ move · Enter to choose"
    `);
  });
});
