/**
 * The Composition Root (`createGame`) — slice-integration task 12.5; design,
 * "Composition Root (`app/composition-root.ts`)"; Requirements 18.1, 18.3, 18.4.
 *
 * This is the single module that assembles a playable game from the loaded
 * Content Set, the validated scenario, the LLM Gateway and the Player-View
 * facade. Everything below it is already built and tested behind its own seams;
 * this module only *wires* those pieces together, in the order the design lays
 * out:
 *
 *   1. Load the Content Set from `scenario.packs` through the `@tradecraft/content`
 *      loaders (Req 18.1).
 *   2. Build the LLM {@link Gateway}: an {@link OpenAIGateway} for `live`,
 *      wrapped in a {@link RecordingGateway} for `{ record }`, or a
 *      {@link ReplayGateway} for `{ replay }`; a caller may also pass its own
 *      Gateway (Req 18.4).
 *   3. Build the Live Seams over that Gateway with `buildLiveSeams` unless the
 *      caller overrides them with Fake Seams (Req 18.3).
 *   4. Assemble the `AdvanceWorldDeps` the clock advance needs — the production
 *      Day-Boundary Hooks (`buildWorldHooks()`), the Objective Evaluator factory
 *      (`buildObjectiveEvaluator`), and the cipher keys drawn from the world's
 *      public texts (`worldCipherKeyLookup`). The Turn Pipeline builds these per
 *      draft (it needs the live world's seed and public-text Documents, which do
 *      not exist until a game is generated), so the Composition Root supplies the
 *      *constituents* through the pipeline rather than a stale pre-game bundle.
 *   5. Build the `GameFactory` closed over the Content Set and the scenario, the
 *      Turn Pipeline (`createTurnDriver`) and the `PlayerViewEngine` facade,
 *      wired with the default fs {@link FsSaveStore} / {@link fsOutcomeSink} and
 *      the saves controller/bridge.
 *
 * No game exists until the caller calls `api.newGame(...)` or `api.saves.load(...)`;
 * `createGame` builds the empty, swappable facade the launcher and App Shell
 * drive.
 */

import { join } from 'node:path';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type ContentSet,
  type DifficultyPreset,
  type PredicateRegistry,
} from '@tradecraft/content';
import {
  generateGame,
  type AdvanceWorldDeps,
  type GenerateInputs,
  type ScenarioConfig,
  type TruthStore,
  type WorldState,
} from '@tradecraft/engine';
import {
  FileRecordSink,
  OpenAIGateway,
  RecordingGateway,
  ReplayGateway,
  type Gateway,
  type ModelsConfig,
  type RecordSource,
} from '@tradecraft/llm';
import { buildLiveSeams, LocationFlavourCache } from '@tradecraft/dialogue';
import {
  ActionLog,
  CaseFile,
  createSavesController,
  createTurnDriver,
  ExtractionQueue,
  implicationRules,
  Journal,
  NotificationStore,
  PlayerViewEngine,
  type BriefView,
  type EngineApi,
  type EvalLog,
  type GameFactory,
  type LoadedSession,
  type NewGameOptions,
  type OutcomeSink,
  type SaveBridge,
  type SaveBridgeParts,
  type SaveStore,
  type TurnDriver,
  type TurnIntent,
  type TurnPipelineConfig,
  type TurnStream,
} from '@tradecraft/player-view';

import { DEFAULT_SAVES_DIR, FsSaveStore } from './fs-save-store.js';
import { fsOutcomeSink } from './fs-outcome-sink.js';
import {
  featuredSeedSource,
  loadFeaturedSeeds,
  type FeaturedSeeds,
} from './featured-seeds.js';

/**
 * How the LLM Gateway is obtained (design `CreateGameOptions.gateway`):
 *
 *   - `'live'` — a fresh {@link OpenAIGateway} over the endpoint in `models`.
 *   - `{ record: path }` — the live gateway, wrapped in a {@link RecordingGateway}
 *     that appends every call to the JSONL file at `path`.
 *   - `{ replay: source }` — a {@link ReplayGateway} serving a recorded session
 *     from `source`, with no endpoint.
 *   - a {@link Gateway} — the caller's own gateway, used as-is (the eval harness
 *     and golden-replay runner pass one).
 */
