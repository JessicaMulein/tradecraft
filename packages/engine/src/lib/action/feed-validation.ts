/**
 * Shared feed validation (slice-integration design, "Engine: actions" → "Feed
 * validation"; slice-integration Requirements 14.1–14.4, completing slice
 * Req 37.1 and 37.2).
 *
 * {@link validateFeedItems} is the one pure function that decides whether a
 * list of {@link FeedItem}s is a valid feed for a turned agent. `quoteFeed`
 * (`./feed.ts`) gates the `feed` action on it, and the Player View facade's
 * `validateFeed` calls it to show the feed composer what is wrong, so the two
 * cannot disagree (Req 14.4).
 *
 * ## What validity reads (Req 14.3)
 *
 * Only a {@link FeedView} and the content's predicate registry. The view holds
 * the current game time, the player's known set, the held Case File Claims and
 * the held `IS_ALIAS_OF` Claims among them: Player View and Case File data, with
 * no Truth Store and no `Truth`-branded field. {@link feedViewOf} builds it from
 * the World State's clock and `player.known` plus the projected Claims, so the
 * engine resolver and the facade build it the same way.
 *
 * ## The rules, in order
 *
 * 1. **Count** (Req 37.1): 1–3 items. A wrong count is one error with
 *    `index: -1, field: 'items'`; the items are still checked one by one.
 * 2. **Claim**: a `{ from: 'claim' }` item must name a held Claim. If it does
 *    not, that is the item's only error, since there is no Proposition to check.
 * 3. **Known set** (Req 37.1, 37.2): the subject, an entity object and the
 *    `place` must each be in the known set. An `unk:` id must instead resolve
 *    through a held `IS_ALIAS_OF` Claim to a known `npc:` id, and is rewritten
 *    to that NPC (the Hostile Service knows real identities).
 * 4. **Derived predicate schema** (Req 37.2): the predicate exists, the subject
 *    and object kinds are ones it takes (a literal object of the declared
 *    kind), and `place` and `window` obey its `required`/`optional`/`none`
 *    rules. A field that already failed rule 3 is reported once, by rule 3.
 * 5. **Window**: a window must start no earlier than now and end within the
 *    next {@link FEED_WINDOW_DAYS} days.
 *
 * Every failure is reported, one {@link FeedError} per failure (Req 14.2), in
 * rule order: the count error, then each item in item order, and within an
 * item its known-set errors (subject, object, place), then its schema errors,
 * then its window errors. That keeps the first error, whose reason `quoteFeed`
 * gives, the same one the feed action reported before this module was
 * extracted.
 */

import type { ContentSet } from '@tradecraft/content';

import {
  compareTime,
  type ChannelId,
  type EntityId,
  type GameTime,
  type LocId,
  type NpcId,
  type Proposition,
  type PropId,
  type UnkId,
} from '../model/core.js';
import type { Result } from '../model/result.js';
import type { ClaimId } from '../model/state.js';
import { IS_ALIAS_OF_PREDICATE } from './identify.js';
import type { ComposedProposition, FeedItem } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The fewest items a feed may carry (Req 37.1). */
export const FEED_MIN_ITEMS = 1;

/** The most items a feed may carry (Req 37.1). */
export const FEED_MAX_ITEMS = 3;

/** How many days ahead a fed Proposition's window may reach (design: "within the
 * next 7 days"). */
export const FEED_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// Feed errors (design: `FeedError` — item index, field, reason)
// ---------------------------------------------------------------------------

/** Which part of a feed a {@link FeedError} concerns. */
export type FeedField =
  | 'items'
  | 'claim'
  | 'predicate'
  | 'subject'
  | 'object'
  | 'place'
  | 'window';

/**
 * One feed validation failure (Req 14.2). `index` is the failing item's
 * position in the feed, or `-1` for the item-count error. `field` names the
 * part at fault, and `reason` is the player-facing explanation the feed
 * composer shows and `quoteFeed` gives.
 */
