/**
 * The {@link EngineApi} interface and its stream/error vocabulary (design,
 * "Engine API (`player-view/api`)"; Requirements 2.2, 13.5).
 *
 * This is the only surface the TUI uses (Requirement 13.5). It exposes the game
 * through view-safe projections (`views`), the Case File, Notifications, saves
 * and the turn methods — and never a handle on the engine's Truth Store, so the
 * `tui-imports-only-player-view` dependency rule plus the branded `Truth<T>`
 * types keep ground truth unreachable from the client (Requirement 2.2).
 *
 * Task 16.1 owns this interface's *shape* and four of its projections (scene,
 * here, documents, Case File); the remaining projections and the Turn Pipeline
 * (16.8) land in sibling tasks. The view types those tasks own are declared here
 * as documented placeholders so the interface compiles as the design writes it,
 * each naming the task that fills it in. The fully-implemented projections point
 * at the concrete types in `./views.ts`.
 */

import type {
  Action,
  ActionQuote,
  AdmiraltyGrade,
  ClaimId,
  DocId,
  EntityId,
  FeedError,
  FeedItem,
  GameTime,
  GenerateInputs,
  InterceptId,
  NarrationMode,
  NotificationId,
  Outcome,
  TruthStore,
  WorldState,
} from '@tradecraft/engine';

// Re-exported so the facade surface keeps naming `FeedError` from one place.
export type { FeedError } from '@tradecraft/engine';

import type { PaperView } from '../region/papers.js';
import type { CarriageView, DepartureView, RegionMapView } from '../region/views.js';
import type { StreetView } from '../street/map.js';
import type {
  CaseFileFilter,
  ClaimView,
  DocumentListView,
  DocumentView,
  HereView,
  MapView,
  PeopleView,
  SceneView,
} from './views.js';
// Imported for use in the `EngineApi` interface below (the `views.intercepts()`
// / `views.workbench(id)` return types); re-exported just below so the facade
// surface keeps naming them from one place.
import type {
  InterceptListView,
  WorkbenchView,
} from './workbench-views.js';

export type {
  InterceptListView,
  WorkbenchView,
} from './workbench-views.js';
import type { JournalDay, JournalEntry, JournalNote } from '../journal/journal.js';
import type { Notification } from '../notify/notification.js';
// Imported for local use in the `EngineApi` interface below; also re-exported
// (with its sub-types) from one place further down, mirroring the Map/People
// view re-export pattern.
import type { DebriefView } from '../debrief/debrief.js';
import type { CityView, DutiesView, StoriesView } from '../city/city-views.js';

export type { Notification, NotificationKind } from '../notify/notification.js';

// The new-game options the TUI start screen gathers (`newGame`, below) are
// typed with the Narrator's `NarrationMode`; re-export it and the mode list
// through the facade so the TUI — which may import only `player-view` — can
// name the modes without reaching into the engine (Req 13.5).
export { NARRATION_MODES, type NarrationMode } from '@tradecraft/engine';

// ---------------------------------------------------------------------------
// Result helper (design `Result<T, E>`)
// ---------------------------------------------------------------------------

/**
 * A success-or-error result, mirroring the design's `Result<T, E>` used across
 * the engine API (`validateFeed`, `load`). `ok: true` carries a `value`; `ok:
 * false` carries an `error`.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

// ---------------------------------------------------------------------------
// Turn stream (design `TurnChunk` / `TurnStream`)
// ---------------------------------------------------------------------------

/**
 * One chunk of a turn's streamed result (design `TurnChunk`). A turn emits Fact
 * Lines, Narrator flavour and dialogue speech as they are produced, interleaved
 * with the control chunks the TUI reacts to:
 *
 * - `fact` — a committed Fact Line (plain style).
 * - `flavour` — a streamed Narrator sentence (dim italic).
 * - `speech` — a line of dialogue, tagged with the speaker's player-facing name.
 * - `interrupted` — sentences from a failed attempt are being discarded (the UI
 *   drops any flavour it had shown for this turn).
 * - `notification` — a Notification raised during the turn.
 * - `hint` — a one-off hint the pipeline fired from a Player View fact the
 *   first time its trigger occurred (slice-integration task 8.4; Req 19.10).
 *   The text is the authored hint text, verbatim; the UI shows it as a toast.
 * - `paused` — an endpoint became unreachable; the turn is paused awaiting a
 *   `retry()` or save-and-quit (Requirement 16.1; design "Endpoint error
 *   screen"). It names the endpoint and the message.
 * - `ended` — the game ended this turn, carrying the outcome.
 * - `done` — the turn finished normally.
 *
 * Every chunk is view-safe: a speaker name is the player-facing name, a Fact
 * Line and flavour are already rendered through the player namer, and the
 * `ended` outcome is the public outcome tag — none carries a {@link Truth}
 * field.
 */
