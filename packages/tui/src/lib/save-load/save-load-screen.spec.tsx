/**
 * Component tests for the Ink Save/load screen (task 22.12; design, "TUI" → the
 * Save/load screen: lists `saves.list()`, marks `manifestMatches: false` saves,
 * and loading a mismatched one shows its `manifest-mismatch` pack list and
 * leaves the current game unchanged; Requirements 13.9, 31.6). These render the
 * real component with ink-testing-library and drive it through simulated key
 * presses, asserting the save rows, the mismatch marking and warning, and the
 * load/save/cancel callbacks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { SaveInfo } from '@tradecraft/player-view';

import { SaveLoadScreen } from './save-load-screen.js';
import type { PackDifference } from './save-list.js';

// Terminal escape sequences ink decodes into `useInput` key presses.
const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  enter: '\r',
  esc: '\u001B',
} as const;

/** Advance a tick so ink flushes input-driven re-renders. */
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

/** Build a `SaveInfo` fixture; `manifestMatches` defaults to a matching save. */
function makeSave(overrides: Partial<SaveInfo> = {}): SaveInfo {
  return {
    name: 'alpha',
    seed: 'seed-1',
    difficulty: 'standard',
    at: { day: 1, phase: 0 },
    savedAt: '2024-01-01T00:00:00.000Z',
    manifestMatches: true,
    ...overrides,
  };
}

const SAVES: readonly SaveInfo[] = [
  makeSave({ name: 'alpha', seed: 's1', difficulty: 'standard', at: { day: 2, phase: 1 } }),
  makeSave({ name: 'bravo', seed: 's2', manifestMatches: false }),
  makeSave({ name: 'charlie', seed: 's3', at: { day: 5, phase: 3 } }),
];

afterEach(() => {
  cleanup();
});

describe('SaveLoadScreen listing', () => {
  it('lists each save with name, seed, preset and day/phase (Req 13.9)', () => {
    const { lastFrame } = render(<SaveLoadScreen saves={SAVES} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('alpha');
    expect(frame).toContain('bravo');
    expect(frame).toContain('charlie');
    expect(frame).toContain('seed s1');
    expect(frame).toContain('standard');
    expect(frame).toContain('Day 2, afternoon');
    expect(frame).toContain('Day 5, night');
  });

  it('highlights the first save by default', () => {
    const { lastFrame } = render(<SaveLoadScreen saves={SAVES} />);
    expect(lastFrame() ?? '').toContain('> alpha');
  });

  it('marks a save whose manifest no longer matches (Req 31.6)', () => {
    const { lastFrame } = render(<SaveLoadScreen saves={SAVES} />);
    expect(lastFrame() ?? '').toContain('[manifest mismatch]');
  });

  it('shows a placeholder when there are no saves', () => {
    const { lastFrame } = render(<SaveLoadScreen saves={[]} />);
    expect(lastFrame() ?? '').toContain('No saves found.');
  });
});

describe('SaveLoadScreen navigation and loading', () => {
  it('loads the highlighted matching save on Enter', async () => {
    const onLoad = vi.fn();
    const { stdin } = render(<SaveLoadScreen saves={SAVES} onLoad={onLoad} />);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onLoad).toHaveBeenCalledWith('alpha');
  });

  it('moves down and loads the moved-to save', async () => {
    const onLoad = vi.fn();
    const { stdin, lastFrame } = render(<SaveLoadScreen saves={SAVES} onLoad={onLoad} />);
    await tick();
    stdin.write(KEY.down);
    stdin.write(KEY.down); // skip the mismatched 'bravo' to 'charlie'
    await tick();
    expect(lastFrame() ?? '').toContain('> charlie');
    stdin.write(KEY.enter);
    await tick();
    expect(onLoad).toHaveBeenCalledWith('charlie');
  });

  it('wraps up from the first save to the last', async () => {
    const { stdin, lastFrame } = render(<SaveLoadScreen saves={SAVES} />);
    await tick();
    stdin.write(KEY.up);
    await tick();
    expect(lastFrame() ?? '').toContain('> charlie');
  });
});

describe('SaveLoadScreen manifest-mismatch refusal (Req 31.6)', () => {
  const mismatchedPacks: Record<string, readonly PackDifference[]> = {
    bravo: [
      { id: 'core', saved: '1.0.0', loaded: '1.1.0' },
      { id: 'noir', saved: '0.3.0', loaded: undefined },
    ],
  };

  it('shows the differing-pack list when a mismatched save is selected', async () => {
    const { stdin, lastFrame } = render(
      <SaveLoadScreen saves={SAVES} mismatchedPacks={mismatchedPacks} />,
    );
    await tick();
    stdin.write(KEY.down); // move to 'bravo' (mismatched)
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('> bravo');
    expect(frame).toContain('cannot be loaded');
    expect(frame).toContain('core: save 1.0.0 vs loaded 1.1.0');
    expect(frame).toContain('noir: save 0.3.0 vs loaded —');
  });

  it('refuses to load a mismatched save on Enter — onLoad never fires', async () => {
    const onLoad = vi.fn();
    const { stdin } = render(
      <SaveLoadScreen saves={SAVES} mismatchedPacks={mismatchedPacks} onLoad={onLoad} />,
    );
    await tick();
    stdin.write(KEY.down); // move to 'bravo' (mismatched)
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('shows a generic warning when the pack detail is unavailable', async () => {
    const { stdin, lastFrame } = render(<SaveLoadScreen saves={SAVES} />);
    await tick();
    stdin.write(KEY.down);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('cannot be loaded');
    expect(frame).toContain('not available to show');
  });
});

describe('SaveLoadScreen save and cancel', () => {
  it('writes a new save on "s" when onSave is supplied', async () => {
    const onSave = vi.fn();
    const { stdin } = render(<SaveLoadScreen saves={SAVES} onSave={onSave} />);
    await tick();
    stdin.write('s');
    await tick();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('cancels on Esc', async () => {
    const onCancel = vi.fn();
    const { stdin } = render(<SaveLoadScreen saves={SAVES} onCancel={onCancel} />);
    await tick();
    stdin.write(KEY.esc);
    await tick();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
