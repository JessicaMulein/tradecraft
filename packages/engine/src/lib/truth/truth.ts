/**
 * The Truth Store (`engine/truth`).
 *
 * This is where the game's hidden ground truth lives (Requirement 2.1): the set
 * of true {@link Proposition}s, each NPC's real {@link Allegiance}, the mapping
 * from an Unidentified Subject id to the NPC it stands for, and the truth record
 * of every Claim a model has produced. The store is reachable only by engine
 * modules; it is deliberately never projected into the Player View, and the
 * values it hands back are branded {@link Truth} so the type system refuses to
 * let one slip into a view (see `model/core.ts`).
 *
 * The one interesting operation is {@link TruthStore.holds}: given a Proposition
 * and a time, does it hold? A predicate's *meaning* is data — the content pack
 * says which evaluator kind decides it — so `holds` does not hard-code one rule.
 * It looks the predicate's evaluator kind up in the predicate registry
 * (`@tradecraft/content`'s `compilePredicateRegistry`, task 2.3) and dispatches
 * to the matching function in the evaluator-kind registry below (Requirement
 * 32.3). The built-in kinds are:
 *
 * - `fact-match`: a stored fact with the same subject, predicate, object and
 *   place exists with a window overlapping the query time.
 * - `fact-match-symmetric`: as `fact-match`, but the subject and object may be
 *   swapped (for symmetric relations such as "meets").
 * - `alias`: the identity mapping links the two arguments — one is the
 *   Unidentified Subject id of the other, or they are literally equal.
 * - `membership-transitive`: following `MEMBER_OF` and `REPORTS_TO` edges from
 *   the subject reaches the object (so "reports to the chief of a cell the
 *   subject is a member of" holds without a direct fact).
 *
 * A predicate that needs a rule outside this set needs a code change to add a
 * kind — the single content extension point that does (Requirement 32.4).
 * Before any evaluator runs, `holds` resolves every `unk:` argument through the
 * identity mapping, so a Proposition stated about an Unidentified Subject is
 * judged against the NPC it really is.
 *
 * Mutation is transactional (Requirement 16.4). Only a Sim transition writes to
 * the store, and it does so through {@link TruthStore.transaction}: writes
 * accumulate on a draft and are applied in one step on success, or dropped
 * whole on failure. The store is never left holding a partial result of a turn
 * that threw. The convenience mutators (`recordClaimTruth`, `addFact`, …) each
 * run a one-write transaction, so even a single write is atomic.
 *
 * Code that only queries ground truth takes a {@link TruthReader}; code that
 * also writes takes a {@link TruthAccess}. The store implements both, and so
 * does a `TruthDraft` (`./truth-draft.ts`), which stages a whole turn's writes
 * over a store and applies them only when the turn commits.
 */

import {
  compareTime,
  type EntityId,
  type GameTime,
  type Literal,
  type NpcId,
  type OrgId,
  type Proposition,
  type TimeWindow,
  type Truth,
  type UnkId,
  asTruth,
} from '../model/core.js';
import type { EvaluatorKind } from '@tradecraft/content';

// ---------------------------------------------------------------------------
// Allegiance and ClaimTruthRecord
// ---------------------------------------------------------------------------

/**
 * An NPC's true allegiance: the organisation they really serve, regardless of
 * the allegiance they present. The Hostile Service, the Station and the Cell
 * are all organisations, so the real loyalty is just the id of one of them.
 * This is ground truth — the Player View never sees it; a player infers it —
 * so {@link TruthStore.allegiance} returns it wrapped in {@link Truth}.
 */
export interface Allegiance {
  readonly org: OrgId;
}

