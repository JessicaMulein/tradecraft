/**
 * The versioned {@link SaveSnapshot} and the pure save/load pair (task 21.1;
 * design, "Save, load and replay"; Requirements 17.1, 17.2, 31.6, 34.3).
 *
 * A save is a single, versioned JSON value that composes the *whole* session:
 * the engine's {@link WorldState} (which already carries the seed, the generator
 * version, the Content Manifest, the Difficulty Preset and the scenario on its
 * `meta`, the serialisable PRNG state on its `rng`, and each NPC's Told List on
 * its `told`), plus the Player-View stores the pipeline owns beside it — the
 * Journal, the Notification list, the Location Flavour cache, the action log and
 * the extraction queue (design keeps these on the `SaveSnapshot`, not on the
 * `WorldState`). The Station ledger (`world.station.ledger`) is recorded at the
 * top level too, as the design's `SaveSnapshot` writes it, so a reader can list
 * a save's Budget without walking the whole world.
 *
 * ## Version 4 (multi-city)
 *
 * `SAVE_VERSION` is `4`. The world may carry a region: every city's state and
 * fidelity tier, the per-city streams, transits, service beliefs and pending
 * handoffs. A version 3 save has no region and still loads in slice mode.
 * This build writes 4.
 *
 * ## Version 3 (ambient-world)
 *
 * Version 3 may carry `ambient`. A save whose world has no `ambient` field
 * loads with ambient disabled.
 *
 * ## Version 2 (slice-integration task 9.3)
 *
 * On top of the version-1 fields the snapshot carries
 * the Player-View data the slice added: the Case File (its Claims, grades, links
 * and the id counter, via {@link CaseFile.snapshot}/`fromSnapshot`), the Truth
 * Store's ground-truth data with its Maps stored as sorted entry arrays (so the
 * save is canonical JSON — {@link toTruthSnapshot}/{@link fromTruthSnapshot}),
 * the Player-View bookkeeping (`viewState`: the hints already shown and the
 * player-observed cover states) and the Turn Pipeline's resumable counters
 * (`pipeline`: `turnCounter` and `outcomeWritten`). The one wall-clock value,
 * `savedAt`, lives only in the save header and never in World State, so it does
 * not perturb replay determinism.
 *
 * ## Why it lives in `player-view`
 *
 * The snapshot composes the Player-View session stores *and* the engine state.
 * The engine must never import `player-view` (the truth/view split), so the
 * composition cannot live in the engine; it lives here, the one package that
 * already depends on both the engine and the content package (the manifest and
 * preset shapes). The Flavour cache is owned by the `dialogue` package, but its
 * *snapshot* is a plain `Record<string, string[]>` — this module stores that
 * record and never imports `dialogue`, so no new package boundary is crossed:
 * the caller (which holds the live `LocationFlavourCache`) passes
 * `cache.snapshot()` in and rebuilds with `LocationFlavourCache.from(...)`.
 *
 * ## Purity
 *
 * {@link saveSnapshot} and {@link loadSnapshot} are pure: they build and
 * rebuild the in-memory value and never touch the filesystem. The facade's
 * `saves.save`/`saves.load` wiring (and the golden-replay CI, task 21.4) layer
 * the fs read/write and the JSON (de)serialisation on top. Keeping the snapshot
 * pure is what lets the round-trip property (task 21.2, Property 13) drive it
 * through `JSON.parse(JSON.stringify(...))` without any I/O.
 *
 * ## Refusing an incompatible save (Requirements 31.6, 17.1)
 *
 * {@link loadSnapshot} refuses two kinds of incompatible save, returning a typed
 * {@link LoadError} (the facade's own vocabulary) rather than throwing:
 *
 *   - **version** — the save's `version` is not the one this build writes
 *     (`SAVE_VERSION`, currently 4). A version 3 save still loads. Any other
 *     version is not silently reinterpreted;
 *     {@link parseAndLoad} reports a `version` error before its strict schema
 *     could reject the different shape as `corrupt` (slice task 9.3, Req 13.5).
 *   - **manifest-mismatch** — the save's Content Manifest differs from the
 *     currently loaded packs' manifest (Req 31.6). The two manifests are
 *     compared pack-by-pack and `differing` names each pack whose version or
 *     hash differs (or that is present on only one side), so the save/load
 *     screen can show exactly what changed and leave the current game untouched.
 *
 * A save that passes both gates restores to a session byte-for-byte equal to the
 * one it was taken from (Requirement 17.2).
 */

