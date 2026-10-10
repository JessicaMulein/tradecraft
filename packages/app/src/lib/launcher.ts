/**
 * The Launcher (`pnpm play`) — slice-integration task 14.1; design, "Launcher
 * (`app/launcher.ts`, `pnpm play`)"; Requirements 20.1–20.6.
 *
 * `runLauncher(argv, io)` is the one function the `pnpm play` entry
 * (`scripts/play.ts`) calls. It turns a command line and a running machine into
 * a playing game, in the order the design lays out:
 *
 *   1. Parse `--seed <s>` and `--profile <name>` from `argv`. `--profile`
 *      overrides the models config's `active` profile (Req 20.1).
 *   2. Load and validate `config/scenario.yaml` and `config/models.yaml`. The
 *      scenario needs the loaded Content Set to resolve its named preset and
 *      pack ids, so the Content Set is loaded first and a load failure is
 *      reported the same located way. Each config issue is printed as
 *      `<file>: <path>: <message>` and the launcher returns 1 (Req 20.2, 22.3).
 *   3. Run the Model Manager startup — connect, preflight and load the active
 *      profile — through {@link startModelManager}, with the connect/startServer
 *      actions injected through {@link LauncherIo} so the whole path is testable
 *      offline against the fake LM Studio client. A `ConnectionError` prints
 *      "LM Studio server unreachable" with the cause; a `StartupError` prints
 *      every preflight issue (each missing model's `lms get` command and any
 *      memory shortfall). Either way the launcher returns 1 without starting the
 *      game (Req 20.3, 20.4).
 *   4. Print any partial-GPU warnings, then build the game with
 *      {@link createGame} over the live Gateway and render the {@link AppShell}
 *      with the seed default through the injected {@link LauncherIo.render}
 *      (Req 20.5, 20.6).
 *
 * Everything that touches the outside world — stdout/stderr, reading the config
 * files, the SDK connect/startServer actions, the Model Manager startup and the
 * Ink `render` — is injected through {@link LauncherIo}, so an offline test
 * (task 14.2) drives the launcher with fakes and no TTY and no endpoint.
 *
 * The context length the preflight and the model load are sized at is read from
 * the models config's `contextLength` by {@link startModelManager}; the launcher
 * passes no context-length argument (task 16.6, design "Context Length").
 */

import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';

