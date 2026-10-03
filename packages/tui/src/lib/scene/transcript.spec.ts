/**
 * Unit tests for the pure Scene transcript reducer (task 22.2; design, "Scene";
 * Requirements 13.2, 13.4, 13.6). These exercise the accumulation logic as a
 * pure function — no TTY, no stream — feeding chunks and reading back the lines
 * and control state the Scene pane renders.
 */

import { describe, expect, it } from 'vitest';
import type { TurnChunk } from '@tradecraft/player-view';

import {
  collectTranscript,
  emptyTranscript,
  reduceTranscript,
  type TranscriptState,
} from './transcript.js';

describe('reduceTranscript line accumulation', () => {
  it('appends fact, flavour and speech lines in arrival order', () => {
    const chunks: TurnChunk[] = [
      { kind: 'fact', text: 'You enter the café.' },
      { kind: 'flavour', text: 'Steam clouds the windows.' },
      { kind: 'speech', speaker: 'the waiter', text: 'The usual?' },
      { kind: 'fact', text: 'You order coffee.' },
    ];
    const state = collectTranscript(chunks);
    expect(state.lines).toEqual([
      { kind: 'fact', text: 'You enter the café.' },
      { kind: 'flavour', text: 'Steam clouds the windows.' },
      { kind: 'speech', speaker: 'the waiter', text: 'The usual?' },
      { kind: 'fact', text: 'You order coffee.' },
    ]);
  });

  it('does not mutate the input state', () => {
    const before = emptyTranscript;
    const after = reduceTranscript(before, { kind: 'fact', text: 'A line.' });
    expect(before.lines).toEqual([]);
    expect(after.lines).toHaveLength(1);
    expect(after).not.toBe(before);
  });

  it('ignores notifications in the Scene transcript (status bar owns alerts)', () => {
    const n = {
      id: 'ntf:1',
      kind: 'missed-meeting',
    } as unknown as Extract<TurnChunk, { kind: 'notification' }>['n'];
    const state = collectTranscript([
      { kind: 'fact', text: 'A committed fact.' },
      { kind: 'notification', n },
    ]);
    expect(state.lines).toEqual([{ kind: 'fact', text: 'A committed fact.' }]);
  });
});

describe('reduceTranscript control state', () => {
  it('flags done on a done chunk', () => {
    const state = collectTranscript([
      { kind: 'fact', text: 'Resolved.' },
      { kind: 'done' },
    ]);
    expect(state.done).toBe(true);
    expect(state.outcome).toBeNull();
  });

  it('records the outcome and marks done on an ended chunk', () => {
    const state = collectTranscript([
      { kind: 'fact', text: 'The game is over.' },
      { kind: 'ended', outcome: 'success' },
    ]);
    expect(state.done).toBe(true);
    expect(state.outcome).toBe('success');
  });

  it('records the pause endpoint and message on a paused chunk', () => {
    const state = collectTranscript([
      { kind: 'fact', text: 'Partial result.' },
      {
        kind: 'paused',
        error: { endpoint: 'narrator', message: 'connection refused' },
      },
    ]);
    expect(state.pause).toEqual({
      endpoint: 'narrator',
      message: 'connection refused',
    });
    // A pause does not end the turn and leaves committed facts in place.
    expect(state.done).toBe(false);
    expect(state.lines).toHaveLength(1);
  });
});

describe('reduceTranscript interruption', () => {
  it('drops this turn\'s flavour and speech but keeps committed facts', () => {
    const state = collectTranscript([
      { kind: 'fact', text: 'A committed fact survives.' },
      { kind: 'flavour', text: 'A half-written sentence.' },
      { kind: 'speech', speaker: 'the waiter', text: 'A discarded line.' },
      { kind: 'interrupted' },
    ]);
    expect(state.interrupted).toBe(true);
    expect(state.lines).toEqual([
      { kind: 'fact', text: 'A committed fact survives.' },
    ]);
  });

  it('keeps accumulating normally after an interruption', () => {
    const afterInterrupt = collectTranscript([
      { kind: 'flavour', text: 'discarded' },
      { kind: 'interrupted' },
    ]);
    const resumed: TranscriptState = reduceTranscript(afterInterrupt, {
      kind: 'flavour',
      text: 'the regenerated sentence',
    });
    expect(resumed.lines).toEqual([
      { kind: 'flavour', text: 'the regenerated sentence' },
    ]);
    expect(resumed.interrupted).toBe(true);
  });
});
