/**
 * The remaining content kinds from the design's content-kinds table:
 * Archetype, Location Type, Plot template, Side Thread template, Document
 * template, Persona library, Cover Identity and Rumour template.
 *
 * Each is a plain data shape the loader validates against before the world
 * generator instantiates it (Requirements 31.1, 31.2). The schemas capture the
 * key fields the design lists; richer per-field grammar (template parsing,
 * cross-reference resolution) is the loader's and template engine's job in
 * later tasks, so references here are validated as ids and template strings.
 */

import { z } from 'zod';
import {
  AllegianceSchema,
  ContentIdSchema,
  ContentRefSchema,
  DayCountSchema,
  PhaseSchema,
  ProbabilitySchema,
  RangeSchema,
  TagIdSchema,
  TagQuerySchema,
  TemplatePoolSchema,
  TemplateStringSchema,
  WeekdaySchema,
} from './common.js';

/**
 * The Tag field carried by every kind the Tag Vocabulary requires to be tagged
 * — archetypes, Location Types and Cover Identities here, plus the City kinds
 * elsewhere (content-expansion Req 4.3). A Tag is a vocabulary term of the form
 * `<facet>:<value>`. The field defaults to `[]` so a pack authored before the
 * Tag Vocabulary exists still parses; that every such item carries at least one
 * Tag, and that each Tag is a vocabulary Tag applicable to the kind, is the
 * loader's Tag check (content-expansion tasks 2.3, 7.1; Req 4.3, 4.4).
 */
const TagsFieldSchema = z.array(TagIdSchema).default([]);

// --- Archetype -------------------------------------------------------------

/** The roles an archetype can fill in a generated world. */
export const ARCHETYPE_ROLES = [
  'cell',
  'hostile-officer',
  'station-staff',
  'contact',
  'civilian',
] as const;
export const ArchetypeRoleSchema = z.enum(ARCHETYPE_ROLES);

/** MICE ranges: the strength band for each recruitment lever. */
export const MiceRangesSchema = z
  .object({
    money: RangeSchema,
    ideology: RangeSchema,
    coercion: RangeSchema,
    ego: RangeSchema,
  })
  .strict();

/**
 * One slot in an archetype schedule: on a given weekday and phase, the Tag
 * Query `at` the character is expected to be found by (content-expansion Req
 * 6.2). At generation the entry resolves to the Instantiated City's Binders of
 * `at`; a Location Type id is no longer named directly — the schedule binds
 * through the Tag Vocabulary like every other Tag Query (design, "Library
 * content"). When a city has no Binder for `at`, generation falls back to the
 * archetype's `fallback` query (see {@link ArchetypeSchema}).
 */
export const ScheduleSlotSchema = z
  .object({
    weekday: WeekdaySchema,
    phase: PhaseSchema,
    at: TagQuerySchema,
  })
  .strict();

/**
 * An archetype: the template for a Principal or Background NPC. Carries the
 * recruitment levers, wariness, which persona and descriptor pools dress the
 * character, its Tag Query `schedule` (with a `fallback` query used when a city
 * binds none of a slot's `at`) and the knowledge hooks the slicer later reads.
 */
export const ArchetypeSchema = z
  .object({
    id: ContentIdSchema,
    role: ArchetypeRoleSchema,
    allowedAllegiances: z
      .array(AllegianceSchema)
      .min(1, 'an archetype must allow at least one allegiance'),
    mice: MiceRangesSchema,
    wariness: RangeSchema,
    personaPools: z
      .array(ContentRefSchema)
      .min(1, 'an archetype must reference at least one persona pool'),
    descriptorPools: z
      .array(ContentRefSchema)
      .min(1, 'an archetype must reference at least one descriptor pool'),
    schedule: z.array(ScheduleSlotSchema).default([]),
    fallback: TagQuerySchema.optional(),
    knowledgeHooks: z.array(z.string()).default([]),
    tags: TagsFieldSchema,
  })
  .strict();
export type Archetype = z.infer<typeof ArchetypeSchema>;

// --- Location Type ---------------------------------------------------------

/** An opening-hours window for a weekday, as inclusive start/end phases. */
export const OpeningHoursSchema = z
  .object({
    weekday: WeekdaySchema,
    openPhase: PhaseSchema,
    closePhase: PhaseSchema,
  })
  .strict();

