/**
 * Comparison reports and the harness orchestration for the model evaluation
 * harness (task 23.4; Req 18.4): the per-profile result aggregate
 * ({@link ProfileEvalResult}) and the {@link EvalComparison} that bundles both
 * profiles, the two pure renderers ({@link renderMarkdownReport},
 * {@link renderCsvReport}), and {@link runEvalHarness}, which runs the fixtures
 * through every profile in a `models.yaml` with an injected gateway factory,
 * scene runner and judge scorer (offline in tests) and produces the comparison.
 */

export {
  CSV_HEADER,
  renderCsvReport,
  renderMarkdownReport,
  type EvalComparison,
  type ProfileEvalResult,
  type ScenarioJudgeScore,
} from './report.js';

export {
  profilesToRun,
  runEvalHarness,
  withActiveProfile,
  type GatewayFactory,
  type ProfileRunOutput,
  type RunHarnessOptions,
  type ScenePlayer,
} from './harness.js';
