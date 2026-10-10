/**
 * Background NPC generation: step 1 of the world generator's **noise** stream
 * (design, "Noise Generator", step 1; Requirement 29.1).
 *
 * The core generator (`../generate.ts`) builds and verifies the world — the
 * city, the orgs, the Principal NPCs, the Plot, comms and knowledge — on the
 * core PRNG stream. The noise generator then runs on a *separate* stream
 * (`derive(seed, 0x10000)`, {@link NOISE_STREAM_BASE}) and only ever *adds*
 * entities and beliefs; it never mutates core entities (design: "Noise only
 * adds entities and beliefs"). This module owns the first of those additions —
 * the Background NPCs — as a pure, standalone generator. Task 6.4 wires it (and
 * the later noise steps) into `generate()`'s noise stream; this module does not
 * touch `generate.ts`.
 *
 * A **Background NPC** is "a civilian NPC with no role in the Plot" that
 * "carry local facts, Rumours and Side Thread knowledge" (Requirement glossary;
 * Requirement 29.1). This task produces the civilian NPC itself:
 *
 * - a real {@link Npc} (the same shape the Principal generator stamps, reused
 *   wholesale) stamped from a **civilian** archetype, with a true and apparent
 *   allegiance in the civilian/neutral band — it serves no org, so `org` is
 *   left unset and the true allegiance is `neutral`;
 * - a **schedule** that places the NPC at **public** Locations only (design,
 *   step 1: "schedules at public Locations"). An archetype's schedule template
 *   may name a Location Type that is only ever non-public (a warehouse, a
 *   port); such slots are dropped, and public slots are bound to a public
 *   Location of the matching type, falling back to any public Location so a
 *   civilian always has somewhere to be;
 * - a lightweight **local-facts {@link KnowledgeSlice}**: true, city-level
 *   Propositions — the public Locations the civilian frequents and a couple of
 *   who-is-seen-where observations about other Background NPCs. These are
 *   ambient colour, *not* Plot or Cell leads: nothing in the slice names an
 *   org, a Plot stage or a Cell member. Rumours (false beliefs) are layered on
 *   by task 6.3; this slice carries no `falseBeliefs`.
 *
 * The Background-NPC ids live in the `npc:` namespace with a distinct `bg-`
 * prefix (`npc:bg-<n>`), so they cannot collide with Principal ids, which the
 * Principal generator mints as `npc:<name-slug>-<index>` (a persona-name slug
 * followed by an index, never the literal `bg`).
 *
 * Determinism rests on drawing every choice from the passed {@link Prng} in a
 * fixed order over id-sorted lists, exactly as the city, principal, Plot, comms
 * and knowledge generators do, so the result is a pure function of the noise
 * seed and the content (Requirement 1.2, underpinning Property 1 — seed
 * determinism; Requirement 29.5 — the noise stream is independent of the core).
 */

import {
  asTruth,
  type EntityId,
  type NpcId,
  type OrgId,
  type Phase,
  type Proposition,
  type PropId,
} from '../model/core.js';
import { type Prng } from '../prng/prng.js';
import { type Allegiance } from '../truth/truth.js';
import { type Alias, type EntityEntry } from '../model/registry.js';
import {
  type AllegianceCategory,
  type Descriptor,
  type MiceProfile,
  type Npc,
  type NpcSchedule,
  type NpcStatus,
  type Persona,
  type ScheduleEntry,
} from '../city/npc.js';
import { type City } from '../city/city.js';
import { type GeneratedOrgs } from '../city/principals.js';
import {
  cityScheduleBinder,
  resolveScheduleCandidates,
  type CityScheduleBinder,
} from '../city/schedule-binding.js';
import {
  CONTENT_WEEKDAYS,
  enginePhaseOf,
  type ContentPhase,
} from '../city/time-mapping.js';
import type {
  Archetype,
  ContentSet,
  DescriptorData,
  PersonaGender,
  PersonaLibrary,
} from '@tradecraft/content';
import { fittingPhrases } from '@tradecraft/content';

// ---------------------------------------------------------------------------
// Count defaults
// ---------------------------------------------------------------------------

/**
 * The Background-NPC count a preset that does not set one falls back to. The
 * real count comes from the Difficulty Preset's `noiseCounts.backgroundNpcs`
 * (Requirement 34.2); task 6.4 reads it from the resolved preset and passes it
 * to {@link generateBackgroundNpcs}. These bounds document a reasonable band for
 * callers (such as tests) that have no preset in hand — enough civilians to make
 * the city feel inhabited without drowning the signal.
 */
