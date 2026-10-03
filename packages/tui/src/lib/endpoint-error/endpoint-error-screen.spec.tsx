/**
 * Component tests for the Ink endpoint-error screen (task 22.13; design, "TUI":
 * "Endpoint error screen: shown on a `paused` chunk. It names the endpoint and
 * message and offers retry (`retry()`) or save and quit"; Requirements 13.10,
 * 16.1). These render the real component with ink-testing-library and assert
 * that it names the unreachable endpoint, lists the two choices, tracks the
 * cursor and fires `onRetry` / `onSaveAndQuit` on Enter.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { TurnChunk } from '@tradecraft/player-view';

import { EndpointErrorScreen } from './endpoint-error-screen.js';

/** A `paused` chunk's error payload, as the engine would stream it. */
const error: Extract<TurnChunk, { kind: 'paused' }>['error'] = {
  endpoint: 'voice',
  message: 'endpoint unreachable',
};

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

describe('EndpointErrorScreen rendering', () => {
  it('names the unreachable endpoint (Req 13.10, 16.1)', () => {
    const { lastFrame } = render(<EndpointErrorScreen error={error} />);
    expect(lastFrame() ?? '').toContain('voice');
  });

  it('shows the error message', () => {
    const { lastFrame } = render(<EndpointErrorScreen error={error} />);
    expect(lastFrame() ?? '').toContain('endpoint unreachable');
  });

  it('offers Retry and Save and Quit', () => {
    const { lastFrame } = render(<EndpointErrorScreen error={error} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Retry');
    expect(frame).toContain('Save and Quit');
  });
});

describe('EndpointErrorScreen cursor', () => {
  it('highlights Retry first and moves the cursor on arrow keys', async () => {
    const { lastFrame, stdin } = render(<EndpointErrorScreen error={error} />);
    await tick();
    expect(lastFrame() ?? '').toContain('> Retry');

    stdin.write(KEY.down);
    await tick();
    const afterDown = lastFrame() ?? '';
    expect(afterDown).toContain('> Save and Quit');
    expect(afterDown).not.toContain('> Retry');
  });

  it('wraps the cursor from the last choice back to the first', async () => {
    const { lastFrame, stdin } = render(<EndpointErrorScreen error={error} />);
    await tick();
    stdin.write(KEY.up); // Up from the first choice wraps to the last
    await tick();
    expect(lastFrame() ?? '').toContain('> Save and Quit');
  });
});

describe('EndpointErrorScreen choices', () => {
  it('fires onRetry when Retry is confirmed (invokes retry())', async () => {
    const onRetry = vi.fn();
    const onSaveAndQuit = vi.fn();
    const { stdin } = render(
      <EndpointErrorScreen
        error={error}
        onRetry={onRetry}
        onSaveAndQuit={onSaveAndQuit}
      />,
    );
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSaveAndQuit).not.toHaveBeenCalled();
  });

  it('fires onSaveAndQuit when Save and Quit is confirmed', async () => {
    const onRetry = vi.fn();
    const onSaveAndQuit = vi.fn();
    const { stdin } = render(
      <EndpointErrorScreen
        error={error}
        onRetry={onRetry}
        onSaveAndQuit={onSaveAndQuit}
      />,
    );
    await tick();
    stdin.write(KEY.down); // Move to Save and Quit
    await tick();
    stdin.write(KEY.enter);
    await tick();
    expect(onSaveAndQuit).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
