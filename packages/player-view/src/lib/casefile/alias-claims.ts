/**
 * Adding an identification's `IS_ALIAS_OF` Proposition to the Case File as a
 * Claim (task 11.2; Requirements 23.5, 7.4).
 *
 * When the player identifies an Unidentified Subject — a face-to-face
 * introduction, a Dossier photograph, or an Asset report naming them — the
 * engine's identification machinery (`identify`, in `@tradecraft/engine`)
 * records the `unk:`↔`npc:` mapping in the Truth Store and *reports* the
 * `IS_ALIAS_OF(unk:N, npc:X)` Claim the Player View should file. This module
 * takes that already-reported Claim and records it in the Case File, mirroring
 * the report-the-Claim-to-add pattern of the read (`addDocumentClaims`) and
 * Intercept (`addInterceptClaims`) helpers.
 *
 * Once the Claim is in the Case File, the People-view merge happens for free:
 * the Case File's own alias union-find ({@link import('./casefile.js').aliasResolver},
 * read by {@link import('./evidence.js').aliasClasses}) folds the `unk:` id and
 * the `npc:` id into one alias class off the held `IS_ALIAS_OF` Claim. This
 * module records the Claim; it does not reimplement the merge.
 *
 * ## Source choice (design: identification "emits an `IS_ALIAS_OF` Claim")
 *
 * The Claim's {@link ClaimSource} is picked to match the trigger that produced
 * the identification, because a source history should attribute the alias to
 * where the player learned it:
 *
 * - a **Dossier** photograph is a Document, so the Claim is sourced
 *   `{ kind: 'document', id }`;
 * - a **face-to-face introduction** and an **Asset report** come from a person,
 *   so the Claim is sourced `{ kind: 'npc', npc }` (the NPC who introduced
 *   themselves, or the Asset who named the subject).
 *
 * The engine hands over the trigger and the source id on the report, so this
 * module does not have to re-derive which it is.
 *
 * ## Truth boundary
 *
 * This module never reads ground truth. The reported Claim is a bare
 * {@link Proposition} with a view-safe source and observation time — no
 * Truth-branded value crosses — exactly as the Case File itself requires
 * (Requirement 2.1). The only engine import is the shared shape vocabulary.
 */

import type {
  AliasClaimReport,
  DocId,
  EntityId,
  NpcId,
} from '@tradecraft/engine';

import type { Claim, ClaimSource } from './casefile.js';
import { CaseFile } from './casefile.js';

/**
 * The {@link ClaimSource} an identification Claim carries, chosen from the
 * trigger and source id on an {@link AliasClaimReport}:
 *
 * - a `dossier` identification is sourced to the Document (`document`);
 * - an `introduction` or `asset-report` is sourced to the NPC (`npc`).
 */
export function aliasClaimSource(report: AliasClaimReport): ClaimSource {
  if (report.trigger === 'dossier') {
    return { kind: 'document', id: report.sourceId as DocId };
  }
  return { kind: 'npc', npc: report.sourceId as NpcId };
}

/**
 * Record an identification's `IS_ALIAS_OF(unk, npc)` Claim in the Case File
 * (Requirement 23.5), sourced to match the trigger ({@link aliasClaimSource})
 * and stamped with the report's `observedAt`. Returns the Claim created.
 *
 * Pure with respect to Truth — it reads only the already-reported Claim — but
 * it mutates the passed Case File, which is the point: the alias becomes part
 * of the player's record, and the People view's alias merge picks it up through
 * the Case File's own resolver. The Case File mints a fresh Claim id per call
 * and does not dedupe, so a second identification of the same subject (a second
 * Dossier, say) records a second corroborating alias Claim — matching the other
 * add-claim helpers.
 */
export function addAliasClaim(caseFile: CaseFile, report: AliasClaimReport): Claim {
  return caseFile.add({
    source: aliasClaimSource(report),
    prop: report.prop,
    observedAt: report.observedAt,
  });
}

/**
 * The entity ids an identification Claim links: its `unk:` subject and `npc:`
 * object. A small convenience for a caller that wants to confirm the alias
 * class after filing — the People view merges them via
 * {@link import('./evidence.js').aliasClasses}.
 */
export function aliasClaimLink(report: AliasClaimReport): readonly [EntityId, EntityId] {
  return [report.unk, report.npc];
}
