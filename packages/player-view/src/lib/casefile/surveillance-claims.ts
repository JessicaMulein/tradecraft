/**
 * Adding a surveillance or follow's observed Propositions to the Case File as
 * Claims sourced `surveillance` (task 11.3; Requirements 23.3, 23.6, 23.7).
 *
 * When the player surveils a Location or follows a target, the engine's
 * `resolve` reports the Propositions it observed (its `claimsAdded`, carried as
 * `proposition` Observations — `LOCATED_AT` sightings and `MEETS_AT` contacts).
 * Those cross into the Player View, where this module records one Case File
 * {@link Claim} per Proposition with source `{ kind: 'surveillance', loc }`.
 *
 * The watched Location is the source: a surveillance source history groups every
 * sighting and contact the player observed at one place, mirroring how an NPC or
 * an Intercept groups its Claims. A Proposition may reference `unk:` ids (an
 * Unidentified Subject the player watched but has not named); the Case File
 * relates those to a named NPC only once it holds an `IS_ALIAS_OF` Claim, so no
 * special handling is needed here.
 *
 * ## Truth boundary
 *
 * This module never reads ground truth. A surveillance Observation is true at
 * its observed time (Requirement 23.3), but that truth lives in the engine; here
 * we consume only the already-reported Propositions. The only engine import is
 * the shared shape vocabulary ({@link Proposition}, {@link LocId},
 * {@link GameTime}), exactly as the Case File module itself does — the Player
 * View still never sees a Truth-branded value (Requirement 2.1).
 *
 * ## Idempotence
 *
 * The {@link CaseFile} mints a fresh Claim id for every `add`, so this records
 * whatever Propositions it is handed; it adds no dedupe of its own, matching the
 * read ({@link import('./document-claims.js')}) and Intercept
 * ({@link import('./intercept-claims.js')}) helpers. A caller that wants
 * once-only semantics for a repeated watch tracks which observations it has
 * already filed. (The engine's surveillance Propositions carry Location- and
 * time-stamped ids, so re-filing an identical sighting corroborates it under
 * Requirement 7.4.)
 */

import type { GameTime, LocId, Proposition } from '@tradecraft/engine';

import type { Claim, ClaimSource } from './casefile.js';
import { CaseFile } from './casefile.js';

/**
 * A surveillance or follow result, as it crosses from the Sim into the Player
 * View: the Location the player watched, the Propositions they observed (the
 * engine's `claimsAdded`, resolved to full Propositions), and when they observed
 * them (the observation time stamped on the resulting Claims). This is the
 * Player-View-safe shape of the engine's surveillance result — it carries
 * nothing Truth-branded.
 */
export interface SurveillanceResult {
  /** The Location the player surveilled (or where a follow began / observed). */
  readonly loc: LocId;
  /** The Propositions observed, in the order the engine reported them. */
  readonly propositions: readonly Proposition[];
  /** When the observation happened, stamped on each resulting Claim. */
  readonly observedAt: GameTime;
}

/**
 * The {@link ClaimSource} for a surveillance observation: `{ kind:
 * 'surveillance', loc }`.
 */
export function surveillanceSource(loc: LocId): ClaimSource {
  return { kind: 'surveillance', loc };
}

/**
 * Add a surveillance or follow's observed Propositions to the Case File, one
 * Claim per Proposition, each sourced `{ kind: 'surveillance', loc }` and
 * stamped with the result's `observedAt` (Requirement 23.3). Returns the Claims
 * created, in the order the Propositions were given.
 *
 * Pure with respect to Truth — it reads only the already-reported result — but
 * it mutates the passed Case File, which is the point: the sightings and
 * contacts become part of the player's record. An empty Proposition list (a
 * watch that observed nobody, or a follow that ended on a non-public Location)
 * adds nothing and returns an empty array.
 */
export function addSurveillanceClaims(
  caseFile: CaseFile,
  result: SurveillanceResult,
): Claim[] {
  const source = surveillanceSource(result.loc);
  return result.propositions.map((prop) =>
    caseFile.add({ source, prop, observedAt: result.observedAt }),
  );
}
