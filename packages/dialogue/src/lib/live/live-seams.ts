/**
 * Live model seams for the Turn Pipeline, composed through the dialogue package.
 *
 * The player-view Turn Pipeline (`createTurnDriver`) runs every turn model-free
 * behind four injected seams on its `TurnPipelineConfig`: a classify seam, a
 * voice seam, a narrate seam and an extraction runner. For a live session each
 * seam is wired to the LLM Gateway *through the dialogue package* — the intent
 * classifier, the NPC-voice stream under the Leak and Refusal guards, the
 * Narrator under the Specifics guard, and the asynchronous Claim Extractor. This
 * module is the single place that composes those pieces into a seam bundle, so
 * the live wiring is one function the Composition Root calls and one function
 * the offline test drives with a FAKE gateway.
 *
 * ## Why this lives in dialogue (and re-declares the seam types)
 *
 * `buildLiveSeams` moved here from `evals/src/lib/repl/seams.ts` so the live
 * wiring sits next to the dialogue machinery it composes. The seam *shapes* it
 * must satisfy are owned by `player-view` (the pipeline consumes them), but
 * dialogue must not import `player-view` — that would create a
 * `dialogue → player-view` edge the boundary rules forbid, and it would invert
 * the intended dependency direction (player-view is the facade, dialogue a leaf
 * it drives through injected seams). The seam types are purely structural, so
 * this module **re-declares them locally** from the engine, dialogue and content
 * vocabulary both packages already share. The player-view pipeline accepts any
 * object that is structurally assignable to its `TurnPipelineConfig`, so the
 * bundle this builds is handed straight to the pipeline with no import of the
 * nominal player-view types.
 *
 * The composition is deliberately kept behind the {@link Gateway} interface:
 * {@link buildLiveSeams} never constructs a gateway, it only consumes one, so
 * the same assembly runs over the live gateway (wrapped in the recording
 * gateway) in the CLI and over an in-memory fake in the test. Every seam routes
 * by Model Role exactly as the design prescribes:
 *
 *   - `classify` → the dialogue intent classifier on the `fast` role,
 *   - `voice`    → `stream('voice', …)` gated by the Refusal and Leak guards,
 *   - `narrate`  → the Narrator's `streamNarration` on the `narrator` role,
 *     which itself gates each Flavour sentence through the Leak and Specifics
 *     guards, and
 *   - `extraction` → the Claim Extractor on the `bookkeeping` role.
 *
 * This file is library code: it imports no vitest and performs no I/O of its
 * own. The Case File write the extraction runner performs is handed in as a
 * callback so the pipeline owns *when* it commits (step 7's boundary).
 */

import type { CityData, Namer, PredicateRegistry } from '@tradecraft/content';
import {
  EntityRegistry,
  phaseName,
  predicateNamer,
  type ActionResult,
  type Agenda,
  type CoverStory,
  type EntityId,
  type GameTime,
  type KnowledgeSlice,
  type NpcId,
  type NpcKnowledge,
  type Literal,
  type Persona,
  type Proposition,
  type SceneKind,
  type TalkScene,
  type TruthStore,
  type TurnId,
  type WorldState,
  ambientScene,
  promptFactsFor,
  recollectionPrompts,
} from '@tradecraft/engine';
import type { CallInput, Gateway } from '@tradecraft/llm';

import { classifyIntent } from '../intent/classifier.js';
import { guardReply } from '../refusal-guard/refusal-guard.js';
import {
  DEFAULT_LEAK_RETRY_LIMIT,
  guardStream,
  type LeakContext,
} from '../leak-guard/leak-guard.js';
import type { SpecificsContext } from '../specifics-guard/specifics-guard.js';
import {
  specificsPhaseFromOrdinal,
  streamNarration,
  type NarrationMode,
} from '../narrator/index.js';
import {
  buildPrompt,
  DEFAULT_TOKEN_BUDGET,
  type PromptInput,
  type RecentTurn,
  type ToldEntry,
} from '../prompt-builder/prompt-builder.js';
import { routeTurnRole } from '../routing/routing.js';
import type { Intent } from '@tradecraft/engine';
import {
  extractClaims,
  type ExtractedCaseClaim,
  type ExtractionJob,
  type ExtractResult,
  type SpeakerKnowledge,
} from '../extract/index.js';