export const MIN_BACKGROUND_NPCS = 0;
/** A sensible default Background-NPC count when no preset count is supplied. */
export const DEFAULT_BACKGROUND_NPCS = 8;

/** The id prefix every Background NPC carries, so ids never collide with Principals. */
export const BACKGROUND_ID_PREFIX = 'bg';

/**
 * The sentinel org id a Background NPC's true allegiance points at. An
 * {@link Allegiance} is the id of the org an NPC really serves, but a civilian
 * serves none of the three generated orgs (Station, Hostile Service, Cell).
 * Rather than falsely enrolling a civilian in one of them, their ground-truth
 * allegiance is this distinct `org:none` sentinel — a real, non-colliding id
 * that reads as "no organisation", so a Background NPC never appears on any
 * org's inferred roster and never sits on a Plot/Cell path.
 */
export const NEUTRAL_ORG_ID = 'org:none' as OrgId;

/** How many who-is-seen-where observations a Background NPC's local slice holds. */
const LOCAL_OBSERVATIONS = 2;

/**
 * The redraw cap before the generator accepts a best-effort (possibly
 * non-unique) Background-NPC name. Mirrors the Principal generator's
 * `MAX_NAME_REDRAWS`: each redraw advances the stream deterministically, and the
 * cap keeps a pathological or exhausted name pool from looping forever. The
 * Austrian name pools are large enough that the cap is never reached in
 * practice; the fall-through only exists so a thin pack can never hang.
 */
export const MAX_BACKGROUND_NAME_REDRAWS = 24;

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/**
 * The local-facts Knowledge Slice a Background NPC carries. It mirrors the
 * engine's {@link import('../city/knowledge.js').KnowledgeSlice} shape (true
 * Propositions, false beliefs, known entities) but is declared here so this
 * module imports only leaf modules (`city/*`, `model/*`, `prng`) and never the
 * knowledge generator or `generate.ts`, keeping the noise step a leaf of the
 * dependency graph. Task 6.4 reconciles the two under the one `KnowledgeSlice`
 * name when it threads these onto `WorldState`.
 *
 * For this task `falseBeliefs` is always empty: Rumours (the false beliefs a
 * Background NPC spreads) are layered on by task 6.3.
 */
export interface LocalKnowledgeSlice {
  /** True, city-level Propositions the civilian holds (local facts). */
  readonly known: readonly Proposition[];
  /** Always empty here; task 6.3 adds Rumours as false beliefs. */
  readonly falseBeliefs: readonly Proposition[];
  /** Every entity the civilian knows of (Locations and other civilians). */
  readonly knownEntities: readonly EntityId[];
}

/** One generated Background NPC, with its registry entry and local slice. */
export interface BackgroundNpc {
  readonly npc: Npc;
  /** The civilian's local-facts Knowledge Slice (no Plot/Cell facts). */
  readonly knowledge: LocalKnowledgeSlice;
  /**
   * The Entity Registry entry for the civilian: the canonical name (the persona
   * name) and a generic descriptor-summary alias, mirroring what the Principal
   * generator returns so task 6.4 can fold them into the registry the Leak
   * Guard reads.
   */
  readonly registryEntry: EntityEntry;
}

/** The output of {@link generateBackgroundNpcs}. */
export interface GeneratedBackgroundNpcs {
  /** The Background NPCs keyed by id, as `WorldState.npcs` holds them. */
  readonly npcs: Readonly<Record<NpcId, Npc>>;
  /** The Background NPCs in generation order, with their slices and registry entries. */
  readonly background: readonly BackgroundNpc[];
  /** Every Background NPC's Entity Registry entry, in generation order. */
  readonly registryEntries: readonly EntityEntry[];
}

// ---------------------------------------------------------------------------
// Civilian archetype selection
// ---------------------------------------------------------------------------

/**
 * The civilian archetypes in the content set, id-sorted so the draw order is a
 * pure function of the content. Only archetypes whose `role` is `civilian` are
 * eligible — Background NPCs are civilians with no Plot role (Requirement
 * glossary; design, step 1).
 */
