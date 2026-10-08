/**
 * Play one game with a neural policy, or with the teacher that trains it.
 *
 * Every decision goes through the Scripted Full Game harness: the real
 * Composition Root, the Fake Seams, and an action the catalogue allows. A
 * decrypt the network selects is submitted as the plaintext worked out from
 * the Workbench. The cipher spec is never read.
 */

import { isIntent, type Intent } from '@tradecraft/engine';
import { PlayerViewEngine, type TurnChunk } from '@tradecraft/player-view';

import type { ScenarioOverrides } from '../game-harness-config.js';
import { ScriptedGame, type ScriptedPreset } from '../scripted-games.js';
import type { StateContext } from './features.js';
import {
  freshMemory,
  observe,
  remember,
  type ActionView,
  type Move,
  type Observation,
} from './observe.js';

/** How a played game ended, or why the driver stopped. */
export type PlayerOutcome =
  | 'win'
  | 'plot-completed'
  | 'burned'
  | 'wrongful'
  | 'stalled';

/** One finished game. */
export interface EpisodeResult {
  readonly seed: string;
  readonly preset: ScriptedPreset;
  readonly outcome: PlayerOutcome;
  readonly cause?: string;
  readonly day: number;
  readonly turns: number;
  readonly evidence: number;
  readonly threshold: number;
}

/** One decision, kept when a caller is training. */
export interface DecisionSample {
  readonly state: Float64Array;
  readonly actions: readonly Float64Array[];
  chosen: number;
  reward: number;
}

/** How to play one seed. */
export interface PlayOptions {
  readonly seed: string;
  readonly preset: ScriptedPreset;
  /** Decisions before the driver stops and reports `stalled`. */
  readonly maxTurns?: number;
  /** Index into `obs.actions`. */
  readonly choose: (obs: Observation) => number;
  /** Filled with one sample per decision when the caller is training. */
  readonly sink?: DecisionSample[];
  /** Scenario blocks that differ from the core harness, such as ambient. */
  readonly scenario?: ScenarioOverrides;
}

const ALLOWED = { allowed: true, phases: 0, money: 0 } as const;

function statedIntent(line: string): Promise<Intent> {
  const raw = line.startsWith('intent:')
    ? line.slice('intent:'.length)
    : 'small-talk';
  return Promise.resolve(isIntent(raw) ? raw : 'small-talk');
}

async function drain(stream: AsyncIterable<TurnChunk>): Promise<void> {
  for await (const chunk of stream) {
    void chunk;
  }
}

async function apply(game: ScriptedGame, move: Move): Promise<void> {
  if (move.type === 'end-scene') {
    await drain(game.api.endScene());
    return;
  }
  if (move.type === 'say') {
    const opts = move.offer === undefined ? undefined : { offer: move.offer };
    await drain(game.api.say(`intent:${move.intent}`, opts));
    return;
  }
  const action = move.action;
  if (action.kind === 'decrypt') {
    const submission = move.submission;
    if (submission === undefined) {
      throw new Error('decrypt was offered before the traffic was broken');
    }
    await game.play({ action, quote: ALLOWED }, (template) => {
      if (template.kind !== 'decrypt') return template;
      return { ...template, submission };
    });
    return;
  }
  await game.play({ action, quote: ALLOWED });
}

function shaped(
  before: StateContext,
  after: StateContext,
  view: ActionView,
): number {
  let reward = 0.8 * (after.maxEvidence - before.maxEvidence);
  reward += 0.05 * Math.max(0, after.claims - before.claims);
  if (
    view.context.unreadRead &&
    view.move.type === 'act' &&
    view.move.action.kind === 'read'
  ) {
    reward += 0.03;
  }
  if (
    view.context.breakableDecrypt &&
    view.move.type === 'act' &&
    view.move.action.kind === 'decrypt'
  ) {
    reward += 0.08;
  }
  if (view.context.riskyDirectTravel) reward -= 0.25;
  reward -= 0.01;
  return reward;
}

function terminalReward(outcome: PlayerOutcome): number {
  if (outcome === 'win') return 8;
  if (outcome === 'burned') return -5;
  if (outcome === 'wrongful') return -4;
  if (outcome === 'plot-completed') return -3;
  return -1;
}

function classify(game: ScriptedGame): {
  outcome: PlayerOutcome;
  cause?: string;
} {
  const ended = (game.api as PlayerViewEngine).state.ended;
  if (ended === undefined) return { outcome: 'stalled' };
  if (ended.outcome === 'success')
    return { outcome: 'win', cause: ended.cause };
  if (ended.cause === 'burned')
    return { outcome: 'burned', cause: ended.cause };
  if (ended.cause === 'plot-completed')
    return { outcome: 'plot-completed', cause: ended.cause };
  return { outcome: 'wrongful', cause: ended.cause };
}

/**
 * Play `seed` on `preset` until the game ends or `maxTurns` decisions have
 * been taken. `choose` sees only the observation {@link observe} built.
 */
export async function playEpisode(
  options: PlayOptions,
): Promise<EpisodeResult> {
  const maxTurns = options.maxTurns ?? 160;
  const game = await ScriptedGame.start({
    seed: options.seed,
    preset: options.preset,
    seams: { classify: statedIntent },
    ...(options.scenario === undefined ? {} : { scenario: options.scenario }),
  });
  try {
    const memory = freshMemory();
    let obs = observe(game, options.preset, memory);
    let turns = 0;
    let last: DecisionSample | undefined;
    while (!game.over && turns < maxTurns && obs.actions.length > 0) {
      const chosen = options.choose(obs);
      const view = obs.actions[chosen];
      if (view === undefined) {
        throw new Error(
          `choice ${chosen} is outside the ${obs.actions.length} legal actions`,
        );
      }
      const before = obs.state;
      await apply(game, view.move);
      turns += 1;
      remember(memory, view.move, game.time);
      const after = observe(game, options.preset, memory);
      if (options.sink !== undefined) {
        last = {
          state: obs.stateVec.slice(),
          actions: obs.actions.map((action) => action.vec.slice()),
          chosen,
          reward: shaped(before, after.state, view),
        };
        options.sink.push(last);
      }
      obs = after;
    }

    const { outcome, cause } = classify(game);
    if (last !== undefined) last.reward += terminalReward(outcome);
    const endedAt = (game.api as PlayerViewEngine).state.ended;
    return {
      seed: options.seed,
      preset: options.preset,
      outcome,
      ...(cause === undefined ? {} : { cause }),
      day: endedAt?.at.day ?? game.time.day,
      turns,
      evidence: obs.state.maxEvidence,
      threshold: obs.state.arrestThreshold,
    };
  } finally {
    await game.close();
  }
}

/** A one-line description of a batch of games. */
export function summarizeEpisodes(results: readonly EpisodeResult[]): string {
  const n = results.length;
  const count = (outcome: PlayerOutcome): number =>
    results.filter((result) => result.outcome === outcome).length;
  const wins = results
    .filter((result) => result.outcome === 'win')
    .map((result) => result.day);
  const evidence =
    n === 0 ? 0 : results.reduce((sum, result) => sum + result.evidence, 0) / n;
  const median =
    wins.length === 0
      ? undefined
      : [...wins].sort((a, b) => a - b)[Math.floor((wins.length - 1) / 2)];
  const winDay = median === undefined ? '' : `, median win day ${median}`;
  return `wins ${count('win')}/${n}, burned ${count('burned')}, plot ${count('plot-completed')}, wrongful ${count('wrongful')}, stalled ${count('stalled')}, mean evidence ${evidence.toFixed(1)}${winDay}`;
}