import {
  LedgerSchema,
  PrngStateSchema,
  PropositionSchema,
  type Allegiance,
  type ClaimTruthRecord,
  type CoverState,
  type Ledger,
  type EntityId,
  type NpcId,
  type PrngState,
  type Proposition,
  type TruthStoreData,
  type UnkId,
  type WorldState,
} from '@tradecraft/engine';
import {
  ContentManifestSchema,
  DifficultyPresetSchema,
  HintTriggerSchema,
  type ContentManifest,
  type DifficultyPreset,
  type HintTrigger,
} from '@tradecraft/content';
import { z } from 'zod';

import {
  Journal,
  type JournalEntry,
  type JournalNote,
  type JournalSnapshot,
} from '../journal/journal.js';
import {
  NotificationStore,
  type NotificationStoreSnapshot,
} from '../notify/store.js';
import {
  ActionLog,
  ExtractionQueue,
  type ActionLogSnapshot,
  type ExtractionQueueSnapshot,
} from '../api/turn-pipeline.js';
import { CaseFile, type CaseFileSnapshot } from '../casefile/casefile.js';
import type { LoadError } from '../api/types.js';

// ---------------------------------------------------------------------------
// Version
// ---------------------------------------------------------------------------

/**
 * The save-format version this build writes and reads (design `SaveSnapshot.version`).
 * Bumped whenever the snapshot's shape changes in a way an older build could not
 * read; {@link loadSnapshot} refuses any other version with a `version`
 * {@link LoadError} rather than guessing (Requirement 17.1).
 */
export const SAVE_VERSION = 4;

/** Versions this build restores. Version 3 is a slice or ambient save. */
export function readableSaveVersion(version: number): boolean {
  return version === 3 || version === SAVE_VERSION;
}

// ---------------------------------------------------------------------------
// The Flavour-cache snapshot shape
// ---------------------------------------------------------------------------

/**
 * The Location Flavour cache's save shape: the stable `(locId, phase, crowd)`
 * key to the stored Flavour sentences (dialogue's `FlavourCacheSnapshot`).
 * Re-declared here as a plain record so this module stays free of a `dialogue`
 * import; the caller passes `locationFlavourCache.snapshot()` in and rebuilds
 * with `LocationFlavourCache.from(snapshot.flavourCache)`.
 */
export type FlavourCacheSnapshotData = Readonly<Record<string, readonly string[]>>;

// ---------------------------------------------------------------------------
// The Truth Store snapshot shape (Maps as sorted entry arrays)
// ---------------------------------------------------------------------------

/**
 * The Truth Store's serialisable contents for a v2 save (slice task 9.3, design
 * "Snapshot v2"). The engine's {@link TruthStoreData} holds its allegiances and
 * identities as `Map`s, which do not survive `JSON.stringify`; this shape stores
 * them as **sorted entry arrays** so the save is plain, canonical JSON and the
 * round-trip is byte-for-byte stable (two equal stores save to equal JSON). The
 * facts and Claim-truths are already arrays and carry over as-is.
 *
 * This is ground-truth data — it is written and read only by the facade's save
 * wiring, which holds the live Truth Store; it never crosses to a Player View
 * surface. The save module keeps it as plain data (as it does the Flavour cache
 * and the WorldState) and does not reach into the engine's store: the caller
 * passes `truthStore.snapshot()` in via {@link toTruthSnapshot} and rebuilds the
 * store with {@link fromTruthSnapshot}'s data and the loaded predicate registry.
 */
export interface TruthSnapshotData {
  readonly facts: readonly Proposition[];
  /** `[npc, allegiance]` entries, sorted by NPC id. */
  readonly allegiances: readonly (readonly [NpcId, Allegiance])[];
  /** `[unk, npc]` entries, sorted by `unk:` id. */
  readonly identities: readonly (readonly [UnkId, NpcId])[];
  readonly claimTruths: readonly ClaimTruthRecord[];
  /** `[item, origin]` entries, sorted by item id. Absent when no origin was recorded. */
  readonly itemOrigins?: readonly (readonly [string, string])[];
  /** Add-on truth. Absent when no add-on has written a slice. */
  readonly ext?: {
    readonly streetOps?: NonNullable<TruthStoreData['ext']>['streetOps'];
  };
}

