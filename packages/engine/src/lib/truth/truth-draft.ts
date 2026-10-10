/**
 * The Truth Draft (`engine/truth`): one Turn Transaction's Truth Store writes,
 * staged until the turn commits.
 *
 * The Truth Store is mutable and lives outside the World State, so the Draft a
 * turn builds cannot carry its writes, and a resolver that wrote to the store
 * directly would leave the write behind if the turn later failed. The design
 * stages those writes in a {@link TruthDraft} and applies them at commit
 * (design, "Key decisions": Truth Store writes). The Turn Pipeline opens one
 * over the store at the start of a turn with {@link TruthDraft.over} and hands
 * it to the resolvers, hooks and extraction in the store's place:
 *
 * - Every write is **staged** on the draft and the store is not touched: facts,
 *   Claim-truth records and identity mappings, plus the allegiance write the
 *   `turn-agent` resolver makes.
 * - Every read answers from the store with the staged writes applied, exactly
 *   as the store will answer once they are committed (read-your-writes). A
 *   resolver that maps `unk:3` to an NPC sees the mapping in `identityOf` and
 *   in `holds` straight away, and `facts()` lists staged facts after the
 *   store's own, in the order the commit will append them.
 * - {@link TruthDraft.commit} applies every staged write to the store in one
 *   store transaction, so the store changes only at commit (Requirement 5.3).
 * - {@link TruthDraft.discard} drops the staged writes. A turn that fails
 *   before commit discards the draft with the rest of its Draft, and the store
 *   is left exactly as it was (Requirement 5.4). Dropping an uncommitted draft
 *   has the same effect, since nothing reaches the store before commit.
 *
 * Reads are live: the draft keeps no copy of the store, so it always answers
 * from the store's current contents plus its own staged writes.
 *
 * A draft is single-use. Once committed or discarded it is closed: a further
 * write or commit throws, so a stale draft cannot silently swallow a write
 * meant for a later turn. Reads stay available on a closed draft and answer
 * from the store alone.
 */

import {
  asTruth,
  type EntityId,
  type GameTime,
  type NpcId,
  type Proposition,
  type Truth,
  type UnkId,
} from '../model/core.js';
import type { StreetOpsTruth } from '../street-ops/state.js';
import {
  holdsIn,
  type Allegiance,
  type ClaimTruthRecord,
  type HoldsSource,
  type TruthAccess,
  type TruthStore,
  type TruthTransaction,
} from './truth.js';

/**
 * The writes a draft has staged. Facts and Claim-truths keep the order they
 * were made in; a repeated identity or allegiance write replaces the earlier
 * value, exactly as it would in the store.
 */
interface StagedWrites {
  readonly facts: Proposition[];
  readonly claimTruths: ClaimTruthRecord[];
  readonly identities: Map<UnkId, NpcId>;
  readonly allegiances: Map<NpcId, Allegiance>;
}

/** An empty set of staged writes. */
function noWrites(): StagedWrites {
  return {
    facts: [],
    claimTruths: [],
    identities: new Map(),
    allegiances: new Map(),
  };
}

/** A transaction handle that records each write into `into`. */
function stagingHandle(into: StagedWrites): TruthTransaction {
  return {
    addFact(fact) {
      into.facts.push(fact);
    },
    recordClaimTruth(record) {
      into.claimTruths.push(record);
    },
    setIdentity(unk, npc) {
      into.identities.set(unk, npc);
    },
    setAllegiance(npc, allegiance) {
      into.allegiances.set(npc, allegiance);
    },
  };
}

/** Replay `writes` onto `tx`, each collection in its staged order. */
function replay(writes: StagedWrites, tx: TruthTransaction): void {
  for (const fact of writes.facts) {
    tx.addFact(fact);
  }
  for (const record of writes.claimTruths) {
    tx.recordClaimTruth(record);
  }
  for (const [unk, npc] of writes.identities) {
    tx.setIdentity(unk, npc);
  }
  for (const [npc, allegiance] of writes.allegiances) {
    tx.setAllegiance(npc, allegiance);
  }
}

/**
 * A Truth Store's writes for one turn, staged behind the store's read
 * interface (design, "Turn Transaction": `truthDraft = TruthDraft.over(…)`,
 * then `truthDraft.commit()` at commit). It implements {@link TruthAccess}, so
 * it goes wherever the store does: `ResolverContext.truth`, the hooks and the
 * extraction boundary.
 */
export class TruthDraft implements TruthAccess {
  /** The store the draft reads through and commits to. */
  private readonly store: TruthStore;
  /** The writes made since the draft was opened. */
  private staged: StagedWrites = noWrites();
  /** Street-ops truth staged until commit. Absent means "leave the store's". */
  private stagedStreet: StreetOpsTruth | undefined;
  /** `open` until the draft is committed or discarded. */
  private status: 'open' | 'committed' | 'discarded' = 'open';

  private constructor(store: TruthStore) {
    this.store = store;
  }

  /**
   * Open an empty draft over `store`. Nothing reaches the store until
   * {@link commit}.
   */
  static over(store: TruthStore): TruthDraft {
    return new TruthDraft(store);
  }

  // -- reads ----------------------------------------------------------------

  /** The store's facts, then the staged ones, each branded. A fresh copy. */
  facts(): ReadonlyArray<Truth<Proposition>> {
    const committed = this.store.facts();
    if (this.staged.facts.length === 0) {
      return committed;
    }
    return [...committed, ...this.staged.facts.map((fact) => asTruth(fact))];
  }

