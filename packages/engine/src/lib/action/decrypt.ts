/**
 * The decrypt action (slice-integration design, "Engine: actions" → `decrypt`;
 * slice-integration Requirements 8.1–8.6; completes slice Req 9.5).
 *
 * `{ kind:'decrypt'; intercept: InterceptId; submission: KeySubmission }`: from
 * the Workbench, the player submits a candidate key or plaintext for an
 * Intercept they have captured, and the Sim checks it against the Intercept's
 * ground truth with {@link verifySubmission} (`../cipher/verify.ts`).
 *
 * ## Quote (pure, no draws; Req 8.1, 8.2)
 *
 * The action is allowed when the player has collected the Intercept, that is,
 * when it is a key of `WorldState.intercepts`. It costs
 * {@link DECRYPT_PHASE_COST} phase and no money. Otherwise it is disallowed
 * with {@link DECRYPT_NOT_COLLECTED_REASON}. A broken Intercept still quotes
 * allowed, and resolving it again changes nothing (see below).
 *
 * Every Location allows Workbench work. It is desk work on a capture the
 * player already holds, so, like reading a Document in hand, `decrypt` has no
 * `actionLocation` and the shared Location gate in `./action.ts` never applies
 * to it. No core Location Type lists `decrypt` among its allowed actions, so
 * gating on the Location Type would make the action unreachable, contrary to
 * Req 8.1.
 *
 * ## Resolve (draws nothing; Req 8.3–8.6)
 *
 * - **Already broken** (`intercept.broken`): no verification runs. The state is
 *   unchanged and the result carries no Observations, only
 *   {@link DECRYPT_ALREADY_BROKEN_LINE}, so the Case File gains nothing
 *   (Req 8.6).
 * - **Correct submission** (`verifySubmission` returns `ok`): the Intercept is
 *   marked `broken: true`. The result carries one Proposition Observation per
 *   recovered Proposition, stamped with the current time and sourced
 *   `{ kind:'intercept', id }`, and `claimsAdded` names them, so the Turn
 *   Pipeline records each as an `intercept` Claim (Req 8.3, 8.4).
 * - **Wrong submission**: the state is unchanged and the result carries no
 *   Observations, only the fixed {@link DECRYPT_REJECTED_LINE}. The result
 *   depends only on the state, so every wrong submission against an Intercept
 *   gets the identical answer. A reject therefore reveals nothing about the key
 *   or the plaintext, and adds no Claim (Req 8.5).
 *
 * ## Key material
 *
 * Book ciphers key to a public text and one-time pads to a pad stream, so
 * verification needs a {@link CipherKeyLookup}. The resolver uses the Resolver
 * Context's `cipherKeys` when the caller supplies it (the Turn Pipeline's
 * Resolver Context projection does). Otherwise it falls back to the world's own
 * deterministic lookup, {@link worldCipherKeyLookup} over `meta.seed` and
 * `documents`, which is the lookup generation enciphered the seeded traffic
 * with. A world that cannot resolve its own Intercept's key is a generation or
 * save bug: `verifySubmission` throws on it rather than masking it, and this
 * resolver lets that surface.
 *
 * ## Purity and the Truth boundary
 *
 * Verification reads the Intercept's Truth-branded spec and source ids. Only
 * the Propositions a correct submission recovers leave this module; a reject
 * carries nothing about the answer. Both functions are pure and draw nothing.
 * Fact Line rendering is left to the caller's `render` callback, so this module
 * never imports `./action.ts` and no import cycle forms.
 */

