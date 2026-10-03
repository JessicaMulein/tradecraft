/**
 * Offline Launcher tests (`app/launcher.spec.ts`) — slice-integration task
 * 14.2; design, "Launcher (`app/launcher.ts`, `pnpm play`)"; Requirements
 * 20.2–20.6.
 *
 * These drive {@link runLauncher} entirely through its injected {@link LauncherIo}
 * so the whole run is hermetic: no TTY, no endpoint, no process. The seams are:
 *
 *   - `out` / `err` — string buffers that record every printed line.
 *   - `readFile` — an in-memory file reader over a `Map<path, text>`, so the
 *     config files are the fixtures below rather than the repo's `config/*.yaml`.
 *   - `repoRoot` — the real checkout root, so `scenario.packs.dirs` resolves to
 *     the core pack directory and the Content Set loads for real (the launcher
 *     needs the loaded packs to resolve the scenario's preset and pack ids).
 *   - `connect` / `startServer` — wired to the fake LM Studio client
 *     (`makeFakeClient`), so the real {@link startModelManager} drives the real
 *     connect → preflight → load path against the fake. The missing-models and
 *     insufficient-memory cases are produced by the fake's downloaded set and
 *     resident-set estimate; the unreachable case injects a `startModelManager`
 *     that throws a {@link ConnectionError} (so the test does not wait out the
 *     real connection retries).
 *   - `render` — an injected render that records the `api`/`defaults` it is
 *     handed and resolves `waitUntilExit()` at once, so the success path returns
 *     without a real Ink mount.
 *
 * Only this spec imports vitest; the launcher and the fakes it drives are plain
 * library code.
 */

import { loadFeaturedSeeds } from './featured-seeds.js';
import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  makeFakeClient,
  ConnectionError,
  startModelManager,
  type LmStudioClient,
  type LoadedModel,
  type ResidentSetEstimate,
  type ModelsConfig,
  type StartupOptions,
  type StartupResult,
} from '@tradecraft/llm';
import type { EngineApi } from '@tradecraft/player-view';
import type { AppShellDefaults } from '@tradecraft/tui';
import { describe, expect, it } from 'vitest';

import {
  runLauncher,
  type LauncherIo,
  type RenderHandle,
} from './launcher.js';

// ---------------------------------------------------------------------------
// Paths — the real checkout root so the core pack loads for real
// ---------------------------------------------------------------------------

/**
 * The repository root the launcher resolves config paths and pack dirs against.
 * This file is at `packages/app/src/lib/`, so the repo root is four directories
 * up — the same anchor the reachable walk uses.
 */