export type GatewayOption =
  | 'live'
  | { readonly record: string }
  | { readonly replay: RecordSource }
  | Gateway;

/**
 * The options {@link createGame} accepts (design `CreateGameOptions`). The
 * scenario and models configs are already validated by the launcher; the
 * Composition Root does not re-validate them.
 */
export interface CreateGameOptions {
  /** The repository root the scenario's pack directories resolve against. */
  readonly repoRoot: string;
  /** The validated scenario config (the Content Packs, difficulty, mole, narration). */
  readonly scenario: ScenarioConfig;
  /** The validated models config (the endpoint and per-role model ids). */
  readonly models: ModelsConfig;
  /** How to obtain the Gateway. Defaults to `'live'`. */
  readonly gateway?: GatewayOption;
  /**
   * The Turn Pipeline seams to use instead of the Live Seams built over the
   * Gateway (Req 18.3). The Fake Seams the `app`/`evals` tests share are passed
   * here; omitting it uses the Live Seams.
   */
  readonly seams?: Partial<TurnPipelineConfig>;
  /** The Save Store. Defaults to an {@link FsSaveStore} over `saves/`. */
  readonly saveStore?: SaveStore;
  /** The Outcome Sink. Defaults to an {@link fsOutcomeSink} over `saves/outcomes/`. */
  readonly outcomes?: OutcomeSink;
  /** Where the pipeline sends chance leaks and consistency violations (Req 17.4). */
  readonly evalLog?: EvalLog;
  /**
   * The engine's clock-advance dependencies (the Day-Boundary Hooks, Objective
   * Evaluator factory and cipher keys) the action turn hands to `advanceWorld`.
   * In production the Turn Pipeline assembles a per-draft {@link AdvanceWorldDeps}
   * from `buildWorldHooks()`, the Objective Evaluator and the live world's cipher
   * material, so this is omitted and the facade carries no `advance` (Req 18.1).
   * It is a seam for tests only: Property 39 (turn atomicity) injects a throwing
   * Day-Boundary Hook here to drive the pre-commit failure path through the real
   * Composition Root. Supplied, it is threaded onto the facade's deps and so is
   * used for every turn and carried across `newGame`.
   */
  readonly advance?: AdvanceWorldDeps;
  /**
   * The featured-seed list a seedless `newGame` draws from, keyed by preset id.
   * Defaults to `config/featured-seeds.json` under `repoRoot` when that file
   * exists; an empty object (or a preset with no entries) falls back to a fresh
   * random seed.
   */
  readonly featuredSeeds?: FeaturedSeeds;
}

/**
 * The assembled game (design `Game`): the {@link EngineApi} the launcher and
 * App Shell drive, the {@link Gateway} it was built over (for the launcher to
 * flush a recording or report endpoint state), and a `close` that releases any
 * resources. No game is generated until `api.newGame` or `api.saves.load`.
 */
export interface Game {
  /** The only surface the launcher and App Shell use (Req 13.5). */
  readonly api: EngineApi;
  /** The Gateway the game was built over, if one was built (none for pure Fake Seams). */
  readonly gateway?: Gateway;
  /** Release any resources the game holds. Idempotent. */
  readonly close: () => Promise<void>;
}

/**
 * Load the Content Set and the side files (city, descriptors, public texts) a
 * game is generated from, from the directories and pack ids in `scenario.packs`
 * (Req 18.1). Pack directories are resolved against `repoRoot` so a relative
 * `packages/content/packs` in the scenario resolves the same wherever the
 * process runs. A load failure throws with the first located issue, so the
 * launcher surfaces it before any game is built.
 */
