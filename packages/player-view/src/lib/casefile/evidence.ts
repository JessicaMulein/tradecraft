/**
 * Arrest Evidence: the pure, Player-View computation behind the arrest gate
 * (Requirements 19.1, 40; design "Arrest Evidence").
 *
 * The arrest gate asks a single question — does the Case File hold enough
 * corroborated Claims *implicating* a target to justify an arrest? This module
 * answers it from Player-View data alone: the {@link CaseFile}'s Claims, the
 * {@link BriefView} the Starting Brief hands the player, and the predicate
 * `implication` rules. It never reads the Truth Store, and nothing here can:
 * the module imports only shape vocabulary from `@tradecraft/engine` and the
 * Case File's own pure helpers.
 *
 * The implication rules are *supplied by the caller*, not read from the engine
 * or the content package. A {@link PredicateDefinition}'s `implication` field
 * lives in `@tradecraft/content`, and player-view must stay view-safe (it may
 * depend on `@tradecraft/engine` for shapes only), so the engine resolves the
 * rules once and passes them in as an {@link ImplicationRules} map. That keeps
 * the arrest gate a pure function of view data and the rules, which is what the
 * arrest-gate property (design Property 12) checks: `evidenceCount` is
 * unchanged by any Truth Store modification and equal for a target and any
 * Unidentified Subject aliased to it.
 *
 * Four requirements anchor this module:
 *
 * - **Requirement 40.1.** Implication is decided only from Case File Claims, the
 *   Starting Brief and the predicate implication rules — never from the Truth
 *   Store. Every function here takes exactly those inputs.
 * - **Requirement 40.2.** A Claim implicates a target when the target (or an
 *   Unidentified Subject aliased to it via held `IS_ALIAS_OF` Claims) fills the
 *   role the predicate's rule names, and the other argument carries one of the
 *   rule's hostile marks. {@link implicates} is that test.
 * - **Requirement 40.4.** The arrest gate counts *distinct* implicating
 *   Propositions whose Claims are marked corroborated. {@link evidenceCount}
 *   counts distinct `(predicate, subject, object, place)` keys, alias-resolved.
 * - **Requirement 19.1.** The arrest is granted only with at least the
 *   configured number of such Claims. The caller compares {@link evidenceCount}
 *   to the preset's `arrestThreshold`.
 */

import type { EntityId } from '@tradecraft/engine';

import {
  originKey,
  aliasResolver,
  type AliasResolver,
  type CaseFile,
  type Claim,
} from './casefile.js';

// ---------------------------------------------------------------------------
// Predicate implication rules (supplied by the caller; view-safe)
// ---------------------------------------------------------------------------

/**
 * Which argument of a predicate an implication attaches to. The *target* must
 * fill this role for the Claim to implicate it:
 *
 * - `subject` — the Claim's subject must be the target (`MEMBER_OF`, `PLANS`…).
 * - `object` — the Claim's object must be the target.
 * - `either` — the target may be subject or object (`MEETS_AT`).
 *
 * Mirrors the content package's `IMPLICATION_ROLES`; redeclared locally so
 * player-view keeps its only engine import to shape types and never reaches
 * into `@tradecraft/content`.
 */
export type ImplicationRole = 'subject' | 'object' | 'either';

/**
 * A hostile mark the *other* argument of an implicating Claim may be required to
 * carry. `none` means the other argument need carry no mark — the predicate is
 * implicating on its own (`PLANS`, `TARGETS`). Mirrors the content package's
 * `HOSTILE_MARKS`.
 */
export type HostileMark =
  | 'hostile-org'
  | 'hostile-person'
  | 'materiel'
  | 'hostile-channel'
  | 'none';

/**
 * A predicate's arrest-evidence implication rule: the {@link ImplicationRole}
 * the target must fill, and the hostile marks the other argument may carry.
 * Structurally identical to `@tradecraft/content`'s `Implication`, so the
 * engine can pass a compiled rule straight in.
 */
export interface Implication {
  readonly role: ImplicationRole;
  readonly other: readonly HostileMark[];
  /** What one confirmed fact adds to the case score (default 1). */
  readonly weight?: number;
}

