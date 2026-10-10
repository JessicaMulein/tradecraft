export {
  createPrng,
  derive,
  fnv1a32,
  parsePrngState,
  PrngStateSchema,
  seedState,
  type Prng,
  type PrngState,
} from './lib/prng/prng.js';

export {
  // Entity ids
  ENTITY_NAMESPACES,
  isEntityId,
  EntityIdSchema,
  NpcIdSchema,
  LocIdSchema,
  OrgIdSchema,
  ItemIdSchema,
  DocIdSchema,
  ChannelIdSchema,
  UnkIdSchema,
  EvtIdSchema,
  type EntityNamespace,
  type EntityId,
  type NpcId,
  type LocId,
  type OrgId,
  type ItemId,
  type DocId,
  type ChannelId,
  type UnkId,
  type EvtId,
  // Game time
  PHASE_NAMES,
  PHASES_PER_DAY,
  phaseName,
  phaseOrdinal,
  compareTime,
  timeToPhases,
  PhaseSchema,
  GameTimeSchema,
  type Phase,
  type PhaseName,
  type GameTime,
  // Literals and propositions
  LiteralSchema,
  TimeWindowSchema,
  PropositionObjectSchema,
  PropositionSchema,
  type Literal,
  type PredicateId,
  type PropId,
  type TimeWindow,
  type Proposition,
  // Truth brand
  asTruth,
  revealTruth,
  truthSchema,
  type Truth,
  // JSON Schema exports
  CORE_SCHEMA_NAMES,
  jsonSchemaFor,
  coreJsonSchemas,
  type JsonSchema,
  type CoreSchemaName,
} from './lib/model/core.js';

export {
  // Event visibility table (Req 39.1)
  SIM_EVENT_KINDS,
  SIM_EVENT_VISIBILITY,
  visibilityOf,
  isPlayerVisibleKind,
  // Trace origin
  TraceOriginSchema,
  type SimEventKind,
  type EventVisibility,
  type SimEvent,
  type SimEventBase,
  type Weather,
  type TraceOrigin,
  type TraceOriginBody,
  // Action log (Req 17.5)
  type ActionLogEntry,
  type ActionLogEntryBase,
  type ViewOp,
  type Action,
  type NoteInput,
  ADMIRALTY_RELIABILITY,
  ADMIRALTY_CREDIBILITY,
  AdmiraltyGradeSchema,
  formatAdmiraltyGrade,
  type AdmiraltyGrade,
  type AdmiraltyReliability,
  type AdmiraltyCredibility,
  // World state (Req 17.1)
  type WorldState,
  type OutcomeRecord,
  type ItemRef,
  type Skeleton,
  // Skeleton ids and sub-structures (owned/extended by later tasks)
  type DeadDropId,
  type InterceptId,
  type StageId,
  type ThreadId,
  type MeetingId,
  type DirectiveId,
  type TransmissionId,
  type EventId,
  type TurnId,
  type ClaimId,
  type NotificationId,
  type Role,
  type AbortTrigger,
  type Outcome,
  // `City` is exported from the city module below (it owns the real interface).
  type Org,
  type Npc,
  type Relationship,
  type PlotState,
  type SideThreadState,
  type Channel,
  type DeadDrop,
  type Transmission,
  type Intercept,
  type Document,
  type Meeting,
  type KnowledgeSlice,
  type Directive,
  type Ledger,
  type PendingCable,
  type HostileServiceState,
  type CoverIdentity,
  type DifficultyPreset,
  type ScenarioConfig,
  type ContentManifest,
  // The open Talk Scene (`player.scene`; replaces the `SceneState` skeleton)
  RECENT_TURNS,
  type TalkScene,
  type TalkSceneTurn,
  type TalkSceneVia,
  // The Hostile Service's debrief-only feed log (`hostile.feedLog`)
  type FeedLogEntry,
} from './lib/model/state.js';

export {
  // Entity Registry
  AliasSchema,
  EntityEntrySchema,
  EntityRegistryDataSchema,
  EntityRegistry,
  type Alias,
  type EntityEntry,
  type EntityRegistryData,
} from './lib/model/registry.js';

export {
  // Truth Store
  TruthStore,
  EVALUATORS,
  type Allegiance,
  type ClaimTruthRecord,
  type Evaluator,
  type EvaluationContext,
  type PredicateEvaluatorLookup,
  type TruthAccess,
  type TruthReader,
  type TruthStoreData,
  type TruthTransaction,
} from './lib/truth/truth.js';

export {
  // Truth Draft: a turn's Truth Store writes, staged until commit (Req 5.3, 5.4)
  TruthDraft,
} from './lib/truth/truth-draft.js';

export {
  // Budget ledger (Req 28.1, 28.2, 28.3)
  LEDGER_REASONS,
  LedgerReasonSchema,
  LedgerEntrySchema,
  LedgerSchema,
  INSUFFICIENT,
  createLedger,
  balance,
  debit,
  credit,
  payLedgerEffect,
  type LedgerReason,
  type LedgerEntry,
  type Insufficient,
  // The `Ledger` type is re-exported from the state module above, under the
  // name the design and `WorldState.station` use.
} from './lib/station/ledger.js';

export {
  // Station Directives data model (Req 27.2). The `Directive` and `DirectiveId`
  // types are re-exported from the state module above (under the names
  // WorldState.station.directives uses); the objective enum and the status/kind
  // values live here in the dependency-light leaf.
  DIRECTIVE_OBJECTIVE_KINDS,
  DIRECTIVE_STATUSES,
  type DirectiveObjective,
  type DirectiveObjectiveKind,
  type DirectiveStatus,
  // The `Directive` type itself is exported from the state module above.
} from './lib/station/directive-types.js';

export {
  // Checking Directives each phase and moving Standing (Req 27.2, 27.3). The
  // pure `checkDirectives` evaluates each active Directive's objective against
  // an injected evaluator (the truth-boundary seam the Turn Pipeline fills),
  // marks met/failed by the deadline, moves Standing by the reward, and emits
  // player-visible `directive` SimEvents.
  checkDirectives,
  type ObjectiveEvaluator,
  type DirectiveStationSlice,
  type CheckDirectivesResult,
} from './lib/station/directives.js';

export {
  // Station Cable reply spec (Req 27.4, 27.5). The `PendingCable` type is
  // re-exported from the state module above (under the name
  // WorldState.station.pendingCables uses); the reply spec lives here in the
  // dependency-light leaf.
  type CableReplySpec,
  // The `PendingCable` type itself is exported from the state module above.
} from './lib/station/cable-types.js';

export {
  // Station Cables: submitting trace/funds/report requests and delivering their
  // replies after the preset delay (Req 27.4, 27.5). `submitCable` builds the
  // PendingCable (reply due at now + the preset `traceRequestDelayPhases`);
  // `processDueCables` delivers every now-due reply — a funds grant credits the
  // ledger (Standing-scaled, capped, once per two days), a report moves
  // Standing, a trace carries its Dossier target out — each as a `cable`
  // SimEvent. The funds-grant maths and the cooldown gate are exposed as pure
  // helpers; the delay/funds/standing defaults are documented constants.
  DEFAULT_CABLE_DELAY_PHASES,
  DEFAULT_FUNDS_BASE,
  DEFAULT_FUNDS_CAP,
  FUNDS_COOLDOWN_DAYS,
  REPORT_STANDING_DELTA,
  submitCable,
  processDueCables,
  fundsGrantAmount,
  fundsCooldownElapsed,
  type SubmitCableOptions,
  type CableReply,
  type CableStationSlice,
  type FundsPolicy,
  type ProcessDueCablesResult,
} from './lib/station/cables.js';

export {
  // Scenario config schema (Req 34.1, 41.1)
  ScenarioConfigSchema,
  DifficultySelectionSchema,
  DifficultyOverridesSchema,
  SettingConfigSchema,
  PacksConfigSchema,
  NarrationModeSchema,
  NARRATION_MODES,
  RecruitmentWeightsSchema,
  RetriesConfigSchema,
  MetricsConfigSchema,
  RegionConfigSchema,
  RegionalPresetOverridesSchema,
  StationModelSchema,
  STATION_MODELS,
  scenarioForStore,
  type NarrationMode,
  type StationModel,
  // ScenarioConfig type is re-exported from the state module above.
} from './lib/config/scenario-config.js';

export {
  // Scenario config loader (Req 41.1, 41.2, 41.3)
  parseScenarioConfig,
  loadScenarioConfig,
  formatConfigIssues,
  type ConfigIssue,
  type LoadResult as ConfigLoadResult,
  type ResolvedScenario,
  type ScenarioResolutionContext,
  type SettingCity,
} from './lib/config/load-scenario-config.js';

export {
  // Cipher Engine: the five ciphers as pure functions (Req 9.2, 9.3)
  CIPHERS,
  caesarCipher,
  vigenereCipher,
  columnarCipher,
  bookCipher,
  otpCipher,
  encrypt,
  decrypt,
  type Cipher,
  type CipherKey,
  type CipherKind,
} from './lib/cipher/cipher.js';

export {
  // City model: Districts, Locations, Routes, pure crowdLevel and travelCost,
  // and the daily weather draw (Req 21.1, 21.2, 21.6).
  CROWD_LEVELS,
  crowdLevel,
  crowdAt,
  weatherTagsFor,
  travelCost,
  weatherForDay,
  dailyStreamSeed,
  DAILY_STREAM_BASE,
  type City,
  type CrowdLevel,
  type CrowdModel,
  type District,
  type DistrictId,
  type Location,
  type Route,
  // The engine-side Weather is exported under an alias so it does not clash
  // with the `Weather` event payload re-exported from the state module.
  type Weather as CityWeather,
} from './lib/city/city.js';
export {
  calendarLabel,
  calendarMonth,
  dayOffReason,
  publicHoliday,
  scheduleWeekdayIndex,
} from './lib/city/calendar.js';

export {
  // Organisations and Principal NPCs: the real Org/Npc shapes (Req 1.1, 1.3,
  // 27.1). The `Org` and `Npc` types are re-exported from the state module
  // above (under the names WorldState uses); the supporting shapes live here.
  ALLEGIANCE_CATEGORIES,
  ORG_KINDS,
  NPC_STATUSES,
  scheduledLocation,
  type AllegianceCategory,
  type OrgKind,
  type MiceProfile,
  type Persona,
  type Descriptor,
  type ScheduleEntry,
  type NpcSchedule,
  type NpcStatus,
} from './lib/city/npc.js';

export {
  // Organisation and Principal-NPC generation (Req 1.1, 1.3, 27.1)
  generateOrgs,
  generatePrincipals,
  moneyNeedOf,
  STATION_ORG_ID,
  HOSTILE_ORG_ID,
  CELL_ORG_ID,
  CELL_ROLE_IDS,
  HOSTILE_ROLE_IDS,
  CHIEF_ROLE_ID,
  STAFF_ROLE_IDS,
  CONTACT_ROLE_IDS,
  MIN_STAFF,
  MAX_STAFF,
  MIN_CONTACTS,
  MAX_CONTACTS,
  MAX_MONEY_NEED,
  MIN_MONEY_NEED,
  type GeneratedOrgs,
  type GeneratedPrincipals,
  type NpcAllegiance,
} from './lib/city/principals.js';

export {
  // Plot instantiation: the stage DAG from a Plot template (Req 1.1, 3.2, 3.3).
  // `PlotState` and `StageId` are re-exported from the state module above
  // (under the names WorldState and TraceOrigin use); the supporting shapes,
  // the generator and the helpers live here.
  generatePlot,
  chooseTemplate,
  deadlinesNonDecreasing,
  STAGE_STATUSES,
  INITIAL_ABORT_PRESSURE,
  CELL_ARCHETYPE_IDS,
  type StageState,
  type StageStatus,
  type StageTrace,
  type TraceKind,
  type TraceChannelKind,
  type TracePlace,
  type DisruptionWeights,
  type RoleBinding,
  type MaterielBinding,
  type TargetBinding,
  type GeneratedPlot,
} from './lib/city/plot.js';

