/**
 * `pnpm evals [--profile <name>] [--out <dir>]` — the model evaluation CLI
 * (slice-integration task 17.2; design, "Evals on the Composition Root";
 * Req 18.5, 22.4, 25.1, 25.2, 25.3).
 *
 * All the orchestration lives in {@link runEvals} (`src/lib/report/run-evals.ts`),
 * which is unit-tested offline (task 17.4). This file is only the production
 * wiring of its {@link RunEvalsIo}: it
 *
 *   1. loads the Content Set from `config/scenario.yaml`'s packs and resolves
 *      `scenario.yaml` against it (the same located loading the launcher does),
 *      then loads `config/models.yaml` (Req 22.4 — the Context Length is read
 *      from the models config by the Model Manager, so no context-length
 *      argument is passed),
 *   2. wires the real `@lmstudio/sdk` connect/startServer actions and lets
 *      {@link runEvals} fill in the live-Gateway factory, the `createGame` scene
 *      player, the gateway judge scorer and the real Model Manager functions, and
 *   3. writes the Markdown and CSV reports under the output directory and sets
 *      the process exit code from the status {@link runEvals} returns.
 *
 * With `--profile <name>` it runs the one named profile; with no `--profile` it
 * runs every profile, unloading the previous before loading the next (Req 25.3).
 * Either way the reports carry the judge identity and the same-as-voice warning
 * (Req 25.1, 25.2).
 *
 * Like the REPL and play entries, this script is NOT part of the build, the
 * typecheck target or CI — it lives outside `src`, so the lib build and the test
 * run exclude it. It only needs to run under `tsx`, against a live LM Studio.
 *
 * Usage:
 *   pnpm evals                      # compare every profile
 *   pnpm evals --profile gemma-voice
 *   pnpm --filter @tradecraft/evals exec tsx scripts/evals.ts --profile qwen-voice
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  loadContent,
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';
import {
  formatConfigIssues as formatScenarioIssues,
  loadScenarioConfig,
  type ScenarioConfig,
  type ScenarioResolutionContext,
} from '@tradecraft/engine';
import {
  createLmsStartServerAction,
  createSdkConnectAction,
  formatConfigIssues as formatModelsIssues,
  loadModelsConfig,
} from '@tradecraft/llm';

import { runEvals, type RunEvalsIo } from '../src/index.js';
import { DIFFICULTY_PRESET_IDS, type DifficultyPresetId } from '../src/index.js';

/**
 * The repo root, resolved from this script's location
 * (`packages/evals/scripts/evals.ts` → up three levels), so repo-root files
 * (`config/`, `packages/content/packs`) resolve regardless of the cwd `pnpm
 * exec` runs in.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The config files the CLI loads, resolved against the repo root. */
const MODELS_CONFIG_PATH = join(REPO_ROOT, 'config', 'models.yaml');
const SCENARIO_CONFIG_PATH = join(REPO_ROOT, 'config', 'scenario.yaml');

/** The pack directories the scenario is loaded from (the shipped core pack). */
const PACK_DIRS = [join(REPO_ROOT, 'packages', 'content', 'packs', 'core')];
const PACK_LOAD = ['core'];

/** The default directory the reports are written under. */
const DEFAULT_OUT = join(REPO_ROOT, 'logs', 'evals');

const USAGE = `Usage: pnpm evals [--profile <name>] [--out <dir>]

  --profile <name>   run only this profile (default: compare every profile)
  --out     <dir>    where to write eval-report.md and eval-report.csv
                     (default: logs/evals)
  --help             show this message

Runs the five eval fixtures through the live models in config/models.yaml and
writes a Markdown + CSV comparison report. With no --profile it compares every
profile, unloading each before loading the next. Requires a running LM Studio
with the profile's models available.`;

/** Fail with a message on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * Build the {@link ScenarioResolutionContext} from a loaded Content Set: the
 * difficulty presets keyed by their bare id (the registry namespaces them
 * `<pack>/<name>`; a scenario names the bare id) and the pack ids that exist.
 * Mirrors the launcher's resolution context so `scenario.yaml` resolves the same.
 */
function resolutionContext(content: ContentSet): ScenarioResolutionContext {
  const presets = new Map<string, DifficultyPreset>();
  for (const [key, value] of content.difficultyPresets) {
    const bare = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key;
    if (!presets.has(bare)) {
      presets.set(bare, value);
    }
    presets.set(key, value);
  }
  const availablePackIds = new Set(content.manifest.packs.map((p) => p.id));
  return { presets, availablePackIds };
}

/**
 * Load the Content Set and resolve `scenario.yaml` against it (the same located
 * loading the launcher does). Returns the validated {@link ScenarioConfig} and
 * the preset id the fixtures' worlds are generated under; a load/validation
 * failure is a fatal, located error.
 */
function loadScenario(): { scenario: ScenarioConfig; preset: string } {
  const content = loadContent(PACK_DIRS, PACK_LOAD);
  if (!content.ok) {
    const first = content.errors[0] as { path?: string; message?: string } | undefined;
    const detail = first === undefined ? 'no further detail' : `${first.path ?? '<root>'}: ${first.message ?? 'invalid'}`;
    fail(`error: failed to load Content Packs [${PACK_LOAD.join(', ')}]: ${detail}`);
  }
  const resolved = loadScenarioConfig(SCENARIO_CONFIG_PATH, resolutionContext(content.value));
  if (!resolved.ok) {
    fail(`error: ${formatScenarioIssues(resolved.issues)}`);
  }
  return {
    scenario: resolved.value.scenario,
    preset: resolved.value.scenario.difficulty.preset,
  };
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        profile: { type: 'string' },
        out: { type: 'string', default: DEFAULT_OUT },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    });
  } catch (err) {
    fail(`bad arguments: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
  }

  const { profile, out, help } = parsed.values;
  if (help === true) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  // Load and validate both configs. The Context Length is read from the models
  // config by the Model Manager (Req 22.4); the CLI passes no such argument.
  const config = loadModelsConfig(MODELS_CONFIG_PATH);
  if (!config.ok) {
    fail(`error: ${MODELS_CONFIG_PATH} failed to load:\n${formatModelsIssues(config.issues)}`);
  }
  const { scenario, preset } = loadScenario();

  if (!(DIFFICULTY_PRESET_IDS as readonly string[]).includes(preset)) {
    fail(
      `error: ${SCENARIO_CONFIG_PATH}: difficulty.preset: must be one of ` +
        `${DIFFICULTY_PRESET_IDS.join(' | ')} (got "${preset}")`,
    );
  }

  const outDir = out as string;
  mkdirSync(outDir, { recursive: true });

  const io: RunEvalsIo = {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    repoRoot: REPO_ROOT,
    scenario,
    models: config.value,
    preset: preset as DifficultyPresetId,
    connect: createSdkConnectAction(),
    startServer: createLmsStartServerAction(),
    writeReport: (name, contents) => {
      const path = join(outDir, name);
      writeFileSync(path, contents, 'utf8');
      process.stdout.write(`  → ${path}\n`);
    },
  };

  const status = await runEvals(io, {
    ...(profile !== undefined ? { profile: profile as string } : {}),
  });
  process.exitCode = status;
}

main().catch((err) => {
  fail(`evals failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
});
