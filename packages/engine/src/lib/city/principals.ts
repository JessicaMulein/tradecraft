/**
 * Organisations and Principal NPCs: steps 2 and 3 of the world generator's core
 * stream (design, "World Generator"; Requirements 1.1, 1.3, 27.1).
 *
 * {@link generateOrgs} mints the three organisations every game has — the
 * Station, the Hostile Service and the Cell — and {@link generatePrincipals}
 * stamps the Principal NPCs from the core pack's archetypes: the four Cell
 * roles, the two hostile officers, the Chief of Station and two-to-three staff,
 * and two-to-three starting contacts. Both are pure functions of the core PRNG
 * stream, the loaded {@link ContentSet}, the {@link DescriptorData} descriptor
 * pools, and the generated {@link City} (step 1), so the result is a pure
 * function of the seed and the content (Requirement 1.2, underpinning Property
 * 1 — seed determinism).
 *
 * Each NPC gets, per the design's step-3 list and Requirement 1.3:
 *
 * - a **true allegiance** (the {@link OrgId} it really serves, set from the
 *   archetype role) and an **apparent allegiance** (the category it *presents*,
 *   derived from its public post / Cover Story — not its covert role). A Cell
 *   member truly serves the Cell but presents `neutral` under cover; a hostile
 *   officer serves the Hostile Service and presents `hostile` only in a declared
 *   mission post (else `neutral` under civilian cover); Station staff serve and
 *   present `station`; a contact presents `neutral` while truly a quiet Station
 *   friend. Both values are engine-side ground-truth structure (the Truth
 *   allegiance pair); the Player View learns apparent affiliation only from
 *   Claims and Dossiers. Double Agents, whose apparent and true allegiances
 *   diverge further, are handled by later tasks; the shape already supports them.
 * - a **MICE profile** sampled lever-by-lever from the archetype's MICE ranges;
 * - a **money need** derived from the money lever;
 * - a **persona** — a fictional name drawn from one of the archetype's persona
 *   libraries' culture pools, plus the voice, mannerisms and background the
 *   dialogue layer later speaks it with;
 * - a **persona gender** (`female` or `male`), drawn before the name so the
 *   name comes from a matching-gender pool and the descriptor draws only
 *   entries that fit it (Requirement 1.7);
 * - a **physical descriptor** drawn from the archetype's descriptor pools,
 *   using only entries whose `fits` tag suits the persona's gender, and
 *   redrawn until it differs from every other Principal's in at least two
 *   elements (Requirement 1.7). The loader guarantees every named pool exists,
 *   so there is no missing-pool fall-back for a loaded pack;
 * - a **schedule** of concrete Locations by weekday and phase, mapping each
 *   archetype schedule-template slot onto a Location of the matching Location
 *   Type in the generated city.
 *
 * The truth-bearing fields (true allegiance, MICE, money need, reliability,
 * tradecraft) are returned both on the {@link Npc} (branded {@link Truth}) and,
 * for the true allegiance, as a separate list the caller writes into the Truth
 * Store; the Entity Registry entries (canonical name plus a generic descriptor
 * alias) are returned so the caller can register every NPC's name for the Leak
 * Guard. Determinism rests on drawing every random choice from the passed
 * {@link Prng} in a fixed order over an id-sorted archetype list.
 */

import {
  asTruth,
  type NpcId,
  type OrgId,
  type Phase,
} from '../model/core.js';
import { type Prng } from '../prng/prng.js';
import { type Allegiance } from '../truth/truth.js';
import { type Alias, type EntityEntry } from '../model/registry.js';
import {
  ALLEGIANCE_CATEGORIES,
  type AllegianceCategory,
  type Descriptor,
  type MiceProfile,
  type Npc,
  type NpcSchedule,
  type NpcStatus,
  type Org,
  type OrgKind,
  type Persona,
  type ScheduleEntry,
} from './npc.js';
import { type City } from './city.js';
import {
  cityScheduleBinder,
  missionSlotCount,
  nonMissionSlotMax,
  resolveScheduleCandidates,
  MISSION_TAG,
  type CityScheduleBinder,
} from './schedule-binding.js';
import {
  CONTENT_WEEKDAYS,
  enginePhaseOf,
  type ContentPhase,
} from './time-mapping.js';
import type {
  Archetype,
  ContentSet,
  DescriptorData,
  PersonaGender,
  PersonaLibrary,
} from '@tradecraft/content';
import { fittingPhrases } from '@tradecraft/content';

// ---------------------------------------------------------------------------
// Organisation ids and the three orgs
// ---------------------------------------------------------------------------

/** The canonical id of the player's Station. */
export const STATION_ORG_ID = 'org:station' as OrgId;
/** The canonical id of the opposing Hostile Service. */
export const HOSTILE_ORG_ID = 'org:hostile' as OrgId;
/** The canonical id of the Cell the player is hunting. */
export const CELL_ORG_ID = 'org:cell' as OrgId;

