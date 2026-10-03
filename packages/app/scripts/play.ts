/**
 * `pnpm play [--seed <s>] [--profile <name>]` — the thin entry that launches the
 * game (slice-integration task 14.1; design, "Launcher (`app/launcher.ts`,
 * `pnpm play`)"; Req 20.1).
 *
 * All the launch logic lives in {@link runLauncher}; this file is only the
 * production wiring of its {@link LauncherIo}: the process streams, a UTF-8 file
 * reader, the real `@lmstudio/sdk` connect/startServer actions, and the default
 * Ink render. It parses nothing and decides nothing — it reads the exit status
 * `runLauncher` returns and sets the process exit code from it.
 *
 * Like the REPL entry, this script is NOT part of the build, the typecheck
 * target or CI: it lives outside `src`, so the lib build and the test run
 * exclude it. It only needs to run under `tsx`.
 *
 * Usage:
 *   pnpm play
 *   pnpm play --seed vienna-alpha --profile gemma-voice
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createLmsStartServerAction,
  createSdkConnectAction,
} from '@tradecraft/llm';

import { runLauncher, type LauncherIo } from '../src/lib/launcher.js';

/**
 * The repo root, resolved from this script's location
 * (`packages/app/scripts/play.ts` → up three levels), so repo-root files
 * (`config/`, `packages/content/packs`) resolve regardless of the cwd `pnpm
 * exec` runs in.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

async function main(): Promise<void> {
  const io: LauncherIo = {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    readFile: (path) => readFileSync(path, 'utf8'),
    repoRoot: REPO_ROOT,
    connect: createSdkConnectAction(),
    startServer: createLmsStartServerAction(),
    now: () => Date.now(),
  };

  const status = await runLauncher(process.argv.slice(2), io);
  process.exitCode = status;
}

main().catch((err) => {
  process.stderr.write(
    `play failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exitCode = 1;
});