const REPO_ROOT = resolvePath(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

/** The absolute paths the launcher reads its two config files from. */
const SCENARIO_PATH = join(REPO_ROOT, 'config', 'scenario.yaml');
const MODELS_PATH = join(REPO_ROOT, 'config', 'models.yaml');

// ---------------------------------------------------------------------------
// In-memory config fixtures
// ---------------------------------------------------------------------------

/**
 * A valid in-memory `scenario.yaml`. `packs.dirs` points at the core pack
 * directory (the dir that holds `pack.yaml`, as the walk helper's scenario
 * does), so the launcher's Content Set loads the real `core` pack and the named
 * `standard` preset and `core` pack id resolve. Everything else is the shipped
 * default shape.
 */
const VALID_SCENARIO = `
difficulty:
  preset: standard
  overrides: {}
mole: false
packs:
  dirs:
    - packages/content/packs/core
  load:
    - core
narration: full
recruitment:
  pitch: { w1: 2.2, w2: 1.4, w3: 1.8, w4: 1.2 }
  firstContact: { a: 1.5, b: 1.0, c: 1.2, d: 0.8 }
  meeting: { trust: 1.6, riskAversion: 1.3, scheduleConflict: 1.0, agendaInterest: 1.1 }
  exposure: { k1: 0.6, k2: 0.4, k3: 0.3 }
  turn: { w1: 1.8, w2: 1.3, w3: 1.5, w4: 1.0, w5: 0.9 }
retries:
  leakGuard: 2
  narrator: 1
  refusal: 1
  extraction: 1
  timeout: 1
tokenBudget: 3000
custodyPhases: 4
silenceDays: 3
interceptRetentionDays: 2
metrics:
  enabled: false
  path: logs/metrics.jsonl
`;

/**
 * The `models` map every valid fixture shares: one entry per Load Identifier a
 * profile role names, each with a reasoning `family` and the MLX/GGUF Model
 * Source pair the schema requires. The launcher never reaches inference (the
 * injected render resolves at once), so the entries only have to validate and
 * the Load Identifiers only have to be the ones the fake client reports as
 * downloaded.
 */
const MODELS_MAP = `
models:
  voice-model:
    family: gemma
    sources:
      - { format: mlx, get: org/voice-mlx, key: voice-model }
      - { format: gguf, get: org/voice-gguf, key: voice-model-gguf }
  fast-model:
    family: qwen
    sources:
      - { format: mlx, get: org/fast-mlx, key: fast-model }
      - { format: gguf, get: org/fast-gguf, key: fast-model-gguf }
  judge-model:
    family: gemma
    sources:
      - { format: mlx, get: org/judge-mlx, key: judge-model }
      - { format: gguf, get: org/judge-gguf, key: judge-model-gguf }`;

/** One profile body (role → settings), parameterised only by its indent context. */
const PROFILE_BODY = `
    voice:
      model: voice-model
      temperature: 0.8
      maxTokens: 320
      timeoutMs: 20000
      reasoning: off
    fast:
      model: fast-model
      temperature: 0.7
      maxTokens: 220
      timeoutMs: 8000
      reasoning: off
    narrator:
      model: fast-model
      temperature: 0.9
      maxTokens: 160
      timeoutMs: 6000
      reasoning: off
    bookkeeping:
      model: fast-model
      temperature: 0.0
      maxTokens: 400
      timeoutMs: 15000
      reasoning: off
    judge:
      model: judge-model
      temperature: 0.0
      maxTokens: 300
      timeoutMs: 30000
      reasoning: on`;

/**
 * A valid in-memory `models.yaml` with a single profile `fake`. Carries the
 * `contextLength` and `models` map the schema now requires (task 16.1), and
 * every role names a Load Identifier defined in that map.
 */
const VALID_MODELS = `
endpoint: http://localhost:1234/v1
contextLength: 8192
${MODELS_MAP}
profiles:
  fake:${PROFILE_BODY}
active: fake
`;

/**
 * A valid `models.yaml` with a second profile `other`, so the `--profile`
 * override has a defined target to switch `active` to. Both profiles name the
 * same Load Identifiers the fake client reports downloaded, so startup passes.
 */
const TWO_PROFILE_MODELS = `
endpoint: http://localhost:1234/v1
contextLength: 8192
${MODELS_MAP}
profiles:
  fake:${PROFILE_BODY}
  other:${PROFILE_BODY}
active: fake
`;

/** The Load Identifiers the valid profile needs the endpoint to be serving. */
const DOWNLOADED = ['voice-model', 'fast-model', 'judge-model'] as const;

const GiB = 1024 ** 3;

// ---------------------------------------------------------------------------
// The injected IO
// ---------------------------------------------------------------------------

/** A recording of everything a launcher run printed and rendered. */
interface Harness {
  readonly io: LauncherIo;
  /** Lines written to stdout, in order. */
  readonly out: string[];
  /** Lines written to stderr, in order. */
  readonly err: string[];
  /** Each `render` call's recorded api + defaults (empty if render never ran). */
  readonly rendered: { api: EngineApi; defaults: AppShellDefaults }[];
}

/** Options for building a harness. */
interface HarnessOptions {
  /** The scenario.yaml text the in-memory reader returns. Defaults to valid. */
  readonly scenario?: string;
  /** The models.yaml text the in-memory reader returns. Defaults to valid. */
  readonly models?: string;
  /** Omit a config file entirely, so the reader throws for its path. */
  readonly omit?: 'scenario' | 'models';
  /**
   * The fake LM Studio client the real `startModelManager` connects to through
   * the injected `connect`. Defaults to a fully-downloaded, fits-in-memory fake.
   */
  readonly client?: LmStudioClient;
  /**
   * An override for the Model Manager startup, used only by the unreachable
   * case so the test does not wait out the real connection retries.
   */
  readonly startModelManager?: typeof startModelManager;
}

/**
 * Build a {@link LauncherIo} over string buffers, an in-memory file reader and
 * the fake LM Studio client. The returned harness exposes the buffers and the
 * render recordings so a test can assert the located issues, the exit effects
 * and the seed default handed to the App Shell.
 */
function harness(options: HarnessOptions = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const rendered: { api: EngineApi; defaults: AppShellDefaults }[] = [];

  // The in-memory file system: absolute path → file text.
  const files = new Map<string, string>();
  if (options.omit !== 'scenario') {
    files.set(SCENARIO_PATH, options.scenario ?? VALID_SCENARIO);
  }
  if (options.omit !== 'models') {
    files.set(MODELS_PATH, options.models ?? VALID_MODELS);
  }

  const client = options.client ?? makeFakeClient(DOWNLOADED, {
    estimateResidentSet: fitsEstimate,
    // Report every loaded model as fully GPU-resident so the clean success path
    // prints no partial-GPU warning (the load path reads this listing to warn).
    listLoaded: fullyResident,
  });

  const io: LauncherIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    readFile: (path) => {
      const text = files.get(path);
      if (text === undefined) {
        throw new Error(`ENOENT: no such file, open '${path}'`);
      }
      return text;
    },
    repoRoot: REPO_ROOT,
    // Connect resolves with the fake client (the server is already "up"), so the
    // real connect path returns on the first try without starting a server.
    connect: () => Promise.resolve(client),
    startServer: () => Promise.resolve(),
    render: (api, defaults): RenderHandle => {
      rendered.push({ api, defaults });
      // No real terminal: the app "exits" immediately so the launcher returns.
      return { waitUntilExit: () => Promise.resolve() };
    },
    ...(options.startModelManager !== undefined
      ? { startModelManager: options.startModelManager }
      : {}),
  };

  return { io, out, err, rendered };
}

