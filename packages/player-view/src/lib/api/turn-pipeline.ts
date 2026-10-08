/**
 * The Turn Pipeline (`player-view/turn`, task 16.8; design, "Turn Pipeline";
 * Requirements 7.1, 15.5, 16.1, 16.4, 16.5, 17.5, 42.1–42.6).
 *
 * This is the concrete {@link TurnDriver} the facade's `turnDriver` seam
 * (`./engine-api.ts`) fills. The facade owns the shape of a turn (the four turn
 * methods and the `TurnChunk`/`TurnStream` vocabulary); this module owns the
 * *behaviour*: it runs each `act`, `say`, `endScene` and `retry` as one Turn
 * Transaction, in the exact order the design prescribes, and streams the result
 * back as {@link TurnChunk}s.
 *
 * ## The Turn Transaction order (design, "Turn Pipeline")
 *
 * World State is immutable, so a draft is a new value and a commit is a
 * reference swap. Each turn runs these steps:
 *
 *   1. **Begin.** Allocate a `turnId`. Apply any finished extraction results as
 *      their own commits (the turn boundary; design step 7). Then snapshot
 *      `pre = engine.state` and start `draft = pre`.
 *   2. **Classify** (dialogue only). The injected classifier labels the line
 *      with one {@link TurnIntent}-derived `Intent`.
 *   3. **Simulate.** For an action, `resolve` runs on the draft with the
 *      draft's PRNG and the clock advances over the quoted phases, emitting the
 *      turn's {@link SimEvent}s. For a dialogue line, `applyDialogueTurn` runs
 *      on the draft *before* the reply streams: it applies the classified Intent
 *      to the scene NPC's Relationship, resolves a pitch on the draft's PRNG
 *      (debiting a money offer, recording a reported pitch), mints the Asset on
 *      acceptance, and appends the player's line to the scene's recent turns
 *      (Req 15.5–15.8).
 *   4. **Stream** (dialogue only). The NPC reply streams through the guards; a
 *      deflection fallback counts as completion. The reply is then appended to
 *      the scene's recent turns, so the committed scene carries both lines.
 *   5. **Commit.** `engine.commit(draft)`, and in the same step append the
 *      action-log entries, record the Journal Fact Lines, and deliver the
 *      turn's events as Notifications. For an action the commit happens *before*
 *      the Fact Lines are shown and *before* the Narrator starts (Req 15.5,
 *      42.2).
 *   6. **Narrate** (action only, post-commit). Flavour streams through the
 *      guards; a Narrator failure leaves the commit intact (Req 42.6).
 *   7. **Extract** (the two-phase boundary; Req 17). A dialogue turn enqueues an
 *      extraction job and kicks off its PHASE 1 — the model-facing Claim
 *      Extractor run off the critical path, which never blocks the next player
 *      input (Req 17.1). At the next turn boundary (step 1) the pipeline runs
 *      PHASE 2 for each job whose result is ready, in `turnId` order, each as its
 *      OWN turn transaction: over a fresh `TruthDraft`, the pure
 *      `evaluateExtraction` stages the Claim-truth records and appends the
 *      speaker's Told List; the pipeline records the view-safe `npc` Claims into
 *      the Case File, writes the Told List back onto the committed WorldState,
 *      commits the draft and appends an `extraction-commit` entry — atomically
 *      (Req 17.2, 17.5). An unparsed result files a note instead (Req 17.3); an
 *      unreachable endpoint keeps the job queued without pausing (Req 17.6).
 *
 * **Failure before commit** (steps 2–4): the draft is discarded and the state,
 * PRNG, action log, Journal and Notifications stay at `pre`. An `interrupted`
 * chunk tells the UI to drop any Flavour it showed for the attempt, and an
 * unreachable endpoint yields a `paused` chunk (Req 16.1). The pre-turn state is
 * retained so `retry()` re-runs step 2 onward from `pre`, reproducing the same
 * Intent and PRNG draws (Req 16.4, 42.4).
 *
 * ## Model seams
 *
 * Every model-touching step is an *injected seam* on {@link TurnPipelineConfig}:
 * the dialogue classifier, the NPC-voice stream, the Narrator stream source, and
 * the extraction runner. Injecting them keeps the pipeline — and its atomicity,
 * ordering and logging guarantees — deterministic and testable without a live
 * model, exactly as the engine's `resolve`/`advance` and the dialogue guards are
 * already model-free behind their own seams. A config that omits a seam gets a
 * safe default: no classification, a persona deflection line for voice, no
 * Flavour for narration, and an extraction runner whose jobs never become ready
 * (so phase 2 never runs). The live wiring (which calls the LLM Gateway through
 * the dialogue package) supplies real seams, including the phase-1
 * {@link ExtractionRunner} over dialogue's `extractClaims` and the pure phase-2
 * {@link EvaluateExtraction} over dialogue's `evaluateExtraction`; this module
 * never imports the dialogue package or a Gateway (both would be undeclared
 * dependencies), so it mirrors the extraction shapes structurally and carries no
 * I/O of its own.
 *
 * The action log and the extraction queue are **pipeline-owned stores**, not
 * {@link WorldState} fields (the design keeps them on the `SaveSnapshot`, beside
 * the Journal and Notifications the facade already owns): see
 * {@link ActionLog} and {@link ExtractionQueue}.
 */

import {
  advanceWorld,
  appendRecentTurn,
  applyDialogueTurn,
  balance,
  buildOutcomeRecord,
  ambientTurn,
  buildWorldHooks,
  createPrng,
  isIntent,
  nextUnkId,
  resolve as resolveAction,
  TruthDraft,
  worldCipherKeyLookup,
  type Action,
  type ActionLogEntry,
  type ActionResult,
  type AdvanceWorldDeps,
  type ClaimTruthRecord,
  type EndCondition,
  type GameTime,
  type Intent,
  type NpcId,
  type OutcomeRecord,
  type PitchWeights,
  type Proposition,
  type PropId,
  type SimEvent,
  type TalkScene,
  type TalkSceneRequest,
  type TruthStore,
  type TurnId,
  type UnkId,
  type WorldState,
} from '@tradecraft/engine';

import type { CityData, ContentSet, PredicateRegistry } from '@tradecraft/content';

import { buildObjectiveEvaluator } from './objective-evaluator.js';
import { projectResolverContext } from './resolver-projection.js';
import { projectStationReportable } from './station-reportable.js';
import { recordObservationClaims } from './claim-recorder.js';
import { personLabel } from './views.js';
import { addNpcClaims } from '../casefile/npc-claims.js';
import { CaseFile } from '../casefile/casefile.js';
import { hintTriggers } from '../aids/hints.js';
import type { PlayerViewEngine, TurnIntent } from './engine-api.js';
import type { Notification, TurnChunk, TurnStream } from './types.js';

// ---------------------------------------------------------------------------
// The pipeline-owned stores: the action log and the extraction queue
// ---------------------------------------------------------------------------

/**
 * The ordered action log (Requirement 17.5; design `ActionLogEntry`). Replay
 * regenerates the world from the seed and applies these in `seq` order; this
 * store is where the Turn Pipeline records every player action, dialogue line,
 * model-call reference and `extraction-commit` position, in the order they
 * happened. It lives here (not on {@link WorldState}) because it is persisted on
 * the `SaveSnapshot`, like the Journal and Notifications the facade owns.
 */
/**
 * One {@link ActionLogEntry} without its `seq` field, as it is handed to
 * {@link ActionLog.append} before the log assigns the sequence number. This is
 * a *distributive* omit: it maps over each member of the discriminated union
 * individually, so each variant keeps its own per-kind fields (`action`,
 * `text`, `op`, the model-call fields, `forTurn`). A plain
 * `Omit<ActionLogEntry, 'seq'>` would collapse the union to only its shared base
 * keys and reject those per-kind fields as excess properties.
 */
type UnloggedEntry = ActionLogEntry extends infer E
  ? E extends ActionLogEntry
    ? Omit<E, 'seq'>
    : never
  : never;

/**
 * A plain, JSON-serialisable snapshot of an {@link ActionLog} for the save file
 * (task 21.1; design `SaveSnapshot.actionLog`). It carries the entries in `seq`
 * order and the next `seq` to assign, so {@link ActionLog.fromSnapshot} rebuilds
 * a log that continues the saved sequence — a replay driven from the saved log
 * keeps the same `seq`/turn order.
 */
export interface ActionLogSnapshot {
  /** Every recorded entry, in `seq` order. */
  readonly entries: readonly ActionLogEntry[];
  /** The next `seq` to assign after a load. */
  readonly nextSeq: number;
}

export class ActionLog {
  private readonly entries: ActionLogEntry[] = [];
  private nextSeq = 0;

  /** Append one entry, assigning it the next `seq`. Returns the stored entry. */
  append(entry: UnloggedEntry): ActionLogEntry {
    const stored = { ...entry, seq: this.nextSeq } as ActionLogEntry;
    this.nextSeq += 1;
    this.entries.push(stored);
    return stored;
  }

  /** Every entry in `seq` order (a fresh snapshot). */
  all(): ActionLogEntry[] {
    return [...this.entries];
  }

  /** The number of entries recorded. */
  get length(): number {
    return this.entries.length;
  }

  /**
   * A plain, JSON-serialisable snapshot for the save file (task 21.1): the
   * entries in `seq` order and the next `seq` to assign. A fresh array, so the
   * save does not alias the live log.
   */
  snapshot(): ActionLogSnapshot {
    return { entries: this.entries.map((e) => ({ ...e }) as ActionLogEntry), nextSeq: this.nextSeq };
  }