export {
  // Channels and Dead Drops generation (Req 24.5, 25.1). The `Channel` and
  // `DeadDrop` types are re-exported from the state module above (under the
  // names WorldState uses); the supporting shapes, the generator and the
  // helpers live here.
  CHANNEL_KINDS,
  MIN_CHANNEL_PERIOD,
  MAX_CHANNEL_PERIOD,
  generateComms,
  withDeadDropSites,
  deadDropLocations,
  isInterceptableKind,
  isWellFormedSchedule,
  transmissionTimes,
  ownerIsReal,
  compareScheduleStart,
  type ChannelKind,
  type ChannelSchedule,
  type CommsOwner,
  type GeneratedComms,
} from './lib/city/comms.js';

export {
  // Knowledge assignment: NPC/Station Knowledge Slices, Cover Stories, Agendas
  // and the internal mole (Req 1.3, 1.5, 26.2). The `KnowledgeSlice` type is
  // re-exported from the state module above (under the name
  // WorldState.station.knowledge uses); the supporting shapes, the generator
  // and the helpers live here.
  assignKnowledge,
  slicePropsAreKnown,
  CELL_ROLE_PROXIMITY,
  CELL_ROLE_ARCHETYPES,
  HOSTILE_ROLE_ARCHETYPES,
  type CoverStory,
  type Agenda,
  type NpcKnowledge,
  type MoleAssignment,
  type GeneratedKnowledge,
  type KnowledgePreset,
  type AssignKnowledgeOptions,
} from './lib/city/knowledge.js';

export {
  // Cover Identity and the Starting Brief (Req 26.1, 26.2, 26.4). The
  // `CoverIdentity` type is re-exported from the state module above (under the
  // name WorldState.player.cover uses); the Starting Brief shapes, the
  // generators and the helpers live here.
  MIN_BRIEF_LEADS,
  MAX_BRIEF_LEADS,
  BRIEF_STREAM_INDEX,
  generateCoverIdentity,
  generateStartingBrief,
  type CoverSuspicionModifiers,
  type BriefDirective,
  type BriefLead,
  type BriefLeadSource,
  type StartingBrief,
  type StartingBriefPreset,
  type GenerateStartingBriefOptions,
  type GeneratedStartingBrief,
} from './lib/city/starting-brief.js';

export {
  // Discovery-path verifier (Req 1.4, 26.3, 27.6). The pure verifier the
  // generator's step 10 runs: it builds the learnability graph rooted at the
  // Starting Brief and checks for two node-disjoint human/signal paths per Plot
  // Stage key fact and (when enabled) the mole identity. `discoveryPathsHold`
  // is the thin retry predicate task 5.9's `derive(seed, attempt)` loop drives.
  DISCOVERY_EDGE_KINDS,
  isHumanEdge,
  isSignalEdge,
  witnessesDisjoint,
  propKey,
  discoveryRoot,
  verifyDiscoveryPaths,
  discoveryPathsHold,
  type DiscoveryEdgeKind,
  type PathWitness,
  type PropKey,
  type DiscoveryTargetKind,
  type TargetReport,
  type FailedTarget,
  type SingleRouteTarget,
  type DiscoveryRoot,
  type DiscoveryResult,
  type DiscoveryInputs,
} from './lib/city/discovery.js';

export {
  // City generation (Req 21.1, 21.2, 21.8)
  generateCity,
  MIN_DISTRICTS,
  MAX_DISTRICTS,
  MIN_LOCATIONS,
  MAX_LOCATIONS,
  DEFAULT_START_MONTH,
  type GenerateCityOptions,
  type GeneratedCity,
} from './lib/city/generate.js';

export {
  // Engine <-> content time mapping (four-phase clock vs. eight-phase content)
  CONTENT_PHASES,
  CONTENT_WEEKDAYS,
  CONTENT_PHASES_BY_ENGINE_PHASE,
  ENGINE_PHASE_BY_CONTENT_PHASE,
  enginePhaseOf,
  contentPhasesOf,
  weekdayForDay,
  weekdayOf,
  monthForDay,
  DAYS_PER_MONTH,
  MONTHS_PER_YEAR,
  type ContentPhase,
  type Weekday,
} from './lib/city/time-mapping.js';

export {
  // Cipher Engine: predicate-keyed field messages (Req 9.1, 32.3)
  encodePropositions,
  parseFieldMessage,
  type FieldCodeLookup,
  type FieldCodeSource,
} from './lib/cipher/field-message.js';

export {
  // Cipher Engine: game-facing spec, key submission and resolution
  BOOK_SCHEMES,
  CipherSpecSchema,
  KeySubmissionSchema,
  resolveCipherSpec,
  type BookScheme,
  type CipherSpec,
  type KeySubmission,
  type CipherKeyLookup,
} from './lib/cipher/spec.js';

export {
  // Cipher Engine: Intercept generation from transmissions (Req 9.1, 9.4, 29.4).
  // The `Intercept` type is re-exported from the state module above (under the
  // name WorldState.intercepts uses); the generator, the per-owner cipher
  // weighting, the tradecraft-error and metadata shapes, and the fidelity
  // round-trip helper live here.
  generateIntercepts,
  weightedCipherKinds,
  revealedSpec,
  decryptToFieldMessage,
  INTERCEPT_OWNER_KINDS,
  INTERCEPT_ORIGINS,
  OWNER_CIPHER_WEIGHTS,
  CIPHER_KEYWORDS,
  CIPHER_WEIGHT_ORDER,
  FIXED_HEADER_CRIB,
  type InterceptOwnerKind,
  type InterceptOriginKind,
  type CipherWeights,
  type TradecraftError,
  type InterceptMeta,
  interceptIdOf,
  buildTransmissions,
  type InterceptSource,
  type GenerateInterceptsInputs,
  type GeneratedIntercepts,
  // The `Intercept` and `Transmission` types are exported from the state module
  // above (under the names WorldState.intercepts/transmissions use).
} from './lib/cipher/intercept.js';

export {
  // Cipher Engine: world-assembly Intercept seeding (task 26.3; Req 9.1, 9.5,
  // 25.3, 29.2, 29.4). Mints the real ciphertext Intercepts for a generated
  // world's interceptable firings (Plot Stage traces, Side Thread traces, Noise
  // Traffic Channels) and pairs them into Transmissions. `worldCipherKeyLookup`
  // rebuilds the book/pad key material deterministically for verification;
  // `plotTraceInterceptId` is the id a Plot `transmission` SimEvent references.
  seedWorldIntercepts,
  worldCipherKeyLookup,
  publicTextIdsOf,
  padPoolIds,
  derivePad,
  plotTransmissionId,
  sideThreadTransmissionId,
  noiseTransmissionId,
  plotTraceInterceptId,
  CIPHER_STREAM_BASE,
  SEED_HORIZON_DAYS,
  type SeedInterceptsInputs,
  type SeededIntercepts,
} from './lib/cipher/world-intercepts.js';

export {
  // Cipher Engine: verifying a player's decryption attempt against an
  // Intercept's ground truth (Req 9.5). The verification reads Truth, so it is
  // a Sim operation; only its result (recovered Propositions, or a bare
  // rejection) crosses into the Player View.
  verifySubmission,
  type VerifyResult,
} from './lib/cipher/verify.js';

export {
  // Document model and composers (Req 26.1, 27.4, 30.1, 30.3, 30.5). The
  // `Document` type is re-exported from the state module above (under the name
  // WorldState.documents uses); the real interface and its kinds live here.
  DOCUMENT_KINDS,
  countLetters,
  docId,
  slugify as docSlugify,
  type ComposedDocument,
  type DocumentKind,
  // The `Document` type itself is exported from the state module above.
} from './lib/docs/document.js';

export {
  // The player-perspective namer the composers render templates with.
  formatDate,
  playerNamer,
  type NamerContext,
} from './lib/docs/namer.js';

export {
  // Shared Document rendering helpers.
  FIRST_PICK_RNG,
  compileSections,
  renderString,
  renderTitle,
} from './lib/docs/render.js';

export {
  // Dossier composer (Req 26.1): an HQ file from the Station Knowledge Slice.
  composeDossier,
  slicePropsAbout,
  type DossierContext,
} from './lib/docs/dossier.js';

export {
  // Cable composer (Req 27.4, 26.1/26.4): period telegraphic HQ/field cables.
  composeCable,
  type CableContext,
  type CableFields,
} from './lib/docs/cable.js';

export {
  // Public-text composer (Req 30.1, 30.3, 30.5): keyable, obtainable corpora.
  DEFAULT_MIN_KEY_LETTERS,
  PUBLIC_TEXT_LOCATION_TYPES,
  composePublicTexts,
  corpusBody,
  extendToKeyLength,
  publicTextLocations,
  type PublicTextOptions,
} from './lib/docs/public-text.js';

export {
  // Newspaper and seized-material composers (Req 30.1, 30.2). `composeNewspaper`
  // draws 3–6 articles on the daily stream from the day's city events, public
  // Plot traces, Side-Thread traces and Rumours — a mix of true and false
  // Propositions, so reading the edition seeds the Case File with every printed
  // Claim and the player must corroborate which are real. `composeSeizedDocument`
  // composes a `seized`-kind Document from captured material (a courier's
  // papers, a notebook, drop contents), asserting the material's Propositions.
  // `newspaperDayBoundaryHook` adapts the composer into the clock's `newspaper`
  // day-boundary hook, threading the composed edition out through a
  // `NewspaperCell` for the Turn Pipeline to register and emitting a `newspaper`
  // SimEvent.
  MIN_ARTICLES,
  MAX_ARTICLES,
  EMPTY_MATERIAL,
  cityWeatherItem,
  dailyMaterial,
  newspaperPool,
  selectArticles,
  composeNewspaper,
  composeSeizedDocument,
  newspaperCell,
  newspaperDayBoundaryHook,
  type NewspaperItem,
  type NewspaperSource,
  type NewspaperMaterial,
  type NewspaperContext,
  type SeizedFields,
  type SeizedContext,
  type NewspaperCell,
  type NewspaperHookContext,
  type NewspaperMaterialFor,
} from './lib/docs/newspaper.js';

export {
  // Game clock: the four-phase daily time line's pure time arithmetic
  // (`addPhases`, `isDayStart`) and the day-boundary hook contract (Req 3.1).
  // The world-advancing clock the Turn Pipeline runs is `advanceWorld` (below);
  // the deprecated events-only day-boundary adapters match `ClockHooks` /
  // `DayBoundaryHook` / `HookContext`, fired in `DAY_BOUNDARY_HOOK_ORDER`.
  addPhases,
  isDayStart,
  DAY_BOUNDARY_HOOK_ORDER,
  type HookContext,
  type DayBoundaryHook,
  type ClockHooks,
} from './lib/clock/clock.js';

export {
  // Plot Stage execution (Req 3.2, 3.3, 3.4): the pure `executePlotDay` that
  // advances the running Plot through its stages by deadline/prerequisite,
  // turns an executed stage's trace templates into hidden Sim events (meetings,
  // transmissions, dead-drop loads/empties, movements) with a `plot`
  // TraceOrigin, and answers disruption by delay / reroute / abort on the
  // runtime stream. `plotDayBoundaryHook` adapts it into the clock's `plot`
  // day-boundary hook. The global abort-pressure tally and `WorldState.ended`
  // are left to task 7.4, which reads the `PlotDayResult.outcome` seam.
  DELAY_DAYS,
  NO_DISRUPTION,
  classifyTrace,
  drawDisruption,
  executePlotDay,
  plotDayBoundaryHook,
  plotIsComplete,
  pendingStages,
  earliest,
  type TraceEventKind,
  type PlotWorld,
  type DisruptionContext,
  type StageOutcome,
  type PlotDayResult,
  type ExecutePlotDayOptions,
  type PlotStateCell,
} from './lib/clock/plot-execution.js';

