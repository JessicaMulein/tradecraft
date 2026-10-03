/**
 * The Scripted Full Games (slice-integration task 18; design, "Testing
 * Strategy → Scripted Full Games"; Requirement 23).
 *
 * Each Scripted Full Game plays one complete game, from `newGame` on a fixed
 * seed to an ending, through the real Composition Root (`createGame`), the real
 * Turn Pipeline and the real Engine API, with the Fake Seams in place of the
 * models (Req 23.1). The harness, the three scripts and their shared helpers
 * live in `scripted-games.walk.ts` so they are also usable by the golden-replay
 * recorder (slice-integration task 19.2); this spec plays each script and makes
 * the end-check assertions (Req 23.4).
 *
 * ## The end checks ({@link expectEnding}, Req 23.4)
 *
 * Every script finishes with the same three checks: the `ended` chunk carries
 * the expected outcome, `views.debrief()` returns every debrief section, and
 * the Outcome Sink received exactly one record.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EndCause, OutcomeTag } from '@tradecraft/engine';
import type { DebriefView, TurnChunk } from '@tradecraft/player-view';

import {
  BURNED,
  claimsOf,
  PLOT_FAILURE,
  playBurned,
  playPlotFailure,
  playWinByArrest,
  ScriptedGame,
  WIN_BY_ARREST,
  type ScriptedGameOptions,
} from './scripted-games.js';

// ---------------------------------------------------------------------------
// The end checks (Req 23.4)
// ---------------------------------------------------------------------------

/** Drain a turn stream to its chunks. */
async function drain(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const chunks: TurnChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

/** Every section `views.debrief()` returns (design, Debrief screen; Req 19.6). */
const DEBRIEF_SECTIONS = [
  'outcome',
  'endedAt',
  'cause',
  'allegiances',
  'timeline',
  'lies',
  'noiseLeads',
  'fedPropositions',
  'directives',
  'score',
] as const satisfies readonly (keyof DebriefView)[];

/** The ending a script expects. */
interface ExpectedEnding {
  /** The outcome the `ended` chunk and the debrief carry. */
  readonly outcome: 'success' | 'failure';
  /** The cause the debrief names. */
  readonly cause: EndCause;
  /** The outcome tag of the Outcome Record. */
  readonly record: OutcomeTag;
}

/**
 * Check a finished Scripted Full Game (Req 23.4): the `ended` chunk carries the
 * expected outcome, `views.debrief()` returns every debrief section, and
 * exactly one Outcome Record was written, which a further turn does not add to.
 */
async function expectEnding(
  game: ScriptedGame,
  expected: ExpectedEnding,
): Promise<void> {
  // The `ended` chunk: streamed once, by the last turn played, with the outcome.
  const endedChunks = game.turns
    .flatMap((turn) => turn.chunks)
    .filter((c) => c.kind === 'ended');
  expect(endedChunks).toEqual([{ kind: 'ended', outcome: expected.outcome }]);
  expect(game.turns.at(-1)?.chunks).toContainEqual({
    kind: 'ended',
    outcome: expected.outcome,
  });
  expect(game.api.status().ended).toBe(true);

  // Every debrief section.
  const debrief = game.api.views.debrief();
  expect(debrief).not.toBeNull();
  if (debrief === null) {
    return;
  }
  expect(Object.keys(debrief).sort()).toEqual([...DEBRIEF_SECTIONS].sort());
  expect(debrief.outcome).toBe(expected.outcome);
  expect(debrief.cause).toBe(expected.cause);
  expect(debrief.allegiances.length).toBeGreaterThan(0);
  expect(debrief.timeline.length).toBeGreaterThan(0);
  expect(Array.isArray(debrief.lies)).toBe(true);
  expect(Array.isArray(debrief.noiseLeads)).toBe(true);
  expect(Array.isArray(debrief.fedPropositions)).toBe(true);
  expect(Array.isArray(debrief.directives)).toBe(true);
  expect(debrief.score.claimsTotal).toBe(claimsOf(game).length);

  // Exactly one Outcome Record, for this game and this end.
  expect(game.outcomes).toHaveLength(1);
  const [record] = game.outcomes;
  expect(record.outcome).toBe(expected.record);
  expect(record.seed).toBe(game.seed);
  expect(record.endedAt).toEqual(debrief.endedAt);

  // A further turn is refused by the ended gate and writes no second record.
  const further = await drain(game.api.act({ kind: 'wait', phases: 1 }));
  expect(further.map((c) => c.kind)).toEqual(['fact', 'done']);
  expect(game.outcomes).toHaveLength(1);
}

// ---------------------------------------------------------------------------
// The games
// ---------------------------------------------------------------------------

/** Games opened by a test, closed after it. */
const opened: ScriptedGame[] = [];

/** Fails any network call: the Scripted Full Games run with no endpoint (Req 23.5). */
function noNetwork(): never {
  throw new Error('a Scripted Full Game tried to reach the network');
}

beforeEach(() => {
  vi.stubGlobal('fetch', noNetwork);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  while (opened.length > 0) {
    await opened.pop()?.close();
  }
});

/** Start a Scripted Full Game, registered for teardown. */
async function start(options: ScriptedGameOptions): Promise<ScriptedGame> {
  const game = await ScriptedGame.start(options);
  opened.push(game);
  return game;
}

/** A generous per-game budget; a full game takes well under a second. */
const GAME_TIMEOUT_MS = 60_000;

describe('Scripted Full Games (Req 23)', () => {
  it(
    'wins by arresting the Cell leader on easy (Req 23.1, 23.4, 23.5)',
    async () => {
      const game = await start(WIN_BY_ARREST);
      const run = await playWinByArrest(game);

      await expectEnding(game, {
        outcome: 'success',
        cause: 'leader-arrested',
        record: 'success',
      });

      // Reading the brief Cable again filed nothing new: the leads were filed
      // once, at newGame, and do not corroborate themselves.
      expect(run.leadClaims).toBeGreaterThan(0);
      expect(run.claimsAfterBriefRead).toBe(run.leadClaims);

      // Surveilling the lead recorded what the player saw there.
      expect(
        claimsOf(game).some(
          (c) =>
            c.source.kind === 'surveillance' &&
            run.surveilled.includes(c.source.loc),
        ),
      ).toBe(true);

      // The Intercept was broken with its true key and its traffic is on file.
      expect(run.decryptLines.length).toBeGreaterThan(0);
      expect(
        claimsOf(game).some(
          (c) => c.source.kind === 'intercept' && c.source.id === run.broken,
        ),
      ).toBe(true);

      // The brief, the Dossiers and the Intercept did not reach the arrest
      // threshold of corroborated implicating Claims (easy: 2); the trace
      // Cable's reply did, and the arrest was the game's last turn.
      expect(run.evidenceBeforeCorroboration).toBeLessThan(2);
      expect(game.turns.some((turn) => turn.action.kind === 'cable')).toBe(
        true,
      );
      expect(run.evidenceAtArrest).toBeGreaterThanOrEqual(2);
      expect(game.turns.at(-1)?.action).toEqual({
        kind: 'arrest',
        npc: run.suspect,
      });
    },
    GAME_TIMEOUT_MS,
  );

  it(
    'loses when the Plot runs its final stage (Req 23.2, 23.4, 23.5)',
    async () => {
      const game = await start(PLOT_FAILURE);
      const run = await playPlotFailure(game);

      await expectEnding(game, {
        outcome: 'failure',
        cause: 'plot-completed',
        record: 'failure-plot',
      });

      // The game ran its course: the player only ever waited, and did so for
      // more than one day before the Plot reached its final stage.
      expect(game.turns.every((turn) => turn.action.kind === 'wait')).toBe(
        true,
      );
      expect(run.waits).toBeGreaterThan(1);
      expect(run.endedAt.day).toBeGreaterThan(run.startedAt.day);

      // The debrief names the Plot completing as the cause, with no arrest made.
      const debrief = game.api.views.debrief();
      expect(debrief?.cause).toBe('plot-completed');
    },
    GAME_TIMEOUT_MS,
  );

  it(
    'loses when Cover Suspicion crosses the burn threshold on hard (Req 23.3, 23.4, 23.5)',
    async () => {
      const game = await start(BURNED);
      const run = await playBurned(game);

      await expectEnding(game, {
        outcome: 'failure',
        cause: 'burned',
        record: 'failure-burned',
      });

      // The script drove suspicion up with its own moves: it cold-approached
      // and travelled tailed through the city's riskiest known Location.
      expect(run.approaches).toBeGreaterThan(0);
      expect(run.travels).toBeGreaterThan(0);
      expect(run.peakKnownRisk).toBeGreaterThan(0);
      expect(
        game.turns.every((turn) =>
          ['approach', 'travel', 'wait'].includes(turn.action.kind),
        ),
      ).toBe(true);

      // The game ended before the Plot could run its course: the cause is the
      // burn, not the Plot completing.
      const debrief = game.api.views.debrief();
      expect(debrief?.cause).toBe('burned');
      expect(run.endedAt.day).toBeGreaterThanOrEqual(run.startedAt.day);
    },
    GAME_TIMEOUT_MS,
  );
});