  /**
   * Rebuild an {@link ActionLog} from an {@link ActionLogSnapshot} read from a
   * save (task 21.1). The entries are defensively copied and the `seq` counter
   * restored, so a later append continues the saved sequence.
   */
  static fromSnapshot(snapshot: ActionLogSnapshot): ActionLog {
    const log = new ActionLog();
    for (const entry of snapshot.entries) {
      log.entries.push({ ...entry } as ActionLogEntry);
    }
    log.nextSeq = snapshot.nextSeq;
    return log;
  }
}

// ---------------------------------------------------------------------------
// Extraction shapes, mirrored structurally (NO @tradecraft/dialogue import)
// ---------------------------------------------------------------------------
//
// The two-phase extraction boundary (slice-integration task 8.3; design, "Turn
// Pipeline" step 7 and "Claim Extractor") splits extraction cleanly:
//
//   PHASE 1 — run the Claim Extractor off the turn's critical path (the model
//     call, `extractClaims`), producing a parsed `ExtractionResult` or an
//     `UnparsedNote`. This is an *injected seam* ({@link ExtractionRunner}); the
//     live wiring (tasks 11.x/14.x/12.5) supplies the dialogue-backed one.
//
//   PHASE 2 — commit the parsed result at the next turn boundary AS ITS OWN
//     turn transaction: over a fresh {@link TruthDraft}, run the pure
//     `evaluateExtraction` to write the Claim-truth records and append the
//     speaker's Told List, record the view-safe Claims into the Case File
//     (sourced `npc` to the speaker), append an `extraction-commit` action-log
//     entry, and commit the draft. The pipeline performs phase 2 itself (step 1
//     of a later turn).
//
// ## Why these shapes are declared here and not imported
//
// `evaluateExtraction`, `ExtractionResult`, `ExtractionOutcome`,
// `ExtractedCaseClaim`, `SpeakerKnowledge` and `UnparsedNote` all live in
// `@tradecraft/dialogue`. The Player View does **not** declare
// `@tradecraft/dialogue` as a dependency (see `player-view/package.json`), and
// the `@nx/dependency-checks` lint rule rejects an undeclared import — value or
// *type-only*. So the pipeline cannot import these from dialogue. Instead it
// mirrors the minimal shapes it needs **structurally** (exactly as the design's
// task-11.1 note has dialogue re-declare player-view's seam types structurally,
// to keep the packages decoupled). The structural members here match the
// dialogue definitions one-for-one, built from the shared `@tradecraft/engine`
// (`Proposition`, `PropId`, `UnkId`, `ClaimTruthRecord`) and
// `@tradecraft/content` (`PredicateRegistry`) vocabulary both packages already
// import. The *implementation* of `evaluateExtraction` (and the model call) is
// injected on {@link TurnPipelineConfig}; the live wiring binds dialogue's real
// functions, which are structurally compatible with these shapes. No forbidden
// dependency is introduced and no cycle is created.

/**
 * One extracted Claim as the model returns it, before the Sim evaluates it
 * (structural mirror of dialogue's `ExtractedClaim`). The pipeline never reads
 * its fields; it only passes a parsed {@link ExtractionResult} straight into the
 * injected {@link EvaluateExtraction} seam.
 */
export interface ExtractedClaimShape {
  readonly predicate: string;
  readonly subject: string;
  readonly object: string | { readonly kind: string; readonly value: unknown };
  readonly place?: string;
  readonly when?: { readonly from: unknown; readonly to?: unknown };
  readonly hedged: boolean;
}

/** A parsed extraction reply: a bounded list of Claims (mirror of dialogue's `ExtractionResult`). */
export interface ExtractionResult {
  readonly claims: readonly ExtractedClaimShape[];
}

/**
 * The speaker's knowledge at the turn (structural mirror of dialogue's
 * `SpeakerKnowledge`): the Propositions the speaker holds as true, the ones they
 * sincerely but falsely believe, and the ids of Propositions their Agenda
 * promotes. The job captures this at the dialogue turn so a Claim is judged
 * against what the speaker knew *then* (Req 17.2).
 */
export interface SpeakerKnowledge {
  readonly known: readonly Proposition[];
  readonly falseBeliefs: readonly Proposition[];
  readonly promote: readonly PropId[];
}

/**
 * A view-safe Claim the extractor produces for the Case File (structural mirror
 * of dialogue's `ExtractedCaseClaim`): the canonical Proposition, who said it,
 * when, and whether the NPC hedged — but none of the ground-truth verdict
 * (`held`/`believed`/`lie`), which stays in the Truth Store's
 * {@link ClaimTruthRecord}.
 */
export interface ExtractedCaseClaim {
  readonly id: PropId;
  readonly prop: Proposition;
  readonly speaker: NpcId;
  readonly observedAt: GameTime;
  readonly hedged: boolean;
}

/** A logged chance leak: a true Claim the speaker did not know (Req 17.4). */
export interface ChanceLeak {
  readonly claimId: PropId;
  readonly prop: Proposition;
}

/** A logged consistency violation: a Claim against the Told List (Req 17.5). */
export interface ConsistencyViolation {
  readonly claimId: PropId;
  readonly prop: Proposition;
  readonly contradicts: PropId;
}

/**
 * The result of evaluating one parsed extraction result (structural mirror of
 * dialogue's `ExtractionOutcome`): the truth records, the view-safe Claims, the
 * updated Told List, and the chance-leak / consistency-violation logs.
 */
export interface ExtractionOutcome {
  readonly truthRecords: readonly ClaimTruthRecord[];
  readonly claims: readonly ExtractedCaseClaim[];
  readonly toldList: readonly Proposition[];
  readonly chanceLeaks: readonly ChanceLeak[];
  readonly consistencyViolations: readonly ConsistencyViolation[];
}

/**
 * Everything the pure phase-2 evaluator needs beyond the parsed result
 * (structural mirror of dialogue's `EvaluateExtractionInputs`). The pipeline
 * builds this at the boundary and passes `truth: TruthDraft` so the Claim-truth
 * records stage on the turn's draft and commit atomically with it.
 */
export interface EvaluateExtractionInputs {
  readonly result: ExtractionResult;
  readonly speaker: NpcId;
  readonly at: GameTime;
  readonly knowledge: SpeakerKnowledge;
  readonly toldList: readonly Proposition[];
  readonly coverIntact?: boolean;
  /** The Truth Store (the turn's {@link TruthDraft}) `holds` and the record transaction run against. */
  readonly truth: TruthStore;
  readonly predicates: PredicateRegistry;
  readonly claimId?: (index: number) => PropId;
  readonly allocateUnk?: (index: number) => UnkId;
}

/**
 * The pure phase-2 evaluator seam (structural mirror of dialogue's
 * `evaluateExtraction`). Injected on {@link TurnPipelineConfig} so the pipeline
 * stays free of a dialogue import; the live wiring binds dialogue's real
 * `evaluateExtraction`. Given the parsed result and the turn's draft Truth
 * Store, it stages the Claim-truth records (step 4 of the Claim Extractor),
 * returns the view-safe Claims, the appended Told List and the leak/violation
 * logs.
 */
export type EvaluateExtraction = (inputs: EvaluateExtractionInputs) => ExtractionOutcome;

/**
 * An unparsed extraction result (structural mirror of dialogue's
 * `UnparsedNote`): the model's reply failed schema validation after the retry,
 * so the Sim could not type the utterance. It carries no Propositions and never
 * reaches the Truth Store; the pipeline files it as a note (Req 17.3).
 */
export interface UnparsedNote {
  readonly speaker: NpcId;
  readonly at: GameTime;
  readonly excerpt: string;
}

/**
 * One queued extraction job and the state the phase-2 commit needs (design's
 * job: `{ turnId, speaker, utterance, speakerKnowledgeAtTurn, toldList,
 * coverIntact, at }`). The queue holds jobs in `turnId` order and the pipeline
 * drains any job whose phase-1 result is *ready* at the next turn boundary
 * (step 1), so a result for turn *n+1* waits for turn *n*.
 *
 * The speaker's knowledge and Told List are captured on the enqueue in `runSay`
 * (phase-1 input), so the Claim is judged against what the speaker knew at the
 * dialogue turn, not the later boundary state (Req 17.2).
 */
export interface QueuedExtraction {
  /** The turn this job belongs to; results commit in this order. */
  readonly turnId: TurnId;
  /** The NPC who spoke. */
  readonly speaker: NpcId;
  /** The NPC's utterance, as released by the guards. */
  readonly utterance: string;
  /** The game time the dialogue turn was made at. */
  readonly at: GameTime;
  /** The speaker's knowledge captured at the dialogue turn (Req 17.2). */
  readonly speakerKnowledgeAtTurn: SpeakerKnowledge;
  /** The speaker's Told List captured at the dialogue turn (Req 17.2). */
  readonly toldList: readonly Proposition[];
  /** Whether the NPC's cover was intact at the dialogue turn (Req 17.5). */
  readonly coverIntact: boolean;
}

/**
 * What phase 1's {@link ExtractionRunner.ready} reports for a queued job:
 *
 * - `{ kind: 'parsed'; result }` — the model's reply parsed; the pipeline runs
 *   phase 2 (`evaluateExtraction`) over the job's draft and commits (Req 17.2).
 * - `{ kind: 'unparsed'; excerpt }` — the reply failed schema validation after
 *   the retry; the pipeline files an unparsed note and commits no Truth
 *   (Req 17.3).
 * - `'pending'` — the model call has not finished; the job stays queued.
 * - `'unreachable'` — the extraction endpoint is unreachable; the job stays
 *   queued and the pipeline adds one status-bar notice, without pausing the
 *   game (Req 17.6).
 */
