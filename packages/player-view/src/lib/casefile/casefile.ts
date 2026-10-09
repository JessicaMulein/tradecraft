/**
 * The Case File: the player's own record of what sources have asserted
 * (Glossary; Requirements 7.4, 8.1, 8.2).
 *
 * A {@link Claim} is a {@link Proposition} asserted to the player by a source —
 * an NPC in conversation, a decrypted Intercept, a surveillance observation, a
 * Document the player read, or a liaison service. The Case File holds
 * those Claims, the player's Admiralty Grades, the links the player draws
 * between Claims, and the corroboration/conflict relation the engine computes
 * from the Claims alone.
 *
 * The Case File is strictly Player-View data. It never holds a truth value, a
 * true allegiance, a MICE profile or a concealed Proposition (Requirement 2.2),
 * and nothing here reads the Truth Store. The one import from `@tradecraft/engine`
 * is the shared *shape* vocabulary — entity ids, the Proposition type, game
 * time and the Admiralty Grade — not any engine state.
 *
 * Three requirements anchor this module:
 *
 * - **Requirement 7.4.** When two Case File Claims share subject and predicate,
 *   the Case File marks them corroborating or conflicting, *based only on the
 *   Claims themselves*. {@link computeRelations} is that pure computation. It is
 *   alias-aware: two ids are the same subject or object once the Case File holds
 *   an `IS_ALIAS_OF` Claim linking them, resolved as a union-find
 *   ({@link aliasResolver}). It never consults ground truth.
 * - **Requirement 8.1.** The player can assign an Admiralty Grade to each Claim.
 *   {@link CaseFile.grade} records it; {@link CaseFile.ungrade} clears it.
 * - **Requirement 8.2.** The Case File shows each source's history: the Claims
 *   it made, the grades the player gave them, and its corroboration and
 *   conflict counts. {@link CaseFile.sourceHistory} and
 *   {@link CaseFile.sourceHistories} report it.
 *
 * The {@link CaseFile} class is a thin, mutating store around that pure core:
 * it mints Claim ids, keeps the derived `relation` in sync whenever Claims
 * change, and holds the player's links. The relation itself is always recomputed
 * by {@link computeRelations}, so the store can never drift from the pure
 * function the property test (task 4.5) checks.
 */

import {
  compareTime,
  type AdmiraltyGrade,
  type ClaimId,
  type DocId,
  type EntityId,
  type GameTime,
  type InterceptId,
  type LocId,
  type Literal,
  type NpcId,
  type Proposition,
  type TimeWindow,
} from '@tradecraft/engine';

// ---------------------------------------------------------------------------
// Source kinds and Claims
// ---------------------------------------------------------------------------

/**
 * The kinds of source a Claim can come from (Glossary: "a Proposition
 * asserted to the player by a source — an NPC, an Intercept, surveillance, a
 * document, or a liaison service"). Each carries the id of the originating
 * thing, which is what the per-source history groups on.
 *
 * - `npc` — something an NPC said, extracted into a Claim by the Claim
 *   Extractor.
 * - `intercept` — a Proposition decoded from a broken Intercept.
 * - `surveillance` — a Proposition the player observed directly at a Location.
 * - `document` — a Proposition asserted by a Document the player read.
 * - `liaison` — a Proposition a liaison Service reported. It is that service's
 *   account, not ground truth.
 */
export type ClaimSource =
  | { readonly kind: 'npc'; readonly npc: NpcId }
  | { readonly kind: 'intercept'; readonly id: InterceptId }
  | { readonly kind: 'surveillance'; readonly loc: LocId }
  | { readonly kind: 'document'; readonly id: DocId }
  | { readonly kind: 'liaison'; readonly service: `service:${string}` };

/** The source-kind discriminant alone. */
export type ClaimSourceKind = ClaimSource['kind'];

/** Every source kind, in a stable order (handy for views and tests). */
export const CLAIM_SOURCE_KINDS = [
  'npc',
  'intercept',
  'surveillance',
  'document',
  'liaison',
] as const;

