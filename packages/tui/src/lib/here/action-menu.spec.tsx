/**
 * Component tests for the Ink action menu (task 22.3; design, "TUI": the Here
 * pane's "allowed actions with quotes"; Requirements 13.1, 21.5). These render
 * the real component with ink-testing-library and assert that the menu lists the
 * actions with their quotes — allowed options show their phase/money cost,
 * disallowed options show their reason (Req 21.5) — and that the cursor tracks
 * the highlighted index and fires `onChoose` on Enter.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { ActionOption } from '@tradecraft/player-view';

import { ActionMenu } from './action-menu.js';

/** A spread of actions (Req 13.1) with mixed quotes, allowed and not. */
const options: readonly ActionOption[] = [
  {
    action: { kind: 'talk', npc: 'npc:ana' },
    quote: { allowed: true, phases: 1, money: 0 },
  },
  {
    action: { kind: 'surveil', at: 'loc:cafe', phases: 2 },
    quote: { allowed: true, phases: 2, money: 20 },
  },
  {
    action: { kind: 'arrest', npc: 'npc:ana' },
    quote: {
      allowed: false,
      reason: 'needs Station authorisation',
      phases: 0,
      money: 0,
    },
  },
];

/** Terminal escape sequences ink decodes into `useInput` key presses. */
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

describe('ActionMenu listing', () => {
  it('lists each action kind (Req 13.1)', () => {
    const { lastFrame } = render(<ActionMenu options={options} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('talk');
    expect(frame).toContain('surveil');
    expect(frame).toContain('arrest');
  });

  it('shows the phase and money cost of allowed actions', () => {
    const { lastFrame } = render(<ActionMenu options={options} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1 phase');
    expect(frame).toContain('2 phases, 20');
  });

  it('shows the reason for a disallowed action (Req 21.5)', () => {
    const { lastFrame } = render(<ActionMenu options={options} />);
    expect(lastFrame() ?? '').toContain('needs Station authorisation');
  });

  it('folds repeated refusals into one line per kind', () => {
    const blocked = {
      action: { kind: 'cable' as const, body: { kind: 'report' as const } },
      quote: { allowed: false, reason: 'you can only send a Cable from the Station', phases: 0, money: 0 },
    };
    const { lastFrame } = render(<ActionMenu options={[blocked, blocked, blocked]} />);
    const frame = lastFrame() ?? '';
    expect(frame.match(/you can only send a Cable from the Station/g)?.length).toBe(1);
  });

  it('shows a hint when there are no actions available', () => {
    const { lastFrame } = render(<ActionMenu options={[]} />);
    expect(lastFrame() ?? '').toContain('No actions available here.');
  });
});

describe('ActionMenu cursor', () => {
  it('highlights the first option and moves the cursor on arrow keys', async () => {
    const { lastFrame, stdin } = render(<ActionMenu options={options} />);
    await tick();
    // The cursor marker starts on the first row.
    expect(lastFrame() ?? '').toContain('> talk');

    stdin.write(KEY.down);
    await tick();
    const afterDown = lastFrame() ?? '';
    expect(afterDown).toContain('> surveil');
    expect(afterDown).not.toContain('> talk');
  });

  it('wraps the cursor from the last option back to the first', async () => {
    const { lastFrame, stdin } = render(<ActionMenu options={options} />);
    await tick();
    stdin.write(KEY.up); // Up from the first option wraps to the last
    await tick();
    expect(lastFrame() ?? '').toContain('> arrest');
  });

  it('fires onChoose with the highlighted option on Enter', async () => {
    const onChoose = vi.fn();
    const { stdin } = render(<ActionMenu options={options} onChoose={onChoose} />);
    await tick();
    stdin.write(KEY.down); // Down to surveil
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]?.[0]?.action.kind).toBe('surveil');
  });
});