// ---------------------------------------------------------------------------
// Structural mirrors of the player-view seam types
//
// These re-declare the shapes `player-view`'s `TurnPipelineConfig` consumes,
// using only the engine/dialogue/content vocabulary both packages share. They
// are intentionally structural: the player-view pipeline accepts any value
// assignable to its own (identically shaped) types, so nothing here imports
// `player-view` and no `dialogue → player-view` edge is created. See the module
// header. The authoritative definitions live in
// `player-view/src/lib/api/turn-pipeline.ts`; keep these in step with them.
// ---------------------------------------------------------------------------

/**
 * A classified Intent label (player-view's `ClassifiedIntent`). The classify
 * seam returns a label the pipeline coerces to an engine {@link Intent}; the
 * dialogue classifier already yields a valid {@link Intent}.
 */
export type ClassifiedIntent = Intent;

/**
 * The classify seam: classify a player's dialogue line. May reject on a model
 * failure, which pauses the turn (player may retry).
 */
export type ClassifySeam = (line: string) => Promise<string>;

/**
 * The voice seam: stream an NPC's reply through the guards. Handed the player's
 * line, the classified Intent and the scene NPC's id and player-facing name; it
 * returns the released sentences and the speaker name to tag `speech` chunks
 * with. A clean stream and a persona-deflection fallback both count as
 * completion; a rejection signals an unreachable endpoint (pauses the turn).
 */
export type VoiceSeam = (
  line: string,
  intent: Intent,
  scene: { readonly npc: NpcId; readonly speakerName: string },
) => Promise<{ readonly released: readonly string[]; readonly speaker: string }>;

/**
 * The narrate seam: given a committed action's {@link ActionResult} and the
 * post-commit state, return the guard-gated Flavour sentences to show after the
 * Fact Lines. A rejection leaves the committed turn fact-only.
 */
export type NarrateSeam = (
  result: ActionResult,
  state: WorldState,
) => Promise<readonly string[]>;

/**
 * One queued extraction job and the state the phase-2 commit needs (player-view's
 * `QueuedExtraction`). The queue holds jobs in `turnId` order; the pipeline
 * drains any job whose phase-1 result is ready at the next boundary.
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

/** A parsed extraction reply: a bounded list of Claims (player-view's `ExtractionResult`). */
export interface ExtractionResultShape {
  readonly claims: readonly ExtractedClaimShape[];
}

/** One extracted Claim's view-safe shape (player-view's `ExtractedClaimShape`). */
export interface ExtractedClaimShape {
  readonly predicate: string;
  readonly subject: string;
  readonly object: string | { readonly kind: string; readonly value: unknown };
  readonly place?: string;
  readonly when?: { readonly from: unknown; readonly to?: unknown };
  readonly hedged: boolean;
}

/**
 * What phase 1's {@link ExtractionRunner.ready} reports for a queued job
 * (player-view's `ExtractionReady`): parsed, unparsed, still pending, or the
 * endpoint is unreachable.
 */
export type ExtractionReady =
  | { readonly kind: 'parsed'; readonly result: ExtractionResultShape }
  | { readonly kind: 'unparsed'; readonly excerpt: string }
  | 'pending'
  | 'unreachable';

/**
 * The two-phase extraction runner seam (player-view's `ExtractionRunner`). It
 * owns phase 1 only — the model-facing Claim Extractor run off the critical
 * path. Phase 2 (the pure commit) is performed by the pipeline itself.
 */
export interface ExtractionRunner {
  /** Kick off the phase-1 model call for a newly enqueued job. */
  start(job: QueuedExtraction): void;
  /** Report whether the job's phase-1 result is ready, and what it is. */
  ready(job: QueuedExtraction): ExtractionReady;
}

/**
 * The subset of player-view's `TurnPipelineConfig` these Live Seams populate.
 * Structurally assignable to the full config (every other field is optional), so
 * the Composition Root can hand this bundle straight to the pipeline.
 */
export interface LiveSeamBundle {
  readonly classify: ClassifySeam;
  readonly voice: VoiceSeam;
  readonly narrate: NarrateSeam;
  readonly extraction: ExtractionRunner;
  readonly deflectionLine: string;
}

// ---------------------------------------------------------------------------
// Live Seams
// ---------------------------------------------------------------------------

/** The persona deflection line released when a guard exhausts its retries. */
export const DEFLECTION_LINE = 'The contact looks away and says nothing useful.';

