/**
 * The core data model shared by the whole Sim: entity ids, game time, the
 * canonical `Proposition`, and the `Truth<T>` brand that fences ground truth
 * off from the Player View.
 *
 * These are the vocabulary types every other engine module is written against,
 * so they live on their own with no dependencies but Zod. Each type ships with
 * a Zod schema (for parsing untrusted input such as save files and model
 * output) and a JSON Schema export (for the structured-output contracts the LLM
 * Gateway sends to the model and for content validation). The shapes follow the
 * design's Data Models section exactly, so parsed data lines up with the static
 * types with no translation layer.
 *
 * Requirement 2.1: ground truth lives only in the Truth Store, reachable by
 * engine modules alone. The `Truth<T>` brand enforces that at compile time — a
 * branded value cannot be handed to a Player View constructor by accident.
 *
 * Requirement 7.2: extracted Claims are Propositions that use only the
 * Predicate Vocabulary and Entity Registry ids, validated against a JSON
 * schema. `PropositionSchema` and its JSON Schema export are that contract.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Entity ids
// ---------------------------------------------------------------------------

/**
 * The namespaces an {@link EntityId} may carry. Each is a short, lower-case tag
 * followed by `:` and a local id.
 *
 * - `npc`  — a person the Sim generated.
 * - `loc`  — a Location in the city.
 * - `org`  — an organisation (the Station, the Hostile Service, the Cell).
 * - `item` — Plot materiel and other tracked objects.
 * - `doc`  — a Document (newspaper, Dossier, Cable, seized material).
 * - `chan` — a communications Channel.
 * - `unk`  — an Unidentified Subject: a person the player has observed but not
 *            yet identified. Its local id is a non-negative integer (`unk:3`).
 */
export const ENTITY_NAMESPACES = [
  'npc',
  'loc',
  'org',
  'item',
  'doc',
  'chan',
  'unk',
] as const;

export type EntityNamespace = (typeof ENTITY_NAMESPACES)[number];

/**
 * A namespaced entity id, matching the design's Data Models union:
 *
 * ```ts
 * type EntityId =
 *   | `npc:${string}` | `loc:${string}` | `org:${string}`
 *   | `item:${string}` | `doc:${string}` | `chan:${string}`
 *   | `unk:${number}`;
 * ```
 *
 * The template-literal type keeps the namespace visible in the type system, so
 * a function that wants only a Location id can ask for `LocId` rather than a
 * bare string.
 */
export type NpcId = `npc:${string}`;
export type LocId = `loc:${string}`;
export type OrgId = `org:${string}`;
export type ItemId = `item:${string}`;
export type DocId = `doc:${string}`;
export type ChannelId = `chan:${string}`;
/** An Unidentified Subject id. The local part is a non-negative integer. */
export type UnkId = `unk:${number}`;

export type EntityId = NpcId | LocId | OrgId | ItemId | DocId | ChannelId | UnkId;

/**
 * A Dead Drop id (`drop:<local>`). A Dead Drop is a concealed site at a
 * Location, not an {@link EntityId} namespace, so it lives alongside the other
 * leaf ids here (in the dependency-free core model) rather than being tangled
 * into the state module. The full {@link import('./state.js').DeadDrop} record
 * is owned by task 5.4; this is only the id, which the city model
 * (`Location.deadDropSites`) and the state model both reference. Keeping it in
 * core.ts lets the city model name it without importing the state module, which
 * would otherwise form an import cycle.
 */
export type DeadDropId = `drop:${string}`;

/**
 * An Intercept id (`int:<local>`). An Intercept is the ciphertext the player
 * captures off a Channel (design, "Cipher Engine"), not an {@link EntityId}
 * namespace, so — like {@link DeadDropId} — its id lives here in the
 * dependency-free core model. The full {@link import('./state.js').Intercept}
 * record is owned by task 8.3 (`../cipher/intercept.ts`); keeping only the id in
 * core.ts lets the cipher module and `CipherSpec` name it without importing the
 * state module, which would otherwise form an import cycle (state re-exports the
 * Intercept interface from the cipher module).
 */