/**
 * How a Claim stands relative to the other Claims in the Case File that share
 * its subject and predicate (Requirement 7.4):
 *
 * - `none` — no other Claim shares its subject and predicate.
 * - `corroborated` — every other Claim sharing its subject and predicate agrees
 *   on the object (and place), and at least one such Claim exists.
 * - `conflicted` — at least one other Claim sharing its subject and predicate
 *   disagrees on the object or place.
 *
 * `conflicted` takes precedence: a Claim that both agrees with one source and
 * is contradicted by another is marked `conflicted`, because the contradiction
 * is the fact the player needs to see.
 */
export type ClaimRelation = 'none' | 'corroborated' | 'conflicted';

/**
 * A Claim as it lives in the Case File. The shape is the design's `Claim`
 * exactly. `prop` may reference `unk:` ids (an Unidentified Subject the player
 * has observed but not named); alias resolution folds those together with named
 * entities once the player holds an `IS_ALIAS_OF` Claim.
 */
export interface Claim {
  readonly id: ClaimId;
  readonly source: ClaimSource;
  readonly prop: Proposition;
  readonly observedAt: GameTime;
  /** True when the source hedged ("I think…"), carried through for display. */
  readonly hedged: boolean;
  /** The player's Admiralty Grade, or `undefined` until the player grades it. */
  readonly grade?: AdmiraltyGrade;
  /** Other Claims the player has linked to this one (player-created). */
  readonly links: readonly ClaimId[];
  /** Computed from the Case File's Claims alone; never from ground truth. */
  readonly relation: ClaimRelation;
}

/**
 * The fields needed to record a new Claim. The Case File supplies the `id`, the
 * player-owned `links` (empty at first) and the derived `relation`, so a caller
 * — the Claim Extractor, the Cipher Engine, the read or surveil action — gives
 * only the source, the Proposition and the observation metadata.
 */
export interface ClaimInput {
  readonly source: ClaimSource;
  readonly prop: Proposition;
  readonly observedAt: GameTime;
  readonly hedged?: boolean;
}

// ---------------------------------------------------------------------------
// Alias resolution (union-find over held IS_ALIAS_OF Claims)
// ---------------------------------------------------------------------------

/**
 * The local name of the alias predicate, matched case-insensitively against a
 * Claim's predicate. The content loader namespaces predicates as
 * `<pack>/<name>` ({@link Proposition.predicate}), so a Claim's `IS_ALIAS_OF`
 * predicate reads `core/IS_ALIAS_OF`; the design writes it bare. Matching on the
 * local name keeps alias resolution working whatever pack defines the
 * predicate, which is also what the arrest-evidence code (task 4.7) relies on.
 */
const ALIAS_PREDICATE = 'IS_ALIAS_OF';

/** True when `predicate`'s local name is `IS_ALIAS_OF`, ignoring the pack. */
export function isAliasPredicate(predicate: string): boolean {
  const slash = predicate.lastIndexOf('/');
  const local = slash === -1 ? predicate : predicate.slice(slash + 1);
  return local.toLowerCase() === ALIAS_PREDICATE.toLowerCase();
}

/**
 * A function mapping any entity id to the representative of its alias class.
 * Two ids share a representative exactly when the Case File's held
 * `IS_ALIAS_OF` Claims connect them (directly or transitively). An id with no
 * alias Claim maps to itself.
 */
export type AliasResolver = (id: EntityId) => EntityId;

/**
 * Build the alias resolver for a set of Claims: a union-find over every held
 * `IS_ALIAS_OF` Claim whose object is an entity id (Requirement 7.4, "resolve
 * entity identity via held `IS_ALIAS_OF` Claims"). Any such Claim counts, at any
 * grade — grading is the player's confidence, not a precondition for identity.
 *
 * `IS_ALIAS_OF` is symmetric: `IS_ALIAS_OF(unk:3, npc:viktor)` and
 * `IS_ALIAS_OF(npc:viktor, unk:3)` describe the same identity, so subject and
 * object are unioned without regard to direction.
 *
 * The chosen representative is deterministic: the lexicographically smallest id
 * in the class. That makes the resolver a pure function of the Claim set,
 * independent of insertion order, which the corroboration-independence property
 * (task 4.5) depends on.
 */
