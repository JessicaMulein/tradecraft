/**
 * `pnpm seeds:vet [--per-preset <n>] [--candidates <n>]` — rebuild
 * `config/featured-seeds.json`.
 *
 * For each Difficulty Preset it plays candidate seeds (`vienna-<preset>-<i>`)
 * with the expert playability probe and keeps the first `--per-preset` (default
 * 24) whose win lands inside the vetted window, trying at most `--candidates`
 * (default 120). A seedless new game then starts on one of these. The probe
 * runs offline with the Fake Seams, about a second per seed.
 *
 * Re-run it after any change to the engine, the core pack or the presets: the
 * list is only valid for the generator and content it was vetted against, and
 * the file records both.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import { GENERATOR_VERSION } from '@tradecraft/engine';
import { vetSeed, VETTED_WIN_WINDOW } from '../src/lib/playability-probe.js';
import { FEATURED_SEEDS_PATH, type FeaturedSeed } from '../src/lib/featured-seeds.js';
import type { ScriptedPreset } from '../src/lib/scripted-games.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PRESETS: readonly ScriptedPreset[] = ['easy', 'standard', 'hard'];

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'per-preset': { type: 'string', default: '24' },
      candidates: { type: 'string', default: '120' },
    },
  });
  const perPreset = Number(values['per-preset']);
  const candidates = Number(values.candidates);

  const presets: Record<string, FeaturedSeed[]> = {};
  for (const preset of PRESETS) {
    const kept: FeaturedSeed[] = [];
    let tried = 0;
    for (let i = 0; i < candidates && kept.length < perPreset; i += 1) {
      const seed = `vienna-${preset}-${i}`;
      const { ok, result } = await vetSeed(seed, preset);
      tried += 1;
      if (ok) {
        kept.push({ seed, winDay: result.day, finalDeadline: result.finalDeadline });
      }
    }
    presets[preset] = kept;
    process.stdout.write(`${preset}: kept ${kept.length} of ${tried} candidates\n`);
  }

  const file = {
    note: 'Written by `pnpm seeds:vet`. Seeds the expert playability probe wins inside the vetted window.',
    generatorVersion: GENERATOR_VERSION,
    winWindow: VETTED_WIN_WINDOW,
    presets,
  };
  const path = join(REPO_ROOT, FEATURED_SEEDS_PATH);
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote ${path}\n`);
}

void main();