export {
  // The live Disruption Context (slice-integration Req 4.1–4.4), built from the
  // Draft each time the Plot hook runs. `isArrested` reads `npcs[npc].status`
  // (arrested or fled), a running Station or Hostile custody hold, and the
  // Station's arrest record (`player.arrests`, by NPC id or `unk:` id).
  // `isChannelCompromised` reads `hostile.beliefs.compromisedChannels`, and
  // `isMaterielSeized` reads `plot.materielSeized`.
  liveDisruption,
} from './lib/clock/disruption.js';

export {
  // The shared types of the world-advancing clock (slice-integration design,
  // "Engine: advanceWorld"): the Day-Boundary Hook context, the
  // state-and-events a hook returns, the hook table keyed by
  // `DAY_BOUNDARY_HOOK_ORDER`, the dependencies `advanceWorld` threads through
  // the hooks and the Phase Step, and the per-day scratch one hook hands to a
  // later one (`newDayScratch` makes a fresh one).
  newDayScratch,
  type DayScratch,
  type WorldHookContext,
  type HookOutput,
  type WorldHook,
  type WorldHooks,
  type AdvanceWorldDeps,
} from './lib/clock/world-types.js';

export {
  // The production Day-Boundary Hooks (task 4.6; slice-integration design,
  // "Engine: Day-Boundary Hooks"): `buildWorldHooks()` returns the four
  // reducers (`plot`, `schedules`, `hostileTick`, `newspaper`) `advanceWorld`
  // runs in `DAY_BOUNDARY_HOOK_ORDER`. The `plot` and `hostileTick` hooks
  // encapsulate the Day-Boundary abort check; `worldAbortCheck` runs the same
  // check explicitly (Req 4.5).
  buildWorldHooks,
  worldAbortCheck,
} from './lib/clock/world-hooks.js';

export {
  // NPC schedule advancement and Walk-ins on the daily stream (Req 3.5, 22.7).
  // `advanceSchedules` is the pure per-step function emitting hidden `npc-moved`
  // events for NPCs whose scheduled Location changed between two times (no
  // draws); `rollWalkIn` draws the day's Walk-in on the passed daily stream,
  // emitting a hidden `walk-in-approach` (ground-truth genuineness) and a
  // player-visible `walk-in` notification. `schedulesDayBoundaryHook` adapts
  // both into the clock's `schedules` day-boundary hook. `whereaboutsAt` is
  // every NPC's scheduled position at a time, the shape of
  // `WorldState.whereabouts`.
  DEFAULT_WALK_IN_PROBABILITY,
  DEFAULT_GENUINE_PROBABILITY,
  scheduledLocationAt,
  whereaboutsAt,
  advanceSchedules,
  rollWalkIn,
  schedulesDayBoundaryHook,
  type WalkInOptions,
  type WalkInResult,
  type SchedulesWorld,
} from './lib/clock/schedules.js';

export {
  // The Phase Step (slice-integration Req 1.2–1.9, 6.4): the per-phase work
  // `advanceWorld` runs on the Draft for each phase entered, in a fixed order:
  // schedules and `whereabouts`, meeting slots, Cable replies, Directive
  // checks, retainer decay, the off-screen consequences, and Station Custody
  // release. `pinnedWhereabouts` is where an out-of-play NPC is held.
  phaseStep,
  pinnedWhereabouts,
  DEFAULT_FUNDS_POLICY,
  type PhaseStepDeps,
  type PhaseStepResult,
} from './lib/clock/phase-step.js';

export {
  // The world-advancing clock (slice-integration Req 1.1, 1.4, 1.9, 1.10, 2.1,
  // 2.6, 2.7, 2.8, 7.1, 7.5): `advanceWorld` steps the Draft World State phase
  // by phase, running the Day-Boundary Hooks (weather set on the daily stream,
  // then the hooks in `DAY_BOUNDARY_HOOK_ORDER`) and the Phase Step at each
  // phase, checking `detectEnd` after each sub-step and stopping early on an
  // End Condition or a kept meeting's opened scene. The Turn Pipeline calls it
  // in place of the events-only `advance`.
  advanceWorld,
  type AdvanceWorldResult,
} from './lib/clock/advance-world.js';

export {
  // Plot abort (Req 19.4, 38.1, 38.2, 38.4, 38.5, 38.6): the doctrine
  // thresholds, the pure `abortCheck`, the distinct-key pressure accounting,
  // the belief-driven (19.6) and materiel-seizure (11.6) hooks, and the
  // Turn-Pipeline abort seam (`applyAbort`/`considerPlotDay`) that emits the
  // hidden `plot-aborted` event and the `WorldState.ended` success intent.
  // `AbortTrigger` is re-exported from the state module above.
  ABORT_END_OUTCOME,
  abortTolerance,
  leaderAbortThreshold,
  abortCheck,
  accruePressure,
  applyBeliefPressure,
  disruptionKey,
  applyAbort,
  considerPlotDay,
  type Doctrine,
  type AbortCheckContext,
  type EndedIntent,
  type AbortDecision,
  type DayAbortResult,
} from './lib/clock/plot-abort.js';

export {
  // Hostile Service doctrine (Req 12.1): the three-dimension `Doctrine` and the
  // pure, deterministic `drawDoctrine` that samples riskTolerance /
  // securityConsciousness / deceptionAppetite from a preset's ranges. The
  // doctrine's `riskTolerance` is a structural supertype of the abort module's
  // one-field `Doctrine`, so the live doctrine threads straight into the abort
  // maths. `Doctrine` is exported here under the alias `HostileDoctrine` so it
  // does not clash with the abort module's one-field `Doctrine` above.
  drawDoctrine,
  type Doctrine as HostileDoctrine,
  type DoctrineRange,
  type DoctrineRanges,
} from './lib/hostile/doctrine.js';

export {
  // Hostile Service belief model and per-Asset Exposure tracking (Req 12.2):
  // the `HostileBeliefs` state and the pure transitions over it — Exposure
  // accrual, agent-suspicion raises, belief adoption (deduped once per belief
  // key for the adaptation and Abort-Pressure consumers) and the detection
  // read `effectiveExposure`.
  emptyHostileBeliefs,
  accrueExposure,
  raiseAgentSuspicion,
  effectiveExposure,
  beliefKey,
  adoptBelief,
  markSuspected,
  markChannelCompromised,
  type HostileBeliefs,
  type AdoptResult,
} from './lib/hostile/beliefs.js';

export {
  // Hostile Service daily detection and the arrest/double/feed response
  // selection (Req 12.2, 12.3): the pure `detectionProbability`, the
  // doctrine-driven `chooseResponse`, and `runDetection` — the per-day pass that
  // draws one coin per not-yet-detected Asset and chooses a response on a hit.
  detectionProbability,
  chooseResponse,
  runDetection,
  BLOWN_AGENT_SUSPICION,
  type DetectionBase,
  type DetectionResponse,
  type ResponseContext,
  type DetectionCandidate,
  type Detection,
  type DetectionResult,
} from './lib/hostile/detection.js';

export {
  // The Hostile Service's running state and daily tick (Req 12.1, 12.2, 12.3).
  // `initialHostileServiceState` draws the doctrine at generation; `dailyTick`/
  // `dailyTickWithBase` run the counter-intelligence detection pass (steps 1–2
  // of the design's dailyTick) and emit the hidden asset-detected / arrested /
  // doubled events; `hostileDayBoundaryHook` adapts the tick into the clock's
  // `hostileTick` day-boundary hook. The `HostileServiceState` type is
  // re-exported from the state module above (under the name WorldState.hostile
  // uses); the state factory, the tick and the hook adapter live here.
  initialHostileServiceState,
  dailyTick,
  dailyTickWithBase,
  dailyTickFull,
  hostileDayBoundaryHook,
  DEFAULT_DETECTION_BASE,
  // Dangle / Walk-in management (step 4; Req 11.1, 11.2, 22.7).
  classifyWalkIn,
  readWalkIns,
  // Doubling the player's Assets + Chickenfeed (steps 2/5; Req 11.3, 11.4, 11.5).
  chickenfeedCount,
  selectChickenfeed,
  decideDoubling,
  MAX_CHICKENFEED_ITEMS,
  // Belief-driven Plot adaptation (step 5; Req 11.4, 11.5).
  classifyBelief,
  adaptToBeliefs,
  // Mole report ingestion (step 3; Req 12.4) and player tailing / burn
  // threshold (step 6; Req 12.5, 21.4) — task 19.3. `ingestMoleReport` folds the
  // Station's known/suspected Propositions the mole relays into belief adoption;
  // `decideTailing` / `tailingThresholds` start/end a tail of the player from
  // Cover Suspicion and burn the player when it crosses the preset threshold.
  ingestMoleReport,
  decideTailing,
  tailingThresholds,
  DEFAULT_TAIL_SUSPICION_DELTA,
  DEFAULT_TAIL_START,
  TAIL_START_SECURITY_SPAN,
  TAIL_HYSTERESIS,
  type MoleReport,
  type MoleReportResult,
  type TailingThresholds,
  type TailingInputs,
  type TailingDecision,
  type TailingResult,
  // Off-screen consequences of the hidden events (task 19.5; Req 39.4, 39.5):
  // the arrested Asset's voided meetings/drops (consumed by player-view's 16.6)
  // and the public arrest article gated by `1 − deceptionAppetite`.
  arrestConsequences,
  arrestArticles,
  arrestArticle,
  buildArrestArticle,
  arrestArticleProbability,
  type ArrestConsequences,
  type VoidedMeeting,
  type VoidedDrop,
  type AssetCommitments,
  type CommitmentProjection,
  type ArrestArticleContext,
  type ArrestArticleProjection,
  // Hostile Service newspaper plants (task 19.4; Req 30.2): the false stories a
  // deception-happy service plants in the day's paper, gated/weighted by
  // `deceptionAppetite`, returned as `rumour`-source NewspaperItems the Turn
  // Pipeline folds into the day's newspaper material.
  planNewspaperPlants,
  buildPlantItem,
  plantCount,
  plantProbability,
  MAX_PLANTS_PER_DAY,
  type PlantCandidate,
  type PlantProjection,
  // The Hostile Service's daily comms traffic for the Cipher Engine (task 19.4;
  // Req 29.4): the service's interceptable transmissions on its channels today,
  // produced as InterceptSource data (origin 'deception') the Turn Pipeline
  // threads into the Cipher Engine's intercept path. A pure, draw-free producer.
  produceCommsTraffic,
  decoyProposition,
  hostileTransmissionId,
  type HostileChannel,
  type HostileChannelProjection,
  type HostileOwnerKind,
  type DailyTickResult,
  type HostileWorld,
  type FullTickInputs,
  type FullTickResult,
  type ChickenfeedPool,
  type WalkInClassification,
  type WalkInApproach,
  type WalkInReading,
  type ChickenfeedCandidate,
  type Chickenfeed,
  type DoublingDecision,
  type AdaptationContext,
  type AdaptationKind,
  type AdaptationResult,
  // Feed ingestion (task 19.6; Req 37.3, 37.4, 37.5): the pure `ingestFeed`
  // that classifies each fed Proposition (chickenfeed/deception), moves the
  // agent's credibility by confirm/refute, adopts the unverifiable ones above
  // the doctrine `adoptionThreshold`, and marks a credible feed's Plot Channels
  // compromised. Threaded into `dailyTickFull`'s step-5 region via
  // `FullTickInputs.feeds`.
  ingestFeed,
  adoptionThreshold,
  CONFIRM_CREDIBILITY,
  REFUTE_CREDIBILITY,
  REFUTE_SUSPICION,
  type FedProposition,
  type FeedDelivery,
  type FeedClass,
  type IngestFeedResult,
  // The `HostileServiceState` type itself is exported from the state module.
} from './lib/hostile/hostile.js';