function loadContentSet(
  repoRoot: string,
  scenario: ScenarioConfig,
): {
  content: ContentSet;
  inputsBase: Omit<GenerateInputs, 'preset' | 'scenario'>;
} {
  const dirs = scenario.packs.dirs.map((dir) => join(repoRoot, dir));
  const load = scenario.packs.load;

  const content = loadContent(dirs, load);
  if (!content.ok) {
    throw new Error(
      `failed to load Content Packs [${load.join(', ')}]: ${describeFirstIssue(content.errors)}`,
    );
  }

  // The side files live beside the first pack directory (the core pack ships
  // city.yaml, descriptors.yaml and the public texts); the loaders read them
  // from a pack directory. Try each directory in order so a scenario that lists
  // more than one pack dir still finds them.
  const cityData = loadFromDirs(dirs, (dir) => loadCityData(dir));
  const descriptors = loadFromDirs(dirs, (dir) => loadDescriptorData(dir));
  const publicTexts = loadFromDirs(dirs, (dir) => loadPublicTexts(dir));

  return {
    content: content.value,
    inputsBase: {
      content: content.value,
      cityData,
      descriptors,
      publicTexts,
    },
  };
}

/**
 * Run a side-file loader over each pack directory in turn, returning the first
 * successful value. Throws when none succeeds, naming the loader's first issue —
 * a game cannot be generated without the city data, descriptors and public
 * texts, so a missing side file is a hard failure, not a silent default.
 */
function loadFromDirs<T>(
  dirs: readonly string[],
  loader: (
    dir: string,
  ) => { ok: true; value: T } | { ok: false; errors?: unknown },
): T {
  let lastErrors: unknown;
  for (const dir of dirs) {
    const result = loader(dir);
    if (result.ok) {
      return result.value;
    }
    lastErrors = result.errors;
  }
  throw new Error(
    `failed to load a required pack side file: ${describeFirstIssue(lastErrors)}`,
  );
}

/** A short description of a loader's first issue for an error message. */
function describeFirstIssue(errors: unknown): string {
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as { path?: string; message?: string };
    return `${first.path ?? '<root>'}: ${first.message ?? 'invalid'}`;
  }
  return 'no further detail';
}

/**
 * Resolve a Difficulty Preset by its id from the loaded Content Set. Pack preset
 * keys are namespaced (`<pack>/<id>`), so a bare id matches the suffix; a fully
 * qualified key matches exactly. Throws on an unknown id so a bad `preset`
 * option fails loudly rather than generating under the wrong difficulty.
 */
