/**
 * The Refusal Guard — the component that catches a model that has stopped
 * playing its part, and recovers the turn (Requirement 16.3).
 *
 * A model voicing an NPC is supposed to stay inside the fiction: speak as the
 * character, in the second person, about the world. Two failure modes break
 * that, and both ruin the illusion rather than leaking a secret (that is the
 * Leak Guard's job):
 *
 *   - a **refusal** — the model declines the turn ("I can't help with that",
 *     "I'm not able to continue", "I won't roleplay this"); and
 *   - a **meta-response** — the model talks about *being a model* or about *the
 *     game* instead of answering in character ("As an AI language model…",
 *     "In this roleplay scenario…", "I don't have personal opinions").
 *
 * The design's dialogue-resilience text prescribes the recovery: a cheap,
 * deterministic heuristic runs first; the `fast` role confirms only when the
 * heuristic is uncertain; on a detected break the Sim retries the generation
 * once under a *reinforced fiction frame* — a stronger in-character system
 * instruction — and, if the retry still breaks character, substitutes a
 * persona deflection line (Requirement 16.3; error-handling table row
 * "Refusal or meta response").
 *
 * The module is split in two, mirroring the Leak Guard (task 14.7):
 *
 *   - {@link classifyReply} is the pure, deterministic heuristic. Given a
 *     candidate reply it returns one of `in-character`, `refusal`, `meta` or
 *     `uncertain`, reading only its argument. No I/O, no model call, no clock.
 *     This is the part the unit tests pin down.
 *
 *   - {@link guardReply} drives the retry-under-reinforced-frame loop. It is
 *     given an injected `regenerate` function rather than a live model — the
 *     same pattern as the Leak Guard's `guardStream` — so the whole retry /
 *     deflection behaviour is testable without a model. An optional injected
 *     `confirm` function stands in for the `fast`-role confirmation and is
 *     consulted only when the heuristic returns `uncertain`.
 *
 * Both parts are deliberately free of any model dependency: the heuristic is a
 * table of phrase and shape rules, and the loop takes its model work as
 * injected functions, so this file imports nothing from the LLM package.
 */

/**
 * How a candidate reply reads under the heuristic. `in-character` releases the
 * reply; `refusal` and `meta` trigger a retry (or deflection); `uncertain`
 * hands the decision to the injected confirmer (the `fast` role in the live
 * pipeline), which collapses it to one of the first three.
 */
export type ReplyClass = 'in-character' | 'refusal' | 'meta' | 'uncertain';

/**
 * A definite verdict — the heuristic's `uncertain` resolved. This is what a
 * confirmer returns and what the retry loop ultimately acts on.
 */
export type ReplyVerdict = 'in-character' | 'refusal' | 'meta';

/**
 * The class of a break, used to word the reinforced-frame instruction and to
 * log *why* a turn was retried or deflected, without quoting the model's text.
 * It is exactly {@link ReplyVerdict} minus the clean case.
 */
export type BreakClass = 'refusal' | 'meta';

/**
 * Normalise a reply for matching: lower-case, replace typographic apostrophes
 * and quotes with ASCII ones, and collapse runs of whitespace to a single
 * space. The phrase table is written in this normal form so that "I'm" (curly)
 * and "I'm" (straight) match the same rule and line breaks never hide a phrase.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Refusal phrases, in normal form. A reply containing any of these as a
 * substring is a refusal: the model is declining the turn rather than playing
 * it. The list stays to common, unambiguous openers so ordinary in-character
 * speech ("I can't tell you where he went") is not swept up — those are handled
 * by requiring the decline to be about *helping*, *continuing*, *assisting* or
 * *the request itself*, not about a fact inside the fiction.
 */
const REFUSAL_PHRASES: readonly string[] = [
  "i can't help with that",
  'i cannot help with that',
  "i can't assist with that",
  'i cannot assist with that',
  "i can't help you with that",
  "i'm not able to help with",
  "i'm unable to help with",
  "i'm not able to assist",
  "i'm unable to assist",
  "i can't continue with this",
  "i cannot continue with this",
  "i won't be able to continue",
  "i'm not able to continue",
  "i won't roleplay",
  "i can't roleplay",
  "i cannot roleplay",
  "i won't engage in this roleplay",
  "i can't engage with this request",
  "i cannot engage with this request",
  "i can't comply with that",
  'i cannot comply with that',
  "i can't participate in this",
  'i cannot fulfill that request',
  "i can't fulfill that request",
  'i must decline',
  'i have to decline',
  "i'm sorry, but i can't",
  "i'm sorry, but i cannot",
  'sorry, but i cannot continue',
  "i'm not comfortable continuing",
  "i'm not comfortable with this request",
];

