export * from './lib/evals.js';

export {
  // Golden replay runner (task 21.4; Req 17.4; slice-integration task 17.3):
  // replays a checked-in golden session end to end through the Composition Root
  // (`createGame` with a `ReplayGateway`, no live model), driving `api.newGame`
  // and `api.act`, and returns the reproduced artifact — the final WorldState,
  // its stable hash and the reproduced action log — for a CI deep-equal against
  // the golden.
  hashState,
  replayGoldenSession,
  type GoldenSession,
  type PlanStep,
  type ReplayArtifact,
  type ReplayedLogEntry,
} from './lib/replays/replay-runner.js';

export {
  // Loading golden fixtures from `replays/` (task 21.4): discover fixture
  // directories, build the engine inputs the world regenerates from, and
  // reconstruct each replayable session with a file-backed recording source.
  // `buildInputs` also backs the debug `world`/`sim` CLIs' `--preset` flag via
  // its optional `DifficultyPresetId` argument.
  DIFFICULTY_PRESET_IDS,
  REPLAYS_DIR,
  // The (now empty) list of fixtures awaiting a one-time re-record
  // (slice-integration Req 24.1); the slice goldens were re-recorded in task
  // 19.1, so the golden spec compares every fixture again.
  PENDING_RERECORD,
  buildExpectedArtifact,
  buildInputs,
  listFixtureIds,
  loadAllFixtures,
  loadFixture,
  loadSession,
  type DifficultyPresetId,
  type LoadedFixture,
  type SessionManifest,
} from './lib/replays/fixtures.js';

export {
  // Engine-inspection debug tooling (checkpoint 12): the pure logic behind the
  // `pnpm world` and `pnpm sim` operator CLIs. `renderWorldDump` turns a
  // generated world + Truth Store into a sectioned text dump (player-safe, or
  // the full ground truth with `reveal`); `runScript` folds a scripted action
  // list through the pure engine (no model) and returns the Fact Lines and the
  // resulting Case File, which `renderSimReport` renders. The arg-parse + IO
  // shells live in `scripts/world.ts` and `scripts/sim.ts`.
  renderWorldDump,
  type WorldDumpOptions,
} from './lib/debug/world-dump.js';

export {
  renderSimReport,
  runScript,
  type ScriptResult,
  type ScriptedStep,
} from './lib/debug/sim-run.js';

export {
  // Scenario fixtures for the model evaluation harness (task 23.1; Req 18.1,
  // 18.5): the fixture format (a seed, a scene tag and an ordered script of
  // player lines and/or engine actions), its Zod schema, the five required
  // fixtures as data, and a setup driver that stages a fixture into its scene
  // offline through the pure engine.
  EVAL_SCENARIOS,
  EvalScenarioSchema,
  SAY_SPEAKERS,
  SayStepSchema,
  ActStepSchema,
  FixtureStepSchema,
  EvalFixtureSchema,
  buildEvalFixtures,
  loadEvalFixtures,
  locByIndex,
  runFixtureSetup,
  type EvalScenario,
  type SaySpeaker,
  type SayStep,
  type ActStep,
  type FixtureStep,
  type FixtureScript,
  type EvalFixture,
  type FixtureSetup,
} from './lib/eval-fixtures/eval-fixtures.js';

export {
  // Mechanical metrics for the model evaluation harness (task 23.2; Req 15.3,
  // 18.2): the `MechanicalMetrics` shape (Leak Guard trips, Specifics Guard
  // trips, chance leaks, Told List contradictions, refusal rate, time to first
  // sentence and tokens/sec — the last three per Model Role) and the collector
  // that accumulates it over a fixture run from guard outcomes, extraction
  // signals and per-call timing samples. The collector counts guard *outcome*
  // data (no `@tradecraft/dialogue` dependency) and takes timings as injected
  // samples, so a run is deterministic and offline through the gateway seam.
  METRIC_ROLES,
  MetricsCollector,
  type CallTimingSample,
  type ExtractionCounts,
  type LeakGuardTrip,
  type MechanicalMetrics,
  type MetricRole,
  type PerRole,
  type RefusalRate,
  type ReplyOutcome,
  type SpecificsCheck,
  type ThroughputStats,
  type TtfsStats,
} from './lib/metrics/index.js';