/**
 * The truth record the Sim writes for every extracted Claim (design's Dialogue
 * Loop, step 4). A Claim is a Proposition a speaker uttered; this record pins
 * down, at the time the Claim was made, whether it actually held, whether the
 * speaker believed it, and whether it was a deliberate lie. It is stored only
 * in the Truth Store and surfaced in the debrief; the Case File keeps a
 * view-safe Claim with none of these fields.
 *
 * - `claim` is the Proposition the model produced (its `id` is the Claim id).
 * - `speaker` is the NPC who said it.
 * - `at` is the game time the Claim was made, the time `held` is evaluated at.
 * - `held` is `holds(claim, at)` — the ground-truth verdict.
 * - `believed` is whether the speaker's own knowledge made them think it true.
 * - `lie` marks a deliberate falsehood (believed false, or part of an Agenda's
 *   promote list); a Claim can be false without being a lie (an honest error).
 */
export interface ClaimTruthRecord {
  readonly claim: Proposition;
  readonly speaker: NpcId;
  readonly at: GameTime;
  readonly held: boolean;
  readonly believed: boolean;
  readonly lie: boolean;
}

// ---------------------------------------------------------------------------
// Evaluator-kind registry
// ---------------------------------------------------------------------------

/**
 * The read-only view of the store an evaluator is given. An evaluator decides
 * whether a Proposition holds, so it needs to read facts, follow the identity
 * mapping, and recurse into {@link holds} for the transitive kinds — but it
 * must never mutate. This context exposes exactly those reads.
 */
export interface EvaluationContext {
  /** Every stored true fact, as plain Propositions (truth brand stripped). */
  facts(): readonly Proposition[];
  /**
   * The NPC an `unk:` id stands for, or `undefined` if it is unmapped. Used by
   * the `alias` evaluator and by argument resolution.
   */
  resolveUnk(unk: UnkId): NpcId | undefined;
  /** Does `p` hold at `at`? Lets a transitive evaluator reuse the dispatch. */
  holds(p: Proposition, at: GameTime): boolean;
  /**
   * The entity that holds `item` before any handover, when the instantiator
   * recorded one. Absent, a `custody-chain` query with no prior handover is false.
   */
  itemOrigin?(item: EntityId): EntityId | undefined;
}

/**
 * One evaluator kind's decision function: does `p` hold at `at`, given the
 * read-only {@link EvaluationContext}? The Proposition it receives has already
 * had its `unk:` arguments resolved to the NPCs they denote.
 */
export type Evaluator = (
  p: Proposition,
  at: GameTime,
  ctx: EvaluationContext,
) => boolean;

/** The two membership edges `membership-transitive` follows. */
const MEMBERSHIP_PREDICATES = new Set(['MEMBER_OF', 'REPORTS_TO']);

/** True when two Proposition objects (entity ids or literals) are equal. */
function objectsEqual(a: EntityId | Literal, b: EntityId | Literal): boolean {
  if (typeof a === 'string' || typeof b === 'string') {
    return a === b;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'time' && b.kind === 'time') {
    return compareTime(a.value, b.value) === 0;
  }
  return a.value === b.value;
}

/** Equal places, treating "no place" as a value that only matches "no place". */
function placesEqual(a: Proposition, b: Proposition): boolean {
  return a.place === b.place;
}

/**
 * Do two half-open windows overlap? A missing window means "always in effect",
 * so it overlaps everything. Two present windows `[from, to?)` overlap when
 * neither ends at or before the other begins. An open-ended window (`to`
 * omitted) runs to the end of time.
 */
function windowsOverlap(a: TimeWindow | undefined, b: TimeWindow | undefined): boolean {
  if (a === undefined || b === undefined) {
    return true;
  }
  // a starts before b ends, and b starts before a ends.
  const aBeforeBEnds = b.to === undefined || compareTime(a.from, b.to) < 0;
  const bBeforeAEnds = a.to === undefined || compareTime(b.from, a.to) < 0;
  return aBeforeBEnds && bBeforeAEnds;
}

/** Does `at` fall within `window`? A missing window always contains the time. */
function windowContains(window: TimeWindow | undefined, at: GameTime): boolean {
  if (window === undefined) {
    return true;
  }
  if (compareTime(at, window.from) < 0) {
    return false;
  }
  return window.to === undefined || compareTime(at, window.to) < 0;
}

