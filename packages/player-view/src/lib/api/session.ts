/**
 * The Player-View {@link Session} (design, "Player View: Session
 * (`player-view/api/session.ts`)"; Requirements 12.3, 13.4, 13.5).
 *
 * A Session is the mutable holder of **one game's live state**: the one thing
 * the {@link PlayerViewEngine} facade and the Turn Pipeline both read through.
 * Today those pieces are split — the facade holds the state and most stores on
 * its `PlayerViewEngineDeps`, while the Turn Pipeline driver privately owns the
 * action log and extraction queue — so there is no single value a `newGame` or
 * a `saves.load` can swap to replace the whole game at once. The Session is the
 * design's named consolidation of that live state.
 *
 * `PlayerViewEngine` holds exactly one Session reference. Every view, Case File
 * operation and turn reads through it. `newGame` and `saves.load` build a
 * *complete new Session* and swap the reference in one assignment, so no store
 * from the old game survives (Requirement 12.3) and a failed load leaves the old
 * Session untouched (Requirements 13.4, 13.5). The Turn Pipeline reads its
 * stores from the Session rather than holding its own, which fixes today's split
 * where the driver owns the action log and queue privately.
 *
 * ## Scope (task 7.1)
 *
 * This task *adds* `session.ts` and makes it compile and be unit-tested. It does
 * not rewire the facade or the pipeline onto the Session — that is task 8.1,
 * which rewires `engine-api.ts` and `turn-pipeline.ts` to sit on the Session
 * without churn. So the Session here exposes exactly the pieces the facade's
 * `PlayerViewEngineDeps` already carries, in the design's field names, so 8.1
 * is a mechanical lift rather than a reshape.
 *
 * ## Truth isolation (Requirement 2.2; Property 3)
 *
 * The Session *holds* the Truth Store — the Turn Pipeline's `TruthDraft` stages
 * over it, and the end-of-game debrief reads it (the one place the Player View
 * legitimately reveals ground truth). But it is never exposed through a
 * view-safe projection: the Session has no method that reads a {@link Truth}
 * value and hands it to a view. It is a field a caller reaches for deliberately
 * (the pipeline, the debrief), not something a view projects. That — together
 * with the `tui-imports-only-player-view` dependency rule and the view
 * projections never touching it — is what keeps the client truth-safe.
 */

import type {
  AdvanceWorldDeps,
  ResolverContext,
  TruthStore,
  WorldState,
} from '@tradecraft/engine';
import type { CityData } from '@tradecraft/content';

import type { CaseFile } from '../casefile/casefile.js';
import type { BriefView, ImplicationRules } from '../casefile/evidence.js';
import type { HintStore } from '../aids/hints.js';
import type { RecordedFeed } from '../debrief/debrief.js';
import type { Journal } from '../journal/journal.js';
import type { NotificationStore } from '../notify/store.js';
import type { FlavourCacheSnapshotData } from '../save/save.js';
import type { ActionLog, ExtractionQueue } from './turn-pipeline.js';

/**
 * A dialogue turn whose pre-commit step failed and is awaiting a `retry()`
 * (design `Session.paused`). The Turn Pipeline retains the pre-turn state and
 * the original intent so a later `retry()` replays them, reproducing the same
 * Intent and PRNG draws (Requirements 16.4, 42.4).
 *
 * The pipeline's own paused-turn type is private to `turn-pipeline.ts`; this is
 * the structurally identical shape the Session carries so the pipeline (task
 * 8.1) can store and read its paused turn through the Session. An action turn's
 * failure (post-commit Narrator only) never pauses, so only a say/endScene
 * intent is ever retained.
 */
export interface PausedTurn {
  /** The pre-turn state the retried turn re-runs from. */
  readonly pre: WorldState;
  /** The intent to replay: a dialogue line or a scene close. */
  readonly intent:
    | { readonly kind: 'say'; readonly line: string }
    | { readonly kind: 'endScene' };
}

/**
 * The resolver dependencies a turn needs that are fixed for the whole game: the
 * loaded content and city data, the Starting-Brief view and implication rules
 * the arrest-evidence count reads, the cipher keys, and the engine's
 * {@link AdvanceWorldDeps} (`buildWorldHooks()`, the Objective Evaluator and the
 * cipher keys). These do not change turn to turn, so the Session holds them once
 * and the Turn Pipeline reads them from the Session rather than re-plumbing them
 * every turn.
 *
 * `AdvanceWorldDeps` is optional: the projection surface this task owns does not
 * need it, and a caller that constructs a Session before the pipeline is wired
 * (as the projection tests do) can omit it. Task 8.1 supplies it when it rewires
 * the pipeline.
 */
export interface SessionResolverDeps {
  /** The resolver context (`content` plus, for truth-writing actions, the Truth Store). */
  readonly ctx: ResolverContext;
  /** The loaded city data, for the weather/crowd draws the scene/here views need. */
  readonly cityData: CityData;
  /** The Starting-Brief view the arrest-evidence count seeds its marks from. */
  readonly brief: BriefView;
  /** The predicate implication rules the arrest-evidence count applies. */
  readonly rules: ImplicationRules;
  /** The clock-advance dependencies the Turn Pipeline threads into `advanceWorld` (task 8.1). */
  readonly advance?: AdvanceWorldDeps;
}

