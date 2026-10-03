/**
 * `pnpm evals [--profile <name>]` — the testable orchestration (slice-integration
 * task 17.2; design, "Evals on the Composition Root"; Req 18.5, 22.4, 25.1,
 * 25.2, 25.3).
 *
 * This is the logic behind the `scripts/evals.ts` CLI, factored out so it runs
 * offline in a unit test (task 17.4). It does exactly what the task names:
 *
 *   - **With `--profile <name>`** it runs the one named profile. It starts the
 *     Model Manager for that profile ({@link startModelManager} — connect,
 *     preflight, load the active profile), runs the five fixtures through
 *     {@link createGame} with the Live Seams over the live Gateway, scores each
 *     `voice`/`narrator` output with the judge, and writes the Markdown and CSV
 *     reports — each carrying the judge identity and the same-as-voice warning
 *     (Req 25.1, 25.2, 25.3).
 *   - **With no `--profile`** it runs every profile. It starts the Model Manager
 *     for the first, and before each subsequent profile it calls
 *     `unloadProfile(prev)` then `loadProfile(next)` so only one profile's models
 *     are resident at a time (Req 25.3), then compares the profiles side by side
 *     in one report.
 *
 * ## The model management lives in the gateway factory
 *
 * {@link runEvalHarness} iterates the profiles and calls the gateway factory
 * once per profile, in {@link profilesToRun} order, right before that profile's
 * fixtures run — exactly the point a live driver loads/unloads models. So the
 * factory this module hands the harness is where the Model Manager is driven:
 * the first profile runs the full `startModelManager`; each later profile
 * unloads the previous one and loads the next, reusing the connected client.
 * This keeps the "unload before load" ordering (Req 25.3) a direct consequence
 * of the harness's per-profile call, with no separate pass over the profiles.
 *
 * ## Offline-testable seams
 *
 * Everything that touches the outside world is injected through
 * {@link RunEvalsIo}: the connect/startServer SDK actions, the
 * {@link startModelManager}/{@link loadProfile}/{@link unloadProfile} functions
 * (so a test substitutes fakes that record the load/unload order and reach no
 * server), the {@link GatewayFactory} seam that builds each profile's Gateway
 * (a fake in tests), the {@link ScenePlayer} that voices the scenes (the real
 * one over `createGame` in production, a scripted fake in tests), the
 * {@link JudgeScorer}, and the report writer. The default wiring in
 * {@link scripts/evals.ts} fills them with the real SDK actions, the live
 * Gateway + {@link createGameScenePlayer}, the gateway judge scorer and an fs
 * writer.
 */

import {
  InMemoryMetricsSink,
  OpenAIGateway,
  activeProfile,
  loadProfile as realLoadProfile,
  startModelManager as realStartModelManager,
  unloadProfile as realUnloadProfile,
  type ConnectAction,
  type Gateway,
  type LmStudioClient,
  type MetricsRecord,
  type ModelsConfig,
  type Profile,
  type StartServerAction,
} from '@tradecraft/llm';
import type { ScenarioConfig } from '@tradecraft/engine';

import { gatewayJudgeScorer, type JudgeScorer } from '../judge/judge.js';
import {
  renderCsvReport,
  renderMarkdownReport,
  type EvalComparison,
} from './report.js';
import {
  profilesToRun,
  runEvalHarness,
  withActiveProfile,
  type GatewayFactory,
  type ScenePlayer,
} from './harness.js';
import {
  createGameScenePlayer,
  type TimingReader,
} from './scene-player.js';
import type { DifficultyPresetId } from '../replays/fixtures.js';

/**
 * The injected startup function — {@link startModelManager}'s shape. A test
 * substitutes a fake that resolves with a fake client and records the call.
 */
export type StartModelManager = typeof realStartModelManager;
/** The injected per-profile load — {@link loadProfile}'s shape. */
export type LoadProfile = typeof realLoadProfile;
/** The injected per-profile unload — {@link unloadProfile}'s shape. */
export type UnloadProfile = typeof realUnloadProfile;

/** Writes one rendered report under a name (`eval-report.md`, `eval-report.csv`). */
export type ReportWriter = (name: string, contents: string) => void;

/** The two report file names the CLI writes. */
export const REPORT_MARKDOWN = 'eval-report.md';
export const REPORT_CSV = 'eval-report.csv';

/**
 * Everything {@link runEvals} touches outside its own logic, injected so the run
 * is testable offline. Production (`scripts/evals.ts`) fills these with the real
 * SDK actions, the real Model Manager functions, the live-Gateway factory + the
 * `createGame` scene player, the gateway judge scorer and an fs writer; a test
 * fills them with fakes that reach no server and record the load/unload order.
 */
