/**
 * `pnpm repl --seed <s> [--preset easy|standard|hard] [--out <recording.jsonl>]`
 * — the first-live-session REPL (checkpoint 17), on the Composition Root
 * (slice-integration task 17.1).
 *
 * This is the thin arg-parse + IO + live-wiring shell over the testable session
 * logic in `src/lib/repl/`. It:
 *
 *   1. loads `config/models.yaml` and builds the live {@link OpenAIGateway}
 *      against the configured endpoint (LM Studio by default),
 *   2. runs the startup model check and FAILS GRACEFULLY with a clear message
 *      when the endpoint is unreachable or a required model is not loaded — the
 *      expected case in CI, where no LM Studio is running; the human runs it
 *      live,
 *   3. wraps the live gateway with a {@link RecordingGateway} + {@link
 *      FileRecordSink} so the whole session is RECORDED to a JSONL file
 *      (recording ON, Req 17.3), and
 *   4. drives one scripted operator session with {@link runSession}, which
 *      assembles the game through `@tradecraft/app`'s `createGame` (the same
 *      Composition Root the launcher uses) over the recording gateway and runs
 *      the beats — new game, read the brief, travel, in-person briefing,
 *      surveil with narration, talk to one NPC, endScene — streaming each
 *      {@link TurnChunk} to stdout (facts plain, flavour dim, speech tagged),
 *      then prints the Case File, the Journal and the ground-truth records.
 *
 * The REPL no longer wires its own Player View engine, Turn Pipeline or Live
 * Seams: the Composition Root does all of that from the loaded Content Set and
 * the gateway this script hands it. This script only parses args, loads the
 * models config, builds + checks the live gateway, and chooses where to record.
 *
 * The script is NOT part of the build, the typecheck target or CI — it lives
 * outside `src`, so the lib build and the test run exclude it. It only needs to
 * typecheck and run under `tsx`.
 *
 * Usage:
 *   pnpm repl --seed vienna-alpha
 *   pnpm --filter @tradecraft/evals exec tsx scripts/repl.ts --seed s --preset easy
 */

import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  FileRecordSink,
  OpenAIGateway,
  RecordingGateway,
  formatConfigIssues,
  formatMissingRoles,
  loadModelsConfig,
} from '@tradecraft/llm';

import { DIFFICULTY_PRESET_IDS, type DifficultyPresetId } from '../src/lib/replays/fixtures.js';
import { renderInspection, runSession, type SessionEvent } from '../src/index.js';

/** The default seed, so `pnpm repl` with no args still launches. */
const DEFAULT_SEED = 'vienna-live';

/**
 * The repo root, resolved from this script's location
 * (`packages/evals/scripts/repl.ts` → up three levels). `pnpm exec` runs the
 * script with the package as cwd, so paths to repo-root files are resolved
 * against this rather than `process.cwd()`.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Where models.yaml lives, resolved against the repo root. */
const MODELS_CONFIG_PATH = join(REPO_ROOT, 'config', 'models.yaml');

const USAGE = `Usage: pnpm repl [--seed <seed>] [--preset easy|standard|hard] [--out <path>]

  --seed    <string>   the game seed to generate (default: ${DEFAULT_SEED})
  --preset  <id>       difficulty preset: easy | standard | hard (default: standard)
  --out     <path>     where to write the JSONL recording (default:
                       packages/evals/replays/live-session.jsonl)
  --help               show this message

Runs one scripted session against the live LLM endpoint in config/models.yaml
(LM Studio by default), with recording ON. If the endpoint is unreachable or a
required model is not loaded, it prints what is missing and exits non-zero.`;

/** The default recording path, under the package's `replays/` directory. */
const DEFAULT_OUT = join(REPO_ROOT, 'packages', 'evals', 'replays', 'live-session.jsonl');

/** Fail with a message on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** ANSI styling, kept minimal so a plain terminal still reads cleanly. */
const DIM = '\u001b[2m';
const CYAN = '\u001b[36m';
const RESET = '\u001b[0m';

