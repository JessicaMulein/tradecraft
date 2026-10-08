/**
 * The {@link EngineApi} facade (design, "Engine API (`player-view/api`)";
 * Requirements 2.2, 13.5).
 *
 * {@link PlayerViewEngine} is the concrete facade the TUI holds. It composes the
 * engine's state and the Player-View stores — a {@link WorldState}, the
 * {@link CaseFile}, the loaded {@link ContentSet} and {@link CityData}, the
 * Starting-Brief view and the predicate implication rules — and exposes them
 * through the view-safe projections of `./views.ts` and the Case File surface.
 *
 * ## Scope (task 16.1)
 *
 * This task implements the *projection surface*: `views.scene`, `views.here`,
 * `views.documents`, `views.document`, and the `caseFile` operations
 * (`list`/`grade`/`link`/`unlink`/`evidence`), plus the stream/error vocabulary
 * (`TurnChunk`, `TurnStream`, `LoadError`). The Turn Pipeline — `act`, `say`,
 * `endScene`, `retry` — is task 16.8: those methods forward to the `turnDriver`
 * seam, and `./turn-pipeline.ts`'s `createTurnDriver` is the concrete pipeline
 * that fills it, so 16.8 wires the pipeline behind this facade without changing
 * its shape (the `EngineApi` surface is unchanged). The other
 * projections (Journal, Map, People, Intercepts, Workbench, help, debrief) and
 * Notifications are owned by sibling tasks and left as seams here.
 *
 * ## Truth isolation (Requirement 2.2; Property 3)
 *
 * The facade never exposes the Truth Store, and it holds no reference to it: it
 * is built from view-safe state and the Player-View stores only. Every method
 * returns a projection built by the pure functions in `./views.ts`, which read
 * no {@link Truth} field and never consult ground truth. That — together with
 * the `tui-imports-only-player-view` dependency rule — is what keeps the client
 * truth-safe (the truth-isolation property is task 16.5).
 */

import {
  balance,
  markDocumentRead,
  quote as engineQuote,
  randomSeed,
  validateFeedItems,
  type Action,
  type ActionQuote,
  type AdmiraltyGrade,
  type ClaimId,
  type DocId,
  type EntityId,
  type FeedItem,
  type AdvanceWorldDeps,
  type NotificationId,
  type Proposition,
  type ResolverContext,
  type TruthStore,
  type WorldState,
} from '@tradecraft/engine';
import type { CityData, ContentManifest } from '@tradecraft/content';

import { CaseFile } from '../casefile/casefile.js';
import { addDocumentClaims } from '../casefile/document-claims.js';
import {
  evidenceCount,
  implicationRules,
  type BriefView,
  type ImplicationRules,
} from '../casefile/evidence.js';
import { helpView } from '../aids/help.js';
import { HintStore } from '../aids/hints.js';
import { cityView, dutiesView, storiesView, type CityView, type DutiesView, type StoriesView } from '../city/city-views.js';
import { buildDebrief, type RecordedFeed } from '../debrief/debrief.js';
import { Journal } from '../journal/journal.js';
import { journalView } from '../journal/view.js';
import { NotificationStore } from '../notify/store.js';
import { notify, notificationIdFor } from '../notify/notify.js';
import { isPlayerVisibleKind, type SimEvent } from '@tradecraft/engine';
import {
  documentListView,
  documentView,
  hereView,
  listClaims,
  mapView,
  peopleView,
  sceneView,
  type CaseFileFilter,
  type ClaimView,
  type DocumentListView,
  type DocumentView,
  type HereView,
  type SceneView,
} from './views.js';
import { interceptListView, workbenchView } from './workbench-views.js';
import { buildActionCatalogue } from './action-catalogue.js';
import { feedView } from './feed-view.js';
import { projectResolverContext } from './resolver-projection.js';
import type {
  ActionOption,
  DebriefView,
  EngineApi,
  FeedError,
  GameFactory,
  GameView,
  HelpView,
  InterceptListView,
  JournalView,
  LoadError,
  MapView,
  NewGameOptions,
  Notification,
  PeopleView,
  Result,
  SaveInfo,
  StatusView,
  TurnStream,
  WorkbenchView,
} from './types.js';

/**
 * The live game state and Player-View stores the facade reads. The engine's
 * action `quote` needs a {@link ResolverContext} (the loaded content and,
 * optionally, the Truth Store for actions that write it); the facade holds that
 * so `quote` and the turn methods can call into the resolver. `brief` and
 * `rules` feed the arrest-evidence count. Nothing truth-bearing is exposed
 * through the facade's own methods.
 */
