/**
 * The Leak Guard — the component that stops a model naming an entity it was
 * never told about (Requirement 5.2).
 *
 * A model voicing an NPC, or the Narrator describing a scene, can only be
 * trusted to speak Flavour: texture that carries no facts and is never parsed.
 * The danger is that the model names a *registered entity* the speaker does not
 * know — the real courier, the safehouse, the mole — and so leaks a secret the
 * mystery depends on. The Leak Guard gates the stream against that: it releases
 * the reply one sentence at a time, and only after checking that the sentence
 * names no registered entity outside an allowed set. For NPC dialogue the
 * allowed set is the NPC's known-entity set; for the Narrator it is the
 * player's known set (the design's Leak Guard section).
 *
 * The module is split in two, deliberately:
 *
 *   - {@link checkLeak} is the pure gating logic — sentence splitting is done by
 *     the caller, membership and whole-word matching are deterministic, and the
 *     function reads only its arguments. No I/O, no model call, no clock. This
 *     is the part the soundness property test (task 14.8) exercises.
 *
 *   - {@link guardStream} drives the regenerate loop. It is given an injected
 *     `regenerate` function rather than a live model, so the whole retry /
 *     deflection behaviour (Requirements 5.3, 5.4) can be tested without a
 *     model: on a sentence hit it discards the rest of the turn and asks for a
 *     fresh reply with a stricter instruction naming the violation class (never
 *     the entity), up to the retry limit, and substitutes a persona-appropriate
 *     deflection line once retries are exhausted.
 *
 * The matching rule, from the design: each sentence is scanned with a
 * case-insensitive, whole-word match against the *distinctive* aliases of every
 * entity not in the allowed set. Generic aliases ("pier" for a Location called
 * "The Pier") are flagged non-distinctive in the Entity Registry and skipped,
 * so ordinary prose does not trip the guard. Sentences already released stay
 * released, because they passed the check.
 */

import type { EntityId, EntityRegistry } from '@tradecraft/engine';

/**
 * One leak: the entity whose distinctive alias appeared, and the surface form
 * that matched it (as written in the sentence). The entity id is kept so the
 * eval harness and the Turn Pipeline can log *which* secret the model reached
 * for (Requirement 5.6), while the deflection and the retry instruction name
 * only the violation class, never the entity.
 */
export interface LeakHit {
  /** The registered entity, outside the allowed set, that was named. */
  readonly entity: EntityId;
  /** The distinctive alias that matched, as it appeared in the sentence. */
  readonly alias: string;
}

/** The result of checking a single sentence. */
export interface LeakResult {
  /** True when the sentence names no entity outside the allowed set. */
  readonly ok: boolean;
  /**
   * Every hit in the sentence, in the order the aliases occur. A clean sentence
   * has an empty array and `ok: true`.
   */
  readonly hits: readonly LeakHit[];
}

/**
 * The data the pure check reads: the registry of every entity's surface forms
 * and the allowed set it must not look outside of. Built once per turn by the
 * caller (the Knowledge Slicer supplies the NPC's known set; the Player View
 * supplies the player's known set).
 */
export interface LeakContext {
  /** Every entity's canonical name and aliases, each flagged distinctive. */
  readonly registry: EntityRegistry;
  /**
   * The ids the speaker is allowed to name. Any registered entity *not* in this
   * set gates the stream; an entity in it may be named freely. Accepts any
   * iterable so a caller can pass a `Set`, an array or the Knowledge Slicer's
   * `knownEntities` directly.
   */
  readonly allowed: Iterable<EntityId>;
}

/**
 * Normalise text for matching: trim and lower-case, mirroring the Entity
 * Registry's own match key so the guard and the registry agree on what counts
 * as the same surface form.
 */
function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Escape a string for safe use inside a `RegExp`, so an alias containing regex
 * metacharacters (a dot, a parenthesis) matches literally rather than as a
 * pattern. Aliases are world data and could hold anything.
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word, case-insensitive test for `alias` inside `sentence`.
 *
 * "Whole-word" here means the alias is not a substring of a larger word: "Mira"
 * must not match inside "admiral". Because an alias can itself be multi-word
 * ("The Pier") or carry punctuation, the boundary is defined positionally — the
 * character just before the match and just after it must not be a letter or
 * digit — rather than with `\b`, which behaves badly around non-word
 * characters and Unicode. The test is anchored on a Unicode letter/number class
 * so accented names behave.
 */
