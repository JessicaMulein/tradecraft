/**
 * The Claim Extractor's pure core (design "Claim Extractor"; Requirements 5.6,
 * 6.1, 6.5, 7.1, 7.2, 7.3).
 *
 * After a dialogue turn, the Sim transcribes what the NPC asserted into
 * canonical {@link Proposition}s (Claims) and evaluates them. That work splits
 * cleanly into two halves, and this module owns the pure half — everything the
 * Sim does with an already-parsed {@link ExtractionResult}, with no model call
 * and no I/O. The async half (the structured model call, the schema retry and
 * the unparsed-note fallback) lives in {@link ./extract.ts}, which hands its
 * parsed result straight here.
 *
 * For each extracted Claim the design prescribes six steps:
 *
 *   1. Evaluate its truth against the Truth Store at the claim time.
 *   2. Decide whether the speaker *believed* it, from their Knowledge Slice and
 *      false beliefs.
 *   3. Mark it a deliberate lie if it is believed false or is on the Agenda's
 *      promote list.
 *   4. Write the {@link ClaimTruthRecord} to the Truth Store (ground truth).
 *   5. Append the Claim to the speaker's Told List.
 *   6. Add a view-safe {@link ExtractedCaseClaim} to the Case File.
 *
 * On top of those, two bookkeeping signals are logged for evaluation:
 *
 *   - a **chance leak** (Requirement 5.6): a Claim that *holds* but which the
 *     speaker does not know — the model guessed a concealed truth (named the
 *     right meeting day without being told it). These are logged, not blocked,
 *     because blocking would need synchronous extraction (design "Chance
 *     leaks").
 *   - a **consistency violation** (Requirement 6.5): a Claim that contradicts
 *     the speaker's existing Told List while the NPC's cover is intact (no
 *     cracking state change) — a lying NPC fumbling its own story.
 *
 * Crucially, the only *world* write is the `ClaimTruthRecord`, which is ground
 * truth, not a fact that changes the world: a model's output never becomes a
 * fact (Requirement 2.3, 2.4). The view-safe Claims and the updated Told List
 * are returned as plain data for the Turn Pipeline to commit into the Player
 * View and the dialogue state; this function performs the single truth-store
 * transaction itself (step 4) and leaves every other write to its caller, so it
 * stays easy to drive from a test with a fake store.
 *
 * The whole function is deterministic: given the same parsed result, speaker
 * knowledge, Told List and Truth Store, it produces the same records every
 * time, which is what lets an extraction commit replay at the same turn
 * boundary (design "Turn Pipeline", step 7).
 */

import type { PredicateRegistry } from '@tradecraft/content';
import {
  compareTime,
  type ClaimTruthRecord,
  type EntityId,
  type GameTime,
  type Literal,
  type NpcId,
  type Proposition,
  type PropId,
  type TruthStore,
  type UnkId,
} from '@tradecraft/engine';

import type { ExtractedClaim, ExtractionResult } from './schema.js';
import { UNKNOWN_ENTITY } from './schema.js';

/**
 * The speaker's knowledge at the turn, as the Claim Extractor needs it. This is
 * the subset of the NPC's Knowledge Slice and Agenda the evaluation reads: the
 * Propositions the speaker holds as true, the ones they sincerely but falsely
 * believe, and the ids of their own Propositions they actively promote (true or
 * not). The Turn Pipeline captures this at the turn the Claim was made and
 * carries it on the extraction job (`speakerKnowledgeAtTurn`), so a Claim is
 * always judged against what the speaker knew *then*.
 */
export interface SpeakerKnowledge {
  /** Propositions the speaker holds as true (their `known` slice). */
  readonly known: readonly Proposition[];
  /** Propositions the speaker sincerely but wrongly believes. */
  readonly falseBeliefs: readonly Proposition[];
  /** Ids of Propositions the speaker's Agenda promotes (true or not). */
  readonly promote: readonly PropId[];
}

