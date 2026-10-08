/**
 * Campaign creation screen (task 13.1; Requirement 1).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { CampaignChoice } from '@tradecraft/player-view';

import { CreationScreen, type CampaignBackground } from './creation.js';

const KEY = {
  up: '\u001B[A',
  down: '\u001B[B',
  right: '\u001B[C',
  left: '\u001B[D',
  enter: '\r',
  backspace: '\u007F',
} as const;

const backgrounds: readonly CampaignBackground[] = [
  { id: 'analyst', label: 'Analyst' },
  { id: 'field-officer', label: 'Field officer' },
  { id: 'linguist', label: 'Linguist' },
];

afterEach(() => {
  cleanup();
});

const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

describe('CreationScreen', () => {
  it('shows the seed, difficulty, name, background and start year', () => {
    const { lastFrame } = render(
      <CreationScreen backgrounds={backgrounds} onCreate={vi.fn()} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Seed:');
    expect(frame).toContain('(generated on start)');
    expect(frame).toContain('Difficulty: standard');
    expect(frame).toContain('Officer:');
    expect(frame).toContain('Background: Analyst');
    expect(frame).toContain('Start year: 1948');
  });

  it('refuses to start until the officer is named', async () => {
    const onCreate = vi.fn();
    const { stdin, lastFrame } = render(
      <CreationScreen backgrounds={backgrounds} onCreate={onCreate} />,
    );
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onCreate).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('Enter an officer name.');
  });

  it('builds a create choice from the fields and omits a blank seed', async () => {
    const onCreate = vi.fn<(choice: Extract<CampaignChoice, { kind: 'create' }>) => void>();
    const { stdin } = render(<CreationScreen backgrounds={backgrounds} onCreate={onCreate} />);
    await tick();
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.right);
    await tick();
    stdin.write(KEY.down);
    await tick();
    for (const char of 'Ada') {
      stdin.write(char);
    }
    await tick();
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.right);
    await tick();
    stdin.write(KEY.down);
    await tick();
    stdin.write(KEY.right);
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0]?.[0]).toEqual({
      kind: 'create',
      preset: 'hard',
      officerName: 'Ada',
      background: 'field-officer',
      startYear: 1949,
    });
  });
});