export {
  // The Hostile Full Tick's projection and application (slice-integration
  // Req 3): `projectFullTick` builds `dailyTickFull`'s inputs from the Draft
  // and the turn's Truth Store, and `applyFullTick` writes its result back to
  // the Draft (Hostile state, arrests, doublings, Plot adaptation, voided
  // meetings, tailing and the burn, minted comms traffic, the feed log) and
  // hands the day's plants and arrest articles to the newspaper hook.
  projectFullTick,
  applyFullTick,
  PLANT_HEADLINE,
  plantSummary,
  PRIOR_TRUST_FLOOR,
  PRIOR_TRUST_CEILING,
  type FullTickProjection,
  type FullTickProjectionDeps,
  type FullTickApplyContext,
} from './lib/hostile/project.js';

export {
  // World generator entry point (Req 1.2, 1.6): the capstone that wires the
  // core-stream steps (5.1–5.8) into one pure `generate()` producing a
  // `WorldState`, with the discovery-path verifier as the acceptance gate and a
  // `derive(seed, attempt)` retry loop. Also the PRNG stream registry
  // constants, the attempt limit, the `GeneratorError` thrown after it, the
  // generator version, and the impure `randomSeed` sibling (kept out of the
  // pure path).
  generate,
  settingGeography,
  // `generateGame` is `generate`'s full form (Req 1.5, 2.1, 27.6): it returns
  // both the `WorldState` and the Truth Store seeded with every core and noise
  // ground-truth Proposition (memberships, the mole's facts, Plot and Side
  // Thread facts) plus the mole's true allegiance, so `holds` answers from the
  // first turn. `seedTruthStore` is the standalone seeder it uses.
  generateGame,
  seedTruthStore,
  randomSeed,
  GeneratorError,
  GENERATOR_VERSION,
  MAX_GENERATION_ATTEMPTS,
  MAX_NOISE_ATTEMPTS,
  MAX_AMBIENT_ATTEMPTS,
  MAX_SETTING_ATTEMPTS,
  NOISE_STREAM_BASE,
  HOSTILE_STREAM_BASE,
  REGION_STREAM_BASE,
  // DAILY_STREAM_BASE is already exported from the city module above; the
  // generator re-exports it only to document the stream registry in one place,
  // so it is not re-exported again here to avoid a duplicate export.
  type GenerateInputs,
  type GenerateOptions,
  type GenerateResult,
  type DiscoveryVerifier,
} from './lib/generate.js';

export {
  fallbackSelect,
  selectPlot,
  toTemplateHistory,
  type PlotSelectHistory,
  type PostingPlotSelection,
} from './lib/plot-select.js';

export {
  CARRY_ATTEMPTS,
  CARRY_STREAM_BASE,
  CARRY_STREAM_LIMIT,
  ARC_STREAM_BASE,
  arcStreamSeed,
  carryStreamSeed,
} from './lib/carry/streams.js';
export {
  applyPostingCarry,
  serviceDisplayName,
  type CarryCore,
  type CarryFailure,
} from './lib/carry/apply.js';
export {
  arcDropId,
  nextCarryDrop,
  type ArcClueSpec,
  type ArcThreadSpec,
  type CarryIn,
  type CarryModifiers,
  type CarryState,
  type CarriedPerson,
  type CarriedPlacement,
  type PersonalFileInput,
  type PlacementRole,
  type PlayerHistoryInput,
  type PostingContext,
  type RequisitionEffect,
} from './lib/carry/types.js';
export {
  applyRecogniserPass,
  npcsAt,
  queueCarryLines,
  seenBeforeFactLine,
  takeCarryLines,
  type RecogniserPass,
} from './lib/carry/recognise.js';

export {
  // Noise generator, step 1: Background NPCs from civilian archetypes
  // (Req 29.1). A pure, standalone generator on the noise stream that task 6.4
  // wires into generate()'s noise step; it adds civilian NPCs with schedules at
  // public Locations and a lightweight local-facts Knowledge Slice.
  generateBackgroundNpcs,
  civilianArchetypes,
  MIN_BACKGROUND_NPCS,
  DEFAULT_BACKGROUND_NPCS,
  BACKGROUND_ID_PREFIX,
  NEUTRAL_ORG_ID,
  type LocalKnowledgeSlice,
  type BackgroundNpc,
  type GeneratedBackgroundNpcs,
} from './lib/noise/background.js';

export {
  // Noise generator, step 2: Side Threads from templates (Req 29.2). A pure,
  // standalone generator on the noise stream that task 6.4 wires into
  // generate()'s noise step; it adds self-contained minor storylines with no
  // Cell participants, each carrying its own true Propositions, traces and
  // noise-traffic Channel(s). The `SideThreadState` and `ThreadId` types are
  // re-exported from the state module above (under the names WorldState and
  // TraceOrigin use); the generator, the supporting shapes, the result type and
  // the count constants live here.
  generateSideThreads,
  sideThreadTemplates,
  sideThreadParticipantPool,
  isSideThreadEligible,
  threadHasNoCellOrHostile,
  threadPropositionEntities,
  MIN_SIDE_THREADS,
  DEFAULT_SIDE_THREADS,
  THREAD_ID_PREFIX,
  MIN_THREAD_PARTICIPANTS,
  MAX_THREAD_PARTICIPANTS,
  type SideThreadTrace,
  type GeneratedSideThreads,
  // The `SideThreadState` and `ThreadId` types are exported from the state
  // module above, under the names WorldState.sideThreads and TraceOrigin use.
} from './lib/noise/side-threads.js';

export {
  // Noise generator, steps 3 and 4: Rumours as Background-NPC false beliefs
  // (Req 29.3) and Noise Traffic Channels at the preset ratio (Req 29.4). Pure,
  // standalone generators on the noise stream that task 6.4 wires into
  // generate()'s noise step. Rumours distort a Plot/Side-Thread/local source
  // Proposition (swap subject, shift day, invent target) into a false belief a
  // Background NPC holds and newspapers may carry; Noise Traffic mints
  // diplomatic/commercial/criminal decoy Channels owned by non-colliding
  // `org:noise-<family>` sources, counted at the preset `noise : plot` ratio.
  generateRumours,
  generateNoiseTraffic,
  rumourTemplates,
  rumourSourcePool,
  noiseTrafficCount,
  noiseOrgId,
  isNoiseOwner,
  rumourEntities,
  RUMOUR_PROP_PREFIX,
  MAX_RUMOUR_DAY,
  NOISE_TRAFFIC_FAMILIES,
  NOISE_TRAFFIC_OWNERS,
  NOISE_TRAFFIC_KINDS,
  type Rumour,
  type RumourDistortion,
  type GeneratedRumours,
  type NoiseTrafficFamily,
  type GeneratedNoiseTraffic,
} from './lib/noise/rumours.js';

export {
  // Action Resolver framework and the travel action (Req 13.2, 20.1, 21.3,
  // 21.4, 21.5). `quote` and `resolve` are pure: `quote` reads the WorldState
  // and an Action and returns the phase/money cost and eligibility shown in the
  // UI; `resolve` applies exactly that cost and returns the next WorldState and
  // an ActionResult (Observations rendered to Fact Lines through the predicate
  // third-person templates with the player namer). The allowed-action,
  // opening-hours and Budget gates reject with the state unchanged. The
  // dispatch is exhaustive: every action kind in the union has its own quote
  // and resolver (slice-integration Req 11.1, 11.2). `wait` is the trivial
  // phase-cost action. The `Action` union itself is re-exported from the state
  // module above (under the name WorldState/ActionLogEntry use); the per-kind
  // variant types, the result shapes, the helpers and the travel preset factors
  // live here.
  quote,
  resolve,
  actionLocation,
  locationTypeOf,
  isOpenAt,
  locationGate,
  namerContextOf,
  predicateNamer,
  describeProposition,
  renderPropositionLine,
  renderFactLines,
  visibleNpcsAt,
  sceneAt,
  emptyResult,
  quoteWait,
  // `resolve`'s return shape: `{ next, result, ended? }`, where `ended` is the
  // End Condition an arrest or a materiel seizure produced (slice-integration
  // Req 7.1, 7.4). The caller writes it to `WorldState.ended`.
  type ResolveResult,
} from './lib/action/action.js';

export {
  // Travel action (Req 21.3, 21.4): the pure `quoteTravel`/`resolveTravel`, the
  // cheapest-route phase cost via the city model's `travelCost`, the arrival
  // Cover-Suspicion effect (Location risk × preset factor when the player is
  // tailed) and the countersurveillance tail-persistence multiplier (default
  // 0.3). The hostile side that *sets* tailing is task 19; travel only reads
  // `player.tailed` and applies the arrival effects.
  quoteTravel,
  resolveTravel,
  COVER_SUSPICION_RISK_FACTOR,
  COUNTERSURVEILLANCE_TAIL_FACTOR,
} from './lib/action/travel.js';

export {
  // Read action (Req 30.3, 30.4; Property 22): the pure `quoteRead`/
  // `resolveRead`. A Document is readable where it is obtainable (in hand when
  // it has no `obtainableAt`, else only at those Locations); on the first read
  // its asserted Propositions become `document`-sourced Case File Claims, and
  // reading again is idempotent (no new Claims). First-read tracking lives on
  // `player.readDocuments`; `hasReadDocument`/`markDocumentRead` read and update
  // it. The full Propositions behind a Document's `asserts` live in
  // `WorldState.documentPropositions`.
  quoteRead,
  resolveRead,
  hasReadDocument,
  markDocumentRead,
  READ_PHASE_COST,
} from './lib/action/read.js';

export {
  // Surveil and follow actions (Req 12.5, 23.1, 23.2, 23.3, 23.6, 23.7): the
  // pure `quoteSurveil`/`resolveSurveil` and `quoteFollow`/`resolveFollow`.
  // Surveil watches a Location for 1–2 phases, observing the NPCs scheduled
  // there (as `unk:` ids when unidentified) as `LOCATED_AT`/`MEETS_AT`
  // surveillance Observations -> Fact Lines -> `surveillance`-sourced Case File
  // Claims; follow steps a present target's schedule within the current phase,
  // ending on a non-public Location, the phase end, or detection. Each runs a
  // detection check against the preset's base surveil rate (follow multiplies it
  // by FOLLOW_DETECTION_FACTOR so a tail is strictly riskier) scaled by the
  // observed NPCs' security consciousness; on a hit, Cover Suspicion rises
  // (DETECTION_SUSPICION_DELTA) and, with the preset `madeRevealProbability`, a
  // "you may have been made" Fact Line shows. Both resolvers take the Truth
  // Store (threaded through the extended ResolverContext.truth) because
  // observing unidentified NPCs allocates stable `unk:` ids.
  FOLLOW_DETECTION_FACTOR,
  DETECTION_SUSPICION_DELTA,
  FOLLOW_PHASE_COST,
  MADE_FACT_LINE,
  quoteSurveil,
  resolveSurveil,
  quoteFollow,
  resolveFollow,
  surveilDetectionBase,
  followDetectionBase,
  madeRevealProbability,
} from './lib/action/surveil.js';

export {
  // Talk and Cold Approach actions (Req 22.1, 22.2, 22.3, 22.4, 22.5): the pure
  // `quoteTalk`/`resolveTalk` and `quoteApproach`/`resolveApproach`. Talk
  // requires the NPC present at the player's Location and opens a Dialogue-Loop
  // scene (`openScene`) without running the LLM (the dialogue machinery is a
  // later task); it creates no Contact Channel. Approach is a *first* contact
  // (present NPC the player has no Contact Channel to): it draws the pure
  // `firstContact` σ coin on the runtime PRNG — success opens a scene and mints
  // a Contact Channel (adds the NPC to `player.contacts` + known.entities),
  // failure plays the fixed brush-off line and raises Cover Suspicion
  // (APPROACH_SUSPICION_DELTA). A Contact Channel is modelled as membership in
  // `player.contacts`; `hasContactChannel` is the predicate task 11.5
  // (arrange-meeting) reuses, `addContactChannel` mints one, and
  // `firstContactWeightsOf` reads the scenario's `recruitment.firstContact`
  // weights.
  BRUSH_OFF_LINE,
  TALK_SCENE_LINE,
  APPROACH_SUSPICION_DELTA,
  TALK_PHASE_COST,
  quoteTalk,
  resolveTalk,
  quoteApproach,
  resolveApproach,
  hasContactChannel,
  addContactChannel,
  firstContactWeightsOf,
} from './lib/action/talk.js';