/** The three organisations keyed by {@link OrgId}, as `WorldState.orgs` holds them. */
export interface GeneratedOrgs {
  readonly orgs: Readonly<Record<OrgId, Org>>;
  readonly station: Org;
  readonly hostile: Org;
  readonly cell: Org;
}

/** The display name pool for each org kind; one is drawn per generation. */
const ORG_NAME_POOLS: Readonly<Record<OrgKind, readonly string[]>> = {
  station: ['the Station', 'Vienna Station', 'the Field Station'],
  hostile: ['the Hostile Service', 'the opposing service', 'the Resident network'],
  cell: ['the Cell', 'the network', 'the ring'],
  front: ['a local crew'],
};

/** The apparent-allegiance category each org projects. */
const ORG_ALLEGIANCE: Readonly<Record<OrgKind, AllegianceCategory>> = {
  station: 'station',
  hostile: 'hostile',
  cell: 'cell',
  front: 'neutral',
};

/**
 * Mint the three organisations (design, "World Generator", step 2;
 * Requirement 1.1). The names are drawn from fixed per-kind pools on the core
 * stream, so which name each org carries varies by seed while the ids stay
 * canonical.
 */
export function generateOrgs(prng: Prng, hostileName?: string): GeneratedOrgs {
  const make = (id: OrgId, kind: OrgKind): Org => ({
    id,
    name: prng.pick(ORG_NAME_POOLS[kind]),
    kind,
    allegiance: ORG_ALLEGIANCE[kind],
  });
  // Draw order is fixed: station, hostile, cell. A posting still draws the
  // hostile name, then replaces it, so the cell draw stays on the same sample.
  const station = make(STATION_ORG_ID, 'station');
  const drawnHostile = make(HOSTILE_ORG_ID, 'hostile');
  const hostile =
    hostileName === undefined ? drawnHostile : { ...drawnHostile, name: hostileName };
  const cell = make(CELL_ORG_ID, 'cell');
  const orgs: Record<OrgId, Org> = {
    [STATION_ORG_ID]: station,
    [HOSTILE_ORG_ID]: hostile,
    [CELL_ORG_ID]: cell,
  };
  return { orgs, station, hostile, cell };
}

// ---------------------------------------------------------------------------
// Which archetypes fill which Principal roles
// ---------------------------------------------------------------------------

/** The four Cell roles, in a fixed order, all always present (Requirement 1.1). */
export const CELL_ROLE_IDS = [
  'cell-leader',
  'cell-courier',
  'cell-radio-operator',
  'cell-financier',
] as const;

/** The two hostile officer roles, both always present. */
export const HOSTILE_ROLE_IDS = ['hostile-resident', 'hostile-case-officer'] as const;

/** The Chief of Station, always present. */
export const CHIEF_ROLE_ID = 'chief-of-station';

/**
 * The posting a game belongs to. Drawn once, off the core stream, and then
 * every office role (Chief, clerk, cipher clerk) takes names from that one
 * service. `derive(seed, STATION_SERVICE_STREAM)` is that draw.
 */
export const STATION_SERVICES = ['american', 'british'] as const;

/** American or British: one service for the whole office. */
export type StationService = (typeof STATION_SERVICES)[number];

/** `derive(seed, STATION_SERVICE_STREAM)` picks {@link StationService}. Spells `srvc`. */
export const STATION_SERVICE_STREAM = 0x73727663;

/** Office roles that follow the game's one service. The driver stays a local hire. */
const OFFICE_ROLE_IDS = new Set([
  'chief-of-station',
  'station-clerk',
  'station-cipher-clerk',
]);

/** The staff archetypes the Chief's 2–3 staff are drawn from. */
export const STAFF_ROLE_IDS = [
  'station-clerk',
  'station-cipher-clerk',
  'station-driver',
] as const;

/** The contact archetypes the 2–3 starting contacts are drawn from. */
export const CONTACT_ROLE_IDS = [
  'emigre-fixer',
  'friendly-journalist',
  'police-liaison',
] as const;

/** The Station staff count range (the Chief plus 2–3 staff). */
export const MIN_STAFF = 2;
export const MAX_STAFF = 3;

/** The starting-contact count range. */
export const MIN_CONTACTS = 2;
export const MAX_CONTACTS = 3;

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/** One NPC's true allegiance, for the caller to write into the Truth Store. */
export interface NpcAllegiance {
  readonly npc: NpcId;
  readonly allegiance: Allegiance;
}