export interface FeedError {
  readonly index: number;
  readonly field: FeedField;
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// The Feed View (Req 14.3)
// ---------------------------------------------------------------------------

/**
 * The player's known set as feed validation reads it: the entity ids and the
 * Channel ids of `WorldState.player.known`.
 */
export interface FeedKnownSet {
  readonly entities: readonly EntityId[];
  readonly channels: readonly ChannelId[];
}

/**
 * Everything feed validity is decided from (Req 14.3): Player View and Case
 * File data only, never the Truth Store.
 */
export interface FeedView {
  /**
   * The current game time, which the status bar shows. A fed window must lie
   * within the next {@link FEED_WINDOW_DAYS} days of it.
   */
  readonly now: GameTime;
  /** The player's known set. */
  readonly known: FeedKnownSet;
  /**
   * The held Case File Claims, each as the Proposition it asserts, keyed by
   * Claim id (the same projection as `ResolverContext.claims`). A
   * `{ from: 'claim' }` item names one of these.
   */
  readonly claims: Readonly<Record<ClaimId, Proposition>>;
  /**
   * The held `IS_ALIAS_OF` Claims, a subset of {@link claims}. They are the only
   * way an `unk:` id in a feed resolves to a person.
   */
  readonly aliases: readonly Proposition[];
}

/**
 * The World State fields a {@link FeedView} is built from: the clock and the
 * player's known set. Neither is `Truth`-branded. A `WorldState` has this
 * shape, and so does any Player View projection that carries the two fields.
 */
export interface FeedViewSource {
  readonly time: GameTime;
  readonly player: { readonly known: FeedKnownSet };
}

/**
 * Build the {@link FeedView} for a state and the Case File Claims the player
 * holds (keyed by Claim id, as `ResolverContext.claims` projects them; none when
 * omitted). The held `IS_ALIAS_OF` Claims are picked out of `claims`, in the
 * order the record lists them.
 */
export function feedViewOf(
  source: FeedViewSource,
  claims: Readonly<Record<ClaimId, Proposition>> = {},
): FeedView {
  const { entities, channels } = source.player.known;
  return {
    now: source.time,
    known: { entities, channels },
    claims,
    aliases: Object.values(claims).filter(
      (prop) => prop.predicate === IS_ALIAS_OF_PREDICATE,
    ),
  };
}

// ---------------------------------------------------------------------------
// Known-set and alias helpers (Req 37.1, 37.2)
// ---------------------------------------------------------------------------

/** True when an entity id is in the known set (a Channel id among its Channels). */
export function isKnownEntity(known: FeedKnownSet, id: EntityId): boolean {
  if (id.startsWith('chan:')) {
    return (known.channels as readonly string[]).includes(id);
  }
  return (known.entities as readonly string[]).includes(id);
}

/** True when an id is an Unidentified-Subject (`unk:`) id. */
function isUnk(id: string): id is UnkId {
  return id.startsWith('unk:');
}

/**
 * Resolve an `unk:` id to a known `npc:` id through a held `IS_ALIAS_OF` Claim
 * (design: "`unk:` ids only if a held `IS_ALIAS_OF` Claim resolves them to a
 * known NPC"). An alias Claim ties the `unk:` id to an `npc:` id. The
 * identification machinery mints it `subject: unk, object: npc`, but either
 * order is accepted. Returns the first such NPC that is in the known set, or
 * `undefined` when no held alias resolves the id to a known NPC.
 */
export function resolveAlias(unk: UnkId, view: FeedView): NpcId | undefined {
  for (const prop of view.aliases) {
    if (prop.predicate !== IS_ALIAS_OF_PREDICATE) {
      continue;
    }
    const object = typeof prop.object === 'string' ? prop.object : undefined;
    let npc: string | undefined;
    if (prop.subject === unk && object !== undefined && object.startsWith('npc:')) {
      npc = object;
    } else if (object === unk && prop.subject.startsWith('npc:')) {
      npc = prop.subject;
    }
    if (npc !== undefined && isKnownEntity(view.known, npc as NpcId)) {
      return npc as NpcId;
    }
  }
  return undefined;
}

/**
 * Rule 3 for one entity: a known id stands as it is, and an `unk:` id becomes
 * the known NPC a held alias resolves it to. Otherwise the error is the reason.
 */
function resolveFeedEntity(id: EntityId, view: FeedView): Result<EntityId, string> {
  if (isUnk(id)) {
    const npc = resolveAlias(id, view);
    return npc === undefined
      ? {
          ok: false,
          error: `no held IS_ALIAS_OF Claim resolves ${id} to a known person`,
        }
      : { ok: true, value: npc };
  }
  return isKnownEntity(view.known, id)
    ? { ok: true, value: id }
    : { ok: false, error: `${id} is not in your known set` };
}

// ---------------------------------------------------------------------------
// Derived per-predicate schema check (Req 37.2)
// ---------------------------------------------------------------------------

/** The raw entity kind of an id, for the predicate's subject/object kind rule. */
function entityKindOf(id: string): 'npc' | 'unk' | 'org' | undefined {
  if (id.startsWith('npc:')) {
    return 'npc';
  }
  if (id.startsWith('unk:')) {
    return 'unk';
  }
  if (id.startsWith('org:')) {
    return 'org';
  }
  return undefined;
}

/**
 * Validate a single resolved {@link Proposition} against its predicate's derived
 * schema, the same per-predicate argument rules the Claim Extractor derives
 * (design: "Validation uses the same derived per-predicate schema as the Claim
 * Extractor"). Returns the field-tagged {@link FeedError}s for the item at
 * `index`, or an empty array when the Proposition satisfies the schema.
 *
 * The checks mirror {@link import('@tradecraft/content').PredicateDefinition}:
 * the predicate must exist; the subject kind must be among `definition.subject`;
 * an entity object's kind must be among `definition.object.entity` (or, for a
 * literal object, the `kind` must match `definition.object.literal`); and
 * `place`/`window` must obey the `required`/`optional`/`none` rules.
 */
export function validatePropositionSchema(
  prop: Proposition,
  content: ContentSet,
  index: number,
): FeedError[] {
  const errors: FeedError[] = [];
  const compiled = content.predicates.get(prop.predicate);
  if (compiled === undefined) {
    return [
      { index, field: 'predicate', reason: `unknown predicate ${prop.predicate}` },
    ];
  }
  const def = compiled.definition;

  // Subject kind.
  const subjectKind = entityKindOf(prop.subject);
  if (subjectKind === undefined || !def.subject.includes(subjectKind)) {
    errors.push({
      index,
      field: 'subject',
      reason: `${prop.predicate} does not take a ${subjectKind ?? 'non-entity'} subject`,
    });
  }

  // Object kind: entity vs literal, per the predicate's object rule.
  if ('literal' in def.object) {
    if (typeof prop.object === 'string') {
      errors.push({
        index,
        field: 'object',
        reason: `${prop.predicate} takes a ${def.object.literal} literal object, not an entity`,
      });
    } else if (prop.object.kind !== def.object.literal) {
      errors.push({
        index,
        field: 'object',
        reason: `${prop.predicate} takes a ${def.object.literal} object, not ${prop.object.kind}`,
      });
    }
  } else {
    if (typeof prop.object !== 'string') {
      errors.push({
        index,
        field: 'object',
        reason: `${prop.predicate} takes an entity object, not a literal`,
      });
    } else {
      const objectKind = entityKindOf(prop.object);
      if (objectKind === undefined || !def.object.entity.includes(objectKind)) {
        errors.push({
          index,
          field: 'object',
          reason: `${prop.predicate} does not take a ${objectKind ?? 'non-entity'} object`,
        });
      }
    }
  }

  // Place rule.
  if (def.place === 'required' && prop.place === undefined) {
    errors.push({ index, field: 'place', reason: `${prop.predicate} requires a place` });
  } else if (def.place === 'none' && prop.place !== undefined) {
    errors.push({ index, field: 'place', reason: `${prop.predicate} takes no place` });
  }

  // Window rule.
  if (def.window === 'required' && prop.window === undefined) {
    errors.push({ index, field: 'window', reason: `${prop.predicate} requires a time window` });
  } else if (def.window === 'none' && prop.window !== undefined) {
    errors.push({ index, field: 'window', reason: `${prop.predicate} takes no time window` });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// The 7-day window (design: "Windows must be within the next 7 days")
// ---------------------------------------------------------------------------

/**
 * Check a Proposition's window is within the next {@link FEED_WINDOW_DAYS} days
 * of `now`. A missing window is fine (the schema check enforces a `required`
 * window). When present, `from` must not be in the past and the latest bound
 * (`to` if given, else `from`) must be no more than seven days ahead.
 */
export function validateWindow(
  prop: Proposition,
  now: GameTime,
  index: number,
): FeedError[] {
  if (prop.window === undefined) {
    return [];
  }
  const horizon: GameTime = { day: now.day + FEED_WINDOW_DAYS, phase: now.phase };
  if (compareTime(prop.window.from, now) < 0) {
    return [{ index, field: 'window', reason: 'the window must not start in the past' }];
  }
  const latest = prop.window.to ?? prop.window.from;
  if (compareTime(latest, horizon) > 0) {
    return [
      {
        index,
        field: 'window',
        reason: `the window must be within the next ${FEED_WINDOW_DAYS} days`,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// validateFeedItems (Req 14.1, 14.2, 14.3, 14.4)
// ---------------------------------------------------------------------------

/** Options for {@link validateFeedItems}. Validity never depends on them. */
export interface FeedValidationOptions {
  /**
   * The agent being fed, when known. It only scopes the ids minted for composed
   * items: `prop:feed/<agent>/<index>`, or `prop:feed/<index>` without one.
   * `resolveFeed` passes it so the Propositions it schedules keep stable,
   * per-agent ids.
   */
  readonly agent?: NpcId;
}

/** The id minted for the composed item at `index`. */
function feedPropId(index: number, agent: NpcId | undefined): PropId {
  return agent === undefined ? `prop:feed/${index}` : `prop:feed/${agent}/${index}`;
}

/** Build a {@link Proposition} from a {@link ComposedProposition} and a minted id. */
function composedToProposition(composed: ComposedProposition, id: PropId): Proposition {
  return {
    id,
    subject: composed.subject,
    predicate: composed.predicate,
    object: composed.object,
    ...(composed.place === undefined ? {} : { place: composed.place }),
    ...(composed.window === undefined ? {} : { window: composed.window }),
  };
}

/** One item's outcome: its resolved Proposition when it is valid, and its errors. */
interface CheckedItem {
  readonly prop?: Proposition;
  readonly errors: readonly FeedError[];
}

/**
 * Apply rules 2–5 to the item at `index` (see the module header). A known-set
 * failure leaves the field's composed id in place, so the schema and window
 * rules still check the rest of the item.
 */
function checkItem(
  item: FeedItem,
  index: number,
  view: FeedView,
  content: ContentSet,
  agent: NpcId | undefined,
): CheckedItem {
  // Rule 2: the item's Proposition, from a held Claim or as composed. Only the
  // record's own keys count, so an id such as `constructor` is not "held".
  let base: Proposition;
  if (item.from === 'claim') {
    const held = Object.hasOwn(view.claims, item.claim)
      ? view.claims[item.claim]
      : undefined;
    if (held === undefined) {
      return {
        errors: [
          { index, field: 'claim', reason: `you hold no Case File Claim ${item.claim}` },
        ],
      };
    }
    base = held;
  } else {
    base = composedToProposition(item.prop, feedPropId(index, agent));
  }

  // Rule 3: known-set entities, with `unk:` ids resolved through held aliases.
  const entityErrors: FeedError[] = [];
  const resolveField = (id: EntityId, field: 'subject' | 'object' | 'place'): EntityId => {
    const outcome = resolveFeedEntity(id, view);
    if (outcome.ok) {
      return outcome.value;
    }
    entityErrors.push({ index, field, reason: outcome.error });
    return id;
  };
  const subject = resolveField(base.subject, 'subject');
  const object =
    typeof base.object === 'string' ? resolveField(base.object, 'object') : base.object;
  const place =
    base.place === undefined ? undefined : (resolveField(base.place, 'place') as LocId);
  const resolved: Proposition = {
    ...base,
    subject,
    object,
    ...(place === undefined ? {} : { place }),
  };

  // Rule 4: the derived predicate schema, for the fields rule 3 passed.
  const failed = new Set<FeedField>(entityErrors.map((e) => e.field));
  const schemaErrors = validatePropositionSchema(resolved, content, index).filter(
    (e) => !failed.has(e.field),
  );

  // Rule 5: the window lies within the next 7 days.
  const windowErrors = validateWindow(resolved, view.now, index);

  const errors = [...entityErrors, ...schemaErrors, ...windowErrors];
  return errors.length === 0 ? { prop: resolved, errors } : { errors };
}

/**
 * Validate a feed's items (Req 14.1, 14.2; pure, reads no truth, Req 14.3).
 * Returns `ok` with the resolved Propositions in item order (each `unk:` id
 * rewritten to the NPC its held alias names) when every rule passes. Otherwise
 * it returns every {@link FeedError} found, in rule order (see the module
 * header), so the feed composer can show them all and `quoteFeed` can give the
 * first one's reason (Req 14.4).
 */
export function validateFeedItems(
  items: readonly FeedItem[],
  view: FeedView,
  content: ContentSet,
  options: FeedValidationOptions = {},
): Result<Proposition[], FeedError[]> {
  const errors: FeedError[] = [];

  // Rule 1: the item count (Req 37.1).
  if (items.length < FEED_MIN_ITEMS || items.length > FEED_MAX_ITEMS) {
    errors.push({
      index: -1,
      field: 'items',
      reason: `a feed must carry ${FEED_MIN_ITEMS}–${FEED_MAX_ITEMS} items`,
    });
  }

  // Rules 2–5, item by item.
  const props: Proposition[] = [];
  items.forEach((item, index) => {
    const checked = checkItem(item, index, view, content, options.agent);
    if (checked.prop !== undefined) {
      props.push(checked.prop);
    }
    errors.push(...checked.errors);
  });

  return errors.length > 0 ? { ok: false, error: errors } : { ok: true, value: props };
}
