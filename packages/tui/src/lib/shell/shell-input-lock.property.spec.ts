/**
 * Feature: slice-integration, Property 58: Shell input lock.
 *
 * **Validates: Requirements 19.11**
 *
 * The design states (slice-integration design, "Property 58: Shell input lock"):
 * for any App Shell state with a turn streaming and any key sequence,
 * `reduceShell` emits no turn-starting effect (`act`, `say`, `endScene`, `retry`,
 * `newGame`, `load`) until the stream's `done`, `paused` or `ended` chunk has
 * been reduced.
 *
 * ## How the reducer surfaces those effects
 *
 * The pure {@link reduceShell} (`./shell.ts`) is the only place the lock is
 * enforced, so this test drives it directly — no TTY, no stream. The six
 * turn-starting effects reach the reducer by two routes, and the test covers
 * both:
 *
 * - `load` is the one turn-starting *global key* (it starts a fresh session). It
 *   is bound in {@link KEY_MAP} and flagged by the reducer's
 *   `TURN_STARTING_KEY_ACTIONS`. While a turn streams, pressing it must leave the
 *   state unchanged; off the lock it must open the load screen.
 * - `act`, `say`, `endScene`, `retry` and `newGame` are scene-local starters the
 *   component funnels through a single `{ type: 'turn-start' }` event. While a
 *   turn streams, that event must be dropped; off the lock it must begin a turn.
 *
 * Every other key in the map (navigation, help, save) is *not* a turn starter and
 * must stay live mid-stream — the player can still look around — so the test
 * asserts those keep working under the lock.
 *
 * ## The property
 *
 * An arbitrary draws a sequence of shell events — turn-starting keys, the
 * `turn-start` event, non-turn-starting keys, unbound keys, navigation and the
 * turn chunks that start and end a stream — and folds them with `reduceShell`
 * from the initial state. The invariant is checked after every step: while the
 * running state has `streaming === true`, no turn-starting key and no
 * `turn-start` event changes the state (it starts no turn and opens no load
 * screen), while a non-turn-starting key applied to the same locked state still
 * takes effect. Starting from `initialShellState` with the real chunk stream is
 * what makes "while a turn streams" reachable the way the live shell reaches it:
 * a `turn-start` locks, and only a `done`/`paused`/`ended` chunk unlocks.
 *
 * The fast-check shape mirrors the engine `*.property.spec.ts` files (e.g.
 * `clock/disruption-agreement.property.spec.ts`); the reducer-driving style
 * mirrors `shell.spec.ts`.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { TurnChunk } from '@tradecraft/player-view';

import { KEY_MAP, type ShellKeyAction } from './key-map.js';
import {
  initialShellState,
  reduceShell,
  type ShellEvent,
  type ShellState,
} from './shell.js';

const RUNS = 300;

// ---------------------------------------------------------------------------
// The turn-starting surface, read straight from the design and the reducer
// ---------------------------------------------------------------------------

/**
 * The one turn-starting *global key* action (Property 58 names `load` as the
 * only turn starter a key triggers directly; the reducer's
 * `TURN_STARTING_KEY_ACTIONS` holds exactly this). Kept here as the test's own
 * independent statement of the rule so a drift between the reducer and the design
 * is caught rather than copied.
 */
const TURN_STARTING_ACTIONS: ReadonlySet<ShellKeyAction> = new Set<ShellKeyAction>(['load']);

/** The key bound to each turn-starting action in the map (here: `l` → load). */
const TURN_STARTING_KEYS: readonly string[] = KEY_MAP.filter((b) =>
  TURN_STARTING_ACTIONS.has(b.action),
).map((b) => b.key);

/**
 * The non-turn-starting keys that must stay live mid-stream: every bound key
 * that is not a turn starter and is not a documented no-op. `q` (quit, confirmed
 * by the component) and `f` (feed, needs a selection the shell has none of) are
 * no-ops in the reducer, so they neither start a turn nor change the state —
 * excluding them lets the "still works" check assert a real state change.
 */