/**
 * Build an {@link EntityRegistry} from a {@link WorldState} so the Leak Guard
 * has every registered entity's surface forms to watch for.
 *
 * The guard releases a sentence only when it names no registered entity outside
 * the allowed (known) set, so the registry must cover the *secret* entities too
 * — the NPCs, Locations and Orgs the player has not yet learned. Each NPC's
 * canonical name is their persona name, each Location's its display name, each
 * Org's its name. The world is the single source: no truth is unwrapped here
 * (persona name, Location name and Org name are all view-safe labels).
 */
export function registryFromWorld(state: WorldState): EntityRegistry {
  const entries = [
    ...Object.values(state.npcs).map((npc) => ({
      id: npc.id as EntityId,
      canonicalName: npc.persona.name,
      aliases: [],
    })),
    ...Object.values(state.city.locations).map((loc) => ({
      id: loc.id as EntityId,
      canonicalName: loc.name,
      aliases: [],
    })),
    ...Object.values(state.orgs).map((org) => ({
      id: org.id as EntityId,
      canonicalName: org.name,
      aliases: [],
    })),
  ].filter((e) => e.canonicalName.trim().length > 0);
  return EntityRegistry.from(entries);
}

/** The player's current known-entity set, as the Leak Guard's allowed ids. */
function knownEntities(state: WorldState): EntityId[] {
  return [...state.player.known.entities];
}

/** Drain a gateway token stream into one string. */
async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const token of stream) {
    text += token;
  }
  return text;
}

/**
 * The dependencies {@link buildLiveSeams} composes the seams from. Everything
 * the model-touching steps need beyond the gateway: the live engine (so a seam
 * can read the current {@link WorldState} and {@link EntityRegistry}), the
 * loaded content for the extractor's schema, the Truth Store the extractor
 * evaluates against, the narration mode, and the Case File write the extraction
 * commit performs.
 */
export interface LiveSeamDeps {
  /** Reads the live world state at the moment a seam runs. */
  readonly getState: () => WorldState;
  /** The loaded city data (unused by the seams directly, kept for symmetry). */
  readonly cityData?: CityData;
  /** The compiled predicate registry the Claim Extractor's schema derives from. */
  readonly predicates: PredicateRegistry;
  /**
   * The ground-truth store the Claim Extractor evaluates Claims against. The
   * {@link buildExtractionRunner} seam needs it to run {@link extractClaims}:
   * phase 1 calls the `bookkeeping` model and then {@link evaluateExtraction}
   * against this store to turn the reply into typed Claims. When it is absent
   * (the REPL/eval session wires no store), extraction cannot run, so every job
   * reports `pending` forever — the model-free default the pipeline tolerates
   * (a job that never becomes ready stays queued). The pipeline's own phase 2
   * re-evaluates the parsed Claims against the turn's draft Truth Store, so this
   * store's writes are the extractor's internal evaluation only.
   */
  readonly truth?: TruthStore;
  /** The narration mode (`full` | `brief` | `off`). Defaults to `full`. */
  readonly narrationMode?: NarrationMode;
  /** The city style sheet for the Narrator prompt, if the pack supplies one. */
  readonly styleSheet?: string;
  /**
   * The NPC's generation-time Knowledge Slice, Cover Story and Agenda — the
   * three pieces the design feeds {@link buildPrompt} that the live
   * {@link WorldState} does not yet carry.
   *
   * **Documented gap (task 8.3).** `assignKnowledge` produces an
   * {@link NpcKnowledge} per NPC at generation time, but task 8.3 did not
   * project it onto the live `WorldState` NPC — a live `NpcState` carries only
   * its {@link Persona}. The voice seam therefore cannot read the scene NPC's
   * Knowledge Slice, Cover Story or Agenda from the state it is handed, so this
   * seam supplies them. The Composition Root wires it from the generated
   * knowledge map; when it is absent (or returns `undefined`), the voice seam
   * builds the prompt from the persona alone with an empty Knowledge Slice —
   * which keeps the seam honest about the gap rather than inventing facts. The
   * day the knowledge is projected onto the state, this seam reads from the
   * state and the fallback disappears.
   */
  readonly npcKnowledge?: (npc: NpcId) => NpcKnowledge | undefined;
  /**
   * A short, view-safe rapport-band summary for the scene NPC, rendered into the
   * prompt's relationship block (the design's `relationshipSummary`). The
   * Composition Root derives it from the player's Relationship with the NPC;
   * absent means no relationship block.
   */
  readonly rapportBand?: (state: WorldState, npc: NpcId) => string | undefined;
  /**
   * The scenario's NPC prompt token budget (`scenario.tokenBudget`), which
   * {@link buildPrompt} trims each prompt to (Req 16.5). Defaults to the Prompt
   * Builder's {@link DEFAULT_TOKEN_BUDGET} (3,000) when unset.
   */
  readonly tokenBudget?: number;
  /**
   * The Leak Guard's retry limit (`scenario.retries.leakGuard`): how many times
   * the voice reply is regenerated under a stricter instruction before the
   * persona deflection line is substituted (Req 16.4). Defaults to
   * {@link DEFAULT_LEAK_RETRY_LIMIT} when unset.
   */
  readonly leakGuardRetries?: number;
  /**
   * Commit an NPC utterance into the player's record (the Case File write the
   * pipeline runs at the next turn boundary). The live CLI files the extracted
   * Claims; the test asserts it was invoked. Given the finished utterance and
   * the turn it belongs to.
   */
  readonly onUtterance?: (job: QueuedExtraction) => void;
}