export type InterceptId = `int:${string}`;

/**
 * The local part of a namespaced id (everything after the first `:`) must be a
 * non-empty run of url-safe characters. `unk:` is the one exception and is
 * handled separately so its local part is a plain integer with no leading zero.
 */
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const UNK_LOCAL = /^(?:0|[1-9][0-9]*)$/;

/** True when `value` is a well-formed id in the given namespace. */
function isNamespaced(value: string, ns: EntityNamespace): boolean {
  const prefix = `${ns}:`;
  if (!value.startsWith(prefix)) {
    return false;
  }
  const local = value.slice(prefix.length);
  return ns === 'unk' ? UNK_LOCAL.test(local) : LOCAL_ID.test(local);
}

/** True when `value` is a well-formed id in any entity namespace. */
export function isEntityId(value: string): value is EntityId {
  return ENTITY_NAMESPACES.some((ns) => isNamespaced(value, ns));
}

const ENTITY_ID_MESSAGE =
  'Entity id must be "<namespace>:<local>" with namespace one of ' +
  `${ENTITY_NAMESPACES.join(', ')} (unk uses a non-negative integer local id)`;

/**
 * Build a Zod schema for one entity namespace. JSON Schema has no
 * template-literal strings, so each namespace is exported as a `string` with a
 * `pattern`, which is faithful enough for structured-output validation and
 * keeps the generated schema readable.
 */
function namespacedSchema<N extends EntityNamespace>(
  ns: N,
): z.ZodType<`${N}:${string}`> {
  const localPattern = ns === 'unk' ? '(?:0|[1-9][0-9]*)' : '[A-Za-z0-9][A-Za-z0-9_-]*';
  return z
    .string()
    .regex(new RegExp(`^${ns}:${localPattern}$`), `Expected a "${ns}:" id`)
    .meta({ id: `${capitalize(ns)}Id` }) as unknown as z.ZodType<`${N}:${string}`>;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export const NpcIdSchema = namespacedSchema('npc');
export const LocIdSchema = namespacedSchema('loc');
export const OrgIdSchema = namespacedSchema('org');
export const ItemIdSchema = namespacedSchema('item');
export const DocIdSchema = namespacedSchema('doc');
export const ChannelIdSchema = namespacedSchema('chan');
export const UnkIdSchema = namespacedSchema('unk');

/** Parser for any {@link EntityId}. */
export const EntityIdSchema: z.ZodType<EntityId> = z
  .string()
  .refine(isEntityId, ENTITY_ID_MESSAGE)
  .meta({ id: 'EntityId', description: 'A namespaced entity id, e.g. "npc:ana".' }) as unknown as z.ZodType<EntityId>;

// ---------------------------------------------------------------------------
// Game time
// ---------------------------------------------------------------------------

/**
 * The four phases a day is divided into (Requirement 3.1). The Sim stores a
 * phase as its ordinal `0 | 1 | 2 | 3` (the design's Data Models `GameTime`),
 * which is what sorts and arithmetic want; {@link PHASE_NAMES} maps each
 * ordinal to its name for display and for content that speaks of "morning".
 */
export const PHASE_NAMES = ['morning', 'afternoon', 'evening', 'night'] as const;

/** A phase name, as used in the requirements and surfaced to the player. */
export type PhaseName = (typeof PHASE_NAMES)[number];

/** A phase ordinal: `0` morning, `1` afternoon, `2` evening, `3` night. */
export type Phase = 0 | 1 | 2 | 3;

/** The number of phases in a day. */
export const PHASES_PER_DAY = PHASE_NAMES.length;

/** The name of a phase ordinal. */
export function phaseName(phase: Phase): PhaseName {
  return PHASE_NAMES[phase];
}

/** The ordinal of a phase name, or `undefined` if the name is unknown. */
export function phaseOrdinal(name: string): Phase | undefined {
  const index = PHASE_NAMES.indexOf(name as PhaseName);
  return index === -1 ? undefined : (index as Phase);
}

export const PhaseSchema: z.ZodType<Phase> = z
  .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
  .meta({
    id: 'Phase',
    description:
      'A phase of the day as an ordinal: 0 morning, 1 afternoon, 2 evening, 3 night.',
  }) as z.ZodType<Phase>;

/**
 * A point in game time: a non-negative `day` counter and a `phase` ordinal.
 * Matches the design's `type GameTime = { day: number; phase: 0|1|2|3 }`.
 */
export interface GameTime {
  readonly day: number;
  readonly phase: Phase;
}

export const GameTimeSchema: z.ZodType<GameTime> = z
  .strictObject({
    day: z.int().min(0, 'day must be a non-negative integer'),
    phase: PhaseSchema,
  })
  .meta({ id: 'GameTime', description: 'A day counter and a phase ordinal.' });

/** Total phases from the start of day 0, so times compare as plain numbers. */
export function timeToPhases(t: GameTime): number {
  return t.day * PHASES_PER_DAY + t.phase;
}

/** Order two times: negative if `a` is earlier, positive if later, 0 if equal. */
export function compareTime(a: GameTime, b: GameTime): number {
  return timeToPhases(a) - timeToPhases(b);
}

// ---------------------------------------------------------------------------
// Literals and propositions
// ---------------------------------------------------------------------------

/**
 * A literal object value, for predicates whose object is not an entity: a free
 * text fragment, a money amount, or a point in game time. Matches the design's
 * `Literal` union.
 */
export type Literal =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'amount'; readonly value: number }
  | { readonly kind: 'time'; readonly value: GameTime };