/**
 * The resolved predicate implication rules, keyed by predicate *local name*
 * (the part after the pack prefix — `MEMBER_OF`, not `core/MEMBER_OF`), matched
 * case-insensitively. Keying on the local name mirrors how the Case File
 * resolves predicates ({@link isAliasPredicate}, {@link computeRelations}), so a
 * Claim from any pack still finds its rule.
 *
 * The caller (the engine's arrest quote) builds this from the loaded predicate
 * definitions' `implication` fields and hands it in, keeping player-view free of
 * any content or Truth Store dependency.
 */
export type ImplicationRules = ReadonlyMap<string, Implication>;

// ---------------------------------------------------------------------------
// The Starting Brief view (the view-safe slice the arrest gate needs)
// ---------------------------------------------------------------------------

/**
 * The slice of the Starting Brief the arrest gate reads: the entities the Brief
 * designates as hostile, and the materiel its leads name. This is Player-View
 * data — the Brief as the player received it — not any Truth Store state.
 *
 * - `hostileOrgs` — organisations the Brief designates as hostile (the Hostile
 *   Service and the Cell).
 * - `hostileChannels` — Channels the Brief designates as hostile.
 * - `materiel` — items named in the Brief's leads.
 *
 * Ids are taken as given; {@link hostileMarks} alias-resolves them so a Brief id
 * and an aliased `unk:` id collapse together.
 */
export interface BriefView {
  readonly hostileOrgs: readonly EntityId[];
  readonly hostileChannels: readonly EntityId[];
  readonly materiel: readonly EntityId[];
}

// ---------------------------------------------------------------------------
// Hostile marks
// ---------------------------------------------------------------------------

/**
 * The entities marked hostile for arrest-evidence purposes, each a set of
 * alias-class representatives (so membership tests are alias-aware). The four
 * mark kinds correspond to the hostile-mark vocabulary an implication's `other`
 * may require.
 */
export interface HostileMarks {
  readonly orgs: ReadonlySet<EntityId>;
  readonly persons: ReadonlySet<EntityId>;
  readonly materiel: ReadonlySet<EntityId>;
  readonly channels: ReadonlySet<EntityId>;
}

// ---------------------------------------------------------------------------
// Predicate local-name matching
// ---------------------------------------------------------------------------

/**
 * The local name of a predicate: the part after the last `/`, upper-cased for a
 * case-insensitive match. `core/MEMBER_OF` and `MEMBER_OF` both yield
 * `MEMBER_OF`, matching how the Case File groups and resolves predicates.
 */
function localPredicate(predicate: string): string {
  const slash = predicate.lastIndexOf('/');
  const local = slash === -1 ? predicate : predicate.slice(slash + 1);
  return local.toUpperCase();
}

/** The {@link Implication} for a Claim's predicate, by local name, or undefined. */
function implicationFor(
  predicate: string,
  rules: ImplicationRules,
): Implication | undefined {
  return rules.get(localPredicate(predicate));
}

// ---------------------------------------------------------------------------
// aliasClasses (Requirement 40.2; design "Aliases")
// ---------------------------------------------------------------------------

/**
 * The alias-class resolver for a Case File: every entity id maps to the
 * representative of its alias class, folding `unk:` ids together with named
 * entities once the Case File holds an `IS_ALIAS_OF` Claim linking them. Any
 * held alias Claim counts, whatever its grade.
 *
 * This is exactly the Case File's own resolver ({@link CaseFile.aliases}), so
 * arrest evidence resolves identity the same way corroboration does — the two
 * can never disagree about who `unk:3` is.
 */
export function aliasClasses(cf: CaseFile): AliasResolver {
  return cf.aliases();
}

// ---------------------------------------------------------------------------
// hostileMarks (Requirement 40.1; design "Hostile marks", least fixpoint)
// ---------------------------------------------------------------------------

/** True when an id is in the `org:` namespace. */
function isOrg(id: EntityId): boolean {
  return id.startsWith('org:');
}

/** True when an id is in the `chan:` namespace. */
function isChannel(id: EntityId): boolean {
  return id.startsWith('chan:');
}

/**
 * The object of a Claim as an entity id, or `undefined` when the object is a
 * literal (an amount, text or time). Only entity objects can carry a hostile
 * mark, so a literal object simply never contributes one.
 */
