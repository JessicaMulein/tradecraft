/**
 * Adding a read Document's asserted Propositions to the Case File as Claims
 * sourced `document` (task 9.2; Requirements 30.3, 30.4).
 *
 * When the player reads a Document for the first time, the engine's `resolve`
 * reports the Propositions the Document asserts (its `claimsAdded`, carried as
 * `proposition` Observations). Those cross into the Player View, where this
 * module records one Case File {@link Claim} per Proposition with source
 * `{ kind: 'document', id }`.
 *
 * ## Truth boundary
 *
 * This module never reads ground truth. A Document asserts Propositions that are
 * *not necessarily true* (a Dossier reports HQ false beliefs, a newspaper prints
 * rumours), so a document Claim is a lead the player must corroborate, never a
 * fact. The only engine import is the shared shape vocabulary
 * ({@link Proposition}, {@link DocId}, {@link GameTime}), exactly as the Case
 * File module itself does — the Player View still never sees a Truth-branded
 * value (Requirement 2.1).
 *
 * ## Idempotence
 *
 * The engine tracks which Documents the player has read (in
 * `player.readDocuments`) and only reports a Document's Propositions on the
 * *first* read (Requirement 30.4, Property 22); on a repeat read it reports no
 * `claimsAdded`. This helper simply records whatever Propositions it is handed,
 * so a caller that drives it from the engine's first-read result gets Property
 * 22 for free. (The Case File's own `add` mints a fresh Claim id per call and
 * does not dedupe, mirroring {@link import('./intercept-claims.js')}.)
 */

import type { DocId, GameTime, Proposition } from '@tradecraft/engine';

import type { Claim, ClaimSource } from './casefile.js';
import { CaseFile } from './casefile.js';

/**
 * A first read of a Document, as it crosses from the Sim into the Player View:
 * the id of the Document, the Propositions it asserted (the engine's
 * `claimsAdded`, resolved to full Propositions), and when the player read it
 * (the observation time stamped on the resulting Claims). This is the
 * Player-View-safe shape of the engine's read result — it carries nothing
 * Truth-branded.
 */
export interface DocumentRead {
  /** The Document the player read. */
  readonly docId: DocId;
  /** The Propositions the Document asserted, in the Document's `asserts` order. */
  readonly propositions: readonly Proposition[];
  /** When the read happened, stamped on each resulting Claim as `observedAt`. */
  readonly observedAt: GameTime;
}

/**
 * The {@link ClaimSource} for a read Document: `{ kind: 'document', id }`.
 */
export function documentSource(id: DocId): ClaimSource {
  return { kind: 'document', id };
}

/**
 * Add a read Document's asserted Propositions to the Case File, one Claim per
 * Proposition, each sourced `{ kind: 'document', docId }` and stamped with the
 * read's `observedAt` (Requirements 30.3, 30.4). Returns the Claims created, in
 * the order the Propositions were given.
 *
 * Pure with respect to Truth — it reads only the already-reported result — but
 * it does mutate the passed Case File, which is the point: the Document's
 * assertions become part of the player's record. An empty Proposition list
 * (a Document that asserts nothing, or a repeat read) adds nothing and returns
 * an empty array.
 */
export function addDocumentClaims(caseFile: CaseFile, read: DocumentRead): Claim[] {
  const source = documentSource(read.docId);
  return read.propositions.map((prop) =>
    caseFile.add({ source, prop, observedAt: read.observedAt }),
  );
}