export type ExtractionReady =
  | { readonly kind: 'parsed'; readonly result: ExtractionResult }
  | { readonly kind: 'unparsed'; readonly excerpt: string }
  | 'pending'
  | 'unreachable';

/**
 * The two-phase extraction runner seam (design, "Extraction boundary"). It owns
 * phase 1 only — the model-facing Claim Extractor run off the critical path:
 *
 * - `start(job)` kicks off the `bookkeeping` call for a freshly enqueued job.
 * - `ready(job)` reports whether that job's phase-1 result is ready, and if so
 *   whether it parsed or is an unparsed note (or is still pending / the endpoint
 *   is unreachable).
 *
 * Phase 2 — the pure commit over a {@link TruthDraft} — is performed by the
 * *pipeline itself* with the injected {@link EvaluateExtraction} seam, not by
 * the runner, so the Truth records stage on and commit atomically with the
 * turn's draft (Req 17.2). The runner never touches the Case File or the Truth
 * Store directly, which is what lets the pipeline own the ordering and the
 * `extraction-commit` log position. The live wiring (task 11.3) builds this over
 * dialogue's `extractClaims`; omitting it (the common test / model-free case)
 * leaves every job queued forever.
 */
export interface ExtractionRunner {
  /** Kick off the phase-1 model call for a newly enqueued job. */
  start(job: QueuedExtraction): void;
  /** Report whether the job's phase-1 result is ready, and what it is. */
  ready(job: QueuedExtraction): ExtractionReady;
}

/**
 * Where the pipeline sends the chance leaks and consistency violations phase 2
 * finds (Req 17.4, 17.5): the design's `EvalLog` (metrics JSONL). Injected so
 * the pipeline carries no I/O; omitting it drops the signals. The live wiring
 * supplies the real log; the metrics are evaluation-only and never affect the
 * committed world.
 */
export interface EvalLog {
  /** Record a chance leak (a true Claim the speaker did not know; Req 17.4). */
  readonly chanceLeak: (leak: ChanceLeak, at: GameTime, speaker: NpcId) => void;
  /** Record a consistency violation (a Claim against the Told List; Req 17.5). */
  readonly consistencyViolation: (
    violation: ConsistencyViolation,
    at: GameTime,
    speaker: NpcId,
  ) => void;
}

/**
 * How the pipeline files an {@link UnparsedNote} (Req 17.3). The design files it
 * as a Case File note; the Case File has no note surface yet, so this is an
 * injected seam whose model-free default records the excerpt as a Journal note
 * through the engine. The live wiring (task 11.x/12.5) can supply the real Case
 * File note surface once it exists — a documented gap, not a behaviour change.
 */
export type UnparsedNoteSink = (engine: PlayerViewEngine, note: UnparsedNote) => void;

/**
 * The extraction-queue manager. The pipeline enqueues a job after a dialogue
 * turn commits (step 7) and, at the next turn boundary (step 1), drains every
 * job whose phase-1 result is *ready*, in `turnId` order, committing each as its
 * own transaction. A job whose result is not ready (pending or unreachable)
 * stays queued (the design's "endpoint unreachable keeps the job queued with a
 * status-bar notice; the game does not pause"), and a later turn's result waits
 * behind it.
 */
/**
 * A plain, JSON-serialisable snapshot of an {@link ExtractionQueue} for the save
 * file (task 21.1; design `SaveSnapshot.extractionQueue`): the queued jobs in
 * enqueue (turn) order. A load that resumes then drains them at the next turn
 * boundary exactly as the live game would (design step 7).
 */
export type ExtractionQueueSnapshot = readonly QueuedExtraction[];

export class ExtractionQueue {
  private readonly jobs: QueuedExtraction[] = [];

  /** Enqueue a job (after a dialogue turn commits). */
  enqueue(job: QueuedExtraction): void {
    this.jobs.push(job);
  }

  /** The queued jobs in enqueue order (a fresh snapshot). */
  pending(): QueuedExtraction[] {
    return [...this.jobs];
  }

  /** The number of jobs still queued. */
  get length(): number {
    return this.jobs.length;
  }

  /**
   * A plain, JSON-serialisable snapshot for the save file (task 21.1): the
   * queued jobs in enqueue order. A fresh array, so the save does not alias the
   * live queue.
   */
  snapshot(): ExtractionQueueSnapshot {
    return this.jobs.map((j) => ({ ...j }));
  }

  /**
   * Rebuild an {@link ExtractionQueue} from an {@link ExtractionQueueSnapshot}
   * read from a save (task 21.1). The jobs are defensively copied and kept in
   * enqueue order, so a resumed game drains them in the same `turnId` order.
   */
  static fromSnapshot(snapshot: ExtractionQueueSnapshot): ExtractionQueue {
    const queue = new ExtractionQueue();
    for (const job of snapshot) {
      queue.jobs.push({ ...job });
    }
    return queue;
  }

  /** The job at the head of the queue (the earliest-turn job), or `undefined`. */
  head(): QueuedExtraction | undefined {
    return this.jobs[0];
  }

  /** Remove and return the head job (committed at a boundary). */
  shift(): QueuedExtraction | undefined {
    return this.jobs.shift();
  }

  /**
   * Drain the queue at a turn boundary, committing each ready job in `turnId`
   * order with `commit`. For the head job the pipeline decides whether its
   * phase-1 result is ready and, if so, commits it (phase 2) through `commit`;
   * the moment the head is not ready — or its commit reports it should stay
   * queued — the drain stops, so results commit strictly in `turnId` order and a
   * turn *n+1* result never jumps ahead of turn *n* (design step 7).
   *
   * `commit` returns `true` when it consumed the head job (it committed, or
   * filed an unparsed note) and `false` when the head must stay queued (pending
   * or unreachable). The queue advances only on `true`.
   */
  drain(commit: (job: QueuedExtraction) => boolean): void {
    while (this.jobs.length > 0) {
      const consumed = commit(this.jobs[0]);
      if (!consumed) {
        break;
      }
      this.jobs.shift();
    }
  }
}

// ---------------------------------------------------------------------------
// Model seams
// ---------------------------------------------------------------------------

/**
 * A classified dialogue intent, as the pipeline uses it. This is the engine's
 * authoritative {@link Intent} enum: the dialogue turn now *applies* the Intent
 * to the scene NPC's Relationship through `applyDialogueTurn` (Req 15.5), so the
 * pipeline needs the real enum value, not an opaque string. The classify seam
 * (`./turn-pipeline.ts`'s `ClassifySeam`) may still return any string from a
 * model; the pipeline validates it with the engine's `isIntent` and falls back
 * to `ask` on an unknown label (design, dialogue turn step 2).
 */
export type ClassifiedIntent = Intent;

/**
 * Classify a player's dialogue line (step 2). The seam returns a label the
 * pipeline coerces to an {@link Intent} (an unknown label becomes `ask`). May
 * reject on a model failure, which pauses the turn as a voice rejection does.
 */
export type ClassifySeam = (line: string) => Promise<string>;

/**
 * Stream an NPC's reply through the guards (step 4). The seam is handed the
 * player's line, the classified {@link Intent} and the scene NPC's id and
 * player-facing name; it returns the released sentences and the speaker name to
 * tag `speech` chunks with. A clean stream and a persona-deflection fallback
 * both count as completion (design: "a deflection fallback counts as
 * completion"). May reject to signal an unreachable endpoint — which pauses the
 * turn (Req 16.1).
 */
export type VoiceSeam = (
  line: string,
  intent: Intent,
  scene: { readonly npc: NpcId; readonly speakerName: string },
) => Promise<{ readonly released: readonly string[]; readonly speaker: string }>;

/**
 * The Narrator seam for an action (step 6). Given the committed action's
 * {@link ActionResult} and the post-commit state, it returns the Flavour
 * sentences to show after the Fact Lines, already gated through the Leak and
 * Specifics guards. The live wiring composes the dialogue package's
 * `streamNarration` (Fact Lines first, then guard-gated Flavour, fact-only on a
 * guard trip or Narrator failure) inside this seam, so the pipeline keeps the
 * guard machinery and the Entity Registry out of its own surface and only owns
 * the *when*: the seam is called strictly after commit. A seam that rejects (a
 * Narrator failure or timeout) leaves the commit intact and the turn fact-only
 * (Req 16.5, 42.6). Omitting the seam means fact-only.
 */
export type NarrateSeam = (
  result: ActionResult,
  state: WorldState,
) => Promise<readonly string[]>;

/**
 * The Outcome Sink seam (design, "Turn Pipeline" step 9; Req 7.6). When a turn
 * commits a *new* End Condition — the game was not ended before this turn and
 * is ended after it — the pipeline derives the game's {@link OutcomeRecord} with
 * the engine's pure `buildOutcomeRecord` and writes it through this sink exactly
 * once per game. The sink is where the Outcome Record leaves the Player View:
 * the live wiring (the Composition Root's fs Outcome Sink, task 12.3) persists
 * it to `saves/outcomes/`; a test supplies a recording sink to observe the
 * write. The sink carries the only I/O of step 9, so the pipeline stays pure.
 *
 * The write is guarded by the Session's `outcomeWritten` flag (seeded on the
 * config and tracked across the game by the driver): the record is written at
 * most once, and because the flag is persisted on the save, loading an ended
 * game and continuing to call the API never writes a second record (design: "The
 * flag is saved, so loading an ended game never writes again").
 *
 * A sink that throws (an fs error) is handled by the pipeline per the design's
 * error table: the turn has already committed, so the end still stands and
 * streams, but `outcomeWritten` is left false so a later save-and-reload can
 * retry the write once. The pipeline swallows the error (surfacing it is a UI
 * concern the live wiring owns) and never rolls back the committed turn.
 */