function entityObject(claim: Claim): EntityId | undefined {
  const { object } = claim.prop;
  if (typeof object === 'string') {
    return object;
  }
  // `USES_CHANNEL` names its Channel as a text literal (the predicate's object
  // kind); a literal that is a Channel id is that Channel.
  if (object.kind === 'text' && object.value.startsWith('chan:')) {
    return object.value as EntityId;
  }
  return undefined;
}

/**
 * Compute the {@link HostileMarks} for a Case File to a least fixpoint, from the
 * Starting Brief and the Case File's *corroborated* Claims only (design
 * "Hostile marks"). Pure: it reads nothing but its arguments, and the result is
 * independent of Claim order.
 *
 * The seed comes from the Brief: its designated hostile orgs and channels, and
 * the materiel its leads name. The fixpoint then grows the marks from
 * corroborated Claims, under the predicate implication rules the caller
 * supplies:
 *
 * - A person is hostile when a corroborated `MEMBER_OF`/`WORKS_FOR` Claim ties
 *   them to a hostile org (its implication `role: subject`, `other:
 *   [hostile-org]`).
 * - An item is materiel when a corroborated `PLANS`/`CARRIES` Claim has a
 *   hostile person as subject.
 * - A Channel is hostile when a corroborated `USES_CHANNEL` Claim has a hostile
 *   person as subject.
 *
 * Each new hostile person can make further Claims implicating (a newly-hostile
 * carrier marks their materiel; a chain of `WORKS_FOR` through an org…), so the
 * passes repeat until a pass adds nothing. All ids are alias-resolved before
 * they enter a set, so an `unk:` id aliased to a hostile named entity is itself
 * treated as hostile.
 *
 * Only predicates with an implication rule participate, and only those whose
 * rule shape matches the design's hostile-mark derivations. The caller's rule
 * set drives this: a predicate with no rule, or a rule the derivation does not
 * recognise, never seeds a mark.
 */
export function hostileMarks(
  cf: CaseFile,
  brief: BriefView,
  rules: ImplicationRules,
): HostileMarks {
  const canon = cf.aliases();

  const orgs = new Set<EntityId>(brief.hostileOrgs.map(canon));
  const channels = new Set<EntityId>(brief.hostileChannels.map(canon));
  const materiel = new Set<EntityId>(brief.materiel.map(canon));
  const persons = new Set<EntityId>();

  // Corroborated Claims are the only ones that can mark an entity hostile.
  const corroborated = cf
    .list()
    .filter((claim) => claim.relation === 'corroborated');

  let changed = true;
  while (changed) {
    changed = false;

    for (const claim of corroborated) {
      const rule = implicationFor(claim.prop.predicate, rules);
      if (rule === undefined) {
        continue;
      }
      const subject = canon(claim.prop.subject);
      const object = entityObject(claim);
      const canonObject = object === undefined ? undefined : canon(object);
      const marks = new Set(rule.other);

      // Person: subject tied to a hostile org (MEMBER_OF, WORKS_FOR).
      if (
        rule.role === 'subject' &&
        marks.has('hostile-org') &&
        canonObject !== undefined &&
        isOrg(canonObject) &&
        orgs.has(canonObject) &&
        !persons.has(subject)
      ) {
        persons.add(subject);
        changed = true;
      }

      // Person: subject operates a Channel already known to be hostile.
      if (
        rule.role === 'subject' &&
        marks.has('hostile-channel') &&
        canonObject !== undefined &&
        isChannel(canonObject) &&
        channels.has(canonObject) &&
        !persons.has(subject)
      ) {
        persons.add(subject);
        changed = true;
      }

      // Materiel: hostile person's object under a materiel-marking rule
      // (PLANS, CARRIES). Only entity objects can be materiel.
      if (
        rule.role === 'subject' &&
        marks.has('materiel') &&
        persons.has(subject) &&
        canonObject !== undefined &&
        !materiel.has(canonObject)
      ) {
        materiel.add(canonObject);
        changed = true;
      }

      // Channel: hostile person's Channel under USES_CHANNEL.
      if (
        rule.role === 'subject' &&
        marks.has('hostile-channel') &&
        persons.has(subject) &&
        canonObject !== undefined &&
        isChannel(canonObject) &&
        !channels.has(canonObject)
      ) {
        channels.add(canonObject);
        changed = true;
      }
    }
  }

  return { orgs, persons, materiel, channels };
}