/**
 * Turn a live {@link TruthStoreData} (the Maps the engine's store exposes) into
 * the save's {@link TruthSnapshotData}, with the Maps flattened to sorted entry
 * arrays. Pure.
 */
export function toTruthSnapshot(data: TruthStoreData): TruthSnapshotData {
  return {
    facts: [...data.facts],
    allegiances: [...data.allegiances.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    ),
    identities: [...data.identities.entries()].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    ),
    claimTruths: [...data.claimTruths],
    ...(data.itemOrigins === undefined || data.itemOrigins.size === 0
      ? {}
      : {
          itemOrigins: [...data.itemOrigins.entries()].sort((a, b) =>
            a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
          ),
        }),
    ...(data.ext === undefined ? {} : { ext: data.ext }),
  };
}

/**
 * Rebuild a {@link TruthStoreData} (with real `Map`s) from a save's
 * {@link TruthSnapshotData}, ready to pass to `TruthStore.from(predicates, …)`.
 * Pure; the inverse of {@link toTruthSnapshot}.
 */
export function fromTruthSnapshot(snapshot: TruthSnapshotData): TruthStoreData {
  return {
    facts: snapshot.facts,
    allegiances: new Map(snapshot.allegiances),
    identities: new Map(snapshot.identities),
    claimTruths: snapshot.claimTruths,
    ...(snapshot.itemOrigins === undefined
      ? {}
      : { itemOrigins: new Map(snapshot.itemOrigins) as Map<string, EntityId> }),
    ...(snapshot.ext === undefined ? {} : { ext: snapshot.ext }),
  };
}

// ---------------------------------------------------------------------------
// The view-state and pipeline snapshot shapes
// ---------------------------------------------------------------------------

/**
 * The small bundle of Player-View bookkeeping a v2 save adds (design "Snapshot
 * v2"): the hint triggers that have already fired (so a loaded game does not
 * re-show a hint the player has seen, Req 19.10) and the cover states the player
 * has observed per NPC (the confront resolver's player-visible result). Both are
 * plain, view-safe data; the caller reads them off the live `HintStore` and the
 * Relationships and passes them in, so the save module imports neither.
 */
export interface ViewStateSnapshot {
  /** The triggers whose hint has already been shown this session. */
  readonly hintsSeen: readonly HintTrigger[];
  /** The player-observed cover state for each NPC the player has pressured. */
  readonly observedCoverState: Readonly<Record<NpcId, CoverState>>;
}

/**
 * The Turn Pipeline's resumable counters (design "Snapshot v2"): the monotonic
 * turn counter and whether the game's Outcome Record has already been written.
 * Saving `outcomeWritten` is what lets loading an ended game avoid writing the
 * Outcome Record a second time (Req 7.6).
 */
export interface PipelineSnapshot {
  readonly turnCounter: number;
  readonly outcomeWritten: boolean;
}

// ---------------------------------------------------------------------------
// The SaveSnapshot type
// ---------------------------------------------------------------------------

/**
 * One versioned save (design `SaveSnapshot`). It composes the engine state and
 * the Player-View session stores:
 *
 *   - `version` — the save-format version ({@link SAVE_VERSION}).
 *   - `generatorVersion`, `seed`, `content`, `difficulty`, `scenario` — the
 *     determinism key, lifted from `world.meta` to the top level so a reader
 *     (the save/load screen, Req 13.9, 34.3) can list them without the whole
 *     world. `content` is the Content Manifest (Req 31.6); `difficulty` the
 *     resolved Difficulty Preset (Req 34.3).
 *   - `rng` — the serialisable PRNG state (also on `world.rng`; kept at the top
 *     level as the design writes it, Req 17.1).
 *   - `world` — the full {@link WorldState}, the Sim's state of record.
 *   - `ledger` — the Station ledger (`world.station.ledger`), recorded for the
 *     save-list Budget; it must equal `world.station.ledger` on load.
 *   - `journal`, `notifications`, `flavourCache`, `actionLog`, `extractionQueue`
 *     — the Player-View session stores (Journal fact log + notes, the full
 *     Notification list, the Location Flavour cache, the ordered action log and
 *     the pending extraction queue).
 */