export interface PlayerViewEngineDeps {
  /** The live world state. Replaced in place as turns commit (task 16.8). */
  state: WorldState;
  /** The player's Case File. */
  readonly caseFile: CaseFile;
  /**
   * The player's Journal: the append-only fact log and notes (task 16.2). The
   * Turn Pipeline (task 16.8) records a committed action's Fact Lines and each
   * delivered event's Fact Lines into it; the player's notes go in through
   * {@link PlayerViewEngine.notes}. Left optional so the facade can own a fresh
   * {@link Journal} when a caller does not supply one (the existing projection
   * tests construct the facade without it); a caller that needs the pipeline to
   * share the same store passes it here.
   */
  readonly journal?: Journal;
  /** The loaded city data, for the weather/crowd draws the scene/here views need. */
  readonly cityData: CityData;
  /** The resolver context (content + optional Truth Store) `quote` reads. */
  readonly ctx: ResolverContext;
  /** The Starting-Brief view the arrest-evidence count seeds its marks from. */
  readonly brief: BriefView;
  /** The predicate implication rules the arrest-evidence count applies. */
  readonly rules: ImplicationRules;
  /**
   * The view-side hints store (task 16.4; Requirement 26.6). Holds the content
   * hints and the *seen flags* — which live in the view, never in the
   * {@link WorldState} — so showing a hint cannot perturb the Sim. Optional: a
   * caller that omits it (and does not pass `hintsEnabled`) gets a store built
   * from the loaded content with hints disabled, so the facade is usable
   * without the pipeline wiring one. The Turn Pipeline (16.8) raises triggers on
   * it as player-visible situations occur.
   */
  readonly hints?: HintStore;
  /**
   * Whether hints are enabled, used to build the default {@link HintStore} when
   * `hints` is omitted (the resolved scenario `hints` setting, which the preset
   * default fills in). Ignored when `hints` is supplied.
   */
  readonly hintsEnabled?: boolean;
  /**
   * The view-side Notification store (task 16.6; Requirement 39.6). Holds the
   * player-facing Notifications a turn delivered and their dismissed flags —
   * view state, never {@link WorldState} — so the status bar reads the
   * undismissed list and dismissing one cannot perturb the Sim. Optional: a
   * caller that omits it gets a fresh store, so the facade is usable before the
   * Turn Pipeline (16.8) wires one. A caller that needs the pipeline to share
   * the same store passes it here.
   */
  readonly notifications?: NotificationStore;
  /**
   * The Turn Pipeline driver (task 16.8). Given an "intent" it runs the turn as
   * a transaction and streams the result, committing the next state back onto
   * {@link PlayerViewEngine} via {@link PlayerViewEngine.commit}. Left optional
   * so 16.1 compiles and the projection surface is testable without the
   * pipeline; a turn method called before 16.8 wires a driver throws a clear
   * "not yet wired" error rather than silently doing nothing.
   */
  readonly turnDriver?: TurnDriver;
  /**
   * The ground-truth {@link TruthStore}, for the end-of-game debrief (task
   * 20.2). The debrief is the one place the Player View legitimately reveals
   * ground truth — the game is over — so `views.debrief()` reads it to reveal
   * true allegiances, which Claims were lies, and the fed Propositions'
   * chickenfeed/deception classification (Requirements 8.3, 19.6). It is the
   * same store the resolver context threads to the engine's truth-writing
   * resolvers; a caller that already holds it on `ctx.truth` need not pass it
   * again. Optional and never exposed through the facade's own methods: the
   * only method that touches it is `views.debrief()`, and only once the game has
   * ended. When neither this nor `ctx.truth` is present, `views.debrief()`
   * cannot reveal truth and returns `null`.
   */
  readonly truth?: TruthStore;
  /**
   * The engine's clock-advance dependencies, for the action turn's
   * `advanceWorld` call (slice-integration task 8.1): the Day-Boundary Hooks
   * (`buildWorldHooks()`), the Objective Evaluator factory, the cipher keys and
   * the turn's Truth draft. The Composition Root (and the Session it builds)
   * supplies these; when a caller omits them — the existing pipeline/atomicity
   * specs do — the Turn Pipeline assembles a model-free {@link AdvanceWorldDeps}
   * from the loaded content, city data and the draft's own cipher material, so
   * the clock still advances deterministically. Optional and never exposed
   * through the facade's own methods.
   */
  readonly advance?: AdvanceWorldDeps;
  /**
   * The recorded feed deliveries, for the debrief's fed-Propositions section
   * (task 20.2; design, "Feed ingestion"). Each is a hidden `feed-delivered`
   * event the game recorded: a doubled agent carried the player's feed to its
   * handler, with the fed Propositions and the delivery time. The debrief
   * re-derives each Proposition's chickenfeed/deception classification from the
   * Truth Store at that time. Optional: a game in which the player fed no one
   * supplies nothing and the section is empty.
   */
  readonly feeds?: readonly RecordedFeed[];
  /**
   * The world-generation seam `newGame` drives (slice-integration task 9.1;
   * design, "Facade: `newGame`"; Requirement 12.1). The Composition Root (task
   * 12.5) supplies a {@link GameFactory} closed over the loaded Content Set and
   * the validated scenario config; `newGame` hands it the resolved seed and
   * options and rebuilds the facade's stores around the generated world.
   * Optional and never exposed through the facade's own methods: a caller that
   * omits it (the projection and pipeline specs do) gets a facade whose
   * `newGame` throws a clear error rather than silently doing nothing, while
   * every other surface works over the state the facade was constructed with.
   */
  readonly gameFactory?: GameFactory;
  /**
   * Where `newGame` gets a seed when the player gives none: a function of the
   * preset id that returns a seed, or `undefined` to fall back to a fresh
   * random one. The Composition Root supplies one that draws from the vetted
   * featured-seed list, so a random new game is always a playable one.
   */
  readonly seedSource?: (preset: string) => string | undefined;
  /**
   * The saves controller the facade's `saves` surface forwards to
   * (slice-integration task 9.4; design, "Facade: saves"). It is defined and
   * built in `./saves-controller.ts` (which may import the pure save/load module
   * and the Turn Pipeline's stores), closed over the injected {@link SaveStore}
   * and the save bridge, so the facade itself never imports the save module —
   * keeping `engine-api.ts` out of the `save → turn-pipeline → engine-api`
   * import cycle. The Composition Root (task 12.5) wires one; a caller that
   * omits it gets a facade whose `saves` surface errors clearly, while every
   * other surface works. Optional and never exposed through the facade's own
   * methods.
   */
  readonly savesController?: SavesController;
}