/**
 * Build the `classify` seam: the dialogue intent classifier on the `fast` role.
 * A classification failure rejects, which the pipeline treats as a paused turn
 * (the player may retry).
 */
export function buildClassifySeam(gateway: Gateway): ClassifySeam {
  return async (line: string): Promise<ClassifiedIntent> => classifyIntent(gateway, line);
}

/**
 * Build the `voice` seam: an NPC reply streamed from the `voice` role and gated
 * by the Refusal Guard (retry under a reinforced fiction frame, then deflect)
 * and the Leak Guard (regenerate on a named secret, then deflect).
 *
 * The two guards compose as the design lays them out: a candidate is first
 * checked for breaking character (refusal/meta) and only an in-character reply
 * is then gated sentence by sentence against the scene NPC's known-entity set.
 * Both guards fall back to the same persona deflection line, which counts as a
 * clean completion of the turn.
 *
 * The reply is produced from a full {@link buildPrompt} prompt (persona, Cover
 * Story, Agenda, Knowledge Slice, Told List, rapport band and the scene's
 * recent turns), routed to the Model Role {@link routeTurnRole} picks from the
 * scene's stakes and the turn's Intent (Req 15.9). The player's line is placed
 * only in a `user` message (Req 16.3); the builder keeps the prompt within the
 * scenario's token budget (Req 16.5). The Knowledge Slice, Cover Story and
 * Agenda are supplied through {@link LiveSeamDeps.npcKnowledge} because task 8.3
 * does not project them onto the live `WorldState` yet; see that seam's doc.
 */