/** The output of {@link generatePrincipals}. */
export interface GeneratedPrincipals {
  /** The Principal NPCs keyed by id, as `WorldState.npcs` holds them. */
  readonly npcs: Readonly<Record<NpcId, Npc>>;
  /** The Cell members, in role order (leader first). */
  readonly cell: readonly NpcId[];
  /** The hostile officers, resident first. */
  readonly hostile: readonly NpcId[];
  /** The Chief of Station. */
  readonly chief: NpcId;
  /** The Station staff (not including the Chief). */
  readonly staff: readonly NpcId[];
  /** The starting contacts. */
  readonly contacts: readonly NpcId[];
  /**
   * Every NPC's true allegiance, for the caller to write into the Truth Store
   * (ground truth, Requirement 2.1). Keyed implicitly by order; each carries
   * its own npc id.
   */
  readonly allegiances: readonly NpcAllegiance[];
  /**
   * One Entity Registry entry per NPC: the canonical name (the persona name)
   * and a generic descriptor-summary alias. The caller folds these into the
   * registry so the Leak Guard knows every NPC's surface forms (Requirement
   * 5.2).
   */
  readonly registryEntries: readonly EntityEntry[];
  /**
   * The service the office belongs to. Office roles draw names from this pool.
   * Absent only for a caller that did not choose one; generation always sets it.
   */
  readonly service: StationService;
}

// ---------------------------------------------------------------------------
// Content lookup helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a content registry entry by a possibly-bare reference. The loader
 * keys registries by the namespaced id `<pack>/<name>`, but an archetype names
 * its persona pools and the like by the bare `<name>` (or a fully-namespaced
 * ref). This tries the ref verbatim, then falls back to the single entry whose
 * key ends in `/<ref>`. Returns `undefined` when nothing resolves.
 */