export const LiteralSchema: z.ZodType<Literal> = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('text'), value: z.string() }),
    z.strictObject({ kind: z.literal('amount'), value: z.number() }),
    z.strictObject({ kind: z.literal('time'), value: GameTimeSchema }),
  ])
  .meta({ id: 'Literal' });

/** A predicate id, namespaced `<pack>/<name>` by the content loader. */
export type PredicateId = string;

/** A proposition id, assigned by the Sim when a Proposition is minted. */
export type PropId = string;

/**
 * A half-open time window: in effect from `from`, and until `to` if `to` is
 * given (an open-ended window omits `to`). Matches the design's
 * `window?: { from: GameTime; to?: GameTime }`.
 */
export interface TimeWindow {
  readonly from: GameTime;
  readonly to?: GameTime;
}

export const TimeWindowSchema: z.ZodType<TimeWindow> = z
  .strictObject({
    from: GameTimeSchema,
    to: GameTimeSchema.optional(),
  })
  .meta({ id: 'TimeWindow' });

/**
 * A canonical fact of the form (subject, predicate, object, optional place,
 * optional time window), using the Predicate Vocabulary and Entity Registry ids
 * (Glossary; Requirement 7.2). This is the single shape for ground-truth facts,
 * Documents' assertions and extracted Claims; what differs between them is where
 * they are stored and whether they are wrapped in {@link Truth}.
 *
 * `place`, when present, is a Location id. `object` is either an entity id or a
 * {@link Literal}.
 */
export interface Proposition {
  readonly id: PropId;
  readonly subject: EntityId;
  readonly predicate: PredicateId;
  readonly object: EntityId | Literal;
  readonly place?: LocId;
  readonly window?: TimeWindow;
}

/**
 * The object of a Proposition: an entity id or a literal. The entity branch is
 * tried first; `isEntityId` rejects anything that is not a well-formed id, so a
 * plain string falls through to the literal branch rather than being accepted
 * as an id.
 */
export const PropositionObjectSchema: z.ZodType<EntityId | Literal> = z.union([
  EntityIdSchema,
  LiteralSchema,
]);

export const PropositionSchema: z.ZodType<Proposition> = z
  .strictObject({
    id: z.string().min(1),
    subject: EntityIdSchema,
    predicate: z.string().min(1),
    object: PropositionObjectSchema,
    place: LocIdSchema.optional(),
    window: TimeWindowSchema.optional(),
  })
  .meta({
    id: 'Proposition',
    description:
      'A canonical fact: subject, predicate, object, optional place and time window.',
  });

