/**
 * `pnpm world --seed <s> --preset <p> [--reveal]` — a debug CLI that generates a
 * world for a seed and difficulty preset and dumps the full ground truth plus
 * the Starting Brief (checkpoint 12; design, "Engine inspection").
 *
 * This is a thin arg-parse + IO wrapper around the testable
 * {@link renderWorldDump} helper in `src/lib/debug/`: it parses the flags with
 * node's built-in `util.parseArgs`, builds the engine inputs for the chosen
 * preset, generates the world and its Truth Store, and prints the sectioned dump
 * to stdout. With `--reveal` the dump unwraps the Truth-branded ground truth
 * (true allegiances, the mole + MICE, Plot/Side-Thread ground truth, noise); the
 * player-safe default shows only what the player could see.
 *
 * Usage:
 *   pnpm world --seed vienna-alpha --preset standard --reveal
 *   pnpm --filter @tradecraft/evals exec tsx scripts/world.ts --seed s --preset easy
 *
 * The script is NOT part of the build, the typecheck target or CI — it lives
 * outside `src`, so the lib build and the test run exclude it. It only needs to
 * typecheck and run under an ESM TS runner (`tsx`).
 */

import { parseArgs } from 'node:util';

import { generateGame } from '@tradecraft/engine';

import { renderWorldDump } from '../src/lib/debug/world-dump.js';
import {
  DIFFICULTY_PRESET_IDS,
  buildInputs,
  type DifficultyPresetId,
} from '../src/lib/replays/fixtures.js';

const USAGE = `Usage: pnpm world --seed <seed> [--preset easy|standard|hard] [--reveal]

  --seed    <string>   the game seed to generate (required)
  --preset  <id>       difficulty preset: easy | standard | hard (default: standard)
  --reveal             reveal the ground truth (allegiances, mole + MICE, Plot/
                       Side-Thread truth, noise) on top of the player-safe dump
  --help               show this message`;

/** Fail with a message on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(1);
}

function main(): void {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        seed: { type: 'string' },
        preset: { type: 'string', default: 'standard' },
        reveal: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    });
  } catch (err) {
    fail(`bad arguments: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { seed, preset, reveal, help } = parsed.values;

  if (help === true) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  if (seed === undefined || seed.length === 0) {
    fail('error: --seed is required');
  }

  if (!(DIFFICULTY_PRESET_IDS as readonly string[]).includes(preset as string)) {
    fail(`error: --preset must be one of ${DIFFICULTY_PRESET_IDS.join(' | ')} (got "${preset}")`);
  }

  let dump: string;
  try {
    const inputs = buildInputs(preset as DifficultyPresetId);
    const { world, truth } = generateGame(seed, inputs);
    dump = renderWorldDump(world, truth, { reveal });
  } catch (err) {
    fail(`generation failed for seed "${seed}": ${err instanceof Error ? err.message : String(err)}`);
  }

  process.stdout.write(dump);
}

main();