export type OutcomeSink = (record: OutcomeRecord) => void;

/**
 * Capture the speaker's {@link SpeakerKnowledge} at a dialogue turn, for the
 * extraction job's phase-1 input (Req 17.2). Injected because the NPC's
 * Knowledge Slice / Agenda is **not projected onto the live {@link WorldState}**
 * — the runtime `Npc` carries persona, schedule and ground-truth traits, but not
 * the `known`/`falseBeliefs`/`promote` slice the Claim Extractor judges a Claim
 * against (those are a generation-time concept, `GeneratedKnowledge`). The live
 * wiring (which holds the generation knowledge, or an engine helper that
 * projects it) supplies the real seam; omitting it captures the empty slice, so
 * extraction still judges every Claim against the live Told List alone. This is
 * the one documented gap of task 8.3, left as a seam for the live wiring.
 */
export type SpeakerKnowledgeSeam = (
  state: WorldState,
  npc: NpcId,
) => SpeakerKnowledge;

/** The empty {@link SpeakerKnowledge} the default seam captures (the documented gap). */
const EMPTY_SPEAKER_KNOWLEDGE: SpeakerKnowledge = {
  known: [],
  falseBeliefs: [],
  promote: [],
};

/**
 * The configuration a concrete {@link TurnDriver} captures. Everything is
 * optional; a field left out gets a model-free default (see the module header).
 * The two stores default to fresh instances the driver owns, so a caller that
 * only wants the structural pipeline (the common test case) need pass nothing.
 */
export interface TurnPipelineConfig {
  /** The classifier seam (step 2). Omitted means dialogue lines are not classified. */
  readonly classify?: ClassifySeam;
  /** The NPC-voice seam (step 4). Omitted means an immediate persona deflection. */
  readonly voice?: VoiceSeam;
  /** The Narrator seam (step 6). Omitted means fact-only narration. */
  readonly narrate?: NarrateSeam;
  /**
   * The Outcome Sink (step 9; Req 7.6). When a turn commits a new End Condition,
   * the pipeline derives the game's {@link OutcomeRecord} and writes it here
   * exactly once per game. Omitted means the record is not written (the
   * projection/atomicity specs, which never end a game or do not observe the
   * record, pass nothing); the live wiring (task 12.3/12.5) supplies the fs sink.
   */
  readonly outcomes?: OutcomeSink;
  /**
   * The game's initial `outcomeWritten` flag (design, Session `outcomeWritten`;
   * Req 7.6). A fresh game starts `false`; a game rebuilt from a save that had
   * already written its Outcome Record is seeded `true`, so continuing to call
   * the API after a load writes no further record. Omitted defaults to `false`.
   * The driver tracks the live flag across the game from this seed.
   */
  readonly outcomeWritten?: boolean;
  /**
   * The two-phase extraction runner (phase 1; design, "Extraction boundary").
   * Omitted means jobs never become ready (they stay queued), which is the
   * model-free default the pipeline/atomicity specs rely on.
   */
  readonly extraction?: ExtractionRunner;
  /**
   * The pure phase-2 evaluator (the injected `evaluateExtraction`). Omitted
   * means a parsed result cannot be committed — the pipeline treats the job as
   * not ready and leaves it queued — so the default pipeline stays model-free
   * and never fabricates Truth writes. The live wiring binds dialogue's real
   * `evaluateExtraction`.
   */
  readonly evaluateExtraction?: EvaluateExtraction;
  /**
   * Capture the speaker's knowledge at a dialogue turn (Req 17.2). Omitted means
   * the empty slice is captured (the documented knowledge-slice projection gap).
   */
  readonly speakerKnowledge?: SpeakerKnowledgeSeam;
  /** Where chance leaks / consistency violations are sent (Req 17.4, 17.5). Omitted drops them. */
  readonly evalLog?: EvalLog;
  /** How an unparsed note is filed (Req 17.3). Omitted uses the Journal-note default. */
  readonly unparsedNote?: UnparsedNoteSink;
  /**
   * Add a status-bar notice when the extraction endpoint is unreachable
   * (Req 17.6). Called at most once per outage (the pipeline de-dupes while the
   * head job keeps reporting `unreachable`, and re-arms once extraction catches
   * up). Omitted means no notice — the status-bar surface is a UI concern the
   * live wiring/TUI owns; the game never pauses either way.
   */
  readonly unreachableNotice?: (job: QueuedExtraction) => void;
  /** The persona deflection line the default voice seam releases. */
  readonly deflectionLine?: string;
  /** The action log store (defaults to a fresh {@link ActionLog}). */
  readonly actionLog?: ActionLog;
  /** The extraction queue store (defaults to a fresh {@link ExtractionQueue}). */
  readonly extractionQueue?: ExtractionQueue;
  /**
   * The Document ids of the Starting-Brief Cable(s) whose Claims are the
   * player's leads (slice-integration task 8.4; design, "Hints"). The
   * `plot-deadline-near` hint fires on a brief lead whose stated deadline is
   * within one day, so the pipeline needs to know which Case File Claims are
   * leads. `newGame` (task 9.1) knows the brief Cable's `DocId` and supplies it;
   * omitting it simply never fires `plot-deadline-near`, leaving every other
   * hint trigger unaffected.
   */
  readonly briefLeadDocs?: ReadonlySet<string>;
}

/** The default line the voice seam deflects with when no model is wired. */
const DEFAULT_DEFLECTION_LINE = 'The contact says nothing of substance.';

// ---------------------------------------------------------------------------
// Paused-turn retention (for retry)
// ---------------------------------------------------------------------------

/**
 * A turn whose pre-commit step failed and is awaiting a `retry()`. The design's
 * `retry()` re-runs "from step 2 with `pre`", so the pre-turn state and the
 * original intent are retained verbatim; the pipeline replays them on retry,
 * reproducing the same Intent and PRNG draws (Req 16.4, 42.4). An action turn's
 * failure (post-commit Narrator only) never pauses, so only a dialogue intent is
 * ever retained here.
 */
interface PausedTurn {
  readonly pre: WorldState;
  readonly intent: Extract<TurnIntent, { kind: 'say' | 'endScene' }>;
}

