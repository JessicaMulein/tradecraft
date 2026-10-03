/**
 * Unidentified Subjects and identification (design, "Unidentified Subjects";
 * Requirements 21.7, 23.4, 23.5).
 *
 * When an Observation, a visible-persons listing or a Fact Line would name an
 * NPC the player has **not** identified, the Sim does not reveal the NPC's name.
 * Instead it allocates — or reuses — a stable `unk:N` id for that NPC, records
 * `identityOf(unk) = npc` in the Truth Store, and shows the player the NPC's
 * physical descriptor keyed by `unk:N`. The player closes the gap by *learning*
 * the identity, through one of three triggers, each of which emits an
 * `IS_ALIAS_OF(unk:N, npc:X)` Claim the People view merges on.
 *
 * This module owns the engine-side machinery that makes that work:
 *
 * - **The allocator (`allocateUnk`, Req 21.7).** A deterministic `unk:` id per
 *   NPC. The allocation table lives on `WorldState.player.unkIds` (a
 *   `Record<NpcId, UnkId>`), so the *same* NPC always draws the *same* `unk:N`
 *   within a game, across every observation. Ids are handed out sequentially
 *   (`unk:1`, `unk:2`, …) in first-observation order. Allocation also records
 *   the ground-truth `identityOf(unk) = npc` mapping in the Truth Store (a
 *   Truth-Store write), so the Sim can resolve a Proposition stated about the
 *   `unk:` id back to the NPC it really is.
 *
 * - **The visible-persons listing (`visiblePersons`, Req 23.4).** Each NPC
 *   present at a Location is presented as *either* their known `npc:` id (if the
 *   player has identified them) *or* their allocated `unk:N` id (if not), so the
 *   Player View renders a descriptor for the unidentified ones. "Identified"
 *   means the id is in `player.known.entities`.
 *
 * - **The unk-aware namer (`identityAwareNamer`, Req 23.4).** A thin wrapper
 *   over the Player-View `playerNamer` that resolves an *unidentified* person
 *   (whether named by their raw `npc:` id or by their `unk:` id) to their
 *   descriptor summary, and an *identified* person to their name. The Action
 *   Resolver routes Fact Line rendering through this so an observed-but-
 *   unidentified person appears as their Unidentified Subject descriptor rather
 *   than leaking their name.
 *
 * - **Identification (`identify`, Req 23.5).** Given a `unk:`/`npc:` pair, it
 *   records the mapping (idempotently) and reports the `IS_ALIAS_OF(unk, npc)`
 *   Claim the Player-View Case File should add. The three identification
 *   triggers — a face-to-face introduction (the Dialogue Loop, task 11.4), a
 *   Dossier-with-photograph read, and an Asset report naming them — each call
 *   `identify` and hand its reported Claim to the Case File. This module owns
 *   the entry point; the triggers' own machinery lives in their tasks.
 *
 * ## Purity and the Truth boundary
 *
 * `allocateUnk` and `identify` are the two functions that touch state. Both are
 * explicit about it: they return the *next* `WorldState` (with the allocation
 * table extended) and write the identity mapping to the passed
 * {@link TruthAccess}: the Truth Store (the one place ground truth lives, Req
 * 2.1), or the turn's draft over it. They mint no randomness, so the
 * same inputs always yield the same `unk:` id and the same Claim. The namer and
 * the visible-persons listing are pure reads.
 *
 * The reported `IS_ALIAS_OF` Claim is a view-safe shape — a bare Proposition
 * plus a source and an observation time — so it crosses the boundary cleanly
 * (mirroring the read/intercept pattern: the engine reports the Claim to add;
 * the Player View records it).
 */