export type TurnChunk =
  | { readonly kind: 'fact'; readonly text: string }
  | { readonly kind: 'flavour'; readonly text: string }
  | { readonly kind: 'speech'; readonly speaker: string; readonly text: string }
  | { readonly kind: 'interrupted' }
  | { readonly kind: 'notification'; readonly n: Notification }
  | { readonly kind: 'hint'; readonly text: string }
  | {
      readonly kind: 'paused';
      readonly error: { readonly endpoint: string; readonly message: string };
    }
  | { readonly kind: 'ended'; readonly outcome: Outcome }
  | { readonly kind: 'done' };

/** The async stream a turn method returns (design `TurnStream`). */
export type TurnStream = AsyncIterable<TurnChunk>;

// ---------------------------------------------------------------------------
// Load error (design `LoadError`)
// ---------------------------------------------------------------------------

/**
 * Why a save failed to load (design `LoadError`):
 *
 * - `manifest-mismatch` — the save's Content Manifest differs from the loaded
 *   packs; `differing` lists each pack id with its saved and loaded versions
 *   (design "Save/load screen").
 * - `version` — the save's state version is newer or older than this build
 *   supports.
 * - `corrupt` — the save failed to parse or validate.
 */
export type LoadError =
  | {
      readonly kind: 'manifest-mismatch';
      readonly differing: readonly {
        readonly id: string;
        readonly saved?: string;
        readonly loaded?: string;
      }[];
    }
  | { readonly kind: 'version'; readonly saved: number; readonly supported: number }
  | { readonly kind: 'corrupt'; readonly message: string };

/** Save metadata the save/load screen lists (design `SaveInfo`). */
export interface SaveInfo {
  readonly name: string;
  readonly seed: string;
  readonly difficulty: string;
  readonly at: GameTime;
  readonly savedAt: string;
  /** Whether the save's manifest matches the loaded packs (design). */
  readonly manifestMatches: boolean;
}

// ---------------------------------------------------------------------------
// Save Store (design "Facade: saves (Req 13)")
// ---------------------------------------------------------------------------

/**
 * The header fields `SaveStore.list` reads off each save file (design, "Facade:
 * saves": "reads each file's header fields `seed`, `difficulty`, `world.time`,
 * `savedAt`, `content`"). These are the view-safe, cheaply-read fields the
 * save/load screen lists without parsing the whole save: the determinism key
 * (`seed`, `difficulty`, `content` manifest), the in-game time the save was
 * taken at, and the one wall-clock stamp (`savedAt`), which lives only here and
 * never in World State.
 *
 * `content` is the save's Content Manifest, compared pack-by-pack against the
 * loaded packs with `diffManifests` to set {@link SaveInfo.manifestMatches}. It
 * is typed structurally (`packs` with id/version/hash) so this module stays free
 * of a content import; the facade passes the manifest from the loaded Content
 * Set straight into `diffManifests`.
 */