/**
 * The saves surface's implementation, built in `./saves-controller.ts` and
 * injected on {@link PlayerViewEngineDeps.savesController} (slice-integration
 * task 9.4). The facade's `saves` object forwards to it one-to-one. It is an
 * interface here (not an import of the controller module) so the facade declares
 * the shape without importing the save module, which keeps `engine-api.ts` off
 * the `save → turn-pipeline → engine-api` import cycle; the controller imports
 * the facade (for the {@link PlayerViewEngine} type) and the save module, not
 * the other way round, exactly as the Turn Pipeline's `createTurnDriver` does.
 */
export interface SavesController {
  /** List the stored saves as {@link SaveInfo} (design `saves.list`; Req 13.2). */
  list(): SaveInfo[];
  /** Write the current game to a save (design `saves.save`; Req 13.1, 13.6). */
  save(name: string): Promise<SaveInfo>;
  /** Load a save and swap the game in on success (design `saves.load`; Req 13.3–13.5). */
  load(name: string): Promise<Result<GameView, LoadError>>;
}

/**
 * The pieces the saves controller rebuilds a loaded game from (slice-integration
 * task 9.4). The controller (which may import the save module) parses and
 * validates a save, rebuilds the engine-level stores it needs the registry for
 * (the Truth Store), and hands this bundle to {@link PlayerViewEngine.applyLoaded}
 * so the facade swaps its whole live game in one assignment (Req 13.3). Every
 * field is an engine/content/player-view value — no save-module type — so the
 * facade can name this bundle without importing the save module.
 */
export interface LoadedGame {
  /** The restored world state. */
  readonly world: WorldState;
  /** The Truth Store rebuilt from the save's data and the loaded registry. */
  readonly truth: TruthStore;
  /** The rebuilt Case File. */
  readonly caseFile: CaseFile;
  /** The rebuilt Journal. */
  readonly journal: Journal;
  /** The rebuilt Notification store. */
  readonly notifications: NotificationStore;
  /** The rebuilt hints store (its seen flags restored from the save's view state). */
  readonly hints: HintStore;
}

/**
 * The intent handed to the {@link TurnDriver}: an action turn, a dialogue line,
 * a scene close, or a retry of a paused turn. Task 16.8 owns the pipeline that
 * interprets these; 16.1 fixes the vocabulary so the turn methods have a stable
 * shape to forward.
 */
export type TurnIntent =
  | { readonly kind: 'act'; readonly action: Action }
  | { readonly kind: 'say'; readonly line: string; readonly offer?: number }
  | { readonly kind: 'endScene' }
  | { readonly kind: 'retry' };

/**
 * The Turn Pipeline seam (task 16.8). It runs a {@link TurnIntent} against the
 * current engine and returns the {@link TurnStream} the TUI consumes. The
 * pipeline owns committing the next state (through the facade's `commit`), the
 * guards, narration and extraction; the facade only forwards the intent.
 */
export type TurnDriver = (engine: PlayerViewEngine, intent: TurnIntent) => TurnStream;

/**
 * The concrete {@link EngineApi} the TUI holds. Construct it with the live state
 * and the Player-View stores; the projections and Case File operations are
 * live over whatever `state`/`caseFile` currently hold, so a committed turn is
 * reflected on the next read.
 */
export class PlayerViewEngine implements EngineApi {
  /**
   * The live game's state and stores (design, "Player View: Session"). Mutable
   * so `newGame` (and, later, `saves.load`) can rebuild a complete new game and
   * swap every store in one assignment, leaving no store from the old game
   * reachable (Requirement 12.3). A committed turn mutates `deps.state` in place
   * through {@link commit}; a new game replaces the whole `deps` value.
   */
  private deps: PlayerViewEngineDeps;

  /**
   * The player's Journal (task 16.2). Taken from `deps.journal` when supplied —
   * so the Turn Pipeline and the facade share one store — else a fresh
   * {@link Journal} the facade owns, so `views.journal()` and `notes.add` work
   * even when a caller constructs the facade without one. Reset by `newGame`.
   */
  private journalStore: Journal;

  /**
   * The view-side hints store (task 16.4; Requirement 26.6). Built from the
   * supplied store, or a default over the loaded content with hints toggled by
   * `hintsEnabled`. Held on the facade so the Turn Pipeline and TUI raise
   * triggers through {@link hints}, keeping the seen flags in the view. Reset by
   * `newGame`.
   */
  private hintStore: HintStore;

  /**
   * The view-side Notification store (task 16.6). Taken from `deps.notifications`
   * when supplied — so the Turn Pipeline and the facade share one — else a fresh
   * {@link NotificationStore} the facade owns, so the `notifications` surface
   * works even when a caller constructs the facade without one. Reset by
   * `newGame`.
   */
  private notificationStore: NotificationStore;

  constructor(deps: PlayerViewEngineDeps) {
    this.deps = deps;
    this.journalStore = deps.journal ?? new Journal();
    this.hintStore =
      deps.hints ?? new HintStore(deps.ctx.content, deps.hintsEnabled ?? false);
    this.notificationStore = deps.notifications ?? new NotificationStore();
  }

  /** The player's Journal store (the append-only fact log and notes). */
  get journal(): Journal {
    return this.journalStore;
  }

  /**
   * The view-side hints store (Requirement 26.6). Raise a trigger with
   * `engine.hints.fire(trigger)` the first time its situation occurs; the store
   * returns the hint to show once and `undefined` thereafter, and the seen
   * flags it keeps never touch the {@link WorldState}.
   */
  get hints(): HintStore {
    return this.hintStore;
  }