export interface SaveSnapshot {
  readonly version: number;
  readonly generatorVersion: string;
  readonly seed: string;
  readonly content: ContentManifest;
  readonly difficulty: DifficultyPreset;
  readonly scenario: unknown;
  readonly rng: PrngState;
  readonly world: WorldState;
  readonly ledger: Ledger;
  readonly journal: JournalSnapshot;
  readonly notifications: NotificationStoreSnapshot;
  readonly flavourCache: FlavourCacheSnapshotData;
  readonly actionLog: ActionLogSnapshot;
  readonly extractionQueue: ExtractionQueueSnapshot;
  // --- version 2 (slice-integration task 9.3) ---
  /**
   * The Case File — the player's record of what sources asserted (its Claims,
   * grades, links and the derived relation, plus the id counter). Rebuilt with
   * {@link CaseFile.fromSnapshot}.
   */
  readonly caseFile: CaseFileSnapshot;
  /**
   * The Truth Store's ground-truth data, with its Maps stored as sorted entry
   * arrays ({@link TruthSnapshotData}). Rebuilt into a store by the facade from
   * {@link fromTruthSnapshot}'s data and the loaded predicate registry.
   */
  readonly truth: TruthSnapshotData;
  /** The Player-View bookkeeping (seen hints, observed cover states). */
  readonly viewState: ViewStateSnapshot;
  /** The Turn Pipeline's resumable counters. */
  readonly pipeline: PipelineSnapshot;
  /**
   * The wall-clock time the save was written, ISO 8601. This is the one
   * non-deterministic value in a save; it lives only in the header and never in
   * World State, so it does not perturb replay determinism (design, saves).
   */
  readonly savedAt: string;
}

// ---------------------------------------------------------------------------
// The Zod schema
// ---------------------------------------------------------------------------

/**
 * A view-safe Journal snapshot schema. The entries and notes carry only
 * already-rendered strings and view-safe ids, so the schema validates their
 * shape without re-stating every id's brand (the engine owns those). It is
 * `passthrough`-free (strict) at the envelope level but accepts the entries'
 * strings/arrays as-is.
 */
const GameTimeShape = z
  .object({ day: z.number().int(), phase: z.number().int() })
  .loose();

const JournalEntrySchema: z.ZodType<JournalEntry> = z
  .object({
    seq: z.number().int(),
    at: GameTimeShape,
    factLines: z.array(z.string()).readonly(),
    refs: z.array(z.string()).readonly(),
  })
  .strict() as unknown as z.ZodType<JournalEntry>;

const JournalNoteSchema: z.ZodType<JournalNote> = z
  .object({
    seq: z.number().int(),
    at: GameTimeShape,
    attachTo: z.union([z.number(), z.string()]),
    text: z.string(),
  })
  .strict() as unknown as z.ZodType<JournalNote>;

const JournalSnapshotSchema: z.ZodType<JournalSnapshot> = z
  .object({
    entries: z.array(JournalEntrySchema).readonly(),
    notes: z.array(JournalNoteSchema).readonly(),
    nextEntrySeq: z.number().int(),
    nextNoteSeq: z.number().int(),
  })
  .strict() as unknown as z.ZodType<JournalSnapshot>;

/**
 * The Notification list schema. Each Notification carries the four shared base
 * fields plus a per-kind payload; the per-kind fields are validated loosely
 * (the player-view `Notification` union is the authoritative type) so a new
 * event kind does not force a schema change here, while the base shape — the
 * fields the save/load screen and the status bar read — is checked.
 */
const NotificationSchema = z
  .object({
    id: z.string(),
    at: GameTimeShape,
    factLine: z.string(),
    dismissed: z.boolean(),
    kind: z.string(),
  })
  .loose();

const NotificationStoreSnapshotSchema: z.ZodType<NotificationStoreSnapshot> = z
  .array(NotificationSchema)
  .readonly() as unknown as z.ZodType<NotificationStoreSnapshot>;

/** The Flavour cache record: key -> sentences. */
const FlavourCacheSchema: z.ZodType<FlavourCacheSnapshotData> = z
  .record(z.string(), z.array(z.string()).readonly()) as unknown as z.ZodType<FlavourCacheSnapshotData>;