export interface SaveHeader {
  readonly seed: string;
  readonly difficulty: string;
  /** The in-game time the save was taken at (`world.time`). */
  readonly at: GameTime;
  /** The wall-clock time the save was written, ISO 8601. */
  readonly savedAt: string;
  /** The save's Content Manifest (pack id/version/hash per pack). */
  readonly content: {
    readonly packs: readonly {
      readonly id: string;
      readonly version: string;
      readonly hash: string;
    }[];
  };
}

/**
 * The injected store the facade's `saves` surface reads and writes through
 * (design, "Facade: saves"; Requirements 13.1, 13.2, 13.6, 13.7). It is the one
 * I/O seam of the save path: the facade builds the save snapshot and serialises
 * it with canonical JSON, and the store does the reading, listing and the atomic
 * write. Keeping the store injected is what lets player-view stay I/O-free — the
 * fs implementation lives in `app` (task 12.3), while tests drive an in-memory
 * store (`InMemorySaveStore`).
 *
 * - `list()` returns one entry per stored save, each with its `name` and the
 *   cheaply-read {@link SaveHeader}, or the marker `'corrupt'` for a file whose
 *   header could not be read. Order is the store's own (the fs store lists by
 *   name); the facade sorts for display.
 * - `read(name)` returns the save's parsed JSON value (an `unknown` the facade
 *   validates with `parseAndLoad`), or an error marker: `'missing'` when no save
 *   by that name exists, `'unreadable'` when the file exists but cannot be read
 *   or parsed as JSON.
 * - `write(name, json)` writes the canonical-JSON string for a save atomically
 *   (the fs store writes to a temp file, `fsync`s, then renames). The facade
 *   validates the name against {@link SAVE_NAME} before calling this, so the
 *   store never sees an unsafe name; the fs store additionally checks the
 *   resolved path lies inside the Saves Directory (Req 13.6).
 */
export interface SaveStore {
  list(): readonly { readonly name: string; readonly header: SaveHeader | 'corrupt' }[];
  read(name: string): unknown | { readonly error: 'missing' | 'unreadable' };
  write(name: string, json: string): void;
}

/**
 * The set of allowed save names (design, "Facade: saves": `SAVE_NAME`;
 * Requirement 13.6). A name must start with an alphanumeric and then use only
 * letters, digits, spaces, underscores and hyphens, up to 64 characters total.
 * The pattern excludes `/`, `\`, `.` (so `..` can never appear) and every other
 * path-significant or control character, so a name can never escape the Saves
 * Directory. The facade rejects a name that fails this before any write.
 */
export const SAVE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;

/**
 * Whether a string is an allowed save name ({@link SAVE_NAME}). The facade's
 * `saves.save` calls this before building or writing anything, so an invalid
 * name is rejected with no I/O (Req 13.6).
 */
export function isValidSaveName(name: string): boolean {
  return SAVE_NAME.test(name);
}

// ---------------------------------------------------------------------------
// Placeholder view/notification types (owned by sibling tasks)
// ---------------------------------------------------------------------------
//
// The design's `EngineApi` references a dozen view types and the `Notification`
// union that sibling tasks own. They are declared here as documented
// placeholders — each naming its owning task — so this interface compiles
// exactly as the design writes it, and so the fully-implemented 16.1
// projections (scene, here, documents, Case File) type-check against the real
// shapes in `./views.ts`. The owning task replaces its placeholder in place.

/**
 * The value `newGame` and `saves.load` return (design `GameView { status, seed,
 * preset, brief }`; Requirement 12.1): the opening status bar, the game's seed
 * (minted when the caller gave none, Req 12.2), the Difficulty Preset id, and
 * the brief Cable the game opens on. Every field is view-safe — the status is
 * the public {@link StatusView}, the seed and preset are the player-facing
 * strings, and the brief is the deterministically composed Cable Document — so
 * none carries a {@link TruthStore} value.
 */
export interface GameView {
  /** The opening status bar (day/phase, Location, Budget, Standing, ended?). */
  readonly status: StatusView;
  /** The game's seed, minted here when the caller supplied none (Req 12.2). */
  readonly seed: string;
  /** The Difficulty Preset id the game was generated under. */
  readonly preset: string;
  /** The brief Cable the game opens on (design: "GameView includes the brief Cable"). */
  readonly brief: DocumentView;
}