/**
 * The live stores and view state of one game, as the design's Session names
 * them. All mutable: a turn appends to the stores and the Session swaps `state`
 * on commit. A fresh game or a load builds one of these whole.
 */
export interface SessionState {
  /** The committed world state. Swapped by {@link Session.commit}. */
  state: WorldState;
  /**
   * The ground-truth Truth Store. Held, never projected: the Turn Pipeline's
   * `TruthDraft` stages over it and the debrief reads it, but no view-safe
   * accessor exposes it (truth isolation; Property 3).
   */
  readonly truth: TruthStore;
  /** The player's Case File. */
  readonly caseFile: CaseFile;
  /** The player's Journal (the append-only fact log and notes). */
  readonly journal: Journal;
  /** The view-side Notification store. */
  readonly notifications: NotificationStore;
  /** The view-side hints store (content hints and their seen flags). */
  readonly hints: HintStore;
  /** The Turn Pipeline's ordered action log. */
  readonly actionLog: ActionLog;
  /** The Turn Pipeline's extraction queue. */
  readonly extractionQueue: ExtractionQueue;
  /** The Location Flavour cache's plain snapshot (view state, persisted on a save). */
  flavourCache: FlavourCacheSnapshotData;
  /** The monotonic turn counter behind the `turnId`s; advanced on each commit. */
  turnCounter: number;
  /** A dialogue turn awaiting a `retry()`, if any. */
  paused?: PausedTurn;
  /** The Starting-Brief view the Case File was seeded from. */
  readonly brief: BriefView;
  /** Whether the game's Outcome Record has been written (saved, so loading never re-writes). */
  outcomeWritten: boolean;
}

/**
 * Everything needed to build a {@link Session}: the live {@link SessionState}
 * stores and the fixed {@link SessionResolverDeps}, plus the Truth Store (for
 * the debrief) and the recorded feeds the debrief re-classifies.
 */
export interface SessionInit extends SessionState, SessionResolverDeps {
  /**
   * The recorded feed deliveries, for the debrief's fed-Propositions section. A
   * game in which the player fed no one supplies none and the section is empty.
   */
  readonly feeds?: readonly RecordedFeed[];
}

/**
 * The mutable holder of one game's live state (design `Session`).
 *
 * Construct one with {@link SessionInit}; the facade and the Turn Pipeline both
 * read through the same instance. `commit(next)` swaps the committed state and
 * advances the per-commit view state (the turn counter), which is all a commit
 * needs to do to the Session itself — the stores it holds are appended to in
 * place by the pipeline's own commit step.
 */
export class Session {
  /** The committed world state (swapped on {@link commit}). */
  state: WorldState;
  /** The ground-truth Truth Store. Held, never projected (Property 3). */
  readonly truth: TruthStore;
  /** The player's Case File. */
  readonly caseFile: CaseFile;
  /** The player's Journal. */
  readonly journal: Journal;
  /** The view-side Notification store. */
  readonly notifications: NotificationStore;
  /** The view-side hints store. */
  readonly hints: HintStore;
  /** The Turn Pipeline's ordered action log. */
  readonly actionLog: ActionLog;
  /** The Turn Pipeline's extraction queue. */
  readonly extractionQueue: ExtractionQueue;
  /** The Location Flavour cache's plain snapshot. */
  flavourCache: FlavourCacheSnapshotData;
  /** The monotonic turn counter; advanced on each {@link commit}. */
  turnCounter: number;
  /** A dialogue turn awaiting a `retry()`, if any. */
  paused?: PausedTurn;
  /** The Starting-Brief view. */
  readonly brief: BriefView;
  /** Whether the Outcome Record has been written. */
  outcomeWritten: boolean;

  /** The resolver context (`content` and, optionally, the Truth Store). */
  readonly ctx: ResolverContext;
  /** The loaded city data. */
  readonly cityData: CityData;
  /** The predicate implication rules the arrest-evidence count applies. */
  readonly rules: ImplicationRules;
  /** The clock-advance dependencies the Turn Pipeline threads into `advanceWorld`. */
  readonly advance?: AdvanceWorldDeps;
  /** The recorded feed deliveries, for the debrief. */
  readonly feeds: readonly RecordedFeed[];

  constructor(init: SessionInit) {
    this.state = init.state;
    this.truth = init.truth;
    this.caseFile = init.caseFile;
    this.journal = init.journal;
    this.notifications = init.notifications;
    this.hints = init.hints;
    this.actionLog = init.actionLog;
    this.extractionQueue = init.extractionQueue;
    this.flavourCache = init.flavourCache;
    this.turnCounter = init.turnCounter;
    this.paused = init.paused;
    this.brief = init.brief;
    this.outcomeWritten = init.outcomeWritten;

    this.ctx = init.ctx;
    this.cityData = init.cityData;
    this.rules = init.rules;
    this.advance = init.advance;
    this.feeds = init.feeds ?? [];
  }

  /**
   * Replace the committed state after a turn commits (design step 8:
   * `session.state = draft`). World State is immutable, so a commit is a
   * reference swap. The per-commit view state advances with it: the turn counter
   * ticks, so the next turn's `turnId` sorts after this one. The pre-commit
   * state object is left untouched — a commit swaps the reference, it does not
   * mutate the old value.
   */
  commit(next: WorldState): void {
    this.state = next;
    this.turnCounter += 1;
  }
}
