/**
 * The Player-View engine API surface (task 16.1): the {@link EngineApi}
 * interface and its stream/error vocabulary, the view projections, and the
 * concrete {@link PlayerViewEngine} facade.
 */

export {
  type EngineApi,
  type TurnChunk,
  type TurnStream,
  type LoadError,
  type SaveInfo,
  type SaveHeader,
  type SaveStore,
  SAVE_NAME,
  isValidSaveName,
  type Result,
  type GameView,
  type NewGameOptions,
  type GameFactory,
  type StatusView,
  type ActionOption,
  type JournalView,
  type MapView,
  type PeopleView,
  type InterceptListView,
  type WorkbenchView,
  type HelpView,
  type HelpActionEntry,
  type HelpGlossaryEntry,
  type DebriefView,
  type DebriefAllegiance,
  type DebriefTimelineEntry,
  type DebriefLie,
  type DebriefLead,
  type DebriefFedProposition,
  type DebriefDirectiveResult,
  type DebriefScore,
  type Notification,
  type FeedError,
  NARRATION_MODES,
  type NarrationMode,
} from './types.js';

export {
  // View projections (scene, here, documents) and the Case File view slice.
  personLabel,
  visiblePersonLabels,
  weatherNow,
  crowdNow,
  sceneView,
  hereView,
  obtainableAt,
  documentListView,
  documentView,
  listClaims,
  type PersonLabel,
  type SceneView,
  type HereView,
  type DocumentListEntry,
  type DocumentListView,
  type DocumentView,
  type ClaimView,
  type CaseFileFilter,
} from './views.js';

export {
  // Intercepts list and Workbench projections (task 22.5; Req 9.5, 9.6, 25.3):
  // view-safe shapes and the pure functions that build them — the frequency
  // table, the caesar shift preview and the per-Intercept Workbench, none of
  // which read an Intercept's Truth-branded spec/plaintext/origin.
  interceptListView,
  workbenchView,
  frequencyTable,
  caesarShift,
  caesarShiftPreview,
  CAESAR_SHIFTS,
  type InterceptListEntry,
  type FrequencyEntry,
  type ShiftPreviewRow,
} from './workbench-views.js';

export {
  PlayerViewEngine,
  type PlayerViewEngineDeps,
  type TurnIntent,
  type TurnDriver,
  type SavesController,
  type LoadedGame,
} from './engine-api.js';

export {
  // The saves controller (slice-integration task 9.4; design, "Facade: saves"):
  // the implementation behind the facade's `saves` surface. It lives beside the
  // facade (importing the pure save/load module and the Turn Pipeline's stores)
  // so the facade itself stays off the save -> turn-pipeline -> engine-api import
  // cycle; the Composition Root builds one with `createSavesController` and wires
  // it onto the facade through `PlayerViewEngineDeps.savesController`.
  createSavesController,
  type SaveBridge,
  type SaveBridgeParts,
  type SavesControllerDeps,
} from './saves-controller.js';

export {
  // The per-turn Resolver Context projection (task 7.3): builds the engine's
  // ResolverContext for a turn from Player-View and Case File data plus the
  // turn's Truth draft (claims, arrest/turn evidence, cipher keys, truth).
  projectResolverContext,
  type ResolverProjectionInput,
} from './resolver-projection.js';

export {
  // The concrete Turn Pipeline (task 16.8): `createTurnDriver` builds the
  // `TurnDriver` the facade's `turnDriver` seam holds, running each turn as a
  // Turn Transaction (classify, simulate on a draft, stream through the guards,
  // commit, narrate post-commit, enqueue extraction) with draft discard and
  // retry-from-pre-turn-state on a pre-commit failure. The action log and
  // extraction queue it owns are exposed for the save/load and replay tasks.
  createTurnDriver,
  ActionLog,
  ExtractionQueue,
  type TurnPipelineConfig,
  type ClassifiedIntent,
  type ClassifySeam,
  type VoiceSeam,
  type NarrateSeam,
  type OutcomeSink,
  type ExtractionRunner,
  type ExtractionReady,
  type ExtractionResult,
  type ExtractedClaimShape,
  type ExtractedCaseClaim,
  type ExtractionOutcome,
  type SpeakerKnowledge,
  type SpeakerKnowledgeSeam,
  type EvaluateExtraction,
  type EvaluateExtractionInputs,
  type ChanceLeak,
  type ConsistencyViolation,
  type UnparsedNote,
  type UnparsedNoteSink,
  type EvalLog,
  type QueuedExtraction,
  type ActionLogSnapshot,
  type ExtractionQueueSnapshot,
} from './turn-pipeline.js';

export {
  // The swappable Session (task 7.1; design, "Player View: Session"): the
  // mutable holder of one game's live state the facade and the Turn Pipeline
  // share. `newGame` and `saves.load` build a complete new Session and swap the
  // reference in one assignment. The Truth Store it holds is never projected.
  Session,
  type SessionState,
  type SessionResolverDeps,
  type SessionInit,
  type PausedTurn,
} from './session.js';

export {
  // The claim recorder (task 7.2): the Turn Pipeline step that records an
  // action's Proposition Observations into the Case File as Claims, routing
  // each engine `ObservationSource` through the matching claim module.
  recordObservationClaims,
} from './claim-recorder.js';

export {
  // The Objective Evaluator factory (task 7.4; design, "Player View: Objective
  // Evaluator"; Req 6.1–6.3): builds the engine's `ObjectiveEvaluator` over the
  // current draft and the Case File, deciding each Directive objective kind from
  // the player's own progress (identification, recruitments, granted arrests,
  // collected Intercepts) and never from the Truth Store.
  buildObjectiveEvaluator,
  type ObjectiveEvaluatorInput,
} from './objective-evaluator.js';

export {
  // The action catalogue (task 7.6; design, "Player View: actions catalogue";
  // Req 11.1, 19.3): the pure `buildActionCatalogue` the facade's `actions()`
  // calls. It enumerates every candidate Action for the current situation —
  // travel, talk/approach/surveil/follow, wait, read, intercept, decrypt,
  // cable, task/pay/turn-agent, service-drop and arrest — and pairs each with
  // the engine's `quote`, reading only view/Case File data (never the Truth
  // Store), so a disallowed candidate is marked rather than hidden.
  buildActionCatalogue,
  type EvidenceLookup,
} from './action-catalogue.js';