/**
 * The new-game options the facade's `newGame` accepts (design
 * `EngineApi.newGame`; Requirements 12.1, 12.2). Exactly the shape the TUI
 * start screen gathers, redeclared here so the facade and the {@link
 * GameFactory} name it from player-view without reaching into the TUI package.
 *
 * - `seed` — the game seed; omitted when the player left it blank, so the
 *   factory mints one and the returned {@link GameView} reports it (Req 12.2).
 * - `preset` — the Difficulty Preset id (Req 34.3).
 * - `mole` — whether the internal mole is enabled (overrides the scenario).
 * - `narration` — the Narrator mode (overrides the scenario).
 */
export interface NewGameOptions {
  readonly seed?: string;
  readonly preset: string;
  readonly mole: boolean;
  readonly narration: NarrationMode;
}

/**
 * The world-generation seam `newGame` drives (design, "Facade: `newGame`"; Req
 * 12.1). The Composition Root (task 12.5) supplies a {@link GameFactory} closed
 * over the loaded Content Set and the validated scenario config; `newGame`
 * hands it the resolved seed and options and gets back the generated world, its
 * seeded Truth Store, and the resolved {@link GenerateInputs} the game was
 * generated under (its `content`, `cityData` and `preset` feed the fresh
 * stores). The factory resolves the preset by id and overrides `mole` and
 * `narration` on the scenario before calling the engine's `generateGame`, so
 * `newGame` stays free of the content-resolution details.
 *
 * Generation is pure in `(seed, inputs)`, so two calls with the same options
 * produce deep-equal worlds (Req 12.5); the only non-deterministic read is the
 * seed mint, which `newGame` does once before any factory call (Req 12.2).
 */
export interface GameFactory {
  generate(
    seed: string,
    opts: NewGameOptions,
  ): {
    readonly inputs: GenerateInputs;
    readonly world: WorldState;
    readonly truth: TruthStore;
  };
}

/** The status bar's view (owned by the status/Turn Pipeline task). */
export interface StatusView {
  readonly time: GameTime;
  /** The calendar date, such as `1 December 1952`. */
  readonly date?: string;
  readonly location: { readonly id: EntityId; readonly name: string };
  readonly budget: number;
  readonly standing: number;
  readonly ended: boolean;
  /** The city the player is in. Absent in slice mode and while in transit. */
  readonly city?: { readonly id: string; readonly name: string };
  /**
   * The warning from the last arrival, when the player was told they may have
   * been followed. Absent once a later arrival does not repeat it. Not the
   * hidden tail flag.
   */
  readonly followed?: string;
  /** Set while the player is riding a departure. */
  readonly transit?: {
    readonly destination: { readonly id: string; readonly name: string };
    readonly arrives: GameTime;
  };
}

/** An action with its quote, as `actions()` lists them (design `ActionOption`). */
export interface ActionOption {
  readonly action: Action;
  readonly quote: ActionQuote;
}

/**
 * The Journal view (task 16.2; Requirements 33.1, 33.2; design, "Player Aids").
 *
 * The player's append-only fact log and their own notes, projected view-safe.
 * `days` is the fact log grouped by day and phase (Req 33.1); `entries` is the
 * same entries flat, earliest first, for a chronological read; `notes` are the
 * player's notes (Req 33.2). Every field is already-rendered Fact Lines, note
 * text and view-safe ids — never Flavour or a {@link Truth} value (Req 2.2).
 */
export interface JournalView {
  /** The fact log grouped by day then phase (Req 33.1). */
  readonly days: readonly JournalDay[];
  /** The fact log flat, earliest first (the same entries as `days`). */
  readonly entries: readonly JournalEntry[];
  /** The player's notes, earliest first (Req 33.2). */
  readonly notes: readonly JournalNote[];
}

