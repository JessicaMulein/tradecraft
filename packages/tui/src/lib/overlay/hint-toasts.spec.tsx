/**
 * Component tests for the Ink hint-toast strip (task 22.8; design, "Help and
 * hints"; Requirement 26.6). These render the real component with
 * ink-testing-library and assert that an incoming hint shows a toast, a key
 * press dismisses the oldest, and a toast auto-expires after its timeout.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { HintView } from '@tradecraft/player-view';

import { HintToasts } from './hint-toasts.js';

/** A hint fixture with a given trigger/text. */
const hint = (trigger: string, text: string): HintView =>
  ({ trigger, text } as unknown as HintView);

/** Advance a tick so ink flushes effect- and input-driven re-renders. */
const tick = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 10));
};

/** Wait a fixed span (used to let a short auto-expire timer elapse). */
const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

afterEach(() => {
  cleanup();
});

describe('HintToasts rendering', () => {
  it('renders nothing with no incoming hint', () => {
    const { lastFrame } = render(<HintToasts durationMs={0} />);
    expect(lastFrame() ?? '').toBe('');
  });

  it('shows a toast for an incoming hint', async () => {
    const { lastFrame } = render(
      <HintToasts incoming={hint('first-intercept', 'Try the Workbench.')} durationMs={0} />,
    );
    await tick();
    expect(lastFrame() ?? '').toContain('Try the Workbench.');
  });

  it('stacks a second hint passed on re-render', async () => {
    const { lastFrame, rerender } = render(
      <HintToasts incoming={hint('a', 'First hint')} durationMs={0} />,
    );
    await tick();
    rerender(<HintToasts incoming={hint('b', 'Second hint')} durationMs={0} />);
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('First hint');
    expect(frame).toContain('Second hint');
  });

  it('does not re-enqueue the same hint object on a plain re-render', async () => {
    const stable = hint('a', 'Only once');
    const { lastFrame, rerender } = render(
      <HintToasts incoming={stable} durationMs={0} />,
    );
    await tick();
    rerender(<HintToasts incoming={stable} durationMs={0} />);
    await tick();
    const frame = lastFrame() ?? '';
    // The text appears exactly once (one toast line), not twice.
    const occurrences = frame.split('Only once').length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('HintToasts dismiss', () => {
  it('dismisses the oldest toast on a key press', async () => {
    const { lastFrame, stdin, rerender } = render(
      <HintToasts incoming={hint('a', 'Older hint')} durationMs={0} />,
    );
    await tick();
    rerender(<HintToasts incoming={hint('b', 'Newer hint')} durationMs={0} />);
    await tick();
    stdin.write(' '); // any key dismisses the oldest
    await tick();
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Older hint');
    expect(frame).toContain('Newer hint');
  });
});

describe('HintToasts auto-expire', () => {
  it('removes a toast after its duration elapses', async () => {
    const { lastFrame } = render(
      <HintToasts incoming={hint('a', 'Fleeting hint')} durationMs={30} />,
    );
    await tick();
    expect(lastFrame() ?? '').toContain('Fleeting hint');
    await wait(60);
    expect(lastFrame() ?? '').not.toContain('Fleeting hint');
  });
});