import {
  loadContent,
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';
import {
  AMBIENT_KINDS,
  loadRegionContent,
  parseScenarioConfig,
  formatConfigIssues as formatScenarioIssues,
  ScenarioConfigSchema,
  type ScenarioConfig,
  type ScenarioResolutionContext,
  type SettingCity,
} from '@tradecraft/engine';
import {
  ConnectionError,
  StartupError,
  formatConfigIssues as formatModelsIssues,
  parseModelsConfig,
  startModelManager,
  type ConnectAction,
  type ModelsConfig,
  type StartServerAction,
  type StartupResult,
} from '@tradecraft/llm';
import type { EngineApi } from '@tradecraft/player-view';
import { AppShell, type AppShellDefaults } from '@tradecraft/tui';
import { render as inkRender } from 'ink';
import { createElement } from 'react';

import { createGame } from './composition-root.js';

/** The config files the launcher validates, resolved against the repo root. */
const SCENARIO_CONFIG = join('config', 'scenario.yaml');
const MODELS_CONFIG = join('config', 'models.yaml');

/**
 * A handle to a running render, so the launcher can await the App Shell exiting
 * (Ink's `render` returns an instance with a `waitUntilExit` promise). The
 * injected {@link LauncherIo.render} returns this shape so a test can resolve it
 * immediately without a real terminal.
 */
export interface RenderHandle {
  /** Resolves when the rendered app exits (the player quits). */
  waitUntilExit(): Promise<void>;
}

/**
 * Everything the launcher touches outside its own logic, injected so the whole
 * run is testable offline (design: "`io` carries stdout, stderr, the file
 * reader and the SDK actions"). A test passes string buffers, an in-memory file
 * reader, the fake LM Studio client's connect action, a fake startup function
 * and a render that resolves at once; production (`scripts/play.ts`) passes the
 * process streams, `readFileSync`, the real SDK actions and Ink's `render`.
 */
export interface LauncherIo {
  /** Write a line to standard output (the launcher appends its own newline). */
  readonly out: (line: string) => void;
  /** Write a line to standard error (the launcher appends its own newline). */
  readonly err: (line: string) => void;
  /**
   * Read a UTF-8 text file at an absolute path. Throws on a missing/unreadable
   * file; the launcher turns a throw into a located config issue so a bad path
   * is reported the same way as a bad field.
   */
  readonly readFile: (path: string) => string;
  /** The repository root the config paths and pack dirs resolve against. */
  readonly repoRoot: string;
  /** Attempt a single LM Studio connection (injected SDK action). */
  readonly connect: ConnectAction;
  /** Start the LM Studio server (`lms server start`, injected SDK action). */
  readonly startServer: StartServerAction;
  /**
   * The Model Manager startup. Injected so a test substitutes a fake that
   * resolves, throws {@link ConnectionError} or throws {@link StartupError}
   * without a real server. Defaults to the real {@link startModelManager}.
   */
  readonly startModelManager?: typeof startModelManager;
  /**
   * Render the App Shell. Injected so a test records the api/defaults it was
   * handed and resolves at once with no TTY. Defaults to {@link renderAppShell},
   * which mounts the {@link AppShell} with Ink's `render` on the real terminal.
   */
  readonly render?: (api: EngineApi, defaults: AppShellDefaults) => RenderHandle;
  /**
   * A monotonic clock, in milliseconds. Injected for determinism; currently
   * unused by the happy path (the seed is minted inside `newGame`), it is here
   * so a future timing-sensitive step stays testable without a real clock.
   */
  readonly now?: () => number;
}

/** The parsed command-line options the launcher understands. */
interface LauncherArgs {
  /** The seed to pre-fill on the start screen; undefined mints a random one. */
  readonly seed?: string;
  /** A profile name that overrides the models config's `active`. */
  readonly profile?: string;
  /** A scenario file relative to the repo root. Defaults to `config/scenario.yaml`. */
  readonly scenario?: string;
}

/**
 * Parse `--seed <s>` and `--profile <name>` out of `argv` (Req 20.1). Both are
 * optional and both accept either `--flag value` or `--flag=value`. An
 * unrecognised flag is ignored, so a `--` or an extra argument the package
 * manager forwards does not abort the launch.
 */
function parseArgs(argv: readonly string[]): LauncherArgs {
  let seed: string | undefined;
  let profile: string | undefined;
  let scenario: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inlineValue] = splitFlag(arg);
    if (flag === '--seed') {
      seed = inlineValue ?? argv[(i += 1)];
    } else if (flag === '--profile') {
      profile = inlineValue ?? argv[(i += 1)];
    } else if (flag === '--scenario') {
      scenario = inlineValue ?? argv[(i += 1)];
    }
    // Unknown flags are ignored so the launcher stays forgiving of extra args
    // (e.g. a `--` passed by the package manager). Only the two known flags
    // take values.
  }

  return {
    ...(seed !== undefined ? { seed } : {}),
    ...(profile !== undefined ? { profile } : {}),
    ...(scenario !== undefined ? { scenario } : {}),
  };
}

/** Split `--flag=value` into `['--flag', 'value']`, or `['--flag', undefined]`. */
function splitFlag(arg: string): readonly [string, string | undefined] {
  const eq = arg.indexOf('=');
  if (arg.startsWith('--') && eq !== -1) {
    return [arg.slice(0, eq), arg.slice(eq + 1)];
  }
  return [arg, undefined];
}

