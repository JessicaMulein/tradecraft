/**
 * Inline-snapshot tests for the Ink Save/load screen (task 22.15; design, the
 * Save/load screen; Requirements 13.9). These render the real component with
 * ink-testing-library 4.0.0 and capture `lastFrame()` as inline snapshots for
 * the listing (a matching save highlighted and a manifest-mismatched save
 * marked) and for the manifest-mismatch warning shown when the mismatched save
 * is selected and its differing-pack list is supplied.
 *
 * Every `SaveInfo` carries a fixed seed, preset, day/phase and `savedAt`, so the
 * frames are deterministic (no clock or randomness is read).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { SaveInfo } from '@tradecraft/player-view';

import { SaveLoadScreen } from './save-load-screen.js';
import type { PackDifference } from './save-list.js';

/** Terminal escape sequences ink decodes into `useInput` key presses. */
const KEY = {
  down: '\u001B[B',
} as const;

/** Advance a tick so ink flushes input-driven re-renders. */
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
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

const mismatchedPacks: Readonly<Record<string, readonly PackDifference[]>> = {
  bravo: [
    { id: 'core', saved: '1.0.0', loaded: '1.1.0' },
    { id: 'noir', saved: '0.3.0', loaded: undefined },
  ],
};

afterEach(() => {
  cleanup();
});

describe('SaveLoadScreen snapshots', () => {
  it('renders the listing with a matching save highlighted and a mismatch marked', () => {
    const { lastFrame } = render(<SaveLoadScreen saves={SAVES} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Saves

      > alpha  seed s1 · standard · Day 2, afternoon
        bravo  seed s2 · standard · Day 1, morning  [manifest mismatch]
        charlie  seed s3 · standard · Day 5, night

      ↑/↓ move · Enter load · Esc cancel"
    `);
  });

  it('renders the manifest-mismatch warning for a selected mismatched save', async () => {
    const { lastFrame, stdin } = render(
      <SaveLoadScreen saves={SAVES} mismatchedPacks={mismatchedPacks} />,
    );
    await tick();
    stdin.write(KEY.down); // move to the mismatched 'bravo'
    await tick();
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Saves

        alpha  seed s1 · standard · Day 2, afternoon
      > bravo  seed s2 · standard · Day 1, morning  [manifest mismatch]
        charlie  seed s3 · standard · Day 5, night

      This save was taken under different Content Packs. It cannot be loaded; the current game is 
      unchanged.
        core: save 1.0.0 vs loaded 1.1.0
        noir: save 0.3.0 vs loaded —

      ↑/↓ move · Enter load · Esc cancel"
    `);
  });
});