/**
 * A view-safe Claim the extractor produces for the Case File. It carries the
 * canonical Proposition, who said it, when, and whether the NPC hedged — but
 * none of the ground-truth verdict (`held`, `believed`, `lie`), which stays in
 * the Truth Store's {@link ClaimTruthRecord}. The player-view layer wraps this
 * into its full `Claim` (adding the `source`, grade and links). Keeping the
 * extractor's output view-safe is what keeps a model's assertion from ever
 * carrying a truth brand across the boundary (Requirement 7.3).
 */
export interface ExtractedCaseClaim {
  /** The Claim's id (also the Proposition's id). */
  readonly id: PropId;
  /** The canonical Proposition the NPC asserted. */
  readonly prop: Proposition;
  /** The NPC who asserted it. */
  readonly speaker: NpcId;
  /** The game time the Claim was made. */
  readonly observedAt: GameTime;
  /** Whether the NPC stated it tentatively. */
  readonly hedged: boolean;
}

/** A logged chance leak: a true Claim the speaker did not know (Req 5.6). */
export interface ChanceLeak {
  /** The Claim id that leaked. */
  readonly claimId: PropId;
  /** The Proposition the model guessed. */
  readonly prop: Proposition;
}

/** A logged consistency violation: a Claim against the Told List (Req 6.5). */
export interface ConsistencyViolation {
  /** The new Claim id that contradicts the Told List. */
  readonly claimId: PropId;
  /** The Proposition the new Claim asserts. */
  readonly prop: Proposition;
  /** The id of the Told-List Proposition it contradicts. */
  readonly contradicts: PropId;
}

/** The result of evaluating one parsed extraction result. */
export interface ExtractionOutcome {
  /** The truth records written to the Truth Store (one per Claim). */
  readonly truthRecords: readonly ClaimTruthRecord[];
  /** The view-safe Claims to add to the Case File (one per Claim). */
  readonly claims: readonly ExtractedCaseClaim[];
  /** The speaker's Told List after appending this turn's Claims. */
  readonly toldList: readonly Proposition[];
  /** Chance leaks found this turn, for evaluation (Req 5.6). */
  readonly chanceLeaks: readonly ChanceLeak[];
  /** Consistency violations found this turn, for evaluation (Req 6.5). */
  readonly consistencyViolations: readonly ConsistencyViolation[];
}

/** Everything {@link evaluateExtraction} needs beyond the parsed result. */
export interface EvaluateExtractionInputs {
  /** The parsed, schema-valid extraction result. */
  readonly result: ExtractionResult;
  /** The NPC who spoke this turn. */
  readonly speaker: NpcId;
  /** The game time the turn (and so every Claim) was made at. */
  readonly at: GameTime;
  /** The speaker's knowledge at the turn. */
  readonly knowledge: SpeakerKnowledge;
  /** The speaker's Told List before this turn. */
  readonly toldList: readonly Proposition[];
  /**
   * Whether the NPC's cover is intact — no cracking state change this scene. A
   * consistency violation is only logged while the cover holds; once the NPC is
   * cracking (partial admission, bargaining, flight) a contradiction is
   * expected, not a lie slip (Requirement 6.5). Defaults to `true`.
   */
  readonly coverIntact?: boolean;
  /** The Truth Store, for `holds` and the one truth-record transaction. */
  readonly truth: TruthStore;
  /** The compiled predicate registry (for place/window-aware Proposition shape). */
  readonly predicates: PredicateRegistry;
  /**
   * How a Claim id is minted from the turn and the Claim's index. Injected so
   * ids are deterministic and the caller controls the scheme; defaults to
   * `claim:<speaker-local>:<day>-<phase>:<index>`.
   */
  readonly claimId?: (index: number) => PropId;
  /**
   * Allocate the `unk:` id a Claim naming an `'unknown'` party should take.
   * Injected so the dialogue layer stays independent of the engine's
   * Unidentified-Subject allocation; defaults to `unk:<index>` within the turn.
   * The returned id is view-safe: it is the stable handle the Case File relates
   * to a named NPC only once the player holds an `IS_ALIAS_OF` Claim.
   */
  readonly allocateUnk?: (index: number) => UnkId;
}