export function aliasResolver(claims: Iterable<Claim>): AliasResolver {
  const parent = new Map<EntityId, EntityId>();

  const find = (id: EntityId): EntityId => {
    let root = id;
    while (parent.has(root) && parent.get(root) !== root) {
      const next = parent.get(root);
      if (next === undefined) {
        break;
      }
      root = next;
    }
    // Path-compress so repeated lookups stay cheap.
    let node = id;
    while (parent.has(node) && parent.get(node) !== root) {
      const next = parent.get(node) ?? root;
      parent.set(node, root);
      node = next;
    }
    return root;
  };

  const ensure = (id: EntityId): void => {
    if (!parent.has(id)) {
      parent.set(id, id);
    }
  };

  const union = (a: EntityId, b: EntityId): void => {
    ensure(a);
    ensure(b);
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) {
      return;
    }
    // Point the larger id at the smaller, so the representative is always the
    // lexicographically smallest id in the class.
    const [lo, hi] = ra < rb ? [ra, rb] : [rb, ra];
    parent.set(hi, lo);
  };

  for (const claim of claims) {
    if (!isAliasPredicate(claim.prop.predicate)) {
      continue;
    }
    const { subject, object } = claim.prop;
    if (isEntityObject(object)) {
      union(subject, object);
    }
  }

  return (id: EntityId): EntityId => (parent.has(id) ? find(id) : id);
}

// ---------------------------------------------------------------------------
// Corroboration and conflict (pure; Requirement 7.4)
// ---------------------------------------------------------------------------

/** True when a Proposition object is an entity id rather than a {@link Literal}. */
function isEntityObject(object: EntityId | Literal): object is EntityId {
  return typeof object === 'string';
}

/**
 * A canonical, alias-resolved key for a Proposition's object, used to decide
 * whether two Claims agree. Entity objects are mapped through the resolver so
 * `unk:3` and `npc:viktor` compare equal once linked; literal objects are keyed
 * by kind and value. A time literal keys on its `(day, phase)` so two equal
 * times match regardless of object identity.
 */
function objectKey(object: EntityId | Literal, canon: AliasResolver): string {
  if (isEntityObject(object)) {
    return `e:${canon(object)}`;
  }
  switch (object.kind) {
    case 'text':
      return `t:${object.value}`;
    case 'amount':
      return `n:${object.value}`;
    case 'time':
      return `w:${object.value.day}.${object.value.phase}`;
  }
}

/**
 * The alias-resolved place key for a Claim. Two Claims with the same subject,
 * predicate and object but different `place` values describe different facts, so
 * `place` is part of what agreement is checked on. A missing place keys as the
 * empty string, which agrees only with another missing place.
 */
function placeKey(place: LocId | undefined, canon: AliasResolver): string {
  return place === undefined ? '' : `p:${canon(place)}`;
}

/**
 * Predicates that can hold several values for one subject at the same time, by
 * local name. Two such Claims with different objects are different facts, not a
 * contradiction. Every other predicate is single-valued: a person is in one
 * place at a time, belongs to one side, has one plan and one target, and is one
 * person — so two different values contradict, which is how a cover story or
 * a planted Rumour shows itself.
 */
export const MULTI_VALUED_PREDICATES: ReadonlySet<string> = new Set([
  'MEETS_AT',
  'USES_CHANNEL',
  'CARRIES',
  'KNOWS',
  'SUSPECTS',
  'TRAVELS_TO',
]);

/** A predicate id's local name (`core/MEETS_AT` → `MEETS_AT`). */
function localName(predicate: string): string {
  return predicate.slice(predicate.lastIndexOf('/') + 1);
}

/** A game time as an ordinal phase count, for window comparisons. */
function timeOrdinal(t: GameTime): number {
  return t.day * 4 + t.phase;
}

/**
 * Whether two Claims' time windows can describe the same moment. A Claim with
 * no window is timeless and overlaps everything. A window with a `to` covers
 * `[from, to)`. A window with only a `from` is the moment it was observed (a
 * sighting, a contact), so it overlaps an equal moment or a range that holds it.
 */
