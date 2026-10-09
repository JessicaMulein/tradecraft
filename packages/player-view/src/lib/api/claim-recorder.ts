/**
 * The claim recorder (slice-integration task 7.2; Requirements 8.4, 10.3): the
 * one Turn Pipeline step that turns an action's Proposition Observations into
 * Case File Claims.
 *
 * `resolve` reports its perceptions as {@link Observation}s. A `proposition`
 * Observation carries the {@link Proposition} the player perceived, when they
 * perceived it (`at`), and an engine-side {@link ObservationSource} tagging
 * where it came from — a watched Location, a read Document, a broken Intercept,
 * or an Asset's report. The engine's `ObservationSource` (task 1.2) was defined
 * to mirror player-view's {@link ClaimSource} one to one, with the same kinds
 * and field names, so this recorder maps a source straight across and routes
 * each Observation through the matching Case File claim module:
 *
 * - `surveillance` → {@link addSurveillanceClaims}
 * - `document`     → {@link addDocumentClaims}
 * - `intercept`    → {@link addInterceptClaims} (Requirement 8.4)
 * - `npc`          → {@link addNpcClaims} (Requirement 10.3)
 *
 * This keeps the recorder a thin router: every source kind is filed exactly as
 * the hand-written surveil/read/decrypt/task paths already file it, so a source
 * history groups an action's Claims under the right source and the
 * corroboration relation (Requirement 7.4) is computed over them unchanged.
 *
 * ## Purity and the truth boundary
 *
 * The recorder reads no Truth Store. It takes only already-reported, Player-View
 * shapes — the Case File and the action's Observations — and the sole mutation
 * it makes is recording Claims through the Case File's own `add`. The only
 * engine import is the shared shape vocabulary and the `Observation` /
 * `ObservationSource` types, exactly as the Case File modules themselves import.
 * It returns the ids of the Claims it recorded, in the order the Observations
 * were given, so the Turn Pipeline can stage them (task 8.1/8.3).
 *
 * ## Idempotence
 *
 * The recorder adds no dedupe of its own; each module appends through the Case
 * File, which mints a fresh Claim id per `add`. The *actions* keep re-recording
 * harmless: `read` reports a Document's Propositions only on the first read, and
 * `decrypt` reports an Intercept's Propositions only on the first break (a
 * broken Intercept decrypted a second time yields no Proposition Observations),
 * so feeding this recorder a repeated action's result adds nothing the second
 * time. `message` Observations are not Propositions and so are never filed.
 */

import type { ClaimId, Observation } from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { addDocumentClaims } from '../casefile/document-claims.js';
import { addInterceptClaims } from '../casefile/intercept-claims.js';
import { addNpcClaims } from '../casefile/npc-claims.js';
import { addSurveillanceClaims } from '../casefile/surveillance-claims.js';

/**
 * Record every Proposition Observation in `observations` into `caseFile` as a
 * Case File Claim, routing each one through the module for its
 * {@link ObservationSource} kind. Returns the ids of the Claims recorded, in
 * the order the Observations were given.
 *
 * `message` Observations carry a ready-made Fact Line rather than a
 * Proposition, so they are skipped: only `proposition` Observations become
 * Claims. An empty list (or a list with no `proposition` Observations) records
 * nothing and returns an empty array.
 *
 * The function mutates `caseFile` — that is the point, the perceptions become
 * part of the player's record — but reads no Truth Store and consults nothing
 * but the Observations it is handed.
 */
export function recordObservationClaims(
  caseFile: CaseFile,
  observations: readonly Observation[],
): ClaimId[] {
  const ids: ClaimId[] = [];
  for (const observation of observations) {
    if (observation.kind !== 'proposition') {
      continue;
    }
    const { prop, at, source } = observation;
    switch (source.kind) {
      case 'surveillance': {
        const [claim] = addSurveillanceClaims(caseFile, {
          loc: source.loc,
          propositions: [prop],
          observedAt: at,
        });
        ids.push(claim.id);
        break;
      }
      case 'document': {
        const [claim] = addDocumentClaims(caseFile, {
          docId: source.id,
          propositions: [prop],
          observedAt: at,
        });
        ids.push(claim.id);
        break;
      }
      case 'intercept': {
        const [claim] = addInterceptClaims(caseFile, {
          interceptId: source.id,
          propositions: [prop],
          observedAt: at,
        });
        ids.push(claim.id);
        break;
      }
      case 'npc': {
        const [claim] = addNpcClaims(caseFile, {
          npc: source.npc,
          propositions: [prop],
          observedAt: at,
        });
        ids.push(claim.id);
        break;
      }
      case 'liaison': {
        const claim = caseFile.add({ source, prop, observedAt: at });
        ids.push(claim.id);
        break;
      }
      default: {
        // Every `ObservationSource` kind is handled above; this exhaustiveness
        // check turns a new, unhandled source kind into a compile error rather
        // than a silently dropped Claim.
        const _never: never = source;
        return _never;
      }
    }
  }
  return ids;
}
