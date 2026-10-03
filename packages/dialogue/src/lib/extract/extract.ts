/**
 * The asynchronous Claim Extractor orchestrator (design "Claim Extractor" and
 * "Turn Pipeline", step 7; Requirements 7.1, 7.5).
 *
 * This is the model-facing half of extraction. It runs the one structured call
 * that turns an NPC's utterance into a parsed {@link ExtractionResult}, then
 * hands that result to the pure {@link evaluateExtraction} core, which does the
 * truth evaluation, the Told List update and the leak/violation logging. The
 * split keeps every decision that touches the world deterministic and testable
 * without a model, while this layer owns only the call, its retry and its
 * fallback.
 *
 * The extractor is a bookkeeping job, run off the turn's critical path: the
 * Turn Pipeline enqueues it after a dialogue turn commits and never blocks the
 * next player input on it (Requirement 7.1). It uses the `bookkeeping` role —
 * the lowest-priority band in the Gateway's queue (design "LLM Gateway" →
 * priority queue), so a live intent or voice call always goes first.
 *
 * The call goes through the Gateway's `structured` path with the
 * predicate-derived schema (`buildExtractionSchema`), so the model is
 * constrained to a JSON Schema the Sim recognises and the Gateway re-validates
 * the reply (Requirement 14.4). On a schema failure the extractor retries once
 * (Requirement 7.5); if the retry also fails, it does not drop the turn —
 * instead it returns an {@link UnparsedNote} carrying the raw transcript
 * excerpt, which the Case File keeps as a note so the player can still see what
 * was said even though the Sim could not type it.
 *
 * A *schema* failure and an *unreachable endpoint* are different failures with
 * different handling (design, the Turn Pipeline error table): a schema failure
 * is the model's fault and becomes a visible unparsed note, but a
 * {@link ConnectionError} / {@link TimeoutError} is a transport outage the
 * extractor must not disguise as a parsed-but-untypable utterance — the Turn
 * Pipeline keeps the job queued and adds a status-bar notice without pausing
 * (Requirement 17.6). So the retry loop retries and notes only *validation*
 * failures and lets a transport error propagate for the live runner to surface
 * as `unreachable`.
 */

import type { PredicateRegistry } from '@tradecraft/content';
import {
  type GameTime,
  type NpcId,
  type Proposition,
  type TruthStore,
} from '@tradecraft/engine';
import {
  ConnectionError,
  TimeoutError,
  type CallInput,
  type Gateway,
  type StructuredOptions,
  type Role,
} from '@tradecraft/llm';

import {
  evaluateExtraction,
  type ExtractionOutcome,
  type SpeakerKnowledge,
} from './extractor.js';
import { buildExtractionSchema } from './schema.js';

/** The Gateway role the extractor runs on: the low-priority bookkeeping band. */
export const EXTRACTION_ROLE: Role = 'bookkeeping';

/** How many times the structured call is retried after a schema failure. */
export const EXTRACTION_RETRY_LIMIT = 1;

/**
 * The note the extractor attaches when parsing fails after the retry
 * (Requirement 7.5). It carries the raw transcript excerpt (the NPC's
 * utterance) and the turn it belongs to, so the Case File can hold an unparsed
 * record of what was said. It carries no Propositions — the whole point is that
 * the Sim could not type the utterance — so it never reaches the Truth Store.
 */
export interface UnparsedNote {
  readonly kind: 'unparsed';
  /** The NPC who spoke. */
  readonly speaker: NpcId;
  /** The game time of the turn. */
  readonly at: GameTime;
  /** The raw transcript excerpt that could not be parsed. */
  readonly excerpt: string;
}

/**
 * The extractor's result: either the evaluated {@link ExtractionOutcome} (the
 * Claims, truth records, Told List and logs) when the model's reply parsed, or
 * an {@link UnparsedNote} when it did not after the retry.
 */
export type ExtractResult =
  | ({ readonly kind: 'parsed' } & ExtractionOutcome)
  | UnparsedNote;

/** The job the Turn Pipeline enqueues (design: `{ turnId, speaker, utterance, speakerKnowledgeAtTurn }`). */
export interface ExtractionJob {
  /** The NPC who spoke this turn. */
  readonly speaker: NpcId;
  /** The NPC's utterance, as released by the Leak Guard. */
  readonly utterance: string;
  /** The game time the turn was made at. */
  readonly at: GameTime;
  /** The speaker's knowledge captured at the turn. */
  readonly knowledge: SpeakerKnowledge;
  /** The speaker's Told List before this turn. */
  readonly toldList: readonly Proposition[];
  /** Whether the NPC's cover is intact this scene (see {@link EvaluateExtractionInputs}). */
  readonly coverIntact?: boolean;
}