const LIVE_NAVIGATION_KEYS: readonly string[] = KEY_MAP.filter(
  (b) => !TURN_STARTING_ACTIONS.has(b.action) && b.action !== 'quit' && b.action !== 'open-feed',
).map((b) => b.key);

if (TURN_STARTING_KEYS.length === 0) {
  throw new Error('no turn-starting key in the KEY_MAP — Property 58 cannot be exercised');
}
if (LIVE_NAVIGATION_KEYS.length === 0) {
  throw new Error('no live navigation key in the KEY_MAP to check stays unlocked');
}

/** A key not bound anywhere in the map, to exercise the no-op path. */
const UNBOUND_KEY = 'z';

// ---------------------------------------------------------------------------
// Arbitraries for an interleaved event sequence
// ---------------------------------------------------------------------------

/** A turn-starting key press (`l`). */
const turnStartingKeyArb: fc.Arbitrary<ShellEvent> = fc
  .constantFrom(...TURN_STARTING_KEYS)
  .map((key) => ({ type: 'key', key }) as const);

/** A non-turn-starting navigation/help/save key press. */
const liveKeyArb: fc.Arbitrary<ShellEvent> = fc
  .constantFrom(...LIVE_NAVIGATION_KEYS)
  .map((key) => ({ type: 'key', key }) as const);

/** An unbound key press (a no-op). */
const unboundKeyArb: fc.Arbitrary<ShellEvent> = fc.constant({
  type: 'key',
  key: UNBOUND_KEY,
} as const);

/** The scene-local turn starters all arrive as this one event. */
const turnStartArb: fc.Arbitrary<ShellEvent> = fc.constant({ type: 'turn-start' } as const);

/** A direct navigation (not gated by the lock), to the scene or a view screen. */
const navigateArb: fc.Arbitrary<ShellEvent> = fc
  .constantFrom<ShellState['screen']>(
    { kind: 'scene' },
    { kind: 'case-file' },
    { kind: 'journal' },
  )
  .map((screen) => ({ type: 'navigate', screen }) as const);

/**
 * The non-terminal, non-starting chunks a stream carries mid-turn (they neither
 * start nor end a turn): renderable lines, a notification and a hint.
 */
const midStreamChunk: fc.Arbitrary<TurnChunk> = fc.oneof(
  fc.record({ kind: fc.constant('fact' as const), text: fc.string() }),
  fc.record({ kind: fc.constant('flavour' as const), text: fc.string() }),
  fc.record({
    kind: fc.constant('speech' as const),
    speaker: fc.string(),
    text: fc.string(),
  }),
  fc.constant({ kind: 'hint' as const, text: 'A lead.' }),
);

/** A mid-stream chunk event. */
const midStreamChunkArb: fc.Arbitrary<ShellEvent> = midStreamChunk.map(
  (chunk) => ({ type: 'chunk', chunk }) as const,
);

/**
 * A terminal chunk that releases the lock: `done`, `paused` or `ended`. These are
 * the three the design names as the only things that end a stream.
 */
const terminalChunk: fc.Arbitrary<TurnChunk> = fc.oneof(
  fc.constant({ kind: 'done' as const }),
  fc.constant({
    kind: 'paused' as const,
    error: { endpoint: 'narrator', message: 'connection refused' },
  } as TurnChunk),
  fc.constant({ kind: 'ended' as const, outcome: 'success' } as TurnChunk),
);

/** A terminal chunk event. */
const terminalChunkArb: fc.Arbitrary<ShellEvent> = terminalChunk.map(
  (chunk) => ({ type: 'chunk', chunk }) as const,
);

/** Any single event, weighted so streams start, run and end across a sequence. */
const eventArb: fc.Arbitrary<ShellEvent> = fc.oneof(
  { weight: 3, arbitrary: turnStartArb },
  { weight: 3, arbitrary: turnStartingKeyArb },
  { weight: 2, arbitrary: liveKeyArb },
  { weight: 1, arbitrary: unboundKeyArb },
  { weight: 1, arbitrary: navigateArb },
  { weight: 3, arbitrary: midStreamChunkArb },
  { weight: 2, arbitrary: terminalChunkArb },
);