export {
  // Arrange-meeting action (Req 24.1, 24.2, 24.3, 24.4): the pure
  // `quoteArrangeMeeting`/`resolveArrangeMeeting`, the acceptance σ primitive
  // `meetingAcceptanceProbability` (`σ(trust − riskAversion·loc.risk −
  // scheduleConflict + agendaInterest)` on the scenario's `meeting` weights),
  // the Exposure helper `meetingExposure` (`k1·loc.risk + k2·crowdPenalty +
  // k3·recentContacts` on the `exposure` weights), and `resolveMeetingAtSlot` —
  // the pure seam the clock calls at the slot to open a talk scene when both
  // parties are present (Req 24.2) or apply the missed-meeting penalty + trust
  // drop when the player is absent (Req 24.4). A meeting requires a Contact
  // Channel (`hasContactChannel`, reused from talk) and a slot in the next
  // `MAX_SLOT_DAYS` days; arranging records a `Meeting` in `WorldState.meetings`
  // and mints a deferred `meeting-reply` event, adding Exposure to the player's
  // suspicion accumulator (`EXPOSURE_SUSPICION_SCALE`). trust is read from the
  // task-18 `Relationship` with a `NEUTRAL_TRUST` default and the drop reported
  // as a delta (`MISSED_MEETING_TRUST_DROP`, applied via `applyTrustDrop` only
  // when the Relationship carries a numeric trust field) rather than widening
  // the skeleton; `crowdPenalty` defaults to the `crowdPenaltyProxy` of the
  // Location risk and `recentContacts` to 0. The `Meeting` interface itself is
  // re-exported from the state module above (under the name
  // WorldState.meetings uses).
  quoteArrangeMeeting,
  resolveArrangeMeeting,
  resolveMeetingAtSlot,
  meetingAcceptanceProbability,
  meetingWeightsOf,
  meetingExposure,
  exposureWeightsOf,
  crowdPenaltyProxy,
  agendaInterestOf,
  scheduleConflictAt,
  relationshipTrust,
  applyTrustDrop,
  replyLine,
  ARRANGE_PHASE_COST,
  MAX_SLOT_DAYS,
  NEUTRAL_TRUST,
  MISSED_MEETING_TRUST_DROP,
  AGENDA_INTEREST_BASE,
  AGENDA_INTEREST_HANDLER,
  EXPOSURE_SUSPICION_SCALE,
  type MeetingStatus,
  type MeetingWeights,
  type MeetingAcceptanceInputs,
  type ExposureWeights,
  type ArrangeMeetingInputs,
  type MeetingSlotResult,
  // The `Meeting` type itself is exported from the state module above.
} from './lib/action/arrange-meeting.js';

export {
  // Service-dead-drop action (Req 24.5, 24.6, 24.7): the pure
  // `quoteServiceDrop`/`resolveServiceDrop`. Servicing costs one phase at the
  // drop's site. For the player's own drops (`isOwnDrop`, membership in
  // `player.known.drops`) it delivers the drop's contents and appends the
  // player's left items to the drop (emitting `drop-emptied`/`drop-loaded`
  // events), adding half a meeting's Exposure (`DROP_EXPOSURE_FACTOR` of
  // `meetingExposure`, scaled by the shared `EXPOSURE_SUSPICION_SCALE`) to the
  // suspicion accumulator. For hostile drops `hostileMode` is required: `copy`
  // composes seized-material Document(s) (`composeSeizedDocument`, registered on
  // `documents`/`documentPropositions`) and leaves the drop intact; `seize`
  // also empties the drop, disrupts the Plot (`disruptPendingStages` marks
  // pending stages `disrupted`) and — when the seized contents are the Plot
  // materiel (`seizedContentsAreMateriel`) — drives task 7.4's abort directly
  // (`applyAbort` with `materiel-seized`), reporting the `EndedIntent` the Turn
  // Pipeline writes to `WorldState.ended`, and alerts the Hostile Service with a
  // `drop-emptied` event. The slice's drop model carries no transmission, so
  // `copy` mints no Intercepts (documented seam). Both modes run a detection
  // check against the drop's watcher (`dropWatcher` — the owner, when a person),
  // drawn on the passed Prng like surveil. `seizedTemplateOf` finds the content
  // set's `seized`-kind Document template.
  quoteServiceDrop,
  resolveServiceDrop,
  isOwnDrop,
  dropWatcher,
  disruptPendingStages,
  seizedContentsAreMateriel,
  seizedTemplateOf,
  SERVICE_DROP_PHASE_COST,
  DROP_EXPOSURE_FACTOR,
  DROP_SERVICE_ORIGIN,
  DEFAULT_RISK_TOLERANCE,
  type ServiceDropInputs,
  type ServiceDropResult,
} from './lib/action/service-drop.js';

export {
  // Intercept action and the wait action's passive observation (Req 25.2, 25.3,
  // 25.4, 25.5, 25.6): the pure `quoteIntercept`/`resolveIntercept` and the
  // `waitObservations` helper `action.ts` calls from the upgraded wait resolve.
  //
  // Intercept has two modes by *where* the player stands. At the Station
  // (`isAtStation` — Location Type `station-hq`) it collects every uncollected
  // transmission on the player's known radio/numbers Channels
  // (`knownInterceptableChannels`, optionally narrowed by `channel?`) whose time
  // is within the retention window (`retentionDays`, default two days from the
  // scenario's `interceptRetentionDays`), delivering each in-window firing's
  // seeded Intercept (`stationCollection`, deduped by the Intercept id so
  // Property 18's at-most-once holds) with its Req 25.3 traffic metadata; no
  // detection. On a courier Channel's route during its window (`courierHereNow`)
  // it delivers that courier's seeded Intercept and runs a detection check on
  // `rng`. The real ciphertext transmissions are minted at world assembly by the
  // Cipher Engine (task 26.3) and held on `WorldState.transmissions`; the action
  // sweeps them and copies a captured one's Intercept into `WorldState.intercepts`.
  //
  // Wait at a public, open Location makes passive `LOCATED_AT`/`MEETS_AT`
  // Observations at `WAIT_OBSERVATION_FACTOR` (×0.4) the surveil yield with no
  // detection, reusing surveil's `observationsFor`/`visiblePersons`; it stops at
  // closing (Req 25.6), yielding fewer observations and the `WAIT_CLOSED_FACT_LINE`
  // when the Location closes mid-span. The time advance / event delivery stay
  // the Turn Pipeline's job.
  quoteIntercept,
  resolveIntercept,
  waitObservations,
  isAtStation,
  retentionDays,
  knownInterceptableChannels,
  courierHereNow,
  stationCollection,
  STATION_LOCATION_TYPE,
  INTERCEPT_PHASE_COST,
  DEFAULT_RETENTION_DAYS,
  WAIT_OBSERVATION_FACTOR,
  WAIT_CLOSED_FACT_LINE,
  type WaitObservationResult,
} from './lib/action/intercept.js';

export {
  // Decrypt action (slice-integration Req 8.1–8.6): the pure `quoteDecrypt`
  // (allowed at 1 phase, no money, for a collected Intercept, at any Location)
  // and `resolveDecrypt`, which verifies the submission with
  // `verifySubmission`. A correct break marks the Intercept `broken` and
  // reports each recovered Proposition as an Observation sourced `intercept`; a
  // wrong submission plays the fixed `DECRYPT_REJECTED_LINE`; broken traffic
  // plays `DECRYPT_ALREADY_BROKEN_LINE` and adds nothing. Draws nothing.
  quoteDecrypt,
  resolveDecrypt,
  DECRYPT_PHASE_COST,
  DECRYPT_NOT_COLLECTED_REASON,
  DECRYPT_ALREADY_BROKEN_LINE,
  DECRYPT_REJECTED_LINE,
} from './lib/action/decrypt.js';

export {
  // The surveil observation constructor and scheduling read, reused by the wait
  // action's passive observation (task 11.7) so both observation paths share one
  // source of "who is here now" and one Observation builder.
  observationsFor,
  npcsScheduledAt,
} from './lib/action/surveil.js';

export {
  // The Cold Approach primitive (Req 22.2, 22.3; design "Recruitment"):
  // `firstContact(npc, cover, loc, weights, suspicion, rng)` draws the logistic
  // success `σ(a·coverFit − b·wariness − c·suspicion + d·openness)` against the
  // runtime PRNG; `firstContactProbability` is the drawless σ value; `coverFit`
  // scores how well the Cover Identity fits the Location (1 when the Location's
  // Type is in the cover's fit set, else 0); `sigmoid` is the logistic. Lives in
  // its own `recruit/` leaf so later recruitment (resolvePitch, pressureCheck,
  // turn-agent) lands beside it.
  COVER_FIT_HIGH,
  COVER_FIT_LOW,
  coverFit,
  sigmoid,
  firstContactProbability,
  firstContact,
  type FirstContactWeights,
  type FirstContactNpc,
} from './lib/recruit/first-contact.js';

export {
  // Recruitment pitch (Req 10.1, 10.2, 10.5, 28.5): the pure `resolvePitch`
  // coin and its drawless σ `pitchProbability`
  // (`σ(w1·leverMatch + w2·trust − w3·suspicion − w4·exposureRisk + persona)`
  // on the scenario's `recruitment.pitch` weights). `leverMatch`/`leverStrength`
  // read the NPC's hidden MICE profile; `moneyOfferScale` is the design's
  // `min(1, amount/moneyNeed)` money-offer scaling. A refusal raises the NPC's
  // suspicion (`PITCH_FAIL_SUSPICION`), and a *bad* refusal — the draw cleared
  // the probability by `PITCH_BAD_THRESHOLD` of the failing range — raises it
  // more (`PITCH_BAD_SUSPICION`) and flags the pitch reportable to the Hostile
  // Service. Lives in the `recruit/` leaf beside `first-contact.ts`.
  resolvePitch,
  pitchProbability,
  leverMatch,
  leverStrength,
  moneyOfferScale,
  PITCH_FAIL_SUSPICION,
  PITCH_BAD_SUSPICION,
  PITCH_BAD_THRESHOLD,
  type PitchWeights,
  type PitchOutcome,
} from './lib/recruit/pitch.js';

export {
  // The dialogue Intent vocabulary and the pure `applyIntent` reducer (slice
  // Req 4.2, 4.3; Req 15.5), moved here from the dialogue package so the Turn
  // Pipeline can apply a classified Intent on the Draft without importing
  // dialogue. `applyIntent` moves a full `Relationship`'s trust and suspicion by
  // the fixed `INTENT_DELTAS`, clamped to [0, 1]. `SCENE_KINDS`/`SceneKind` is
  // the Talk Scene's stakes vocabulary (slice Req 4.4). The dialogue package
  // re-exports all of these unchanged.
  INTENTS,
  INTENT_DELTAS,
  isIntent,
  applyIntent,
  SCENE_KINDS,
  type Intent,
  type SceneKind,
} from './lib/recruit/intent.js';

export {
  // The Sim side of a dialogue turn (Req 15.5–15.8): `applyDialogueTurn` applies
  // the classified Intent to the scene NPC's Relationship, resolves a `pitch-*`
  // Intent with `resolvePitch` on the runtime PRNG (debiting a money pitch's
  // offer, tagged `pay`, whether or not it lands), mints the Asset profile on
  // acceptance, raises suspicion on a refusal and records a reported approach
  // (`hostile.beliefs.suspectedApproaches`, Cover Suspicion
  // +`PITCH_REPORTED_COVER_SUSPICION`), and appends the player's line to the
  // scene's recent turns. `sceneRelationship` is the Relationship a turn starts
  // from (its `channel` flag follows the player's Contact Channels),
  // `appendRecentTurn` the `RECENT_TURNS`-capped append, and `pitchLever` the
  // lever each pitch Intent presses.
  applyDialogueTurn,
  pitchAllowed,
  sceneRelationship,
  appendRecentTurn,
  pitchLever,
  PITCH_REPORTED_COVER_SUSPICION,
  type DialogueTurnInput,
  type DialogueTurnResult,
} from './lib/recruit/dialogue-turn.js';