// ---------------------------------------------------------------------------
// implicates (Requirement 40.2; design "implicates")
// ---------------------------------------------------------------------------

/** True when an entity carries one of the required hostile `marks`. */
function carriesMark(
  id: EntityId,
  required: readonly HostileMark[],
  marks: HostileMarks,
): boolean {
  for (const mark of required) {
    switch (mark) {
      case 'none':
        // The other argument need carry no mark.
        return true;
      case 'hostile-org':
        if (marks.orgs.has(id)) return true;
        break;
      case 'hostile-person':
        if (marks.persons.has(id)) return true;
        break;
      case 'materiel':
        if (marks.materiel.has(id)) return true;
        break;
      case 'hostile-channel':
        if (marks.channels.has(id)) return true;
        break;
    }
  }
  return false;
}

/**
 * Whether a Claim is an *Implicating Claim* against `target` (Requirement 40.2).
 * True when:
 *
 * 1. the Claim's predicate has an implication rule;
 * 2. the alias-resolved `target` fills the role the rule names (`subject`,
 *    `object` or `either`); and
 * 3. the *other* argument carries one of the rule's hostile marks — or the rule
 *    requires `none`, in which case the predicate implicates on its own.
 *
 * The `canon` resolver folds `unk:` ids into their alias class, so a Claim about
 * `unk:3` implicates `npc:viktor` once an `IS_ALIAS_OF` Claim links them, and a
 * Claim naming the target directly and one naming its alias are judged the same
 * way.
 *
 * When the rule's `other` is `none`, the Claim implicates whichever argument
 * fills the role regardless of the other argument's marks. When `other` lists
 * real marks and the other argument is a literal (so it can carry no entity
 * mark), the Claim does not implicate.
 */
export function implicates(
  claim: Claim,
  target: EntityId,
  marks: HostileMarks,
  canon: AliasResolver,
  rules: ImplicationRules,
): boolean {
  const rule = implicationFor(claim.prop.predicate, rules);
  if (rule === undefined) {
    return false;
  }

  const canonTarget = canon(target);
  const subject = canon(claim.prop.subject);
  const object = entityObject(claim);
  const canonObject = object === undefined ? undefined : canon(object);

  // Which argument is the target, and which is the "other" argument whose marks
  // the rule constrains.
  const targetIsSubject = subject === canonTarget;
  const targetIsObject =
    canonObject !== undefined && canonObject === canonTarget;

  let fillsRole: boolean;
  let other: EntityId | undefined;
  switch (rule.role) {
    case 'subject':
      fillsRole = targetIsSubject;
      other = canonObject;
      break;
    case 'object':
      fillsRole = targetIsObject;
      other = subject;
      break;
    case 'either':
      // The target may be subject or object; the other argument is whichever it
      // is not. If the target fills both (a self-referential Claim), the object
      // side is treated as the other argument.
      if (targetIsObject) {
        fillsRole = true;
        other = subject;
      } else if (targetIsSubject) {
        fillsRole = true;
        other = canonObject;
      } else {
        fillsRole = false;
        other = undefined;
      }
      break;
  }

  if (!fillsRole) {
    return false;
  }

  // `none` implicates regardless of the other argument (even a literal).
  if (rule.other.some((mark) => mark === 'none')) {
    return true;
  }

  // A real mark is required: the other argument must exist (an entity, not a
  // literal) and carry one of the marks.
  if (other === undefined) {
    return false;
  }
  return carriesMark(other, rule.other, marks);
}

// ---------------------------------------------------------------------------
// evidenceCount (Requirements 40.4, 19.1; design "evidenceCount")
// ---------------------------------------------------------------------------

/**
 * The alias-resolved key of a Claim's object: `e:<rep>` for an entity object,
 * or a kind-tagged literal key. Two Claims whose objects resolve to the same
 * key name the same thing, so they count once.
 */