function resolveRef<T>(registry: ReadonlyMap<string, T>, ref: string): T | undefined {
  const direct = registry.get(ref);
  if (direct !== undefined) {
    return direct;
  }
  const suffix = `/${ref}`;
  for (const [key, value] of registry) {
    if (key === ref || key.endsWith(suffix)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Find the archetype with the given bare local id. Archetypes are keyed by
 * their namespaced id; the Principal roles are named by bare id, so this
 * resolves them the same way {@link resolveRef} resolves other references.
 */
function archetypeByLocalId(content: ContentSet, localId: string): Archetype | undefined {
  return resolveRef(content.archetypes, localId);
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** Draw a float uniformly in the inclusive range `[min, max]` on `prng`. */
function sampleRange(prng: Prng, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  return min + prng.next() * (max - min);
}

/** Sample a MICE profile, one lever at a time in a fixed order. */
function sampleMice(prng: Prng, archetype: Archetype): MiceProfile {
  // Fixed lever order: money, ideology, coercion, ego.
  const money = sampleRange(prng, archetype.mice.money.min, archetype.mice.money.max);
  const ideology = sampleRange(
    prng,
    archetype.mice.ideology.min,
    archetype.mice.ideology.max,
  );
  const coercion = sampleRange(
    prng,
    archetype.mice.coercion.min,
    archetype.mice.coercion.max,
  );
  const ego = sampleRange(prng, archetype.mice.ego.min, archetype.mice.ego.max);
  return { money, ideology, coercion, ego };
}

/** The maximum money need, in game currency, for a fully money-motivated NPC. */
export const MAX_MONEY_NEED = 5000;
/** The floor money need so even an unmotivated NPC has a nominal price. */
export const MIN_MONEY_NEED = 100;

/**
 * Derive the money need from the money lever: a linear map from `[0, 1]` to
 * `[MIN_MONEY_NEED, MAX_MONEY_NEED]`, rounded to the nearest 10 so amounts read
 * like money rather than noise. Deterministic given the sampled lever.
 */
export function moneyNeedOf(money: number): number {
  const span = MAX_MONEY_NEED - MIN_MONEY_NEED;
  const raw = MIN_MONEY_NEED + money * span;
  return Math.round(raw / 10) * 10;
}

// ---------------------------------------------------------------------------
// Persona
// ---------------------------------------------------------------------------

/**
 * Build a persona for an archetype at a chosen `gender`: pick one of its
 * persona libraries, pick a name pool of that gender within it, draw a
 * fictional given and family name, and draw the voice, mannerisms and
 * background flavour. `openness` is sampled in `[0, 1]` for the Cold Approach
 * check. The gender is the one the caller chose for the NPC (Requirement 1.7);
 * it is carried onto the persona so the descriptor draw and the dialogue layer
 * can honour it. Falls back to a plain id-based name if a referenced library is
 * missing, so a content gap never aborts generation.
 *
 * Each call draws afresh from the prng, so the name-uniqueness loop in
 * {@link generatePrincipals} redraws a clashing name simply by calling again;
 * every attempt advances the stream deterministically.
 */
function localRoleId(id: string): string {
  const slash = id.lastIndexOf('/');
  return slash === -1 ? id : id.slice(slash + 1);
}

function buildPersona(
  prng: Prng,
  content: ContentSet,
  archetype: Archetype,
  gender: PersonaGender,
  service?: StationService,
): Persona {
  // Pick a persona pool reference in a stable (sorted) order, then draw one.
  // Office roles, when a service was drawn for the game, use only that pool.
  let poolRefs = [...archetype.personaPools].sort();
  if (service !== undefined && OFFICE_ROLE_IDS.has(localRoleId(archetype.id))) {
    const matched = poolRefs.filter(
      (ref) => ref === service || ref.endsWith(`/${service}`),
    );
    if (matched.length > 0) {
      poolRefs = matched;
    }
  }
  const ref = prng.pick(poolRefs);
  const library: PersonaLibrary | undefined = resolveRef(content.personaLibraries, ref);

  if (library === undefined || library.namePools.length === 0) {
    // Defensive fall-back: a missing library yields a neutral placeholder name
    // so generation proceeds. The content smoke tests guard the real pools.
    const name = `${ref} ${archetype.id}`;
    return {
      name,
      given: ref,
      family: archetype.id,
      library: ref,
      culture: ref,
      gender,
      voiceTraits: [],
      mannerisms: [],
      background: '',
      openness: sampleRange(prng, 0.2, 0.8),
    };
  }

  // Prefer the name pools of the chosen gender; fall back to all pools if the
  // library carries none for that gender (so an older single-gender library
  // still yields a name).
  const genderPools = library.namePools.filter((p) => p.gender === gender);
  const usablePools = genderPools.length > 0 ? genderPools : library.namePools;
  const pool = prng.pick(usablePools);

  const given = prng.pick(pool.given);
  const family = prng.pick(pool.family);

  const voiceTraits = library.voiceTraits.length > 0 ? [prng.pick(library.voiceTraits)] : [];
  const mannerisms = library.mannerisms.length > 0 ? [prng.pick(library.mannerisms)] : [];
  const background = library.backgrounds.length > 0 ? prng.pick(library.backgrounds) : '';
  const openness = sampleRange(prng, 0.2, 0.8);

  return {
    name: `${given} ${family}`,
    given,
    family,
    library: library.id,
    culture: pool.culture,
    gender,
    voiceTraits,
    mannerisms,
    background,
    openness,
  };
}

// ---------------------------------------------------------------------------
// Descriptor
// ---------------------------------------------------------------------------

/**
 * Build a physical descriptor from an archetype's descriptor pools. One build
 * note, one grooming note, one garment and at most one accessory, and only
 * entries whose `fits` tag suits the NPC's `gender` (Requirement 1.7). The
 * garment and the accessory are drawn from every pool the archetype names, so
 * two pools cannot put two coats on the same person. An empty gender-filtered
 * list contributes nothing.
 *
 * Each call draws afresh from the prng, so the distinctness loop in
 * {@link generatePrincipals} redraws a too-similar descriptor simply by calling
 * again; every attempt advances the stream deterministically.
 */
function buildDescriptor(
  prng: Prng,
  descriptors: DescriptorData,
  archetype: Archetype,
  gender: PersonaGender,
): Descriptor {
  const poolIds = [...archetype.descriptorPools];
  const phrases: string[] = [];

  /** Pick a fitting phrase from `entries` that suits the gender. */
  const drawFitting = (entries: readonly unknown[]): string | undefined => {
    const fitting = fittingPhrases(
      entries as Parameters<typeof fittingPhrases>[0],
      gender,
    );
    if (fitting.length === 0) {
      return undefined;
    }
    return prng.pick(fitting);
  };

  // One build note and one grooming note. Clothing is one garment and, half
  // the time, one accessory, drawn from every pool the archetype names. A
  // second coat or a tunic over a day dress is a contradiction, not variety.
  const build = drawFitting(descriptors.shared.build);
  if (build !== undefined) {
    phrases.push(build);
  }
  const grooming = drawFitting(descriptors.shared.grooming);
  if (grooming !== undefined) {
    phrases.push(grooming);
  }

  const garments: string[] = [];
  const accessories: string[] = [];
  for (const poolId of poolIds) {
    const pool = descriptors.pools[poolId];
    if (pool === undefined) {
      continue;
    }
    for (const phrase of fittingPhrases(
      pool.garments as Parameters<typeof fittingPhrases>[0],
      gender,
    )) {
      if (!garments.includes(phrase)) {
        garments.push(phrase);
      }
    }
    for (const phrase of fittingPhrases(
      pool.accessories as Parameters<typeof fittingPhrases>[0],
      gender,
    )) {
      if (!accessories.includes(phrase)) {
        accessories.push(phrase);
      }
    }
  }
  if (garments.length > 0) {
    phrases.push(prng.pick(garments));
  } else if (poolIds.length > 0) {
    const missing = poolIds.find((poolId) => descriptors.pools[poolId] === undefined);
    if (missing !== undefined) {
      phrases.push(missing.replace(/-/g, ' '));
    }
  }
  if (accessories.length > 0 && prng.bool(0.5)) {
    phrases.push(prng.pick(accessories));
  }

  const summary = phrases.length > 0 ? phrases.join(', ') : 'an unremarkable figure';
  return { summary, phrases, pools: poolIds };
}

/**
 * The number of descriptor elements two descriptors differ in: the size of the
 * symmetric difference of their phrase sets. Two Principals are
 * "distinguishable" when this is at least {@link MIN_DESCRIPTOR_DIFFERENCE}
 * (Requirement 1.7, "differ in at least two elements").
 */
function descriptorDifference(a: Descriptor, b: Descriptor): number {
  const setA = new Set(a.phrases);
  const setB = new Set(b.phrases);
  let diff = 0;
  for (const p of setA) {
    if (!setB.has(p)) {
      diff += 1;
    }
  }
  for (const p of setB) {
    if (!setA.has(p)) {
      diff += 1;
    }
  }
  return diff;
}

/** Two Principals' descriptors must differ in at least this many elements. */
export const MIN_DESCRIPTOR_DIFFERENCE = 2;

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** The weekday index (`0` Monday … `6` Sunday) for a content weekday name. */
function weekdayIndex(weekday: string): number {
  const idx = CONTENT_WEEKDAYS.indexOf(weekday as (typeof CONTENT_WEEKDAYS)[number]);
  return idx === -1 ? 0 : idx;
}

/**
 * Build a concrete schedule from an archetype's Tag-Query schedule, binding
 * each slot's `at` Tag Query to a real Location in the generated city
 * (content-expansion task 3.8; design, "Library content"). A slot resolves to
 * the city's Binders of its `at` query; when the city binds none it falls back
 * to the archetype's `fallback` query, then to the city's public meeting spots,
 * and finally to any Location so a Principal is never left with nowhere to be
 * ({@link resolveScheduleCandidates}). Duplicate (weekday, phase) slots keep the
 * first binding, so an NPC is in one place at a time. Every `loc` returned
 * exists in the city.
 */
function buildSchedule(
  prng: Prng,
  binder: CityScheduleBinder,
  archetype: Archetype,
): NpcSchedule {
  const entries: ScheduleEntry[] = [];
  const seen = new Set<string>();

  for (const slot of archetype.schedule) {
    const candidates = resolveScheduleCandidates(
      binder,
      slot.at,
      archetype.fallback,
      false,
    );
    if (candidates.length === 0) {
      continue;
    }
    const phase: Phase = enginePhaseOf(slot.phase as ContentPhase);
    const weekday = weekdayIndex(slot.weekday);
    const key = `${weekday}:${phase}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const loc = prng.pick(candidates);
    entries.push({ weekday, phase, loc: loc.id });
  }

  // Stable order: weekday then phase, so the schedule reads consistently and
  // serialises identically for the same draws.
  entries.sort((a, b) => (a.weekday - b.weekday) || (a.phase - b.phase));
  return { entries };
}

// ---------------------------------------------------------------------------
// Reliability / tradecraft / security
// ---------------------------------------------------------------------------

/**
 * Derive the hidden ratings a later task reads from the sampled profile:
 * reliability (how dependable an Asset's reporting is), tradecraft (how well
 * the NPC evades observation) and security consciousness (how likely they are
 * to spot a watcher). These follow from the archetype role's wariness and the
 * sampled levers, with a little PRNG jitter so two NPCs of the same role differ.
 * All three are clamped to `[0, 1]`.
 */
function deriveRatings(
  prng: Prng,
  archetype: Archetype,
  mice: MiceProfile,
  wariness: number,
): { reliability: number; tradecraft: number; securityConsciousness: number } {
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  // Professionals (Cell, hostile) are more careful; money-motivated contacts
  // are a touch less reliable. Jitter keeps clones apart.
  const professional = archetype.role === 'cell' || archetype.role === 'hostile-officer';
  const base = professional ? 0.5 : 0.3;
  const tradecraft = clamp(base + wariness * 0.4 + sampleRange(prng, -0.1, 0.1));
  const securityConsciousness = clamp(
    base + wariness * 0.4 + sampleRange(prng, -0.1, 0.1),
  );
  const reliability = clamp(0.5 + mice.ideology * 0.3 - mice.money * 0.2 + sampleRange(prng, -0.1, 0.1));
  return { reliability, tradecraft, securityConsciousness };
}

// ---------------------------------------------------------------------------
// Allegiance mapping
// ---------------------------------------------------------------------------

/** The true-allegiance org id for an archetype role. */
function trueOrgFor(role: string, orgs: GeneratedOrgs): OrgId {
  switch (role) {
    case 'cell':
      return orgs.cell.id;
    case 'hostile-officer':
      return orgs.hostile.id;
    case 'station-staff':
    case 'contact':
      // Station staff serve the Station; a starting contact is a quiet Station
      // friend (archetype allowedAllegiances include `station`).
      return orgs.station.id;
    default:
      return orgs.station.id;
  }
}

/**
 * The Tag that marks the diplomatic mission (the design's "Soviet mission"): a
 * schedule slot whose `at` Tag Query names {@link MISSION_TAG}
 * (`function:embassy`) is a mission post. A hostile officer whose cover *is* an
 * open posting at the mission reads as `hostile` to the city; an undeclared
 * case officer, who works under civilian cover and meets agents in cafés and
 * parks, reads as `neutral`.
 *
 * Task 1.6 moved schedule binding to Tag Queries, so this is read off the
 * schedule's `at` queries rather than a `slot.locationType === 'embassy'`
 * count.
 */

/**
 * True when the archetype's public post is a declared hostile-power post — i.e.
 * its *primary* posting is the diplomatic mission ({@link MISSION_TAG}). The
 * signal the generator has is the schedule: an officer openly posted to the
 * mission keeps mission hours (the mission is the Tag Query it is scheduled at
 * most often), while an undeclared case officer only passes through the mission
 * occasionally and spends its working hours under civilian cover in cafés and
 * parks.
 *
 * "Primary" is read as *strict plurality*: the mission must be the single
 * most-frequent schedule target, appearing strictly more often than any other
 * Tag Query. So the resident (mission twice, a bar once) reads as a declared
 * post, while the case officer (a café, a park and the mission once each) does
 * not.
 */
function hasDeclaredHostilePost(archetype: Archetype): boolean {
  const missionCount = missionSlotCount(archetype.schedule, MISSION_TAG);
  if (missionCount === 0) {
    return false;
  }
  // The mission is the primary posting only when it is scheduled strictly more
  // often than any other Tag Query (strict plurality).
  const otherMax = nonMissionSlotMax(archetype.schedule, MISSION_TAG);
  if (otherMax >= missionCount) {
    // Another post is at least as frequent — the mission is not the primary
    // posting, so this officer works under civilian cover.
    return false;
  }
  return true;
}

/**
 * The apparent-allegiance category an NPC *presents* — its public post / Cover
 * Story, not its covert role (design, World Generator step 3; Requirements 1.3,
 * 1.8, 2.2, 33.4). Apparent allegiance comes from the face the NPC shows the
 * city, so a concealed NPC does **not** read as the org it truly serves:
 *
 * - a **Cell member** is covert — it presents under an innocent cover
 *   employment with no org affiliation declared, so it reads `neutral` (never
 *   `cell`; this is what keeps Property 33's "no Cell member presents as
 *   `cell`" true, and what makes a Cover Story worth having);
 * - a **hostile officer** reads `hostile` only when its public post is a
 *   declared hostile-power post (an open posting at the diplomatic mission —
 *   the resident); an undeclared case officer working under civilian cover
 *   reads `neutral`;
 * - **Station staff** present `station` (their post is the Station);
 * - a **contact** reads `neutral`.
 *
 * This is a cover posture, deliberately distinct from the archetype's
 * `allowedAllegiances` (which bound the *true* allegiance the role may serve):
 * a Cell archetype allows only `cell` as a true allegiance, yet presents
 * `neutral`. For an open role (Station staff, contact) the presented category
 * is one the archetype's allowed allegiances already contain, and the apparent
 * value is kept consistent with the Cover Story `knowledge.ts` later assigns
 * (a concealed NPC's cover employment, an open NPC's plain post).
 */
function apparentCategoryFor(
  role: string,
  archetype: Archetype,
): AllegianceCategory {
  switch (role) {
    case 'cell':
      // Covert: cover employment, no org declared.
      return 'neutral';
    case 'hostile-officer':
      // Open at the mission reads `hostile`; under civilian cover, `neutral`.
      return hasDeclaredHostilePost(archetype) ? 'hostile' : 'neutral';
    case 'station-staff':
      return 'station';
    case 'contact':
      return 'neutral';
    default: {
      // An unexpected role falls back to the first allowed category, so the
      // presented value stays within the content's vocabulary.
      const allowed = archetype.allowedAllegiances.filter(
        (a): a is AllegianceCategory =>
          (ALLEGIANCE_CATEGORIES as readonly string[]).includes(a),
      );
      return allowed[0] ?? 'neutral';
    }
  }
}

// ---------------------------------------------------------------------------
// Stamping one NPC
// ---------------------------------------------------------------------------

/** Build a stable, slug-safe local id part from a name, falling back to the archetype. */
function npcLocalId(persona: Persona, archetype: Archetype, index: number): string {
  const slug = persona.name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = slug.length > 0 ? slug : archetype.id;
  return `${base}-${index}`;
}

/**
 * The context the name-uniqueness and descriptor-distinctness redraws read: the
 * Principals already stamped (whose given/family names and descriptors must stay
 * distinct from this one, Requirement 1.7) and every full name taken so far
 * (which no NPC may repeat).
 */
interface UniquenessContext {
  /** The Principal NPCs already accepted, for the distinctness checks. */
  readonly principals: readonly Npc[];
  /** Every full name already taken by any NPC (`given family`). */
  readonly fullNames: ReadonlySet<string>;
  /** Whether this NPC is a Principal (so the stricter rules apply). */
  readonly isPrincipal: boolean;
}

/** The redraw cap before the generator accepts a best-effort name/descriptor. */
export const MAX_NAME_REDRAWS = 24;
export const MAX_DESCRIPTOR_REDRAWS = 24;

/**
 * True when `persona`'s name satisfies the uniqueness rules against `ctx`: for a
 * Principal, no other Principal shares its given or family name; for any NPC, no
 * other NPC shares its full name (Requirement 1.7, 1.8).
 */
function nameIsUnique(persona: Persona, ctx: UniquenessContext): boolean {
  if (ctx.fullNames.has(persona.name)) {
    return false;
  }
  if (ctx.isPrincipal) {
    for (const other of ctx.principals) {
      if (
        other.persona.given === persona.given ||
        other.persona.family === persona.family
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * True when `descriptor` is distinct enough from every already-stamped
 * Principal's: it must differ in at least {@link MIN_DESCRIPTOR_DIFFERENCE}
 * elements from each (Requirement 1.7). Only Principals are compared, and only
 * when this NPC is itself a Principal.
 */
function descriptorIsDistinct(
  descriptor: Descriptor,
  ctx: UniquenessContext,
): boolean {
  if (!ctx.isPrincipal) {
    return true;
  }
  for (const other of ctx.principals) {
    if (descriptorDifference(descriptor, other.descriptor) < MIN_DESCRIPTOR_DIFFERENCE) {
      return false;
    }
  }
  return true;
}

/**
 * Stamp one Principal NPC from an archetype, redrawing the name and descriptor
 * as needed so the result honours the uniqueness and distinctness rules against
 * the NPCs already stamped (Requirement 1.7). Each redraw advances the prng, so
 * the whole thing stays a deterministic function of the stream; a bounded cap
 * keeps a pathological pool from looping forever (the generator then accepts the
 * best effort, and the content smoke tests guard against pools that small).
 */
function stampNpc(
  prng: Prng,
  content: ContentSet,
  descriptors: DescriptorData,
  binder: CityScheduleBinder,
  orgs: GeneratedOrgs,
  archetype: Archetype,
  index: number,
  ctx: UniquenessContext,
  service?: StationService,
): { npc: Npc; registryEntry: EntityEntry; allegiance: NpcAllegiance } {
  // Fixed draw order per NPC so the stream is deterministic: mice, gender,
  // persona (redrawn for name uniqueness), descriptor (redrawn for
  // distinctness), schedule, wariness, ratings.
  const mice = sampleMice(prng, archetype);
  const gender: PersonaGender = prng.bool(0.5) ? 'female' : 'male';

  let persona = buildPersona(prng, content, archetype, gender, service);
  for (
    let attempt = 0;
    attempt < MAX_NAME_REDRAWS && !nameIsUnique(persona, ctx);
    attempt += 1
  ) {
    persona = buildPersona(prng, content, archetype, gender, service);
  }

  let descriptor = buildDescriptor(prng, descriptors, archetype, gender);
  for (
    let attempt = 0;
    attempt < MAX_DESCRIPTOR_REDRAWS && !descriptorIsDistinct(descriptor, ctx);
    attempt += 1
  ) {
    descriptor = buildDescriptor(prng, descriptors, archetype, gender);
  }

  const schedule = buildSchedule(prng, binder, archetype);
  const wariness = sampleRange(prng, archetype.wariness.min, archetype.wariness.max);
  const ratings = deriveRatings(prng, archetype, mice, wariness);

  const org = trueOrgFor(archetype.role, orgs);
  const apparentAllegiance = apparentCategoryFor(archetype.role, archetype);
  const moneyNeed = moneyNeedOf(mice.money);

  const id = `npc:${npcLocalId(persona, archetype, index)}` as NpcId;

  const npc: Npc = {
    id,
    archetype: archetype.id,
    role: archetype.role,
    org,
    trueAllegiance: asTruth<Allegiance>({ org }),
    apparentAllegiance,
    mice: asTruth(mice),
    moneyNeed: asTruth(moneyNeed),
    reliability: asTruth(ratings.reliability),
    tradecraft: asTruth(ratings.tradecraft),
    securityConsciousness: asTruth(ratings.securityConsciousness),
    // Every NPC starts at large; arrests and flight are play-time changes.
    status: asTruth<NpcStatus>('active'),
    persona,
    descriptor,
    schedule,
    wariness,
  };

  // The registry entry: the canonical name is the persona name; a generic
  // descriptor-summary alias lets the player refer to an as-yet-unidentified
  // subject by appearance without that alias gating the Leak Guard.
  const aliases: Alias[] = [{ text: descriptor.summary, distinctive: false }];
  const registryEntry: EntityEntry = {
    id,
    canonicalName: persona.name,
    aliases,
  };

  return { npc, registryEntry, allegiance: { npc: id, allegiance: { org } } };
}

function sectorOfLoc(city: City, loc: string): string | undefined {
  const place = city.locations[loc as keyof typeof city.locations];
  if (place === undefined) {
    return undefined;
  }
  return city.districts[place.district]?.sector;
}

/**
 * Keep one of the leader's meetings outside the Soviet sector. Moves the first
 * slot only when every slot is already in that sector, and draws nothing.
 */
function ensureWesternMeeting(city: City, npc: Npc): Npc {
  if (npc.schedule.entries.some((entry) => sectorOfLoc(city, entry.loc) !== 'soviet')) {
    return npc;
  }
  const western = Object.values(city.locations)
    .filter((place) => place.public && sectorOfLoc(city, place.id) !== 'soviet')
    .sort((a, b) => a.id.localeCompare(b.id));
  const dest = western[0];
  const first = npc.schedule.entries[0];
  if (dest === undefined || first === undefined) {
    return npc;
  }
  return {
    ...npc,
    schedule: { entries: [{ ...first, loc: dest.id }, ...npc.schedule.entries.slice(1)] },
  };
}

// ---------------------------------------------------------------------------
// generatePrincipals
// ---------------------------------------------------------------------------

/**
 * Generate the Principal NPCs from the core pack's archetypes (design, step 3;
 * Requirements 1.1, 1.3, 27.1).
 *
 * `prng` must be the core stream for the current attempt, already advanced past
 * city generation and {@link generateOrgs}. The roster is fixed in count and
 * composition — the four Cell roles, the two hostile officers, the Chief, 2–3
 * staff and 2–3 contacts — so the generated world always has a complete Cell to
 * hunt and a Station to answer to. The staff and contact *counts* are drawn
 * from the core stream within their ranges. Staff archetypes are a shuffled
 * subset. The police liaison is always a starting contact, because an arrest
 * is a request to them; the other contacts are a shuffled subset.
 *
 * Throws if a required archetype (a Cell role, a hostile officer, the Chief) is
 * absent from the content — that is a pack gap the smoke tests should catch,
 * not a runtime condition to paper over.
 */
/** Plot-library principal cap (Req 6.5). The slice roster stays under it. */
export const PRINCIPAL_CAP = 22;

export function generatePrincipals(
  prng: Prng,
  content: ContentSet,
  descriptors: DescriptorData,
  city: City,
  orgs: GeneratedOrgs,
  options?: { readonly cap?: number; readonly service?: StationService },
): GeneratedPrincipals {
  const binder = cityScheduleBinder(city, content);

  const npcs: Record<NpcId, Npc> = {};
  const registryEntries: EntityEntry[] = [];
  const allegiances: NpcAllegiance[] = [];
  let index = 0;

  // The uniqueness/distinctness context the redraws read: every Principal
  // accepted so far, and every full name taken (every Principal is a Principal
  // here, so the stricter given/family rule always applies).
  const acceptedPrincipals: Npc[] = [];
  const fullNames = new Set<string>();

  const require = (localId: string): Archetype => {
    const archetype = archetypeByLocalId(content, localId);
    if (archetype === undefined) {
      throw new Error(
        `generatePrincipals(): the content set has no archetype "${localId}"`,
      );
    }
    return archetype;
  };

  const service = options?.service;
  const stamp = (archetype: Archetype): NpcId => {
    const result = stampNpc(
      prng,
      content,
      descriptors,
      binder,
      orgs,
      archetype,
      index,
      { principals: acceptedPrincipals, fullNames, isPrincipal: true },
      service,
    );
    index += 1;
    npcs[result.npc.id] = result.npc;
    registryEntries.push(result.registryEntry);
    allegiances.push(result.allegiance);
    acceptedPrincipals.push(result.npc);
    fullNames.add(result.npc.persona.name);
    return result.npc.id;
  };

  // Cell: all four roles, leader first (fixed order).
  const cell = CELL_ROLE_IDS.map((roleId) => stamp(require(roleId)));
  const leaderId = cell[0];
  if (leaderId !== undefined && npcs[leaderId] !== undefined) {
    // An arrest is impossible inside the Soviet sector, so the leader keeps
    // one meeting outside it. No extra draw: the first slot moves only when
    // every slot already landed in the Soviet sector.
    npcs[leaderId] = ensureWesternMeeting(city, npcs[leaderId]);
  }

  // Hostile officers: both, resident first (fixed order).
  const hostile = HOSTILE_ROLE_IDS.map((roleId) => stamp(require(roleId)));

  // Station: the Chief, then a drawn 2–3 of the staff archetypes.
  const chief = stamp(require(CHIEF_ROLE_ID));
  const staffCount = prng.int(MIN_STAFF, MAX_STAFF);
  const staffArchetypes = prng
    .shuffle(STAFF_ROLE_IDS.map((id) => require(id)))
    .slice(0, staffCount);
  const staff = staffArchetypes.map((archetype) => stamp(archetype));

  // Contacts: the police liaison, then 1–2 of the other contact archetypes,
  // so the roster stays at 2–3 and an arrest can always be requested.
  const otherContacts = CONTACT_ROLE_IDS.filter((id) => id !== 'police-liaison').map((id) =>
    require(id),
  );
  const extraCount = prng.int(MIN_CONTACTS - 1, MAX_CONTACTS - 1);
  const extras = prng.shuffle(otherContacts).slice(0, extraCount);
  const contacts = [require('police-liaison'), ...extras].map((archetype) => stamp(archetype));

  const cap = options?.cap;
  if (cap !== undefined && index < cap) {
    const filler = require(CONTACT_ROLE_IDS[0] ?? CHIEF_ROLE_ID);
    while (index < cap) {
      stamp(filler);
    }
  }

  return {
    npcs,
    cell,
    hostile,
    chief,
    staff,
    contacts,
    allegiances,
    registryEntries,
    service: service ?? 'american',
  };
}