/** A crowd-level entry: how busy the Location is on a weekday and phase (0–1). */
export const CrowdCurveEntrySchema = z
  .object({
    weekday: WeekdaySchema,
    phase: PhaseSchema,
    level: ProbabilitySchema,
  })
  .strict();

/** A weather modifier: a multiplier on crowd for a named weather tag. */
export const WeatherModifierSchema = z
  .object({
    weather: z.string().min(1),
    crowdMultiplier: z.number().nonnegative(),
  })
  .strict();

/**
 * A Location Type: the template a concrete Location is stamped from. Fixes
 * whether it is public, which actions it allows, its hours and crowd curve,
 * weather response, base risk, whether it supports dead drops, the name
 * patterns the generator draws from, and its description and atmosphere pools.
 */
export const LocationTypeSchema = z
  .object({
    id: ContentIdSchema,
    public: z.boolean(),
    allowedActions: z
      .array(z.string().min(1))
      .min(1, 'a Location Type must allow at least one action'),
    openingHours: z.array(OpeningHoursSchema).default([]),
    crowdCurve: z.array(CrowdCurveEntrySchema).default([]),
    weatherModifiers: z.array(WeatherModifierSchema).default([]),
    baseRisk: ProbabilitySchema,
    allowsDeadDrops: z.boolean(),
    namePatterns: TemplatePoolSchema,
    descriptionPool: TemplatePoolSchema,
    atmosphereTags: z
      .array(z.string().min(1))
      .min(1, 'a Location Type needs at least one atmosphere tag'),
    tags: TagsFieldSchema,
  })
  .strict();
export type LocationType = z.infer<typeof LocationTypeSchema>;

// --- Plot / Side Thread templates ------------------------------------------

/** A role slot in a Plot, constrained to a set of archetypes. */
export const RoleSlotSchema = z
  .object({
    id: ContentIdSchema,
    archetypes: z
      .array(ContentRefSchema)
      .min(1, 'a role slot must allow at least one archetype'),
  })
  .strict();

/** A materiel or target slot a Plot threads through its stages. */
export const PlotSlotSchema = z
  .object({
    id: ContentIdSchema,
    description: z.string().min(1),
  })
  .strict();

// --- Trace template --------------------------------------------------------

/**
 * The kind of Sim event a trace renders to (design, "Clock, Plot and
 * Schedules"). A `meeting` names two role holders at a place; a `transmission`
 * sends on a Channel; a `drop-loaded` / `drop-emptied` works a dead drop; an
 * `npc-moved` is a movement. Execution (task 26.2) emits exactly this kind.
 */
export const TRACE_KINDS = [
  'meeting',
  'transmission',
  'drop-loaded',
  'drop-emptied',
  'npc-moved',
] as const;
export const TraceKindSchema = z.enum(TRACE_KINDS);

/**
 * The Channel a transmission or courier trace runs on, named by the kind of
 * Channel the owning organisation holds (design: a transmission trace resolves
 * its `channel` to the owning organisation's Channel of that kind). A
 * `dead-drop` is worked through the `drop-loaded`/`drop-emptied` kinds, not
 * named here.
 */
export const TRACE_CHANNEL_KINDS = ['radio', 'numbers', 'courier'] as const;
export const TraceChannelKindSchema = z.enum(TRACE_CHANNEL_KINDS);

/**
 * An UPPER_SNAKE_CASE predicate id, as a trace's `evidences` list names the key
 * Propositions the event makes observable (MEETS_AT, CARRIES, USES_CHANNEL, …).
 * The id grammar is checked here; that each id resolves to a loaded predicate
 * is a cross-reference the loader checks (Requirement 31.2).
 */
export const PredicateIdSchema = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,
    'an evidence must be an UPPER_SNAKE_CASE predicate id',
  );

/**
 * Where a trace's event happens (design, "Clock, Plot and Schedules"): a
 * Location named one of three ways, or the operation's bound target slot.
 * Exactly one of the three forms:
 *
 * - `locationType` — a Location of a named Location Type (a meeting, drop or
 *   movement destination stamped from that type);
 * - `query` — a Tag Query the event's Location must bind, resolved against the
 *   generated city's Locations by Effective Tags (own Tags together with their
 *   Location Type's Tags). Preferred over `locationType` for portable core
 *   content: a city satisfies the trace by tagging *some* Location for the
 *   function (`[function:cafe]`), not by stamping a specific type id;
 * - `target` — the bound target slot, so the event lands on the target the
 *   player is tracking.
 */