export interface RunEvalsIo {
  /** Write a line to standard output. */
  readonly out: (line: string) => void;
  /** Write a line to standard error. */
  readonly err: (line: string) => void;
  /** The repository root the scenario's pack directories resolve against. */
  readonly repoRoot: string;
  /** The scenario the fixtures' worlds are generated under. */
  readonly scenario: ScenarioConfig;
  /** The validated models config (every profile and the endpoint). */
  readonly models: ModelsConfig;
  /** The difficulty preset `newGame` resolves each fixture's world under. */
  readonly preset: DifficultyPresetId;
  /** Attempt a single LM Studio connection (injected SDK action). */
  readonly connect: ConnectAction;
  /** Start the LM Studio server (`lms server start`, injected SDK action). */
  readonly startServer: StartServerAction;
  /** The Model Manager startup. Defaults to the real {@link startModelManager}. */
  readonly startModelManager?: StartModelManager;
  /** Make a profile's models resident. Defaults to the real {@link loadProfile}. */
  readonly loadProfile?: LoadProfile;
  /** Tear a profile's models down. Defaults to the real {@link unloadProfile}. */
  readonly unloadProfile?: UnloadProfile;
  /**
   * Build the Gateway for a profile's active config. Defaults to a live
   * {@link OpenAIGateway} over an in-memory metrics sink (so per-call timing is
   * read back into the metrics). A test passes a fake Gateway factory.
   */
  readonly gatewayFactory?: GatewayFactory;
  /**
   * Drives each profile's fixtures. Defaults to {@link createGameScenePlayer}
   * over `createGame`. A test passes a scripted fake.
   */
  readonly scenePlayer?: ScenePlayer;
  /**
   * The judge scorer every output is scored through. Defaults to the gateway
   * judge scorer built over each profile's Gateway (so the judge model is
   * reached through the same endpoint). A test passes a canned scorer.
   */
  readonly scorer?: JudgeScorer;
  /** Writes a rendered report under a file name. Defaults to an fs writer in the CLI. */
  readonly writeReport: ReportWriter;
}

/** Options parsed from the command line. */
export interface RunEvalsOptions {
  /** The one profile to run, or every profile when omitted (Req 25.1). */
  readonly profile?: string;
}

/**
 * Run the eval harness over one profile or all of them, write the Markdown and
 * CSV reports, and return the process exit status (0 on success, 1 on a bad
 * `--profile` or a startup failure).
 *
 * The Model Manager is driven inside the gateway factory the harness calls per
 * profile: the first profile runs {@link startModelManager}, each later profile
 * unloads the previous and loads the next (Req 25.3). The judge scorer is built
 * per profile over that profile's Gateway unless the caller injects one.
 */