const eventSequenceArb: fc.Arbitrary<readonly ShellEvent[]> = fc.array(eventArb, {
  minLength: 1,
  maxLength: 40,
});

// ---------------------------------------------------------------------------
// Oracle: has this event, applied to this state, started a turn?
// ---------------------------------------------------------------------------

/**
 * Whether `next` shows a turn-starting effect relative to `prev`: either the
 * stream has (re)started (`streaming` went true, i.e. a `turn-start` took) or the
 * load screen is on display (the one turn-starting key opens it). Both are the
 * observable "a turn started" signals the reducer can produce. The load check is
 * on `next` alone — pressing `load` when the load screen is already open is still
 * the turn-starting effect, even though the screen does not visibly change.
 */
function startedATurn(prev: ShellState, next: ShellState): boolean {
  const streamStarted = !prev.streaming && next.streaming;
  const loadShown = next.screen.kind === 'save-load' && next.screen.mode === 'load';
  return streamStarted || loadShown;
}

/** Whether an event is a turn starter (a `turn-start` or a turn-starting key). */
function isTurnStartingEvent(event: ShellEvent): boolean {
  if (event.type === 'turn-start') return true;
  if (event.type === 'key') return TURN_STARTING_KEYS.includes(event.key);
  return false;
}

// ---------------------------------------------------------------------------
// The property
// ---------------------------------------------------------------------------

describe('Property 58: Shell input lock (Req 19.11)', () => {
  it('refuses every turn-starting effect while a turn streams, until a terminal chunk', () => {
    fc.assert(
      fc.property(eventSequenceArb, (events) => {
        let state = initialShellState;
        for (const event of events) {
          const locked = state.streaming;
          const next = reduceShell(state, event);

          if (locked && isTurnStartingEvent(event)) {
            // While streaming, a turn starter is refused outright: the state is
            // returned unchanged, so it starts no turn and opens no load screen.
            expect(next).toBe(state);
          }

          if (!locked && isTurnStartingEvent(event)) {
            // Off the lock, the same event does start a turn (open stream / load
            // screen) — proving the lock, not a broken event, suppressed it above.
            expect(startedATurn(state, next)).toBe(true);
          }

          state = next;
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('keeps non-turn-starting keys live while a turn streams', () => {
    fc.assert(
      fc.property(eventSequenceArb, liveKeyArb, (events, liveKey) => {
        let state = initialShellState;
        for (const event of events) {
          if (state.streaming) {
            // A navigation/help/save key applied to the locked state still takes
            // effect: it changes the state and never flips `streaming`.
            const after = reduceShell(state, liveKey);
            expect(after).not.toBe(state);
            // It never flips `streaming` and never *newly* opens the load screen,
            // so it starts no turn — a navigation/help/save effect, not a starter.
            expect(after.streaming).toBe(true);
            const loadWasShown = state.screen.kind === 'save-load' && state.screen.mode === 'load';
            const loadNowShown = after.screen.kind === 'save-load' && after.screen.mode === 'load';
            expect(loadNowShown && !loadWasShown).toBe(false);
          }
          state = reduceShell(state, event);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('unlocks input only after a done, paused or ended chunk', () => {
    fc.assert(
      fc.property(terminalChunkArb, (terminal) => {
        // From a mid-stream state, the one turn-starting key is refused...
        const streaming = reduceShell(initialShellState, { type: 'turn-start' });
        expect(streaming.streaming).toBe(true);
        for (const key of TURN_STARTING_KEYS) {
          expect(reduceShell(streaming, { type: 'key', key })).toBe(streaming);
        }
        // ...then a terminal chunk releases the lock, and it is accepted again.
        const released = reduceShell(streaming, terminal);
        expect(released.streaming).toBe(false);
        const restarted = reduceShell(released, { type: 'turn-start' });
        expect(startedATurn(released, restarted)).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });
});
