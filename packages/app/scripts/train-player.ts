/**
 * `pnpm player:train` — train a neural player against each Difficulty Preset.
 *
 * The network sees the Player View and scores each legal action. A teacher
 * that uses only those signals plays the training games; the network clones
 * that policy, then a short policy-gradient pass can adjust it. Weights land
 * in `saves/player-weights/<preset>.json`. Decrypt submits a plaintext worked
 * out from the Workbench. The cipher spec is never read.
 *
 *   pnpm player:train [--preset all] [--games 8] [--eval 4] [--rl 4] [--max-turns 140]
 */
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { summarizeEpisodes } from '../src/lib/nn/episode.js';
import { defaultPresets, trainPlayer } from '../src/lib/nn/train.js';

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      preset: { type: 'string', default: 'all' },
      games: { type: 'string', default: '8' },
      eval: { type: 'string', default: '4' },
      rl: { type: 'string', default: '4' },
      'max-turns': { type: 'string', default: '140' },
      epochs: { type: 'string', default: '6' },
      seed: { type: 'string', default: '1' },
    },
  });
  const presets = defaultPresets(values.preset);
  const report = await trainPlayer({
    presets,
    games: Number(values.games),
    evalGames: Number(values.eval),
    rlGames: Number(values.rl),
    maxTurns: Number(values['max-turns']),
    epochs: Number(values.epochs),
    seed: Number(values.seed),
    weightsDir: join(REPO_ROOT, 'saves', 'player-weights'),
    log: (line) => console.log(line),
  });
  console.log('');
  for (const preset of report.presets) {
    console.log(`${preset.preset}: ${summarizeEpisodes(preset.played)}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