/**
 * A stored fact matches the query (same subject, predicate, object and place),
 * its window contains the query time, and it overlaps the query's own window.
 * The direction flag lets the symmetric evaluator try the swapped orientation.
 */
function factMatches(
  query: Proposition,
  fact: Proposition,
  at: GameTime,
  swap: boolean,
): boolean {
  if (fact.predicate !== query.predicate) {
    return false;
  }
  const subject = swap ? fact.object : fact.subject;
  const object = swap ? fact.subject : fact.object;
  // A swapped subject must still be an entity id (a literal cannot be a subject).
  if (swap && typeof fact.object !== 'string') {
    return false;
  }
  if (subject !== query.subject) {
    return false;
  }
  if (!objectsEqual(object, query.object)) {
    return false;
  }
  if (!placesEqual(fact, query)) {
    return false;
  }
  return windowContains(fact.window, at) && windowsOverlap(fact.window, query.window);
}

/** `fact-match`: a stored fact matches in the stated orientation. */
const factMatchEvaluator: Evaluator = (p, at, ctx) =>
  ctx.facts().some((fact) => factMatches(p, fact, at, false));

/** `fact-match-symmetric`: a stored fact matches in either orientation. */
const factMatchSymmetricEvaluator: Evaluator = (p, at, ctx) =>
  ctx
    .facts()
    .some((fact) => factMatches(p, fact, at, false) || factMatches(p, fact, at, true));

/**
 * `alias`: the subject and object denote the same person through the identity
 * mapping. After `holds` has resolved `unk:` arguments, two ids that start out
 * as the same NPC (`unk:3` and `npc:ana`, both resolving to `npc:ana`) are
 * already equal, so the check is a direct comparison of the resolved ids. A
 * literal object can never be an alias of a person.
 */
const aliasEvaluator: Evaluator = (p) => {
  if (typeof p.object !== 'string') {
    return false;
  }
  return p.subject === p.object;
};

/**
 * `membership-transitive`: following `MEMBER_OF` and `REPORTS_TO` edges from the
 * subject reaches the object. A breadth-first walk over those two fact kinds,
 * honouring each edge's window at the query time, with a visited set so a cycle
 * in the data cannot loop forever.
 */
