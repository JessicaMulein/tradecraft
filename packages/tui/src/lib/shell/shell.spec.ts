/**
 * Unit tests for the pure App Shell reducer (slice-integration task 13.1;
 * design, "TUI: App Shell"; Requirements 19.3, 19.4, 19.5, 19.6, 19.7, 19.9,
 * 19.10, 19.11). These exercise the routing, the per-chunk handling and the
 * streaming input lock as pure functions — no TTY, no stream — one example per
 * chunk kind and per key in the key map.
 */

import { describe, expect, it } from 'vitest';
import type { Notification, TurnChunk } from '@tradecraft/player-view';

import { KEY_MAP } from './key-map.js';
import {
  initialShellState,
  reduceShell,
  type ShellState,
} from './shell.js';

/** A minimal view-safe Notification for a `notification` chunk. */
function notification(id: string): Notification {
  return {
    id: `notification:${id}`,
    kind: 'cable',
    at: { day: 1, phase: 0 },
    dismissed: false,
    factLine: 'A Cable has arrived from the Station.',
  } as unknown as Notification;
}

/** A streaming state, mid-turn, on the scene screen. */
const streaming: ShellState = {
  ...initialShellState,
  screen: { kind: 'scene' },
  streaming: true,
};

describe('reduceShell key routing', () => {
  it('routes each navigation key to its screen', () => {
    const base: ShellState = { ...initialShellState, screen: { kind: 'scene' } };
    expect(reduceShell(base, { type: 'key', key: 'c' }).screen).toEqual({ kind: 'case-file' });
    expect(reduceShell(base, { type: 'key', key: 'd' }).screen).toEqual({ kind: 'documents' });
    expect(reduceShell(base, { type: 'key', key: 'w' }).screen).toEqual({ kind: 'workbench' });
    expect(reduceShell(base, { type: 'key', key: 'j' }).screen).toEqual({ kind: 'journal' });
    expect(reduceShell(base, { type: 'key', key: 'm' }).screen).toEqual({ kind: 'map' });
    expect(reduceShell(base, { type: 'key', key: 'y' }).screen).toEqual({ kind: 'city' });
    expect(reduceShell(base, { type: 'key', key: 'r' }).screen).toEqual({ kind: 'stories' });
    expect(reduceShell(base, { type: 'key', key: 'k' }).screen).toEqual({ kind: 'duties' });
    expect(reduceShell(base, { type: 'key', key: 'p' }).screen).toEqual({ kind: 'people' });
  });

  it('opens the save and load screens with the right mode', () => {
    const base: ShellState = { ...initialShellState, screen: { kind: 'scene' } };
    expect(reduceShell(base, { type: 'key', key: 's' }).screen).toEqual({
      kind: 'save-load',
      mode: 'save',
    });
    expect(reduceShell(base, { type: 'key', key: 'l' }).screen).toEqual({
      kind: 'save-load',
      mode: 'load',
    });
  });

  it('toggles the help overlay with `?`', () => {
    const opened = reduceShell(initialShellState, { type: 'key', key: '?' });
    expect(opened.overlay).toBe('help');
    const closed = reduceShell(opened, { type: 'key', key: '?' });
    expect(closed.overlay).toBeUndefined();
  });

  it('leaves the state unchanged on `q` (the component confirms quit)', () => {
    const base: ShellState = { ...initialShellState, screen: { kind: 'scene' } };
    expect(reduceShell(base, { type: 'key', key: 'q' })).toBe(base);
  });

  it('is a no-op for the feed key with no selected Asset', () => {
    const base: ShellState = { ...initialShellState, screen: { kind: 'scene' } };
    expect(reduceShell(base, { type: 'key', key: 'f' })).toBe(base);
  });

  it('is a no-op for an unbound key', () => {
    const base: ShellState = { ...initialShellState, screen: { kind: 'scene' } };
    expect(reduceShell(base, { type: 'key', key: 'z' })).toBe(base);
  });

  it('clears the help overlay when a navigation key opens a screen', () => {
    const withHelp: ShellState = { ...initialShellState, screen: { kind: 'scene' }, overlay: 'help' };
    expect(reduceShell(withHelp, { type: 'key', key: 'c' }).overlay).toBeUndefined();
  });

  it('binds every key in the KEY_MAP to a handled action', () => {
    const base: ShellState = { ...initialShellState, screen: { kind: 'scene' } };
    for (const binding of KEY_MAP) {
      // Every bound key either changes the state or is a documented no-op
      // (quit/feed); none throws, and the reducer stays total over the map.
      expect(() => reduceShell(base, { type: 'key', key: binding.key })).not.toThrow();
    }
  });
});

describe('reduceShell navigation', () => {
  it('sets the screen directly and clears the overlay', () => {
    const withHelp: ShellState = { ...initialShellState, overlay: 'help' };
    const next = reduceShell(withHelp, { type: 'navigate', screen: { kind: 'scene' } });
    expect(next.screen).toEqual({ kind: 'scene' });
    expect(next.overlay).toBeUndefined();
  });
});