export function windowsOverlap(a?: TimeWindow, b?: TimeWindow): boolean {
  if (a === undefined || b === undefined) {
    return true;
  }
  const aFrom = timeOrdinal(a.from);
  const bFrom = timeOrdinal(b.from);
  const aTo = a.to === undefined ? aFrom + 1 : timeOrdinal(a.to);
  const bTo = b.to === undefined ? bFrom + 1 : timeOrdinal(b.to);
  return aFrom < bTo && bFrom < aTo;
}

/**
 * The subject+predicate grouping key: the pair that decides which Claims are
 * "about the same thing" for Requirement 7.4. The subject is alias-resolved; the
 * predicate is compared by its local name so Claims from differently-namespaced
 * packs still group together.
 */
function groupKey(prop: Proposition, canon: AliasResolver): string {
  const slash = prop.predicate.lastIndexOf('/');
  const local =
    slash === -1 ? prop.predicate : prop.predicate.slice(slash + 1);
  return `${canon(prop.subject)}\u0000${local.toLowerCase()}`;
}

/**
 * Compute the {@link ClaimRelation} of every Claim from the Claim set alone
 * (Requirement 7.4). Pure: it reads nothing but the Claims passed in, and the
 * result is independent of their order.
 *
 * Claims are grouped by alias-resolved subject and predicate. Within a group,
 * two Claims *agree* when their alias-resolved object and place match, and
 * *disagree* otherwise. A Claim is:
 *
 * - `conflicted` if any other Claim in its group disagrees with it;
 * - otherwise `corroborated` if any other Claim in its group agrees with it and
 *   comes from an independent origin ({@link originKey}): a Claim repeated by
 *   the same origin (HQ's brief Cable and its trace Dossier, say) stays `none`;
 * - otherwise `none` (it is alone in its group).
 *
 * `IS_ALIAS_OF` Claims take part in grouping only as data for the resolver; they
 * are themselves related like any other Claim (two alias Claims asserting the
 * same link corroborate).
 *
 * Returns a map from Claim id to its relation. Every input Claim appears
 * exactly once; a duplicate Claim id in the input is a caller error and the
 * last write wins, matching the Case File's own id discipline.
 */
export function computeRelations(
  claims: readonly Claim[],
): Map<ClaimId, ClaimRelation> {
  const canon = aliasResolver(claims);

  // Group indices by subject+predicate.
  const groups = new Map<string, number[]>();
  claims.forEach((claim, index) => {
    const key = groupKey(claim.prop, canon);
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [index]);
    } else {
      bucket.push(index);
    }
  });

  const relations = new Map<ClaimId, ClaimRelation>();

  for (const indices of groups.values()) {
    if (indices.length === 1) {
      relations.set(claims[indices[0]].id, 'none');
      continue;
    }
    // Signature of each Claim within the group: alias-resolved object + place.
    const signatures = indices.map((index) => {
      const { prop } = claims[index];
      return `${objectKey(prop.object, canon)}\u0000${placeKey(prop.place, canon)}`;
    });
    const origins = indices.map((index) => originKey(claims[index].source));
    const multi = MULTI_VALUED_PREDICATES.has(
      localName(claims[indices[0]].prop.predicate),
    );
    indices.forEach((index, i) => {
      let agrees = false;
      let disagrees = false;
      for (let j = 0; j < indices.length; j += 1) {
        if (j === i) {
          continue;
        }
        // Facts about different times do not bear on each other: a sighting at
        // the café on Monday neither confirms nor contradicts one on Friday.
        if (!windowsOverlap(claims[indices[i]].prop.window, claims[indices[j]].prop.window)) {
          continue;
        }
        if (signatures[j] === signatures[i]) {
          // Agreement corroborates only across independent origins: HQ's own
          // Cables and Dossiers repeating each other are one voice, not two.
          if (origins[j] !== origins[i]) {
            agrees = true;
          }
        } else if (!multi) {
          // A different value contradicts only a single-valued predicate. A
          // person can meet several people or use several Channels at once.
          disagrees = true;
        }
      }
      const relation: ClaimRelation = disagrees
        ? 'conflicted'
        : agrees
          ? 'corroborated'
          : 'none';
      relations.set(claims[index].id, relation);
    });
  }

  return relations;
}