function containsWholeWord(sentence: string, alias: string): boolean {
  const needle = normalize(alias);
  if (needle.length === 0) {
    return false;
  }
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`,
    'u',
  );
  return pattern.test(normalize(sentence));
}

/**
 * Inspect one sentence and report every entity outside the allowed set whose
 * distinctive alias it names. An empty `hits` array (and `ok: true`) means the
 * sentence may be released.
 *
 * The scan walks every registered entity, skips those in the allowed set, and
 * tests the sentence against each of the entity's distinctive aliases. The
 * first distinctive alias that matches records a hit for that entity (one hit
 * per entity, keyed on the first alias that fired); the walk then moves on. The
 * allowed-set membership is checked first, so naming an entity the speaker
 * *does* know is always free, whatever it is called.
 *
 * Pure: it reads only its arguments and makes no model call, which is what lets
 * it run inside the streaming loop that releases one sentence at a time.
 *
 * @param sentence a single candidate sentence (the caller splits the stream).
 * @param context the registry and the allowed-entity set.
 */
export function checkLeak(sentence: string, context: LeakContext): LeakResult {
  const allowed = new Set<EntityId>(context.allowed);
  const hits: LeakHit[] = [];

  for (const id of context.registry.ids()) {
    if (allowed.has(id)) {
      continue;
    }
    for (const alias of context.registry.distinctiveAliasesOf(id)) {
      if (containsWholeWord(sentence, alias)) {
        hits.push({ entity: id, alias });
        break;
      }
    }
  }

  return { ok: hits.length === 0, hits };
}

/**
 * Split a block of streamed text into sentences for gating.
 *
 * The guard releases "one sentence at a time" (Requirement 5.2), so a reply has
 * to be cut into sentences before each is checked. The split is deliberately
 * simple and deterministic: a sentence ends at `.`, `!`, `?`, `…` or a newline,
 * taking any trailing closing quote or bracket with it, and trailing whitespace
 * is trimmed. A final fragment with no terminator is returned as its own
 * sentence so nothing is dropped. Empty pieces are discarded.
 *
 * This is intentionally not a linguistic sentence tokenizer — it does not try
 * to understand "Mr." or decimal points — because the guard only needs stable,
 * reproducible units to check, and the whole-word matcher is what actually
 * decides a leak. Over-splitting (an extra break on an abbreviation) is
 * harmless: each piece is still checked against the same allowed set.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const matches = text.match(/[^.!?…\n]*(?:[.!?…]+["'”’)\]]*|\n|$)/gu) ?? [];
  for (const raw of matches) {
    const sentence = raw.trim();
    if (sentence.length > 0) {
      out.push(sentence);
    }
  }
  return out;
}

/**
 * What {@link guardStream} returns: the sentences it released, how the turn
 * ended, and the hits it saw along the way.
 */
export interface GuardOutcome {
  /**
   * The clean sentences released to the player, in order. On a deflection, this
   * is exactly the one deflection line; on success it is the whole final reply
   * split into sentences.
   */
  readonly released: readonly string[];
  /** How the turn resolved. */
  readonly outcome: 'clean' | 'deflected';
  /**
   * The number of regenerations performed (0 when the first attempt was clean).
   * Capped at the retry limit.
   */
  readonly regenerations: number;
  /**
   * Every hit the guard caught across all attempts, in order, for logging
   * (Requirement 5.6). Empty on a first-attempt clean release.
   */
  readonly hits: readonly LeakHit[];
}

/**
 * Produce a candidate reply. The guard passes `attempt` (0 for the first,
 * rising by one on each regeneration) and, when regenerating, the
 * `violationClass` to name in the stricter instruction. The function returns
 * the full candidate text; the guard splits and gates it.
 *
 * Injecting this is what keeps {@link guardStream} testable without a model:
 * tests pass a function that returns canned strings, and the live pipeline
 * passes one that calls the LLM Gateway with the reinforced instruction.
 */
export type Regenerate = (request: RegenerateRequest) => Promise<string> | string;

/** The arguments the guard hands to {@link Regenerate}. */
export interface RegenerateRequest {
  /** 0 for the first attempt; 1, 2, … for each regeneration. */
  readonly attempt: number;
  /**
   * The violation class to reinforce against on a regeneration, or `undefined`
   * on the first attempt. The design is explicit that the instruction names the
   * class, never the leaked entity, so the model is not handed the secret.
   */
  readonly violationClass?: LeakViolationClass;
}

/**
 * The class of a Leak Guard violation, used to word the stricter regeneration
 * instruction without disclosing the entity. The slice has a single class — an
 * out-of-knowledge entity was named — but it is modelled as a named type so the
 * instruction wording and any future classes have one place to live.
 */
export type LeakViolationClass = 'unknown-entity';

/** Options for {@link guardStream}. */
export interface GuardStreamOptions {
  /**
   * The maximum number of regenerations after the first attempt before falling
   * back to a deflection line (`scenario.yaml`'s `retries.leakGuard`, default
   * 2). A value of 0 means the first hit deflects immediately. Clamped to be
   * non-negative.
   */
  readonly retryLimit?: number;
  /**
   * The persona-appropriate deflection line to release when retries are
   * exhausted (Requirement 5.4). The caller chooses it from the NPC's persona
   * (or a neutral Narrator line); the guard treats it as opaque text and does
   * **not** re-check it, since it is Sim-authored, not model output.
   */
  readonly deflectionLine: string;
}

/** The default retry limit, matching `scenario.yaml`'s `retries.leakGuard`. */
export const DEFAULT_LEAK_RETRY_LIMIT = 2;

/**
 * Gate a model reply through the Leak Guard, regenerating on a hit and
 * deflecting when retries run out (Requirements 5.2, 5.3, 5.4).
 *
 * The loop, per the design:
 *
 *   1. Ask `regenerate` for a candidate (attempt 0 first).
 *   2. Split it into sentences and check each in order. Release every clean
 *      sentence as it passes; the moment one hits, stop — the rest of that
 *      candidate is discarded ("stops the stream and discards the rest of the
 *      turn").
 *   3. If nothing hit, the turn is clean: return the released sentences.
 *   4. If something hit and the retry limit is not yet reached, discard the
 *      already-released sentences and regenerate with the violation class named
 *      (not the entity), attempt + 1.
 *   5. When the retry limit is reached, release the deflection line and stop.
 *
 * Releasing clean sentences as they pass and discarding the whole candidate on
 * the first hit matches the streaming model: in the live pipeline, sentences
 * released on a *failed* attempt have already reached the player and stay
 * released (the design: "sentences already released stay released"), while this
 * function reports only the sentences of whichever attempt it settles on so a
 * caller can drive either a streaming or a buffered UI from the same result.
 *
 * The `regenerate` injection makes the whole thing deterministic and
 * model-free in tests. `checkLeak` does the actual gating, so this function
 * carries no matching logic of its own.
 *
 * @param context the registry and allowed set the sentences are checked against.
 * @param regenerate produces a candidate reply for a given attempt.
 * @param options the retry limit and the deflection line.
 */
export async function guardStream(
  context: LeakContext,
  regenerate: Regenerate,
  options: GuardStreamOptions,
): Promise<GuardOutcome> {
  const retryLimit = Math.max(0, Math.trunc(options.retryLimit ?? DEFAULT_LEAK_RETRY_LIMIT));
  const allHits: LeakHit[] = [];

  // attempt 0 is the first generation; attempts 1..retryLimit are regenerations.
  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    const candidate = await regenerate({
      attempt,
      violationClass: attempt === 0 ? undefined : 'unknown-entity',
    });

    const released: string[] = [];
    let hitThisAttempt = false;

    for (const sentence of splitSentences(candidate)) {
      const result = checkLeak(sentence, context);
      if (result.ok) {
        released.push(sentence);
        continue;
      }
      // A hit: record it, discard the rest of this candidate, and break so the
      // outer loop decides between regenerating and deflecting.
      allHits.push(...result.hits);
      hitThisAttempt = true;
      break;
    }

    if (!hitThisAttempt) {
      return {
        released,
        outcome: 'clean',
        regenerations: attempt,
        hits: allHits,
      };
    }
  }

  // Retries exhausted: substitute the persona deflection line. It is
  // Sim-authored and so is released without re-checking.
  return {
    released: [options.deflectionLine],
    outcome: 'deflected',
    regenerations: retryLimit,
    hits: allHits,
  };
}