export {
  // The player↔NPC Relationship, the Asset status model and Asset reporting
  // (Req 10.3, 10.4, 10.6). The real `Relationship`/`AssetProfile` shapes the
  // design writes (replacing the state-module skeleton once the pipeline wires
  // them), `newRelationship`, the People view's `assetStatus`/`isAsset`, the
  // `MiceLever`/`CoverState` vocabularies, and the pure `reportFacts` — the
  // "Asset reporting" core that filters candidate ground-truth facts by
  // `access` (`factInAccess`, with an injected `OrgMembershipLookup` for the
  // `access.orgs` branch), reports each at p = `reliability`, distorts a
  // reported fact at p = `(1 − reliability) × DISTORT_FACTOR` with a Rumour-style
  // subject swap (`distortProposition`), and caps at `MAX_REPORTED_PROPS` (3).
  // `assetProfileFor` mints a newly recruited NPC's profile from their
  // schedule, org and acquaintances.
  newRelationship,
  MEETINGS_BEFORE_PITCH,
  recruitmentProgress,
  assetProfileFor,
  assetStatus,
  isAsset,
  inStationCustody,
  factInAccess,
  distortProposition,
  reportFacts,
  MICE_LEVERS,
  COVER_STATES,
  MAX_REPORTED_PROPS,
  DISTORT_FACTOR,
  // `MiceLever` is re-exported from the action types module above (the Action
  // union's `pitch`/`turn-agent` payload name).
  type CoverState,
  type AssetAccess,
  type AssetProfile,
  type Retainer,
  type Custody,
  // `Relationship` is re-exported from the state module above (the name
  // `WorldState.relationships` uses); its real interface lives here.
  type AssetStatus,
  type OrgMembershipLookup,
} from './lib/recruit/asset.js';

export {
  // Cover-state pressure (Req 6.3, 6.4): the pure `pressureCheck` the confront
  // action draws — one coin against the runtime PRNG that degrades the NPC's
  // cover along `intact → strained → cracking → blown` under contradicting
  // evidence — plus its drawless σ `pressureProbability`, the `evidenceWeight`
  // saturation and `npcResilience` composure readers, the `advanceCover` ladder
  // helper, and `agendaShiftFor`/`coverBroke` — the Agenda change (partial
  // admission, bargaining or flight) a broken cover produces. Self-contained
  // constants (no scenario weights, matching the design signature). Lives in the
  // `recruit/` leaf beside `pitch.ts`.
  pressureCheck,
  pressureProbability,
  evidenceWeight,
  npcResilience,
  advanceCover,
  coverIndex,
  agendaShiftFor,
  coverBroke,
  PRESSURE_EVIDENCE_COEFF,
  PRESSURE_TRUST_COEFF,
  PRESSURE_RESILIENCE_COEFF,
  PRESSURE_WARINESS_COEFF,
  PRESSURE_BIAS,
  PRESSURE_HARD_MARGIN,
  EVIDENCE_HALF_SATURATION,
  STRONG_EVIDENCE_CLAIMS,
  type AgendaShift,
} from './lib/recruit/pressure.js';

export {
  // Asset tasking (Req 10.3, 10.4, 10.6, 22.6): the `AssetTask` union (collect,
  // introduce, service dead drop, plant — the real `task` action payload) and
  // the pure `runAssetTask` that resolves one against ground truth. `collect`
  // and `service` report through `reportFacts`; `introduce` mints a Contact
  // Channel and inherits `INTRODUCTION_TRUST_SHARE` of the introducer's trust
  // (Req 22.6); `plant` places a lead with p = `reliability`. Results are
  // *intents* the Turn Pipeline applies, so the leaf never mutates the world.
  runAssetTask,
  INTRODUCTION_TRUST_SHARE,
  // The tasking risk every task adds to the Asset's Exposure (slice-integration
  // Req 10.7): half a risk-0.5 meeting's Exposure under the default weights.
  TASKING_EXPOSURE,
  // `AssetTask` is re-exported from the action types module above (the Action
  // union's `task` payload name).
  type CollectTask,
  type IntroduceTask,
  type ServiceTask,
  type PlantTask,
  type AssetTaskResult,
  type CollectResult,
  type IntroduceResult,
  type ServiceResult,
  type PlantResult,
  type AssetTaskContext,
} from './lib/recruit/tasking.js';

export {
  // Task action (slice-integration Req 10.1–10.7): the pure `quoteTask`/
  // `resolveTask`. The quote reads only the Asset's Relationship flags (a
  // running Asset with a Contact Channel; 1 phase, no money). The resolver runs
  // `runAssetTask` over the Truth Store facts since the Asset's last report
  // (`factsSinceLastReport`), files collect and service reports as
  // `npc`-sourced Observations, mints an introduction's Contact Channel at the
  // inherited trust, applies a courier service to the player's own drop,
  // schedules a placed plant as a hidden `belief-plant`, and adds
  // `TASKING_EXPOSURE` to the Asset's Exposure for every task.
  quoteTask,
  resolveTask,
  factsSinceLastReport,
  TASK_PHASE_COST,
  TASK_MONEY_COST,
  NOT_YOUR_ASSET_REASON,
  NO_CHANNEL_REASON,
  TASK_REPORT_LINE,
  TASK_NOTHING_NEW_LINE,
  TASK_INTRODUCED_LINE,
  TASK_NO_INTRODUCTION_LINE,
  TASK_NO_SUCH_DROP_LINE,
  TASK_PLANTED_LINE,
  TASK_DROP_ORIGIN,
  type TaskInputs,
} from './lib/action/task.js';

export {
  // Retainers, pay effects and trust decay for money-motivated Assets (Req 28.2,
  // 28.4). The pure retainer leaf the pay action and the Turn Pipeline both read:
  // `isMoneyMotivated` (an NPC whose dominant MICE lever is money — the only
  // Assets a retainer applies to), `payEffect` (the pay action's Relationship
  // side: advance the retainer to the next weekly due date and add
  // `PAY_TRUST_GAIN` trust for a money-motivated Asset, a no-op otherwise),
  // `addTrust`/`nextDue`/`overduePhases` helpers, and `retainerDecay` — the
  // per-boundary sweep that, for each unpaid money-motivated Asset overdue past
  // the 2-day grace period, reduces trust by `RETAINER_DECAY_PER_PHASE` per
  // overdue phase and raises a `retainer-due` intent the pipeline mints into the
  // player-visible SimEvent. Self-contained constants (the design names no
  // scenario weights). The ledger side is `payLedgerEffect` (station/ledger).
  isMoneyMotivated,
  payEffect,
  addTrust,
  nextDue,
  overduePhases,
  retainerDecay,
  subjectToRetainerDecay,
  RETAINER_PERIOD_DAYS,
  RETAINER_PERIOD_PHASES,
  RETAINER_GRACE_DAYS,
  RETAINER_GRACE_PHASES,
  PAY_TRUST_GAIN,
  RETAINER_DECAY_PER_PHASE,
  type RetainerDueIntent,
  type RetainerDecayResult,
} from './lib/recruit/retainer.js';

export {
  // Pay action (Req 28.2, 28.3, 28.4): the pure `quotePay`/`resolvePay`. Pay is
  // a Budget debit to a running Asset — it debits the ledger via `payLedgerEffect`
  // (rejecting with state unchanged on an insufficient balance), and for a
  // money-motivated Asset advances the retainer and lifts trust (`payEffect`).
  // Draws nothing.
  quotePay,
  resolvePay,
  PAY_PHASE_COST,
  PAY_LINE,
} from './lib/action/pay.js';

export {
  // Cable action (slice-integration Req 9.1, 9.2, 9.3): the pure
  // `quoteCable`/`resolveCable`. A Cable is sent from the Station (the player
  // at an open `station-hq` Location, the rule `isAtStation` gives `intercept`)
  // for one phase and no money; a trace needs a target in
  // `player.known.entities` (`isKnownTraceTarget`). Resolving appends
  // `submitCable(body, time, { delayPhases: cableReplyDelayPhases(state) })` to
  // `station.pendingCables`, and the Phase Step delivers the reply. Draws
  // nothing.
  quoteCable,
  resolveCable,
  isKnownTraceTarget,
  cableReplyDelayPhases,
  CABLE_PHASE_COST,
  CABLE_SENT_LINES,
  CABLE_NOT_AT_STATION_REASON,
  CABLE_UNKNOWN_TARGET_REASON,
  CABLE_FUNDS_AMOUNT_REASON,
} from './lib/action/cable.js';

export {
  // Turning primitive (Req 36.3–36.7): the pure, deterministic `resolveTurn`
  // the turn-agent action draws — `σ(w₁·leverMatch + w₂·L − w₃·loyalty −
  // w₄·suspicion + w₅·trust − resilience)` with the leverage strength `L` set by
  // `leverageStrength` (1.0 custody / 0.6 cracking / 0.3·min(1, evidence/arrest
  // threshold) evidence). A non-hostile target refuses with no draw (so a
  // refusal leaks nothing, Req 36.4/36.5); a hostile target draws the success
  // coin, then a report coin on a miss. `trueAllegianceIsHostile` is the
  // hostile-org test, `TURN_REFUSAL_LINE` the single refusal Fact Line (Req
  // 36.5), and `custodyReleaseSuspicion`/`phasesInCustody` the custody-release
  // penalty (Req 36.7). Lives in the `recruit/` leaf beside `pitch.ts`.
  resolveTurn,
  turnProbability,
  leverageStrength,
  trueAllegianceIsHostile,
  custodyReleaseSuspicion,
  phasesInCustody,
  TURN_REFUSAL_LINE,
  LEVERAGE_CUSTODY,
  LEVERAGE_CRACKING,
  LEVERAGE_EVIDENCE_MAX,
  CUSTODY_RELEASE_SUSPICION_PER_PHASE,
  type TurnLeverage,
  type TurnOutcome,
  type TurnWeights,
} from './lib/recruit/turn.js';

export {
  // Turn-agent action (Req 11.3, 36.1–36.7): the pure `turnEligibility`
  // (player-side only — custody / observed crack / evidence, Req 36.2),
  // `quoteTurnAgent` and `resolveTurnAgent`. On an accepted turn the resolver
  // flips the true allegiance to the Station in the Truth Store, makes the NPC a
  // `turned` Asset, releases Station Custody and applies the release suspicion
  // penalty (Req 36.6, 36.7); every failure renders the identical refusal Fact
  // Line and raises suspicion (Req 36.5). `hostileOrgId`/`npcLoyalty` are the
  // ground-truth lookups the resolver reads.
  turnEligibility,
  quoteTurnAgent,
  resolveTurnAgent,
  hostileOrgId,
  npcLoyalty,
  TURN_PHASE_COST,
  TURN_FAIL_SUSPICION,
  TURN_REPORTED_COVER_SUSPICION,
  TURNED_ASSET_RELIABILITY,
  TURN_ACCEPT_LINE,
} from './lib/action/turn-agent.js';