/**
 * Load the Content Set the scenario is resolved against (Req 18.1). The
 * scenario config names a preset and pack ids that only exist once the packs
 * are loaded, so the Content Set is loaded first. Returns the located issues
 * (as config issues) on a load failure so the launcher reports a bad pack
 * exactly the way it reports a bad field.
 */
function loadContentSet(
  io: LauncherIo,
  scenarioFile: string,
): { ok: true; content: ContentSet } | { ok: false; message: string } {
  // Read the scenario only enough to know which pack dirs/ids to load. The full
  // validation and resolution happens after the Content Set is available (it
  // needs the preset and pack-id context, which only exist once the packs are
  // loaded), so here we recover `packs` from a *schema-only* parse — the pack
  // dirs and ids are present and valid in the document long before the named
  // preset or pack ids can be resolved, so a scenario whose preset the empty
  // context cannot resolve still yields its real `packs`. A missing file or a
  // document whose shape fails the schema falls back to the shipped defaults so
  // the Content Set still loads and the full validation below reports every
  // scenario issue against its field path.
  const scenarioPath = join(io.repoRoot, scenarioFile);
  const probed = probePacks(io, scenarioPath);
  const dirs = probed.dirs.map((d) => join(io.repoRoot, d));
  const load = probed.load;

  const kinds =
    probed.regional || !probed.ambient ? undefined : { kinds: [...AMBIENT_KINDS] };
  const content = probed.regional
    ? loadRegionContent(dirs, load)
    : loadContent(dirs, load, kinds);
  if (!content.ok) {
    const first = content.errors[0] as
      | { path?: string; message?: string }
      | undefined;
    const detail =
      first === undefined
        ? 'no further detail'
        : `${first.path ?? '<root>'}: ${first.message ?? 'invalid'}`;
    return {
      ok: false,
      message: `${scenarioPath}: packs.load: failed to load Content Packs [${load.join(', ')}]: ${detail}`,
    };
  }
  return { ok: true, content: content.value };
}

/** The shipped pack defaults the probe falls back to for an unreadable/malformed scenario. */
const DEFAULT_PACK_DIRS = [join('packages', 'content', 'packs', 'core')];
const DEFAULT_PACK_LOAD = ['core'];

/**
 * Recover the `packs.dirs` and `packs.load` the Content Set is loaded from,
 * from a *schema-only* parse of `scenario.yaml`. The pack directories and ids
 * are plain document fields validated by {@link ScenarioConfigSchema}, so they
 * are available before the named preset or pack ids can be resolved (resolution
 * needs the loaded Content Set, a chicken-and-egg the probe sidesteps). A
 * missing file or a document whose shape fails the schema falls back to the
 * shipped defaults so the Content Set still loads and the full validation in
 * {@link loadConfigs} reports every scenario issue against its field path.
 */
function probePacks(
  io: LauncherIo,
  scenarioPath: string,
): { dirs: readonly string[]; load: string[]; regional: boolean; ambient: boolean } {
  let text: string;
  try {
    text = io.readFile(scenarioPath);
  } catch {
    return {
      dirs: DEFAULT_PACK_DIRS,
      load: [...DEFAULT_PACK_LOAD],
      regional: false,
      ambient: false,
    };
  }
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return {
      dirs: DEFAULT_PACK_DIRS,
      load: [...DEFAULT_PACK_LOAD],
      regional: false,
      ambient: false,
    };
  }
  const parsed = ScenarioConfigSchema.safeParse(doc);
  if (!parsed.success) {
    return {
      dirs: DEFAULT_PACK_DIRS,
      load: [...DEFAULT_PACK_LOAD],
      regional: false,
      ambient: false,
    };
  }
  const load = [...parsed.data.packs.load];
  return {
    dirs: [...parsed.data.packs.dirs],
    load,
    regional: parsed.data.region?.template !== undefined,
    ambient: parsed.data.ambient?.enabled === true || load.includes('ambient'),
  };
}