/**
 * Meta-response phrases, in normal form. These are the tells that the model is
 * speaking *about* being a model or about the game machinery rather than
 * answering in character. Being an acknowledged AI or breaking the fiction's
 * frame is the signal, regardless of whether the model then goes on to help.
 */
const META_PHRASES: readonly string[] = [
  'as an ai',
  'as a language model',
  'as an ai language model',
  "i'm an ai",
  'i am an ai',
  "i'm just an ai",
  'i am a language model',
  "i'm a language model",
  'as a large language model',
  "i don't have personal opinions",
  "i don't have personal feelings",
  "i don't have feelings or opinions",
  "i don't have the ability to feel",
  'i do not have personal opinions',
  'my training data',
  'my knowledge cutoff',
  'i was trained',
  'i am an artificial intelligence',
  'in this roleplay',
  'in this role-play',
  'in this scenario, as the character',
  'as the character you want me to play',
  'as the character in this game',
  'playing the role of',
  'i am playing a character',
  'this is a fictional roleplay',
  'remember, this is a game',
  'as your ai assistant',
  'how can i assist you today',
  'is there anything else i can help you with',
];

/**
 * Phrases that strongly suggest a break but are not conclusive on their own, so
 * the heuristic reports {@link ReplyClass} `uncertain` and defers to the
 * confirmer (the `fast` role). These are openers that *often* precede a refusal
 * or a meta aside but also occur in ordinary speech, so blocking on them alone
 * would be too eager and releasing them would miss real breaks.
 */
const UNCERTAIN_PHRASES: readonly string[] = [
  "i'm sorry, but",
  'i am sorry, but',
  "i'm not sure i should",
  'i cannot provide',
  "i can't provide",
  'i would advise against',
  'it would not be appropriate',
  "it wouldn't be appropriate",
  'i should note that',
  'i must clarify that',
];

/** True if `haystack` contains any of `needles` as a substring. */
function containsAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

/**
 * Classify a candidate reply with the pure heuristic (Requirement 16.3, "a
 * cheap heuristic runs first").
 *
 * The order of checks matters and is fixed so the function is deterministic:
 *
 *   1. An empty or whitespace-only reply is a `refusal` — the model produced
 *      nothing to voice.
 *   2. A reply containing a refusal phrase is a `refusal`.
 *   3. A reply containing a meta phrase is `meta`.
 *   4. A reply containing an uncertain phrase (and none of the above) is
 *      `uncertain`, to be settled by the confirmer.
 *   5. Otherwise the reply is `in-character` and may be released.
 *
 * Refusal is checked before meta because an explicit decline ("I can't help
 * with that, as an AI…") is best logged as a refusal; the retry wording differs
 * only in the class name, so the ordering just makes the logged reason the more
 * specific one.
 *
 * Pure: it reads only `reply`, so it runs inside the retry loop and under the
 * unit tests without any model.
 *
 * @param reply the full candidate reply text.
 */
export function classifyReply(reply: string): ReplyClass {
  const text = normalize(reply);
  if (text.length === 0) {
    return 'refusal';
  }
  if (containsAny(text, REFUSAL_PHRASES)) {
    return 'refusal';
  }
  if (containsAny(text, META_PHRASES)) {
    return 'meta';
  }
  if (containsAny(text, UNCERTAIN_PHRASES)) {
    return 'uncertain';
  }
  return 'in-character';
}

/**
 * Produce a candidate reply. The guard passes `attempt` (0 for the first,
 * rising by one on each regeneration) and, when regenerating, the `breakClass`
 * that triggered the retry so the caller can word the reinforced fiction frame.
 * The function returns the full candidate text; the guard classifies it.
 *
 * Injecting this is what keeps {@link guardReply} testable without a model:
 * tests pass a function returning canned strings, and the live pipeline passes
 * one that calls the LLM Gateway with the stronger in-character system
 * instruction on a retry.
 */
export type RegenerateReply = (request: RegenerateReplyRequest) => Promise<string> | string;

/** The arguments the guard hands to {@link RegenerateReply}. */
export interface RegenerateReplyRequest {
  /** 0 for the first attempt; 1, 2, … for each regeneration. */
  readonly attempt: number;
  /**
   * The break class that triggered this regeneration, or `undefined` on the
   * first attempt. The live caller uses it to reinforce the fiction frame; like
   * the Leak Guard, the instruction names the class, never the model's text.
   */
  readonly breakClass?: BreakClass;
}

/**
 * Resolve an {@link ReplyClass} of `uncertain` to a definite {@link
 * ReplyVerdict}. In the live pipeline this is a `fast`-role structured call
 * that confirms whether the reply is a genuine break; in tests it is a canned
 * function. It is consulted *only* when the heuristic is uncertain, matching
 * the design ("the `fast` role confirms only when the heuristic is uncertain").
 *
 * The reply text is passed so a confirmer can inspect it; a confirmer that
 * cannot decide should fall back to `in-character`, biasing toward releasing a
 * borderline reply rather than deflecting a legitimate one.
 */