  /**
   * The view-side Notification store (Requirement 39.6). The Turn Pipeline
   * (task 16.8) delivers a turn's Notifications through {@link deliverEvents};
   * the TUI reads the status-bar alerts from the `notifications` surface, which
   * is backed by this store.
   */
  get notificationStoreRef(): NotificationStore {
    return this.notificationStore;
  }

  /** The live world state (view-safe; the Truth Store is never exposed). */
  get state(): WorldState {
    return this.deps.state;
  }

  /**
   * Attach the saves controller after construction (slice-integration task
   * 9.4). The controller is built with `createSavesController(engine, …)`, which
   * closes over this facade, so it cannot be passed to the constructor without a
   * construction cycle; the Composition Root constructs the facade, builds the
   * controller over it, and attaches it here (exactly as it would wire a
   * turnDriver that needs the engine). A caller may also supply it on
   * {@link PlayerViewEngineDeps.savesController} if it has one in hand.
   */
  attachSaves(controller: SavesController): void {
    this.deps = { ...this.deps, savesController: controller };
  }

  /**
   * The pieces the Turn Pipeline needs to *simulate* a turn against the live
   * engine: the resolver {@link ResolverContext} the engine's `resolve` reads
   * (content and, for truth-writing actions, the Truth Store), the loaded
   * {@link CityData} the clock advance's weather/crowd draws need, and the
   * player's {@link CaseFile} the pipeline records extracted Claims into.
   *
   * ## Widened for the action-turn rewire (slice-integration task 8.1)
   *
   * The action turn now opens a {@link TruthDraft} over the Session's Truth
   * Store, rebuilds the per-turn {@link ResolverContext} with
   * {@link projectResolverContext} (which needs the Starting-Brief view and the
   * implication rules the arrest-evidence count reads), and advances the clock
   * with `advanceWorld` instead of the events-only `advance` (which needs the
   * engine's {@link AdvanceWorldDeps}). Those four pieces — `truth`, `brief`,
   * `rules` and `advance` — are already held on the facade's `deps`; this
   * accessor was widened to surface them read-only so the concrete
   * {@link TurnDriver} can drive the rewired pipeline without re-plumbing the
   * engine's construction.
   *
   * The change is purely **additive**: the `EngineApi` surface the TUI sees is
   * unchanged (this accessor is not on `EngineApi`), and the three fields the
   * pre-8.1 pipeline read (`ctx`, `cityData`, `caseFile`) keep their names and
   * types, so the existing projection, pipeline and atomicity specs — which
   * construct the facade without a Session, `brief`/`rules` default stand-ins,
   * no `truth` on `ctx` and no `advance` — compile and pass unchanged. The new
   * fields are optional, and the pipeline builds a model-free
   * {@link AdvanceWorldDeps} on the fly when `advance` is absent (see
   * `./turn-pipeline.ts`), so a facade wired without the Session's clock deps
   * still advances the clock deterministically.
   *
   * The Truth Store is still never returned on its own as a view-safe value:
   * `truth` here is the Session's ground-truth store the pipeline *stages over*
   * (never projects), exactly as `ctx.truth` is threaded into the engine's pure
   * `resolve`. The view projections continue to read none of it (Property 3).
   */
  get turnContext(): {
    readonly ctx: ResolverContext;
    readonly cityData: CityData;
    readonly caseFile: CaseFile;
    readonly brief: BriefView;
    readonly rules: ImplicationRules;
    readonly truth?: TruthStore;
    readonly advance?: AdvanceWorldDeps;
  } {
    return {
      ctx: this.deps.ctx,
      cityData: this.deps.cityData,
      caseFile: this.deps.caseFile,
      brief: this.deps.brief,
      rules: this.deps.rules,
      truth: this.deps.truth,
      advance: this.deps.advance,
    };
  }

  /**
   * Deliver a turn's events to the Player View (task 16.6; Requirements 39.2,
   * 39.6). The Turn Pipeline calls this at commit with every {@link SimEvent}
   * the turn produced (including derived events raised at phase boundaries): it
   * runs the pure {@link notify} over them against the live view, writes each
   * resulting Notification's Fact Line to the Journal under the event's own day
   * and phase (Requirement 39.2; design, "Timing"), and pushes the Notifications
   * onto the store so the status bar shows them (Requirement 39.6). Returns the
   * Notifications delivered, in event-time order, so the pipeline can emit the
   * `notification` turn chunks.
   *
   * Hidden events contribute nothing: `notify` ignores them, so a hidden event
   * with no observable consequence leaves the Journal and the Notification
   * stream unchanged (Requirements 39.4, 39.5).
   */
  deliverEvents(events: readonly SimEvent[]): Notification[] {
    const delivered = notify(events, this.deps.state);
    // Index the delivered Notifications by the event id they derive from, so
    // each event's Fact Line is recorded against the event itself (its refs and
    // its own day/phase) through the Journal's `recordEvent`.
    const byEventId = new Map(
      delivered.map((n) => [n.id, n] as const),
    );
    for (const event of events) {
      if (!isPlayerVisibleKind(event.kind)) {
        continue;
      }
      const n = byEventId.get(notificationIdFor(event));
      if (n !== undefined) {
        this.journalStore.recordEvent(event, [n.factLine]);
      }
    }
    this.notificationStore.pushAll(delivered);
    return delivered;
  }

  /**
   * Replace the live state after a committed turn (the Turn Pipeline's commit
   * step, task 16.8). The facade is a thin view over whatever state this holds,
   * so swapping it in is all a commit needs to do on the view side.
   */
  commit(next: WorldState): void {
    this.deps.state = next;
  }

