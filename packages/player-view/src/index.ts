export * from './lib/player-view.js';

export {
  // Cipher Engine submission vocabulary (task 22.5; Req 9.5). The Workbench
  // component collects the player's decryption attempt as a `KeySubmission` — a
  // guessed cipher key (`CipherSpec`) or a plaintext — and hands it to the
  // `decrypt` action through the facade. The TUI may import only player-view
  // (the truth boundary), so these engine shapes are re-exported here so the
  // client can name the submission it builds without reaching into the engine.
  BOOK_SCHEMES,
  type BookScheme,
  type CipherSpec,
  type KeySubmission,
} from '@tradecraft/engine';

export {
  // Feed composition vocabulary (task 22.14; Req 37.1, 37.2). The Feed composer
  // assembles the player's choice of what a turned agent tells their handler as
  // a list of `FeedItem`s — either a Case File `Claim` picked by its id, or a
  // `ComposedProposition` the player authored from known entities — and hands
  // them to the facade's `validateFeed`. The TUI may import only player-view
  // (the truth boundary, Req 13.5), so these engine shapes are re-exported here
  // so the composer can name the items it builds without reaching into the
  // engine, mirroring the `KeySubmission` re-export above.
  type ComposedProposition,
  type FeedItem,
} from '@tradecraft/engine';

export {
  // Case File (task 4.4)
  CaseFile,
  CLAIM_SOURCE_KINDS,
  aliasResolver,
  computeRelations,
  isAliasPredicate,
  sourceKey,
  type AliasResolver,
  type Claim,
  type CaseFileSnapshot,
  type ClaimInput,
  type ClaimRelation,
  type ClaimSource,
  type ClaimSourceKind,
  type SourceHistory,
  type SourceKey,
} from './lib/casefile/casefile.js';

export {
  // Arrest Evidence (task 4.7)
  aliasClasses,
  evidenceCount,
  hostileMarks,
  implicates,
  implicationRules,
  type BriefView,
  type HostileMark,
  type HostileMarks,
  type Implication,
  type ImplicationRole,
  type ImplicationRules,
} from './lib/casefile/evidence.js';

export {
  // Intercept Claims (task 8.4): file a verified Intercept break's recovered
  // Propositions into the Case File as `intercept`-sourced Claims (Req 9.5).
  addInterceptClaims,
  interceptSource,
  type InterceptBreak,
} from './lib/casefile/intercept-claims.js';

export {
  // Document Claims (task 9.2): file a read Document's asserted Propositions
  // into the Case File as `document`-sourced Claims (Req 30.3, 30.4). The engine
  // reports a Document's Propositions only on the first read, so driving this
  // helper from that result gives Document-reading idempotence (Property 22).
  addDocumentClaims,
  documentSource,
  type DocumentRead,
} from './lib/casefile/document-claims.js';

export {
  // Surveillance Claims (task 11.3): file a surveil/follow's observed
  // Propositions into the Case File as `surveillance`-sourced Claims (Req 23.3,
  // 23.6, 23.7). The engine reports the `LOCATED_AT` sightings and `MEETS_AT`
  // contacts a watch observed (carried as `proposition` Observations); this
  // helper records one Claim per Proposition, sourced to the watched Location.
  addSurveillanceClaims,
  surveillanceSource,
  type SurveillanceResult,
} from './lib/casefile/surveillance-claims.js';

export {
  // Alias Claims (task 11.2): file an identification's reported `IS_ALIAS_OF`
  // Claim into the Case File (Req 23.5). The engine's `identify` records the
  // `unk:`<->`npc:` mapping and reports the Claim to add; this helper records
  // it, sourced to the trigger (a Dossier -> `document`, a face-to-face
  // introduction or an Asset report -> `npc`). The People-view merge then
  // follows for free from the Case File's own alias union-find.
  addAliasClaim,
  aliasClaimSource,
  aliasClaimLink,
} from './lib/casefile/alias-claims.js';

export {
  // Journal (task 16.2): the player's append-only fact log and notes (Req 33.1,
  // 33.2). The store accumulates a committed action's Fact Lines and each
  // delivered event's Fact Lines, plus the player's notes attached to a day,
  // entity or Claim; `journalView` projects it view-safe for the Engine API.
  Journal,
  noteAttachmentKind,
  propositionRefs,
  eventRefs,
  type JournalEntry,
  type JournalNote,
  type JournalDay,
  type JournalPhase,
  type JournalRef,
  type NoteAttachment,
  type NoteAttachmentKind,
  type NoteInput,
} from './lib/journal/journal.js';

export {
  // The Journal projection (task 16.2): builds the view-safe `JournalView`.
  journalView,
} from './lib/journal/view.js';

export {
  // Player aids (task 16.4): the Help view projection (quotes for the current
  // Location plus the glossary; Req 26.5) and the content-driven hints store
  // whose seen flags live in the view, not the Sim (Req 26.6).
  helpView,
} from './lib/aids/help.js';