// ---------------------------------------------------------------------------
// Per-source history (Requirement 8.2)
// ---------------------------------------------------------------------------

/**
 * A stable key identifying one source across its Claims, for the per-source
 * history. It is the source kind and its originating id joined, so every Claim
 * an NPC made groups under one key and every Claim from one Intercept under
 * another.
 */
export type SourceKey = string;

/** The {@link SourceKey} of a {@link ClaimSource}. */
export function sourceKey(source: ClaimSource): SourceKey {
  switch (source.kind) {
    case 'npc':
      return `npc:${source.npc}`;
    case 'intercept':
      return `intercept:${source.id}`;
    case 'surveillance':
      return `surveillance:${source.loc}`;
    case 'document':
      return `document:${source.id}`;
    case 'liaison':
      return `liaison:${source.service}`;
  }
}

/**
 * The independent origin a Claim's source speaks for, for corroboration.
 *
 * Two agreeing Claims corroborate only when their origins differ. Every HQ
 * Document (the Cables HQ sends and the Dossiers it files) shares the `hq`
 * origin: HQ restating its own file is one voice, so it can point the player at
 * a suspect but cannot confirm one. Every other source is its own origin (an
 * NPC, an Intercept, a surveilled Location, a newspaper or found Document).
 */
export function originKey(source: ClaimSource): string {
  if (
    source.kind === 'document' &&
    (source.id.startsWith('doc:cable/') || source.id.startsWith('doc:dossier/'))
  ) {
    return 'hq';
  }
  return sourceKey(source);
}

/**
 * One source's history (Requirement 8.2): the Claims it has made, the grades the
 * player assigned to them, and how many of its Claims currently corroborate or
 * conflict with the rest of the Case File.
 */
export interface SourceHistory {
  readonly source: ClaimSource;
  readonly key: SourceKey;
  /** The source's Claims, in observation order (ties broken by id). */
  readonly claims: readonly Claim[];
  /** The player grades on this source's Claims, keyed by Claim id. */
  readonly grades: ReadonlyMap<ClaimId, AdmiraltyGrade>;
  /** How many of this source's Claims have `relation === 'corroborated'`. */
  readonly corroboratedCount: number;
  /** How many of this source's Claims have `relation === 'conflicted'`. */
  readonly conflictedCount: number;
}

// ---------------------------------------------------------------------------
// The Case File snapshot (save/load; slice-integration Req 13.3, 13.8)
// ---------------------------------------------------------------------------

/**
 * The Case File's serialisable contents, for a {@link SaveSnapshot} (slice task
 * 9.3). It is plain, view-safe data: every Claim exactly as it is stored (its
 * source, Proposition, observation time, hedge flag, the player's grade, the
 * player's links and the derived relation), plus the monotonic `nextId` counter
 * so a restored Case File mints the next Claim id where the saved game left off.
 *
 * Nothing truth-bearing lives here — the Case File never holds a truth value —
 * so the snapshot is exactly what the store already exposes through
 * {@link CaseFile.list}, kept in id order for a stable, canonical save. The
 * `relation` is persisted as data and recomputed on load, so a loaded store can
 * never drift from the pure {@link computeRelations}.
 */
export interface CaseFileSnapshot {
  /** Every Claim, in minted-id order. */
  readonly claims: readonly Claim[];
  /** The next Claim-id counter, so restored ids continue the saved sequence. */
  readonly nextId: number;
}

// ---------------------------------------------------------------------------
// The Case File store
// ---------------------------------------------------------------------------

/**
 * Order two Claims the way views and histories want them: earliest observation
 * first, ties broken by Claim id so the order is total and deterministic.
 */