export {
  // Arrest action (Req 19.1–19.5, 40.4): the arrest gate `quoteArrest` (grants
  // an arrest only when the projected corroborated-Implicating-Claim count
  // `arrestEvidenceOf` ≥ the preset `arrestThresholdOf` and arrest authority
  // remains — Player-View data only, Req 19.1/40.4) and `resolveArrest` (starts
  // Station Custody on the target, tells a correct arrest from a wrongful one
  // via `arrestTargetIsHostile`, applies the wrongful-arrest penalties, and ends
  // the game in success on a correct arrest of the Cell leader `isPlotLeader`).
  // `resolveTargetNpc` canonicalises a `unk:` target through the Truth Store.
  // Returns an optional `EndCondition` (with the `detectEnd` standing result)
  // the Turn Pipeline writes to `WorldState.ended`.
  quoteArrest,
  resolveArrest,
  resolveTargetNpc,
  arrestEvidenceOf,
  arrestTargetIsHostile,
  isPlotLeader,
  ARREST_PHASE_COST,
  ARREST_LINE,
  WRONGFUL_ARREST_LINE,
  WRONGFUL_STANDING_PENALTY,
  WRONGFUL_ALERTNESS_COVER_SUSPICION,
  type ArrestResult,
  // `arrestThresholdOf` is intentionally not re-exported: the turn-agent module
  // already owns a private threshold reader; the arrest one is an internal of
  // the arrest leaf.
} from './lib/action/arrest.js';

export {
  // End conditions (Req 19.3, 19.4, 19.5): the pure win/lose detector
  // `detectEnd` — a Plot abort is a WIN (the Cell abandoned the operation,
  // including the materiel-seizure disruption that flows through task 7.4), a
  // completed Plot or a burned player is a LOSE — plus `leaderArrestEnd` (the
  // arrest resolver's Cell-leader disruption WIN) and `endConditionFromAbort`
  // (widens a task-7.4 `EndedIntent` to an `EndCondition`). The Turn Pipeline
  // writes the returned `EndCondition` to `WorldState.ended`.
  detectEnd,
  leaderArrestEnd,
  endConditionFromAbort,
  WIN_OUTCOME,
  LOSE_OUTCOME,
  type EndCondition,
  type EndCause,
} from './lib/endings/end-conditions.js';

export {
  // The Outcome Record shape and its versioned Zod schema (task 20.3; Req 35.1,
  // 35.2, 35.3). The persisted end-of-game record kept separately from saves for
  // a future campaign layer: identifying metadata (seed, generator version,
  // Content Manifest, Difficulty Preset) plus Standing, Directive results,
  // surviving Assets, Cover status, the Hostile Memory and the remaining Budget.
  // `OutcomeRecordSchema`/`parseOutcomeRecord` validate on read; `dominantLever`
  // derives an Asset's recruited lever. The `OutcomeRecord` type itself is
  // re-exported from the state module above (under the name
  // WorldState.ended.outcome reads); the shape leaf owns the real interface.
  OUTCOME_RECORD_SCHEMA_VERSION,
  OUTCOME_TAGS,
  OutcomeRecordSchema,
  parseOutcomeRecord,
  dominantLever,
  type OutcomeTag,
  type OutcomeDirective,
  type OutcomePersona,
  type SurvivingAsset,
  type OutcomeCover,
  type HostileMemory,
  // `OutcomeRecord` is exported from the state module above.
} from './lib/endings/outcome-record.js';

export {
  // The pure Outcome-Record derivation (task 20.3; Req 35.2, 35.3).
  // `buildOutcomeRecord(final, truth)` derives the record deterministically from
  // the ended WorldState and ground truth — no fs, no draws — so task 20.5
  // (Property 26) can pin it; `outcomeTagOf` maps the end's outcome/cause to the
  // persisted `success | failure-plot | failure-burned` tag.
  buildOutcomeRecord,
  outcomeTagOf,
} from './lib/endings/build-outcome-record.js';

export {
  // Writing an Outcome Record to disk (task 20.3; Req 35.1, 35.3). The thin fs
  // seam kept apart from the pure derivation: `writeOutcomeRecord` validates
  // against the schema, creates `saves/outcomes/` if missing, and writes one
  // pretty-printed JSON file per game (`<seed>-<endedAt>.json`).
  DEFAULT_OUTCOMES_DIR,
  outcomeFileName,
  writeOutcomeRecord,
} from './lib/endings/outcome-store.js';

export {
  // Posting Result (campaign-career Req 5.3, 6.5, 7.3, 7.5, 21.6). Stats from
  // the action log and action results, carry from the view and case file,
  // redaction against the protected set, and schema-1 outcome records lifted
  // to schema 2.
  buildPlayerCarry,
  buildPostingResult,
  normaliseOutcome,
  postingStats,
  redactDebrief,
  revealDebriefs,
  type BuildPostingResultInput,
  type BuiltPostingResult,
  type CarryCaseFile,
  type CarryClaim,
  type CarryPerson,
  type CarryView,
  type DebriefFact,
  type PlayerCarry,
  type PostedAsset,
  type PostedDebrief,
  type PostedHostile,
  type PostingStats,
  type PostingTruthExtract,
  type RedactedDebrief,
  type RedactedItem,
} from './lib/outcome/posting-result.js';

export {
  // Feed action (Req 37.1, 37.2, 37.6): `quoteFeed`/`resolveFeed` (an invalid
  // feed is disallowed with the first `FeedError`'s reason; a valid one is
  // allowed only on a player-turned Asset with a Contact Channel; resolve
  // schedules a hidden `feed-delivered` event at the agent's next handler
  // contact and returns the optional `label` for a view-only Journal note), and
  // the helpers `isTurnedAsset`, `handlerNpcs` and `nextHandlerContact`.
  quoteFeed,
  resolveFeed,
  isTurnedAsset,
  handlerNpcs,
  nextHandlerContact,
  FEED_PHASE_COST,
  FEED_MONEY_COST,
  FEED_CONTACT_HORIZON_DAYS,
  FEED_SCHEDULED_LINE,
  type FeedResolveResult,
} from './lib/action/feed.js';

export {
  // Shared feed validation (slice-integration Req 14.1–14.4; Req 37.1, 37.2):
  // `validateFeedItems`, the one pure function `quoteFeed` and the Player View
  // facade's `validateFeed` both call. It checks 1–3 items, known-set
  // entities, `unk:` ids resolved through held IS_ALIAS_OF Claims, the derived
  // per-predicate schema and windows within the next 7 days, and returns the
  // resolved Propositions or one `FeedError` (index, field, reason) per
  // failure. It reads only a truth-free `FeedView`, which `feedViewOf` builds
  // from the clock, the player's known set and the held Case File Claims.
  validateFeedItems,
  feedViewOf,
  isKnownEntity,
  resolveAlias,
  validatePropositionSchema,
  validateWindow,
  FEED_MIN_ITEMS,
  FEED_MAX_ITEMS,
  FEED_WINDOW_DAYS,
  type FeedError,
  type FeedField,
  type FeedKnownSet,
  type FeedView,
  type FeedViewSource,
  type FeedValidationOptions,
} from './lib/action/feed-validation.js';

export {
  // The design's success-or-error `Result<T, E>`, shaped exactly like
  // player-view's so an engine result passes through the facade unchanged.
  type Result,
} from './lib/model/result.js';

export {
  // Unidentified Subjects and identification (Req 21.7, 23.4, 23.5). The
  // `unk:` allocator (`allocateUnk`, reusing a stable id per NPC and recording
  // `identityOf` in the Truth Store), the unk-aware visible-persons listing
  // (`visiblePersons`, presenting each present NPC by their `npc:` or `unk:`
  // id), the identity-aware namer (`identityAwareNamer`, rendering an
  // unidentified person by their descriptor), and `identify` — the entry point
  // the three triggers (a face-to-face introduction, a Dossier photograph, an
  // Asset report) call to record the mapping and report the `IS_ALIAS_OF`
  // Claim the Player-View Case File adds. The allocation table lives on
  // `WorldState.player.unkIds`.
  IS_ALIAS_OF_PREDICATE,
  IDENTIFICATION_TRIGGERS,
  unkTable,
  isIdentified,
  allocatedUnk,
  nextUnkId,
  allocateUnk,
  visiblePersons,
  identityContextOf,
  identityAwareNamer,
  aliasPropId,
  identify,
  type IdentificationTrigger,
  type AliasClaimReport,
  type UnkTable,
  type AllocateResult,
  type VisiblePersonsResult,
  type IdentityContext,
  type IdentifyResult,
} from './lib/action/identify.js';

export type {
  // The Action variant types and the kind tag (the `Action` union is exported
  // from the state module above).
  ActionKind,
  TalkAction,
  ApproachAction,
  TravelAction,
  ArrangeMeetingAction,
  SurveilAction,
  FollowAction,
  ServiceDropAction,
  InterceptAction,
  DecryptAction,
  ReadAction,
  CableAction,
  TaskAction,
  PayAction,
  ConfrontAction,
  ArrestAction,
  TurnAgentAction,
  FeedAction,
  WaitAction,
  // Per-action payload placeholders (owned by later tasks).
  MiceLever,
  AssetTask,
  CableRequest,
  FeedItem,
  ComposedProposition,
  // The source a Proposition Observation is filed under (mirrors ClaimSource).
  ObservationSource,
} from './lib/action/types.js';

export type {
  // The action result shapes.
  ActionQuote,
  ActionResult,
  Observation,
  SceneDescriptor,
  TalkSceneRequest,
  ResolverContext,
} from './lib/action/result.js';

// The setting step (content-expansion task 3.2): the setting PRNG stream, the
// content-expansion Content Set shape and the pure setting-step functions
// (`drawSetting`, `yearFilter`), `instantiateCity`, `nameNpc`/`describeNpc`,
// the `CityView` projection (`cityView`) and the write-only `UsageSink`.
export {
  CORE_CITY_DEFAULT_START_DATE,
  SETTING_STREAM_BASE,
  SETTING_STREAM_LIMIT,
  SETTING_STREAM_SPAN,
  SettingError,
  drawSetting,
  isContentSetV2,
  settingStreamSeed,
  yearFilter,
  // Authored city instantiation (content-expansion task 3.3). The Pack Linter's
  // CE-FEASIBLE rule runs `instantiateCity` over 256 fixed seeds at each Period
  // Window boundary year and errors on any `'infeasible'`.
  DEFAULT_DISTRICT_BOUND,
  DEFAULT_LOCATION_BOUND,
  MAX_INSTANTIATION_ATTEMPTS,
  districtEntityId,
  instantiateCity,
  locationEntityId,
  type InstantiatedCity,
  type CityBundle,
  type CityId,
  type CitySelector,
  type ContentSetV2,
  type CultureGroupId,
  type EraBundle,
  type IsoDate as SettingIsoDate,
  type ServiceId,
  type SettingConfig,
  type SettingSelection,
  // Locale and Template Variant rendering wiring (content-expansion task 3.6):
  // the per-game `LocaleContext`, the city-voice date/money/address/honorific
  // formatters, the Locale-aware namer and the city-then-era variant resolver
  // that Fact Line, Document, newspaper and Notification rendering route
  // through (Req 8.2, 8.4).
  CORE_CITY_CURRENCY,
  buildLocaleContext,
  formatAddressParts,
  formatAmount,
  formatWhen,
  honorific,
  localeNamer,
  resolveVariant,
  type LocaleContext,
  // Local Terms into the help glossary (Req 8.5) and the Locale `allowNames`
  // plus Local Terms into the Specifics Guard allowed-name set (Req 8.6).
  glossaryWithLocalTerms,
  specificsAllowedNames,
  // Currency scaling of the Difficulty Preset and scenario money fields by the
  // city currency's `budgetScale`, rounded to `rounding`, at preset resolution
  // (Req 9.6); the ledger stays single-currency.
  scaleMoney,
  scaleMoneyPolicy,
  scalePreset,
  type MoneyPolicy,
  // The CityView projection (content-expansion task 3.8): the read-only city +
  // year-filtered Content Set projection that the follow-on binders (plot-library,
  // ambient-world) read the city through (Req 17.6), built once per game after
  // the setting step.
  cityView,
  type BindableKind,
  type CityView,
  type TaggedEntity,
  // The optional write-only UsageSink (content-expansion task 3.8): the coverage
  // collector `generate` accepts and the Coverage Report (task 5.11) passes.
  CountingUsageSink,
  NO_USAGE_SINK,
  type UsageSink,
} from './lib/setting/index.js';