export function buildVoiceSeam(gateway: Gateway, deps: LiveSeamDeps): VoiceSeam {
  return async (line, intent, scene) => {
    const state = deps.getState();
    const npc = scene.npc;
    const talkScene = state.player.scene;
    const sceneKind: SceneKind | undefined =
      talkScene?.npc === npc ? talkScene.kind : undefined;

    // Route by stakes (Req 15.9): a high-stakes scene or Intent is voiced by
    // the dense `voice` role, everything else by the cheap `fast` role. The
    // decision is pure, so the turn reproduces on retry and replay.
    const role = routeTurnRole({ ...(sceneKind !== undefined ? { sceneKind } : {}), intent });

    // Build the NPC prompt with `buildPrompt` from the scene NPC's persona,
    // Cover Story, Agenda, Knowledge Slice, Told List, rapport band and the
    // scene's recent turns (Req 16.2). The three generation-time pieces the
    // live state does not carry (Knowledge Slice, Cover Story, Agenda) come from
    // the `npcKnowledge` seam; see its doc for the task-8.3 gap. The player's
    // line is withheld from the prompt and placed only in a `user` message
    // (Req 16.3), so `playerLine` is empty here. The builder trims to the
    // scenario's token budget (Req 16.5).
    const promptInput = voicePromptInput(state, deps, npc, talkScene, intent, line);
    const budget = deps.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const prompt = buildPrompt(promptInput, budget);

    // The Leak Guard's allowed set is the scene NPC's known-entity set (design:
    // `allowed = npc.knowledge.knownEntities`). With the knowledge gap unfilled,
    // the prompt's own known-entity list (what the NPC was told it may name) is
    // that set; it falls back to the player's known set when no knowledge is
    // supplied, matching the empty-slice prompt built above.
    const registry = registryFromWorld(state);
    const allowed =
      prompt.knownEntities.length > 0 ? [...prompt.knownEntities] : knownEntities(state);
    const leak: LeakContext = { registry, allowed };

    const speakerName = scene.speakerName;

    // Produce one candidate reply for a given attempt. The player's line is the
    // sole `user` message; a regeneration appends a stricter instruction to the
    // system block, naming only the break or leak class (never the model's text
    // or the secret).
    const generate = async (reinforce?: string): Promise<string> => {
      const system = reinforce === undefined ? prompt.text : `${prompt.text}\n\n${reinforce}`;
      const messages: CallInput = [
        { role: 'system', content: system },
        { role: 'user', content: line },
      ];
      return collect(gateway.stream(role, messages, { purpose: 'voice' }));
    };

    // Refusal Guard first: retry under a reinforced fiction frame, then deflect.
    const refusal = await guardReply(
      (req) =>
        generate(
          req.breakClass === undefined
            ? undefined
            : `Your previous reply broke character (${req.breakClass}). Stay strictly in character and reply only as ${promptInput.persona.name}.`,
        ),
      { deflectionLine: DEFLECTION_LINE },
    );

    // A deflection from the refusal guard is Sim-authored and released as-is.
    if (refusal.outcome === 'deflected') {
      return { released: [refusal.released], speaker: speakerName };
    }

    // Leak Guard: gate the in-character reply sentence by sentence against the
    // NPC's known-entity set, regenerating up to `scenario.retries.leakGuard`
    // times under a stricter instruction before deflecting (Req 16.4). The
    // first attempt reuses the reply the refusal guard already accepted; a
    // regenerate asks the voice model again under the leak class.
    let firstReply: string | undefined = refusal.released;
    const leaked = await guardStream(
      leak,
      (req) => {
        if (req.attempt === 0 && firstReply !== undefined) {
          const reply = firstReply;
          firstReply = undefined;
          return reply;
        }
        return generate(
          req.violationClass === undefined
            ? undefined
            : `Your previous reply named someone or somewhere you do not know (${req.violationClass}). Name only people, places and organisations on your known list, and stay in character.`,
        );
      },
      { deflectionLine: DEFLECTION_LINE, retryLimit: deps.leakGuardRetries ?? DEFAULT_LEAK_RETRY_LIMIT },
    );

    return { released: leaked.released, speaker: speakerName };
  };
}

/**
 * Build the `narrate` seam: the Narrator's Flavour for a committed action,
 * streamed from the `narrator` role and gated through the Leak and Specifics
 * guards by the dialogue package's {@link streamNarration}. A Narrator failure,
 * a guard trip twice, or `off` mode all resolve to fact-only — the pipeline
 * shows the Fact Lines regardless and the committed turn stands (Req 16.5).
 */
export function buildNarrateSeam(gateway: Gateway, deps: LiveSeamDeps): NarrateSeam {
  const mode: NarrationMode = deps.narrationMode ?? 'full';
  return async (result: ActionResult, state: WorldState): Promise<readonly string[]> => {
    const registry = registryFromWorld(state);
    const leak: LeakContext = { registry, allowed: knownEntities(state) };
    const labels = ambientEventLabels(state);
    const specifics: SpecificsContext = {
      factLines: result.factLines,
      sceneDescriptor: [describeScene(state), ...labels].join(' '),
      // The Specifics Guard's `phase` is the time-of-day *word*, not the engine
      // ordinal; convert through the dialogue helper.
      phase: specificsPhaseFromOrdinal(state.time.phase),
      ...(labels.length > 0 ? { allowedWords: labels } : {}),
    };

    const narration = await streamNarration(
      result.factLines,
      () => gateway.stream('narrator', narratorMessages(state, result), { purpose: 'narration' }),
      { mode, leak, specifics },
    );
    return narration.flavour;
  };
}

/**
 * The in-flight state the extraction runner tracks per queued job: either the
 * phase-1 call is still running (`pending`), it resolved to a parsed result or
 * an unparsed note (`settled`), or it rejected because the endpoint was
 * unreachable (`unreachable`).
 */