/** Coerce a classifier's raw label to an {@link Intent}, defaulting to `ask`. */
function toIntent(label: string): Intent {
  return isIntent(label) ? label : 'ask';
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/**
 * Build a concrete Turn Pipeline {@link TurnDriver} from a {@link TurnPipelineConfig}.
 *
 * The returned driver is the function the facade's `turnDriver` seam holds: it
 * takes the {@link PlayerViewEngine} and a {@link TurnIntent} and returns the
 * {@link TurnStream} the TUI consumes. It closes over the config's seams and the
 * two stores, so the same action log and extraction queue persist across turns
 * (which is what lets a turn's extraction commit at the *next* turn's boundary).
 *
 * The driver is reusable across the whole session: construct it once with the
 * live seams and hand it to {@link PlayerViewEngineDeps.turnDriver}.
 */
export function createTurnDriver(
  config: TurnPipelineConfig = {},
): (engine: PlayerViewEngine, intent: TurnIntent) => TurnStream {
  const actionLog = config.actionLog ?? new ActionLog();
  const extractionQueue = config.extractionQueue ?? new ExtractionQueue();
  const deflectionLine = config.deflectionLine ?? DEFAULT_DEFLECTION_LINE;

  // The paused turn awaiting a retry, if any. Retained between calls so a later
  // `retry()` can replay it from its pre-turn state.
  let paused: PausedTurn | undefined;

  // Whether the current extraction outage has already raised its one status-bar
  // notice (Req 17.6). Set when the head job reports `unreachable`, cleared when
  // the queue drains past it, so a sustained outage notices once and a new
  // outage notices again.
  let extractionOutageNoticed = false;

  // A monotonic turn counter behind the `turnId`s, so ids sort in turn order.
  let nextTurn = 0;
  const allocTurnId = (): TurnId => `turn:${nextTurn++}`;

  // The game's live `outcomeWritten` flag (design step 9; Req 7.6). Seeded from
  // the config — `false` for a fresh game, `true` for a game rebuilt from a save
  // that had already written its Outcome Record — and set once the Outcome
  // Record is written. The driver persists for one game, so this flag is the
  // once-per-game guard: the write happens the first time a turn commits a new
  // End Condition and never again, and a loaded ended game (seeded `true`) never
  // re-writes.
  let outcomeWritten = config.outcomeWritten ?? false;

  /** Raise the one-per-outage unreachable notice (Req 17.6), de-duped. */
  const noteExtractionUnreachable = (
    _engine: PlayerViewEngine,
    job: QueuedExtraction,
  ): void => {
    if (extractionOutageNoticed) {
      return;
    }
    extractionOutageNoticed = true;
    config.unreachableNotice?.(job);
  };

  /**
   * Step 9's once-per-game Outcome Record write (design step 9; Req 7.6). Called
   * only when a turn commits a NEW End Condition. It:
   *
   *   - no-ops if the record was already written (`outcomeWritten`), so a game
   *     writes at most one record even if the ended branch is somehow reached
   *     again, and a loaded ended game (seeded `outcomeWritten: true`) never
   *     re-writes;
   *   - no-ops if there is no sink to write to (the model-free default) or no
   *     ground-truth store to derive the record from — nothing is written and
   *     the flag stays false, so wiring the sink later still writes the record;
   *   - otherwise derives the record with the engine's pure `buildOutcomeRecord`
   *     off the committed ended state and writes it through the sink, setting
   *     `outcomeWritten` so no further record is written.
   *
   * A sink that throws (an fs error) leaves `outcomeWritten` false — the turn has
   * already committed, so the end stands, but a later save-and-reload can retry
   * the write once (design error table). The error is swallowed here; surfacing
   * it as a status-bar notice is the live wiring's concern.
   */
  const writeOutcomeRecordOnce = (
    ended: WorldState,
    truth: TruthStore | undefined,
  ): void => {
    if (outcomeWritten) {
      return;
    }
    const sink = config.outcomes;
    if (sink === undefined || truth === undefined) {
      return;
    }
    const record = buildOutcomeRecord(ended, truth);
    try {
      sink(record);
    } catch {
      // The sink failed after commit: keep `outcomeWritten` false so a later
      // save-and-reload retries the write once (design error table). The
      // committed end is not rolled back.
      return;
    }
    outcomeWritten = true;
  };

  /**
   * Step 1's boundary — the **two-phase extraction commit** (design, "Extraction
   * boundary"; Req 17.2, 17.3, 17.5). For every queued job whose phase-1 result
   * is ready, in `turnId` order, commit it as its OWN turn transaction:
   *
   *   - a `parsed` result: open a fresh {@link TruthDraft} over the Session's
   *     Truth Store, run the pure phase-2 `evaluateExtraction` against the draft
   *     (so the Claim-truth records stage on and commit with the draft, keeping
   *     the write atomic; Req 17.2), record the view-safe `npc` Claims into the
   *     Case File, write the speaker's updated Told List back onto the committed
   *     WorldState, send chance leaks / consistency violations to the EvalLog
   *     (Req 17.4, 17.5), commit the TruthDraft, and append an
   *     `extraction-commit` log entry — all together or not at all;
   *   - an `unparsed` result: file a Case File note (no Truth write) and still
   *     append the `extraction-commit` position (Req 17.3);
   *   - `pending` / `unreachable`: leave the job queued (an `unreachable`
   *     endpoint adds one status-bar notice but never pauses the game; Req 17.6).
   *
   * The queue drains strictly in order and stops at the first job that is not
   * ready, so a turn *n+1* result never commits before turn *n* and replay
   * applies each commit at the same boundary (design step 7; Req 17.5).
   */
  const applyExtractionBoundary = (engine: PlayerViewEngine): void => {
    const runner = config.extraction;
    if (runner === undefined) {
      return;
    }
    extractionQueue.drain((job) => commitExtractionJob(engine, runner, job));
  };

  /**
   * Commit one ready extraction job as its own transaction (phase 2). Returns
   * `true` when the job was consumed (committed, or filed as an unparsed note)
   * and `false` when it must stay queued (pending or unreachable). A thrown
   * error leaves nothing committed and keeps the job queued, so the whole
   * phase-2 commit is atomic (Req 5.4, 17.1).
   */
  const commitExtractionJob = (
    engine: PlayerViewEngine,
    runner: ExtractionRunner,
    job: QueuedExtraction,
  ): boolean => {
    const ready = runner.ready(job);

    if (ready === 'pending') {
      return false;
    }
    if (ready === 'unreachable') {
      // The endpoint is unreachable: the job stays queued and the game does not
      // pause. Surface one status-bar notice for the outage (Req 17.6).
      noteExtractionUnreachable(engine, job);
      return false;
    }

    // The head job is ready: the outage (if any) is over, so re-arm the notice
    // for a future outage.
    extractionOutageNoticed = false;

    if (ready.kind === 'unparsed') {
      // An unparsed result: file a note, no Truth write, but still pin the
      // `extraction-commit` position so replay applies it here too (Req 17.3).
      fileUnparsedNote(engine, {
        speaker: job.speaker,
        at: job.at,
        excerpt: ready.excerpt,
      });
      actionLog.append({ kind: 'extraction-commit', turn: job.turnId, at: job.at, forTurn: job.turnId });
      return true;
    }

    // A parsed result: run phase 2 over a fresh draft and commit atomically.
    commitParsedExtraction(engine, job, ready.result);
    actionLog.append({ kind: 'extraction-commit', turn: job.turnId, at: job.at, forTurn: job.turnId });
    return true;
  };

  /**
   * Phase 2 for a parsed result: `evaluateExtraction` over a fresh
   * {@link TruthDraft}, then commit the draft, the view-safe Case File Claims
   * and the Told-List write-back as one transaction (Req 17.2). When no Truth
   * Store or no `evaluateExtraction` seam is wired (the model-free default),
   * there is nothing to evaluate — the record transaction and the Told-List
   * write both need the draft and the evaluator — so the commit is a no-op
   * beyond the `extraction-commit` log entry the caller appends.
   */
  const commitParsedExtraction = (
    engine: PlayerViewEngine,
    job: QueuedExtraction,
    result: ExtractionResult,
  ): void => {
    const { truth, caseFile, ctx } = engine.turnContext;
    const evaluate = config.evaluateExtraction;
    if (truth === undefined || evaluate === undefined) {
      return;
    }

    // A fresh draft for THIS extraction commit — its own transaction, separate
    // from any action/dialogue turn's draft (Req 17.2).
    const truthDraft = TruthDraft.over(truth);

    // Bind `allocateUnk` to the committed WorldState's Unidentified-Subject
    // table so a Claim naming an `'unknown'` party takes a stable `unk:` id that
    // does not collide with the player's allocated ones. The ids are allocated
    // sequentially within the turn from the current table high-water mark; they
    // name a genuinely unidentified party (there is no NPC to map), so no
    // identity mapping is recorded — the live wiring owns threading any new
    // `unk:` back onto the WorldState if a later identification needs it (a
    // documented seam).
    const base = Number.parseInt(
      nextUnkId(engine.state.player.unkIds).slice('unk:'.length),
      10,
    );
    const allocateUnk = (index: number): UnkId => `unk:${base + index}`;

    const outcome = evaluate({
      result,
      speaker: job.speaker,
      at: job.at,
      knowledge: job.speakerKnowledgeAtTurn,
      toldList: job.toldList,
      coverIntact: job.coverIntact,
      truth: truthDraft as unknown as TruthStore,
      predicates: ctx.content.predicates,
      allocateUnk,
    });

    // Record the view-safe Claims into the Case File, sourced `npc` to the
    // speaker (Req 17.2). `addNpcClaims` files one Claim per Proposition under
    // `{ kind: 'npc', npc: speaker }`.
    addNpcClaims(caseFile, {
      npc: job.speaker,
      propositions: outcome.claims.map((c) => c.prop),
      observedAt: job.at,
    });

    // Write the speaker's updated Told List back onto the committed WorldState
    // (Req 17.2). The extraction commit is its own `commit`.
    engine.commit(withToldList(engine.state, job.speaker, outcome.toldList));

    // Commit the staged Claim-truth records to the Truth Store (atomic with the
    // Case File / Told-List writes above).
    truthDraft.commit();

    // The evaluation signals go to the EvalLog for metrics (Req 17.4, 17.5);
    // they never affect the committed world.
    const evalLog = config.evalLog;
    if (evalLog !== undefined) {
      for (const leak of outcome.chanceLeaks) {
        evalLog.chanceLeak(leak, job.at, job.speaker);
      }
      for (const violation of outcome.consistencyViolations) {
        evalLog.consistencyViolation(violation, job.at, job.speaker);
      }
    }
  };

  /** File an unparsed note (Req 17.3): the injected sink, else the Journal-note default. */
  const fileUnparsedNote = (engine: PlayerViewEngine, note: UnparsedNote): void => {
    const sink = config.unparsedNote ?? defaultUnparsedNoteSink;
    sink(engine, note);
  };

  /**
   * Deliver a committed turn's events as Notifications and stream the resulting
   * `notification` chunks. The facade's `deliverEvents` runs the pure `notify`,
   * records each Notification's Fact Line to the Journal under the event's own
   * time, and pushes the Notifications onto the store (task 16.6); this yields a
   * `notification` chunk per delivered Notification, in event-time order.
   */
  const deliverChunks = (
    engine: PlayerViewEngine,
    events: readonly SimEvent[],
  ): TurnChunk[] => {
    const delivered: Notification[] = engine.deliverEvents(events);
    return delivered.map((n) => ({ kind: 'notification', n }) as const);
  };

  /**
   * Fire the view-side hint triggers from a committed turn's Player View facts
   * (slice-integration task 8.4; design, "Hints"; Req 19.10). The pure
   * {@link hintTriggers} reports every trigger whose situation now holds — read
   * from the committed state, the Case File, the turn's Fact Lines, the action
   * catalogue and (for `plot-deadline-near`) the brief lead Documents; it reads
   * no Truth Store. Each trigger is raised on the facade's {@link HintStore},
   * which returns the hint the FIRST time its trigger occurs and `undefined`
   * thereafter — so a persistent situation (a held Unidentified Subject, a low
   * Budget) shows its hint once. A fired hint becomes a `{ kind: 'hint'; text }`
   * chunk, in the triggers' fixed order. Omitting the `cover-suspicion-high`
   * input (no "you may have been made" Fact Line this turn) and the brief leads
   * leaves those triggers silent; nothing here touches Sim state (Req 26.6).
   */
  const streamHints = (
    engine: PlayerViewEngine,
    factLines: readonly string[],
    action?: Action,
  ): TurnChunk[] => {
    const triggers = hintTriggers({
      state: engine.state,
      caseFile: engine.turnContext.caseFile,
      factLines,
      actions: engine.actions(),
      ...(config.briefLeadDocs === undefined ? {} : { briefLeadDocs: config.briefLeadDocs }),
      ...(action === undefined ? {} : { action }),
    });
    const chunks: TurnChunk[] = [];
    for (const trigger of triggers) {
      const hint = engine.hints.fire(trigger);
      if (hint !== undefined) {
        chunks.push({ kind: 'hint', text: hint.text });
      }
    }
    return chunks;
  };

  // -------------------------------------------------------------------------
  // Action turn (steps 1, 3, 5, 6)
  // -------------------------------------------------------------------------

  async function* runAction(
    engine: PlayerViewEngine,
    action: Action,
    turnId: TurnId,
  ): AsyncGenerator<TurnChunk> {
    const { ctx, cityData, caseFile, brief, rules, truth, advance } =
      engine.turnContext;

    // Step 1: boundary — apply any finished extraction results first.
    applyExtractionBoundary(engine);

    // Step 2: the ended gate. A game that has already ended takes no further
    // action: reject with a disallowed `fact` chunk and `done`, without
    // simulating or committing anything (design step 2; Req 7.7).
    const pre = engine.state;
    if (pre.ended !== undefined) {
      yield { kind: 'fact', text: ENDED_GATE_LINE };
      yield { kind: 'done' };
      return;
    }

    // Step 3: open the turn's PRNG and Truth draft. `resolve` and the clock draw
    // only from the PRNG built from the draft's own state, so the same action
    // against the same state is reproducible. The Truth draft (`TruthDraft.over`)
    // stages every Truth Store write the turn makes — an `unk:` identity a
    // surveil allocates, a `turn-agent`'s flipped allegiance — behind the store's
    // read interface, so a staged write is visible to every later read in the
    // turn (read-your-writes) and nothing reaches the store until commit. With no
    // Truth Store wired (the projection/atomicity specs construct the facade
    // without one), the turn stages nothing and resolve runs against `ctx` as
    // before. (design step 3; Req 5.3, 5.4)
    const rng = createPrng(pre.rng);
    const truthDraft = truth !== undefined ? TruthDraft.over(truth) : undefined;

    // Step 4: build this turn's Resolver Context over the Truth draft, so the
    // truth-writing resolvers (surveil, turn-agent, …) see their own staged
    // writes and the arrest/confront gates read the live Case File. When no
    // Truth Store is wired, fall back to the facade's `ctx` as the pre-8.1
    // pipeline did. (design step 4; Req 5.3, 6.2)
    const turnCtx =
      truthDraft !== undefined
        ? projectResolverContext(
            { state: pre, caseFile, content: ctx.content, brief, rules },
            truthDraft,
          )
        : ctx;

    const q = engine.quote(action);

    // The draft, its events, the end and the opened scene the turn accumulates.
    // Everything below runs on `draft` and is only committed at the single
    // commit point (step 8); a throw before then discards the whole draft —
    // world, PRNG, log, Journal, Notifications and the Truth draft — leaving the
    // game at `pre` (Req 5.4).
    let draft: WorldState;
    let result: ActionResult;
    let events: readonly SimEvent[];
    let ended: EndCondition | undefined;
    let openScene: TalkSceneRequest | undefined;
    let phasesSpent = 0;
    let factLines: readonly string[] = [];

    try {
      // Step 5: resolve. `resolve` returns the next state, the result (its
      // Observations and Fact Lines) and the End Condition the action produced
      // (an arrest of the Cell leader, a materiel seizure). The result's
      // Proposition Observations are the Claims this turn will record at commit
      // (recorded there, so a pre-commit throw files none; design step 5).
      const resolved = resolveAction(pre, action, rng, turnCtx);
      result = resolved.result;
      ended = resolved.ended;

      // The state the resolver left, with its own End Condition written so the
      // clock's `detectEnd` sees it (idempotent) and the commit carries it.
      // `resolve` reports the end without writing it; a game keeps its first end,
      // which `resolve`'s precedes `advanceWorld`'s below.
      let next: WorldState = resolved.next;
      if (ended !== undefined && next.ended === undefined) {
        next = { ...next, ended };
      }

      // The action may itself open a scene (talk, approach): carry it as the
      // turn's opened scene unless the clock opens an earlier kept meeting.
      openScene = result.openScene;

      // Step 6: advance the clock over the quoted phases with `advanceWorld`,
      // which runs the Day-Boundary Hooks and the Phase Step on the draft, sets
      // the daily weather itself, and runs `detectEnd` before it returns (Req
      // 7.1). The Objective Evaluator the Phase Step's Directive check calls is
      // built over the draft and the live Case File (the action's Proposition
      // Observations never mint an `IS_ALIAS_OF` Claim, the only Case File input
      // the evaluator reads, so folding them in before the advance is a no-op for
      // an action turn; the dialogue/extraction path, tasks 8.2/8.3, is where
      // pending alias Claims matter). `advanceWorld` threads the runtime stream
      // (`rng`) back onto its result state, re-ids the events and reports
      // `phasesSpent`, `openScene` and `ended`. (design step 6)
      const phases = q.allowed ? q.phases : 0;
      const deps = advanceDepsFor(advance, ctx.content, cityData, next, caseFile, truthDraft);
      const advanced = advanceWorld(next, phases, rng, deps);

      draft = ambientTurn(advanced.state, action);
      factLines =
        advanced.lines === undefined
          ? result.factLines
          : [...result.factLines, ...advanced.lines];
      phasesSpent = advanced.phasesSpent;
      events = [...result.events, ...advanced.events];

      // Merge the two End Conditions: `resolve`'s takes precedence, else the
      // clock's. The first end stands. (design step 6; Req 7.1)
      ended = ended ?? advanced.ended ?? draft.ended;
      if (ended !== undefined && draft.ended === undefined) {
        draft = { ...draft, ended };
      }

      // The scene to open: a kept meeting the clock stopped at, else the action's
      // own opened scene (design step 7; Req 15.1).
      openScene = advanced.openScene ?? openScene;
    } catch (err) {
      // A hook or the Phase Step threw: discard the whole draft (the Truth draft
      // is dropped simply by never committing it), tell the UI the turn could not
      // be completed, and log the error. Nothing was committed, so the game stays
      // at `pre` (Req 5.4). The design streams a fixed line and `done`.
      yield { kind: 'fact', text: TURN_FAILED_LINE };
      yield { kind: 'done' };
      void err;
      return;
    }

    // Step 7: set `player.scene` from the opened scene, so the committed state
    // carries the open Talk Scene (Req 15.1). The action turn opens the scene as
    // a bare request; the dialogue turn (task 8.2) owns the conversation that
    // follows. A kept meeting's scene opens `via: 'meeting'`; the player's own
    // talk/approach opens `via: 'talk'`.
    if (openScene !== undefined && isNamedNpc(openScene.npc)) {
      draft = withOpenScene(draft, openScene.npc, action);
    }

    // Step 8: commit — the single atomic point. In one step: swap the Session
    // state, commit the Truth draft, record the action's Proposition
    // Observations as Case File Claims, project the Station mole-report input,
    // append the `action` log entry, record the Journal Fact Lines, and deliver
    // the events as Notifications. The commit happens BEFORE the Fact Lines are
    // shown and BEFORE the Narrator starts (Req 5.3, 15.5, 42.2). Recording the
    // Claims here (not before the advance) is what keeps the turn atomic: a
    // pre-commit throw files none.
    truthDraft?.commit();
    recordObservationClaims(caseFile, result.observations);
    // The Station mole-report projection (design step 8; Req 3.6): rebuild
    // `station.reportable` from the Station Knowledge Slice and the Case File
    // summary (and the targets the player's sent trace Cables name, already
    // covered by those two sources) now that this turn's Observation Claims are
    // filed, so the next day's Hostile tick relays what the Station holds as of
    // this turn. Done before the commit so the committed state carries it.
    draft = projectStationReportable(draft, caseFile);
    engine.commit(draft);
    // The `action` log entry: the engine's `ActionLogEntry` carries no
    // `phasesSpent` field yet, so the early-stop count the design records on the
    // entry awaits that engine widening; `phasesSpent` is still used to drive the
    // clock and is available here for that follow-on. (seam; design step 8)
    actionLog.append({ kind: 'action', turn: turnId, at: draft.time, action });
    void phasesSpent;
    engine.journal.recordAction(
      factLines === result.factLines ? result : { ...result, factLines },
      draft.time,
    );

    // The game may have ended this turn (a Plot abort, an arrest, a burn).
    // Surface it. The Fact Lines are already committed, then the ended chunk.
    //
    // Step 9 (design step 9; Req 7.6): when this turn commits a NEW End
    // Condition — the game was not ended before (`pre.ended === undefined`) and
    // is ended now (`draft.ended !== undefined`) — write the game's Outcome
    // Record through the sink exactly once. `writeOutcomeRecordOnce` derives the
    // record with the engine's pure `buildOutcomeRecord` off the committed ended
    // state and the Session's ground truth, writes it through the sink, and sets
    // the `outcomeWritten` flag — so a later turn (which the ended gate at step 2
    // rejects anyway) and a loaded ended game (seeded `outcomeWritten: true`)
    // never write again. The write runs after the commit, so a sink failure
    // leaves the committed end intact. (Property 42.)
    if (draft.ended !== undefined) {
      if (pre.ended === undefined) {
        writeOutcomeRecordOnce(draft, truth);
      }
      for (const line of factLines) {
        yield { kind: 'fact', text: line };
      }
      yield* deliverChunks(engine, events);
      for (const chunk of streamHints(engine, factLines, action)) {
        yield chunk;
      }
      yield { kind: 'ended', outcome: draft.ended.outcome };
      yield { kind: 'done' };
      return;
    }

    // Step 10: stream the committed turn. Fact Lines first, before any Narrator
    // call (Req 15.5); then the turn's Notifications; then the post-commit
    // Narrator Flavour.
    for (const line of factLines) {
      yield { kind: 'fact', text: line };
    }

    // Deliver the turn's Notifications (committed with the turn).
    yield* deliverChunks(engine, events);

    // Fire the hint triggers from this turn's Player View facts, after the
    // Fact Lines and Notifications and before the Narrator Flavour (design,
    // "Hints": "fact, notification, hint, then narrate + done"; Req 19.10).
    for (const chunk of streamHints(engine, factLines, action)) {
      yield chunk;
    }

    // Step 6 (narration): post-commit, flavour-only. A Narrator failure leaves
    // the commit intact and the turn fact-only (Req 16.5, 42.6).
    yield* narrateAction(result, draft);

    yield { kind: 'done' };
  }

  /**
   * Stream the Narrator's Flavour for a committed action (step 6). Delegates to
   * the injected {@link NarrateSeam}, which gates the Flavour through the Leak
   * and Specifics guards and falls back to fact-only on a guard trip or a
   * Narrator failure (Req 20.5, 16.5). The Fact Lines are already shown by the
   * caller, so only the Flavour sentences are yielded here. A rejected seam
   * leaves the commit intact and the turn fact-only — the error is swallowed
   * deliberately because the commit already stands (Req 16.5, 42.6). Omitting
   * the seam yields nothing (fact-only).
   */
  async function* narrateAction(
    result: ActionResult,
    state: WorldState,
  ): AsyncGenerator<TurnChunk> {
    if (config.narrate === undefined) {
      return;
    }
    let flavour: readonly string[] = [];
    try {
      flavour = await config.narrate(result, state);
    } catch {
      // A Narrator failure after commit: the committed turn stands, fact-only.
      return;
    }
    for (const sentence of flavour) {
      yield { kind: 'flavour', text: sentence };
    }
  }

  // -------------------------------------------------------------------------
  // Dialogue turn (steps 1–5, 7) and endScene
  // -------------------------------------------------------------------------

  async function* runSay(
    engine: PlayerViewEngine,
    line: string,
    offer: number | undefined,
    turnId: TurnId,
    pre: WorldState,
  ): AsyncGenerator<TurnChunk> {
    // Step 1: boundary — apply any finished extraction results first.
    applyExtractionBoundary(engine);

    // The dialogue turn requires an open Talk Scene. With none, `say` streams a
    // fixed line and `done` — no classify, no model call, no commit (Req 15.4).
    const scene = pre.player.scene;
    if (scene === undefined) {
      yield { kind: 'fact', text: NO_SCENE_LINE };
      yield { kind: 'done' };
      return;
    }

    const { ctx, caseFile, brief, rules, truth } = engine.turnContext;
    const npcId = scene.npc;
    const speakerName = personLabel(pre, npcId).label;

    // An offer the Budget cannot cover is rejected before any model call
    // (design, dialogue turn: "an offer the ledger cannot cover is rejected
    // before classification by the facade"; Req 15.7). The turn does not pause —
    // nothing was attempted — it just reports the shortfall and completes.
    if (offer !== undefined && offer > balance(pre.station.ledger)) {
      yield { kind: 'fact', text: OFFER_OVER_BUDGET_LINE };
      yield { kind: 'done' };
      return;
    }

    // Step 3 (setup): open the turn's PRNG and Truth draft, and build the per-
    // turn Resolver Context over the draft — the same pattern the action turn
    // uses (task 8.1), so a pitch's reads/writes stage on the draft with
    // read-your-writes and nothing reaches the Truth Store until commit. The
    // dialogue coin draws from `rng`. `applyDialogueTurn` is a pure World-State
    // reducer (it takes the draft and `rng`, not the context), so the context is
    // the staging seam the live recruitment path reads through; it is built here
    // for parity and discarded. With no Truth Store wired, the turn stages
    // nothing. (design, dialogue turn step 3; Req 5.3, 5.4, 15.5, 15.6)
    const rng = createPrng(pre.rng);
    const truthDraft = truth !== undefined ? TruthDraft.over(truth) : undefined;
    if (truthDraft !== undefined) {
      void projectResolverContext(
        { state: pre, caseFile, content: ctx.content, brief, rules },
        truthDraft,
      );
    }

    // Steps 2–4 are the pre-commit, model-touching span. A failure anywhere here
    // discards the draft (and the Intent/pitch effects and the Truth draft, by
    // never committing them) and pauses the turn, retained for retry. We apply
    // the Sim side and build up the released sentences before committing
    // anything, so nothing reaches the state, log, Journal or Notifications
    // until the single commit point (Req 5.4, 16.4, 42.1).
    let intent: Intent;
    let draft: WorldState;
    let released: readonly string[] = [];
    let speaker = speakerName;
    try {
      // Step 2: classify the line to an Intent (an unknown label becomes `ask`).
      const label = config.classify !== undefined ? await config.classify(line) : 'ask';
      intent = toIntent(label);

      // Step 3: apply the Intent/pitch to the scene NPC's Relationship on the
      // Draft BEFORE the reply streams (Req 15.5, 15.6). This updates trust and
      // suspicion by the Intent, resolves a `pitch-*` on `rng` (debiting a
      // money-pitch offer, Req 15.7; recording a reported pitch, Req 15.8),
      // mints the Asset on acceptance, and appends the player's line to
      // `scene.recent`. A money-pitch offer the ledger cannot cover was already
      // rejected above, so this never throws on the offer.
      const applied = applyDialogueTurn(
        pre,
        scene,
        { line, intent, ...(offer === undefined ? {} : { offer }) },
        rng,
        pitchWeightsOf(pre),
      );
      draft = applied.state;

      // Step 4: stream the reply through the guards (the voice seam). The reply
      // is produced over the applied Draft's scene, so the NPC answers from the
      // relationship the turn just moved.
      if (config.voice !== undefined) {
        const voiced = await config.voice(line, intent, { npc: npcId, speakerName });
        released = voiced.released;
        speaker = voiced.speaker;
      } else {
        released = [deflectionLine];
        speaker = speakerName;
      }
    } catch (err) {
      // Failure before commit: discard the draft (incl. the Intent/pitch effects
      // and the Truth draft), keep `pre`, and pause the turn for retry. Released
      // sentences from the failed attempt are interrupted, and an unreachable
      // endpoint pauses (Req 16.1, 16.4, 42.4).
      paused = { pre, intent: { kind: 'say', line, ...(offer === undefined ? {} : { offer }) } };
      yield { kind: 'interrupted' };
      yield {
        kind: 'paused',
        error: { endpoint: 'voice', message: describeError(err) },
      };
      return;
    }

    // Append the NPC's reply to the scene's recent turns, so the committed
    // `player.scene` carries both the player's line (added by applyDialogueTurn)
    // and the NPC's answer, capped at RECENT_TURNS (Req 15.9/the recent-turns
    // window). `applyDialogueTurn` left the scene on `draft.player.scene`.
    draft = withNpcReply(draft, released.join(' '));

    // The step-1 extraction boundary (above) may have committed a prior turn's
    // Told-List write-back onto `engine.state.told` (Req 17.2). The dialogue
    // draft was built from the pre-turn state, and a dialogue turn never writes
    // `told` itself, so re-base the draft's `told` onto the latest committed one
    // before the commit — otherwise the dialogue commit would clobber the
    // boundary's extraction write-back. (This is deterministic and leaves the
    // dialogue sim inputs — relationships, scene, ledger — untouched, so retry
    // reproduces the same turn.)
    draft = { ...draft, told: engine.state.told };

    // Step 5: commit — the single atomic point. Swap the state, commit the Truth
    // draft, record the dialogue line in the action log, and stream the speech.
    // A dialogue turn makes no Fact Lines of its own (the NPC's assertions
    // become Claims through extraction, step 7). The pitch's debit and a reported
    // pitch's Cover-Suspicion rise are part of the committed draft — discarded on
    // a pre-commit failure above, committed exactly here.
    actionLog.append({ kind: 'line', turn: turnId, at: draft.time, text: line });
    engine.commit(draft);
    truthDraft?.commit();
    for (const sentence of released) {
      yield { kind: 'speech', speaker, text: sentence };
    }

    // The turn committed cleanly, so clear any retained paused turn.
    paused = undefined;

    // Step 7: enqueue extraction for the NPC's reply, and kick off its phase-1
    // model call off the critical path (asynchronous; never blocks the next
    // input, Req 17.1). Keyed to the real scene NPC (Req 15.11). The speaker's
    // knowledge and Told List are captured HERE, at the dialogue turn, so the
    // Claim is judged against what the speaker knew then — not the later
    // boundary state (Req 17.2). `told[speaker]` on the committed draft is the
    // live Told List; the knowledge slice comes from the injected seam (the
    // documented projection gap). The result commits at the next turn boundary.
    const knowledgeSeam = config.speakerKnowledge;
    const job: QueuedExtraction = {
      turnId,
      speaker: npcId,
      utterance: released.join(' '),
      at: draft.time,
      speakerKnowledgeAtTurn:
        knowledgeSeam !== undefined
          ? knowledgeSeam(draft, npcId)
          : EMPTY_SPEAKER_KNOWLEDGE,
      toldList: draft.told[npcId] ?? [],
      // `coverIntact` gates consistency-violation logging (Req 17.5): a
      // contradiction counts as a lie slip only while the NPC's cover holds.
      // The live state exposes no per-scene cracking flag (the recruitment
      // path's cover-cracking is not projected onto the Talk Scene), so the
      // capture defaults to `true` — the same default `evaluateExtraction`
      // itself uses — and the live wiring refines it once a cracking signal is
      // projected (a documented seam).
      coverIntact: true,
    };
    extractionQueue.enqueue(job);
    config.extraction?.start(job);

    // Fire the hint triggers from the committed dialogue turn's Player View
    // facts (slice-integration task 8.4; design: "A pitch that recruits fires
    // the first-recruitment hint"). A dialogue turn surfaces no Fact Lines and
    // is not an action, so only the state/Case File-derived triggers can fire
    // here — first-recruitment on a landed pitch chief among them.
    for (const chunk of streamHints(engine, [])) {
      yield chunk;
    }

    yield { kind: 'done' };
  }

  /** The scenario's `recruitment.pitch` weights for the open world's turn. */
  function pitchWeightsOf(state: WorldState): PitchWeights {
    return state.meta.scenario.recruitment.pitch;
  }

  async function* runEndScene(
    engine: PlayerViewEngine,
    turnId: TurnId,
  ): AsyncGenerator<TurnChunk> {
    // Closing a scene is a bookkeeping turn: it applies the extraction boundary,
    // records the close in the action log, and clears the open Talk Scene at
    // commit (Req 15.3). It makes no model call, so it never pauses.
    applyExtractionBoundary(engine);
    const pre = engine.state;
    actionLog.append({ kind: 'line', turn: turnId, at: pre.time, text: '' });
    engine.commit(clearScene(pre));
    paused = undefined;
    yield { kind: 'done' };
  }

  // -------------------------------------------------------------------------
  // The driver entry point
  // -------------------------------------------------------------------------

  return function drive(engine: PlayerViewEngine, intent: TurnIntent): TurnStream {
    switch (intent.kind) {
      case 'act':
        return runAction(engine, intent.action, allocTurnId());
      case 'say':
        return runSay(engine, intent.line, intent.offer, allocTurnId(), engine.state);
      case 'endScene':
        return runEndScene(engine, allocTurnId());
      case 'retry': {
        // Re-run the paused turn from its retained pre-turn state (Req 16.4,
        // 42.4). With no paused turn there is nothing to retry: emit `done`.
        const held = paused;
        if (held === undefined) {
          return oneShot({ kind: 'done' });
        }
        if (held.intent.kind === 'say') {
          return runSay(engine, held.intent.line, held.intent.offer, allocTurnId(), held.pre);
        }
        return runEndScene(engine, allocTurnId());
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A one-chunk stream, for the trivial `retry` with nothing paused. */
async function* oneShot(chunk: TurnChunk): AsyncGenerator<TurnChunk> {
  yield chunk;
}

/** A player-safe message for a thrown/rejected model error. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return 'the model endpoint is unreachable';
}

/**
 * The fixed Fact Line the action turn streams when the game has already ended
 * (the ended gate, design step 2; Req 7.7): no further action is taken.
 */
const ENDED_GATE_LINE = 'The game is over. No further action can be taken.';

/**
 * The fixed Fact Line the action turn streams when a Day-Boundary Hook or the
 * Phase Step throws during `advanceWorld` (design: "If a hook or the Phase Step
 * throws, discard the Draft, stream 'The turn could not be completed'"). The
 * whole draft — world, PRNG, log, Journal, Notifications and the Truth draft —
 * is discarded, so the game stays at the pre-turn state (Req 5.4).
 */
const TURN_FAILED_LINE = 'The turn could not be completed.';

/**
 * The fixed Fact Line a dialogue turn streams when the player calls `say` with
 * no open Talk Scene (design, dialogue turn; Req 15.4): no model call, no
 * commit — the line is simply refused.
 */
const NO_SCENE_LINE = 'You are not talking to anyone.';

/**
 * The fixed Fact Line a dialogue turn streams when a money-pitch offer exceeds
 * the Budget (Req 15.7): the offer is rejected before any model call or state
 * change, so the turn commits nothing and does not pause.
 */
const OFFER_OVER_BUDGET_LINE = 'The Budget cannot cover that offer.';

/**
 * Build the {@link AdvanceWorldDeps} the action turn hands to `advanceWorld`.
 *
 * When the facade carries the Session's clock dependencies (`advance`, supplied
 * by the Composition Root), they are used as-is, with the turn's Objective
 * Evaluator (built over the draft and the Case File) and the turn's Truth draft
 * threaded in: the Session's `advance` fixes the hooks and cipher keys for the
 * whole game, while `objectives` and `truth` are per-turn and belong to this
 * turn. When the facade carries none (the projection/atomicity specs build the
 * facade without a Session), a model-free `AdvanceWorldDeps` is assembled from
 * the loaded content, the city data and the draft's own cipher material, so the
 * clock still advances deterministically and the turn stays model-free.
 *
 * The Objective Evaluator is `(draft) => buildObjectiveEvaluator({ state: draft,
 * caseFile })`, as the design wires it: the Phase Step's Directive check calls
 * it once per phase against the current draft, reading objective progress from
 * the draft and the player's Case File alone — no Truth Store (Req 6).
 */
function advanceDepsFor(
  advance: AdvanceWorldDeps | undefined,
  content: ContentSet,
  cityData: CityData,
  draft: WorldState,
  caseFile: CaseFile,
  truthDraft: TruthDraft | undefined,
): AdvanceWorldDeps {
  const objectives = (d: WorldState) =>
    buildObjectiveEvaluator({ state: d, caseFile });
  if (advance !== undefined) {
    return { ...advance, objectives, truth: truthDraft ?? advance.truth };
  }
  return {
    content,
    cityData,
    hooks: buildWorldHooks(),
    objectives,
    cipherKeys: worldCipherKeyLookup(draft.meta.seed, draft.documents),
    truth: truthDraft,
  };
}

/** True for an `openScene` request that names a known NPC (not an `unk:` id). */
function isNamedNpc(id: TalkSceneRequest['npc']): id is NpcId {
  return id.startsWith('npc:');
}

/**
 * Write an open {@link TalkScene} onto the draft from an action's or a kept
 * meeting's `openScene` request (design step 7; Req 15.1). The action turn opens
 * the scene as a minimal, correct Talk Scene — the NPC, when it opened, how it
 * opened, and an empty `recent` window — so the committed state carries the open
 * conversation. The scene's stakes default to `routine`; the dialogue turn (task
 * 8.2) owns classifying and advancing the conversation, which refines the kind
 * as the first lines are exchanged.
 *
 * `via` reflects how the scene opened: an `arrange-meeting` the clock kept opens
 * `via: 'meeting'`; the player's own `talk`/`approach` opens `via: 'talk'`.
 */
function withOpenScene(draft: WorldState, npc: NpcId, action: Action): WorldState {
  const via = action.kind === 'approach' ? 'approach' : action.kind === 'talk' ? 'talk' : 'meeting';
  const scene: TalkScene = {
    npc,
    kind: 'routine',
    openedAt: draft.time,
    via,
    recent: [],
  };
  return { ...draft, player: { ...draft.player, scene } };
}

/**
 * Append the NPC's released reply to the open scene's recent turns (Req 15.9),
 * capped at `RECENT_TURNS` by {@link appendRecentTurn}. The player's line was
 * already appended by {@link applyDialogueTurn}, so the committed `player.scene`
 * carries both turns of the exchange. Returns `draft` unchanged when no scene is
 * open (the caller only reaches here with one) or the reply is empty.
 */
function withNpcReply(draft: WorldState, reply: string): WorldState {
  const scene = draft.player.scene;
  if (scene === undefined || reply.length === 0) {
    return draft;
  }
  const nextScene: TalkScene = {
    ...scene,
    recent: appendRecentTurn(scene.recent, { speaker: 'npc', text: reply }),
  };
  return { ...draft, player: { ...draft.player, scene: nextScene } };
}

/** Clear the open Talk Scene (the `endScene` commit; Req 15.3). */
function clearScene(state: WorldState): WorldState {
  if (state.player.scene === undefined) {
    return state;
  }
  const { scene, ...rest } = state.player;
  void scene;
  return { ...state, player: rest };
}

/**
 * Write a speaker's updated Told List onto the committed WorldState (the
 * extraction commit's Told-List write-back; Req 17.2). `WorldState.told[npc]`
 * is the per-NPC Told List; `evaluateExtraction` returns the list with this
 * turn's Claims appended, and this swaps it in on `told`.
 */
function withToldList(
  state: WorldState,
  npc: NpcId,
  toldList: readonly Proposition[],
): WorldState {
  return { ...state, told: { ...state.told, [npc]: toldList } };
}

/**
 * The default {@link UnparsedNoteSink} (Req 17.3): record the raw excerpt as a
 * player Journal note attached to the speaker, so the player can still read what
 * was said even though the Sim could not type it into Claims. The design files
 * the note in the Case File; the Case File has no note surface yet, so this uses
 * the Journal note surface the facade already owns — the Case File note surface
 * is a documented seam the live wiring can supply through `config.unparsedNote`.
 */
const defaultUnparsedNoteSink: UnparsedNoteSink = (engine, note) => {
  engine.journal.addNote({
    at: note.at,
    attachTo: note.speaker,
    text: note.excerpt,
  });
};