  /**
   * Does `p` hold at `at` once the staged writes are applied? Staged facts and
   * identities change the answer; with neither staged, the store answers
   * directly. Either way the store's own dispatch decides.
   */
  holds(p: Proposition, at: GameTime): boolean {
    if (this.staged.facts.length === 0 && this.staged.identities.size === 0) {
      return this.store.holds(p, at);
    }
    return holdsIn(this.holdsSource(), p, at);
  }

  /** The staged allegiance for `npc`, else the store's. */
  allegiance(npc: NpcId): Truth<Allegiance> | undefined {
    const staged = this.staged.allegiances.get(npc);
    return staged === undefined ? this.store.allegiance(npc) : asTruth(staged);
  }

  /** The staged identity for `unk`, else the store's. */
  identityOf(unk: UnkId): Truth<NpcId> | undefined {
    const staged = this.staged.identities.get(unk);
    return staged === undefined ? this.store.identityOf(unk) : asTruth(staged);
  }

  /** Origins are fixed at instantiation, so the draft reads the store's. */
  itemOrigin(item: EntityId): EntityId | undefined {
    return this.store.itemOrigin(item);
  }

  /** The store's Claim-truths, then the staged ones, each branded. A fresh copy. */
  claimTruths(): ReadonlyArray<Truth<ClaimTruthRecord>> {
    const committed = this.store.claimTruths();
    if (this.staged.claimTruths.length === 0) {
      return committed;
    }
    return [
      ...committed,
      ...this.staged.claimTruths.map((record) => asTruth(record)),
    ];
  }

  // -- writes (staged) ------------------------------------------------------

  /**
   * Run `work` atomically within the draft, with the same contract as
   * {@link TruthStore.transaction}: its writes are staged together only if it
   * returns, and dropped if it throws, leaving the draft's earlier writes as
   * they were. Throws if the draft is closed.
   */
  transaction<T>(work: (tx: TruthTransaction) => T): T {
    this.assertOpen('write to');
    const pending = noWrites();
    const result = work(stagingHandle(pending));
    // `work` may have closed the draft, and writes staged on a closed draft
    // would be silently lost.
    this.assertOpen('write to');
    replay(pending, stagingHandle(this.staged));
    return result;
  }

  /** Stage a true fact (a one-write transaction). */
  addFact(fact: Proposition): void {
    this.transaction((tx) => tx.addFact(fact));
  }

  /** Stage a Claim's truth evaluation (a one-write transaction). */
  recordClaimTruth(record: ClaimTruthRecord): void {
    this.transaction((tx) => tx.recordClaimTruth(record));
  }

  /** Stage an Unidentified Subject mapping (a one-write transaction). */
  setIdentity(unk: UnkId, npc: NpcId): void {
    this.transaction((tx) => tx.setIdentity(unk, npc));
  }

  /** Stage an NPC's true allegiance (a one-write transaction). */
  setAllegiance(npc: NpcId, allegiance: Allegiance): void {
    this.transaction((tx) => tx.setAllegiance(npc, allegiance));
  }

  /** The staged street slice, or the store's when this turn has not replaced it. */
  streetOps(): StreetOpsTruth | undefined {
    return this.stagedStreet ?? this.store.streetOps();
  }

  /** Stage a replacement street slice. The store changes at {@link commit}. */
  replaceStreetOps(next: StreetOpsTruth): void {
    this.assertOpen('write to');
    this.stagedStreet = next;
  }

  // -- lifecycle ------------------------------------------------------------

  /**
   * Apply every staged write to the store in one store transaction, then close
   * the draft (Requirement 5.3). The store ends up exactly as if each write had
   * been made on it directly, in order. Throws if the draft is already
   * committed or discarded.
   */
  commit(): void {
    this.assertOpen('commit');
    const staged = this.staged;
    const street = this.stagedStreet;
    this.store.transaction((tx) => replay(staged, tx));
    if (street !== undefined) this.store.replaceStreetOps(street);
    this.staged = noWrites();
    this.stagedStreet = undefined;
    this.status = 'committed';
  }

  /**
   * Drop every staged write and close the draft, leaving the store unchanged
   * (Requirement 5.4). Safe to call on a closed draft, where it does nothing:
   * a committed draft's writes have already landed.
   */
  discard(): void {
    if (this.status !== 'open') {
      return;
    }
    this.staged = noWrites();
    this.stagedStreet = undefined;
    this.status = 'discarded';
  }

  // -- internals ------------------------------------------------------------

  /** Throw unless the draft is still open. */
  private assertOpen(operation: string): void {
    if (this.status !== 'open') {
      throw new Error(`TruthDraft: cannot ${operation} a ${this.status} draft`);
    }
  }

  /**
   * The store's contents with the staged facts and identities laid on top: the
   * facts the commit will leave (the store's, then the staged ones), and the
   * identity mapping with a staged id taking precedence.
   */
  private holdsSource(): HoldsSource {
    const facts: readonly Proposition[] = [
      ...this.store.facts(),
      ...this.staged.facts,
    ];
    return {
      predicates: this.store.predicates,
      facts: () => facts,
      resolveUnk: (unk) => this.identityOf(unk),
      itemOrigin: (item) => this.itemOrigin(item),
    };
  }
}