export async function runEvals(
  io: RunEvalsIo,
  options: RunEvalsOptions,
): Promise<number> {
  // Which profiles to run: the one named, or every profile in sorted order.
  const all = profilesToRun(io.models);
  if (options.profile !== undefined && !all.includes(options.profile)) {
    io.err(
      `error: --profile "${options.profile}" is not a defined profile ` +
        `(have: ${all.join(', ')})`,
    );
    return 1;
  }
  const profileNames =
    options.profile !== undefined ? [options.profile] : all;

  // A config whose `profiles` map is restricted to the ones we run, so
  // `runEvalHarness` (which iterates every profile in the config) runs exactly
  // the selected set in sorted order.
  const runConfig = restrictProfiles(io.models, profileNames);

  const start = io.startModelManager ?? realStartModelManager;
  const load = io.loadProfile ?? realLoadProfile;
  const unload = io.unloadProfile ?? realUnloadProfile;

  // Per-profile metrics sinks, so the default live Gateway factory records each
  // profile's per-call timings for the scene player to fold into the metrics.
  const metricsByProfile = new Map<string, InMemoryMetricsSink>();
  const timing: TimingReader = (config): readonly MetricsRecord[] =>
    metricsByProfile.get(config.active)?.records ?? [];

  // The connected client is captured by the first profile's startup and reused
  // for every unload/load that follows, and the previous profile is tracked so
  // the factory unloads it before loading the next (Req 25.3).
  const manager: { client?: LmStudioClient; previous?: Profile } = {};
  let startupFailed = false;
  let startupError = '';

  const baseFactory: GatewayFactory =
    io.gatewayFactory ??
    ((config): Gateway => {
      const sink = new InMemoryMetricsSink();
      metricsByProfile.set(config.active, sink);
      return new OpenAIGateway(config, { metrics: sink });
    });

  // The Gateway the harness last built, for the profile currently running. The
  // default judge scorer scores through it (the harness scores within one active
  // profile at a time, so the last-built Gateway is always the right one).
  let currentGateway: Gateway | undefined;

  // The factory only builds and tracks the Gateway; the Model Manager is driven
  // in the wrapped scene player below, which the harness awaits, so load/unload
  // completes before the profile's scenes run.
  const trackingFactory: GatewayFactory = (config): Gateway => {
    currentGateway = baseFactory(config);
    return currentGateway;
  };

  async function manageModels(config: ModelsConfig): Promise<void> {
    try {
      const next = activeProfile(config);
      if (manager.client === undefined) {
        // First profile: connect, preflight, load (Req 22.4 — context length
        // read from config by the Model Manager).
        const result = await start(config, {
          connect: io.connect,
          startServer: io.startServer,
        });
        manager.client = result.client;
        for (const warning of result.load.warnings) {
          io.err(warning);
        }
      } else {
        // A later profile: unload the previous, then load the next (Req 25.3).
        if (manager.previous !== undefined) {
          await unload(manager.previous, manager.client);
        }
        const loaded = await load(next, config.models, manager.client, {
          contextLength: config.contextLength,
        });
        for (const warning of loaded.warnings) {
          io.err(warning);
        }
      }
      manager.previous = next;
    } catch (error) {
      startupFailed = true;
      startupError = error instanceof Error ? error.message : String(error);
    }
  }

  const basePlayer: ScenePlayer =
    io.scenePlayer ??
    createGameScenePlayer({
      repoRoot: io.repoRoot,
      scenario: io.scenario,
      preset: io.preset,
      timing,
    });

  // Drive the Model Manager before each profile's scenes, so the first profile
  // is started and each later profile is unloaded-then-loaded (Req 25.3) before
  // the fixtures voice through its Gateway. A startup failure is latched and the
  // profile's scenes are skipped; the run returns 1 after the harness finishes.
  const scenePlayer: ScenePlayer = async (args) => {
    if (startupFailed) {
      return [];
    }
    await manageModels(args.config);
    if (startupFailed) {
      return [];
    }
    return basePlayer(args);
  };

  // The scorer: the caller's, or the gateway judge scorer over the Gateway the
  // factory built for the active profile. The harness scores within one active
  // profile at a time, so `currentGateway` is always that profile's.
  const scorer: JudgeScorer =
    io.scorer ??
    ((rubric, input) => {
      if (currentGateway === undefined) {
        throw new Error('judge scorer called before a profile Gateway was built');
      }
      return gatewayJudgeScorer(currentGateway)(rubric, input);
    });

  const comparison = await runEvalHarness(runConfig, {
    gatewayFactory: trackingFactory,
    scenePlayer,
    scorer,
  });

  if (startupFailed) {
    io.err(`error: the Model Manager failed to start: ${startupError}`);
    return 1;
  }

  writeReports(io, comparison);
  return 0;
}

/** Render the two reports and write them, logging where they went. */
function writeReports(io: RunEvalsIo, comparison: EvalComparison): void {
  const markdown = renderMarkdownReport(comparison);
  const csv = renderCsvReport(comparison);
  io.writeReport(REPORT_MARKDOWN, markdown);
  io.writeReport(REPORT_CSV, csv);

  // Surface the judge identity and the same-as-voice warning on stdout too, so a
  // run that only prints to the terminal still states who judged (Req 25.2).
  for (const profile of comparison.profiles) {
    io.out(
      `profile "${profile.profile}" judged by "${profile.judge.model}" ` +
        `(active profile "${profile.judge.profile}")`,
    );
    if (profile.warning !== null) {
      io.err(`warning: ${profile.warning}`);
    }
  }
  io.out(`wrote ${REPORT_MARKDOWN} and ${REPORT_CSV}`);
}

/**
 * A copy of `config` whose `profiles` map holds only `names`, so
 * {@link runEvalHarness} (which runs every profile in the config) runs exactly
 * the selected set. `active` is set to the first selected profile so the config
 * is valid (its `active` names a defined profile). The `models` map is shared
 * unchanged — it is read-only data every profile resolves its Load Identifiers
 * against.
 */
function restrictProfiles(
  config: ModelsConfig,
  names: readonly string[],
): ModelsConfig {
  const profiles: Record<string, Profile> = {};
  for (const name of names) {
    profiles[name] = config.profiles[name];
  }
  const active = names.includes(config.active) ? config.active : names[0];
  return { ...config, active, profiles };
}

/** Re-exported so the CLI (and the harness order helper) can name profiles. */
export { profilesToRun, withActiveProfile };