type ExtractionState =
  | { readonly status: 'pending' }
  | { readonly status: 'settled'; readonly result: ExtractResult }
  | { readonly status: 'unreachable' };

/** The key one queued job is tracked under: its `turnId` (unique per turn). */
function jobKey(job: QueuedExtraction): string {
  return job.turnId;
}

/**
 * Rebuild a view-safe {@link ExtractedClaimShape} from one evaluated
 * {@link ExtractedCaseClaim}. The pipeline's phase 2 re-runs
 * {@link evaluateExtraction} over the raw parsed Claims against the turn's draft
 * Truth Store, so {@link ExtractionRunner.ready} must hand back the *raw* Claim
 * shape (predicate, entity-or-literal object, place, window, hedged) rather than
 * the extractor's evaluated verdict. Each field projects straight off the
 * canonical {@link Proposition}; a literal object becomes `{ kind, value }` and
 * an entity object stays its id string. Resolved `unk:` ids pass through as
 * their stable view-safe handle (never the raw `'unknown'` sentinel).
 */
function claimShapeFromCaseClaim(claim: ExtractedCaseClaim): ExtractedClaimShape {
  const prop: Proposition = claim.prop;
  const object: ExtractedClaimShape['object'] =
    typeof prop.object === 'string'
      ? prop.object
      : literalShape(prop.object);
  return {
    predicate: prop.predicate,
    subject: prop.subject,
    object,
    ...(prop.place !== undefined ? { place: prop.place } : {}),
    ...(prop.window !== undefined
      ? { when: { from: prop.window.from, ...(prop.window.to !== undefined ? { to: prop.window.to } : {}) } }
      : {}),
    hedged: claim.hedged,
  };
}

/** The view-safe `{ kind, value }` shape of a Proposition {@link Literal}. */
function literalShape(literal: Literal): { readonly kind: string; readonly value: unknown } {
  return { kind: literal.kind, value: literal.value };
}

/** Map a settled {@link ExtractResult} to the pipeline's {@link ExtractionReady}. */
function readyFromResult(result: ExtractResult): ExtractionReady {
  if (result.kind === 'parsed') {
    return {
      kind: 'parsed',
      result: { claims: result.claims.map(claimShapeFromCaseClaim) },
    };
  }
  return { kind: 'unparsed', excerpt: result.excerpt };
}

/** Build the phase-1 {@link ExtractionJob} the extractor runs from a queued job. */
function extractionJobFrom(job: QueuedExtraction): ExtractionJob {
  return {
    speaker: job.speaker,
    utterance: job.utterance,
    at: job.at,
    knowledge: job.speakerKnowledgeAtTurn,
    toldList: job.toldList,
    coverIntact: job.coverIntact,
  };
}

/**
 * Build the `extraction` runner: the two-phase Claim Extractor seam the Turn
 * Pipeline drives (phase 1 only here — phase 2's `evaluateExtraction` commit is
 * pipeline-owned). The pipeline enqueues a job after a dialogue turn commits,
 * kicks off phase 1 through `start`, and at the next boundary asks `ready`.
 *
 * `start(job)` runs {@link extractClaims} on the `bookkeeping` role *off the
 * critical path* (Req 17.1): it fires the async call and stores the pending
 * promise keyed by the job's `turnId`, so the next player input never blocks on
 * it. When the call resolves — a parsed {@link ExtractionOutcome} or an
 * {@link UnparsedNote} — the stored state settles; when it rejects (the endpoint
 * was unreachable) the state becomes `unreachable`. `start` also records the
 * utterance through {@link LiveSeamDeps.onUtterance} for callers that log it.
 *
 * `ready(job)` reports that stored state (Req 17.3, 17.6):
 *   - `{ kind: 'parsed', result }` once the reply parsed — the raw Claims the
 *     pipeline's phase-2 `evaluateExtraction` files;
 *   - `{ kind: 'unparsed', excerpt }` when the reply failed schema validation
 *     after the retry — the pipeline files an unparsed note;
 *   - `'pending'` while the call is still in flight (or no job was started); and
 *   - `'unreachable'` when the endpoint rejected — the pipeline keeps the job
 *     queued with one status-bar notice and never pauses the game.
 *
 * When no Truth Store is wired ({@link LiveSeamDeps.truth} is absent) the
 * extractor cannot evaluate, so `start` records nothing and every `ready`
 * reports `pending` — the model-free default the pipeline tolerates (the job
 * stays queued). The live Composition Root supplies the store, at which point
 * the real `bookkeeping` call drives the runner unchanged.
 */