function objectKey(claim: Claim, canon: AliasResolver): string {
  const { object } = claim.prop;
  if (typeof object === 'string') {
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
 * The case score against `target` (Requirements 40.4, 19.1): the weighted sum
 * of the *distinct* corroborated Claims implicating it. This is the value the
 * arrest gate compares to the preset's `arrestThreshold`. Each distinct fact
 * adds its predicate's implication `weight` (intent outweighs association);
 * within one predicate, every fact after the first adds half its weight.
 *
 * Only Claims with `relation === 'corroborated'` count. Among those, a Claim
 * counts when {@link implicates} holds for the alias-resolved target. Distinct
 * is measured on the key `(predicate, canon(subject), canon(object), place)`
 * with the predicate taken by local name and ids alias-resolved: two sources
 * corroborating the very same Proposition count once, while two different
 * implicating facts count separately.
 *
 * A distinct fact counts only when a FIELD source attests it (an NPC report, an
 * Intercept or surveillance). HQ's own brief Cable and trace Dossiers are leads
 * to be corroborated before any action (Req 40.4): they can point the player at
 * a suspect and corroborate a field claim, but HQ alone — even restated across
 * its own files — is never enough to arrest.
 *
 * Pure and alias-stable: because every id is alias-resolved, the count for a
 * target equals the count for any Unidentified Subject aliased to it, and
 * nothing it reads touches the Truth Store (design Property 12).
 */
export function evidenceCount(
  cf: CaseFile,
  target: EntityId,
  brief: BriefView,
  rules: ImplicationRules,
): number {
  const canon = cf.aliases();
  const marks = hostileMarks(cf, brief, rules);

  // Each distinct implicating fact, with the set of origins that attest it.
  // A fact counts as arrest evidence only when a FIELD origin attests it: HQ's
  // own brief Cable and trace Dossiers are leads to be corroborated before any
  // action (Req 40.4), so HQ pointing at a suspect — even restated across its
  // own files — never justifies an arrest on its own. The player must confirm
  // the fact in the field (an NPC source, an Intercept or surveillance).
  const factOrigins = new Map<string, Set<string>>();
  for (const claim of cf.list()) {
    if (claim.relation !== 'corroborated') {
      continue;
    }
    if (!implicates(claim, target, marks, canon, rules)) {
      continue;
    }
    const predicate = localPredicate(claim.prop.predicate);
    const subject = canon(claim.prop.subject);
    const place =
      claim.prop.place === undefined ? '' : `p:${canon(claim.prop.place)}`;
    const key = `${predicate}\u0000${subject}\u0000${objectKey(claim, canon)}\u0000${place}`;
    const origins = factOrigins.get(key) ?? new Set<string>();
    origins.add(originKey(claim.source));
    factOrigins.set(key, origins);
  }

  // Sum the weights of the field-confirmed facts. Within one predicate the
  // first fact counts in full and each further one at half weight: a second
  // meeting adds to the case, but less than the first did.
  const byPredicate = new Map<string, number[]>();
  for (const [key, origins] of factOrigins) {
    if (![...origins].some((origin) => origin !== 'hq')) {
      continue;
    }
    const predicate = key.slice(0, key.indexOf('\u0000'));
    const weight = implicationFor(predicate, rules)?.weight ?? 1;
    const list = byPredicate.get(predicate) ?? [];
    list.push(weight);
    byPredicate.set(predicate, list);
  }
  let score = 0;
  for (const weights of byPredicate.values()) {
    weights.forEach((weight, i) => {
      score += i === 0 ? weight : weight / 2;
    });
  }
  return score;
}

/**
 * Build an {@link ImplicationRules} map from `(predicate id, implication)` pairs,
 * keying each by its predicate local name. A small convenience for callers that
 * hold predicate definitions keyed by id; `undefined` implications are skipped,
 * so a caller can map straight over every predicate.
 */
export function implicationRules(
  entries: Iterable<readonly [string, Implication | undefined]>,
): ImplicationRules {
  const map = new Map<string, Implication>();
  for (const [id, implication] of entries) {
    if (implication !== undefined) {
      map.set(localPredicate(id), implication);
    }
  }
  return map;
}

// Re-exported so callers can build the resolver from a raw Claim set without
// reaching back into casefile.ts (the two share one definition of identity).
export { aliasResolver };