/**
 * Build the {@link ScenarioResolutionContext} the scenario loader needs: the
 * difficulty presets keyed by their bare id (the registry namespaces them
 * `<pack>/<name>`, and a scenario names the bare id), and the pack ids that
 * exist (from the Content Manifest).
 */
function resolutionContext(content: ContentSet): ScenarioResolutionContext {
  const presets = new Map<string, DifficultyPreset>();
  for (const [key, value] of content.difficultyPresets) {
    const bare = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key;
    // Prefer the first pack to define a bare id; keep the namespaced key too so
    // a fully-qualified selection still resolves.
    if (!presets.has(bare)) {
      presets.set(bare, value);
    }
    presets.set(key, value);
  }
  const availablePackIds = new Set(content.manifest.packs.map((p) => p.id));
  const cities = new Map<string, SettingCity>();
  for (const [id, bundle] of Object.entries(content.cities)) {
    cities.set(id, {
      startDates: {
        from: bundle.def.startDates.from,
        to: bundle.def.startDates.to,
      },
    });
  }
  const period = content.era?.period;
  return {
    presets,
    availablePackIds,
    cities,
    ...(period === undefined ? {} : { eraPeriod: { from: period.from, to: period.to } }),
  };
}

/**
 * Load and validate both config files (Req 20.2, 22.3). The Content Set is
 * loaded first (the scenario loader needs it); then `scenario.yaml` is validated
 * and resolved against it, and `models.yaml` is parsed and validated. Every
 * issue from either file is collected and printed as `<file>: <path>: <message>`
 * before the launcher returns 1 — a validation failure never reaches the Model
 * Manager.
 */
