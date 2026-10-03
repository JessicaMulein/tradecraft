/**
 * Component tests for the Ink game-over screen (task 22.10; design, "TUI": the
 * game-over screen "stating the outcome … and the end day and phase", offering
 * the debrief; Requirements 13.7, 19.4, 19.5). These render the real component
 * with ink-testing-library and drive it through simulated key presses, asserting
 * the banner, the end day/phase, the cause text and the menu callbacks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';

import { GameOverScreen } from './game-over-screen.js';

// Terminal escape sequences ink decodes into `useInput` key presses.
const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  enter: '\r',
} as const;

/** Advance a tick so ink flushes input-driven re-renders. */
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

afterEach(() => {
  cleanup();
});

describe('GameOverScreen banner and detail', () => {
  it('states a success outcome, the end day/phase and the cause (Req 13.7, 19.4)', () => {
    const { lastFrame } = render(
      <GameOverScreen outcome="success" endedAt={{ day: 12, phase: 2 }} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Success');
    expect(frame).toContain('Day 12, evening');
    expect(frame).toContain('Cause: success');
  });

  it('states a Plot failure outcome', () => {
    const { lastFrame } = render(
      <GameOverScreen outcome="plot-failure" endedAt={{ day: 9, phase: 0 }} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Failure');
    expect(frame).toContain('Day 9, morning');
  });

  it('states a burned outcome (Req 19.5)', () => {
    const { lastFrame } = render(
      <GameOverScreen outcome="cover-burned" endedAt={{ day: 3, phase: 3 }} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Burned');
    expect(frame).toContain('Day 3, night');
    expect(frame).toContain('Cause: cover-burned');
  });

  it('shows all three menu options with the first highlighted', () => {
    const { lastFrame } = render(
      <GameOverScreen outcome="success" endedAt={{ day: 1, phase: 0 }} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Open Debrief');
    expect(frame).toContain('Save');
    expect(frame).toContain('Quit');
    expect(frame).toContain('> Open Debrief');
  });
});

describe('GameOverScreen menu navigation and callbacks', () => {
  it('opens the debrief on Enter from the default selection (Req 13.7)', async () => {
    const onDebrief = vi.fn();
    const { stdin } = render(
      <GameOverScreen
        outcome="success"
        endedAt={{ day: 1, phase: 0 }}
        onDebrief={onDebrief}
      />,
    );
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onDebrief).toHaveBeenCalledTimes(1);
  });

  it('moves down to Save and fires onSave', async () => {
    const onSave = vi.fn();
    const { stdin } = render(
      <GameOverScreen
        outcome="success"
        endedAt={{ day: 1, phase: 0 }}
        onSave={onSave}
      />,
    );
    await tick();
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('wraps up from Debrief to Quit and fires onQuit', async () => {
    const onQuit = vi.fn();
    const { stdin } = render(
      <GameOverScreen
        outcome="success"
        endedAt={{ day: 1, phase: 0 }}
        onQuit={onQuit}
      />,
    );
    await tick();
    stdin.write(KEY.up);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('highlights the moved-to option in the frame', async () => {
    const { stdin, lastFrame } = render(
      <GameOverScreen outcome="success" endedAt={{ day: 1, phase: 0 }} />,
    );
    await tick();
    stdin.write(KEY.down);
    await tick();
    expect(lastFrame() ?? '').toContain('> Save');
  });
});