import type { InterceptId, LocId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { Intercept } from '../cipher/intercept.js';
import type { CipherKeyLookup } from '../cipher/spec.js';
import { verifySubmission } from '../cipher/verify.js';
import { worldCipherKeyLookup } from '../cipher/world-intercepts.js';
import { npcsScheduledAt } from './surveil.js';
import type {
  ActionQuote,
  ActionResult,
  Observation,
  ResolverContext,
} from './result.js';
import type { DecryptAction, ObservationSource } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The phase cost of a decrypt attempt: a phase of work at the Workbench. */
export const DECRYPT_PHASE_COST = 1;

/** The reason a decrypt quote is disallowed: the Intercept is not in hand (Req 8.2). */
export const DECRYPT_NOT_COLLECTED_REASON =
  'you have not collected that intercept';

/** The Fact Line a decrypt of already-broken traffic plays (Req 8.6). */
export const DECRYPT_ALREADY_BROKEN_LINE =
  'You have already broken this traffic.';

/**
 * The Fact Line every wrong submission plays (Req 8.5). It is fixed, so it says
 * nothing about how close the submission came.
 */
export const DECRYPT_REJECTED_LINE = 'The key does not produce readable text.';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * The Intercept the player has collected under `id`, or `undefined` when they
 * have not. Only an own key of `WorldState.intercepts` counts, so an id that
 * happens to name an `Object.prototype` member is never mistaken for a capture.
 */
function collectedIntercept(
  state: WorldState,
  id: InterceptId,
): Intercept | undefined {
  return Object.hasOwn(state.intercepts, id) ? state.intercepts[id] : undefined;
}

/**
 * The key material to verify against: the Resolver Context's `cipherKeys`
 * when supplied, else the world's own deterministic lookup.
 */
function keyLookupFor(
  state: WorldState,
  ctx: ResolverContext,
): CipherKeyLookup {
  return (
    ctx.cipherKeys ?? worldCipherKeyLookup(state.meta.seed, state.documents)
  );
}

/**
 * The scene descriptor at a Location, with the NPCs scheduled there now. Built
 * here rather than with `./action.ts`'s `sceneAt`, which would form an import
 * cycle (`./action.ts` routes the action to this module).
 */
function sceneDescriptorAt(
  state: WorldState,
  loc: LocId,
): ActionResult['scene'] {
  const place = state.city.locations[loc];
  if (place === undefined) {
    return { loc, description: '', atmosphere: [], risk: 0, visible: [] };
  }
  return {
    loc,
    description: place.description,
    atmosphere: [...place.atmosphere],
    risk: place.risk,
    visible: npcsScheduledAt(state, loc),
  };
}

/**
 * A result that changes nothing: no Observations, no Claims, no events, and
 * the given fixed Fact Lines, at the player's current Location.
 */
function unchangedResult(
  state: WorldState,
  factLines: readonly string[],
): ActionResult {
  return {
    observations: [],
    factLines: [...factLines],
    scene: sceneDescriptorAt(state, state.player.loc),
    events: [],
    claimsAdded: [],
  };
}

// ---------------------------------------------------------------------------
// Quote (Req 8.1, 8.2)
// ---------------------------------------------------------------------------

/**
 * Quote a {@link DecryptAction} (pure, no draws). Allowed at
 * {@link DECRYPT_PHASE_COST} phase and no money when the player has collected
 * the Intercept (it is in `WorldState.intercepts`), wherever they stand.
 * Otherwise disallowed with {@link DECRYPT_NOT_COLLECTED_REASON} at no cost.
 * The quote depends only on which Intercepts the player holds, never on the
 * submission or on ground truth.
 */
export function quoteDecrypt(state: WorldState, a: DecryptAction): ActionQuote {
  if (collectedIntercept(state, a.intercept) === undefined) {
    return {
      allowed: false,
      reason: DECRYPT_NOT_COLLECTED_REASON,
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: DECRYPT_PHASE_COST, money: 0 };
}

// ---------------------------------------------------------------------------
// Resolve (Req 8.3, 8.4, 8.5, 8.6)
// ---------------------------------------------------------------------------

/**
 * Resolve a {@link DecryptAction} (design `resolve`; draws nothing). The
 * caller (`resolve`) has confirmed the action is allowed.
 *
 * - A broken Intercept returns {@link DECRYPT_ALREADY_BROKEN_LINE} with no
 *   Observations and the state unchanged (Req 8.6).
 * - Otherwise the submission is checked with {@link verifySubmission} against
 *   the key material (`ctx.cipherKeys`, or the world's own lookup) and the
 *   content's predicate field codes (Req 8.3).
 * - On a correct submission the Intercept is marked `broken`, and each
 *   recovered Proposition becomes a Proposition Observation sourced
 *   `{ kind:'intercept', id }`, named in `claimsAdded` (Req 8.4).
 * - On a wrong submission the state is unchanged and the result is the fixed
 *   {@link DECRYPT_REJECTED_LINE} with no Observations (Req 8.5).
 *
 * `factLines` for the recovered Propositions are rendered by the caller's
 * `render`, against the next state.
 */
export function resolveDecrypt(
  state: WorldState,
  a: DecryptAction,
  ctx: ResolverContext,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): { next: WorldState; result: ActionResult } {
  const intercept = collectedIntercept(state, a.intercept);

  // A disallowed decrypt should have been rejected by `quote`; if the Intercept
  // is somehow not in hand, change nothing rather than throwing.
  if (intercept === undefined) {
    return { next: state, result: unchangedResult(state, []) };
  }

  // Already broken: the Case File already holds this traffic (Req 8.6).
  if (intercept.broken === true) {
    return {
      next: state,
      result: unchangedResult(state, [DECRYPT_ALREADY_BROKEN_LINE]),
    };
  }

  const verdict = verifySubmission(
    intercept,
    a.submission,
    keyLookupFor(state, ctx),
    ctx.content.predicates,
  );

  // Wrong: one fixed line that depends on nothing but the state (Req 8.5).
  if (!verdict.ok) {
    return {
      next: state,
      result: unchangedResult(state, [DECRYPT_REJECTED_LINE]),
    };
  }

  // Correct: mark the traffic broken and report what it says (Req 8.4).
  const next: WorldState = {
    ...state,
    intercepts: {
      ...state.intercepts,
      [a.intercept]: { ...intercept, broken: true },
    },
  };
  const source: ObservationSource = {
    kind: 'intercept',
    id: a.intercept,
    channel: intercept.channel,
  };
  const observations: Observation[] = verdict.propositions.map(
    (prop): Observation => ({
      kind: 'proposition',
      prop,
      at: state.time,
      source,
    }),
  );
  return {
    next,
    result: {
      observations,
      factLines: render(next, observations),
      scene: sceneDescriptorAt(next, next.player.loc),
      events: [],
      claimsAdded: verdict.propositions.map((prop) => prop.id),
    },
  };
}