export const TracePlaceSchema = z.union([
  z.object({ locationType: ContentRefSchema }).strict(),
  z.object({ query: TagQuerySchema }).strict(),
  z.object({ target: ContentRefSchema }).strict(),
]);

/**
 * A structured trace: the observable event a Plot or Side Thread stage emits
 * (design, "Clock, Plot and Schedules"). It replaces the old free-prose trace
 * template with data the engine binds at instantiation and executes verbatim
 * (Requirements 3.3, 3.6):
 *
 * - `kind` fixes the Sim event the trace becomes;
 * - `roles` names the participating role slots — two for a meeting, one
 *   otherwise — resolved to the bound role holders;
 * - `place` (optional) names a Location Type to stamp a Location from, a Tag
 *   Query the hosting Location must bind, or a target slot whose bound Location
 *   hosts the event;
 * - `channel` (optional) names the Channel kind a transmission or courier
 *   hand-off runs on, resolved to the owning organisation's Channel;
 * - `materiel` (optional) names the materiel slot a drop or courier run
 *   carries, resolved to the bound item;
 * - `evidences` lists the key Propositions the event makes observable;
 * - `text` is the prose summary kept for the debrief and the Narrator's scene
 *   descriptor (the old trace prose lives here now).
 *
 * `roles`, `place.target` and `materiel` are content refs into the owning
 * template's `roleSlots`, `targetSlots` and `materielSlots`; `place.locationType`
 * is a Location Type ref; `place.query` is a Tag Query whose Tags the loader
 * checks against the Tag Vocabulary; and each `evidences` entry is a predicate
 * id. The loader checks every one of these references resolves (Requirement
 * 31.2).
 */
export const TraceTemplateSchema = z
  .object({
    kind: TraceKindSchema,
    roles: z.array(ContentRefSchema).default([]),
    place: TracePlaceSchema.optional(),
    channel: TraceChannelKindSchema.optional(),
    materiel: ContentRefSchema.optional(),
    evidences: z.array(PredicateIdSchema).default([]),
    text: z.string().min(1, 'a trace needs a prose summary'),
  })
  .strict();
export type TraceTemplate = z.infer<typeof TraceTemplateSchema>;

/**
 * One stage of a Plot. `requires`/`produces` name the stage-graph edges;
 * `traces` are the observable {@link TraceTemplate} events the stage emits;
 * `onDisrupted` weights the delay / reroute / abort response when the player
 * interferes.
 */