export {
  // Judge scoring for the model evaluation harness (task 23.3; Req 18.3): the
  // FIXED rubric (a dialogue variant for `voice` replies and a narration
  // variant for `narrator` output, each a list of named criteria on a bounded
  // 1..5 scale — the same rubric every run), the Zod schema for the judge's
  // structured verdict, and `scoreWithJudge`, which grades a reply/narration
  // against the rubric for its role through an injectable scorer (the gateway
  // `structured` seam in production via `gatewayJudgeScorer`, a canned verdict
  // in tests), records the judge model's identity on the result, and warns —
  // without throwing — when the judge model equals the `voice` model (a model
  // should not grade its own voice).
  DIALOGUE_RUBRIC,
  NARRATION_RUBRIC,
  RUBRICS,
  RUBRIC_KINDS,
  SCORE_MAX,
  SCORE_MIN,
  rubricForRole,
  JudgeCriterionScoreSchema,
  JudgeVerdictSchema,
  buildJudgePrompt,
  gatewayJudgeScorer,
  judgeIdentity,
  sameAsVoiceWarning,
  scoreWithJudge,
  type Rubric,
  type RubricCriterion,
  type RubricKind,
  type JudgeCriterionScore,
  type JudgeIdentity,
  type JudgeInput,
  type JudgeResult,
  type JudgeScore,
  type JudgeScorer,
  type JudgeVerdict,
  type ScoreOptions,
} from './lib/judge/index.js';

export {
  // Comparison reports and the harness orchestration (task 23.4; Req 18.4): the
  // per-profile result aggregate (`ProfileEvalResult`) and the `EvalComparison`
  // bundling both profiles, the two PURE string renderers (`renderMarkdownReport`
  // for a human-readable comparison table and `renderCsvReport` for the same
  // comparison as a flat `CSV_HEADER`-documented table), and `runEvalHarness`,
  // which iterates every profile in a `models.yaml` (switching `active` per run
  // via `withActiveProfile`), runs the fixtures through each, and collects the
  // mechanical metrics + judge scores into the comparison. The gateway and the
  // judge scorer are INJECTED (a `GatewayFactory` and a `ScenePlayer`), so tests
  // run OFFLINE against a fake/replay gateway with scripted output and canned
  // judge verdicts — never a live model.
  CSV_HEADER,
  profilesToRun,
  renderCsvReport,
  renderMarkdownReport,
  runEvalHarness,
  withActiveProfile,
  type EvalComparison,
  type GatewayFactory,
  type ProfileEvalResult,
  type ProfileRunOutput,
  type RunHarnessOptions,
  type ScenarioJudgeScore,
  type ScenePlayer,
} from './lib/report/index.js';

export {
  // The production ScenePlayer (task 17.2; Req 18.5): drives each eval fixture's
  // scene through `@tradecraft/app`'s `createGame` with the Live Seams over the
  // profile's Gateway and scores the `voice`/`narrator` output with the judge.
  // The CLI (`scripts/evals.ts`) injects it into the harness; the harness's own
  // unit test uses a fake runner instead.
  createGameScenePlayer,
  type ScenePlayerOptions,
  type TimingReader,
} from './lib/report/scene-player.js';

export {
  // `pnpm evals [--profile <name>]` — the testable orchestration (task 17.2;
  // Req 18.5, 22.4, 25.1, 25.2, 25.3). Runs one profile or every profile,
  // driving the Model Manager inside the per-profile gateway factory
  // (`startModelManager` for the first, `unloadProfile(prev)` → `loadProfile(next)`
  // for each later one), scores the fixtures with the judge, and writes the
  // Markdown + CSV reports carrying the judge identity and the same-as-voice
  // warning. Everything that touches the outside world is injected through
  // `RunEvalsIo`, so the CLI is driven offline in its unit test.
  REPORT_CSV,
  REPORT_MARKDOWN,
  runEvals,
  type LoadProfile,
  type ReportWriter,
  type RunEvalsIo,
  type RunEvalsOptions,
  type StartModelManager,
  type UnloadProfile,
} from './lib/report/run-evals.js';

export {
  // The first-live-session REPL (checkpoint 17), now on the Composition Root
  // (slice-integration task 17.1): the testable logic behind the `pnpm repl`
  // operator CLI. `runSession` builds a playable game through
  // `@tradecraft/app`'s `createGame` — the same Composition Root the launcher
  // uses — starts a new game and drives one scripted operator session through
  // the returned `EngineApi` (`newGame` → read the brief, travel, briefing
  // `say`, surveil with narration, talk `say`, `endScene`), then inspects the
  // Case File, Journal and the ground-truth records. The live gateway
  // construction + recording lives in `scripts/repl.ts`, which passes a
  // recording Gateway (`{ record }`) to `createGame`; the test injects a fake
  // Gateway or Fake Seams, so this logic reaches no endpoint of its own.
  renderInspection,
  runSession,
  type SessionBeat,
  type SessionEvent,
  type SessionInspection,
  type SessionOptions,
  type SessionResult,
  type SessionSink,
} from './lib/repl/session.js';