import {
  type EntityId,
  type GameTime,
  type NpcId,
  type Proposition,
  type UnkId,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { TruthAccess } from '../truth/truth.js';
import { playerNamer, type NamerContext } from '../docs/namer.js';
import type { Namer } from '@tradecraft/content';

// ---------------------------------------------------------------------------
// The IS_ALIAS_OF predicate and identification source/trigger
// ---------------------------------------------------------------------------

/**
 * The predicate an identification emits (design: identification "emits an
 * `IS_ALIAS_OF(unk:N, npc:X)` Claim"). The content pack namespaces predicates as
 * `<pack>/<name>`; the core pack defines `IS_ALIAS_OF`. The emitted Proposition
 * uses the bare local name, which the Case File's alias resolver matches
 * case-insensitively against `core/IS_ALIAS_OF` (`isAliasPredicate`), so the
 * People-view merge works whatever pack defines it.
 */
export const IS_ALIAS_OF_PREDICATE = 'IS_ALIAS_OF';

/**
 * The three ways a player identifies an Unidentified Subject (design, Req 23.5):
 *
 * - `introduction` — a face-to-face introduction, a talk where the NPC gives
 *   their name (the Dialogue Loop, task 11.4). The source is the NPC.
 * - `dossier` — a Dossier with a photograph is received and read; the Document
 *   names its subject. The source is the Document.
 * - `asset-report` — an Asset names the subject in a report. The source is the
 *   reporting Asset (an NPC).
 */
export const IDENTIFICATION_TRIGGERS = [
  'introduction',
  'dossier',
  'asset-report',
] as const;

/** One identification trigger. */
export type IdentificationTrigger = (typeof IDENTIFICATION_TRIGGERS)[number];

/**
 * A view-safe description of the `IS_ALIAS_OF` Claim an identification produces,
 * for the Player-View Case File to record. It carries no Truth-branded value: a
 * bare {@link Proposition} linking the `unk:` id to the `npc:` id, the entity
 * the Claim should be sourced from (an NPC for an introduction or an Asset
 * report, a Document for a Dossier photograph), and when the player learned it.
 *
 * The engine reports this; the Player View's `addAliasClaim` turns it into a
 * Case File Claim (mirroring the task-8.4/9.2 report-the-Claim-to-add pattern).
 */
export interface AliasClaimReport {
  /** The Unidentified Subject the player has now identified. */
  readonly unk: UnkId;
  /** The NPC it stands for. */
  readonly npc: NpcId;
  /** The `IS_ALIAS_OF(unk, npc)` Proposition the Case File should record. */
  readonly prop: Proposition;
  /** Which trigger produced the identification (for the Claim's source). */
  readonly trigger: IdentificationTrigger;
  /**
   * The source id the Claim should carry: the Document for a `dossier`, or the
   * NPC for an `introduction` / `asset-report`. The Player View maps this to a
   * `ClaimSource` (`document` or `npc`).
   */
  readonly sourceId: EntityId;
  /** When the player learned the identity, stamped on the Claim. */
  readonly observedAt: GameTime;
}

// ---------------------------------------------------------------------------
// The allocation table (Req 21.7)
// ---------------------------------------------------------------------------

/**
 * The player's `unk:` allocation table: the stable `unk:N` id each
 * not-yet-identified NPC has been assigned. Lives on
 * `WorldState.player.unkIds`. An NPC with no entry has never been observed
 * unidentified; once allocated, the entry persists so later observations reuse
 * the same id.
 */
export type UnkTable = Readonly<Record<NpcId, UnkId>>;

/** The `unk:` allocation table on a {@link WorldState}. */
export function unkTable(state: WorldState): UnkTable {
  return state.player.unkIds;
}

/** True when the player has identified an entity (it is in their known set). */
export function isIdentified(state: WorldState, id: NpcId): boolean {
  return state.player.known.entities.includes(id);
}

/**
 * The `unk:` id already allocated for an NPC, or `undefined` if none has been.
 * A pure read of the allocation table.
 */
export function allocatedUnk(state: WorldState, npc: NpcId): UnkId | undefined {
  return state.player.unkIds[npc];
}

/**
 * The next `unk:N` id to hand out, given the current table: one past the highest
 * integer local id in use, so ids are sequential and never reused. An empty
 * table starts at `unk:1`. Deterministic — a pure function of the table.
 */
export function nextUnkId(table: UnkTable): UnkId {
  let max = 0;
  for (const id of Object.values(table)) {
    const local = Number.parseInt(id.slice('unk:'.length), 10);
    if (Number.isFinite(local) && local > max) {
      max = local;
    }
  }
  return `unk:${max + 1}`;
}

// ---------------------------------------------------------------------------
// Allocation (Req 21.7)
// ---------------------------------------------------------------------------

/** The result of allocating (or reusing) a `unk:` id for an NPC. */
export interface AllocateResult {
  /** The `unk:` id for the NPC — freshly minted or reused. */
  readonly unk: UnkId;
  /** The next {@link WorldState}, with the allocation table extended if needed. */
  readonly next: WorldState;
}

/**
 * Allocate — or reuse — the stable `unk:N` id for an NPC the player has not
 * identified (Req 21.7), recording `identityOf(unk) = npc` in the Truth Store.
 *
 * If the NPC already has an entry in the allocation table, that same `unk:` id
 * is reused and the state is returned unchanged (`next === state`) — the mapping
 * is already recorded. Otherwise a fresh sequential id ({@link nextUnkId}) is
 * minted, written onto `player.unkIds`, and the `identityOf` mapping is recorded
 * in the Truth Store (a one-write transaction). Deterministic: the id depends
 * only on the current table, so the same NPC always draws the same id.
 *
 * This is the one place the `unk:`↔`npc:` mapping is created, so every observer
 * (a Fact Line, the visible-persons listing, a surveillance Observation) goes
 * through it to get a reused, stable id.
 */
export function allocateUnk(
  state: WorldState,
  truth: TruthAccess,
  npc: NpcId,
): AllocateResult {
  const existing = state.player.unkIds[npc];
  if (existing !== undefined) {
    // Already allocated; the identity mapping is already recorded. Reuse it.
    return { unk: existing, next: state };
  }

  const unk = nextUnkId(state.player.unkIds);
  truth.setIdentity(unk, npc);
  const next: WorldState = {
    ...state,
    player: {
      ...state.player,
      unkIds: { ...state.player.unkIds, [npc]: unk },
    },
  };
  return { unk, next };
}

// ---------------------------------------------------------------------------
// Visible persons (Req 23.4)
// ---------------------------------------------------------------------------

/**
 * The result of listing the persons present at a Location as the player sees
 * them: each present NPC rendered as either their known `npc:` id (identified)
 * or their `unk:N` id (unidentified), plus the next {@link WorldState} because
 * listing an unidentified person *allocates* their `unk:` id (Req 21.7, 23.4).
 */
export interface VisiblePersonsResult {
  /** Present persons as the player identifies them: a mix of `npc:` and `unk:`. */
  readonly visible: readonly EntityId[];
  /** The next state, with any newly-allocated `unk:` ids recorded. */
  readonly next: WorldState;
}

/**
 * Present each NPC in `present` as the player sees them (Req 23.4): an
 * identified NPC by their `npc:` id, an unidentified one by their allocated
 * `unk:N` id — allocating it (and recording the Truth-Store mapping) on first
 * sight. The input order is preserved, so a caller that passes a deterministically
 * ordered list (as `visibleNpcsAt` does) gets a deterministic result.
 *
 * This threads allocation through the whole list: each unidentified NPC extends
 * the table in turn, so two unidentified NPCs get distinct sequential ids and a
 * later call reuses them.
 */
export function visiblePersons(
  state: WorldState,
  truth: TruthAccess,
  present: readonly NpcId[],
): VisiblePersonsResult {
  const visible: EntityId[] = [];
  let next = state;
  for (const npc of present) {
    if (isIdentified(next, npc)) {
      visible.push(npc);
      continue;
    }
    const alloc = allocateUnk(next, truth, npc);
    next = alloc.next;
    visible.push(alloc.unk);
  }
  return { visible, next };
}

// ---------------------------------------------------------------------------
// The unk-aware namer (Req 23.4)
// ---------------------------------------------------------------------------

/**
 * The reads the identity-aware namer needs beyond a {@link NamerContext}: the
 * player's known-entity set (to decide identified vs. unidentified) and the
 * `unk:`↔`npc:` allocation table (to resolve a `unk:` id to the NPC whose
 * descriptor it should render). Both are view-safe Player-View data.
 */
export interface IdentityContext {
  /** Entities the player has identified (renders by name). */
  readonly known: readonly EntityId[];
  /** The `unk:` allocation table, so a `unk:` id resolves to its NPC. */
  readonly unkIds: UnkTable;
}

/** Build an {@link IdentityContext} from a {@link WorldState} (view-safe reads). */
export function identityContextOf(state: WorldState): IdentityContext {
  return { known: state.player.known.entities, unkIds: state.player.unkIds };
}

/** The reverse `unk: -> npc:` lookup over an allocation table. */
function npcForUnk(unk: UnkId, table: UnkTable): NpcId | undefined {
  for (const [npc, allocated] of Object.entries(table)) {
    if (allocated === unk) {
      return npc as NpcId;
    }
  }
  return undefined;
}

/**
 * The descriptor summary for an NPC, read from the view-safe
 * {@link NamerContext}, or `undefined` if the context holds no record. This is
 * the "Unidentified Subject descriptor" the design shows in place of a name.
 */
function descriptorOf(npc: NpcId, ctx: NamerContext): string | undefined {
  return ctx.npcs[npc]?.descriptor.summary;
}

/**
 * Build an identity-aware {@link Namer} (Req 23.4). It wraps the Player-View
 * {@link playerNamer} and overrides exactly the person-naming cases:
 *
 * - An `npc:` id the player has **not** identified renders as that NPC's
 *   descriptor summary (not their name).
 * - A `unk:` id renders as the descriptor of the NPC it was allocated for (or,
 *   if the id is unmapped, falls through to the base namer, which renders the
 *   bare `unk:N`).
 * - An identified `npc:` id, and every non-person value (a Location, an org, a
 *   date, a literal), render exactly as the base namer renders them.
 *
 * The wrapper reads only view-safe surface — the known set, the allocation
 * table and the descriptor summary — never a Truth field, so a rendered Fact
 * Line leaks no ground truth, and the existing `playerNamer` is left untouched.
 */
export function identityAwareNamer(
  namerCtx: NamerContext,
  identity: IdentityContext,
): Namer {
  const base = playerNamer(namerCtx);
  const knownSet = new Set<EntityId>(identity.known);
  return (value: unknown): string => {
    if (typeof value === 'string') {
      if (value.startsWith('npc:')) {
        if (!knownSet.has(value as EntityId)) {
          // Observed but not identified: show the descriptor, not the name.
          const summary = descriptorOf(value as NpcId, namerCtx);
          if (summary !== undefined) {
            return summary;
          }
        }
      } else if (value.startsWith('unk:')) {
        const npc = npcForUnk(value as UnkId, identity.unkIds);
        if (npc !== undefined) {
          const summary = descriptorOf(npc, namerCtx);
          if (summary !== undefined) {
            return summary;
          }
        }
      }
    }
    return base(value);
  };
}

// ---------------------------------------------------------------------------
// Identification -> IS_ALIAS_OF (Req 23.5)
// ---------------------------------------------------------------------------

/** The {@link PropId} an identification's `IS_ALIAS_OF` Proposition carries. */
export function aliasPropId(unk: UnkId, npc: NpcId): string {
  return `alias:${unk}->${npc}`;
}

/** The result of identifying an Unidentified Subject. */
export interface IdentifyResult {
  /** The `IS_ALIAS_OF` Claim the Player-View Case File should record. */
  readonly report: AliasClaimReport;
  /**
   * The next {@link WorldState}, with the identified NPC added to the player's
   * known set (so later listings name them rather than showing a descriptor).
   */
  readonly next: WorldState;
}

/**
 * Identify an Unidentified Subject (Req 23.5). The player has learned, through
 * one of the three triggers, that `unk` is really `npc`. This:
 *
 * 1. ensures the `unk:`↔`npc:` mapping is recorded (allocating the `unk:` id if
 *    the subject was never explicitly observed first — identification *is* an
 *    observation, so the mapping must exist);
 * 2. adds the NPC to the player's known set, so from now on the visible-persons
 *    listing and the namer render them by name, not a descriptor; and
 * 3. reports the `IS_ALIAS_OF(unk, npc)` Claim the Case File should add, sourced
 *    to match the trigger (a `dossier` is sourced to the Document, an
 *    `introduction` / `asset-report` to the NPC).
 *
 * Idempotent on the mapping and the known set: identifying an NPC already known
 * re-reports the Claim (so a second Dossier still corroborates) but changes the
 * known set only once. Pure beyond the Truth-Store write and the returned state:
 * it draws no randomness.
 *
 * A caller that already holds the subject's `unk:` id (surveillance, which
 * observed them first) passes it so the same id is reused; a caller that does
 * not (a Dossier naming an NPC the player never watched) omits it and lets
 * `identify` allocate.
 */
export function identify(
  state: WorldState,
  truth: TruthAccess,
  args: {
    readonly npc: NpcId;
    readonly trigger: IdentificationTrigger;
    readonly sourceId: EntityId;
    readonly observedAt: GameTime;
    /** The subject's `unk:` id, if the caller already holds one. */
    readonly unk?: UnkId;
  },
): IdentifyResult {
  // Ensure the subject has a `unk:` id and the identity mapping is recorded.
  let next = state;
  let unk: UnkId;
  if (args.unk !== undefined) {
    unk = args.unk;
    // Make sure the table and the Truth Store carry this mapping even when the
    // caller supplies the id (a surveillance id allocated earlier already will;
    // a caller minting one here needs it recorded).
    if (state.player.unkIds[args.npc] === undefined) {
      truth.setIdentity(unk, args.npc);
      next = {
        ...state,
        player: {
          ...state.player,
          unkIds: { ...state.player.unkIds, [args.npc]: unk },
        },
      };
    }
  } else {
    const alloc = allocateUnk(state, truth, args.npc);
    unk = alloc.unk;
    next = alloc.next;
  }

  // Add the NPC to the player's known set (identified from now on).
  if (!next.player.known.entities.includes(args.npc)) {
    next = {
      ...next,
      player: {
        ...next.player,
        known: {
          ...next.player.known,
          entities: [...next.player.known.entities, args.npc],
        },
      },
    };
  }

  const prop: Proposition = {
    id: aliasPropId(unk, args.npc),
    subject: unk,
    predicate: IS_ALIAS_OF_PREDICATE,
    object: args.npc,
  };

  const report: AliasClaimReport = {
    unk,
    npc: args.npc,
    prop,
    trigger: args.trigger,
    sourceId: args.sourceId,
    observedAt: args.observedAt,
  };

  return { report, next };
}