  // -------------------------------------------------------------------------
  // Lifecycle and status (owned by the Turn Pipeline / status task)
  // -------------------------------------------------------------------------

  /**
   * Start a new game (slice-integration task 9.1; design, "Facade: `newGame`";
   * Requirements 12.1–12.4).
   *
   * The one non-deterministic read is the seed mint, which happens first when
   * the caller gave none (Req 12.2); from there the game is a pure function of
   * `(seed, options)`, so two calls with the same inputs produce deep-equal
   * worlds (Req 12.5). The steps follow the design:
   *
   *  1. `seed ??= seedSource(preset) ?? randomSeed()`.
   *  2. The {@link GameFactory} resolves the preset by id, overrides `mole` and
   *     `narration` on the scenario, and runs the engine's `generateGame`,
   *     returning the generated `world`, its seeded Truth Store, and the
   *     resolved {@link GenerateInputs} the game was generated under (Req 12.1).
   *  3. Build the {@link BriefView} (the orgs the Starting Brief designates
   *     hostile — the Hostile Service and the Cell) and the predicate
   *     implication rules from the registry.
   *  4. Build a complete fresh set of stores — Case File, Journal,
   *     Notifications, hints — and seed the Case File with the Starting Brief's
   *     lead Claims, which are the brief Cable's asserted Propositions filed as
   *     `document` Claims sourced from that Cable (Req 12.4). The seeding is the
   *     Cable's first read, so the Cable is marked read and a later `read` of it
   *     files no second copy of the leads.
   *  5. Swap the whole `deps` in one assignment, so no store from any previous
   *     game survives (Req 12.3), and return the {@link GameView} with the
   *     opening status, the seed, the preset id and the brief Cable (Req 12.1).
   */
  newGame(opts: NewGameOptions): Promise<GameView> {
    const { gameFactory } = this.deps;
    if (gameFactory === undefined) {
      return Promise.reject(
        new Error(
          'newGame needs a GameFactory; none was provided to the facade (the Composition Root supplies one, slice-integration task 12.5)',
        ),
      );
    }

    // Step 1: mint a seed only when the caller gave none (Req 12.2). This is the
    // one non-deterministic read, and it happens before any Sim call.
    const seed = opts.seed ?? this.deps.seedSource?.(opts.preset) ?? randomSeed();

    // Step 2: generate the world, its Truth Store and the resolved inputs.
    const resolvedOpts: NewGameOptions = { ...opts, seed };
    const { inputs, world, truth } = gameFactory.generate(seed, resolvedOpts);
    const { content, cityData, preset } = inputs;

    // Step 3: the arrest-evidence seeds. The Starting Brief designates the
    // Hostile Service and the Cell as hostile; those org ids are the BriefView's
    // hostile orgs, from which the arrest-evidence fixpoint grows persons,
    // materiel and channels off corroborated Claims. The implication rules come
    // from the predicate registry (each predicate's `implication` field).
    const brief = buildBriefView(world);
    const rules = implicationRules(
      content.predicates.predicates.map(
        (p) => [p.id, p.definition.implication] as const,
      ),
    );

    // Step 4: a complete fresh set of stores. Nothing from the previous game is
    // reused — a new Case File, Journal, Notification store and hints store
    // (hints enabled by the scenario, falling back to the preset default).
    const caseFile = new CaseFile();
    const journal = new Journal();
    const notifications = new NotificationStore();
    const hintsEnabled = inputs.scenario.hints ?? preset.hintsDefault;
    const hints = new HintStore(content, hintsEnabled);

    // Step 4 (continued): seed the Case File with the Starting Brief's lead
    // Claims (Req 12.4). The leads are the brief Cable's asserted Propositions;
    // they file as `document` Claims sourced from that Cable, exactly as a first
    // read of the Cable would record them. Seeding *is* that first read, so the
    // Cable is marked read in the same step (`player.readDocuments`): a later
    // `read` of it is then a repeat read that files nothing (slice Req 30.4,
    // Property 22). Left unread, reading the brief would file every lead a
    // second time from the same source, and each lead would corroborate itself.
    const briefCableId = briefCableDocId(world);
    let opened = world;
    if (briefCableId !== undefined) {
      addDocumentClaims(caseFile, {
        docId: briefCableId,
        propositions: briefCablePropositions(world, briefCableId),
        observedAt: world.time,
      });
      opened = markDocumentRead(world, briefCableId);
    }

    // Step 5: swap the whole live game in one assignment, so no store from the
    // old game is reachable (Req 12.3). The resolver context, clock-advance deps
    // and game factory are fixed for the lifetime of the facade (the Content Set
    // and scenario do not change between games), so they carry over.
    this.deps = {
      ...this.deps,
      state: opened,
      caseFile,
      journal,
      cityData,
      ctx: { ...this.deps.ctx, content, truth },
      brief,
      rules,
      hints,
      notifications,
      truth,
      feeds: [],
    };
    this.journalStore = journal;
    this.hintStore = hints;
    this.notificationStore = notifications;

    // The Game View: the opening status, the (possibly minted) seed, the preset
    // id, and the brief Cable the game opens on (Req 12.1). The brief Cable is
    // always present in a generated world, so `documentView` resolves it; the
    // fallback keeps `newGame` total if a pack ever omits it.
    const briefView =
      briefCableId === undefined
        ? undefined
        : documentView(opened, briefCableId);
    return Promise.resolve({
      status: this.status(),
      seed,
      preset: preset.id,
      brief: briefView ?? EMPTY_DOCUMENT_VIEW,
    });
  }