describe('reduceShell turn-start and the streaming lock (Req 19.11)', () => {
  it('marks streaming and resets the transcript on turn-start', () => {
    const dirty: ShellState = {
      ...initialShellState,
      screen: { kind: 'scene' },
      transcript: { ...initialShellState.transcript, done: true },
    };
    const next = reduceShell(dirty, { type: 'turn-start' });
    expect(next.streaming).toBe(true);
    expect(next.transcript.lines).toEqual([]);
    expect(next.transcript.done).toBe(false);
  });

  it('ignores a second turn-start while already streaming', () => {
    expect(reduceShell(streaming, { type: 'turn-start' })).toBe(streaming);
  });

  it('refuses the load key while a turn streams (it starts a new turn)', () => {
    expect(reduceShell(streaming, { type: 'key', key: 'l' })).toBe(streaming);
  });

  it('still routes non-turn-starting keys while a turn streams', () => {
    expect(reduceShell(streaming, { type: 'key', key: 'c' }).screen).toEqual({ kind: 'case-file' });
    expect(reduceShell(streaming, { type: 'key', key: '?' }).overlay).toBe('help');
    expect(reduceShell(streaming, { type: 'key', key: 's' }).screen).toEqual({
      kind: 'save-load',
      mode: 'save',
    });
  });
});

describe('reduceShell chunk handling', () => {
  it('feeds fact, flavour and speech to the transcript (Req 19.4)', () => {
    let state = reduceShell(streaming, { type: 'chunk', chunk: { kind: 'fact', text: 'You enter.' } });
    state = reduceShell(state, { type: 'chunk', chunk: { kind: 'flavour', text: 'Rain falls.' } });
    state = reduceShell(state, {
      type: 'chunk',
      chunk: { kind: 'speech', speaker: 'the waiter', text: 'The usual?' },
    });
    expect(state.transcript.lines).toEqual([
      { kind: 'fact', text: 'You enter.' },
      { kind: 'flavour', text: 'Rain falls.' },
      { kind: 'speech', speaker: 'the waiter', text: 'The usual?' },
    ]);
    expect(state.streaming).toBe(true);
  });

  it('drops this attempt\'s flavour and speech on interrupted (Req 19.5)', () => {
    let state = reduceShell(streaming, { type: 'chunk', chunk: { kind: 'fact', text: 'Committed.' } });
    state = reduceShell(state, { type: 'chunk', chunk: { kind: 'flavour', text: 'half-written' } });
    state = reduceShell(state, { type: 'chunk', chunk: { kind: 'interrupted' } });
    expect(state.transcript.interrupted).toBe(true);
    expect(state.transcript.lines).toEqual([{ kind: 'fact', text: 'Committed.' }]);
  });

  it('routes a paused chunk to the endpoint-error screen and unlocks input (Req 19.6, 19.11)', () => {
    const err = { endpoint: 'narrator', message: 'connection refused' };
    const next = reduceShell(streaming, { type: 'chunk', chunk: { kind: 'paused', error: err } });
    expect(next.screen).toEqual({ kind: 'endpoint-error', error: err });
    expect(next.streaming).toBe(false);
  });

  it('routes an ended chunk to the game-over screen and ends the stream (Req 19.7, 19.11)', () => {
    const chunk = { kind: 'ended', outcome: 'success' } as Extract<TurnChunk, { kind: 'ended' }>;
    const next = reduceShell(streaming, { type: 'chunk', chunk });
    expect(next.screen).toEqual({ kind: 'game-over', outcome: 'success' });
    expect(next.streaming).toBe(false);
  });

  it('adds a notification to the status-bar alerts (Req 19.9)', () => {
    const n = notification('1');
    const next = reduceShell(streaming, { type: 'chunk', chunk: { kind: 'notification', n } });
    expect(next.alerts).toEqual([n]);
    // A notification does not stop the stream.
    expect(next.streaming).toBe(true);
  });

  it('pushes a hint toast with a monotonic id (Req 19.10)', () => {
    let state = reduceShell(streaming, { type: 'chunk', chunk: { kind: 'hint', text: 'A first lead.' } });
    state = reduceShell(state, { type: 'chunk', chunk: { kind: 'hint', text: 'An Intercept.' } });
    expect(state.toasts).toEqual([
      { id: 0, text: 'A first lead.' },
      { id: 1, text: 'An Intercept.' },
    ]);
  });

  it('unlocks input on a done chunk (Req 19.11)', () => {
    const next = reduceShell(streaming, { type: 'chunk', chunk: { kind: 'done' } });
    expect(next.streaming).toBe(false);
    expect(next.transcript.done).toBe(true);
  });
});

describe('reduceShell purity', () => {
  it('never mutates its input state', () => {
    const before: ShellState = { ...initialShellState, screen: { kind: 'scene' } };
    const after = reduceShell(before, { type: 'chunk', chunk: { kind: 'fact', text: 'A line.' } });
    expect(before.transcript.lines).toEqual([]);
    expect(after).not.toBe(before);
  });
});