/** The default Claim-id scheme: stable within a turn and across replays. */
function defaultClaimId(speaker: NpcId, at: GameTime, index: number): PropId {
  const local = speaker.slice('npc:'.length);
  return `claim:${local}:${at.day}-${at.phase}:${index}`;
}

/** Resolve a schema entity string to an {@link EntityId}, or an allocated `unk:`. */
function resolveEntity(
  raw: string,
  index: number,
  allocateUnk: (index: number) => UnkId,
): EntityId {
  return raw === UNKNOWN_ENTITY ? allocateUnk(index) : (raw as EntityId);
}

/** Turn a schema literal object into a core {@link Literal}. */
function toLiteral(object: { kind: string; value: unknown }): Literal {
  switch (object.kind) {
    case 'amount':
      return { kind: 'amount', value: object.value as number };
    case 'time':
      return { kind: 'time', value: object.value as GameTime };
    default:
      return { kind: 'text', value: object.value as string };
  }
}

/**
 * Build the canonical {@link Proposition} for one extracted Claim. Entity
 * arguments are resolved (an `'unknown'` becomes an allocated `unk:` id);
 * literal objects are converted; `place` and `when` carry through when present.
 */
function toProposition(
  claim: ExtractedClaim,
  id: PropId,
  index: number,
  allocateUnk: (index: number) => UnkId,
): Proposition {
  const subject = resolveEntity(claim.subject, index, allocateUnk);
  const object =
    typeof claim.object === 'string'
      ? resolveEntity(claim.object, index, allocateUnk)
      : toLiteral(claim.object);

  const prop: {
    id: PropId;
    subject: EntityId;
    predicate: string;
    object: EntityId | Literal;
    place?: Proposition['place'];
    window?: Proposition['window'];
  } = { id, subject, predicate: claim.predicate, object };

  if (claim.place !== undefined) {
    prop.place = claim.place as Proposition['place'];
  }
  if (claim.when !== undefined) {
    prop.window = claim.when as Proposition['window'];
  }
  return prop as Proposition;
}

/** Two Propositions assert the same thing (ignoring their ids and hedging). */
function sameAssertion(a: Proposition, b: Proposition): boolean {
  return (
    a.subject === b.subject &&
    a.predicate === b.predicate &&
    objectsEqual(a.object, b.object) &&
    a.place === b.place
  );
}

/** Equal Proposition objects (entity ids or literals). */
function objectsEqual(a: EntityId | Literal, b: EntityId | Literal): boolean {
  if (typeof a === 'string' || typeof b === 'string') {
    return a === b;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'time' && b.kind === 'time') {
    return compareTime(a.value, b.value) === 0;
  }
  return a.value === b.value;
}

/**
 * Two Propositions over the same subject/predicate/place contradict when they
 * assign *different* objects. A lying NPC that said "I met Ana at the Pier" and
 * then "I met Viktor at the Pier" has contradicted itself; saying the same
 * thing twice has not. Only same-subject, same-predicate, same-place pairs are
 * compared, so unrelated Claims never count as a contradiction.
 */
function contradicts(a: Proposition, b: Proposition): boolean {
  if (a.subject !== b.subject || a.predicate !== b.predicate || a.place !== b.place) {
    return false;
  }
  return !objectsEqual(a.object, b.object);
}

/** Does the speaker's knowledge contain an assertion equal to `prop`? */
function speakerKnows(prop: Proposition, knowledge: SpeakerKnowledge): boolean {
  return knowledge.known.some((k) => sameAssertion(k, prop));
}

/** Does the speaker sincerely but wrongly believe `prop`? */
function speakerBelievesFalsely(
  prop: Proposition,
  knowledge: SpeakerKnowledge,
): boolean {
  return knowledge.falseBeliefs.some((f) => sameAssertion(f, prop));
}

