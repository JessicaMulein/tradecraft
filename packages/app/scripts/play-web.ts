/**
 * `pnpm play:web [--profile <name>]` — launch the game in the browser on
 * 127.0.0.1. All logic lives in `runWebLauncher`; this file only wires the real
 * process streams, file reader, SDK actions and SIGINT.
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLmsStartServerAction, createSdkConnectAction } from '@tradecraft/llm';

import { runWebLauncher, type WebLauncherIo } from '../src/lib/web-launcher.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function open(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
  } catch { /* the URL is already printed */ }
}

const io: WebLauncherIo = {
  out: (l) => process.stdout.write(`${l}\n`),
  err: (l) => process.stderr.write(`${l}\n`),
  readFile: (p) => readFileSync(p, 'utf8'),
  repoRoot: REPO_ROOT,
  connect: createSdkConnectAction(),
  startServer: createLmsStartServerAction(),
  now: () => Date.now(),
  openBrowser: open,
  waitForStop: () => new Promise<void>((resolve) => process.once('SIGINT', () => resolve())),
};

runWebLauncher(process.argv.slice(2), io)
  .then((status) => { process.exitCode = status; })
  .catch((err: unknown) => {
    process.stderr.write(`play:web failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  });
