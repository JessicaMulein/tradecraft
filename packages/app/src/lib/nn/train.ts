/**
 * Train one network per Difficulty Preset and play it back.
 *
 * Each preset is trained on its own weights. The teacher plays a handful of
 * games through the real engine; the network clones those decisions with
 * cross-entropy, then a short policy-gradient pass adjusts the weights on
 * games the network plays itself. The weights that score higher on the eval
 * seeds are the ones written out.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ScriptedPreset } from '../scripted-games.js';
import {
  playEpisode,
  summarizeEpisodes,
  type DecisionSample,
  type EpisodeResult,
} from './episode.js';
import { mulberry32 } from './mlp.js';
import { regionalScenario, AMBIENT_SCENARIO } from './modes.js';
import type { Observation } from './observe.js';
import {
  clipAndStep,
  createPlayer,
  playerFromFile,
  policyFile,
  type Policy,
  type PolicyFile,
  type ValueNet,
} from './policy.js';
import { teacherChoice } from './teacher.js';

export interface TrainOptions {
  readonly presets: readonly ScriptedPreset[];
  /** Teacher games recorded per preset. */
  readonly games: number;
  /** Greedy games used to score the network. */
  readonly evalGames: number;
  /** Policy-gradient games per preset. `0` skips that pass. */
  readonly rlGames: number;
  readonly maxTurns: number;
  readonly epochs: number;
  readonly seed: number;
  readonly weightsDir: string;
  readonly log?: (line: string) => void;
}

export interface PresetReport {
  readonly preset: ScriptedPreset;
  readonly weightsPath: string;
  readonly teacher: readonly EpisodeResult[];
  readonly played: readonly EpisodeResult[];
  readonly cloneLoss: number;
}

export interface TrainReport {
  readonly presets: readonly PresetReport[];
}

const PRESETS: readonly ScriptedPreset[] = ['easy', 'standard', 'hard'];

function writeLine(
  log: ((line: string) => void) | undefined,
  line: string,
): void {
  log?.(line);
}

function fitness(results: readonly EpisodeResult[]): number {
  let score = 0;
  for (const result of results) {
    if (result.outcome === 'win') score += 100;
    else if (result.outcome === 'burned') score -= 25;
    else if (result.outcome === 'wrongful') score -= 20;
    else if (result.outcome === 'plot-completed') score -= 5;
    else score -= 8;
    score += result.evidence;
  }
  return score;
}

function shuffle(items: DecisionSample[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = items[i];
    items[i] = items[j];
    items[j] = swap;
  }
}

/** Cross-entropy against the teacher's chosen action. Returns the mean loss. */
function clonePolicy(
  policy: Policy,
  samples: readonly DecisionSample[],
  epochs: number,
  rng: () => number,
  log: (line: string) => void,
): number {
  let last = 0;
  const pool = [...samples];
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    shuffle(pool, rng);
    let loss = 0;
    let seen = 0;
    const lr = 0.01 * (1 - epoch / Math.max(epochs, 1)) + 0.001;
    for (let start = 0; start < pool.length; start += 48) {
      const batch = pool.slice(start, start + 48);
      policy.zeroGrad();
      for (const sample of batch) {
        const probs = policy.probs(sample.state, sample.actions);
        policy.setChosen(sample.chosen);
        policy.backwardDecision(1, 0.001);
        loss += -Math.log(Math.max(probs[sample.chosen], 1e-12));
        seen += 1;
      }
      const norm = Math.sqrt(
        policy.layers().reduce((sum, layer) => sum + layer.gradNormSq(), 0),
      );
      if (norm > 1) {
        for (const layer of policy.layers()) layer.scaleGrad(1 / norm);
      }
      policy.step(lr);
    }
    last = seen === 0 ? 0 : loss / seen;
    log(`  clone epoch ${epoch + 1}/${epochs} loss ${last.toFixed(3)}`);
  }
  return last;
}

function returns(samples: readonly DecisionSample[], gamma: number): number[] {
  const out = new Array<number>(samples.length);
  let acc = 0;
  for (let t = samples.length - 1; t >= 0; t -= 1) {
    acc = samples[t].reward + gamma * acc;
    out[t] = acc;
  }
  return out;
}

/** One on-policy update from a game the network just played. */
function reinforce(
  policy: Policy,
  value: ValueNet,
  samples: readonly DecisionSample[],
): void {
  if (samples.length === 0) return;
  const goals = returns(samples, 0.98);
  policy.zeroGrad();
  value.zeroGrad();
  const advantages: number[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    advantages.push(goals[i] - value.predict(samples[i].state));
    value.backward(goals[i]);
  }
  const mean = advantages.reduce((sum, a) => sum + a, 0) / advantages.length;
  const variance =
    advantages.reduce((sum, a) => sum + (a - mean) ** 2, 0) / advantages.length;
  const std = Math.sqrt(variance);
  if (std > 1e-6) {
    for (let i = 0; i < samples.length; i += 1) {
      policy.probs(samples[i].state, samples[i].actions);
      policy.setChosen(samples[i].chosen);
      policy.backwardDecision((advantages[i] - mean) / std, 0.01);
    }
  }
  clipAndStep(policy, value, 1, 3e-4, 1e-3);
}

