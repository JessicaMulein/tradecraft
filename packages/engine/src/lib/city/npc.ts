/**
 * Organisations and Principal NPCs: the shapes the world generator's second and
 * third core-stream steps produce (design, "World Generator", steps 2–3;
 * Requirements 1.1, 1.3, 27.1).
 *
 * This module owns the real {@link Org} and {@link Npc} interfaces that replace
 * the skeleton placeholders in `../model/state.ts`. It owns *shapes* only; the
 * generation that stamps them lives in `./principals.ts`, and the pure
 * play-time code that reads them lands in later tasks (recruitment, dialogue,
 * the action resolver). Keeping the interfaces here — the way `./city.ts` owns
 * the `City` interface — lets `state.ts` re-export them under the names
 * `WorldState.orgs` and `WorldState.npcs` use, so every importer keeps compiling
 * once the placeholders are filled in.
 *
 * The design fixes what a Principal NPC carries (Requirement 1.3): a true and
 * an apparent allegiance, a MICE profile, a persona, a physical descriptor, a
 * schedule, and — for the recruitment and surveillance mechanics that read them
 * later — a money need, a wariness, an openness, a tradecraft rating and a
 * reliability. The truth-bearing fields (the true allegiance, the money need,
 * the reliability) are branded {@link Truth} so the type system refuses to let
 * them cross into the Player View (Requirement 2.1); the apparent allegiance,
 * the persona and the descriptor are view-safe flavour the player reads
 * directly.
 */

import {
  type GameTime,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
  type Truth,
} from '../model/core.js';
import { type Allegiance } from '../truth/truth.js';

// ---------------------------------------------------------------------------
// Allegiance category (apparent allegiance)
// ---------------------------------------------------------------------------

/**
 * The allegiance categories a character may *present* (the content vocabulary's
 * `ALLEGIANCES`). This is the view-safe apparent allegiance — the loyalty the
 * player sees before they establish otherwise — not the ground-truth
 * {@link Allegiance} (an {@link OrgId}) the Truth Store holds. `unknown` covers
 * a character whose loyalty the player has not established.
 *
 * The list is duplicated from the content package's `ALLEGIANCES` rather than
 * imported as a value so the engine's model layer carries no runtime dependency
 * on content; the two are kept in step by a test.
 */
export const ALLEGIANCE_CATEGORIES = [
  'station',
  'hostile',
  'cell',
  'neutral',
  'unknown',
] as const;