/** One action-log entry: the shared base plus a loose per-kind payload. */
const ActionLogEntrySchema = z
  .object({
    seq: z.number().int(),
    turn: z.string(),
    at: GameTimeShape,
    kind: z.string(),
  })
  .loose();

const ActionLogSnapshotSchema: z.ZodType<ActionLogSnapshot> = z
  .object({
    entries: z.array(ActionLogEntrySchema).readonly(),
    nextSeq: z.number().int(),
  })
  .strict() as unknown as z.ZodType<ActionLogSnapshot>;

/** One queued extraction job. */
const PropositionShape = PropositionSchema as unknown as z.ZodType<Proposition>;

/**
 * The speaker's knowledge captured at the dialogue turn (Req 17.2): the
 * Propositions they hold true and their false beliefs. Modelled structurally
 * here (as the Flavour cache is) so the save module stays free of a `dialogue`
 * import; the engine's {@link PropositionSchema} validates each entry.
 */
const SpeakerKnowledgeShape = z
  .object({
    known: z.array(PropositionShape).readonly(),
    falseBeliefs: z.array(PropositionShape).readonly(),
    promote: z.array(z.string()).readonly(),
  })
  .strict();

const QueuedExtractionSchema = z
  .object({
    turnId: z.string(),
    speaker: z.string(),
    utterance: z.string(),
    at: GameTimeShape,
    // Task 8.3's two-phase extraction job carries the phase-2 commit state:
    // the speaker's knowledge and Told List at the dialogue turn, and whether
    // their cover was intact (Req 17.2, 17.5).
    speakerKnowledgeAtTurn: SpeakerKnowledgeShape,
    toldList: z.array(PropositionShape).readonly(),
    coverIntact: z.boolean(),
  })
  .strict();

const ExtractionQueueSnapshotSchema: z.ZodType<ExtractionQueueSnapshot> = z
  .array(QueuedExtractionSchema)
  .readonly() as unknown as z.ZodType<ExtractionQueueSnapshot>;

// ---------------------------------------------------------------------------
// Version-2 schemas (slice task 9.3)
// ---------------------------------------------------------------------------

/**
 * One Case File Claim. Like the Journal and action-log entries, a Claim carries
 * already-shaped, view-safe data (ids, a Proposition, the player's grade, links
 * and the derived relation); the envelope is validated strictly and the
 * Proposition through the engine's {@link PropositionSchema}, while the branded
 * ids and the source union are accepted as structured JSON (the Case File is the
 * authoritative type and the round-trip property pins fidelity).
 */
const ClaimSchema = z
  .object({
    id: z.string(),
    source: z.object({ kind: z.string() }).loose(),
    prop: PropositionShape,
    observedAt: GameTimeShape,
    hedged: z.boolean(),
    grade: z.unknown().optional(),
    links: z.array(z.string()).readonly(),
    relation: z.enum(['none', 'corroborated', 'conflicted']),
  })
  .loose();

const CaseFileSnapshotSchema: z.ZodType<CaseFileSnapshot> = z
  .object({
    claims: z.array(ClaimSchema).readonly(),
    nextId: z.number().int(),
  })
  .strict() as unknown as z.ZodType<CaseFileSnapshot>;

/** An NPC's true allegiance: just the org id it really serves. */
const AllegianceShape = z
  .object({ org: z.string() })
  .loose() as unknown as z.ZodType<Allegiance>;

/** One recorded Claim-truth (ground truth; validated structurally). */
const ClaimTruthRecordShape = z
  .object({
    claim: PropositionShape,
    speaker: z.string(),
    at: GameTimeShape,
    held: z.boolean(),
    believed: z.boolean(),
    lie: z.boolean(),
  })
  .strict() as unknown as z.ZodType<ClaimTruthRecord>;

/**
 * The Truth Store snapshot: facts and Claim-truths as arrays, allegiances and
 * identities as sorted `[key, value]` entry arrays (the Maps the engine store
 * exposes, flattened for JSON — see {@link toTruthSnapshot}).
 */
