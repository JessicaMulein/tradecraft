/**
 * Component tests for the Ink start screen and Cable reader (task 22.1; design,
 * "Start screen"; Requirements 1.6, 26.4, 34.3). These render the real
 * components with ink-testing-library and drive them through simulated key
 * presses, asserting the rendered fields and the `onStart` payload.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { DocumentView } from '@tradecraft/player-view';

import { StartScreen } from './start-screen.js';
import { CableReader } from './cable-reader.js';
import type { NewGameOptions } from './options.js';

// Terminal escape sequences ink decodes into `useInput` key presses.
const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  enter: '\r',
  backspace: '\u007F',
} as const;

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

afterEach(() => {
  cleanup();
});

describe('StartScreen fields', () => {
  it('shows the seed, difficulty, mole and narration fields with their defaults', () => {
    const { lastFrame } = render(<StartScreen onStart={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Seed:');
    expect(frame).toContain('(random');
    expect(frame).toContain('Difficulty: standard');
    expect(frame).toContain('Internal mole: on');
    expect(frame).toContain('Narration: full');
  });

  it('shows a supplied seed rather than the random hint (Req 1.6)', () => {
    const { lastFrame } = render(
      <StartScreen defaults={{ seed: 'orient-express' }} onStart={vi.fn()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Seed: orient-express');
    expect(frame).not.toContain('(random');
  });
});

/** Advance a tick so ink flushes input-driven re-renders. */
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

/** The options passed to the first `onStart` call, failing if it never fired. */
function firstStartOptions(
  onStart: ReturnType<typeof vi.fn<(opts: NewGameOptions) => void>>,
): NewGameOptions {
  const [call] = onStart.mock.calls;
  if (call === undefined) {
    throw new Error('onStart was not called');
  }
  return call[0];
}

describe('StartScreen selection and confirm', () => {
  it('confirms the defaults with no seed so the Sim generates one (Req 1.6)', async () => {
    const onStart = vi.fn<(opts: NewGameOptions) => void>();
    const { stdin } = render(<StartScreen onStart={onStart} />);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onStart).toHaveBeenCalledTimes(1);
    const opts = firstStartOptions(onStart);
    expect(opts).toEqual({ preset: 'standard', mole: true, narration: 'full' });
    expect('seed' in opts).toBe(false);
  });

  it('types a seed, picks hard difficulty, turns the mole off and brief narration, then confirms', async () => {
    const onStart = vi.fn<(opts: NewGameOptions) => void>();
    const { stdin } = render(<StartScreen onStart={onStart} />);
    await tick();

    // Seed field is focused first: type a seed.
    for (const ch of 'alpha') {
      stdin.write(ch);
    }
    await tick();

    // Down to Difficulty, cycle to hard (standard -> hard).
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.right);
    await tick();

    // Down to the mole, toggle off.
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.right);
    await tick();

    // Down to narration, cycle full -> brief.
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.right);
    await tick();

    stdin.write(KEY.enter);
    await tick();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(firstStartOptions(onStart)).toEqual({
      seed: 'alpha',
      preset: 'hard',
      mole: false,
      narration: 'brief',
    });
  });

  it('backspaces the seed before confirming', async () => {
    const onStart = vi.fn<(opts: NewGameOptions) => void>();
    const { stdin } = render(<StartScreen onStart={onStart} />);
    await tick();
    for (const ch of 'abcd') {
      stdin.write(ch);
    }
    await tick();
    stdin.write(KEY.backspace);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(firstStartOptions(onStart)).toMatchObject({ seed: 'abc' });
  });
});

describe('brief Cable rendering (Req 26.4)', () => {
  it('renders the brief Cable title and body once the game has started', () => {
    const { lastFrame } = render(
      <StartScreen onStart={vi.fn()} brief={briefCable} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Briefing Cable');
    expect(frame).toContain('STATION BRIEF — EYES ONLY');
    expect(frame).toContain('You arrive under commercial cover.');
    expect(frame).toContain('Report to the Chief of Station.');
  });
});

describe('CableReader', () => {
  it('renders a DocumentView title, meta and body', () => {
    const { lastFrame } = render(<CableReader document={briefCable} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('STATION BRIEF — EYES ONLY');
    expect(frame).toContain('cable');
    expect(frame).toContain('Day 0, morning');
    expect(frame).toContain('You arrive under commercial cover.');
    expect(frame).toContain('Report to the Chief of Station.');
  });
});
