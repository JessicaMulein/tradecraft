/**
 * The eval harness orchestration (task 23.4; Req 18.4).
 *
 * Req 18.4: "run the fixtures through both profiles from `models.yaml` and
 * produce a Markdown and a CSV comparison report". {@link runEvalHarness} is the
 * entry point that does the first half — iterate the profiles a
 * {@link ModelsConfig} defines, run the fixtures through each, and collect a
 * {@link ProfileEvalResult} per profile into an {@link EvalComparison} the
 * renderers turn into reports.
 *
 * ## Running "both profiles from models.yaml"
 *
 * A `models.yaml` holds several named profiles and one `active`. "Run both
 * profiles" means: for each profile in `config.profiles`, build a config whose
 * `active` is set to that profile (so the judge identity, the model ids and the
 * same-as-voice check all read that profile's line-up), run the fixtures under
 * it, and compare. {@link runEvalHarness} iterates `Object.keys(config.profiles)`
 * in sorted order — a stable, config-independent order so a comparison does not
 * depend on YAML key order — and switches the active profile per run with
 * {@link withActiveProfile}. It never mutates the input config; each run gets
 * its own shallow copy with a different `active`.
 *
 * ## Offline injection (no live model)
 *
 * The harness never calls a model itself. Two seams are injected so a run is
 * offline and deterministic:
 *
 *   - a **gateway factory** — `(config) => Gateway`. Production passes a factory
 *     that builds the live gateway (or a {@link ReplayGateway} over a recording)
 *     for the active profile; a test passes a factory that returns a fake
 *     gateway. The factory is called once per profile with that profile's active
 *     config, which is also where a live driver would load/unload the profile's
 *     models (task 25.3's `loadProfile`).
 *   - a **scene runner** — `ScenePlayer`. This is the thing that actually drives
 *     a fixture's scene against the profile's gateway: it stages the fixture
 *     setup (through the pure engine, via {@link runFixtureSetup}), voices each
 *     `say` line through the Dialogue Loop / Narrator, feeds the guard and timing
 *     outcomes to a {@link MetricsCollector}, and scores each output with the
 *     injected judge scorer. The harness does not know *how* a scene is voiced —
 *     that lives in the player-facing layers a live driver wires up — so the
 *     scene runner is a parameter. In tests it is a fake that returns scripted
 *     outcomes and canned judge results; it never touches a live endpoint.
 *
 * This split keeps `@tradecraft/evals` within its dependency boundary (it does
 * not depend on `@tradecraft/dialogue`) and keeps the harness a pure
 * orchestration: given a config, a gateway factory, a scene runner and a judge
 * scorer, it produces the same comparison every time.
 */

import type { Gateway, ModelsConfig } from '@tradecraft/llm';

import {
  loadEvalFixtures,
  type EvalFixture,
} from '../eval-fixtures/eval-fixtures.js';
import {
  MetricsCollector,
  type MechanicalMetrics,
} from '../metrics/mechanical-metrics.js';
import { judgeIdentity, sameAsVoiceWarning, type JudgeScorer } from '../judge/judge.js';

import type {
  EvalComparison,
  ProfileEvalResult,
  ScenarioJudgeScore,
} from './report.js';

// ---------------------------------------------------------------------------
// The injected seams
// ---------------------------------------------------------------------------

/**
 * Builds the {@link Gateway} a profile's run voices its scenes through. Called
 * once per profile with the config whose `active` is that profile, so the
 * factory can read the active profile's model ids (and, in a live driver,
 * load/unload the profile's resident models before building the gateway).
 * Production returns the live gateway or a {@link ReplayGateway}; a test returns
 * a fake gateway.
 */
export type GatewayFactory = (config: ModelsConfig) => Gateway;

/**
 * What a scene run produces for one profile: the aggregated mechanical metrics
 * and the per-scenario/per-role judge scores. The scene runner owns driving the
 * fixtures' scenes against the gateway and scoring their outputs; it hands the
 * harness these two results, which are exactly what a {@link ProfileEvalResult}
 * carries (alongside the identity/warning the harness reads from the config).
 */
export interface ProfileRunOutput {
  /** The mechanical metrics aggregated over the profile's fixture run. */
  readonly metrics: MechanicalMetrics;
  /** The judge scores, one per scored output. */
  readonly judgeScores: readonly ScenarioJudgeScore[];
}

/**
 * Drives a profile's fixtures to produce its {@link ProfileRunOutput}. This is
 * the model-facing seam: it stages each fixture (via `runFixtureSetup`), voices
 * its `say` steps through the Dialogue Loop / Narrator over the given `gateway`,
 * collects guard and timing outcomes into a {@link MetricsCollector}, and scores
 * each output with the injected `scorer`. Production wires this to the real
 * player-facing layers; a test passes a fake that returns scripted outcomes and
 * canned judge results. It is `async` because voicing a scene is inherently
 * async (the gateway streams), even though an offline fake can resolve
 * immediately.
 *
 * The `collector` is passed in (rather than created inside) so a caller can
 * share one timing clock across the run and so the harness owns the collector's
 * lifecycle; the runner records into it and the harness reads its
 * {@link MetricsCollector.snapshot}.
 */