const TruthSnapshotSchema: z.ZodType<TruthSnapshotData> = z
  .object({
    facts: z.array(PropositionShape).readonly(),
    allegiances: z
      .array(z.tuple([z.string(), AllegianceShape]))
      .readonly(),
    identities: z.array(z.tuple([z.string(), z.string()])).readonly(),
    claimTruths: z.array(ClaimTruthRecordShape).readonly(),
    itemOrigins: z.array(z.tuple([z.string(), z.string()])).readonly().optional(),
    ext: z
      .object({
        streetOps: z.unknown().optional(),
      })
      .strict()
      .optional(),
  })
  .strict() as unknown as z.ZodType<TruthSnapshotData>;

/** The Player-View bookkeeping: seen hint triggers and observed cover states. */
const ViewStateSchema: z.ZodType<ViewStateSnapshot> = z
  .object({
    hintsSeen: z.array(HintTriggerSchema).readonly(),
    observedCoverState: z.record(
      z.string(),
      z.enum(['intact', 'strained', 'cracking', 'blown']),
    ),
  })
  .strict() as unknown as z.ZodType<ViewStateSnapshot>;

/** The Turn Pipeline's resumable counters. */
const PipelineSnapshotSchema: z.ZodType<PipelineSnapshot> = z
  .object({
    turnCounter: z.number().int(),
    outcomeWritten: z.boolean(),
  })
  .strict() as unknown as z.ZodType<PipelineSnapshot>;

/**
 * The {@link SaveSnapshot} schema (task 21.1). It validates the versioned
 * envelope and every serialisable part. The {@link WorldState} and the resolved
 * scenario are large engine/content values with no standalone exported schema;
 * they are accepted as structured JSON here (`z.unknown()`), and their fidelity
 * is guaranteed by the round-trip (Property 13) and the engine's own invariants,
 * not re-validated field-by-field at the save boundary. Everything the save/load
 * screen and the load gates read — the version, the manifest, the preset, the
 * seed, the ledger and the Player-View stores — is validated here.
 */
export const SaveSnapshotSchema: z.ZodType<SaveSnapshot> = z
  .object({
    version: z.number().int(),
    generatorVersion: z.string(),
    seed: z.string(),
    content: ContentManifestSchema,
    difficulty: DifficultyPresetSchema,
    scenario: z.unknown(),
    rng: PrngStateSchema,
    world: z.unknown(),
    ledger: LedgerSchema,
    journal: JournalSnapshotSchema,
    notifications: NotificationStoreSnapshotSchema,
    flavourCache: FlavourCacheSchema,
    actionLog: ActionLogSnapshotSchema,
    extractionQueue: ExtractionQueueSnapshotSchema,
    caseFile: CaseFileSnapshotSchema,
    truth: TruthSnapshotSchema,
    viewState: ViewStateSchema,
    pipeline: PipelineSnapshotSchema,
    savedAt: z.string(),
  })
  .strict() as unknown as z.ZodType<SaveSnapshot>;

// ---------------------------------------------------------------------------
// Building a snapshot (save)
// ---------------------------------------------------------------------------

/**
 * The live session a save is taken from: the engine's current {@link WorldState}
 * and the Player-View session stores (plus the Flavour cache's plain snapshot,
 * passed in so this module does not import `dialogue`). Everything on
 * `world.meta` — the seed, the generator version, the Content Manifest, the
 * Difficulty Preset and the scenario — is read from the world, so a caller only
 * supplies the world and the stores.
 */
export interface SaveSources {
  /** The engine's current state of record. */
  readonly world: WorldState;
  /** The player's Journal (fact log + notes). */
  readonly journal: Journal;
  /** The view-side Notification store. */
  readonly notifications: NotificationStore;
  /** The Location Flavour cache's plain snapshot (`cache.snapshot()`). */
  readonly flavourCache: FlavourCacheSnapshotData;
  /** The pipeline's ordered action log. */
  readonly actionLog: ActionLog;
  /** The pipeline's pending extraction queue. */
  readonly extractionQueue: ExtractionQueue;
  // --- version 2 (slice-integration task 9.3) ---
  /** The player's Case File. */
  readonly caseFile: CaseFile;
  /** The Truth Store's contents (`truthStore.snapshot()`). */
  readonly truth: TruthStoreData;
  /** The Player-View bookkeeping (seen hints, observed cover states). */
  readonly viewState: ViewStateSnapshot;
  /** The Turn Pipeline's resumable counters. */
  readonly pipeline: PipelineSnapshot;
  /**
   * The wall-clock time to stamp the save header with (ISO 8601). The caller
   * supplies it (the facade reads the clock); it defaults to `new Date()` so a
   * caller that does not care — the round-trip property, a test — need not pass
   * one. It is the save's only non-deterministic value and lives only in the
   * header, never in World State.
   */
  readonly savedAt?: string;
}