export function buildExtractionRunner(gateway: Gateway, deps: LiveSeamDeps): ExtractionRunner {
  // Phase-1 state per job, keyed by `turnId`. `start` seeds a `pending` entry
  // and the async call swaps it to `settled`/`unreachable` when it resolves;
  // `ready` reads whatever is current, so a result that lands between boundaries
  // is picked up at the next drain without blocking anything.
  const states = new Map<string, ExtractionState>();

  return {
    start: (job: QueuedExtraction): void => {
      deps.onUtterance?.(job);

      // Without a Truth Store the extractor has nothing to evaluate against; the
      // job stays `pending` forever (the documented model-free default).
      const truth = deps.truth;
      if (truth === undefined) {
        return;
      }

      const key = jobKey(job);
      states.set(key, { status: 'pending' });

      // Fire the `bookkeeping` call off the critical path (Req 17.1). The
      // promise is intentionally not awaited here; its resolution settles the
      // stored state the pipeline reads through `ready` at a later boundary.
      void extractClaims(extractionJobFrom(job), {
        gateway,
        predicates: deps.predicates,
        truth,
      }).then(
        (result) => {
          states.set(key, { status: 'settled', result });
        },
        () => {
          // A rejection is an unreachable endpoint (Req 17.6): keep the job
          // queued and let the pipeline add its one status-bar notice.
          states.set(key, { status: 'unreachable' });
        },
      );
    },

    ready: (job: QueuedExtraction): ExtractionReady => {
      const state = states.get(jobKey(job));
      if (state === undefined || state.status === 'pending') {
        return 'pending';
      }
      if (state.status === 'unreachable') {
        return 'unreachable';
      }
      return readyFromResult(state.result);
    },
  };
}

/**
 * Assemble a seam bundle wiring all four live seams over a {@link Gateway}. The
 * CLI passes the recording-wrapped live gateway; the test passes a fake. Nothing
 * here constructs a gateway, so the composition is the same in both cases and is
 * unit-testable offline. The returned {@link LiveSeamBundle} is structurally
 * assignable to the player-view pipeline's `TurnPipelineConfig`.
 */
export function buildLiveSeams(gateway: Gateway, deps: LiveSeamDeps): LiveSeamBundle {
  return {
    classify: buildClassifySeam(gateway),
    voice: buildVoiceSeam(gateway, deps),
    narrate: buildNarrateSeam(gateway, deps),
    extraction: buildExtractionRunner(gateway, deps),
    deflectionLine: DEFLECTION_LINE,
  };
}

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

/** A short time-of-day phrase for a scene frame. */
function timePhrase(time: GameTime): string {
  return `${phaseName(time.phase)} on day ${time.day}`;
}

/** A one-line, view-safe scene description for the Specifics Guard allowance. */
function ambientEventLabels(state: WorldState): readonly string[] {
  return ambientScene(state, state.player.loc)?.events ?? [];
}

function describeScene(state: WorldState): string {
  const place = state.city.locations[state.player.loc];
  const labels = ambientEventLabels(state);
  const base = `${place?.name ?? state.player.loc}. It is ${timePhrase(state.time)}.`;
  if (labels.length === 0) {
    return base;
  }
  return `${base} ${labels.join(', ')}.`;
}

/** An empty Knowledge Slice, used when the NPC's slice is not yet projected. */
const EMPTY_KNOWLEDGE: KnowledgeSlice = {
  known: [],
  falseBeliefs: [],
  knownEntities: [],
};

/**
 * The view-safe persona slice {@link buildPrompt} renders, taken from the live
 * NPC's {@link Persona} — the one dialogue piece the live `WorldState` does
 * carry (the Knowledge Slice, Cover Story and Agenda come from
 * {@link LiveSeamDeps.npcKnowledge}; see its doc for the task-8.3 gap).
 */
function promptPersona(persona: Persona): PromptInput['persona'] {
  return {
    name: persona.name,
    background: persona.background,
    voiceTraits: persona.voiceTraits,
    mannerisms: persona.mannerisms,
  };
}

