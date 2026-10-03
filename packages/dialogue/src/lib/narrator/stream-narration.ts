/**
 * The narration streaming loop (task 15.3) — the step that turns a scene's
 * Fact Lines and the Narrator's streamed Flavour into what the player sees,
 * under the two guards and the Narrator's fallback contract.
 *
 * The design's narration flow is exact about the order of events:
 *
 *   - `resolve` produces the deterministic Fact Lines, and the UI prints them
 *     immediately, before any Narrator call starts, independent of model
 *     availability (Requirements 15.5, 20.1). This module encodes that by
 *     emitting the Fact Lines as the first thing it yields, and by never
 *     touching the stream source in `off` mode.
 *   - the Narrator then *streams*, and each Flavour sentence passes the Leak
 *     Guard against the player's known-entity set and then the Specifics Guard
 *     (Requirements 20.3, 20.4, 20.5).
 *   - on a rejection by either guard, the rest of that Flavour is discarded and
 *     the Narrator regenerates once with the violation class named; if that
 *     attempt also fails, the result is fact-only (Requirements 20.5, 16.5).
 *   - a Narrator failure or timeout leaves the already-committed Fact Lines
 *     intact and continues without pausing — fact-only, again (Req 16.5).
 *
 * The streaming is driven by an injected {@link StreamSource}: a function that,
 * given the attempt number and (on a regeneration) the violation class to
 * reinforce against, returns an `AsyncIterable<string>` of Flavour *tokens* —
 * exactly the shape the LLM Gateway's `stream('narrator', …)` /
 * `streamNarration(…)` produce. Injecting it keeps this loop model-free in
 * tests: a test passes a source yielding canned token chunks, and the live
 * pipeline passes one that calls the Gateway with the Narrator prompt. This
 * module owns no model, no clock and no I/O beyond draining the source it is
 * handed.
 *
 * The guards are the pure checks already built: {@link checkLeak}
 * (`../leak-guard`) and {@link checkSpecifics} (`../specifics-guard`). This loop
 * does the sentence splitting (reusing the Leak Guard's {@link splitSentences})
 * and the regenerate-once control flow; the guards decide each sentence.
 */

import { phaseName } from '@tradecraft/engine';

import {
  checkLeak,
  splitSentences,
  type LeakContext,
} from '../leak-guard/leak-guard.js';
import {
  checkSpecifics,
  type SpecificsContext,
  type ViolationClass as SpecificsViolationClass,
} from '../specifics-guard/specifics-guard.js';

/**
 * The narration mode, from `scenario.yaml`'s `narration: full | brief | off`.
 *
 *   - `full` streams the Narrator's Flavour (up to its own three-sentence cap).
 *   - `brief` caps released Flavour at a single sentence (the design's "`brief`
 *     caps Flavour at one sentence").
 *   - `off` skips the Narrator entirely: Fact Lines only, and no model call is
 *     ever made (the design's "`off` skips the Narrator"; Req 20.8).
 */
export type NarrationMode = 'full' | 'brief' | 'off';

/**
 * The class of guard violation that triggered a regeneration, used only to word
 * the stricter regenerate instruction without disclosing the offending token or
 * entity. `unknown-entity` is a Leak Guard trip; the remaining values are the
 * Specifics Guard's own {@link SpecificsViolationClass}.
 */
export type NarrationViolationClass = 'unknown-entity' | SpecificsViolationClass;

/** Why the stream was asked for again, carried to {@link StreamSource}. */
export interface StreamRequest {
  /** 0 for the first attempt; 1 for the single regeneration. */
  readonly attempt: number;
  /**
   * The violation class to reinforce against on the regeneration, or
   * `undefined` on the first attempt. Names the *class*, never the token or
   * entity, mirroring the Leak Guard's regenerate contract.
   */
  readonly violationClass?: NarrationViolationClass;
}

/**
 * The injected source of Narrator Flavour tokens. Given a {@link StreamRequest}
 * it returns an async iterable of token chunks (the Gateway's narrator stream).
 * It may throw or reject to signal a Narrator failure or timeout; the loop
 * treats that as fact-only (Req 16.5).
 *
 * The chunks are *tokens*, not sentences: the loop accumulates them and splits
 * on sentence boundaries itself, so a source may chunk however the model does.
 */