const membershipTransitiveEvaluator: Evaluator = (p, at, ctx) => {
  if (typeof p.object !== 'string') {
    return false;
  }
  const target = p.object;
  const facts = ctx.facts();
  const visited = new Set<string>([p.subject]);
  const queue: EntityId[] = [p.subject];

  while (queue.length > 0) {
    const current = queue.shift() as EntityId;
    for (const fact of facts) {
      if (!MEMBERSHIP_PREDICATES.has(fact.predicate)) {
        continue;
      }
      if (fact.subject !== current || typeof fact.object !== 'string') {
        continue;
      }
      if (!windowContains(fact.window, at)) {
        continue;
      }
      const next = fact.object;
      if (next === target) {
        return true;
      }
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return false;
};

/**
 * The evaluator-kind registry: each built-in {@link EvaluatorKind} mapped to the
 * function that decides it. `holds` reads the predicate's kind from the
 * predicate registry and dispatches here (Requirement 32.3). Adding a kind
 * means adding an entry here and to `EVALUATOR_KINDS` in the content package —
 * the only content rule that needs code (Requirement 32.4).
 */
/**
 * HOLDS(holder, item) at `t`: the latest HANDS_OVER of `item` at or before `t`
 * names `holder` as recipient, or `holder` is the origin when nothing precedes
 * `t` (plot-library Req 11.2).
 */
export function custodyHolds(
  facts: readonly Proposition[],
  holder: EntityId,
  item: EntityId,
  at: GameTime,
  origin: EntityId,
): boolean {
  const handovers = facts
    .filter(
      (fact) =>
        fact.predicate.endsWith('HANDS_OVER') &&
        fact.instrument === item &&
        fact.window !== undefined &&
        compareTime(fact.window.from, at) <= 0,
    )
    .sort((a, b) => {
      const byTime = compareTime(a.window?.from ?? at, b.window?.from ?? at);
      if (byTime !== 0) {
        return byTime;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  if (handovers.length === 0) {
    return origin === holder;
  }
  return handovers[handovers.length - 1]?.object === holder;
}

/** The entity that holds `item` at `at`, or the origin when nothing has been handed over. */
export function currentHolder(
  facts: readonly Proposition[],
  item: EntityId,
  at: GameTime,
  origin: EntityId | undefined,
): EntityId | undefined {
  const handovers = facts
    .filter(
      (fact) =>
        fact.predicate.endsWith('HANDS_OVER') &&
        fact.instrument === item &&
        fact.window !== undefined &&
        compareTime(fact.window.from, at) <= 0,
    )
    .sort((a, b) => {
      const byTime = compareTime(a.window?.from ?? at, b.window?.from ?? at);
      if (byTime !== 0) {
        return byTime;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  if (handovers.length === 0) {
    return origin;
  }
  const recipient = handovers[handovers.length - 1]?.object;
  return typeof recipient === 'string' ? recipient : origin;
}

const custodyChainEvaluator: Evaluator = (p, at, ctx) => {
  if (typeof p.object !== 'string') {
    return false;
  }
  const item = p.object;
  const origin = ctx.itemOrigin?.(item);
  if (origin === undefined) {
    return false;
  }
  return custodyHolds(ctx.facts(), p.subject, item, at, origin);
};

export const EVALUATORS: Readonly<Record<EvaluatorKind, Evaluator>> = {
  'fact-match': factMatchEvaluator,
  'fact-match-symmetric': factMatchSymmetricEvaluator,
  alias: aliasEvaluator,
  'membership-transitive': membershipTransitiveEvaluator,
  'custody-chain': custodyChainEvaluator,
};

// ---------------------------------------------------------------------------
// The Truth Store
// ---------------------------------------------------------------------------

/**
 * The predicate information the Truth Store needs: a predicate id → evaluator
 * kind lookup. This is exactly the `evaluators` map a compiled
 * {@link PredicateRegistry} exposes (`@tradecraft/content`), so a caller passes
 * `registry.evaluators` straight in. Narrowing to this one method keeps the
 * store from depending on the whole registry shape and makes it trivial to
 * drive from a plain `Map` in a test.
 */
export interface PredicateEvaluatorLookup {
  /** The evaluator kind for a predicate id, or `undefined` if unknown. */
  get(predicate: string): EvaluatorKind | undefined;
}

/** The serialisable contents of a Truth Store, for construction and saves. */
export interface TruthStoreData {
  readonly facts: readonly Proposition[];
  readonly allegiances: ReadonlyMap<NpcId, Allegiance>;
  readonly identities: ReadonlyMap<UnkId, NpcId>;
  readonly claimTruths: readonly ClaimTruthRecord[];
  /** Item id → the entity that holds it before any HANDS_OVER. */
  readonly itemOrigins?: ReadonlyMap<string, EntityId>;
}

/**
 * The set of writes a transaction accumulates before it commits. Each field is
 * optional; a transaction touches only what it needs. On commit they are
 * applied together; on failure the whole draft is dropped (Requirement 16.4).
 */
interface TransactionDraft {
  readonly addedFacts: Proposition[];
  readonly claimTruths: ClaimTruthRecord[];
  readonly identities: Map<UnkId, NpcId>;
  readonly allegiances: Map<NpcId, Allegiance>;
}

/**
 * A transaction handle, passed to the callback of {@link TruthStore.transaction}.
 * The callback records its intended writes here; nothing reaches the store
 * until the callback returns normally. If it throws, the draft is discarded and
 * the store is unchanged.
 */
export interface TruthTransaction {
  /** Add a true fact to the store. */
  addFact(fact: Proposition): void;
  /** Record a Claim's truth evaluation. */
  recordClaimTruth(record: ClaimTruthRecord): void;
  /** Map an Unidentified Subject id to the NPC it denotes. */
  setIdentity(unk: UnkId, npc: NpcId): void;
  /** Set an NPC's true allegiance. */
  setAllegiance(npc: NpcId, allegiance: Allegiance): void;
}

/**
 * The Truth Store's read interface: every ground-truth query, and no writes.
 * {@link TruthStore} answers from its own contents. A `TruthDraft`
 * (`./truth-draft.ts`) answers from a store with its staged writes applied, so
 * a reader sees those writes as though they were already committed.
 */
export interface TruthReader {
  /** Every true fact, each branded {@link Truth}. A fresh copy. */
  facts(): ReadonlyArray<Truth<Proposition>>;
  /** Does `p` hold at `at`? Dispatches on the predicate's evaluator kind. */
  holds(p: Proposition, at: GameTime): boolean;
  /** An NPC's true allegiance, or `undefined` if none is recorded. */
  allegiance(npc: NpcId): Truth<Allegiance> | undefined;
  /** The NPC an Unidentified Subject id denotes, or `undefined` if unmapped. */
  identityOf(unk: UnkId): Truth<NpcId> | undefined;
  /** Who held `item` before any handover, when the instantiator recorded one. */
  itemOrigin(item: EntityId): EntityId | undefined;
  /** Every recorded Claim-truth, each branded {@link Truth}. A fresh copy. */
  claimTruths(): ReadonlyArray<Truth<ClaimTruthRecord>>;
}

/**
 * The read interface plus the store's atomic writes: what a Sim transition is
 * handed. A multi-write {@link transaction} applies all of its writes or none,
 * and each single write (the {@link TruthTransaction} methods) is its own
 * one-write transaction. {@link TruthStore} applies writes to itself; a
 * `TruthDraft` stages them until the turn commits.
 */
export interface TruthAccess extends TruthReader, TruthTransaction {
  /** Run `work` atomically: its writes land together, or not at all if it throws. */
  transaction<T>(work: (tx: TruthTransaction) => T): T;
}

// ---------------------------------------------------------------------------
// The `holds` dispatch
// ---------------------------------------------------------------------------

/**
 * What `holds` evaluates over: the predicate → evaluator-kind lookup, the true
 * facts and the identity mapping. {@link TruthStore} supplies its own contents.
 * A `TruthDraft` supplies a store's contents with its staged facts and
 * identities laid on top, so the draft answers through this same dispatch and
 * agrees with the store it will commit to.
 */
export interface HoldsSource {
  readonly predicates: PredicateEvaluatorLookup;
  /** The true facts, as plain Propositions. */
  facts(): readonly Proposition[];
  /** The NPC an `unk:` id stands for, or `undefined` if it is unmapped. */
  resolveUnk(unk: UnkId): NpcId | undefined;
  /** Who held `item` before any handover, when the instantiator recorded one. */
  itemOrigin?(item: EntityId): EntityId | undefined;
}

/**
 * Does `p` hold at `at` over `source`? Resolves `p`'s `unk:` arguments through
 * the source's identity mapping, then dispatches on the predicate's evaluator
 * kind (Requirement 32.3). An unknown predicate never holds (see
 * {@link TruthStore.holds}).
 */
export function holdsIn(source: HoldsSource, p: Proposition, at: GameTime): boolean {
  const kind = source.predicates.get(p.predicate);
  if (kind === undefined) {
    return false;
  }
  const context: EvaluationContext = {
    facts: () => source.facts(),
    resolveUnk: (unk) => source.resolveUnk(unk),
    holds: (q, t) => holdsIn(source, q, t),
    ...(source.itemOrigin === undefined ? {} : { itemOrigin: (item) => source.itemOrigin?.(item) }),
  };
  return EVALUATORS[kind](resolveProposition(p, source), at, context);
}

/**
 * Resolve a Proposition's `unk:` subject and (entity) object to the NPCs they
 * denote, so an evaluator judges the Claim against the real people (design:
 * "`holds` resolves `unk:` ids through `identityOf` before it evaluates"). An
 * unmapped `unk:` id is left as it is — nothing maps to it, so it can only
 * match itself, which is the correct behaviour for an unidentified subject.
 */
function resolveProposition(p: Proposition, source: HoldsSource): Proposition {
  const subject = resolveEntity(p.subject, source);
  const object =
    typeof p.object === 'string' ? resolveEntity(p.object, source) : p.object;
  if (subject === p.subject && object === p.object) {
    return p;
  }
  return { ...p, subject, object };
}

/** Resolve one id: an `unk:` id becomes its NPC if mapped; others pass through. */
function resolveEntity(id: EntityId, source: HoldsSource): EntityId {
  if (id.startsWith('unk:')) {
    return source.resolveUnk(id as UnkId) ?? id;
  }
  return id;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * The ground-truth store (design's `TruthStore`). Reads are always available;
 * writes go only through {@link transaction} (or the single-write convenience
 * mutators, which wrap it), so every change to the store is atomic.
 */
export class TruthStore implements TruthAccess {
  /**
   * The predicate → evaluator-kind lookup `holds` dispatches on. It is content
   * data, not ground truth, so it is readable: a `TruthDraft` over this store
   * dispatches through the same lookup.
   */
  readonly predicates: PredicateEvaluatorLookup;
  private factList: Proposition[];
  private readonly allegiances: Map<NpcId, Allegiance>;
  private readonly identities: Map<UnkId, NpcId>;
  private claimTruthList: ClaimTruthRecord[];
  private readonly itemOrigins: Map<string, EntityId>;

  private constructor(
    predicates: PredicateEvaluatorLookup,
    data: TruthStoreData,
  ) {
    this.predicates = predicates;
    this.factList = [...data.facts];
    this.allegiances = new Map(data.allegiances);
    this.identities = new Map(data.identities);
    this.claimTruthList = [...data.claimTruths];
    this.itemOrigins = new Map(data.itemOrigins ?? []);
  }

  /**
   * Build an empty store that evaluates predicates with `predicates` (pass a
   * compiled registry's `evaluators` map, or any id → kind lookup).
   */
  static create(predicates: PredicateEvaluatorLookup): TruthStore {
    return new TruthStore(predicates, {
      facts: [],
      allegiances: new Map(),
      identities: new Map(),
      claimTruths: [],
    });
  }

  /** Build a store from existing data (world generation, a loaded save). */
  static from(
    predicates: PredicateEvaluatorLookup,
    data: TruthStoreData,
  ): TruthStore {
    return new TruthStore(predicates, data);
  }

  // -- reads ----------------------------------------------------------------

  /**
   * Every stored true fact, each branded {@link Truth}. The array is a fresh
   * copy, so a caller cannot mutate the store by writing to it.
   */
  facts(): ReadonlyArray<Truth<Proposition>> {
    return this.factList.map((fact) => asTruth(fact));
  }

  /**
   * Does `p` hold at `at`? Resolves `p`'s `unk:` arguments through the identity
   * mapping, then dispatches on the predicate's evaluator kind (Requirement
   * 32.3). An unknown predicate — one with no entry in the lookup — never holds;
   * truth is only ever asserted through a known rule, so a missing rule is a
   * firm "no", not an error that could be mistaken for truth.
   */
  holds(p: Proposition, at: GameTime): boolean {
    return holdsIn(this.holdsSource(), p, at);
  }

  /**
   * An NPC's true allegiance, branded {@link Truth}, or `undefined` if none is
   * recorded. Reserved for engine modules — the Player View never calls it.
   */
  allegiance(npc: NpcId): Truth<Allegiance> | undefined {
    const allegiance = this.allegiances.get(npc);
    return allegiance === undefined ? undefined : asTruth(allegiance);
  }

  /**
   * The NPC an Unidentified Subject id denotes, branded {@link Truth}, or
   * `undefined` if the id is unmapped. This is the mapping the player works to
   * discover; it is ground truth, so the result is branded and the Player View
   * shows only the `unk:` id and a descriptor.
   */
  identityOf(unk: UnkId): Truth<NpcId> | undefined {
    const npc = this.identities.get(unk);
    return npc === undefined ? undefined : asTruth(npc);
  }

  /** The entity that holds `item` before any handover, when one was recorded. */
  itemOrigin(item: EntityId): EntityId | undefined {
    return this.itemOrigins.get(item);
  }

  /** Every recorded Claim-truth, each branded {@link Truth}. A fresh copy. */
  claimTruths(): ReadonlyArray<Truth<ClaimTruthRecord>> {
    return this.claimTruthList.map((record) => asTruth(record));
  }

  /** The store's contents as plain data, for a save snapshot. */
  snapshot(): TruthStoreData {
    return {
      facts: [...this.factList],
      allegiances: new Map(this.allegiances),
      identities: new Map(this.identities),
      claimTruths: [...this.claimTruthList],
      ...(this.itemOrigins.size === 0 ? {} : { itemOrigins: new Map(this.itemOrigins) }),
    };
  }

  // -- writes ---------------------------------------------------------------

  /**
   * Run `work` as an atomic transaction (Requirement 16.4). The callback
   * records its writes on the handle; they are applied together only if it
   * returns normally. If it throws, the draft is discarded and the store is
   * left exactly as it was — a turn that fails part way never leaves a partial
   * fact set behind. Returns whatever the callback returns.
   */
  transaction<T>(work: (tx: TruthTransaction) => T): T {
    const draft: TransactionDraft = {
      addedFacts: [],
      claimTruths: [],
      identities: new Map(),
      allegiances: new Map(),
    };

    const handle: TruthTransaction = {
      addFact(fact) {
        draft.addedFacts.push(fact);
      },
      recordClaimTruth(record) {
        draft.claimTruths.push(record);
      },
      setIdentity(unk, npc) {
        draft.identities.set(unk, npc);
      },
      setAllegiance(npc, allegiance) {
        draft.allegiances.set(npc, allegiance);
      },
    };

    // `work` runs first and may throw; only if it returns do we touch state.
    const result = work(handle);
    this.commit(draft);
    return result;
  }

  /** Record a Claim's truth evaluation (a one-write transaction). */
  recordClaimTruth(record: ClaimTruthRecord): void {
    this.transaction((tx) => tx.recordClaimTruth(record));
  }

  /** Add a true fact to the store (a one-write transaction). */
  addFact(fact: Proposition): void {
    this.transaction((tx) => tx.addFact(fact));
  }

  /** Map an Unidentified Subject id to its NPC (a one-write transaction). */
  setIdentity(unk: UnkId, npc: NpcId): void {
    this.transaction((tx) => tx.setIdentity(unk, npc));
  }

  /** Set an NPC's true allegiance (a one-write transaction). */
  setAllegiance(npc: NpcId, allegiance: Allegiance): void {
    this.transaction((tx) => tx.setAllegiance(npc, allegiance));
  }

  // -- internals ------------------------------------------------------------

  /** Apply an accumulated draft to the store in one step. */
  private commit(draft: TransactionDraft): void {
    if (draft.addedFacts.length > 0) {
      this.factList = [...this.factList, ...draft.addedFacts];
    }
    if (draft.claimTruths.length > 0) {
      this.claimTruthList = [...this.claimTruthList, ...draft.claimTruths];
    }
    for (const [unk, npc] of draft.identities) {
      this.identities.set(unk, npc);
    }
    for (const [npc, allegiance] of draft.allegiances) {
      this.allegiances.set(npc, allegiance);
    }
  }

  /** This store's own contents, as the `holds` dispatch reads them. */
  private holdsSource(): HoldsSource {
    return {
      predicates: this.predicates,
      facts: () => this.factList,
      resolveUnk: (unk) => this.identities.get(unk),
      itemOrigin: (item) => this.itemOrigins.get(item),
    };
  }
}