  status(): StatusView {
    const { state } = this.deps;
    const place = state.city.locations[state.player.loc];
    return {
      time: state.time,
      location: {
        id: state.player.loc,
        name: place?.name ?? state.player.loc,
      },
      budget: balanceOf(state),
      standing: state.station.standing,
      ended: state.ended !== undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Actions and quotes
  // -------------------------------------------------------------------------

  /**
   * The quote for a single action (design `quote`). Forwards to the engine's
   * pure `quote`, which decides eligibility and cost from view and Case File
   * data only, so an allowed/disallowed answer never reveals truth. It quotes
   * against {@link quoteContext}, the same Case File projection the Turn
   * Pipeline builds for the turn, so the arrest, confront, feed and turn-agent
   * gates see the held Claims and the evidence counts.
   */
  quote(a: Action): ActionQuote {
    return engineQuote(this.deps.state, a, this.quoteContext());
  }

  /**
   * Every candidate action with its quote (design `actions`; slice-integration
   * task 7.6). The enumeration is the pure {@link buildActionCatalogue}, which
   * reads the live state, the resolver context and the Case File's
   * arrest-evidence count and pairs each candidate with the engine's `quote`.
   * The catalogue reveals no truth — it reads only view/Case File data — and
   * always lists at least the `wait` options, so the "here" panel composes a
   * non-empty, deterministic list. Like {@link quote}, it quotes against
   * {@link quoteContext}.
   */
  actions(): ActionOption[] {
    return buildActionCatalogue(
      this.deps.state,
      this.quoteContext(),
      (target) => this.caseFile.evidence(target),
    );
  }

  /**
   * The Resolver Context the facade quotes against: the live `ctx` with the
   * Case File projections the Turn Pipeline adds for every turn
   * ({@link projectResolverContext}): the held Claims, the per-target arrest
   * evidence, the turn-agent evidence and the cipher keys. The arrest gate
   * reads `arrestEvidence`, `confront` and `feed` read `claims`, and
   * `turn-agent` reads `turnEvidence`; without the projection those quotes
   * would read nothing and report every arrest as unsupported, so the quote the
   * player is shown would disagree with the one the turn applies. The
   * projection reads only Case File data and threads the context's own Truth
   * Store, which quotes never write.
   */
  private quoteContext(): ResolverContext {
    const { state, caseFile, ctx, brief, rules } = this.deps;
    return {
      ...ctx,
      ...projectResolverContext(
        { state, caseFile, content: ctx.content, brief, rules },
        ctx.truth,
      ),
    };
  }

  // -------------------------------------------------------------------------
  // Turn methods (Turn Pipeline, task 16.8)
  // -------------------------------------------------------------------------

  act(a: Action): TurnStream {
    return this.runTurn({ kind: 'act', action: a });
  }

  say(line: string, opts?: { readonly offer?: number }): TurnStream {
    return this.runTurn({ kind: 'say', line, offer: opts?.offer });
  }

  endScene(): TurnStream {
    return this.runTurn({ kind: 'endScene' });
  }

  retry(): TurnStream {
    return this.runTurn({ kind: 'retry' });
  }

  /**
   * Forward a {@link TurnIntent} to the Turn Pipeline driver (task 16.8). Until
   * a driver is wired, this throws a clear error — the projection surface this
   * task owns does not need the pipeline, and failing loudly is better than a
   * silent no-op stream.
   */
  private runTurn(intent: TurnIntent): TurnStream {
    const { turnDriver } = this.deps;
    if (turnDriver === undefined) {
      throw new Error(
        'the Turn Pipeline is not wired yet (task 16.8); no turnDriver was provided',
      );
    }
    return turnDriver(this, intent);
  }

  // -------------------------------------------------------------------------
  // Feed validation (owned by the Feed task)
  // -------------------------------------------------------------------------

  /**
   * Validate a feed's items against the engine's shared `validateFeedItems`
   * (slice-integration task 9.8; Req 14.1, 14.2, 14.3). The view it reads is
   * built from Player-View and Case File data alone — the clock, the player's
   * known set and the held Case File Claims — so the facade's answer matches the
   * `feed` action's quote (Req 14.4) and reveals no ground truth (Req 14.3). The
   * resolved Propositions are discarded here; the composer only needs to know
   * the feed is valid, and gets every {@link FeedError} otherwise.
   */
  validateFeed(items: readonly FeedItem[]): Result<void, FeedError[]> {
    const view = feedView({ state: this.deps.state, caseFile: this.deps.caseFile });
    const result = validateFeedItems(items, view, this.deps.ctx.content);
    return result.ok ? { ok: true, value: undefined } : { ok: false, error: result.error };
  }

  // -------------------------------------------------------------------------
  // Case File (design `caseFile`)
  // -------------------------------------------------------------------------

  readonly caseFile = {
    list: (f: CaseFileFilter = {}): ClaimView[] => listClaims(this.deps.caseFile, f),
    grade: (id: ClaimId, g: AdmiraltyGrade): void => {
      this.deps.caseFile.grade(id, g);
    },
    link: (a: ClaimId, b: ClaimId): void => {
      this.deps.caseFile.link(a, b);
    },
    unlink: (a: ClaimId, b: ClaimId): void => {
      this.deps.caseFile.unlink(a, b);
    },
    evidence: (target: EntityId): number =>
      evidenceCount(this.deps.caseFile, target, this.deps.brief, this.deps.rules),
  };

  // -------------------------------------------------------------------------
  // Notes (owned by task 16.2's Journal/notes)
  // -------------------------------------------------------------------------

  readonly notes = {
    /**
     * Add a player note to the Journal (Requirement 33.2). The note is attached
     * to a day, an entity or a Claim, and stamped with the current game time so
     * it sorts with the fact log. The attachment and text are the player's; the
     * Journal records them verbatim.
     */
    add: (n: { attachTo: number | EntityId | ClaimId; text: string }): void => {
      this.journalStore.addNote({
        at: this.deps.state.time,
        attachTo: n.attachTo,
        text: n.text,
      });
    },
  };

  // -------------------------------------------------------------------------
  // Views (design `views`)
  // -------------------------------------------------------------------------

  readonly views = {
    scene: (): SceneView => sceneView(this.deps.state, this.deps.cityData),
    here: (): HereView => hereView(this.deps.state, this.deps.cityData),
    journal: (): JournalView => journalView(this.journalStore),
    map: (): MapView => mapView(this.deps.state, this.deps.cityData),
    city: (): CityView => cityView(this.deps.state, this.deps.caseFile, this.notificationStore.list()),
    stories: (): StoriesView => storiesView(this.deps.state),
    duties: (): DutiesView => dutiesView(this.deps.state),
    people: (): PeopleView => peopleView(this.deps.state, this.deps.caseFile),
    documents: (): DocumentListView => documentListView(this.deps.state),
    document: (id: DocId): DocumentView | undefined =>
      documentView(this.deps.state, id),
    intercepts: (): InterceptListView => interceptListView(this.deps.state),
    workbench: (
      id: Parameters<EngineApi['views']['workbench']>[0],
    ): WorkbenchView => {
      const view = workbenchView(this.deps.state, id);
      if (view === undefined) {
        throw new Error(`no collected Intercept with id "${id}"`);
      }
      return view;
    },
    help: (): HelpView =>
      helpView(this.deps.state, this.deps.ctx, this.deps.ctx.content.glossary),
    debrief: (): DebriefView | null => {
      // `debrief()` returns null until the game has ended (design, "`debrief()`
      // returns `null` until `ended` is set"). Once ended, it is the one place
      // the Player View reveals ground truth, so it needs the Truth Store (from
      // `deps.truth`, else the resolver context's `truth`). With no Truth Store
      // in reach it cannot reveal truth, so it stays null rather than returning
      // a hollow debrief.
      const { state } = this.deps;
      if (state.ended === undefined) {
        return null;
      }
      const truth = this.deps.truth ?? this.deps.ctx.truth;
      if (truth === undefined) {
        return null;
      }
      return buildDebrief(state, truth, this.deps.caseFile, this.deps.feeds ?? []);
    },
  };

  // -------------------------------------------------------------------------
  // Notifications (owned by task 16.6)
  // -------------------------------------------------------------------------

  readonly notifications = {
    /**
     * The undismissed Notifications the status bar shows as alerts (Requirement
     * 39.6). Dismissed Notifications stay in the store's history but are not
     * surfaced here, so the status bar lists exactly the live alerts.
     */
    list: (): Notification[] => this.notificationStore.undismissed(),
    /** Dismiss a Notification by id (Requirement 39.6). */
    dismiss: (id: NotificationId): void => {
      this.notificationStore.dismiss(id);
    },
    /** Subscribe to new Notifications as they arrive; returns an unsubscribe. */
    subscribe: (fn: (n: Notification) => void): (() => void) =>
      this.notificationStore.subscribe(fn),
  };

  // -------------------------------------------------------------------------
  // Saves (owned by the save/load task)
  // -------------------------------------------------------------------------

  readonly saves = {
    /**
     * List the stored saves (design, "Facade: saves": `list()`; Req 13.2).
     * Forwards to the injected {@link SavesController}; with none wired there is
     * nothing to list, so this returns an empty list.
     */
    list: (): SaveInfo[] => this.deps.savesController?.list() ?? [],

    /**
     * Write the current game to a save (design, "Facade: saves": `save(name)`;
     * Req 13.1, 13.6). Forwards to the injected {@link SavesController}; with
     * none wired it rejects with a clear error.
     */
    save: (name: string): Promise<SaveInfo> => {
      const { savesController } = this.deps;
      if (savesController === undefined) {
        return Promise.reject(
          new Error(
            'saves need a SavesController; none was provided to the facade (the Composition Root supplies one, slice-integration task 12.5)',
          ),
        );
      }
      return savesController.save(name);
    },

    /**
     * Load a save, swapping the whole game in on success (design, "Facade:
     * saves": `load(name)`; Req 13.3–13.5). Forwards to the injected
     * {@link SavesController}; with none wired it rejects with a clear error.
     */
    load: (name: string): Promise<Result<GameView, LoadError>> => {
      const { savesController } = this.deps;
      if (savesController === undefined) {
        return Promise.reject(
          new Error(
            'saves need a SavesController; none was provided to the facade (the Composition Root supplies one, slice-integration task 12.5)',
          ),
        );
      }
      return savesController.load(name);
    },
  };

  // -------------------------------------------------------------------------
  // Save/load support surface the SavesController reads and writes through.
  //
  // The controller lives in `./saves-controller.ts` (it may import the save
  // module and the Turn Pipeline's stores); the facade exposes just enough of
  // its live stores for the controller to compose a save and swap in a loaded
  // game, without the facade itself importing the save module. Each accessor is
  // a view onto the facade's own stores; none exposes a view-unsafe value a
  // normal client could reach (they are not on `EngineApi`).
  // -------------------------------------------------------------------------

  /**
   * The Content Manifest of the packs this build loaded, read off the resolver
   * context's Content Set. The controller compares a save's own manifest against
   * this to decide `manifestMatches` and to refuse a mismatched load (Req 13.2,
   * 13.5).
   */
  get loadedManifest(): ContentManifest {
    return this.deps.ctx.content.manifest as unknown as ContentManifest;
  }

  /**
   * The loaded Content Set, for the controller to rebuild the loaded Truth Store
   * (`TruthStore.from(content.predicates.evaluators, data)`) and build the loaded
   * game's hints store over. Content, not truth.
   */
  get contentForLoad(): ResolverContext['content'] {
    return this.deps.ctx.content;
  }

  /**
   * The concrete Truth Store the controller snapshots on save. `deps.truth` is
   * the Session's store; the resolver context threads the same instance, so fall
   * back to it when `deps.truth` is absent. The store is handed to the
   * controller only to call `snapshot()` — it is never projected to a view.
   */
  get truthStoreForSave(): TruthStore | undefined {
    return this.deps.truth ?? (this.deps.ctx.truth as unknown as TruthStore | undefined);
  }

  /** The live Case File, for the controller to snapshot into a save. */
  get caseFileStore(): CaseFile {
    return this.deps.caseFile;
  }

  /** The live world state, for the controller to snapshot into a save. */
  get worldState(): WorldState {
    return this.deps.state;
  }

  /**
   * Swap the whole live game to a loaded game the controller rebuilt (the
   * success path of `saves.load`; Req 13.3). Rebuilds the arrest-evidence seeds
   * from the loaded world and content exactly as `newGame` does, swaps the whole
   * `deps` in one assignment so no store from the old game survives, and returns
   * the loaded game's opening {@link GameView}. The pipeline/dialogue stores
   * (action log, extraction queue, counters, Flavour cache) are reset by the
   * controller around this call, so the facade and the pipeline swap the whole
   * Session together.
   */
  applyLoaded(game: LoadedGame): GameView {
    const { world, truth, caseFile, journal, notifications, hints } = game;

    const brief = buildBriefView(world);
    const rules = implicationRules(
      this.deps.ctx.content.predicates.predicates.map(
        (p) => [p.id, p.definition.implication] as const,
      ),
    );

    this.deps = {
      ...this.deps,
      state: world,
      caseFile,
      journal,
      ctx: { ...this.deps.ctx, truth },
      brief,
      rules,
      hints,
      notifications,
      truth,
    };
    this.journalStore = journal;
    this.hintStore = hints;
    this.notificationStore = notifications;

    const briefCableId = briefCableDocId(world);
    const briefView =
      briefCableId === undefined ? undefined : documentView(world, briefCableId);
    return {
      status: this.status(),
      seed: world.meta.seed,
      preset: (world.meta.preset as unknown as { id: string }).id,
      brief: briefView ?? EMPTY_DOCUMENT_VIEW,
    };
  }
}

/** The player's current Budget: the Station ledger balance. */
function balanceOf(state: WorldState): number {
  return balance(state.station.ledger);
}

/**
 * Build the {@link BriefView} the arrest-evidence count seeds its hostile marks
 * from (slice-integration task 9.1; design, "Facade: `newGame`", step 3).
 *
 * The Starting Brief designates the opposition — the Hostile Service and the
 * Cell — as hostile, so their org ids are the view's `hostileOrgs`. From that
 * seed the arrest-evidence fixpoint (`hostileMarks`) grows hostile persons,
 * materiel and channels off the Case File's corroborated Claims, so the view
 * needs no further seed: `hostileChannels` and `materiel` start empty and are
 * derived as the player corroborates leads. Every org is a view-safe record
 * carrying its `kind` (`station` | `hostile` | `cell`), so this reads no truth.
 */
function buildBriefView(state: WorldState): BriefView {
  const hostileOrgs = Object.values(state.orgs)
    .filter((org) => org.kind === 'hostile' || org.kind === 'cell')
    .map((org) => org.id);
  return { hostileOrgs, hostileChannels: [], materiel: [] };
}

/**
 * The brief Cable's {@link DocId}, if the generated world opens on one. A newly
 * generated world holds exactly one Cable Document — the Starting Brief — so the
 * first Document of kind `cable` is it. Returns `undefined` only if a pack ever
 * ships a world with no brief Cable, which keeps `newGame` total.
 */
function briefCableDocId(state: WorldState): DocId | undefined {
  const cable = Object.values(state.documents).find((d) => d.kind === 'cable');
  return cable?.id;
}

/**
 * The Propositions the brief Cable asserts — the Starting Brief's leads —
 * resolved from the world's `documentPropositions` map (the same source the
 * `read` action files as Case File Claims). Reads only view-safe state: a
 * Document's asserted PropIds and the Propositions behind them, which are the
 * player-facing leads, true or HQ-mistaken alike, never a Truth Store value.
 */
function briefCablePropositions(
  state: WorldState,
  id: DocId,
): readonly Proposition[] {
  const doc = state.documents[id];
  if (doc === undefined) {
    return [];
  }
  const props: Proposition[] = [];
  for (const propId of doc.asserts) {
    const prop = state.documentPropositions[propId];
    if (prop !== undefined) {
      props.push(prop);
    }
  }
  return props;
}

/**
 * The fallback {@link DocumentView} for the rare world that ships no brief
 * Cable, so `newGame` can return a {@link GameView} without a brief rather than
 * throwing. A generated world always opens on a brief Cable, so this is a
 * totality guard, not a path the core pack reaches.
 */
const EMPTY_DOCUMENT_VIEW: DocumentView = {
  id: 'doc:none' as DocId,
  kind: 'cable',
  title: '(no brief)',
  date: { day: 1, phase: 0 },
  dateLabel: 'Day 1',
  body: '',
  read: false,
};