export type StreamSource = (
  request: StreamRequest,
) => AsyncIterable<string> | Promise<AsyncIterable<string>>;

/**
 * Everything the loop needs to gate and shape a narration. The guard contexts
 * are the same ones the pure checks take; `mode` chooses the behaviour; the
 * optional `maxSentences` caps how many sentences `full` mode will release
 * (the Narrator's three-sentence frame), defaulting to 3.
 */
export interface NarrationOptions {
  /** The narration mode from `scenario.yaml`. */
  readonly mode: NarrationMode;
  /** The Leak Guard context: the Entity Registry and the player's known set. */
  readonly leak: LeakContext;
  /** The Specifics Guard context: Fact Lines, descriptor text, phase, allowlist. */
  readonly specifics: SpecificsContext;
  /**
   * The maximum number of Flavour sentences `full` mode releases, matching the
   * Narrator frame's "at most three sentences". `brief` always caps at 1
   * regardless of this value. Clamped to be at least 1. Defaults to 3.
   */
  readonly maxSentences?: number;
}

/** How a narration resolved, for the caller and for metrics. */
export type NarrationStatus =
  /** Flavour was released cleanly (possibly after one regeneration). */
  | 'flavour'
  /** No Flavour: fact-only because a guard failed twice. */
  | 'fact-only'
  /** No Flavour: `off` mode, so the Narrator was never called. */
  | 'off'
  /** No Flavour: the stream source failed or timed out (Req 16.5). */
  | 'failed';

/**
 * The result of a narration. The Fact Lines are always present and always
 * first — they are what the UI prints immediately — and `flavour` holds the
 * clean sentences released after them, in order (empty whenever `status` is not
 * `flavour`).
 */
export interface NarrationResult {
  /** The deterministic Fact Lines, echoed back so the caller prints them first. */
  readonly factLines: readonly string[];
  /** The released Flavour sentences, in order. Empty unless `status` is `flavour`. */
  readonly flavour: readonly string[];
  /** How the narration resolved. */
  readonly status: NarrationStatus;
  /** The number of regenerations performed (0 or 1). */
  readonly regenerations: number;
}

/** The default sentence cap for `full` mode: the Narrator frame's three. */
export const DEFAULT_MAX_SENTENCES = 3;

/** The single regeneration the design allows: attempt 0, then attempt 1. */
const MAX_ATTEMPTS = 2;

/**
 * The outcome of gating one streamed attempt: the clean sentences released
 * before any rejection, and the violation class if a guard tripped.
 */
interface AttemptOutcome {
  readonly released: readonly string[];
  readonly violationClass?: NarrationViolationClass;
}

/** Drain a token stream fully into one string. */
async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const token of stream) {
    text += token;
  }
  return text;
}

/**
 * Gate the sentences of one attempt in reading order. Each sentence passes the
 * Leak Guard first, then the Specifics Guard; the first rejection stops the
 * walk and the rest of the Flavour is discarded (the design's "the rest of that
 * Flavour is discarded"). Returns the clean sentences released up to that point
 * and, on a rejection, the class to reinforce against on the regeneration.
 *
 * `cap` bounds how many sentences are released: once `cap` clean sentences have
 * passed, the rest are dropped silently — this is a release limit, not a
 * rejection, so it never triggers a regeneration.
 */
function gateAttempt(
  text: string,
  options: NarrationOptions,
  cap: number,
): AttemptOutcome {
  const released: string[] = [];

  for (const sentence of splitSentences(text)) {
    if (released.length >= cap) {
      break;
    }

    const leak = checkLeak(sentence, options.leak);
    if (!leak.ok) {
      return { released, violationClass: 'unknown-entity' };
    }

    const specifics = checkSpecifics(sentence, options.specifics);
    if (!specifics.ok) {
      // Report the first offending class; the regenerate instruction names the
      // class, never the token.
      return { released, violationClass: specifics.violations[0].class };
    }

    released.push(sentence);
  }

  return { released };
}