export function loadConfigs(
  io: LauncherIo,
  profileOverride: string | undefined,
  scenarioFile: string = SCENARIO_CONFIG,
):
  | {
      ok: true;
      content: ContentSet;
      scenario: ScenarioConfig;
      models: ModelsConfig;
    }
  | { ok: false } {
  const contentResult = loadContentSet(io, scenarioFile);
  if (!contentResult.ok) {
    io.err(contentResult.message);
    return { ok: false };
  }
  const content = contentResult.content;

  const scenarioPath = join(io.repoRoot, scenarioFile);
  const modelsPath = join(io.repoRoot, MODELS_CONFIG);

  // Scenario: validate and resolve against the loaded Content Set.
  const scenarioLoad = (():
    | { ok: true; scenario: ScenarioConfig }
    | { ok: false; lines: string } => {
    let text: string;
    try {
      text = io.readFile(scenarioPath);
    } catch (e) {
      return {
        ok: false,
        lines: `${scenarioPath}: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    const result = parseScenarioConfig(text, scenarioPath, resolutionContext(content));
    return result.ok
      ? { ok: true, scenario: result.value.scenario }
      : { ok: false, lines: formatScenarioIssues(result.issues) };
  })();

  // Models: parse and validate.
  const modelsLoad = (():
    | { ok: true; models: ModelsConfig }
    | { ok: false; lines: string } => {
    let text: string;
    try {
      text = io.readFile(modelsPath);
    } catch (e) {
      return {
        ok: false,
        lines: `${modelsPath}: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    const result = parseModelsConfig(text, modelsPath);
    return result.ok
      ? { ok: true, models: result.value }
      : { ok: false, lines: formatModelsIssues(result.issues) };
  })();

  // Collect every issue from both files before failing (report all at once).
  const problems: string[] = [];
  if (!scenarioLoad.ok) {
    problems.push(scenarioLoad.lines);
  }
  if (!modelsLoad.ok) {
    problems.push(modelsLoad.lines);
  }
  if (problems.length > 0) {
    io.err(problems.join('\n'));
    return { ok: false };
  }

  // Both validated; apply the `--profile` override onto the models config.
  const scenario = (scenarioLoad as { scenario: ScenarioConfig }).scenario;
  let models = (modelsLoad as { models: ModelsConfig }).models;
  if (profileOverride !== undefined) {
    if (models.profiles[profileOverride] === undefined) {
      io.err(
        `${modelsPath}: active: --profile "${profileOverride}" is not a defined profile`,
      );
      return { ok: false };
    }
    models = { ...models, active: profileOverride };
  }

  return { ok: true, content, scenario, models };
}

/**
 * Run the Model Manager startup (Req 20.3, 20.4). On success the startup result
 * is returned; on a `ConnectionError` the launcher prints "LM Studio server
 * unreachable" with the cause, and on a `StartupError` it prints every
 * preflight issue (each missing model's `lms get` command, any memory
 * shortfall). Both failures return `undefined` so the launcher exits 1 without
 * building the game.
 */
export async function runModelManager(
  io: LauncherIo,
  models: ModelsConfig,
): Promise<StartupResult | undefined> {
  const start = io.startModelManager ?? startModelManager;
  try {
    return await start(models, {
      connect: io.connect,
      startServer: io.startServer,
    });
  } catch (error) {
    if (error instanceof ConnectionError) {
      io.err('LM Studio server unreachable');
      if (error.cause !== undefined) {
        const cause =
          error.cause instanceof Error
            ? error.cause.message
            : String(error.cause);
        io.err(cause);
      } else {
        io.err(error.message);
      }
      return undefined;
    }
    if (error instanceof StartupError) {
      for (const issue of error.result.issues) {
        io.err(issue);
      }
      return undefined;
    }
    // An unexpected error is still a refusal to start, surfaced plainly.
    io.err(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

/**
 * Launch the game (`pnpm play`): validate the configs, start the Model Manager,
 * build the game and render the App Shell. Returns the process exit status — 0
 * when the player plays and quits cleanly, 1 on any config or startup failure
 * (Req 20.2, 20.4).
 *
 * @param argv the command-line args after the script name (`--seed`, `--profile`)
 * @param io   the injected streams, file reader, SDK actions, startup and render
 */
export async function runLauncher(
  argv: readonly string[],
  io: LauncherIo,
): Promise<number> {
  const args = parseArgs(argv);

  // Steps 1–2: load and validate both configs (Req 20.2, 22.3).
  const configs = loadConfigs(io, args.profile, args.scenario ?? SCENARIO_CONFIG);
  if (!configs.ok) {
    return 1;
  }

  // Step 3: Model Manager startup — connect, preflight, load (Req 20.3, 20.4).
  const startup = await runModelManager(io, configs.models);
  if (startup === undefined) {
    return 1;
  }

  // Partial-GPU warnings (the game still starts). Printed before the shell takes
  // over the terminal so they are visible in the scrollback.
  for (const warning of startup.load.warnings) {
    io.err(warning);
  }

  // Step 4: build the game over the live Gateway and render the App Shell with
  // the seed default (Req 20.5, 20.6).
  const game = createGame({
    repoRoot: io.repoRoot,
    scenario: configs.scenario,
    models: configs.models,
    gateway: 'live',
  });

  const defaults: AppShellDefaults =
    args.seed !== undefined ? { seed: args.seed } : {};
  const render = io.render ?? renderAppShell;
  const handle = render(game.api, defaults);
  await handle.waitUntilExit();
  await game.close();

  return 0;
}

/**
 * The production render: mount the {@link AppShell} with Ink's `render` on the
 * real terminal and return a {@link RenderHandle} over its `waitUntilExit`. This
 * is the single place `ink` and `react` are used, so the Fake-Seams tests never
 * touch a TTY: they inject their own `render` through {@link LauncherIo.render}.
 */
export function renderAppShell(
  api: EngineApi,
  defaults: AppShellDefaults,
): RenderHandle {
  const instance = inkRender(createElement(AppShell, { api, defaults }));
  return { waitUntilExit: () => instance.waitUntilExit() };
}