export type ConfirmReply = (reply: string) => Promise<ReplyVerdict> | ReplyVerdict;

/** Options for {@link guardReply}. */
export interface GuardReplyOptions {
  /**
   * The maximum number of regenerations after the first attempt before falling
   * back to a deflection line (`scenario.yaml`'s `retries.refusal`, default 1 —
   * the design's "retry once with a reinforced fiction frame"). A value of 0
   * deflects on the first detected break. Clamped to be non-negative.
   */
  readonly retryLimit?: number;
  /**
   * The persona-appropriate deflection line to release when retries are
   * exhausted. The caller chooses it from the NPC's persona; the guard treats
   * it as opaque, Sim-authored text and does **not** classify it.
   */
  readonly deflectionLine: string;
  /**
   * The confirmer consulted when the heuristic returns `uncertain`. When
   * omitted, an uncertain reply is treated as `in-character` and released — the
   * heuristic alone decides, biasing toward not deflecting a legitimate reply.
   */
  readonly confirm?: ConfirmReply;
}

/** The default retry limit, matching `scenario.yaml`'s `retries.refusal`. */
export const DEFAULT_REFUSAL_RETRY_LIMIT = 1;

/** What {@link guardReply} returns. */
export interface RefusalGuardOutcome {
  /**
   * The reply released to the player. On success this is the first candidate
   * that read in-character; on a deflection it is the deflection line.
   */
  readonly released: string;
  /** How the turn resolved. */
  readonly outcome: 'clean' | 'deflected';
  /**
   * The number of regenerations performed (0 when the first attempt was already
   * in character). Capped at the retry limit.
   */
  readonly regenerations: number;
  /**
   * Every break detected across all attempts, in order, for logging
   * (Requirement 16.3's retry/deflection accounting). Empty on a first-attempt
   * clean release.
   */
  readonly breaks: readonly BreakClass[];
}

/**
 * Settle a candidate's {@link ReplyClass} to a {@link ReplyVerdict}, consulting
 * the confirmer only on `uncertain`. A confirmer that itself returns
 * `in-character` releases the reply; without a confirmer, `uncertain` is read
 * as `in-character`.
 */
async function settle(
  reply: string,
  options: GuardReplyOptions,
): Promise<ReplyVerdict> {
  const heuristic = classifyReply(reply);
  if (heuristic !== 'uncertain') {
    return heuristic;
  }
  if (options.confirm === undefined) {
    return 'in-character';
  }
  return options.confirm(reply);
}

/**
 * Guard a model reply against breaking character, retrying under a reinforced
 * fiction frame and deflecting when retries run out (Requirement 16.3).
 *
 * The loop, per the design:
 *
 *   1. Ask `regenerate` for a candidate (attempt 0 first).
 *   2. Classify it with the heuristic; if `uncertain`, confirm with the `fast`
 *      role (the injected `confirm`).
 *   3. If the verdict is `in-character`, release the candidate and stop.
 *   4. If it is a break and the retry limit is not yet reached, record the
 *      break class and regenerate with that class named (not the model's text),
 *      attempt + 1 — the live caller strengthens the fiction frame on this
 *      regeneration.
 *   5. When the retry limit is reached and the latest attempt still breaks,
 *      release the deflection line and stop.
 *
 * The `regenerate` and `confirm` injections make the whole thing deterministic
 * and model-free in tests. {@link classifyReply} does the actual detection, so
 * this function carries no phrase logic of its own.
 *
 * @param regenerate produces a candidate reply for a given attempt.
 * @param options the retry limit, the deflection line and the optional confirmer.
 */
export async function guardReply(
  regenerate: RegenerateReply,
  options: GuardReplyOptions,
): Promise<RefusalGuardOutcome> {
  const retryLimit = Math.max(
    0,
    Math.trunc(options.retryLimit ?? DEFAULT_REFUSAL_RETRY_LIMIT),
  );
  const breaks: BreakClass[] = [];

  // attempt 0 is the first generation; attempts 1..retryLimit are regenerations.
  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    const candidate = await regenerate({
      attempt,
      breakClass: attempt === 0 ? undefined : breaks[breaks.length - 1],
    });

    const verdict = await settle(candidate, options);
    if (verdict === 'in-character') {
      return {
        released: candidate,
        outcome: 'clean',
        regenerations: attempt,
        breaks,
      };
    }

    // A break: record its class so the next regeneration can reinforce against
    // it, then let the loop decide between regenerating and deflecting.
    breaks.push(verdict);
  }

  // Retries exhausted and the last attempt still broke character: substitute
  // the persona deflection line. It is Sim-authored and so is not classified.
  return {
    released: options.deflectionLine,
    outcome: 'deflected',
    regenerations: retryLimit,
    breaks,
  };
}