/**
 * Stream and gate a narration, returning the Fact Lines plus whatever Flavour
 * survives the guards.
 *
 * The control flow follows the design exactly:
 *
 *   1. In `off` mode, return the Fact Lines with no Flavour and never call the
 *      source (Req 20.8).
 *   2. Otherwise, ask the source for attempt 0, drain it, split it, and gate
 *      each sentence (Leak Guard then Specifics Guard), releasing clean
 *      sentences up to the cap (3 for `full`, 1 for `brief`).
 *   3. If every gated sentence was clean, the narration is Flavour: done.
 *   4. If a guard tripped, discard this attempt's Flavour and regenerate once,
 *      naming the violation class. Gate the regeneration the same way.
 *   5. If the regeneration is clean, release it; if it trips again, go
 *      fact-only (Req 20.5).
 *   6. If the source throws or rejects at any point — a Narrator failure or
 *      timeout — the Fact Lines stand and the result is fact-only, status
 *      `failed`, with no pause (Req 16.5).
 *
 * The Fact Lines are copied into the result so the caller can print them first
 * even on the fact-only paths. Released Flavour is returned for display only;
 * this module never feeds it to the extractor, Case File or Journal
 * (Requirement 20.6 is a property of the pipeline, upheld here by returning
 * Flavour as a plainly separate field the fact log never reads).
 *
 * @param factLines the deterministic Fact Lines `resolve` produced.
 * @param source the injected Narrator token stream (the Gateway in production).
 * @param options the mode and the two guard contexts.
 */
export async function streamNarration(
  factLines: readonly string[],
  source: StreamSource,
  options: NarrationOptions,
): Promise<NarrationResult> {
  const facts = [...factLines];

  // Mode `off`: Fact Lines only, no model call (Req 20.8).
  if (options.mode === 'off') {
    return { factLines: facts, flavour: [], status: 'off', regenerations: 0 };
  }

  const cap =
    options.mode === 'brief'
      ? 1
      : Math.max(1, Math.trunc(options.maxSentences ?? DEFAULT_MAX_SENTENCES));

  try {
    let lastClass: NarrationViolationClass | undefined;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const stream = await source({
        attempt,
        violationClass: attempt === 0 ? undefined : lastClass,
      });
      const text = await collect(stream);
      const outcome = gateAttempt(text, options, cap);

      if (outcome.violationClass === undefined) {
        // Every released sentence passed both guards.
        return {
          factLines: facts,
          flavour: outcome.released,
          status: 'flavour',
          regenerations: attempt,
        };
      }

      // A guard tripped: discard this attempt's Flavour and, if a regeneration
      // remains, go round again naming the class.
      lastClass = outcome.violationClass;
    }

    // Both attempts tripped a guard: fact-only (Req 20.5).
    return {
      factLines: facts,
      flavour: [],
      status: 'fact-only',
      regenerations: MAX_ATTEMPTS - 1,
    };
  } catch {
    // A Narrator failure or timeout: Fact Lines stand, no pause (Req 16.5). The
    // error is swallowed deliberately — the caller's commit is already intact
    // and the game continues fact-only.
    return {
      factLines: facts,
      flavour: [],
      status: 'failed',
      regenerations: 0,
    };
  }
}

/**
 * Map a scene's phase ordinal to the Specifics Guard's phase name.
 *
 * The Specifics Guard needs the scene's actual time-of-day as one of
 * `morning | afternoon | evening | night` so it can reject a Flavour sentence
 * that names a *contradicting* phase. The engine stores the phase as an ordinal
 * on `GameTime`; this helper bridges the two using the engine's own
 * {@link phaseName}, so callers building a {@link SpecificsContext} from a scene
 * do not duplicate the mapping. It is re-exported from the narrator so the
 * assembly site has one place to reach for it.
 */
export function specificsPhaseFromOrdinal(
  phase: Parameters<typeof phaseName>[0],
): SpecificsContext['phase'] {
  return phaseName(phase);
}
