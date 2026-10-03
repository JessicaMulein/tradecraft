/**
 * Component tests for the Ink help overlay (task 22.8; design, "Help and hints";
 * Requirement 26.5). These render the real component with ink-testing-library
 * and assert that the overlay lists the current Location's actions with their
 * costs and the glossary, renders nothing while hidden, and toggles closed on
 * `?` or Escape.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { HelpView } from '@tradecraft/player-view';

import { HelpOverlay } from './help-overlay.js';

/** A help projection with mixed allowed/disallowed actions and a glossary. */
const help: HelpView = {
  location: { id: 'loc:cafe' as HelpView['location']['id'], name: 'Café Mozart' },
  actions: [
    { kind: 'talk', quote: { allowed: true, phases: 1, money: 0 }, targeted: true },
    {
      kind: 'surveil',
      quote: { allowed: true, phases: 2, money: 20 },
      targeted: false,
    },
    {
      kind: 'arrest',
      quote: {
        allowed: false,
        reason: 'needs Station authorisation',
        phases: 0,
        money: 0,
      },
      targeted: true,
    },
  ],
  glossary: [
    { term: 'Dead drop', definition: 'A location used to pass items in secret.' },
    { term: 'Legend', definition: 'A spy’s fabricated cover identity.' },
  ],
};

/** Terminal escape sequences ink decodes into `useInput` key presses. */
const KEY = { escape: '\u001B' } as const;

/** Advance a tick so ink flushes input-driven re-renders. */
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

afterEach(() => {
  cleanup();
});

describe('HelpOverlay visibility', () => {
  it('renders nothing while hidden', () => {
    const { lastFrame } = render(<HelpOverlay help={help} visible={false} />);
    expect(lastFrame() ?? '').toBe('');
  });

  it('shows the Location name in the header when visible', () => {
    const { lastFrame } = render(<HelpOverlay help={help} visible />);
    expect(lastFrame() ?? '').toContain('Café Mozart');
  });
});

describe('HelpOverlay content (Req 26.5)', () => {
  it('lists each action kind', () => {
    const { lastFrame } = render(<HelpOverlay help={help} visible />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('talk');
    expect(frame).toContain('surveil');
    expect(frame).toContain('arrest');
  });

  it('shows the phase and money cost of allowed actions', () => {
    const { lastFrame } = render(<HelpOverlay help={help} visible />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('1 phase');
    expect(frame).toContain('2 phases, 20');
  });

  it('shows the reason for a disallowed action', () => {
    const { lastFrame } = render(<HelpOverlay help={help} visible />);
    expect(lastFrame() ?? '').toContain('needs Station authorisation');
  });

  it('flags targeted actions', () => {
    const { lastFrame } = render(<HelpOverlay help={help} visible />);
    expect(lastFrame() ?? '').toContain('pick target');
  });

  it('lists the glossary drawn from content', () => {
    const { lastFrame } = render(<HelpOverlay help={help} visible />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Dead drop');
    expect(frame).toContain('Legend');
  });

  it('shows a hint when there are no actions here', () => {
    const empty: HelpView = { ...help, actions: [] };
    const { lastFrame } = render(<HelpOverlay help={empty} visible />);
    expect(lastFrame() ?? '').toContain('No actions available here.');
  });
});

describe('HelpOverlay toggling', () => {
  it('requests a toggle on "?" while visible', async () => {
    const onToggle = vi.fn();
    const { stdin } = render(
      <HelpOverlay help={help} visible onToggle={onToggle} />,
    );
    await tick();
    stdin.write('?');
    await tick();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('requests a toggle on Escape while visible', async () => {
    const onToggle = vi.fn();
    const { stdin } = render(
      <HelpOverlay help={help} visible onToggle={onToggle} />,
    );
    await tick();
    stdin.write(KEY.escape);
    await tick();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not listen for keys while hidden', async () => {
    const onToggle = vi.fn();
    const { stdin } = render(
      <HelpOverlay help={help} visible={false} onToggle={onToggle} />,
    );
    await tick();
    stdin.write('?');
    await tick();
    expect(onToggle).not.toHaveBeenCalled();
  });
});