/** The collaborators the extractor needs beyond the job. */
export interface ExtractDeps {
  /** The LLM Gateway (live, recording or replay). */
  readonly gateway: Gateway;
  /** The compiled predicate registry the schema and evaluation derive from. */
  readonly predicates: PredicateRegistry;
  /** The Truth Store `holds` and the truth-record transaction run against. */
  readonly truth: TruthStore;
  /** Optional structured-call options passed through to the Gateway. */
  readonly options?: StructuredOptions;
}

/**
 * The system frame for the extraction call. It states the one job — transcribe
 * what the character asserted into the structured list of Claims — and the
 * rules that keep the model honest: assert only what the NPC actually said,
 * mark tentative statements `hedged`, and use `unknown` for a party it cannot
 * tie to an id. It names no world facts, so it is a stable prefix the Gateway
 * can cache across turns.
 */
export const EXTRACTION_SYSTEM_PROMPT = [
  'You transcribe what a character asserted in one line of dialogue from a Cold',
  'War spy game into a structured list of claims. A claim is a single factual',
  'assertion the character made about the world.',
  '',
  'Rules:',
  '- Record only what the character actually asserted. Do not add, infer or',
  '  invent claims the line does not state.',
  '- Use the predicate that matches each assertion. If none fits, omit it.',
  '- For a person, place or thing you cannot tie to a known id, use "unknown".',
  '- Mark a claim "hedged" when the character stated it tentatively (maybe,',
  '  I think, I heard).',
  '- If the line asserts nothing factual, return an empty list.',
  'Respond only with the structured value.',
].join('\n');

/** Build the message list for an extraction call from an utterance. */
function buildMessages(utterance: string): CallInput {
  return [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: utterance },
  ];
}

/**
 * Run the asynchronous Claim Extractor for one dialogue turn.
 *
 * Builds the predicate-derived schema, calls the Gateway's `structured` path on
 * the `bookkeeping` role with the NPC's utterance, and on success evaluates the
 * parsed result through {@link evaluateExtraction}. A schema failure is retried
 * once (Requirement 7.5); if the retry also fails the function resolves to an
 * {@link UnparsedNote} with the raw excerpt rather than throwing, so the turn's
 * bookkeeping always completes with either typed Claims or a visible note.
 *
 * This is the one place extraction touches a model; the truth evaluation,
 * Told List update and leak/violation logging it drives are all pure
 * (`evaluateExtraction`). The job is never on the player's critical path
 * (Requirement 7.1); the caller enqueues it and commits the result at the next
 * turn boundary.
 *
 * @param job the extraction job (speaker, utterance, turn time, knowledge,
 *   Told List).
 * @param deps the Gateway, predicate registry, Truth Store and call options.
 * @returns a parsed {@link ExtractionOutcome} or an {@link UnparsedNote}.
 */
export async function extractClaims(
  job: ExtractionJob,
  deps: ExtractDeps,
): Promise<ExtractResult> {
  const schema = buildExtractionSchema(deps.predicates);
  const messages = buildMessages(job.utterance);

  // Attempt the structured call up to the retry limit. The Gateway re-validates
  // the reply against the schema, so a bad reply surfaces as a rejected promise.
  let lastError: unknown;
  for (let attempt = 0; attempt <= EXTRACTION_RETRY_LIMIT; attempt += 1) {
    try {
      const result = await deps.gateway.structured(
        EXTRACTION_ROLE,
        messages,
        schema,
        deps.options,
      );

      const outcome = evaluateExtraction({
        result,
        speaker: job.speaker,
        at: job.at,
        knowledge: job.knowledge,
        toldList: job.toldList,
        coverIntact: job.coverIntact,
        truth: deps.truth,
        predicates: deps.predicates,
      });
      return { kind: 'parsed', ...outcome };
    } catch (err) {
      // A transport outage is not a schema failure: let it propagate so the
      // live runner reports the endpoint as unreachable (Req 17.6) rather than
      // filing a misleading unparsed note. Only validation failures are retried
      // and, on exhaustion, noted.
      if (err instanceof ConnectionError || err instanceof TimeoutError) {
        throw err;
      }
      lastError = err;
    }
  }

  // Retry exhausted: attach the raw transcript excerpt as an unparsed note
  // (Requirement 7.5). The error is swallowed deliberately — the extractor must
  // not throw into the async queue; the note is its visible failure mode.
  void lastError;
  return {
    kind: 'unparsed',
    speaker: job.speaker,
    at: job.at,
    excerpt: job.utterance,
  };
}