function compareClaims(a: Claim, b: Claim): number {
  const byTime = compareTime(a.observedAt, b.observedAt);
  if (byTime !== 0) {
    return byTime;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The mutable Case File store. It mints Claim ids, keeps each Claim's derived
 * `relation` in sync via {@link computeRelations} whenever the Claim set
 * changes, and holds the player's grades and links.
 *
 * Everything the store returns is a fresh, read-only snapshot, so a caller
 * cannot reach in and mutate stored Claims. The store holds only view-safe
 * data; it has no handle on the Truth Store and makes no truth judgements.
 */
export class CaseFile {
  /** Claims keyed by id, in insertion order. */
  private readonly claims = new Map<ClaimId, Claim>();

  /** Monotonic counter behind minted Claim ids. */
  private nextId = 1;

  /**
   * Rebuild a Case File from a {@link CaseFileSnapshot} (slice task 9.3). Every
   * saved Claim is restored verbatim and the id counter continues the saved
   * sequence, so the loaded store is byte-for-byte equal to the one the save was
   * taken from and mints its next Claim where the saved game left off. The
   * relations are recomputed from the restored Claims (never trusted blindly
   * from the save), so a loaded store always agrees with {@link computeRelations}.
   */
  static fromSnapshot(snapshot: CaseFileSnapshot): CaseFile {
    const caseFile = new CaseFile();
    for (const claim of snapshot.claims) {
      caseFile.claims.set(claim.id, claim);
    }
    caseFile.nextId = snapshot.nextId;
    caseFile.recomputeRelations();
    return caseFile;
  }

  /**
   * Record a new Claim and return it, with its `relation` computed against the
   * whole Case File and an empty link list. Recording a Claim can change the
   * relation of existing Claims (a second source now corroborates a first), so
   * all relations are recomputed.
   */
  add(input: ClaimInput): Claim {
    const id: ClaimId = `claim:${this.nextId}`;
    this.nextId += 1;
    const claim: Claim = {
      id,
      source: input.source,
      prop: input.prop,
      observedAt: input.observedAt,
      hedged: input.hedged ?? false,
      links: [],
      relation: 'none',
    };
    this.claims.set(id, claim);
    this.recomputeRelations();
    // `recomputeRelations` replaced the stored object; return the live one.
    return this.claims.get(id) as Claim;
  }

  /** True when the Case File holds a Claim with id `id`. */
  has(id: ClaimId): boolean {
    return this.claims.has(id);
  }

  /** The Claim with id `id`, or `undefined`. */
  get(id: ClaimId): Claim | undefined {
    return this.claims.get(id);
  }

  /** The number of Claims in the Case File. */
  get size(): number {
    return this.claims.size;
  }

  /**
   * Every Claim, ordered by observation time then id. The returned array is a
   * fresh snapshot; mutating it does not touch the store.
   */
  list(): Claim[] {
    return [...this.claims.values()].sort(compareClaims);
  }

  /**
   * The Case File's serialisable contents, for a save snapshot (slice task 9.3).
   * Claims are returned in minted-id order so the save is canonical and stable;
   * each Claim is the stored, read-only object (its grade, links and relation
   * included). Pure: it reads the store and builds nothing on it.
   */
  snapshot(): CaseFileSnapshot {
    const claims = [...this.claims.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    return { claims, nextId: this.nextId };
  }

  /**
   * Assign the player's Admiralty Grade to a Claim (Requirement 8.1). Throws if
   * the Claim is unknown, so a stray id surfaces as a bug rather than silently
   * doing nothing.
   */
  grade(id: ClaimId, grade: AdmiraltyGrade): Claim {
    const claim = this.require(id);
    const graded: Claim = { ...claim, grade };
    this.claims.set(id, graded);
    return graded;
  }

  /** Clear the player's grade on a Claim. */
  ungrade(id: ClaimId): Claim {
    const claim = this.require(id);
    if (claim.grade === undefined) {
      return claim;
    }
    const ungraded: Claim = {
      id: claim.id,
      source: claim.source,
      prop: claim.prop,
      observedAt: claim.observedAt,
      hedged: claim.hedged,
      links: claim.links,
      relation: claim.relation,
    };
    this.claims.set(id, ungraded);
    return ungraded;
  }

  /**
   * Link two Claims (a player-created association; Glossary, Engine API `link`).
   * The link is symmetric and recorded on both Claims. Linking a Claim to
   * itself, or re-linking an existing pair, is a no-op. Throws if either Claim
   * is unknown.
   */
  link(a: ClaimId, b: ClaimId): void {
    if (a === b) {
      return;
    }
    const ca = this.require(a);
    const cb = this.require(b);
    if (!ca.links.includes(b)) {
      this.claims.set(a, { ...ca, links: sortedLinks([...ca.links, b]) });
    }
    if (!cb.links.includes(a)) {
      this.claims.set(b, { ...cb, links: sortedLinks([...cb.links, a]) });
    }
  }

  /** Remove a link between two Claims. A missing link is a no-op. */
  unlink(a: ClaimId, b: ClaimId): void {
    const ca = this.claims.get(a);
    const cb = this.claims.get(b);
    if (ca !== undefined && ca.links.includes(b)) {
      this.claims.set(a, { ...ca, links: ca.links.filter((id) => id !== b) });
    }
    if (cb !== undefined && cb.links.includes(a)) {
      this.claims.set(b, { ...cb, links: cb.links.filter((id) => id !== a) });
    }
  }

  /**
   * The alias resolver for the current Claim set, exposed so callers (the
   * People view's alias merge, the arrest-evidence code in task 4.7) resolve
   * identity exactly as corroboration does.
   */
  aliases(): AliasResolver {
    return aliasResolver(this.claims.values());
  }

  /**
   * The history of one source (Requirement 8.2), or `undefined` if the source
   * has no Claims in the Case File.
   */
  sourceHistory(source: ClaimSource): SourceHistory | undefined {
    return this.sourceHistories().get(sourceKey(source));
  }

  /**
   * Every source's history, keyed by {@link SourceKey} (Requirement 8.2). Each
   * entry lists the source's Claims (in observation order), the player grades on
   * them, and its live corroboration and conflict counts.
   */
  sourceHistories(): Map<SourceKey, SourceHistory> {
    const byKey = new Map<
      SourceKey,
      {
        source: ClaimSource;
        claims: Claim[];
        grades: Map<ClaimId, AdmiraltyGrade>;
        corroboratedCount: number;
        conflictedCount: number;
      }
    >();

    for (const claim of this.claims.values()) {
      const key = sourceKey(claim.source);
      let entry = byKey.get(key);
      if (entry === undefined) {
        entry = {
          source: claim.source,
          claims: [],
          grades: new Map(),
          corroboratedCount: 0,
          conflictedCount: 0,
        };
        byKey.set(key, entry);
      }
      entry.claims.push(claim);
      if (claim.grade !== undefined) {
        entry.grades.set(claim.id, claim.grade);
      }
      if (claim.relation === 'corroborated') {
        entry.corroboratedCount += 1;
      } else if (claim.relation === 'conflicted') {
        entry.conflictedCount += 1;
      }
    }

    const out = new Map<SourceKey, SourceHistory>();
    for (const [key, entry] of byKey) {
      entry.claims.sort(compareClaims);
      out.set(key, {
        source: entry.source,
        key,
        claims: entry.claims,
        grades: entry.grades,
        corroboratedCount: entry.corroboratedCount,
        conflictedCount: entry.conflictedCount,
      });
    }
    return out;
  }

  /** Fetch a Claim or throw a clear error if its id is unknown. */
  private require(id: ClaimId): Claim {
    const claim = this.claims.get(id);
    if (claim === undefined) {
      throw new Error(`Case File has no Claim ${id}`);
    }
    return claim;
  }

  /**
   * Recompute every Claim's `relation` from the current Claim set and write the
   * updated Claims back, preserving each Claim's player-owned `grade` and
   * `links`. Called after any change that can alter relations (adding a Claim).
   */
  private recomputeRelations(): void {
    const snapshot = [...this.claims.values()];
    const relations = computeRelations(snapshot);
    for (const claim of snapshot) {
      const relation = relations.get(claim.id) ?? 'none';
      if (relation !== claim.relation) {
        this.claims.set(claim.id, { ...claim, relation });
      }
    }
  }
}

/** Keep a Claim's link list sorted and duplicate-free for stable snapshots. */
function sortedLinks(links: readonly ClaimId[]): ClaimId[] {
  return [...new Set(links)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
