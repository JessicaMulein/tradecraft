/**
 * `pnpm play:web` — launch the game behind the loopback web shell (web-shell
 * design, "Launcher"). It reuses the TUI launcher's config loading and Model
 * Manager startup, then hands the same `EngineApi` to the shell server. The
 * shell never sees anything but `EngineApi`.
 */

import { isAbsolute, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { startShellServer, parseShellConfig, type ShellServer } from '@tradecraft/web';

import { createGame } from './composition-root.js';
import { loadConfigs, runModelManager, type LauncherIo } from './launcher.js';

export interface WebLauncherIo extends LauncherIo {
  /** Open the launch URL in the default browser. Injected so tests never spawn one. */
  readonly openBrowser?: (url: string) => void;
  /** Resolves when the process is asked to stop (SIGINT in production). */
  readonly waitForStop?: () => Promise<void>;
  /** Test seam: replaces the real server start. */
  readonly startShell?: typeof startShellServer;
}

const WEB_CONFIG = join('config', 'web.yaml');

function readYaml(io: LauncherIo, path: string, optional: boolean): unknown {
  let text: string;
  try {
    text = io.readFile(path);
  } catch (cause) {
    if (optional) return undefined;
    throw new Error(`${path}: cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  return parseYaml(text) as unknown;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) return '';
  return value;
}

export async function runWebLauncher(argv: readonly string[], io: WebLauncherIo): Promise<number> {
  const profile = flagValue(argv, '--profile');
  const record = flagValue(argv, '--record');
  if (profile === '' || record === '') {
    io.err('play:web: --profile and --record each need a value');
    return 1;
  }

  const configs = loadConfigs(io, profile);
  if (!configs.ok) return 1;

  let shellConfig;
  let cueMap: unknown;
  let takeMeta: unknown;
  try {
    shellConfig = parseShellConfig(readYaml(io, join(io.repoRoot, WEB_CONFIG), true) ?? {});
    cueMap = readYaml(io, join(io.repoRoot, shellConfig.soundtrackDir, 'cue-map.yaml'), true);
    takeMeta = readYaml(io, join(io.repoRoot, shellConfig.soundtrackDir, 'take-meta.yaml'), true);
  } catch (cause) {
    io.err(cause instanceof Error ? cause.message : String(cause));
    return 1;
  }

  const startup = await runModelManager(io, configs.models);
  if (startup === undefined) return 1;
  for (const w of startup.load.warnings) io.err(w);

  const game = createGame({
    repoRoot: io.repoRoot,
    scenario: configs.scenario,
    models: configs.models,
    gateway: record === undefined ? 'live' : { record: isAbsolute(record) ? record : join(io.repoRoot, record) },
  });
  if (record !== undefined) {
    io.out(`Recording model calls to ${isAbsolute(record) ? record : join(io.repoRoot, record)}`);
  }

  let server: ShellServer;
  try {
    server = await (io.startShell ?? startShellServer)(game.api, shellConfig, {
      baseDir: io.repoRoot,
      cueMap,
      takeMeta,
      logError: (m, c) => io.err(c === undefined ? m : `${m}: ${c instanceof Error ? c.message : String(c)}`),
    });
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    io.err(
      code === 'EADDRINUSE'
        ? `web: port ${shellConfig.port} is already in use; set \`port\` in config/web.yaml or use 0 for any free port`
        : `web: could not start: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    await game.close();
    return 1;
  }

  // The launch URL carries the token. Print it once, to this terminal only.
  io.out(`Tradecraft is running. Open this link in your browser (it works once per session):`);
  io.out(server.launchUrl);
  if (shellConfig.openBrowser) io.openBrowser?.(server.launchUrl);

  await (io.waitForStop ?? (() => new Promise<void>(() => undefined)))();
  await server.close();
  await game.close();
  return 0;
}
