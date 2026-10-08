/**
 * `pnpm player:play` — play saved neural-player weights against a preset.
 *
 *   pnpm player:play [--preset all] [--seed nn-eval-easy-0] [--games 1] [--max-turns 160]
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { argmax } from '../src/lib/nn/mlp.js';
import {
  playEpisode,
  summarizeEpisodes,
  type EpisodeResult,
} from '../src/lib/nn/episode.js';
import { defaultPresets, loadPlayer } from '../src/lib/nn/train.js';
import type { ScriptedPreset } from '../src/lib/scripted-games.js';

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

async function playPreset(
  preset: ScriptedPreset,
  games: number,
  maxTurns: number,
  seedPrefix: string,
): Promise<EpisodeResult[]> {
  const path = join(REPO_ROOT, 'saves', 'player-weights', `${preset}.json`);
  if (!existsSync(path)) {
    throw new Error(`no weights at ${path}. Train them with pnpm player:train`);
  }
  const { policy } = loadPlayer(path);
  const results: EpisodeResult[] = [];
  for (let i = 0; i < games; i += 1) {
    const seed =
      games === 1 && seedPrefix !== ''
        ? seedPrefix
        : `${seedPrefix || 'nn-play'}-${preset}-${i}`;
    const result = await playEpisode({
      seed,
      preset,
      maxTurns,
      choose: (obs) =>
        argmax(
          policy.probs(
            obs.stateVec,
            obs.actions.map((action) => action.vec),
          ),
        ),
    });
    console.log(
      `${preset} ${result.seed} ${result.outcome} day ${result.day} turns ${result.turns} evidence ${result.evidence.toFixed(1)}`,
    );
    results.push(result);
  }
  console.log(`${preset}: ${summarizeEpisodes(results)}`);
  return results;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      preset: { type: 'string', default: 'all' },
      seed: { type: 'string', default: '' },
      games: { type: 'string', default: '1' },
      'max-turns': { type: 'string', default: '160' },
    },
  });
  const presets = defaultPresets(values.preset);
  const games = Number(values.games);
  const maxTurns = Number(values['max-turns']);
  for (const preset of presets) {
    await playPreset(preset, games, maxTurns, values.seed ?? '');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