function resolvePreset(content: ContentSet, id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset "${id}" in the loaded Content Packs`);
}

/**
 * Build the {@link Gateway} from the `gateway` option (Req 18.4). `'live'` is a
 * fresh {@link OpenAIGateway} over the endpoint in `models`; `{ record }` wraps
 * that live gateway in a {@link RecordingGateway} appending to the JSONL file at
 * the path; `{ replay }` is a {@link ReplayGateway} serving the recorded source
 * with no endpoint. A caller may pass its own {@link Gateway}, which is used
 * as-is. Returns `undefined` only when the caller supplies Fake Seams and no
 * gateway, so no endpoint client is ever created in a pure offline test.
 */
function buildGateway(
  option: GatewayOption | undefined,
  models: ModelsConfig,
  seams: Partial<TurnPipelineConfig> | undefined,
): Gateway | undefined {
  if (option === undefined) {
    // No gateway requested. With Fake Seams there is nothing to build (offline);
    // otherwise default to the live gateway so a launcher that omits the option
    // still gets a playable game.
    return seams === undefined ? new OpenAIGateway(models) : undefined;
  }
  if (option === 'live') {
    return new OpenAIGateway(models);
  }
  if (isGateway(option)) {
    return option;
  }
  if ('record' in option) {
    return new RecordingGateway(
      new OpenAIGateway(models),
      new FileRecordSink(option.record),
    );
  }
  // `{ replay }`: a ReplayGateway serving the recorded source with no endpoint.
  return new ReplayGateway(models, option.replay);
}

/** Whether a {@link GatewayOption} is a caller-supplied {@link Gateway}. */
function isGateway(option: GatewayOption): option is Gateway {
  return (
    typeof option === 'object' &&
    option !== null &&
    'stream' in option &&
    typeof (option as Gateway).stream === 'function'
  );
}

/**
 * Build the {@link TurnPipelineConfig} seams the pipeline runs behind — the Live
 * Seams over the Gateway, unless the caller supplied an override (Req 18.3). The
 * Live Seams read the live world through `getState`, which the facade swaps in
 * place as each turn commits, so a seam always sees the current registry and
 * known set the Leak Guard needs. The extractor evaluates against the live
 * game's Truth Store, read through the same `getState`.
 */
function buildSeams(
  gateway: Gateway | undefined,
  predicates: PredicateRegistry,
  scenario: ScenarioConfig,
  getState: () => WorldState,
  getTruth: () => TruthStore | undefined,
  override: Partial<TurnPipelineConfig> | undefined,
): Partial<TurnPipelineConfig> {
  if (override !== undefined) {
    return override;
  }
  if (gateway === undefined) {
    // No gateway and no override: the model-free defaults in `createTurnDriver`
    // apply (deflection voice, fact-only narration, jobs never ready).
    return {};
  }
  const live = buildLiveSeams(gateway, {
    getState,
    predicates,
    get truth(): TruthStore | undefined {
      return getTruth();
    },
    narrationMode: scenario.narration,
    tokenBudget: scenario.tokenBudget,
    leakGuardRetries: scenario.retries.leakGuard,
  });
  return {
    classify: live.classify,
    voice: live.voice,
    narrate: live.narrate,
    extraction: live.extraction,
    deflectionLine: live.deflectionLine,
  };
}

/**
 * Build the {@link GameFactory} the facade's `newGame` drives (design, "Facade:
 * `newGame`"; Req 12.1). It is closed over the loaded Content Set and the
 * validated scenario: it resolves the preset by id, overrides `mole` and
 * `narration` on the scenario, and runs the engine's pure `generateGame`,
 * returning the generated world, its seeded Truth Store and the resolved
 * {@link GenerateInputs}. Generation is pure in `(seed, inputs)`, so two calls
 * with the same options produce deep-equal worlds (Req 12.5).
 */
function buildGameFactory(
  content: ContentSet,
  inputsBase: Omit<GenerateInputs, 'preset' | 'scenario'>,
  scenario: ScenarioConfig,
): GameFactory {
  return {
    generate(seed: string, opts: NewGameOptions) {
      const inputs: GenerateInputs = {
        ...inputsBase,
        preset: resolvePreset(content, opts.preset),
        scenario: { ...scenario, mole: opts.mole, narration: opts.narration },
      };
      const { world, truth } = generateGame(seed, inputs);
      return { inputs, world, truth };
    },
  };
}

/**
 * The {@link SaveBridge} to the pipeline- and dialogue-owned stores a save
 * composes beside the facade's own stores (design, "Facade: saves"). It holds
 * the mutable store references the Turn Pipeline reads through — the action log,
 * the extraction queue and the Location Flavour cache — so `collect()` snapshots
 * the current ones for a save, and `restore(loaded)` swaps in the loaded ones so
 * a continued game keeps the saved action log, `turnId` order and
 * `outcomeWritten` flag (Req 7.6, 13.3). The Composition Root rebuilds the Turn
 * Pipeline over the restored stores (see `rebuildDriver` below) so the live
 * pipeline reads them, not the pre-load instances.
 */
class CompositionSaveBridge implements SaveBridge {
  actionLog = new ActionLog();
  extractionQueue = new ExtractionQueue();
  flavourCache: LocationFlavourCache = LocationFlavourCache.empty();
  viewState: SaveBridgeParts['viewState'] = {
    hintsSeen: [],
    observedCoverState: {},
  };
  pipeline: SaveBridgeParts['pipeline'] = {
    turnCounter: 0,
    outcomeWritten: false,
  };

  /** Called by the Composition Root after a load to rebuild the pipeline. */
  onRestore?: (loaded: LoadedSession) => void;

  collect(): SaveBridgeParts {
    return {
      flavourCache: this.flavourCache.snapshot(),
      actionLog: this.actionLog,
      extractionQueue: this.extractionQueue,
      viewState: this.viewState,
      pipeline: this.pipeline,
    };
  }

  restore(loaded: LoadedSession): void {
    this.actionLog = loaded.actionLog;
    this.extractionQueue = loaded.extractionQueue;
    this.flavourCache = LocationFlavourCache.from(loaded.flavourCache);
    this.viewState = loaded.viewState;
    this.pipeline = loaded.pipeline;
    // Rebuild the Turn Pipeline over the restored stores so the live facade runs
    // the loaded action log and extraction queue, not the pre-load instances.
    this.onRestore?.(loaded);
  }
}

/**
 * The initial, game-less view-safe stand-ins the facade is constructed with. No
 * game exists until `newGame` or `load`, which rebuild every store in one swap;
 * these are placeholders so the facade is a valid object before then. The empty
 * brief and rules are replaced by `newGame`/`load` from the generated world.
 */
const EMPTY_BRIEF: BriefView = {
  hostileOrgs: [],
  hostileChannels: [],
  materiel: [],
};

/**
 * Assemble a playable game (design, "Composition Root"; Req 18.1, 18.3, 18.4).
 *
 * The returned {@link Game} exposes the {@link EngineApi} the launcher and App
 * Shell drive. The facade starts game-less: `api.newGame(...)` generates the
 * first world through the {@link GameFactory}, and `api.saves.load(...)` rebuilds
 * one from a save. The Live Seams, the clock-advance dependencies, the saves
 * controller and the fs stores and sinks are all wired here, once.
 */
export function createGame(options: CreateGameOptions): Game {
  const {
    repoRoot,
    scenario,
    models,
    gateway: gatewayOption,
    seams: seamsOverride,
    evalLog,
    advance,
  } = options;

  // Step 1: load the Content Set and side files from `scenario.packs` (Req 18.1).
  const { content, inputsBase } = loadContentSet(repoRoot, scenario);

  // Step 2: build the Gateway (Req 18.4). None is built for a pure Fake-Seams
  // offline run (an override with no gateway option).
  const gateway = buildGateway(gatewayOption, models, seamsOverride);

  // The default fs stores and sinks, unless the caller injected its own.
  const saveStore =
    options.saveStore ?? new FsSaveStore(join(repoRoot, DEFAULT_SAVES_DIR));
  const outcomes =
    options.outcomes ??
    fsOutcomeSink(join(repoRoot, DEFAULT_SAVES_DIR, 'outcomes'));

  // The bridge to the pipeline/dialogue stores a save composes. It owns the
  // mutable action log, extraction queue and Flavour cache the pipeline reads.
  const bridge = new CompositionSaveBridge();

  // A holder breaks the construction cycle: the Live Seams and the save bridge
  // read the facade's current state through this holder, which the facade fills
  // once it is built.
  const holder: { engine?: PlayerViewEngine } = {};
  const getState = (): WorldState => {
    if (holder.engine === undefined) {
      throw new Error('the game state was read before the facade was built');
    }
    return holder.engine.state;
  };
  const getTruth = (): TruthStore | undefined =>
    holder.engine?.turnContext.truth;

  // Step 3: the Live Seams over the Gateway, unless overridden (Req 18.3).
  const seams = buildSeams(
    gateway,
    content.predicates,
    scenario,
    getState,
    getTruth,
    seamsOverride,
  );

  // Steps 4–5: the Turn Pipeline. The pipeline assembles the `AdvanceWorldDeps`
  // per draft from `buildWorldHooks()`, `buildObjectiveEvaluator` and the cipher
  // keys drawn from the live world's public-text Documents
  // (`worldCipherKeyLookup`), which is why those constituents are supplied
  // through the pipeline rather than a pre-game bundle (the world does not exist
  // until `newGame`). The action log and extraction queue are the bridge's, so a
  // save snapshots them and a load swaps them.
  const buildDriver = (
    actionLog: ActionLog,
    extractionQueue: ExtractionQueue,
    outcomeWritten: boolean,
  ): TurnDriver => {
    const config: TurnPipelineConfig = {
      ...seams,
      outcomes,
      outcomeWritten,
      actionLog,
      extractionQueue,
      ...(evalLog !== undefined ? { evalLog } : {}),
    };
    return createTurnDriver(config);
  };

  // The live driver is swappable so a load can rebuild the pipeline over the
  // restored stores. The facade holds this stable function, which delegates to
  // the current inner driver.
  let innerDriver = buildDriver(
    bridge.actionLog,
    bridge.extractionQueue,
    bridge.pipeline.outcomeWritten,
  );
  const turnDriver: TurnDriver = (
    engine: PlayerViewEngine,
    intent: TurnIntent,
  ): TurnStream => innerDriver(engine, intent);

  // Step 5: the GameFactory and the facade. The facade starts game-less with the
  // placeholder stores; `newGame`/`load` replace every store in one swap.
  const gameFactory = buildGameFactory(content, inputsBase, scenario);
  const engine = new PlayerViewEngine({
    state: emptyWorld(content, inputsBase, scenario),
    caseFile: new CaseFile(),
    journal: new Journal(),
    cityData: inputsBase.cityData,
    ctx: { content },
    brief: EMPTY_BRIEF,
    rules: implicationRules([]),
    notifications: new NotificationStore(),
    hintsEnabled: scenario.hints ?? false,
    turnDriver,
    gameFactory,
    seedSource: featuredSeedSource(
      options.featuredSeeds ?? loadFeaturedSeeds(options.repoRoot),
    ),
    // A test-only clock-advance override (Property 39). Omitted in production,
    // where the Turn Pipeline builds a per-draft `AdvanceWorldDeps` instead.
    ...(advance !== undefined ? { advance } : {}),
  });
  holder.engine = engine;

  // Attach the saves controller over the facade and the bridge. On a load the
  // bridge swaps in the restored stores; `onRestore` rebuilds the live driver
  // over them so the continued game runs the loaded action log and queue.
  engine.attachSaves(createSavesController(engine, { saveStore, bridge }));
  bridge.onRestore = (loaded: LoadedSession): void => {
    innerDriver = buildDriver(
      loaded.actionLog,
      loaded.extractionQueue,
      loaded.pipeline.outcomeWritten,
    );
  };

  return {
    api: engine,
    ...(gateway !== undefined ? { gateway } : {}),
    close: async (): Promise<void> => {
      // No long-lived resources are held open: the gateway is request-scoped,
      // the fs stores open and close files per call. `close` is here for the
      // launcher's symmetry and for a future gateway that needs teardown.
      await Promise.resolve();
    },
  };
}

/**
 * A placeholder {@link WorldState} the facade is constructed with before any
 * game exists. `newGame`/`load` replace it in one swap, so it is only ever read
 * by a status query made before a game is started. It is generated from a fixed
 * seed so construction is deterministic and total; it is never the game the
 * player plays.
 */
function emptyWorld(
  content: ContentSet,
  inputsBase: Omit<GenerateInputs, 'preset' | 'scenario'>,
  scenario: ScenarioConfig,
): WorldState {
  const preset = firstPreset(content);
  const inputs: GenerateInputs = { ...inputsBase, preset, scenario };
  return generateGame('composition-root-init', inputs).world;
}

/** The first Difficulty Preset in the Content Set, for the placeholder world. */
function firstPreset(content: ContentSet): DifficultyPreset {
  for (const [, value] of content.difficultyPresets) {
    return value;
  }
  throw new Error('the loaded Content Packs declare no difficulty preset');
}