export {
  HintStore,
  type HintView,
  // The view-side hint trigger definitions (slice-integration task 8.4): the
  // pure `hintTriggers` the Turn Pipeline fires from a committed turn's Player
  // View facts, with the redefined truth-free `cover-suspicion-high` and
  // `plot-deadline-near` (Req 19.10).
  hintTriggers,
  type HintTriggerInput,
  HINT_TRIGGER_ORDER,
  BUDGET_LOW_FRACTION,
  DEADLINE_NEAR_DAYS,
} from './lib/aids/hints.js';

export {
  // Notifications (task 16.6): the pure `notify` over player-visible events with
  // its content templates and player-perspective namer (Req 39.2, 39.3, 39.7),
  // the `raiseDerivedEvents` that surfaces hidden-event consequences from
  // player-side expectations at phase boundaries (Req 39.5), and the view-side
  // `NotificationStore` the status bar reads (Req 39.6).
  notify,
  notificationIdFor,
  notifyNamer,
  notifyDate,
  raiseDerivedEvents,
  NotificationStore,
  type Notification,
  type NotificationBase,
  type NotificationKind,
  type NotifyView,
  type NotifyNamer,
  type DerivedExpectations,
  type MeetingExpectation,
  type DropExpectation,
  type SilenceExpectation,
  type RetainerExpectation,
  type NotificationListener,
} from './lib/notify/index.js';

export {
  // The end-of-game debrief (task 20.2): the pure `buildDebrief` that reveals
  // ground truth once the game has ended (true allegiances, the actual Plot
  // timeline, which Claims were lies, which leads were Side Threads or Rumours,
  // the fed Propositions' chickenfeed/deception classification, Directive
  // results and the player's grading accuracy; Req 8.3, 19.6). The facade's
  // `views.debrief()` returns its `DebriefView` once `ended` is set, else null.
  buildDebrief,
  type DebriefView,
  type DebriefAllegiance,
  type DebriefTimelineEntry,
  type DebriefLie,
  type DebriefLead,
  type DebriefFedProposition,
  type DebriefDirectiveResult,
  type DebriefScore,
  type RecordedFeed,
} from './lib/debrief/debrief.js';

export {
  // Save, load and replay (task 21.1): the versioned `SaveSnapshot`, its Zod
  // schema, and the pure save/load pair. `saveSnapshot` composes the engine
  // state and the Player-View session stores (Journal, Notifications, Flavour
  // cache, action log, extraction queue) into one versioned value;
  // `loadSnapshot` rebuilds them, refusing a save whose format version or
  // Content Manifest differs with a typed `LoadError` (Req 17.1, 17.2, 31.6,
  // 34.3). `parseAndLoad` folds a parse failure into a `corrupt` error.
  SAVE_VERSION,
  SaveSnapshotSchema,
  saveSnapshot,
  loadSnapshot,
  parseAndLoad,
  diffManifests,
  // Version-2 Truth Store (de)serialisation helpers (slice task 9.3): the Truth
  // Store's Maps are stored as sorted entry arrays, so the facade flattens with
  // `toTruthSnapshot` on save and restores the Maps with `fromTruthSnapshot`.
  toTruthSnapshot,
  fromTruthSnapshot,
  type SaveSnapshot,
  type SaveSources,
  type LoadedSession,
  type LoadResult,
  type ManifestDifference,
  type FlavourCacheSnapshotData,
  type TruthSnapshotData,
  type ViewStateSnapshot,
  type PipelineSnapshot,
} from './lib/save/save.js';

export {
  // The in-memory Save Store and the canonical-JSON serialiser the facade's
  // save path uses (slice-integration task 9.4; design, "Facade: saves"). The
  // facade's `saves` surface is defined against the injected `SaveStore` seam so
  // player-view stays I/O-free; the fs store lives in `app`, while tests and the
  // Composition Root's in-memory wiring drive this `InMemorySaveStore`.
  InMemorySaveStore,
  canonicalJson,
  readSaveHeader,
} from './lib/save/in-memory-save-store.js';

export {
  // Store snapshot shapes used by the save file (task 21.1).
  type JournalSnapshot,
} from './lib/journal/journal.js';

export {
  type NotificationStoreSnapshot,
} from './lib/notify/store.js';

export {
  type ActionLogSnapshot,
  type ExtractionQueueSnapshot,
} from './lib/api/index.js';

export {
  // Engine API facade and view projections (task 16.1): the only surface the
  // TUI uses (Req 13.5). The scene, "here" panel, Documents list/reader and
  // Case File projections are implemented here; the Turn Pipeline (16.8) and the
  // other projections are wired behind the facade by sibling tasks.
  PlayerViewEngine,
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
  interceptListView,
  workbenchView,
  frequencyTable,
  caesarShift,
  caesarShiftPreview,
  CAESAR_SHIFTS,
  type InterceptListEntry,
  type FrequencyEntry,
  type ShiftPreviewRow,
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
  type FeedError,
  type PlayerViewEngineDeps,
  type TurnIntent,
  type TurnDriver,
  type SavesController,
  type LoadedGame,
  createSavesController,
  type SaveBridge,
  type SaveBridgeParts,
  type SavesControllerDeps,
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
  type PersonLabel,
  type SceneView,
  type HereView,
  type DocumentListEntry,
  type DocumentListView,
  type DocumentView,
  type ClaimView,
  type CaseFileFilter,
  NARRATION_MODES,
  type NarrationMode,
} from './lib/api/index.js';