/** An apparent-allegiance category (view-safe). */
export type AllegianceCategory = (typeof ALLEGIANCE_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Org
// ---------------------------------------------------------------------------

/**
 * The kind of organisation (design, "World Generator", step 2). Exactly three
 * organisations exist in a generated world: the player's own {@link
 * OrgKind.station|Station}, the opposing {@link OrgKind.hostile|Hostile
 * Service}, and the {@link OrgKind.cell|Cell} the player is hunting.
 */
export const ORG_KINDS = ['station', 'hostile', 'cell'] as const;

/** The kind of one organisation. */
export type OrgKind = (typeof ORG_KINDS)[number];

/**
 * An organisation record (the design's `Org`). The Station, the Hostile Service
 * and the Cell are each an {@link Org}. `allegiance` is the apparent-allegiance
 * category the org projects, which doubles as the category every NPC who truly
 * serves it presents when they are not under cover: a Station officer reads
 * `station`, a Cell member `cell`, a hostile officer `hostile`.
 *
 * An org is view-safe: it carries a name and a kind, never a concealed
 * Proposition or a hidden roster. Membership is held as ground-truth
 * `MEMBER_OF` facts in the Truth Store, not as a list on the org, so a view
 * projection of the org leaks nothing about who really belongs to it.
 */
export interface Org {
  readonly id: OrgId;
  readonly name: string;
  readonly kind: OrgKind;
  /** The apparent-allegiance category the org projects. */
  readonly allegiance: AllegianceCategory;
}

// ---------------------------------------------------------------------------
// MICE profile
// ---------------------------------------------------------------------------

/**
 * A sampled MICE profile: the strength of each recruitment lever in `[0, 1]`,
 * drawn from the archetype's MICE ranges (Glossary, MICE; Requirement 27.1).
 * This is hidden ground truth — the Player View must never read it (Requirement
 * 2.2) — so the whole profile is branded {@link Truth} on the {@link Npc}.
 */
export interface MiceProfile {
  readonly money: number;
  readonly ideology: number;
  readonly coercion: number;
  readonly ego: number;
}

// ---------------------------------------------------------------------------
// Persona and descriptor
// ---------------------------------------------------------------------------

/**
 * The persona dressed onto an NPC from its archetype's persona pools: a
 * fictional name drawn from a culture's name pool, the culture it came from,
 * and the voice traits, mannerisms and background the dialogue layer later
 * speaks the NPC with. `openness` is the sampled sociability the Cold Approach
 * check reads (design, "Approach").
 *
 * The persona is view-safe — it is exactly the surface the player sees and
 * talks to — so it carries no truth brand. The NPC's canonical name in the
 * Entity Registry is this persona's `name`.
 */
export interface Persona {
  /** The fictional display name (`given family`). */
  readonly name: string;
  readonly given: string;
  readonly family: string;
  /** The persona library id the name was drawn from. */
  readonly library: string;
  /** The name pool's culture tag. */
  readonly culture: string;
  /**
   * The persona's gender (`female` or `male`), which gates both the name pool
   * the name was drawn from and the descriptor entries the NPC wears
   * (Requirement 1.7).
   */
  readonly gender: 'female' | 'male';
  readonly voiceTraits: readonly string[];
  readonly mannerisms: readonly string[];
  readonly background: string;
  /** Sampled sociability in `[0, 1]`, read by the Cold Approach check. */
  readonly openness: number;
}

/**
 * The physical descriptor dressed onto an NPC from its archetype's descriptor
 * pools (Requirement 1.3). `phrases` are the period-correct appearance lines a
 * Narrator or Fact Line slots in; `pools` records which descriptor pools they
 * were drawn from (or the raw pool id, when the pool is one the descriptor file
 * does not define — the generator falls back rather than failing). `summary` is
 * the one-line form the People view and an Unidentified-Subject label show.
 *
 * The descriptor is view-safe flavour: it is how the player sees the person
 * before (and after) identifying them, so it carries no truth brand.
 */
export interface Descriptor {
  readonly summary: string;
  readonly phrases: readonly string[];
  readonly pools: readonly string[];
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * One concrete entry in an NPC's schedule: on a weekday and an engine phase,
 * the Location the NPC is expected at. The generator maps each archetype
 * schedule-template slot (a Location *Type* at a content weekday and phase)
 * onto a concrete {@link LocId} of a Location of that type in the generated
 * city, folding the eight content phases onto the four engine phases.
 *
 * `weekday` is `0` Monday … `6` Sunday, matching `../city/time-mapping.ts`'s
 * day-to-weekday convention, so a caller comparing against a {@link GameTime}
 * can derive the weekday with `weekdayForDay(day)` and the phase directly.
 */
export interface ScheduleEntry {
  /** `0` Monday … `6` Sunday. */
  readonly weekday: number;
  readonly phase: Phase;
  readonly loc: LocId;
}

/**
 * An NPC's concrete schedule: where they are, by weekday and phase, over a
 * representative week (design, step 3; Requirement 1.3). The entries are drawn
 * from the archetype's schedule templates mapped onto real city Locations, so
 * every `loc` is a Location that exists in the generated city.
 */
export interface NpcSchedule {
  readonly entries: readonly ScheduleEntry[];
}

/** The Location an NPC is expected at on a weekday and phase, if any. */
export function scheduledLocation(
  schedule: NpcSchedule,
  weekday: number,
  phase: Phase,
): LocId | undefined {
  for (const entry of schedule.entries) {
    if (entry.weekday === weekday && entry.phase === phase) {
      return entry.loc;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// NPC status (at large, arrested or fled)
// ---------------------------------------------------------------------------

/**
 * Whether an NPC is still at large (the design's `Npc.status`). `active` is the
 * generation default. `arrested` and `fled` take the NPC out of play: the live
 * Disruption Context reports either as arrested, so a Plot Stage whose own
 * traces need the NPC is disrupted (slice-integration Req 4.2).
 *
 * The slice design's union also names `missing`. Nothing in the slice or the
 * integration spec produces it, so it is left out until a mechanic needs it.
 */
export const NPC_STATUSES = ['active', 'arrested', 'fled'] as const;

/** One NPC status. */
export type NpcStatus = (typeof NPC_STATUSES)[number];

// ---------------------------------------------------------------------------
// Npc
// ---------------------------------------------------------------------------

/**
 * A Principal (or, later, Background) NPC — the design's `Npc` (Requirement
 * 1.3). Generated from an archetype, it carries everything the design's step-3
 * list names, split cleanly along the truth boundary:
 *
 * Ground truth (branded {@link Truth}, never in the Player View):
 * - `trueAllegiance` — the organisation the NPC really serves, an {@link
 *   OrgId}. A Double Agent's true allegiance differs from its apparent one
 *   (Requirement 11.1); turning an agent changes this (Requirement 11.3).
 * - `mice` — the hidden recruitment-lever profile.
 * - `moneyNeed` — how much money motivates the NPC, derived from the money
 *   lever; read by `resolvePitch`'s offer scaling (design, "Recruitment").
 * - `reliability` — `[0, 1]`, from the archetype and persona; read by Asset
 *   reporting (Requirement 10.4).
 * - `tradecraft` / `securityConsciousness` — the surveillance-evasion ratings
 *   the surveil and follow checks read (design, "Surveil").
 * - `status` — whether the NPC is at large, arrested or has fled; `active` at
 *   generation.
 *
 * View-safe (read directly by the player):
 * - `apparentAllegiance` — the allegiance category the NPC presents.
 * - `persona` — the name, voice and background the player sees and talks to.
 * - `descriptor` — the physical appearance.
 * - `schedule` — where the NPC is by weekday and phase (the player learns this
 *   by observation; the schedule itself is not secret, the inferences are).
 * - `wariness` — how guarded the NPC is before any pitch (archetype-sampled).
 * - `archetype` / `role` / `org` — provenance the generator and later systems
 *   key off.
 *
 * The NPC's canonical name and aliases live in the Entity Registry, not here;
 * `persona.name` is that canonical name. Knowledge Slices, Cover Stories and
 * Agendas are assigned by task 5.5 and are not part of this shape.
 */
export interface Npc {
  readonly id: NpcId;
  /** The namespaced archetype id the NPC was stamped from. */
  readonly archetype: string;
  /** The archetype role (`cell`, `hostile-officer`, `station-staff`, …). */
  readonly role: string;
  /** The organisation the NPC belongs to by role, or `undefined` for a free agent. */
  readonly org?: OrgId;

  /** Ground truth: the org the NPC really serves. */
  readonly trueAllegiance: Truth<Allegiance>;
  /** View-safe: the allegiance category the NPC presents. */
  readonly apparentAllegiance: AllegianceCategory;

  /** Ground truth: the sampled MICE profile. */
  readonly mice: Truth<MiceProfile>;
  /** Ground truth: how much money motivates the NPC (a currency amount). */
  readonly moneyNeed: Truth<number>;
  /** Ground truth: Asset reporting reliability in `[0, 1]`. */
  readonly reliability: Truth<number>;
  /** Ground truth: surveillance-evasion skill in `[0, 1]`. */
  readonly tradecraft: Truth<number>;
  /** Ground truth: how likely the NPC is to detect being watched, `[0, 1]`. */
  readonly securityConsciousness: Truth<number>;
  /**
   * Ground truth: the NPC's loyalty to the service they truly serve, in
   * `[0, 1]` (design: `Npc.loyalty`). Meaningful for hostile agents — the turn
   * attempt resists a high loyalty, and a failed turn is reported to the Hostile
   * Service with p ∝ loyalty (design, "Turning"; Req 36.3). Optional on the
   * engine model: the generator does not yet sample it, so the turn-agent
   * resolver falls back to a neutral default when it is absent. Only the Sim
   * reads it; the Player View never sees it.
   */
  readonly loyalty?: Truth<number>;
  /**
   * Ground truth: whether the NPC is at large, arrested or has fled (design:
   * `Npc.status`). Generation sets `active`. It is ground truth because an
   * arrest by the Hostile Service, or a flight, is a hidden event the player
   * learns of only through its consequences (Req 39.4). Optional so hand-built
   * NPCs need not set it; an absent status reads as `active`.
   *
   * A Station arrest is recorded elsewhere: Station Custody on the NPC's
   * Relationship and the Station's arrest record (`player.arrests`). The live
   * Disruption Context (`../clock/disruption.ts`) reads all three.
   */
  readonly status?: Truth<NpcStatus>;

  readonly persona: Persona;
  readonly descriptor: Descriptor;
  readonly schedule: NpcSchedule;
  /** View-adjacent: how guarded the NPC is before a pitch, `[0, 1]`. */
  readonly wariness: number;

  /**
   * View-safe: the Culture Group the NPC's name was drawn from (its namespaced
   * {@link import('../setting/content-set-v2.js').CultureGroupId}), set by the
   * setting step's `nameNpc` (content-expansion task 3.4; Req 7.1). It records
   * the authored culture the given name, family name and Naming Rule came from
   * so the dialogue layer and the Preview CLI can speak the NPC in that culture.
   *
   * Optional on the engine model: the slice generator (`principals.ts`,
   * `background.ts`) still stamps NPCs from the core pack's persona pools, which
   * carry no Culture Group; those NPCs leave it unset. The content-expansion
   * generator wiring (task 3.8) sets it from `nameNpc` when a City Pack is
   * selected. It is apparent data — the Player View may read it (design,
   * "Preserving slice invariants": the new NPC fields are apparent).
   */
  readonly culture?: string;
  /**
   * View-safe: the NPC's gender, drawn uniformly before the Culture Group so the
   * name and descriptor draws match it (content-expansion Req 7.1; design,
   * "Naming"). `'f'`/`'m'` matches the Culture Group and Descriptor Fragment
   * gender tags the setting step filters on, which differ from the slice
   * persona's `'female'`/`'male'` spelling. Optional for the same reason as
   * {@link Npc.culture}: slice-stamped NPCs carry only `persona.gender`.
   */
  readonly gender?: 'f' | 'm';
  /**
   * View-safe: the languages the NPC's Culture Group speaks (the Culture Group's
   * `languages`), set by the setting step's `nameNpc` (content-expansion
   * Req 7.1). Carried so later systems — dialogue, cover checks — can read the
   * NPC's languages without re-resolving the Culture Group. Optional: unset for
   * slice-stamped NPCs.
   */
  readonly languages?: readonly string[];
  /**
   * View-safe: the formal rendering of the NPC's name through its Naming Rule's
   * `formal` pattern (e.g. "Herr Lang"), set by the setting step's `nameNpc`
   * (content-expansion Req 7.1). The honorific is filled from the Locale when
   * the generator wires the Locale in (task 3.6); `nameNpc` renders the pattern
   * with the parts it draws and leaves a Locale-supplied `{honorific}` slot for
   * that step. Optional: unset for slice-stamped NPCs, whose display name is
   * `persona.name`.
   */
  readonly formalName?: string;
}