/**
 * Build a {@link SaveSnapshot} from the live engine state and the Player-View
 * stores (Requirement 17.1). Pure: it copies the stores' snapshots and lifts the
 * determinism key off `world.meta`; it writes nothing. The result is a plain
 * value ready to `JSON.stringify` and validates against {@link SaveSnapshotSchema}.
 */
export function saveSnapshot(sources: SaveSources): SaveSnapshot {
  const { world } = sources;
  return {
    version: SAVE_VERSION,
    generatorVersion: world.meta.generatorVersion,
    seed: world.meta.seed,
    content: world.meta.content as unknown as ContentManifest,
    difficulty: world.meta.preset as unknown as DifficultyPreset,
    scenario: world.meta.scenario,
    rng: world.rng,
    world,
    ledger: world.station.ledger,
    journal: sources.journal.snapshot(),
    notifications: sources.notifications.snapshot(),
    flavourCache: sources.flavourCache,
    actionLog: sources.actionLog.snapshot(),
    extractionQueue: sources.extractionQueue.snapshot(),
    caseFile: sources.caseFile.snapshot(),
    truth: toTruthSnapshot(sources.truth),
    viewState: sources.viewState,
    pipeline: sources.pipeline,
    savedAt: sources.savedAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Restoring a snapshot (load)
// ---------------------------------------------------------------------------

/** A loaded session: the restored engine state and the rebuilt Player-View stores. */
export interface LoadedSession {
  /** The restored engine state (equal to the one the save was taken from). */
  readonly world: WorldState;
  /** The rebuilt Journal. */
  readonly journal: Journal;
  /** The rebuilt Notification store. */
  readonly notifications: NotificationStore;
  /** The Flavour cache's plain snapshot, for `LocationFlavourCache.from(...)`. */
  readonly flavourCache: FlavourCacheSnapshotData;
  /** The rebuilt action log. */
  readonly actionLog: ActionLog;
  /** The rebuilt extraction queue. */
  readonly extractionQueue: ExtractionQueue;
  // --- version 2 (slice-integration task 9.3) ---
  /** The rebuilt Case File. */
  readonly caseFile: CaseFile;
  /**
   * The Truth Store's contents, with its Maps restored — ready for
   * `TruthStore.from(predicates, truth)`. The save module cannot build the live
   * store itself (it does not hold the predicate registry), so it hands back the
   * data and the facade builds the store.
   */
  readonly truth: TruthStoreData;
  /** The restored Player-View bookkeeping (seen hints, observed cover states). */
  readonly viewState: ViewStateSnapshot;
  /** The restored Turn Pipeline counters. */
  readonly pipeline: PipelineSnapshot;
}

/** The result of a load: the session on success, a typed {@link LoadError} on refusal. */
export type LoadResult =
  | { readonly ok: true; readonly session: LoadedSession }
  | { readonly ok: false; readonly error: LoadError };

/**
 * One differing pack in a `manifest-mismatch` {@link LoadError} (design): the
 * pack id, and its version on the saved and loaded sides (`undefined` on the
 * side that lacks the pack). This is exactly the element type of the
 * `manifest-mismatch` error's `differing` list.
 */
export interface ManifestDifference {
  readonly id: string;
  readonly saved?: string;
  readonly loaded?: string;
}

/**
 * Compare two Content Manifests pack-by-pack (Requirement 31.6). Returns the
 * `differing` list for a `manifest-mismatch` {@link LoadError}: every pack whose
 * version or hash differs between the saved and loaded manifests, and every pack
 * present on only one side (its missing side's version is `undefined`). The
 * result is sorted by pack id so the message is stable. An empty list means the
 * two manifests match.
 */
export function diffManifests(
  saved: ContentManifest,
  loaded: ContentManifest,
): ManifestDifference[] {
  const savedById = new Map(saved.packs.map((p) => [p.id, p]));
  const loadedById = new Map(loaded.packs.map((p) => [p.id, p]));
  const ids = [...new Set([...savedById.keys(), ...loadedById.keys()])].sort();

  const differing: ManifestDifference[] = [];
  for (const id of ids) {
    const s = savedById.get(id);
    const l = loadedById.get(id);
    // Present on both and identical (version and hash) -> not differing.
    if (s !== undefined && l !== undefined && s.version === l.version && s.hash === l.hash) {
      continue;
    }
    differing.push({ id, saved: s?.version, loaded: l?.version });
  }
  return differing;
}

/**
 * Restore a {@link LoadedSession} from a {@link SaveSnapshot}, refusing an
 * incompatible save with a typed {@link LoadError} (Requirements 17.2, 31.6).
 *
 * The gates run in order, cheapest first:
 *
 *   1. **version** — refuse any `version` other than {@link SAVE_VERSION}.
 *   2. **manifest-mismatch** — refuse if the save's Content Manifest differs
 *      from `loadedManifest` (the currently loaded packs). The current game is
 *      left untouched: this function returns the error and builds nothing.
 *
 * On success it rebuilds every Player-View store from its snapshot and returns
 * the world verbatim, so the session equals the one the save was taken from.
 * `loadedManifest` is the manifest of the packs the running build loaded; a
 * caller that wants to skip the manifest gate (a trusted replay from the same
 * build) may pass the save's own `content`.
 */
export function loadSnapshot(
  snapshot: SaveSnapshot,
  loadedManifest: ContentManifest,
): LoadResult {
  if (!readableSaveVersion(snapshot.version)) {
    return {
      ok: false,
      error: { kind: 'version', saved: snapshot.version, supported: SAVE_VERSION },
    };
  }

  const differing = diffManifests(snapshot.content, loadedManifest);
  if (differing.length > 0) {
    return { ok: false, error: { kind: 'manifest-mismatch', differing } };
  }

  return {
    ok: true,
    session: {
      world: snapshot.world,
      journal: Journal.fromSnapshot(snapshot.journal),
      notifications: NotificationStore.fromSnapshot(snapshot.notifications),
      flavourCache: snapshot.flavourCache,
      actionLog: ActionLog.fromSnapshot(snapshot.actionLog),
      extractionQueue: ExtractionQueue.fromSnapshot(snapshot.extractionQueue),
      caseFile: CaseFile.fromSnapshot(snapshot.caseFile),
      truth: fromTruthSnapshot(snapshot.truth),
      viewState: snapshot.viewState,
      pipeline: snapshot.pipeline,
    },
  };
}

/**
 * Parse an untrusted value (a JSON-parsed save file) into a {@link SaveSnapshot}
 * and load it, folding a parse/validation failure into a `corrupt`
 * {@link LoadError}. This is the entry point the facade's `saves.load` uses
 * after reading and `JSON.parse`-ing a file: a malformed save never throws, it
 * returns a typed error the save/load screen can show.
 */
export function parseAndLoad(value: unknown, loadedManifest: ContentManifest): LoadResult {
  // Check the format version before the full-shape validation, so a save from
  // another format version (an older version-1 save, whose shape this build's
  // strict schema would reject) is refused with a precise `version` error rather
  // than a generic `corrupt` one (slice task 9.3; Req 13.5). A value with no
  // readable numeric `version` is genuinely malformed and falls through to the
  // schema's `corrupt` path.
  const version = readVersion(value);
  if (version !== undefined && !readableSaveVersion(version)) {
    return {
      ok: false,
      error: { kind: 'version', saved: version, supported: SAVE_VERSION },
    };
  }

  const parsed = SaveSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: { kind: 'corrupt', message: parsed.error.message } };
  }
  return loadSnapshot(parsed.data, loadedManifest);
}

/**
 * Read a value's `version` field if it is a plain object with a numeric
 * `version`, else `undefined`. Used by {@link parseAndLoad} to tell a
 * version mismatch apart from a corrupt save before the strict schema runs.
 */
function readVersion(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const version = (value as { version?: unknown }).version;
  return typeof version === 'number' ? version : undefined;
}