// ---------------------------------------------------------------------------
// The Truth<T> brand
// ---------------------------------------------------------------------------

declare const truthBrand: unique symbol;

/**
 * A ground-truth value that must not cross into the Player View (Requirement
 * 2.1). `Truth<T>` is `T` tagged with a phantom brand: it carries the same data
 * at runtime, but the type system refuses to pass it where a plain `T` — the
 * kind of value the Player View is built from — is expected. Only the Truth
 * Store mints and reads these, so a view projection cannot accidentally leak a
 * true allegiance or a concealed Proposition.
 *
 * The brand is erased at runtime, so a `Truth<T>` serialises exactly like its
 * `T`; it never appears in a Player View projection or a save's view section.
 */
export type Truth<T> = T & { readonly [truthBrand]: 'truth' };

/**
 * Tag a value as ground truth. Call this only inside the Truth Store (or world
 * generation feeding it); nothing in the Player View should ever need it.
 */
export function asTruth<T>(value: T): Truth<T> {
  return value as Truth<T>;
}

/**
 * Drop the truth brand, yielding the plain value. Reserved for engine modules
 * that have already decided a value may be revealed (for example, composing a
 * Fact Line from an Observation that the player directly perceived).
 */
export function revealTruth<T>(value: Truth<T>): T {
  return value;
}

/**
 * A Zod schema for a {@link Truth} of the values parsed by `inner`. The brand is
 * a compile-time fiction, so this is `inner` with the result retyped; it exists
 * so a save loader can parse a Truth-wrapped field without an unchecked cast.
 */
export function truthSchema<T>(inner: z.ZodType<T>): z.ZodType<Truth<T>> {
  return inner as unknown as z.ZodType<Truth<T>>;
}

// ---------------------------------------------------------------------------
// JSON Schema exports
// ---------------------------------------------------------------------------

/**
 * A JSON Schema document, as produced by `z.toJSONSchema` for a single schema.
 * `z.toJSONSchema` is overloaded (schema vs. registry), so this pins the
 * single-schema payload shape rather than letting `ReturnType` collapse to the
 * registry overload.
 */
export type JsonSchema = ReturnType<typeof z.toJSONSchema<z.ZodType>>;

/**
 * The core types that get a JSON Schema export, keyed by name. These feed the
 * LLM Gateway's structured-output contracts (Requirement 7.2) and content
 * validation. `Truth<T>` is deliberately absent: its brand has no runtime
 * shape, so its JSON Schema is identical to the wrapped type's.
 */
const SCHEMA_EXPORTS: Record<string, z.ZodType> = {
  EntityId: EntityIdSchema,
  Phase: PhaseSchema,
  GameTime: GameTimeSchema,
  TimeWindow: TimeWindowSchema,
  Literal: LiteralSchema,
  Proposition: PropositionSchema,
};

/** The names of the core types with a JSON Schema export. */
export const CORE_SCHEMA_NAMES = [
  'EntityId',
  'Phase',
  'GameTime',
  'TimeWindow',
  'Literal',
  'Proposition',
] as const;

/** The name of a core type with a JSON Schema export. */
export type CoreSchemaName = (typeof CORE_SCHEMA_NAMES)[number];

/** The JSON Schema for one named core type. */
export function jsonSchemaFor(name: CoreSchemaName): JsonSchema {
  return z.toJSONSchema(SCHEMA_EXPORTS[name]);
}

/** The JSON Schema for every named core type, keyed by name. */
export function coreJsonSchemas(): Record<CoreSchemaName, JsonSchema> {
  const out = {} as Record<CoreSchemaName, JsonSchema>;
  for (const name of CORE_SCHEMA_NAMES) {
    out[name] = z.toJSONSchema(SCHEMA_EXPORTS[name]);
  }
  return out;
}
