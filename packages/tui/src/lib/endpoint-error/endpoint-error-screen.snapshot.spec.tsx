/**
 * Inline-snapshot tests for the Ink endpoint-error screen (task 22.15; design,
 * "TUI": the endpoint-error screen names the endpoint and message and offers
 * retry or save and quit; Requirement 13.10). These render the real component
 * with ink-testing-library 4.0.0 and capture `lastFrame()` as an inline snapshot
 * of the error naming the endpoint with the Retry / Save-and-Quit menu.
 *
 * The error payload is a fixed literal, so the frame is deterministic.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { TurnChunk } from '@tradecraft/player-view';

import { EndpointErrorScreen } from './endpoint-error-screen.js';

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

/** A `paused` chunk's error payload, as the engine would stream it. */
const error: Extract<TurnChunk, { kind: 'paused' }>['error'] = {
  endpoint: 'voice',
  message: 'endpoint unreachable',
};

afterEach(() => {
  cleanup();
});

describe('EndpointErrorScreen snapshots', () => {
  it('renders the error naming the endpoint with the Retry / Save-and-Quit menu', () => {
    const { lastFrame } = render(<EndpointErrorScreen error={error} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Endpoint unreachable
      The endpoint "voice" could not be reached.
      endpoint unreachable

      The turn is paused. Choose how to continue:
      > Retry
        Save and Quit

      ↑/↓ choose · Enter to confirm"
    `);
  });
});