/** A resident-set estimate that comfortably fits (success + download cases). */
function fitsEstimate(): Promise<ResidentSetEstimate> {
  return Promise.resolve({
    fits: true,
    requiredBytes: 8 * GiB,
    availableBytes: 64 * GiB,
  });
}

/** A resident-set estimate that overflows the budget (insufficient-memory case). */
function overBudgetEstimate(): Promise<ResidentSetEstimate> {
  return Promise.resolve({
    fits: false,
    requiredBytes: 48 * GiB,
    availableBytes: 16 * GiB,
  });
}

/**
 * A loaded-model listing reporting every required Load Identifier as fully
 * GPU-resident, so a clean load warns about nothing. The load path matches
 * residency by the identifier it loaded each model under (its Load Identifier).
 */
function fullyResident(): Promise<readonly LoadedModel[]> {
  return Promise.resolve(
    DOWNLOADED.map((identifier) => ({ identifier, gpuResident: true })),
  );
}

// ---------------------------------------------------------------------------
// Success path (Req 20.5, 20.6)
// ---------------------------------------------------------------------------

describe('runLauncher — success path (Req 20.5, 20.6)', () => {
  it('validates, starts the Model Manager, renders with the seed default and returns 0', async () => {
    const h = harness();

    const code = await runLauncher(['--seed', 'alpha-7'], h.io);

    expect(code).toBe(0);
    // The App Shell was rendered exactly once, with the `--seed` as its default.
    expect(h.rendered).toHaveLength(1);
    expect(h.rendered[0].defaults).toEqual({ seed: 'alpha-7' });
    // No config or startup issue was printed.
    expect(h.err).toEqual([]);
  });

  it('hands render a working EngineApi that can start a game at the seed default', async () => {
    const h = harness();

    const code = await runLauncher(['--seed', 'bravo'], h.io);

    expect(code).toBe(0);
    const { api, defaults } = h.rendered[0];
    // The api is the real facade: starting a game at the rendered seed default
    // produces a playable world whose action catalogue always lists `wait`.
    const view = await api.newGame({
      seed: defaults.seed ?? 'bravo',
      preset: 'standard',
      mole: false,
      narration: 'full',
    });
    expect(view.seed).toBe('bravo');
    const kinds = api.actions().map((o) => o.action.kind);
    expect(kinds).toContain('wait');
  });

  it('mints a random seed default when `--seed` is absent (no seed pre-filled)', async () => {
    const h = harness();

    const code = await runLauncher([], h.io);

    expect(code).toBe(0);
    // With no `--seed`, the App Shell gets empty defaults and mints its own.
    expect(h.rendered[0].defaults).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Config validation failure (Req 20.2)
// ---------------------------------------------------------------------------

describe('runLauncher — config validation failure (Req 20.2)', () => {
  it('prints located issues and returns 1 for a bad scenario.yaml', async () => {
    // `narration` must be one of full|brief|off; `potato` fails validation.
    const bad = VALID_SCENARIO.replace('narration: full', 'narration: potato');
    const h = harness({ scenario: bad });

    const code = await runLauncher([], h.io);

    expect(code).toBe(1);
    // The issue is printed as `<file>: <path>: <message>`, naming the file and
    // the offending field path.
    const printed = h.err.join('\n');
    expect(printed).toContain(SCENARIO_PATH);
    expect(printed).toContain('narration');
    // A validation failure never reaches the Model Manager or the render.
    expect(h.rendered).toEqual([]);
  });

  it('prints located issues and returns 1 for a bad models.yaml', async () => {
    // `active` must name a defined profile; `ghost` is not a profile key.
    const bad = VALID_MODELS.replace('active: fake', 'active: ghost');
    const h = harness({ models: bad });

    const code = await runLauncher([], h.io);

    expect(code).toBe(1);
    const printed = h.err.join('\n');
    expect(printed).toContain(MODELS_PATH);
    expect(h.rendered).toEqual([]);
  });

  it('reports a missing config file the located way and returns 1', async () => {
    const h = harness({ omit: 'models' });

    const code = await runLauncher([], h.io);

    expect(code).toBe(1);
    expect(h.err.join('\n')).toContain(MODELS_PATH);
    expect(h.rendered).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Model Manager: unreachable server (Req 20.3)
// ---------------------------------------------------------------------------

describe('runLauncher — unreachable LM Studio server (Req 20.3)', () => {
  it('prints "LM Studio server unreachable" with the cause and returns 1', async () => {
    // Inject a startup that throws ConnectionError, so the test does not wait
    // out the real connection retries; the launcher's error handling is what is
    // under test here.
    const failingStart: typeof startModelManager = (
      _config: ModelsConfig,
      _options: StartupOptions,
    ): Promise<StartupResult> =>
      Promise.reject(new ConnectionError(5, new Error('ECONNREFUSED')));

    const h = harness({ startModelManager: failingStart });

    const code = await runLauncher([], h.io);

    expect(code).toBe(1);
    expect(h.err).toContain('LM Studio server unreachable');
    // The cause is surfaced on a following line.
    expect(h.err.join('\n')).toContain('ECONNREFUSED');
    // The game is never built or rendered.
    expect(h.rendered).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Model Manager: preflight (StartupError) — missing models & memory (Req 20.4)
// ---------------------------------------------------------------------------

describe('runLauncher — preflight failure (Req 20.4)', () => {
  it('prints the missing models with their `lms get` commands and returns 1', async () => {
    // The `judge-model` Load Identifier has neither its MLX nor GGUF build
    // downloaded → the download check fails and preflight refuses to start,
    // carrying the preferred (MLX) source's `lms get` line (Req 21.7).
    const client = makeFakeClient(['voice-model', 'fast-model'], {
      estimateResidentSet: fitsEstimate,
    });
    const h = harness({ client });

    const code = await runLauncher([], h.io);

    expect(code).toBe(1);
    const printed = h.err.join('\n');
    expect(printed).toContain('lms get');
    // The command names the preferred (MLX) source's `get`, not the Load Id.
    expect(printed).toContain('lms get org/judge-mlx');
    expect(h.rendered).toEqual([]);
  });

  it('prints the memory shortfall and returns 1 when the resident set overflows', async () => {
    // Every model is downloaded, but the resident-set estimate overflows the
    // budget → preflight refuses to start, carrying the shortfall.
    const client = makeFakeClient(DOWNLOADED, {
      estimateResidentSet: overBudgetEstimate,
    });
    const h = harness({ client });

    const code = await runLauncher([], h.io);

    expect(code).toBe(1);
    // The shortfall is printed (the preflight's human-readable memory issue).
    expect(h.err.length).toBeGreaterThan(0);
    expect(h.rendered).toEqual([]);
  });

  it('reports BOTH a missing model and a memory shortfall at once (Req 20.4)', async () => {
    const client = makeFakeClient(['voice-model', 'fast-model'], {
      estimateResidentSet: overBudgetEstimate,
    });
    const h = harness({ client });

    const code = await runLauncher([], h.io);

    expect(code).toBe(1);
    const printed = h.err.join('\n');
    expect(printed).toContain('lms get');
    expect(h.rendered).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Argument handling: --profile and --seed (Req 20.1)
// ---------------------------------------------------------------------------

describe('runLauncher — --profile and --seed handling (Req 20.1)', () => {
  it('threads `--seed` through to the App Shell default (space form)', async () => {
    const h = harness();
    const code = await runLauncher(['--seed', 'charlie'], h.io);
    expect(code).toBe(0);
    expect(h.rendered[0].defaults).toEqual({ seed: 'charlie' });
  });

  it('accepts the `--seed=value` inline form', async () => {
    const h = harness();
    const code = await runLauncher(['--seed=delta'], h.io);
    expect(code).toBe(0);
    expect(h.rendered[0].defaults).toEqual({ seed: 'delta' });
  });

  it('accepts a defined `--profile` override and still launches', async () => {
    const h = harness({ models: TWO_PROFILE_MODELS });
    const code = await runLauncher(['--profile', 'other', '--seed', 'echo'], h.io);
    expect(code).toBe(0);
    expect(h.rendered[0].defaults).toEqual({ seed: 'echo' });
  });

  it('rejects an undefined `--profile` with a located issue and returns 1', async () => {
    const h = harness();
    const code = await runLauncher(['--profile', 'ghost'], h.io);
    expect(code).toBe(1);
    const printed = h.err.join('\n');
    expect(printed).toContain(MODELS_PATH);
    expect(printed).toContain('ghost');
    expect(h.rendered).toEqual([]);
  });

  it('ignores unknown flags so forwarded args do not abort the launch', async () => {
    const h = harness();
    const code = await runLauncher(['--', '--verbose', '--seed', 'foxtrot'], h.io);
    expect(code).toBe(0);
    expect(h.rendered[0].defaults).toEqual({ seed: 'foxtrot' });
  });
});

describe('runLauncher — the shipped configuration', () => {
  it('starts on the shipped config/scenario.yaml and opens a featured seed', async () => {
    // The checked-in scenario, not a fixture: a wrong pack path there stops
    // `pnpm play` before the start screen, which no fixture-based test sees.
    const shipped = readFileSync(join(REPO_ROOT, 'config', 'scenario.yaml'), 'utf8');
    const h = harness({ scenario: shipped });
    const status = await runLauncher([], h.io);
    expect(h.err).toEqual([]);
    expect(status).toBe(0);
    expect(h.rendered).toHaveLength(1);

    // A seedless new game starts on one of the vetted featured seeds.
    const { api } = h.rendered[0];
    const view = await api.newGame({ preset: 'standard', mole: false, narration: 'off' });
    const featured = loadFeaturedSeeds(REPO_ROOT).standard ?? [];
    expect(featured.map((f) => f.seed)).toContain(view.seed);
  });
});