export {
  SELECT_STREAM,
  advanceLibrary,
  bind,
  bindCityFromView,
  branchConfigurations,
  buildLibrarySession,
  contingentBelief,
  identifyReport,
  projectLibraryFacts,
  verifyLibrary,
  bindable,
  checkConsistency,
  countsTowardAbort,
  accumulatedDeadlineDays,
  evaluateOutcomes,
  expand,
  worstCaseDeadlineDay,
  historyHash,
  instantiate,
  instantiateSideThread,
  libraryPreset,
  lookalikeCount,
  reschedule,
  resolveBranch,
  rerouteAlternative,
  select,
  variantKey,
  type BindCity,
  type LibrarySession,
  type PlotStateV2,
  type SelectionResult,
  type TemplateHistory,
} from './lib/plotgen/index.js';

export {
  AMBIENT_HOOK_KINDS,
  AMBIENT_KINDS,
  EVENT_CATEGORIES,
  METRIC_IDS,
  AmbientSpawnSchema,
  EventTemplateSchema,
  ambientJsonSchema,
} from './lib/ambient/content.js';
export {
  REGION_KINDS,
  TRAVEL_MODES,
  BorderPostSchema,
  BorderSchema,
  CrossCityStageHookSchema,
  IntercityRouteTemplateSchema,
  RegionalPresetSchema,
  RegionTemplateSchema,
  RivalryTableSchema,
  ServiceExtensionSchema,
  TravelDocumentKindSchema,
  regionJsonSchema,
} from './lib/region/content.js';
export { checkRegionContent, regionRefs } from './lib/region/check.js';
export { loadRegionContent, regionSources } from './lib/region/load.js';
export { regionCatalog, type RegionCatalog } from './lib/region/catalog.js';
export { generateRegion, type GenerateRegionInputs } from './lib/region/generate.js';
export {
  createExtensionRegistry,
  isExtensionKind,
  type AddOn,
  type ExtensionRegistry,
} from './lib/extension/registry.js';
export { streetOpsRegistry, STREET_OPS_ID, STREET_OPS_VERSION } from './lib/street-ops/addon.js';
export { runtimeFromLoadedPacks, streetPlayDirs, withStreetPack, STREET_PLAY_PACKS } from './lib/street-ops/play.js';
export {
  STREET_OPS_KINDS,
  streetOpsJsonSchema,
  GRAPH_FEATURES,
  SPEED_CLASSES,
  STREET_PHASES,
} from './lib/street-ops/content.js';
export { checkStreetOpsContent, type StreetOpsSource } from './lib/street-ops/check.js';
export {
  compileStreetGraph,
  pinFrontage,
  validateStreetGraph,
  gridGraph,
  DEFAULT_SPEED_M_PER_TICK,
  RELATIVES,
  type StreetGraph,
  type TurnOption,
  type Directed,
} from './lib/street-ops/graph.js';
export {
  STREET_SLICE_VERSION,
  emptyStreetOpsState,
  emptyStreetOpsTruth,
  migrateStreetOpsState,
  migrateStreetOpsTruth,
  type StreetOpsState,
  type StreetOpsTruth,
  type KnowledgeSource,
} from './lib/street-ops/state.js';
export {
  STREET_STREAM_BASE,
  STREET_SUBSTREAMS,
  streetReplayHeader,
  streetStream,
  streetSubstream,
  type StreetSubstream,
} from './lib/street-ops/stream.js';
export { ensureStreetOps, streetOpsOf } from './lib/street-ops/slice.js';
export {
  assessBluff,
  claimsFor,
  extractSlotClaims,
  fileStory,
  findContradictions,
  PROTECTED_SLOTS,
} from './lib/street-ops/bluff.js';
export {
  VEHICLE_BORDER,
  avoidanceDelta,
  detectionChance,
  randomStop,
  vehicleBorderExtension,
  vehicleCheck,
  SEARCH_LEVELS,
} from './lib/street-ops/checkpoint.js';
export {
  chargeTicks,
  closeClock,
  coverVehicle,
  driveCandidates,
  navigationAidActive,
  runtimeFor,
  runtimeFromScenario,
  selectStreetGraph,
  streetRates,
  type StreetOpsRuntime,
  type VehicleOffer,
} from './lib/street-ops/drive.js';
export { regionTruth } from './lib/region/mystery.js';
export {
  flushRegionMetrics,
  recordRegionTiming,
  setRegionMetricsSink,
  type RegionMetricsSink,
  type RegionMetricsTarget,
  type RegionTimingInput,
  type RegionTimingPurpose,
  type RegionTimingRecord,
} from './lib/region/metrics-log.js';
export { borderCheck, borderFactLine, requiredPapersMissing, BORDER_OUTCOMES, BORDER_OUTCOME_RANK } from './lib/border/check.js';
export type { BorderOutcome, BorderInput, BorderResult } from './lib/border/check.js';
export { quoteDepart, resolveDepart } from './lib/travel/depart.js';
export { decideVisa, quotePapers, quoteVisa, resolvePapers, resolveVisa } from './lib/travel/papers.js';
export { serviceDay, leakageBounded, visibleToPosting } from './lib/region/service-day.js';
export {
  assetCity,
  channelDelay,
  communicationLatency,
  exposureByService,
  quoteExfiltrate,
  remoteLatency,
  resolveExfiltrate,
  resolveTravelTask,
  resultReadyAt,
} from './lib/region/remote.js';
export {
  arriveHandoff,
  boardHandoff,
  chooseReroute,
  courierSeized,
  deadlineHolds,
  handoffDeadline,
  handoffTraces,
  recordHandoffDisruption,
  regionalArrest,
  stageReady,
} from './lib/region/handoff.js';
export {
  cableLatency,
  enqueueNotices,
  noticeRelease,
  noticeRoute,
  playerInTransit,
  publishCityEditions,
  releaseNotices,
} from './lib/region/notices.js';
export type { NoticeRoute } from './lib/region/notices.js';
export {
  controllingService,
  jurisdictionAllows,
  jurisdictionReason,
  observedCities,
  servicePermitsArrest,
} from './lib/region/jurisdiction.js';
export {
  crossingRecords,
  fallTrust,
  liaisonAnswer,
  liaisonShare,
  reportIsGrounded,
} from './lib/liaison/exchange.js';
export { moveOnSpine, phasesBetween, placementsMatch } from './lib/travel/move.js';
export {
  cityAmbientSeed,
  cityCoreSeed,
  cityDailySeed,
  cityNoiseRetrySeed,
  cityNoiseSeed,
  citySpineSeed,
  initialCityStreams,
  REGION_STREAM_END,
  regionRetrySeed,
  regionSeed,
  type SavedCityStreams,
} from './lib/region/streams.js';
export {
  SERVICE_KINDS,
  SLICE_HOSTILE_SERVICE,
  sliceService,
  sliceServices,
  type LiaisonAgenda,
  type Penetration,
  type Residency,
  type RivalryEdge,
  type ServiceBeliefs,
  type ServiceKind,
  type ServiceState,
  type WatchList,
} from './lib/region/services.js';
export {
  CITY_TIERS,
  type AmbientCityState,
  type BorderPost,
  type BorderPostId,
  type CityState,
  type CityTier,
  type DocumentIssuer,
  type Handoff,
  type HandoffId,
  type HandoffStatus,
  type IntercityRoute,
  type LocationOf,
  type Outstation,
  type Placement,
  type RegionWorld,
  type RouteDuration,
  type SectorLine,
  type StationHub,
  type Stations,
  type Transit,
  type TransitId,
  type TransitStatus,
  type TravelDocId,
  type TravelDocument,
  type TravelMode,
} from './lib/region/world.js';
export { ambientPreset, type AmbientPresetValues } from './lib/ambient/preset.js';
export {
  checkAmbientPredicate,
  checkAmbientRefs,
  duplicateIdIssues,
  scanDenylist,
} from './lib/ambient/check.js';
export { ambientBudgets, type AmbientBudgets } from './lib/ambient/budgets.js';
export { initAmbient } from './lib/ambient/init.js';
export {
  applyMetricDelta,
  applyPlayerDelta,
  decayMetrics,
  metricTotal,
} from './lib/ambient/metrics.js';
export { calendarDate, calendarDay, seasonForMonth } from './lib/ambient/calendar.js';
export {
  activateDormant,
  effectiveLocation,
  effectiveRoutes,
  raidDrop,
  serviceDrop,
} from './lib/ambient/locations.js';
export { applyStageOps, electionDelta, selectEvents } from './lib/ambient/events.js';
export { selectIncidents } from './lib/ambient/incidents.js';

export {
  applyHook,
  informantReportsForTick,
  type AmbientHook,
  type HookResult,
} from './lib/ambient/hooks.js';

export {
  ambientDayBoundary,
  ambientPhase,
  ambientTurn,
  type AmbientTickResult,
} from './lib/ambient/tick.js';

export {
  applyLifeEvent,
  clampLeverDelta,
  dailyAgenda,
  emptyLife,
  isPrincipalNpc,
  lifeEvents,
  stepLife,
  type LifeEventTemplate,
} from './lib/ambient/life.js';

export {
  introductionTrustBonus,
  stepTies,
  tieAffinityBetween,
  tieProposition,
} from './lib/ambient/ties.js';

export { demote, promote, requestPromotion, stepPopulace } from './lib/ambient/populace.js';

export {
  compact,
  greetingLine,
  noticeCheck,
  noticeTurn,
  recollectionGrounded,
  regardDelta,
  regardOf,
  stepMemory,
  type Recollection,
  type Regard,
} from './lib/ambient/memory.js';

export { commitGossip, eligiblePair, stepGossip } from './lib/ambient/gossip.js';
export {
  AMBIENT_FACT_CAP,
  ambientScene,
  incidentFactLines,
  promptFactsFor,
  recollectionLine,
  recollectionPrompts,
  refreshPromptCache,
  selectAmbientFacts,
} from './lib/ambient/prompt.js';
export {
  addDevelopment,
  closeStale,
  editionCandidates,
  noticeLines,
  noticeStillPosted,
  openStory,
  postNotice,
  printedArticles,
  stepNews,
} from './lib/ambient/news.js';
export { stepThreads, type ThreadCatalogue } from './lib/ambient/threads.js';
export {
  keepsAnchor,
  quoteAttendDuty,
  resolveAttendDuty,
  scaleHighRiskSuspicion,
  settleDuties,
  stepCover,
} from './lib/ambient/cover.js';
export {
  anchorsOf,
  applyForDuration,
  footprint,
  gate,
  verifierResult,
  type GateCache,
  type GateDecision,
  type StructuralChange,
  type VerifierResult,
} from './lib/ambient/solvability.js';
export {
  AMBIENT_STREAM,
  ambientDaySeed,
  ambientInitRetry,
  ambientKeySeed,
} from './lib/ambient/streams.js';
export type { AmbientState, Density, Metrics } from './lib/ambient/state.js';
export {
  advanceAmbientCity,
  ambientContractOf,
  coarseSignature,
  createAmbientSimulator,
  playerConcerning,
  spineSignature,
  type CityAmbient,
} from './lib/ambient/fidelity.js';
export {
  AMBIENT_COUPLING_KINDS,
  AmbientContractError,
  ambientCouplingCaps,
  applyCouplings,
  emptyCouplingDraft,
  exampleCouplings,
  referenceCity,
  referenceSimulator,
  referenceSpine,
  runAmbientContract,
  advanceRegion,
  arrivalFactLines,
  arrive,
  assignTiers,
  initialRegionClock,
  serviceTickOrder,
  sliceAmbient,
  sliceCity,
  sliceSpine,
  spineProjection,
  spineTick,
  type AmbientContract,
  type AmbientCoupling,
  type AmbientOriginEvent,
  type AmbientSimulator,
  type AmbientStep,
  type CouplingCaps,
  type CouplingDraft,
  type GossipRef,
  type IRouteId,
  type RefCity,
  type RegionClockOptions,
  type RegionClockState,
  type SliceCity,
  type SpineView,
  type Window as CouplingWindow,
} from './lib/fidelity/index.js';

export { custodyHolds } from './lib/truth/truth.js';
