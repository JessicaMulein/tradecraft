/**
 * Adding an Asset's reported Propositions to the Case File as Claims sourced
 * `npc` (slice-integration task 7.2; Requirement 10.3).
 *
 * When the player tasks a recruited Asset to `collect`, the engine's `resolve`
 * reports the Propositions the Asset gathered, each carried as a `proposition`
 * Observation with an `{ kind: 'npc', npc }` source naming the reporting Asset.
 * Those cross into the Player View, where this module records one Case File
 * {@link Claim} per Proposition with source `{ kind: 'npc', npc }`.
 *
 * It is the NPC-sourced sibling of {@link import('./document-claims.js')},
 * {@link import('./surveillance-claims.js')} and
 * {@link import('./intercept-claims.js')}: the three existing add-claim helpers
 * each file one kind of Observation; this one files the fourth, an NPC report.
 * The Claim Extractor (dialogue, task 11.3) also files `npc` Claims from what a
 * person said in conversation; it does so directly through the Case File's own
 * `add`. This helper serves the action path — an Asset's `collect` task — so the
 * claim recorder (`api/claim-recorder.ts`) routes every source kind through a
 * matching module.
 *
 * ## Truth boundary
 *
 * This module never reads ground truth. An Asset's report is a lead the player
 * must corroborate, not a fact — the engine decided what the Asset could reach;
 * here we consume only the already-reported Propositions. The only engine
 * import is the shared shape vocabulary ({@link Proposition}, {@link NpcId},
 * {@link GameTime}), exactly as the Case File module itself does — the Player
 * View still never sees a Truth-branded value (Requirement 2.1).
 *
 * ## Idempotence
 *
 * The {@link CaseFile} mints a fresh Claim id for every `add`, so this records
 * whatever Propositions it is handed; it adds no dedupe of its own, matching the
 * other add-claim helpers. A caller that wants once-only semantics tracks what
 * it has already filed. (Two identical reports corroborate under Requirement
 * 7.4.)
 */

import type { GameTime, NpcId, Proposition } from '@tradecraft/engine';

import type { Claim, ClaimSource } from './casefile.js';
import { CaseFile } from './casefile.js';

/**
 * An Asset's report, as it crosses from the Sim into the Player View: the Asset
 * who reported, the Propositions they gathered (the engine's reported
 * Observations, resolved to full Propositions), and when they reported them
 * (the observation time stamped on the resulting Claims). This is the
 * Player-View-safe shape of the engine's `collect` task result — it carries
 * nothing Truth-branded.
 */
export interface NpcReport {
  /** The Asset who reported the Propositions. */
  readonly npc: NpcId;
  /** The Propositions the Asset gathered, in the order the engine reported them. */
  readonly propositions: readonly Proposition[];
  /** When the report happened, stamped on each resulting Claim as `observedAt`. */
  readonly observedAt: GameTime;
}

/**
 * The {@link ClaimSource} for an Asset report: `{ kind: 'npc', npc }`.
 */
export function npcSource(npc: NpcId): ClaimSource {
  return { kind: 'npc', npc };
}

/**
 * Add an Asset's reported Propositions to the Case File, one Claim per
 * Proposition, each sourced `{ kind: 'npc', npc }` and stamped with the report's
 * `observedAt` (Requirement 10.3). Returns the Claims created, in the order the
 * Propositions were given.
 *
 * Pure with respect to Truth — it reads only the already-reported result — but
 * it mutates the passed Case File, which is the point: the Asset's report
 * becomes part of the player's record. An empty Proposition list (an Asset who
 * reached nothing) adds nothing and returns an empty array.
 */
export function addNpcClaims(caseFile: CaseFile, report: NpcReport): Claim[] {
  const source = npcSource(report.npc);
  return report.propositions.map((prop) =>
    caseFile.add({ source, prop, observedAt: report.observedAt }),
  );
}