export const PlotStageSchema = z
  .object({
    id: ContentIdSchema,
    requires: z.array(ContentRefSchema).default([]),
    produces: z.array(ContentRefSchema).default([]),
    deadline: RangeSchema,
    traces: z.array(TraceTemplateSchema).default([]),
    onDisrupted: z
      .object({
        delay: z.number().nonnegative(),
        reroute: z.number().nonnegative(),
        abort: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();

/**
 * The shape shared by Plot and Side Thread templates. A Plot uses the full
 * shape; a Side Thread reuses it with no Cell roles and no deadline pressure.
 */
const scenarioTemplateShape = {
  id: ContentIdSchema,
  roleSlots: z.array(RoleSlotSchema).default([]),
  materielSlots: z.array(PlotSlotSchema).default([]),
  targetSlots: z.array(PlotSlotSchema).default([]),
  stages: z.array(PlotStageSchema).min(1, 'a plot must have at least one stage'),
  publicTraceArticles: z.array(TemplateStringSchema).default([]),
} as const;

/** A Plot template: the backbone of a generated game. */
export const PlotTemplateSchema = z.object(scenarioTemplateShape).strict();
export type PlotTemplate = z.infer<typeof PlotTemplateSchema>;

/**
 * A Side Thread template. Same shape as a Plot, but it must carry no Cell roles
 * and no deadline pressure, so it reads as background rather than the main
 * line. The role-slot and deadline constraints are enforced here.
 */
export const SideThreadTemplateSchema = z
  .object({
    ...scenarioTemplateShape,
    roleSlots: z
      .array(
        RoleSlotSchema.refine(
          (slot) => !slot.id.includes('cell'),
          'a Side Thread may not name a Cell role',
        ),
      )
      .default([]),
  })
  .strict();
export type SideThreadTemplate = z.infer<typeof SideThreadTemplateSchema>;

// --- Document template -----------------------------------------------------

/** The document kinds a template may produce. */
export const DOCUMENT_KINDS = [
  'newspaper',
  'dossier',
  'cable',
  'seized',
  'public-text',
] as const;
export const DocumentKindSchema = z.enum(DOCUMENT_KINDS);

/** A named body section built from a template, with the slots it fills. */
export const DocumentSectionSchema = z
  .object({
    id: ContentIdSchema,
    body: TemplateStringSchema,
  })
  .strict();

/** A Document template: a kind, a title pattern, body sections and slots. */
export const DocumentTemplateSchema = z
  .object({
    id: ContentIdSchema,
    kind: DocumentKindSchema,
    titlePattern: TemplateStringSchema,
    sections: z
      .array(DocumentSectionSchema)
      .min(1, 'a document template needs at least one section'),
    slots: z.array(ContentIdSchema).default([]),
  })
  .strict();
export type DocumentTemplate = z.infer<typeof DocumentTemplateSchema>;

// --- Persona library -------------------------------------------------------

/** The persona genders a name pool supplies given names for (Requirement 1.7). */
export const PERSONA_GENDERS = ['female', 'male'] as const;
export const PersonaGenderSchema = z.enum(PERSONA_GENDERS);

/**
 * A pool of names belonging to one culture *and* gender (design's content-kinds
 * table: "name pools by culture and gender"). `given` names belong to the
 * pool's `gender`; `family` names are gender-neutral, so a culture's two pools
 * typically share a family list. The generator picks a pool for an NPC's chosen
 * gender, then draws a given and a family name from it (Requirement 1.7).
 */
export const NamePoolSchema = z
  .object({
    culture: z.string().min(1),
    gender: PersonaGenderSchema,
    given: z.array(z.string().min(1)).min(1, 'a name pool needs given names'),
    family: z.array(z.string().min(1)).min(1, 'a name pool needs family names'),
  })
  .strict();

/**
 * A Persona library: name pools by culture plus the voice traits, mannerisms
 * and backgrounds the dialogue layer dresses an NPC with.
 */
export const PersonaLibrarySchema = z
  .object({
    id: ContentIdSchema,
    namePools: z
      .array(NamePoolSchema)
      .min(1, 'a persona library needs at least one name pool'),
    voiceTraits: z.array(z.string().min(1)).default([]),
    mannerisms: z.array(z.string().min(1)).default([]),
    backgrounds: TemplatePoolSchema,
  })
  .strict();
export type PersonaLibrary = z.infer<typeof PersonaLibrarySchema>;

// --- Cover Identity --------------------------------------------------------

/**
 * A Cover Identity the player can be issued: a title and employer org, the
 * Location Types where it fits plausibly, and the Cover Suspicion modifiers it
 * carries at those and other places.
 */
export const CoverIdentitySchema = z
  .object({
    id: ContentIdSchema,
    title: z.string().min(1),
    employerOrg: z.string().min(1),
    fitLocationTypes: z
      .array(ContentRefSchema)
      .min(1, 'a Cover Identity must fit at least one Location Type'),
    suspicionModifiers: z
      .object({
        atFit: z.number(),
        elsewhere: z.number(),
      })
      .strict(),
    tags: TagsFieldSchema,
  })
  .strict();
export type CoverIdentity = z.infer<typeof CoverIdentitySchema>;

// --- Rumour template -------------------------------------------------------

/** The distortions a Rumour applies to the predicate pattern it is built from. */
export const RUMOUR_DISTORTIONS = [
  'swap-subject',
  'shift-day',
  'invent-target',
] as const;
export const RumourDistortionSchema = z.enum(RUMOUR_DISTORTIONS);

/**
 * A Rumour template: a predicate pattern plus the distortions that turn a true
 * (or invented) fact into the false belief a Background NPC spreads.
 */
export const RumourTemplateSchema = z
  .object({
    id: ContentIdSchema,
    predicate: z
      .string()
      .regex(
        /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,
        'a rumour predicate must be an UPPER_SNAKE_CASE predicate id',
      ),
    distortions: z
      .array(RumourDistortionSchema)
      .min(1, 'a rumour needs at least one distortion'),
    shiftDays: DayCountSchema.optional(),
  })
  .strict();
export type RumourTemplate = z.infer<typeof RumourTemplateSchema>;