export function civilianArchetypes(content: ContentSet): Archetype[] {
  return [...content.archetypes.values()]
    .filter((a) => a.role === 'civilian')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Content lookup helpers (mirrors ../city/principals.ts resolveRef)
// ---------------------------------------------------------------------------

/**
 * Resolve a content registry entry by a possibly-bare reference. The loader
 * keys registries by the namespaced id `<pack>/<name>`, but an archetype names
 * its persona pools by the bare `<name>`. Tries the ref verbatim, then falls
 * back to the single entry whose key ends in `/<ref>`.
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

// ---------------------------------------------------------------------------
// Sampling (mirrors ../city/principals.ts)
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

/** The maximum money need, in game currency, mirroring the Principal generator. */
const MAX_MONEY_NEED = 5000;
/** The floor money need so even an unmotivated civilian has a nominal price. */
const MIN_MONEY_NEED = 100;

/** Derive the money need from the money lever (linear map, rounded to 10). */
function moneyNeedOf(money: number): number {
  const span = MAX_MONEY_NEED - MIN_MONEY_NEED;
  const raw = MIN_MONEY_NEED + money * span;
  return Math.round(raw / 10) * 10;
}

// ---------------------------------------------------------------------------
// Persona (mirrors ../city/principals.ts buildPersona)
// ---------------------------------------------------------------------------

/**
 * Build a persona for a civilian archetype: pick a persona pool in a stable
 * (sorted) order, draw a culture name pool, a given and family name, and the
 * voice/mannerism/background flavour. Falls back to a neutral placeholder name
 * when a referenced library is missing, so a content gap never aborts noise
 * generation. `openness` is sampled in `[0, 1]` for the Cold Approach check.
 */
function buildPersona(
  prng: Prng,
  content: ContentSet,
  archetype: Archetype,
  gender: PersonaGender,
): Persona {
  const poolRefs = [...archetype.personaPools].sort();
  const ref = prng.pick(poolRefs);
  const library: PersonaLibrary | undefined = resolveRef(content.personaLibraries, ref);

  if (library === undefined || library.namePools.length === 0) {
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
// Descriptor (mirrors ../city/principals.ts buildDescriptor)
// ---------------------------------------------------------------------------

/**
 * Build a physical descriptor from an archetype's descriptor pools, drawing a
 * period-correct phrase from each. A pool the descriptor file does not define
 * contributes its id as flavour and is still recorded in `pools`, so a content
 * gap never aborts generation. A shared build/grooming note is prepended for
 * texture.
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

// ---------------------------------------------------------------------------
// Schedule at public Locations only
// ---------------------------------------------------------------------------

/** The weekday index (`0` Monday … `6` Sunday) for a content weekday name. */
function weekdayIndex(weekday: string): number {
  const idx = CONTENT_WEEKDAYS.indexOf(weekday as (typeof CONTENT_WEEKDAYS)[number]);
  return idx === -1 ? 0 : idx;
}

/**
 * Build a schedule for a Background NPC that places them at **public**
 * Locations only (design, step 1; content-expansion task 3.8). Each archetype
 * schedule slot's `at` Tag Query is resolved to a public Location that binds it;
 * when the city binds none it falls back to the archetype's `fallback` query,
 * then to the public meeting spots, and finally to any public Location so a
 * civilian stays in public view rather than vanishing
 * ({@link resolveScheduleCandidates} with `publicOnly`). If the city has no
 * public Locations at all the slot is dropped. Duplicate (weekday, phase) slots
 * keep the first binding, so a civilian is in one place at a time, and every
 * `loc` returned is a public Location that exists in the city.
 */
function buildPublicSchedule(
  prng: Prng,
  binder: CityScheduleBinder,
  archetype: Archetype,
): NpcSchedule {
  const entries: ScheduleEntry[] = [];
  const seen = new Set<string>();

  for (const slot of archetype.schedule) {
    const phase: Phase = enginePhaseOf(slot.phase as ContentPhase);
    const weekday = weekdayIndex(slot.weekday);
    const key = `${weekday}:${phase}`;
    if (seen.has(key)) {
      continue;
    }
    const candidates = resolveScheduleCandidates(
      binder,
      slot.at,
      archetype.fallback,
      true,
    );
    if (candidates.length === 0) {
      continue;
    }
    seen.add(key);
    const loc = prng.pick(candidates);
    entries.push({ weekday, phase, loc: loc.id });
  }

  entries.sort((a, b) => a.weekday - b.weekday || a.phase - b.phase);
  return { entries };
}

// ---------------------------------------------------------------------------
// Ratings and allegiance
// ---------------------------------------------------------------------------

/**
 * Derive the hidden ratings a later task reads, mirroring the Principal
 * generator but with the civilian (non-professional) baseline: a lower
 * tradecraft/security floor, reliability bent by the sampled levers, all with a
 * little PRNG jitter and clamped to `[0, 1]`.
 */
function deriveRatings(
  prng: Prng,
  mice: MiceProfile,
  wariness: number,
): { reliability: number; tradecraft: number; securityConsciousness: number } {
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  const base = 0.3; // Civilians are not professionals.
  const tradecraft = clamp(base + wariness * 0.4 + sampleRange(prng, -0.1, 0.1));
  const securityConsciousness = clamp(
    base + wariness * 0.4 + sampleRange(prng, -0.1, 0.1),
  );
  const reliability = clamp(
    0.5 + mice.ideology * 0.3 - mice.money * 0.2 + sampleRange(prng, -0.1, 0.1),
  );
  return { reliability, tradecraft, securityConsciousness };
}

/**
 * The apparent-allegiance category a civilian presents. Civilian archetypes
 * allow `neutral` and `unknown`; a Background NPC presents `neutral` when the
 * archetype permits it (the common case), else the first allowed category. This
 * is view-safe flavour — a civilian truly serves no org.
 */
function apparentCategoryFor(archetype: Archetype): AllegianceCategory {
  const allowed = archetype.allowedAllegiances.filter(
    (a): a is AllegianceCategory =>
      a === 'station' ||
      a === 'hostile' ||
      a === 'cell' ||
      a === 'neutral' ||
      a === 'unknown',
  );
  if (allowed.includes('neutral')) {
    return 'neutral';
  }
  return allowed[0] ?? 'neutral';
}

// ---------------------------------------------------------------------------
// Local-facts proposition minting
// ---------------------------------------------------------------------------

/** Turn an arbitrary tag into a slug-safe id fragment. */
function slug(value: string): string {
  const s = value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'x';
}

/** Mint a stable PropId for a local fact, scoped to the holder: `prop:local/<holder>/<tag>`. */
function localPropId(holder: EntityId, tag: string): PropId {
  const holderSlug = slug(holder.slice(holder.indexOf(':') + 1));
  return `prop:local/${holderSlug}/${slug(tag)}`;
}

// ---------------------------------------------------------------------------
// Stamping one Background NPC
// ---------------------------------------------------------------------------

/**
 * Stamp one Background NPC from a civilian archetype. The draw order per NPC is
 * fixed (mice, gender, persona, descriptor, schedule, wariness, ratings),
 * mirroring the Principal generator so the two read the same way, and the id is
 * the stable `npc:bg-<index>` form that cannot collide with a Principal id. The
 * gender gates both the name pool and the gender-fitting descriptor draw
 * (Requirement 1.7).
 *
 * The persona name is **redrawn** until it is unique against `usedNames` — the
 * full names already taken by Principals and by every *earlier* Background NPC
 * (`npc:bg-0 … npc:bg-(index-1)`) — so no two NPCs across the whole roster share
 * a full name (Requirements 1.7, 1.8). Because the resolution for `npc:bg-i`
 * reads only names fixed before it (the Principal set and strictly-earlier
 * Background NPCs), the i-th NPC is identical regardless of the total count: the
 * count-independent `npc:bg-i` superset invariant is preserved. Each redraw
 * advances the stream, so the result stays a deterministic function of the noise
 * stream; a bounded cap keeps an exhausted pool from looping forever (the
 * generator then accepts the last draw).
 */
function stampBackgroundNpc(
  prng: Prng,
  content: ContentSet,
  descriptors: DescriptorData,
  binder: CityScheduleBinder,
  archetype: Archetype,
  index: number,
  usedNames: ReadonlySet<string>,
  usedFamilies: ReadonlySet<string>,
): { npc: Npc; registryEntry: EntityEntry } {
  const mice = sampleMice(prng, archetype);
  const gender: PersonaGender = prng.bool(0.5) ? 'female' : 'male';
  const taken = (persona: Persona): boolean =>
    usedNames.has(persona.name) || usedFamilies.has(persona.family);
  let persona = buildPersona(prng, content, archetype, gender);
  for (let attempt = 0; attempt < MAX_BACKGROUND_NAME_REDRAWS && taken(persona); attempt += 1) {
    persona = buildPersona(prng, content, archetype, gender);
  }
  const descriptor = buildDescriptor(prng, descriptors, archetype, gender);
  const schedule = buildPublicSchedule(prng, binder, archetype);
  const wariness = sampleRange(prng, archetype.wariness.min, archetype.wariness.max);
  const ratings = deriveRatings(prng, mice, wariness);

  const apparentAllegiance = apparentCategoryFor(archetype);
  const moneyNeed = moneyNeedOf(mice.money);

  const id: NpcId = `npc:${BACKGROUND_ID_PREFIX}-${index}`;

  // A civilian serves no org, so `org` is left unset and the true allegiance
  // points at the {@link NEUTRAL_ORG_ID} sentinel — ground truth that no
  // generated org claims them. This is what keeps a Background NPC off every
  // org roster and out of every Plot/Cell path.
  const npc: Npc = {
    id,
    archetype: archetype.id,
    role: archetype.role,
    trueAllegiance: asTruth<Allegiance>({ org: NEUTRAL_ORG_ID }),
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

  const aliases: Alias[] = [{ text: descriptor.summary, distinctive: false }];
  const registryEntry: EntityEntry = {
    id,
    canonicalName: persona.name,
    aliases,
  };

  return { npc, registryEntry };
}

// ---------------------------------------------------------------------------
// Local-facts Knowledge Slice
// ---------------------------------------------------------------------------

/**
 * Build a Background NPC's local-facts Knowledge Slice: true, city-level
 * Propositions that are ambient colour, never Plot or Cell leads.
 *
 * The slice holds:
 * - the public Locations the civilian themselves frequents, as `LOCATED_AT`
 *   facts from their own schedule — a civilian knows where they spend their
 *   week; and
 * - a couple of who-is-seen-where observations (`LOCATED_AT`) about *other*
 *   Background NPCs drawn from their schedules — the raw material of ambient
 *   gossip.
 *
 * Every proposition names only Locations and other Background NPCs, so no org,
 * Plot stage or Cell member can appear. `falseBeliefs` is empty here; Rumours
 * are task 6.3. When the city or roster is too thin to observe anyone, the slice
 * still holds the civilian's own frequented Locations so it is never empty for a
 * scheduled civilian.
 */
function buildLocalSlice(
  prng: Prng,
  self: Npc,
  others: readonly Npc[],
): LocalKnowledgeSlice {
  const holder = self.id;
  const known: Proposition[] = [];
  const knownEntities = new Set<EntityId>();
  const addEntity = (id: EntityId): void => {
    knownEntities.add(id);
  };

  // The civilian knows the public Locations they frequent (from their own
  // schedule): a `LOCATED_AT` with the civilian as subject and object, placed
  // at the Location — the same "seen where" shape the knowledge module uses, so
  // the slice speaks only the Predicate Vocabulary.
  const myLocs = [...new Set(self.schedule.entries.map((e) => e.loc))].sort();
  for (const loc of myLocs) {
    known.push({
      id: localPropId(holder, `frequents/${loc}`),
      subject: holder,
      predicate: 'LOCATED_AT',
      object: holder,
      place: loc,
    });
    addEntity(loc);
  }

  // A couple of who-is-seen-where observations about other Background NPCs.
  const observable = others
    .filter((n) => n.id !== self.id && n.schedule.entries.length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seenSubjects = new Set<NpcId>();
  for (let i = 0; i < LOCAL_OBSERVATIONS && observable.length > 0; i += 1) {
    const subject = prng.pick(observable);
    if (seenSubjects.has(subject.id)) {
      continue;
    }
    seenSubjects.add(subject.id);
    const entry = prng.pick([...subject.schedule.entries]);
    known.push({
      id: localPropId(holder, `seen/${subject.id}`),
      subject: subject.id,
      predicate: 'LOCATED_AT',
      object: subject.id,
      place: entry.loc,
    });
    addEntity(subject.id);
    addEntity(entry.loc);
  }

  return {
    known,
    falseBeliefs: [],
    knownEntities: [...knownEntities],
  };
}

// ---------------------------------------------------------------------------
// generateBackgroundNpcs
// ---------------------------------------------------------------------------

/**
 * Generate the Background NPCs from the content set's civilian archetypes
 * (design, "Noise Generator", step 1; Requirement 29.1).
 *
 * `prng` must be the **noise** stream for the current attempt
 * (`derive(seed, 0x10000)`, {@link NOISE_STREAM_BASE}), independent of the core
 * stream so changing noise settings leaves the core world untouched (Requirement
 * 29.5). `count` is the Background-NPC headcount from the Difficulty Preset's
 * `noiseCounts.backgroundNpcs`; task 6.4 reads it from the resolved preset.
 *
 * The civilian archetypes are cycled in id-sorted order so the roster is a pure
 * function of the content and the count: with `k` archetypes, the `i`-th NPC is
 * stamped from archetype `i mod k`. Each NPC gets a schedule at public Locations
 * and a local-facts slice; the slices are built in a second pass so a civilian
 * may be observed in another's slice. The result is a pure function of the noise
 * seed, the city and the content.
 *
 * `orgs` is accepted (and currently unused beyond documenting the contract) so
 * the signature matches the other noise/core generators and task 6.4 can thread
 * it through uniformly; a civilian serves no org, so none of the three org ids
 * ever appears in a Background NPC or its slice.
 *
 * `principalNames` is the set of full names the core Principal generator already
 * stamped (`persona.name` for each Principal). A Background NPC's name is
 * redrawn until it is unique against those Principal names *and* against every
 * earlier Background NPC's name, so no two NPCs across the whole roster share a
 * full name (Requirements 1.7, 1.8). Resolution runs in index order and reads
 * only names fixed before the current NPC, so `npc:bg-i` is identical regardless
 * of `count` — the count-independent `npc:bg-i` superset invariant holds — and
 * the roster stays a deterministic function of the noise stream and the fixed
 * Principal set.
 *
 * Throws if `count` is negative or non-integer (a programming error), or if the
 * content set has no civilian archetype to stamp from while a positive count is
 * requested (a pack gap the smoke tests should catch).
 */
export function generateBackgroundNpcs(
  prng: Prng,
  content: ContentSet,
  descriptors: DescriptorData,
  city: City,
  _orgs: GeneratedOrgs,
  count: number,
  principalNames: ReadonlySet<string> = new Set<string>(),
): GeneratedBackgroundNpcs {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(
      `generateBackgroundNpcs(): count must be a non-negative integer, received ${String(count)}`,
    );
  }

  const archetypes = civilianArchetypes(content);
  if (count > 0 && archetypes.length === 0) {
    throw new Error(
      'generateBackgroundNpcs(): the content set has no civilian archetype to stamp Background NPCs from',
    );
  }

  const binder = cityScheduleBinder(city, content);

  // First pass: stamp every civilian (NPC, registry entry), cycling archetypes.
  // `usedNames` seeds with the Principal full names and grows as each Background
  // NPC is accepted, so a name is redrawn until it is unique against Principals
  // and every strictly-earlier Background NPC. Stamping in index order keeps
  // `npc:bg-i`'s resolution dependent only on names fixed before it, so the
  // count-independent `npc:bg-i` superset invariant holds.
  const usedNames = new Set<string>(principalNames);
  const usedFamilies = new Set<string>();
  for (const full of principalNames) {
    const parts = full.trim().split(/\s+/);
    const family = parts[parts.length - 1];
    if (family !== undefined && family.length > 0) {
      usedFamilies.add(family);
    }
  }
  const stamped: Array<{ npc: Npc; registryEntry: EntityEntry }> = [];
  for (let i = 0; i < count; i += 1) {
    const archetype = archetypes[i % archetypes.length];
    const result = stampBackgroundNpc(
      prng,
      content,
      descriptors,
      binder,
      archetype,
      i,
      usedNames,
      usedFamilies,
    );
    usedNames.add(result.npc.persona.name);
    usedFamilies.add(result.npc.persona.family);
    stamped.push(result);
  }

  // Second pass: build each civilian's local-facts slice, so a civilian may be
  // observed in another's slice. Observing from the whole stamped set keeps the
  // draw order fixed over the id-sorted roster inside buildLocalSlice.
  const allNpcs = stamped.map((s) => s.npc);
  const background: BackgroundNpc[] = stamped.map((s) => ({
    npc: s.npc,
    knowledge: buildLocalSlice(prng, s.npc, allNpcs),
    registryEntry: s.registryEntry,
  }));

  const npcs: Record<NpcId, Npc> = {};
  const registryEntries: EntityEntry[] = [];
  for (const bg of background) {
    npcs[bg.npc.id] = bg.npc;
    registryEntries.push(bg.registryEntry);
  }

  return { npcs, background, registryEntries };
}
