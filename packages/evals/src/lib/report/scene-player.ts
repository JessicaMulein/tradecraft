/**
 * The {@link ScenePlayer} that drives the eval fixtures against a profile's
 * Gateway through the Composition Root (slice-integration task 17.2; design,
 * "Evals on the Composition Root"; Req 18.5, 25.1).
 *
 * The harness ({@link runEvalHarness}) owns iterating the profiles and
 * assembling the comparison; it does not know *how* a scene is voiced. That is
 * this module's job: given a profile's active {@link ModelsConfig} and the
 * {@link Gateway} the harness built for it, run each fixture's scene through a
 * real game assembled by `@tradecraft/app`'s {@link createGame} — the same
 * Composition Root the launcher and the REPL use — with the Live Seams built
 * over that Gateway, and score the `voice`/`narrator` output the model produces
 * with the judge.
 *
 * ## Why the scene player lives here rather than in the harness
 *
 * `@tradecraft/evals` sits above `@tradecraft/app` (which owns `createGame`),
 * but the harness in `report/harness.ts` deliberately depends on neither `app`
 * nor `dialogue` — it is a pure orchestration over injected seams so its unit
 * test runs offline with a fake scene runner. The *production* scene runner,
 * which must assemble a real game and reach the voice/narrator model, is wired
 * here and injected into the harness as the {@link ScenePlayer}. This keeps the
 * harness pure and puts the `createGame` dependency in one place the CLI drives.
 *
 * ## What one fixture run does
 *
 *   1. Build a game with {@link createGame} over the harness-supplied Gateway,
 *      so the Live Seams (classify/voice/narrate/extraction) are built over the
 *      active profile's models.
 *   2. `newGame` on the fixture's seed, then apply the fixture's leading setup
 *      `act` steps (`travel`/`wait`/`surveil`) and the scene-opening `act`
 *      (`talk`/`approach`/`confront`) through the pipeline, draining each turn
 *      stream.
 *   3. For each scripted `say` step, drive it through the pipeline: a `player`
 *      line through `api.say` (the `voice` model under the guards), a
 *      `narration-request` through the surveil narration already streamed (the
 *      `narrator` model). Collect the produced text from the turn's chunks.
 *   4. Score each produced output with {@link scoreWithJudge} for its role,
 *      through the injected {@link JudgeScorer} (the gateway judge scorer in
 *      production), and feed the per-call timing the Gateway recorded into the
 *      {@link MetricsCollector}.
 *
 * The guard-outcome counts (Leak Guard trips, Specifics trips, chance leaks,
 * Told-List contradictions, refusal rate) are produced inside the Dialogue Loop
 * and are not surfaced on the public {@link TurnStream}; the live run records
 * the per-call timings the Gateway measures (its metrics sink) and leaves the
 * guard tallies at zero, which the report renders as the run's totals. The
 * judge scores — the half Req 18.3 names as the harness's own work — are the
 * substance of the comparison.
 */

import type {
  Action,
  DocId,
  ScenarioConfig,
  WorldState,
} from '@tradecraft/engine';
import type { EngineApi, TurnChunk } from '@tradecraft/player-view';
import type { Gateway, MetricsRecord, ModelsConfig } from '@tradecraft/llm';
import { createGame, type GatewayOption } from '@tradecraft/app';

import {
  runFixtureSetup,
  type EvalFixture,
  type FixtureStep,
  type SayStep,
} from '../eval-fixtures/eval-fixtures.js';
import {
  MetricsCollector,
  type CallTimingSample,
  type MetricRole,
} from '../metrics/mechanical-metrics.js';
import { scoreWithJudge, type JudgeScorer } from '../judge/judge.js';
import type { DifficultyPresetId } from '../replays/fixtures.js';
import type { ScenarioJudgeScore } from './report.js';

/**
 * Per-profile timing supplied to the scene player: the metrics records the
 * Gateway measured over the profile's run so far, so the scene player can fold
 * the `voice`/`narrator` call timings into its {@link MetricsCollector}. The
 * live CLI builds each profile's Gateway over an in-memory metrics sink and
 * hands its records through this reader; a test supplies an empty reader (its
 * fake Gateway records nothing).
 */
export type TimingReader = (config: ModelsConfig) => readonly MetricsRecord[];

