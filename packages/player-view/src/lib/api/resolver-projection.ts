/**
 * The per-turn Resolver Context projection (slice-integration task 7.3; design,
 * "Turn Pipeline" step 4; Requirements 5.3, 6.2).
 *
 * The engine's pure `resolve`/`quote` read a {@link ResolverContext}: the loaded
 * content, and — for the actions that touch truth, the Case File or the cipher
 * material — a handful of per-turn projections the engine cannot compute for
 * itself because the data lives on the Player View. {@link projectResolverContext}
 * is that projection, factored out of `engine-api.ts` so the Turn Pipeline (task
 * 8.1) can rebuild the context against the turn's {@link TruthDraft} on every
 * turn, giving every resolver in the turn read-your-writes over the staged truth.
 *
 * It is a pure function of Player-View and Case File data (plus the Truth draft
 * it is *handed* — it never opens one itself), so it reveals no ground truth and
 * reads the Truth Store only through the draft the caller passes:
 *
 * - **`content`** — the loaded {@link ContentSet}, straight from the input.
 * - **`truth`** — the turn's {@link TruthDraft}, passed through so a fact staged
 *   earlier in the turn is visible to a later resolver's read (Requirement 5.3,
 *   5.4). The projection receives the draft; it does not create or commit it.
 * - **`claims`** — the held Case File Claims as a `Record<ClaimId, Proposition>`,
 *   the evidence `confront` and `feed` read by Claim id (design, "`confront`").
 * - **`arrestEvidence`** — the per-target corroborated Implicating-Claim count
 *   the arrest gate compares to the preset threshold, from {@link evidenceCount}
 *   (Requirement 6.2; the arrest-gate figure is pure Player-View data).
 * - **`turnEvidence`** — the same count plus whether a talk scene is open, keyed
 *   by NPC, for the `turn-agent` action's `evidence` leverage.
 * - **`cipherKeys`** — the world's deterministic cipher key lookup for `decrypt`,
 *   the same material the clock mints Intercepts with
 *   ({@link worldCipherKeyLookup} over `meta.seed` and `documents`).
 *
 * Nothing here mutates its inputs.
 */

import {
  worldCipherKeyLookup,
  type ClaimId,
  type EntityId,
  type NpcId,
  type Proposition,
  type ResolverContext,
  type TruthAccess,
  type UnkId,
  type WorldState,
  type ExtensionRegistry,
} from '@tradecraft/engine';
import type { ContentSet } from '@tradecraft/content';

import type { CaseFile } from '../casefile/casefile.js';
import {
  evidenceCount,
  type BriefView,
  type ImplicationRules,
} from '../casefile/evidence.js';

/**
 * The Player-View and Case File inputs {@link projectResolverContext} reads. The
 * shape is structural so the Turn Pipeline can hand it the pieces of its Session
 * (the world {@link WorldState}, the {@link CaseFile}, the {@link ContentSet},
 * the {@link BriefView} and the {@link ImplicationRules}) without this module
 * depending on the Session type.
 */
export interface ResolverProjectionInput {
  /** The pre-turn world state the resolver reads. */
  readonly state: WorldState;
  /** The player's Case File, for the held Claims and the arrest-evidence count. */
  readonly caseFile: CaseFile;
  /** The loaded content the resolver reads Location-Type and predicate data from. */
  readonly content: ContentSet;
  /** The Starting-Brief view the arrest-evidence count seeds its hostile marks from. */
  readonly brief: BriefView;
  /** The predicate implication rules the arrest-evidence count applies. */
  readonly rules: ImplicationRules;
  /** Present only when an add-on is enabled. */
  readonly extensions?: ExtensionRegistry;
}

/**
 * Build the engine {@link ResolverContext} for the current turn from Player-View
 * and Case File data plus the turn's Truth draft.
 *
 * `truth` is the draft the Turn Pipeline opened over the Session's Truth Store at
 * the start of the turn; this function only threads it onto the context, so a
 * resolver that stages a fact (an `unk:` identity, say) sees it through
 * `ctx.truth` for the rest of the turn (read-your-writes). The projection itself
 * reads no truth: `claims`, `arrestEvidence` and `turnEvidence` come from the
 * Case File alone, and `cipherKeys` is deterministic world key material.
 *
 * The facade's `quote`/`actions()` build the same projection with the Session's
 * own Truth Store (quotes never write), so the quote the player is shown agrees
 * with the quote the turn applies. A facade built without a Truth Store passes
 * `undefined`, and the context then carries no `truth`.
 */
export function projectResolverContext(
  input: ResolverProjectionInput,
  truth: TruthAccess | undefined,
): ResolverContext {
  const { state, caseFile, content, brief, rules, extensions } = input;

  // Held Case File Claims, as the bare Proposition each asserts, keyed by id —
  // what `confront`/`feed` read by Claim id.
  const claims: Record<ClaimId, Proposition> = {};
  for (const claim of caseFile.list()) {
    claims[claim.id] = claim.prop;
  }

  // The per-target arrest-evidence count and the per-NPC turn-agent evidence.
  // Compute over every entity the gate could name: every NPC in the world, plus
  // every entity (including `unk:` ids) that appears in a held Claim, so an
  // arrest of an Unidentified Subject is scored too. `evidenceCount` is
  // alias-stable, so a named entity and an `unk:` id aliased to it agree.
  const openScene = state.player.scene?.npc;
  const arrestEvidence: Record<NpcId | UnkId, number> = {};
  const turnEvidence: Record<
    NpcId,
    { readonly evidenceCount: number; readonly sceneOpen: boolean }
  > = {};

  for (const npc of Object.keys(state.npcs) as NpcId[]) {
    const count = evidenceCount(caseFile, npc, brief, rules);
    arrestEvidence[npc] = count;
    turnEvidence[npc] = { evidenceCount: count, sceneOpen: npc === openScene };
  }

  for (const id of claimArrestTargets(caseFile)) {
    if (id in arrestEvidence) {
      continue;
    }
    arrestEvidence[id] = evidenceCount(caseFile, id, brief, rules);
  }

  return {
    content,
    ...(truth !== undefined ? { truth } : {}),
    claims,
    arrestEvidence,
    turnEvidence,
    cipherKeys: worldCipherKeyLookup(state.meta.seed, state.documents),
    ...(extensions === undefined ? {} : { extensions }),
  };
}

/** True for an id that can be an arrest target: a named NPC or `unk:` subject. */
function isArrestTarget(id: EntityId): id is NpcId | UnkId {
  return id.startsWith('npc:') || id.startsWith('unk:');
}

/**
 * Every arrest-target id (a named NPC or an `unk:` Unidentified Subject) that
 * appears as the subject or an entity object of a held Claim, so the
 * arrest-evidence projection scores `unk:` ids and any NPC the Case File names,
 * not only the world's NPCs. Non-target ids (orgs, channels, items, documents,
 * locations) and literal objects (amounts, text, times) are skipped.
 */
function claimArrestTargets(caseFile: CaseFile): Set<NpcId | UnkId> {
  const ids = new Set<NpcId | UnkId>();
  for (const claim of caseFile.list()) {
    const { subject, object } = claim.prop;
    if (isArrestTarget(subject)) {
      ids.add(subject);
    }
    if (typeof object === 'string' && isArrestTarget(object)) {
      ids.add(object);
    }
  }
  return ids;
}