/** Print one streamed chunk, styled by kind (facts plain, flavour dim, speech tagged). */
function printEvent(event: SessionEvent): void {
  const { chunk } = event;
  switch (chunk.kind) {
    case 'fact':
      process.stdout.write(`  ${chunk.text}\n`);
      break;
    case 'flavour':
      process.stdout.write(`  ${DIM}${chunk.text}${RESET}\n`);
      break;
    case 'speech':
      process.stdout.write(`  ${CYAN}${chunk.speaker}:${RESET} ${chunk.text}\n`);
      break;
    case 'notification':
      process.stdout.write(`  ${DIM}• ${chunk.n.factLine}${RESET}\n`);
      break;
    case 'paused':
      process.stdout.write(
        `  ${DIM}[paused: ${chunk.error.endpoint} — ${chunk.error.message}]${RESET}\n`,
      );
      break;
    case 'ended':
      process.stdout.write(`  [the game ended: ${chunk.outcome}]\n`);
      break;
    case 'hint':
      process.stdout.write(`  ${DIM}» ${chunk.text}${RESET}\n`);
      break;
    case 'interrupted':
    case 'done':
      break;
  }
}

/** A section banner on stdout. */
function banner(title: string): void {
  process.stdout.write(`\n== ${title} ==\n`);
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        seed: { type: 'string', default: DEFAULT_SEED },
        preset: { type: 'string', default: 'standard' },
        out: { type: 'string', default: DEFAULT_OUT },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    });
  } catch (err) {
    fail(`bad arguments: ${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
  }

  const { seed, preset, out, help } = parsed.values;

  if (help === true) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  if (!(DIFFICULTY_PRESET_IDS as readonly string[]).includes(preset as string)) {
    fail(`error: --preset must be one of ${DIFFICULTY_PRESET_IDS.join(' | ')} (got "${preset}")`);
  }

  // 1. Load models.yaml. A parse/validation failure is a clear, located error.
  const config = loadModelsConfig(MODELS_CONFIG_PATH);
  if (!config.ok) {
    fail(`error: ${MODELS_CONFIG_PATH} failed to load:\n${formatConfigIssues(config.issues)}`);
  }

  // 2. Startup check against the live gateway: fail gracefully when the endpoint
  //    is down or a model is missing. This is the expected path in CI (no LM
  //    Studio); the human runs it live with the models loaded. The check runs
  //    against the raw live gateway before recording wraps it.
  const live = new OpenAIGateway(config.value);
  try {
    const check = await live.checkStartup();
    if (!check.ok) {
      fail(
        `error: the active profile "${config.value.active}" needs models the endpoint is not serving:\n${formatMissingRoles(
          check,
        )}\n\nLoad them in LM Studio (or remap ${MODELS_CONFIG_PATH}) and try again.`,
      );
    }
  } catch (err) {
    fail(
      `error: could not reach the LLM endpoint at ${config.value.endpoint}: ${
        err instanceof Error ? err.message : String(err)
      }\n\nStart LM Studio (or point ${MODELS_CONFIG_PATH} at a running endpoint) and try again.`,
    );
  }

  // 3. Wrap the checked live gateway in a recording gateway (recording ON) and
  //    hand it to the Composition Root. Passing a caller-built Gateway lets the
  //    REPL keep its graceful startup check while still driving the assembled
  //    game through `createGame`.
  const sink = new FileRecordSink(out as string);
  const gateway = new RecordingGateway(live, sink);

  process.stdout.write(`\nStarting live session — seed "${seed}", preset "${preset}".\n`);
  process.stdout.write(`Recording to ${out}.\n`);

  // 4. Drive the session through the Composition Root over the recording gateway.
  const result = await runSession({
    seed: seed as string,
    preset: preset as DifficultyPresetId,
    repoRoot: REPO_ROOT,
    models: config.value,
    gateway,
    sink: printEvent,
  });

  banner('Brief Cable');
  process.stdout.write(`${result.inspection.brief}\n`);

  process.stdout.write(`\n${renderInspection(result.inspection)}`);
}

main().catch((err) => {
  fail(`repl failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
});