export type ScenePlayer = (args: {
  /** The profile being run, with its `active` set and config applied. */
  readonly config: ModelsConfig;
  /** The gateway built for this profile by the {@link GatewayFactory}. */
  readonly gateway: Gateway;
  /** The fixtures to run, in order. */
  readonly fixtures: readonly EvalFixture[];
  /** The judge scorer every output is scored through. */
  readonly scorer: JudgeScorer;
  /** The collector the runner records guard/timing outcomes into. */
  readonly collector: MetricsCollector;
}) => Promise<readonly ScenarioJudgeScore[]>;

/** Options for {@link runEvalHarness}. */
export interface RunHarnessOptions {
  /** Builds the gateway for each profile's active config. */
  readonly gatewayFactory: GatewayFactory;
  /** Drives each profile's fixtures and scores their outputs. */
  readonly scenePlayer: ScenePlayer;
  /** The judge scorer passed to the scene runner (offline/canned in tests). */
  readonly scorer: JudgeScorer;
  /**
   * The fixtures to run. Defaults to the five required fixtures
   * ({@link loadEvalFixtures}). A test may pass a smaller set.
   */
  readonly fixtures?: readonly EvalFixture[];
}

// ---------------------------------------------------------------------------
// Switching the active profile
// ---------------------------------------------------------------------------

/**
 * A copy of `config` with `active` set to `profile`, without mutating the input.
 * Throws when `profile` is not a defined profile — the harness only ever passes
 * a key it drew from `config.profiles`, so a throw here is a programming error,
 * not a config-file condition. The copy is shallow: the `profiles` map is
 * shared (it is read-only data), only `active` changes.
 */
export function withActiveProfile(
  config: ModelsConfig,
  profile: string,
): ModelsConfig {
  if (!Object.hasOwn(config.profiles, profile)) {
    throw new Error(`no such profile "${profile}" in config`);
  }
  return { ...config, active: profile };
}

/**
 * The profile names to run, in a stable order independent of the YAML key order
 * (sorted). "Run both profiles" is literally every profile the config defines;
 * sorting keeps the comparison's column order reproducible.
 */
export function profilesToRun(config: ModelsConfig): readonly string[] {
  return Object.keys(config.profiles).sort();
}

// ---------------------------------------------------------------------------
// The orchestration
// ---------------------------------------------------------------------------

/**
 * Run the fixtures through every profile in `config` and build the
 * {@link EvalComparison} the renderers turn into Markdown and CSV (Req 18.4).
 *
 * For each profile (in {@link profilesToRun} order): set it active with
 * {@link withActiveProfile}, build its gateway with the injected factory, run the
 * fixtures through the injected {@link ScenePlayer} with a fresh
 * {@link MetricsCollector} and the injected judge scorer, and assemble a
 * {@link ProfileEvalResult} from the collector's snapshot, the scored outputs,
 * and the judge identity + same-as-voice warning read from that profile's active
 * config. The judge identity and warning are read here (not from the scene
 * runner) so they always reflect the config, even if a run scored nothing.
 *
 * The function is deterministic in its inputs: with a fake gateway factory, a
 * scripted scene runner and a canned scorer it produces the same comparison
 * every call, and it makes no network call of its own — every model touch is
 * behind the injected seams.
 */
export async function runEvalHarness(
  config: ModelsConfig,
  options: RunHarnessOptions,
): Promise<EvalComparison> {
  const fixtures = options.fixtures ?? loadEvalFixtures();
  const results: ProfileEvalResult[] = [];

  for (const profileName of profilesToRun(config)) {
    const activeConfig = withActiveProfile(config, profileName);
    const gateway = options.gatewayFactory(activeConfig);
    const collector = new MetricsCollector();

    const judgeScores = await options.scenePlayer({
      config: activeConfig,
      gateway,
      fixtures,
      scorer: options.scorer,
      collector,
    });

    results.push(
      buildProfileResult(profileName, activeConfig, collector, judgeScores),
    );
  }

  return { profiles: results, fixtures };
}

/**
 * Assemble one {@link ProfileEvalResult} from a completed run. The judge
 * identity and the same-as-voice warning are read from the active config so they
 * are always present and consistent with the line-up, independent of what the
 * scene runner scored. The metrics come from the collector's snapshot (a pure
 * fold over what the runner recorded).
 */
function buildProfileResult(
  profileName: string,
  activeConfig: ModelsConfig,
  collector: MetricsCollector,
  judgeScores: readonly ScenarioJudgeScore[],
): ProfileEvalResult {
  return {
    profile: profileName,
    judge: judgeIdentity(activeConfig),
    metrics: collector.snapshot(),
    judgeScores,
    warning: sameAsVoiceWarning(activeConfig),
  };
}