async function evaluate(
  policy: Policy,
  preset: ScriptedPreset,
  games: number,
  maxTurns: number,
  log: (line: string) => void,
): Promise<EpisodeResult[]> {
  const results: EpisodeResult[] = [];
  for (let i = 0; i < games; i += 1) {
    const seed = `nn-eval-${preset}-${i}`;
    const result = await playEpisode({
      seed,
      preset,
      maxTurns,
      choose: (obs) => {
        const probs = policy.probs(
          obs.stateVec,
          obs.actions.map((action) => action.vec),
        );
        let best = 0;
        for (let k = 1; k < probs.length; k += 1) {
          if (probs[k] > probs[best]) best = k;
        }
        return best;
      },
    });
    results.push(result);
    log(
      `  eval ${seed} ${result.outcome} day ${result.day} turns ${result.turns} evidence ${result.evidence.toFixed(1)}`,
    );
  }
  return results;
}

async function trainPreset(
  options: TrainOptions,
  preset: ScriptedPreset,
): Promise<PresetReport> {
  const log = (line: string): void => writeLine(options.log, line);
  const rng = mulberry32(
    options.seed + (preset === 'easy' ? 1 : preset === 'standard' ? 2 : 3),
  );
  const { policy, value } = createPlayer(options.seed);
  log(`${preset}: recording ${options.games} teacher games`);
  const samples: DecisionSample[] = [];
  const teacher: EpisodeResult[] = [];
  for (let i = 0; i < options.games; i += 1) {
    const seed = `nn-train-${preset}-${i}`;
    const result = await playEpisode({
      seed,
      preset,
      maxTurns: options.maxTurns,
      choose: (obs) =>
        teacherChoice(
          obs.state,
          obs.actions.map((action) => action.context),
        ),
      sink: samples,
    });
    teacher.push(result);
    log(
      `  teacher ${seed} ${result.outcome} day ${result.day} turns ${result.turns} evidence ${result.evidence.toFixed(1)}`,
    );
  }
  const chooseTeacher = (obs: Observation): number =>
    teacherChoice(
      obs.state,
      obs.actions.map((action) => action.context),
    );
  for (const extra of [
    { name: 'ambient', scenario: AMBIENT_SCENARIO },
    { name: 'region', scenario: regionalScenario() },
  ]) {
    const seed = `nn-train-${preset}-${extra.name}`;
    const result = await playEpisode({
      seed,
      preset,
      maxTurns: Math.min(40, options.maxTurns),
      scenario: extra.scenario,
      choose: chooseTeacher,
      sink: samples,
    });
    teacher.push(result);
    log(
      `  teacher ${seed} ${result.outcome} day ${result.day} turns ${result.turns} evidence ${result.evidence.toFixed(1)}`,
    );
  }
  log(
    `${preset}: teacher ${summarizeEpisodes(teacher)} (${samples.length} decisions)`,
  );
  const cloneLoss = clonePolicy(policy, samples, options.epochs, rng, log);

  log(`${preset}: eval after cloning`);
  const cloned = policy.dump();
  const clonedValue = value.dump();
  let played = await evaluate(
    policy,
    preset,
    options.evalGames,
    options.maxTurns,
    log,
  );
  log(`  ${summarizeEpisodes(played)}`);
  let best = fitness(played);

  if (options.rlGames > 0) {
    log(`${preset}: policy gradient on ${options.rlGames} games`);
    const sampleRng = mulberry32(options.seed + 1000);
    for (let i = 0; i < options.rlGames; i += 1) {
      const episode: DecisionSample[] = [];
      const seed = `nn-rl-${preset}-${i}`;
      const result = await playEpisode({
        seed,
        preset,
        maxTurns: options.maxTurns,
        sink: episode,
        choose: (obs) => {
          const probs = policy.probs(
            obs.stateVec,
            obs.actions.map((action) => action.vec),
          );
          const r = sampleRng();
          let acc = 0;
          for (let k = 0; k < probs.length; k += 1) {
            acc += probs[k];
            if (r <= acc) return k;
          }
          return probs.length - 1;
        },
      });
      reinforce(policy, value, episode);
      log(
        `  rl ${seed} ${result.outcome} day ${result.day} turns ${result.turns} evidence ${result.evidence.toFixed(1)}`,
      );
    }
    log(`${preset}: eval after policy gradient`);
    const after = await evaluate(
      policy,
      preset,
      options.evalGames,
      options.maxTurns,
      log,
    );
    log(`  ${summarizeEpisodes(after)}`);
    if (fitness(after) >= best) {
      played = after;
      best = fitness(after);
    } else {
      policy.loadDump(cloned);
      value.loadDump(clonedValue);
      log(`  kept the cloned weights (eval fitness ${best.toFixed(1)})`);
    }
  }

  mkdirSync(options.weightsDir, { recursive: true });
  const weightsPath = join(options.weightsDir, `${preset}.json`);
  writeFileSync(weightsPath, JSON.stringify(policyFile(preset, policy, value)));
  log(`${preset}: wrote ${weightsPath}`);
  log(`${preset}: ${summarizeEpisodes(played)}`);
  return { preset, weightsPath, teacher, played, cloneLoss };
}

/** Train every requested preset and write `weightsDir/<preset>.json`. */
export async function trainPlayer(options: TrainOptions): Promise<TrainReport> {
  const presets: PresetReport[] = [];
  for (const preset of options.presets) {
    presets.push(await trainPreset(options, preset));
  }
  return { presets };
}

/** Load a weight file written by {@link trainPlayer}. */
export function loadPlayer(path: string): { file: PolicyFile; policy: Policy } {
  const file = JSON.parse(readFileSync(path, 'utf8')) as PolicyFile;
  return { file, policy: playerFromFile(file).policy };
}

export function defaultPresets(
  name: string | undefined,
): readonly ScriptedPreset[] {
  if (name === undefined || name === 'all') return PRESETS;
  if (name === 'easy' || name === 'standard' || name === 'hard') return [name];
  throw new Error(`unknown preset "${name}" (easy, standard, hard, or all)`);
}