// The Map and People views (task 16.3) are declared in `./views.ts` beside the
// pure functions that build them, mirroring the scene/here/Documents
// projections, and re-exported here so the `EngineApi` interface keeps naming
// them from one place.
export type {
  MapView,
  MapDistrict,
  MapLocation,
  MapRoute,
  MapDeadDrop,
  PeopleView,
  PersonEntry,
  OrgEntry,
  ItemEntry,
  RapportBand,
} from './views.js';

// The Intercepts list and Workbench views (task 22.5; Requirements 9.5, 9.6,
// 25.3) are declared in `./workbench-views.ts` beside the pure projection
// functions that build them, mirroring the scene/here/Map/People projections,
// and re-exported here so the `EngineApi` interface keeps naming them from one
// place. Both are fully view-safe: they carry an Intercept's metadata,
// ciphertext, frequency table, caesar shift preview and any revealed tradecraft
// error, but never the Truth-branded cipher spec or the plaintext.
export type {
  InterceptListEntry,
  FrequencyEntry,
  ShiftPreviewRow,
} from './workbench-views.js';

/**
 * One action the current Location offers, with its {@link ActionQuote} (design,
 * "Help and hints": "Help lists `quote()` results for the current Location").
 * The `kind` is the action kind the Location Type allows; `quote` is the cost
 * and eligibility the engine's pure `quote()` returns for a representative
 * action of that kind at the current Location. For actions whose eligibility or
 * exact cost depends on a specific target (an NPC, a Document, a route), the
 * quote reflects the shared Location gate — whether the Location allows the
 * action and is open now — and the action's representative base cost, so the
 * list still answers "what can I do here, and what does it cost" (Requirement
 * 26.5). `targeted` flags those kinds so the TUI can hint that a target is
 * chosen when the action is actually taken.
 */
export interface HelpActionEntry {
  readonly kind: Action['kind'];
  readonly quote: ActionQuote;
  /** True when the action needs a target chosen at use (NPC, Document, route). */
  readonly targeted: boolean;
}

/** One glossary entry the Help view lists (Requirement 26.5). */
export interface HelpGlossaryEntry {
  readonly term: string;
  readonly definition: string;
}

/**
 * The Help view (design, "Help and hints"; Requirement 26.5): the `quote()`
 * results for the actions the current Location offers, plus the glossary drawn
 * from the Content Set. Both are view-safe — a quote is cost/eligibility data
 * and a glossary entry is authored prose, so neither carries a {@link Truth}
 * field.
 */
export interface HelpView {
  /** The current Location's name, for the Help header. */
  readonly location: { readonly id: EntityId; readonly name: string };
  /** The actions available at the current Location, with their quotes. */
  readonly actions: readonly HelpActionEntry[];
  /** The glossary, in alphabetical order by term. */
  readonly glossary: readonly HelpGlossaryEntry[];
  /** Attribution lines for a built street graph. Absent when none is loaded. */
  readonly credits?: readonly string[];
}

// The end-of-game debrief view (task 20.2). The full shape and the pure
// `buildDebrief` that fills it live in `../debrief/debrief.ts`; the type is
// re-exported here so the `EngineApi` interface keeps naming `DebriefView` from
// one place (mirroring the Map/People view re-export above).
export type { CityView, StoriesView, DutiesView } from '../city/city-views.js';

export type {
  DebriefView,
  DebriefAllegiance,
  DebriefTimelineEntry,
  DebriefLie,
  DebriefLead,
  DebriefFedProposition,
  DebriefDirectiveResult,
  DebriefScore,
} from '../debrief/debrief.js';

// ---------------------------------------------------------------------------
// The Engine API (design "Engine API (`player-view/api`)")
// ---------------------------------------------------------------------------

/**
 * The only surface the TUI uses (Requirement 13.5), exactly as the design
 * writes it. Task 16.1 implements the scene, "here", Documents and Case File
 * projections and the stream/error vocabulary; the turn methods and the
 * remaining projections are wired by sibling tasks (the Turn Pipeline is 16.8).
 */