/**
 * Evaluate a parsed {@link ExtractionResult} (design's six steps plus the two
 * logged signals). Pure except for the single truth-store transaction that
 * writes every Claim's {@link ClaimTruthRecord} (step 4) — the one ground-truth
 * write extraction performs. Everything else is returned as plain data for the
 * caller to commit: the view-safe Claims, the appended Told List, and the
 * chance-leak and consistency-violation logs.
 *
 * @param inputs the parsed result, the speaker and turn time, the speaker's
 *   knowledge and Told List, the Truth Store and predicate registry, and the
 *   optional id/allocation hooks.
 * @returns the {@link ExtractionOutcome} for this turn.
 */
export function evaluateExtraction(
  inputs: EvaluateExtractionInputs,
): ExtractionOutcome {
  const {
    result,
    speaker,
    at,
    knowledge,
    toldList,
    coverIntact = true,
    truth,
    claimId = (index) => defaultClaimId(speaker, at, index),
    allocateUnk = (index) => `unk:${index}` as UnkId,
  } = inputs;

  const promote = new Set<PropId>(knowledge.promote);

  const truthRecords: ClaimTruthRecord[] = [];
  const claims: ExtractedCaseClaim[] = [];
  const chanceLeaks: ChanceLeak[] = [];
  const consistencyViolations: ConsistencyViolation[] = [];

  // The Told List grows as the turn's Claims are appended; a later Claim this
  // same turn can contradict an earlier one, so compare against the running list.
  const runningToldList: Proposition[] = [...toldList];

  result.claims.forEach((claim, index) => {
    const id = claimId(index);
    const prop = toProposition(claim, id, index, allocateUnk);

    // Step 1: truth against the Truth Store at the claim time.
    const held = truth.holds(prop, at);

    // Step 2: did the speaker believe it? True if they hold it as known, or if
    // they sincerely (if wrongly) believe it.
    const believed =
      speakerKnows(prop, knowledge) || speakerBelievesFalsely(prop, knowledge);

    // Step 3: a deliberate lie is a Claim the speaker believed false (believed
    // false = not believed true, yet asserted) or one the Agenda promotes.
    // Promotion makes it a lie only when it does not actually hold — pushing a
    // true line is not a lie.
    const promoted = promote.has(prop.id) || promote.has(claim.predicate);
    const lie = (!believed && !held) || (promoted && !held);

    const record: ClaimTruthRecord = {
      claim: prop,
      speaker,
      at,
      held,
      believed,
      lie,
    };
    truthRecords.push(record);

    // Step 6 (view-safe Claim); the Told List append is step 5, below.
    claims.push({ id, prop, speaker, observedAt: at, hedged: claim.hedged });

    // Chance leak (Req 5.6): the Claim holds, but the speaker did not know it —
    // the model guessed a concealed truth. A false belief that happens to be
    // asserted is not a leak; the Claim must actually hold.
    if (held && !speakerKnows(prop, knowledge)) {
      chanceLeaks.push({ claimId: id, prop });
    }

    // Consistency violation (Req 6.5): the Claim contradicts the Told List while
    // the cover is intact. Compare against the running Told List so an in-turn
    // self-contradiction is caught too.
    if (coverIntact) {
      const clash = runningToldList.find((prior) => contradicts(prop, prior));
      if (clash !== undefined) {
        consistencyViolations.push({
          claimId: id,
          prop,
          contradicts: clash.id,
        });
      }
    }

    // Step 5: append to the Told List.
    runningToldList.push(prop);
  });

  // Step 4: one atomic transaction writes every Claim's truth record. This is
  // the only world write; a model's output never becomes a fact (Req 2.3, 2.4).
  if (truthRecords.length > 0) {
    truth.transaction((tx) => {
      for (const record of truthRecords) {
        tx.recordClaimTruth(record);
      }
    });
  }

  return {
    truthRecords,
    claims,
    toldList: runningToldList,
    chanceLeaks,
    consistencyViolations,
  };
}
