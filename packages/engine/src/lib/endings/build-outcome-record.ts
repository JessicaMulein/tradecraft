/**
 * The pure derivation of the Outcome Record from a finished game (design,
 * `buildOutcomeRecord`; Requirements 35.2, 35.3). Task 20.3.
 *
 * This module holds the behaviour that must import {@link WorldState} and the
 * {@link TruthStore}; the record's *shape* and *schema* live in the
 * dependency-light `./outcome-record.ts` leaf (which `../model/state.ts`
 * re-exports). Keeping the derivation here — a module `../model/state.ts` does
 * *not* re-export — is what lets the shape be re-exported from state.ts without
 * a cycle, mirroring the `docs/document.ts` (leaf) versus `docs/newspaper.ts`
 * (behaviour) split and the `end-conditions.ts` pattern beside it.
 *
 * {@link buildOutcomeRecord} is pure and deterministic: it reads the final state
 * and ground truth and returns a fresh, plain {@link OutcomeRecord} with no
 * {@link import('../model/core.js').Truth}-branded field surviving, no draws and
 * no mutation. Called once at game end; the result is validated against the
 * schema and written by {@link import('./outcome-store.js').writeOutcomeRecord}.
 * The derivation separation from the filesystem write is what lets task 20.5
 * (Property 26) pin the derivation with no `player-view` and no disk.
 *
 * ## Why engine-owned, raw inputs, no DebriefView
 *
 * The design places the Outcome Record in `engine/outcome` and gives
 * `buildOutcomeRecord` the final `WorldState`. It does **not** take the
 * player-view `DebriefView` (task 20.2): the engine depending on `player-view`
 * would invert the layer boundary. Mirroring the debrief's own derivations here
 * keeps the engine the owner of the persisted shape, and keeps the function pure
 * for the property test.
 */