/** Options for {@link createGameScenePlayer}. */
export interface ScenePlayerOptions {
  /** The repository root the scenario's pack directories resolve against. */
  readonly repoRoot: string;
  /** The scenario the fixtures' worlds are generated under. */
  readonly scenario: ScenarioConfig;
  /** The difficulty preset `newGame` resolves the world under. */
  readonly preset: DifficultyPresetId;
  /**
   * Reads the per-call timing the Gateway measured for a profile's run, folded
   * into the collector as `voice`/`narrator` samples. Defaults to an empty
   * reader (no timing), so a run without a metrics sink still scores.
   */
  readonly timing?: TimingReader;
}

/** Drain a turn stream, returning every chunk it produced. */
async function drain(stream: AsyncIterable<TurnChunk>): Promise<TurnChunk[]> {
  const chunks: TurnChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

/** The live World State off the Composition Root's facade (REPL/eval tooling). */
function liveState(api: EngineApi): WorldState {
  return (api as unknown as { readonly state: WorldState }).state;
}

/** The brief Cable's DocId the world opens on, if any. */
function briefCableId(state: WorldState): DocId | undefined {
  const cable = Object.values(state.documents).find((d) => d.kind === 'cable');
  return cable?.id;
}

/**
 * Open a Talk Scene for a scene-opening `act` step (`talk`/`approach`/
 * `confront`). The fixture names an NPC id drawn from the regenerated world, so
 * the action is applied as-is; a disallowed open (the NPC is not present this
 * phase) leaves the world unchanged, which the following `say` reports as the
 * no-scene gate rather than a throw.
 */
async function applyAct(api: EngineApi, action: Action): Promise<TurnChunk[]> {
  if (!api.quote(action).allowed) {
    return [];
  }
  return drain(api.act(action));
}

/** Join every `speech` chunk's text — the `voice` model's reply for the turn. */
function speechOf(chunks: readonly TurnChunk[]): string {
  return chunks
    .filter((c): c is Extract<TurnChunk, { kind: 'speech' }> => c.kind === 'speech')
    .map((c) => c.text)
    .join(' ')
    .trim();
}

/** Join every `flavour` chunk's text — the `narrator` model's prose for the turn. */
function flavourOf(chunks: readonly TurnChunk[]): string {
  return chunks
    .filter((c): c is Extract<TurnChunk, { kind: 'flavour' }> => c.kind === 'flavour')
    .map((c) => c.text)
    .join(' ')
    .trim();
}

/** Map a Gateway metrics record to a per-role timing sample, or `null` to skip. */
function timingSample(record: MetricsRecord): CallTimingSample | null {
  const role = roleOf(record);
  if (role === null) {
    return null;
  }
  return {
    role,
    ttfsMs: record.ttfsMs,
    completionTokens: record.completionTokens,
    durationMs: record.durationMs,
  };
}

/**
 * The {@link MetricRole} a metrics record belongs to, or `null` for a call that
 * is neither the voice nor the narrator (the classifier/extractor on `fast`,
 * the judge on `judge`). A record's `purpose` carries the pipeline label
 * (`voice`/`narrator`) when known; otherwise the role falls back to the Model
 * Role the call was routed to.
 */
function roleOf(record: MetricsRecord): MetricRole | null {
  if (record.purpose === 'voice' || record.role === 'voice') {
    return 'voice';
  }
  if (record.purpose === 'narrator' || record.role === 'narrator') {
    return 'narrator';
  }
  return null;
}

/**
 * Build the production {@link ScenePlayer} (slice-integration task 17.2). The
 * returned runner assembles a game per fixture with {@link createGame} over the
 * harness-supplied Gateway, drives the fixture's setup and `say` steps through
 * the pipeline, scores the produced `voice`/`narrator` output with the injected
 * judge scorer, and folds the Gateway's per-call timings into the collector.
 *
 * It is `async` and offline in its inputs: with a fake Gateway (no endpoint) and
 * an empty timing reader it still runs the engine side deterministically and
 * returns the judge scores the fake scorer produces. The CLI passes the live
 * Gateway and the gateway judge scorer; a test passes a fake Gateway and a
 * canned scorer.
 */
export function createGameScenePlayer(options: ScenePlayerOptions) {
  const timing: TimingReader = options.timing ?? (() => []);

  return async function playScenes(args: {
    readonly config: ModelsConfig;
    readonly gateway: Gateway;
    readonly fixtures: readonly EvalFixture[];
    readonly scorer: JudgeScorer;
    readonly collector: MetricsCollector;
  }): Promise<readonly ScenarioJudgeScore[]> {
    const { config, gateway, fixtures, scorer, collector } = args;
    const scores: ScenarioJudgeScore[] = [];

    for (const fixture of fixtures) {
      const fixtureScores = await playFixture(fixture, {
        config,
        gateway,
        scorer,
        repoRoot: options.repoRoot,
        scenario: options.scenario,
        preset: options.preset,
      });
      scores.push(...fixtureScores);
    }

    // Fold the per-call timing the Gateway measured for this profile's run into
    // the collector as voice/narrator samples (the guard tallies stay at zero,
    // which the report renders as the run's totals).
    for (const record of timing(config)) {
      const sample = timingSample(record);
      if (sample !== null) {
        collector.recordTiming(sample);
      }
    }

    return scores;
  };
}

/** Run one fixture's scene and return its judge scores. */
async function playFixture(
  fixture: EvalFixture,
  deps: {
    readonly config: ModelsConfig;
    readonly gateway: GatewayOption;
    readonly scorer: JudgeScorer;
    readonly repoRoot: string;
    readonly scenario: ScenarioConfig;
    readonly preset: DifficultyPresetId;
  },
): Promise<readonly ScenarioJudgeScore[]> {
  const game = createGame({
    repoRoot: deps.repoRoot,
    scenario: deps.scenario,
    models: deps.config,
    gateway: deps.gateway,
  });

  try {
    const { api } = game;
    await api.newGame({
      seed: fixture.seed,
      preset: deps.preset,
      mole: deps.scenario.mole,
      narration: deps.scenario.narration,
    });

    // Read the brief Cable through the pipeline so the opening leads are logged,
    // exactly as a played game opens.
    const cableId = briefCableId(liveState(api));
    if (cableId !== undefined) {
      await applyAct(api, { kind: 'read', doc: cableId });
    }

    const scores: ScenarioJudgeScore[] = [];
    // `runFixtureSetup` tells us how many leading model-free `act` steps stage
    // the scene; we apply the whole script through the live pipeline (so the
    // scene-opening `talk`/`approach`/`confront` and the `say` lines reach the
    // model), tracking the last narration prose for a narration-request.
    let lastNarration = '';

    for (const step of fixture.script) {
      if (step.kind === 'act') {
        const chunks = await applyAct(api, step.action);
        const flavour = flavourOf(chunks);
        if (flavour.length > 0) {
          lastNarration = flavour;
        }
        continue;
      }
      const score = await playSay(step, {
        api,
        fixture,
        config: deps.config,
        scorer: deps.scorer,
        lastNarration,
      });
      if (score !== null) {
        scores.push(score);
      }
    }

    return scores;
  } finally {
    await game.close();
  }
}

/**
 * Drive one `say` step and score the produced output. A `player` line goes
 * through `api.say` and is scored as `voice` from the turn's `speech` chunks; a
 * `narration-request` is scored as `narrator` from the surveil narration the
 * preceding `act` streamed (the fixture's narration scene surveils, then asks
 * the Narrator to describe the result). Returns `null` when the turn produced
 * no scoreable output (the voice/narrator model said nothing), so an empty beat
 * is skipped rather than scored as an empty string.
 */
async function playSay(
  step: SayStep,
  deps: {
    readonly api: EngineApi;
    readonly fixture: EvalFixture;
    readonly config: ModelsConfig;
    readonly scorer: JudgeScorer;
    readonly lastNarration: string;
  },
): Promise<ScenarioJudgeScore | null> {
  const { api, fixture, config, scorer } = deps;

  if (step.role === 'narrator') {
    // The narration-request scores the surveil narration the preceding act
    // streamed. With no narration produced there is nothing to grade.
    if (deps.lastNarration.length === 0) {
      return null;
    }
    const result = await scoreWithJudge('narrator', deps.lastNarration, config, scorer, {
      prompt: step.text,
      context: fixture.preconditions,
    });
    return { scenario: fixture.scenario, role: 'narrator', result };
  }

  const chunks = await drain(api.say(step.text));
  const output = speechOf(chunks);
  if (output.length === 0) {
    return null;
  }
  const result = await scoreWithJudge('voice', output, config, scorer, {
    prompt: step.text,
    context: fixture.preconditions,
  });
  return { scenario: fixture.scenario, role: 'voice', result };
}

/** Re-exported for the CLI/tests: stage a fixture's setup without a model. */
export { runFixtureSetup };
export type { FixtureStep };
