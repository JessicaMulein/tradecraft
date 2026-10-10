/**
 * Adding a broken Intercept's recovered Propositions to the Case File as Claims
 * sourced `intercept` (task 8.4; Requirement 9.5).
 *
 * When the Sim verifies a player's decryption attempt against an Intercept (the
 * engine-side `verifySubmission`, which reads ground truth), a *correct* break
 * yields the recovered Propositions. Those — and only those — cross into the
 * Player View. This module takes that already-verified result and records one
 * Case File {@link Claim} per recovered Proposition, each with source
 * `{ kind: 'intercept', id }`.
 *
 * ## Truth boundary
 *
 * This module never reads ground truth. It does not import the engine's `Truth`
 * brand, never touches `intercept.spec` or `intercept.plaintextProps`, and does
 * not verify anything itself — verification is the Sim's job (it reads Truth);
 * here we consume its public result. The only engine import is the shared shape
 * vocabulary ({@link Proposition}, {@link InterceptId}, {@link GameTime}),
 * exactly as the Case File module itself does. So the Player View still never
 * sees a Truth-branded value (Requirement 2.1).
 *
 * ## Idempotence
 *
 * The {@link CaseFile} mints a fresh Claim id for every `add`, so calling this
 * twice for the same Intercept records the Propositions twice (two Claims per
 * Proposition, which then corroborate each other under Requirement 7.4). That
 * matches the Case File's own append semantics — this module adds no
 * dedupe of its own; a caller that wants once-only semantics tracks which
 * Intercepts it has already filed.
 */

import type { ChannelId, GameTime, InterceptId, Proposition } from '@tradecraft/engine';

import type { Claim, ClaimSource } from './casefile.js';
import { CaseFile } from './casefile.js';

/**
 * A successful Intercept verification, as it crosses from the Sim into the
 * Player View: the Propositions a correct key/plaintext recovered, the id of
 * the Intercept they came from, and when the player broke it (the observation
 * time stamped on the resulting Claims). This is the Player-View-safe shape of
 * the engine's accept result — it carries no spec, no plaintext and nothing
 * Truth-branded.
 */
export interface InterceptBreak {
  /** The Intercept the player decrypted. */
  readonly interceptId: InterceptId;
  /** The Propositions the correct submission recovered. */
  readonly propositions: readonly Proposition[];
  /** When the break happened, stamped on each resulting Claim as `observedAt`. */
  readonly observedAt: GameTime;
  /** The Channel the traffic rode. Messages on one Channel are one voice. */
  readonly channel?: ChannelId;
}

/**
 * The {@link ClaimSource} for an Intercept break: `{ kind: 'intercept', id }`.
 */
export function interceptSource(id: InterceptId, channel?: ChannelId): ClaimSource {
  return channel === undefined ? { kind: 'intercept', id } : { kind: 'intercept', id, channel };
}

/**
 * Add a verified Intercept break's Propositions to the Case File, one Claim
 * per Proposition, each sourced `{ kind: 'intercept', interceptId }` and stamped
 * with the break's `observedAt` (Requirement 9.5). Returns the Claims created,
 * in the order the Propositions were given.
 *
 * Pure with respect to Truth — it reads only the already-verified result — but
 * it does mutate the passed Case File, which is the point: the recovered
 * Propositions become part of the player's record. An empty Proposition list
 * adds nothing and returns an empty array.
 */
export function addInterceptClaims(
  caseFile: CaseFile,
  broken: InterceptBreak,
): Claim[] {
  const source = interceptSource(broken.interceptId, broken.channel);
  return broken.propositions.map((prop) =>
    caseFile.add({ source, prop, observedAt: broken.observedAt }),
  );
}