export interface EngineApi {
  newGame(opts: NewGameOptions): Promise<GameView>;

  /** Day, phase, Location, Budget, Standing, open Directives, alerts, ended? */
  status(): StatusView;

  /** Every action with its quote; disallowed ones carry a reason. */
  actions(): ActionOption[];

  /**
   * The talk that opens the station briefing, when the Chief is here and will
   * talk. Anyone else in the room is not the briefing.
   */
  briefingTalk(): Action | undefined;

  /** The cost and eligibility of one action (design `ActionQuote`). */
  quote(a: Action): ActionQuote;

  act(a: Action): TurnStream;
  /**
   * Say a line — only while a talk scene is open. An optional money `offer`
   * rides along for a money pitch: the Turn Pipeline rejects an offer the Budget
   * cannot cover before any model call, and otherwise debits it as the pitch
   * resolves (Req 15.7).
   */
  say(line: string, opts?: { readonly offer?: number }): TurnStream;
  endScene(): TurnStream;
  /** Re-run a paused turn. */
  retry(): TurnStream;

  depart(
    route: Extract<Action, { kind: 'depart' }>['route'],
    at: GameTime,
    papers: Extract<Action, { kind: 'depart' }>['papers'],
  ): TurnStream;
  requestPapers(
    doc: Extract<Action, { kind: 'request-papers' }>['doc'],
    holder: Extract<Action, { kind: 'request-papers' }>['holder'],
  ): TurnStream;
  applyVisa(country: Extract<Action, { kind: 'apply-visa' }>['country']): TurnStream;
  liaisonRequest(
    service: Extract<Action, { kind: 'liaison-request' }>['service'],
    about: Extract<Action, { kind: 'liaison-request' }>['about'],
    records?: boolean,
  ): TurnStream;
  liaisonShare(
    service: Extract<Action, { kind: 'liaison-share' }>['service'],
    props: Extract<Action, { kind: 'liaison-share' }>['props'],
  ): TurnStream;
  exfiltrate(
    asset: Extract<Action, { kind: 'exfiltrate' }>['asset'],
    route: Extract<Action, { kind: 'exfiltrate' }>['route'],
    at: GameTime,
    papers: Extract<Action, { kind: 'exfiltrate' }>['papers'],
  ): TurnStream;

  validateFeed(items: readonly FeedItem[]): Result<void, FeedError[]>;

  readonly caseFile: {
    list(f: CaseFileFilter): ClaimView[];
    grade(id: ClaimId, g: AdmiraltyGrade): void;
    link(a: ClaimId, b: ClaimId): void;
    unlink(a: ClaimId, b: ClaimId): void;
    /** The arrest-evidence count for a target (design `evidence`). */
    evidence(target: EntityId): number;
  };

  readonly notes: {
    add(n: { attachTo: number | EntityId | ClaimId; text: string }): void;
  };

  readonly views: {
    scene(): SceneView;
    here(): HereView;
    journal(): JournalView;
    map(): MapView;
    /** The street map and the open drive, or null when no street graph is loaded. */
    street(): StreetView | null;
    city(): CityView;
    stories(): StoriesView;
    duties(): DutiesView;
    people(): PeopleView;
    documents(): DocumentListView;
    document(id: DocId): DocumentView | undefined;
    intercepts(): InterceptListView;
    workbench(id: InterceptId): WorkbenchView;
    help(): HelpView;
    debrief(): DebriefView | null;
    region(): RegionMapView | undefined;
    departures(): readonly DepartureView[];
    papers(): readonly PaperView[];
    carriage(): CarriageView | undefined;
  };

  readonly notifications: {
    list(): Notification[];
    dismiss(id: NotificationId): void;
    subscribe(fn: (n: Notification) => void): () => void;
  };

  readonly saves: {
    list(): SaveInfo[];
    save(name: string): Promise<SaveInfo>;
    load(name: string): Promise<Result<GameView, LoadError>>;
  };
}
