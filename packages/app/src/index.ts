// @tradecraft/app — Composition Root and launcher for the Tradecraft game.
//
// This package assembles the completed vertical slice into a playable game. The
// Composition Root (`createGame`) is the single module that constructs the
// Content Set, the LLM Gateway, the Live Seams, the Turn Pipeline and the
// `PlayerViewEngine` facade, wired with the fs Save Store and Outcome Sink. The
// launcher (`pnpm play`, task 14) and the App Shell drive the `EngineApi` it
// returns.

// The Composition Root (task 12.5).
export {
  createGame,
  type CreateGameOptions,
  type Game,
  type GatewayOption,
} from './lib/composition-root.js';

// The live filesystem seams the Composition Root wires by default (task 12.3).
export { FsSaveStore, DEFAULT_SAVES_DIR } from './lib/fs-save-store.js';
export { fsOutcomeSink, OUTCOMES_DIR } from './lib/fs-outcome-sink.js';

// The Launcher (`pnpm play`, task 14.1): validation → Model Manager → root →
// shell, with all I/O injected through `LauncherIo` so it is testable offline
// (Req 20.1–20.6).
export {
  runLauncher,
  renderAppShell,
  type LauncherIo,
  type RenderHandle,
} from './lib/launcher.js';

// The Fake Seams the `app` and `evals` tests share (task 12.6). Offline,
// seeded, deterministic Turn Pipeline seams for property tests and Scripted
// Full Games (Req 18.3, 23.5).
export {
  buildFakeSeams,
  buildFakeClassifySeam,
  buildFakeVoiceSeam,
  buildFakeNarrateSeam,
  buildFakeExtractionRunner,
  buildFuzzedExtraction,
  FAKE_DEFLECTION_LINE,
  MAX_FUZZ_CLAIMS,
  type FakeSeamBundle,
  type FakeSeamDeps,
} from './lib/fake-seams.js';

// The Scripted Full Games driver (task 18): the harness and the three scripts
// that play a complete game through `createGame` with the Fake Seams. Shared
// with the golden-replay recorder, which plays the win-by-arrest script to
// record the `04-full-game` Golden Replay (task 19.2, Req 23.6).
export {
  ScriptedGame,
  playWinByArrest,
  playPlotFailure,
  playBurned,
  claimsOf,
  WIN_BY_ARREST,
  PLOT_FAILURE,
  BURNED,
  type ScriptedGameOptions,
  type ScriptedPreset,
  type PlayedTurn,
  type EndedChunk,
  type WinByArrestRun,
  type PlotFailureRun,
  type BurnedRun,
} from './lib/scripted-games.js';

// The web shell launcher (`pnpm play:web`): same startup as `pnpm play`, then
// the loopback web shell instead of the terminal UI.
export { runWebLauncher, type WebLauncherIo } from './lib/web-launcher.js';

// The neural player (`pnpm player:train`, `pnpm player:play`): a policy network
// that scores Player View actions and plays each Difficulty Preset offline.
export {
  playEpisode,
  summarizeEpisodes,
  type DecisionSample,
  type EpisodeResult,
  type PlayOptions,
  type PlayerOutcome,
} from './lib/nn/episode.js';
export {
  defaultPresets,
  loadPlayer,
  trainPlayer,
  type PresetReport,
  type TrainOptions,
  type TrainReport,
} from './lib/nn/train.js';