/**
 * The recent-turns window the prompt renders, taken from the open scene. The
 * Turn Pipeline appends the player's current line to `scene.recent` before the
 * voice seam runs (pipeline step 3), so the trailing player turn is this turn's
 * line; it is dropped here because Req 16.3 keeps that line to the `user`
 * message alone — the recent block carries only the prior conversation.
 */
function recentTurnsFor(scene: TalkScene | undefined, line: string): readonly RecentTurn[] {
  if (scene === undefined || scene.recent.length === 0) {
    return [];
  }
  const recent = scene.recent.map(
    (t): RecentTurn => ({ speaker: t.speaker, text: t.text }),
  );
  const last = recent[recent.length - 1];
  if (last !== undefined && last.speaker === 'player' && last.text === line) {
    return recent.slice(0, -1);
  }
  return recent;
}

/** The scene NPC's Told List as {@link ToldEntry} rows, read from `state.told`. */
function toldEntriesFor(state: WorldState, npc: NpcId): readonly ToldEntry[] {
  const told = state.told[npc] ?? [];
  return told.map((proposition): ToldEntry => ({ proposition }));
}

/**
 * Assemble the {@link PromptInput} for the scene NPC's voice reply, drawing from
 * the live state and {@link LiveSeamDeps} (Req 16.2). The player's line is
 * withheld from the current-turn block (`playerLine` is empty) so it reaches the
 * model only through the `user` message (Req 16.3); the classified Intent is
 * passed as the stage direction. The Knowledge Slice, Cover Story and Agenda
 * come from `deps.npcKnowledge`, falling back to an empty slice when the gap is
 * unfilled.
 */
function voicePromptInput(
  state: WorldState,
  deps: LiveSeamDeps,
  npc: NpcId,
  scene: TalkScene | undefined,
  intent: Intent,
  line: string,
): PromptInput {
  const npcState = state.npcs[npc];
  const persona: PromptInput['persona'] =
    npcState !== undefined
      ? promptPersona(npcState.persona)
      : { name: 'The contact', background: '', voiceTraits: [], mannerisms: [] };
  const knowledge: NpcKnowledge | undefined = deps.npcKnowledge?.(npc);
  const slice: KnowledgeSlice = knowledge?.knowledge ?? EMPTY_KNOWLEDGE;
  const coverStory: CoverStory | undefined = knowledge?.cover;
  const agenda: Agenda | undefined = knowledge?.agenda;
  const namer: Namer = predicateNamer(state);
  const rapport = deps.rapportBand?.(state, npc);
  const ambient =
    state.ambient === undefined
      ? undefined
      : {
          facts: promptFactsFor(state, npc),
          recollections: recollectionPrompts(state, npc, (id) => namer(id)),
        };

  return {
    predicates: deps.predicates,
    namer,
    persona,
    ...(coverStory !== undefined ? { coverStory } : {}),
    ...(agenda !== undefined ? { agenda } : {}),
    knowledge: slice,
    ...(ambient === undefined ? {} : { ambient }),
    toldList: toldEntriesFor(state, npc),
    ...(rapport !== undefined && rapport.length > 0 ? { relationshipSummary: rapport } : {}),
    recentTurns: recentTurnsFor(scene, line),
    // The player's line is placed only in the `user` message (Req 16.3), so the
    // current-turn block carries no player text.
    playerLine: '',
    intent,
  };
}

/** Build the Narrator model's messages from a committed action's Fact Lines. */
function narratorMessages(state: WorldState, result: ActionResult): CallInput {
  const place = state.city.locations[state.player.loc];
  const frame = [
    'You are the narrator of a Cold War espionage drama. Describe the scene in',
    'the second person, present tense, in at most three sentences of sensory',
    'texture. Add no events beyond the facts. Name nothing not already named.',
    'Use no numbers, days of the week, dates or clock times.',
    `You are at ${place?.name ?? state.player.loc}, in the ${timePhrase(state.time)}.`,
  ].join('\n');
  const facts =
    result.factLines.length === 0
      ? '(No new facts.)'
      : result.factLines.map((f) => `- ${f}`).join('\n');
  return [
    { role: 'system', content: frame },
    { role: 'user', content: `Facts:\n${facts}` },
  ];
}

/** Re-export the speaker-id helper shape callers may want to log by. */
export type { NpcId };