import { revealTruth, type DeadDropId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { TruthStore } from '../truth/truth.js';
import { isAsset, type Relationship } from '../recruit/asset.js';
import type { Doctrine } from '../hostile/doctrine.js';
import { balance } from '../station/ledger.js';
import {
  OUTCOME_RECORD_SCHEMA_VERSION,
  dominantLever,
  type HostileMemory,
  type OutcomeCover,
  type OutcomeRecord,
  type OutcomeTag,
  type SurvivingAsset,
} from './outcome-record.js';

// ---------------------------------------------------------------------------
// buildOutcomeRecord (pure, deterministic; Req 35.2, 35.3)
// ---------------------------------------------------------------------------

/**
 * Derive the {@link OutcomeRecord} from a finished game (design,
 * `buildOutcomeRecord`; Req 35.2, 35.3). Pure and deterministic: same final
 * state and truth ⇒ an identical record; no draws, no mutation, no branded field
 * in the result.
 *
 * It must only be called on an ended world (the caller checks `state.ended`),
 * but it defends against a missing `ended` by falling back to the current time
 * and a `failure-plot` tag, so a mis-timed call cannot throw.
 *
 * The derivations mirror the debrief (task 20.2) where they overlap, so the two
 * agree:
 *
 * - **outcome** — the persisted tag from the end's outcome/cause
 *   ({@link outcomeTagOf});
 * - **metadata** — seed, generator version, Content Manifest and preset id read
 *   straight from `WorldState.meta` (the identifying key that reproduces/audits
 *   the game, Req 35.2);
 * - **standing / directives / budget** — read from the Station;
 * - **survivingAssets** — exactly the recruited NPCs whose relationship is an
 *   active Asset ({@link isAsset}), each snapshotted;
 * - **cover** — the Cover Identity id, the burned flag and the revealed Cover
 *   Suspicion;
 * - **hostileMemory** — the service's suspected Assets, compromised Channels and
 *   Drops, whether it knows the cover (the player was burned), and the doctrine
 *   drift from its initial draw.
 *
 * @param final the ended {@link WorldState}.
 * @param truth the ground-truth {@link TruthStore}.
 */
export function buildOutcomeRecord(
  final: WorldState,
  truth: TruthStore,
): OutcomeRecord {
  // `truth` is accepted so the derivation can read ground truth and so the
  // Property-26 test (task 20.5) threads the same store it uses to check
  // `survivingAssets`; the current derivation reads what it needs from the
  // revealed state fields (the MICE profile and the asset flags), so it is not
  // consulted further here.
  void truth;

  const endedAt = final.ended?.at ?? final.time;
  const base = {
    outcome: outcomeTagOf(final),
    endedAt,
    seed: final.meta.seed,
    generatorVersion: final.meta.generatorVersion,
    content: contentManifestOf(final),
    difficulty: presetIdOf(final),
    standing: final.station.standing,
    directives: final.station.directives.map((d) => ({
      id: d.id,
      status: d.status,
    })),
    survivingAssets: buildSurvivingAssets(final),
    cover: buildCover(final),
    hostileMemory: buildHostileMemory(final),
    budgetRemaining: balance(final.station.ledger),
  };
  if (final.plots !== undefined && final.meta.selection !== undefined) {
    return {
      ...base,
      schema: 2,
      plots: final.plots.map((plot) => ({
        templateId: plot.templateId,
        variantKey: plot.variantKey,
        archetype: plot.archetype,
        role: plot.role,
        outcome: plot.resolution?.result ?? 'unresolved',
      })),
      selection: { historyHash: final.meta.selection.historyHash },
    };
  }
  return { ...base, schema: OUTCOME_RECORD_SCHEMA_VERSION };
}

/**
 * Map the game's end to the persisted {@link OutcomeTag} (Req 35.2). A win is
 * `success`; a loss is `failure-burned` when the cause was the player being
 * burned, else `failure-plot` (the Plot ran its course, or any other loss). The
 * engine's internal end carries only a `success`/`failure` outcome plus a cause,
 * so the richer tag is derived from both.
 */
export function outcomeTagOf(final: WorldState): OutcomeTag {
  const ended = final.ended;
  if (ended === undefined) {
    return 'failure-plot';
  }
  if (ended.outcome === 'success') {
    return 'success';
  }
  return ended.cause === 'burned' ? 'failure-burned' : 'failure-plot';
}

/**
 * The Content Manifest from `WorldState.meta.content`. `state.ts` types that
 * field as the task-4.6 `Skeleton<'ContentManifest'>` placeholder (a phantom,
 * optional-only shape), while the record carries the concrete manifest from
 * `@tradecraft/content`; the generator stores the real manifest there (with the
 * same cast), so this reads it back out through the inverse cast. When task 2.4's
 * manifest replaces the skeleton alias in state.ts, both casts fall away.
 */
function contentManifestOf(final: WorldState): OutcomeRecord['content'] {
  return final.meta.content as unknown as OutcomeRecord['content'];
}

/** The Difficulty Preset id the game ran under (`WorldState.meta.preset.id`). */
function presetIdOf(final: WorldState): string {
  const preset = final.meta.preset as unknown as { readonly id?: unknown };
  return typeof preset?.id === 'string' ? preset.id : '';
}

/**
 * Build the surviving-Asset list: exactly the recruited NPCs whose relationship
 * is an active Asset (Property 26: "`survivingAssets` is exactly the set of
 * recruited NPCs whose status is active"). Listed in NPC id order so the record
 * is deterministic.
 */
function buildSurvivingAssets(final: WorldState): SurvivingAsset[] {
  const rels = Object.values(final.relationships).filter(
    (rel): rel is Relationship => rel !== undefined && isAsset(rel),
  );
  rels.sort((a, b) => compareIds(a.npc, b.npc));
  const out: SurvivingAsset[] = [];
  for (const rel of rels) {
    const snapshot = survivingAssetOf(final, rel);
    if (snapshot !== undefined) {
      out.push(snapshot);
    }
  }
  return out;
}

/**
 * Snapshot one active Asset's {@link Relationship} and {@link
 * import('../city/npc.js').Npc} into a {@link SurvivingAsset}. Returns
 * `undefined` when the NPC is unknown (a relationship with no NPC record — a
 * defensive guard; it never happens in a well-formed world). The `lever` is the
 * NPC's dominant hidden MICE lever (revealed now), and `doubled` is the Asset's
 * `hostileControlled` ground truth.
 */
function survivingAssetOf(
  final: WorldState,
  rel: Relationship,
): SurvivingAsset | undefined {
  const npc = final.npcs[rel.npc];
  if (npc === undefined) {
    return undefined;
  }
  const asset = rel.asset;
  const doubled =
    asset !== undefined && revealTruth(asset.hostileControlled) === true;
  return {
    npc: rel.npc,
    archetype: npc.archetype,
    persona: {
      name: npc.persona.name,
      culture: npc.persona.culture,
      background: npc.persona.background,
    },
    lever: dominantLever(revealTruth(npc.mice)),
    trust: rel.trust,
    exposure: rel.exposure,
    doubled,
  };
}

/**
 * Build the Cover status. `identity` is the Cover Identity content id, `blown`
 * is the player's burned flag, and `suspicion` is the revealed final Cover
 * Suspicion.
 */
function buildCover(final: WorldState): OutcomeCover {
  return {
    identity: final.player.cover.id,
    blown: final.player.burned,
    suspicion: revealTruth(final.player.coverSuspicion),
  };
}

/**
 * Build the Hostile Memory from the service's belief model and the player's
 * cover state (Req 35.2). `knownCover` is true when the player was burned (the
 * service blew, and so knows, the cover). `suspectedAssets` and
 * `compromisedChannels` come straight from the belief model; `compromisedDrops`
 * is read defensively (the belief model does not yet track compromised Drops as
 * a distinct set, so it defaults to empty). `doctrineShift` is the drift of the
 * live doctrine from its initial draw — empty when it never moved.
 */
function buildHostileMemory(final: WorldState): HostileMemory {
  const beliefs = final.hostile.beliefs;
  const suspectedAssets = [...beliefs.suspectedAssets].sort(compareIds);
  const compromisedChannels = [...beliefs.compromisedChannels].sort(compareIds);
  // The belief model (task 19) does not yet track compromised Dead Drops as a
  // distinct set; read it defensively so a later field flows through unchanged.
  const beliefsAny = beliefs as unknown as {
    readonly compromisedDrops?: readonly DeadDropId[];
  };
  const compromisedDrops = [...(beliefsAny.compromisedDrops ?? [])].sort(
    compareIds,
  );
  return {
    knownCover: final.player.burned,
    suspectedAssets,
    compromisedChannels,
    compromisedDrops,
    doctrineShift: doctrineDriftOf(final),
  };
}

/**
 * The doctrine drift: the dimensions of the live {@link Doctrine} that differ
 * from the preset's initial draw. The initial draw is not retained on the state
 * separately from the live doctrine in this slice, so this reads an optional
 * `WorldState.hostile.initialDoctrine` snapshot when a later task records one,
 * and returns an empty shift otherwise (the common case — the doctrine draw is
 * fixed, so no drift is recorded). Kept as its own helper so a later task that
 * tracks the initial draw only has to fill this in.
 */
function doctrineDriftOf(final: WorldState): Partial<Doctrine> {
  const hostileAny = final.hostile as unknown as {
    readonly initialDoctrine?: Doctrine;
  };
  const initial = hostileAny.initialDoctrine;
  if (initial === undefined) {
    return {};
  }
  const live = final.hostile.doctrine;
  const shift: {
    riskTolerance?: number;
    securityConsciousness?: number;
    deceptionAppetite?: number;
  } = {};
  if (live.riskTolerance !== initial.riskTolerance) {
    shift.riskTolerance = live.riskTolerance;
  }
  if (live.securityConsciousness !== initial.securityConsciousness) {
    shift.securityConsciousness = live.securityConsciousness;
  }
  if (live.deceptionAppetite !== initial.deceptionAppetite) {
    shift.deceptionAppetite = live.deceptionAppetite;
  }
  return shift;
}

/** A total, deterministic string ordering for ids. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
