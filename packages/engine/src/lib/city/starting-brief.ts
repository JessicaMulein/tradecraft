/**
 * The Cover Identity and the Starting Brief: step 8 of the world generator's
 * core stream (design, "World Generator", step 8, and "Starting Brief";
 * Requirements 26.1, 26.2, 26.4).
 *
 * This module owns both the *shape* of the player's issued Cover Identity — the
 * real {@link CoverIdentity} interface that replaces the task-4.6 skeleton
 * placeholder in `../model/state.ts` — and the pure generators that build it and
 * the {@link StartingBrief} from everything the earlier core-stream steps
 * produced: the City (step 1), the Orgs and Principal NPCs (steps 2–3), the
 * Plot (step 3), the Channels and Dead Drops (step 5), and the Station's
 * Knowledge Slice (step 6).
 *
 * The vocabulary (design, "Starting Brief"; Glossary):
 *
 * - A **Cover Identity** is the fictional identity the player operates under: a
 *   `title`, an `employerOrg`, the Location Types where it fits plausibly
 *   (`fitLocationTypes`), and the Cover Suspicion modifiers it carries at a
 *   fitting place versus elsewhere (`suspicionModifiers`). The content pack
 *   ships a pool of cover templates; {@link generateCoverIdentity} draws one
 *   whose fit Location Types actually occur in the generated city, so the
 *   issued cover is plausible *for this city*, and narrows the recorded fit set
 *   to the types the city stamps.
 * - A **Starting Brief** is the opening HQ package (design): the Cover Identity,
 *   the Chief of Station, the starting known entities (Station staff, public
 *   Locations, starting contacts), the 2–4 initial leads, the Dossiers, at
 *   least one known Channel, at least one player Dead Drop, the starting
 *   Directives, the starting Budget and the starting Contact Channels. It is
 *   delivered to the player as a **Cable Document** (Requirement 26.4), composed
 *   through {@link composeCable}; the brief Cable asserts the leads, so reading
 *   it later seeds the Case File (task 9.2).
 *
 * The **leads are drawn from the Station's Knowledge Slice** (Requirement 26.2),
 * so some may be HQ false beliefs — the slice already mixes true leads and HQ
 * mistakes at the preset's `hqFalseBeliefRate` (task 5.5). The brief draws a
 * handful of them, true and false alike, and records each as a {@link BriefLead}
 * whose `source` is the brief Cable (`{ kind: 'document', id: <brief cable> }`),
 * matching the design's `leads: Claim[]` with that document source. (A Case File
 * `Claim` is Player-View data owned by `player-view`; the engine cannot import
 * it, so the brief carries the engine-level {@link BriefLead} the read action
 * turns into a Claim.)
 *
 * Determinism rests on drawing every choice from the passed {@link Prng} in a
 * fixed order over id-sorted lists, exactly as the city, principal, Plot, comms
 * and knowledge generators do, so the result is a pure function of the seed and
 * the content (Requirement 1.2, underpinning Property 1 — seed determinism, and
 * Property 19 — Starting Brief rootedness). The generators take a dedicated PRNG
 * sub-stream derived with {@link derive} so adding a brief draw does not shift
 * the core stream the later steps read.
 */

import {
  type ChannelId,
  type DeadDropId,
  type DocId,
  type EntityId,
  type GameTime,
  type NpcId,
  type Proposition,
} from '../model/core.js';
import { createPrng, derive, type Prng } from '../prng/prng.js';
import { type City } from './city.js';
import { type KnowledgeSlice } from './knowledge.js';
import { type GeneratedComms } from './comms.js';
import { type GeneratedPrincipals } from './principals.js';
import { composeCable } from '../docs/cable.js';
import { type ComposedDocument } from '../docs/document.js';
import { type NamerContext } from '../docs/namer.js';
import type {
  ContentSet,
  CoverIdentity as CoverIdentityTemplate,
  DocumentTemplate,
} from '@tradecraft/content';

// ---------------------------------------------------------------------------
// CoverIdentity
// ---------------------------------------------------------------------------

/** The Cover Suspicion modifiers a Cover Identity carries. */
export interface CoverSuspicionModifiers {
  /** The modifier at a Location whose Type the cover fits (negative — it lowers suspicion). */
  readonly atFit: number;
  /** The modifier elsewhere (positive — being out of place raises suspicion). */
  readonly elsewhere: number;
}

/**
 * The player's issued Cover Identity (design, "Content Set" table: "title,
 * employer org, plausible Location Types (fit), Cover Suspicion modifiers").
 * Replaces the task-4.6 skeleton `CoverIdentity` in `../model/state.ts` under
 * the same name, so `WorldState.player.cover` is a `CoverIdentity` and every
 * importer keeps compiling.
 *
 * It is a resolved instance of a content cover template, narrowed to the city:
 *
 * - `id` is the content template id the cover was drawn from, so the issued
 *   cover reads back to its source;
 * - `title` and `employerOrg` are the view-safe surface the player presents;
 * - `fitLocationTypes` are the Location *Type* ids where the cover is plausible,
 *   intersected with the Types the generated city actually stamps, so a fit
 *   Type always has at least one real Location (the Cover Suspicion check reads
 *   this against a Location's Type);
 * - `suspicionModifiers` are the Cover Suspicion deltas at a fitting place
 *   versus elsewhere.
 *
 * A Cover Identity is view-safe flavour — it is exactly what the player operates
 * under — so it carries no {@link import('../model/core.js').Truth} brand. The
 * hidden Cover Suspicion *level* lives on `WorldState.player.coverSuspicion`
 * (branded), not here.
 */
export interface CoverIdentity {
  /** The content cover-template id this cover was drawn from. */
  readonly id: string;
  readonly title: string;
  readonly employerOrg: string;
  /** The Location Type ids where the cover fits, each present in the city. */
  readonly fitLocationTypes: readonly string[];
  readonly suspicionModifiers: CoverSuspicionModifiers;
}

// ---------------------------------------------------------------------------
// Brief leads
// ---------------------------------------------------------------------------

/**
 * The source of a Starting Brief lead: the brief Cable Document (design:
 * `source { kind: 'document', id: <brief cable> }`). The engine carries only
 * this engine-level shape; the read action (task 9.2) turns a {@link BriefLead}
 * into a Case File `Claim` with the matching `ClaimSource` of kind `document`.
 */
export interface BriefLeadSource {
  readonly kind: 'document';
  readonly id: DocId;
}

/**
 * One initial lead delivered with the Starting Brief (design: `leads: Claim[]`,
 * each sourced from the brief Cable). It pairs the asserted {@link Proposition}
 * — a true lead or an HQ false belief, drawn straight from the Station's
 * Knowledge Slice — with its {@link BriefLeadSource} naming the brief Cable.
 */
export interface BriefLead {
  readonly source: BriefLeadSource;
  readonly prop: Proposition;
}

// ---------------------------------------------------------------------------
// StartingBrief
// ---------------------------------------------------------------------------

/**
 * A Station Directive, as the Starting Brief carries it (design's `Directive`;
 * owned by task 10.2). The brief only *passes directives through* from the
 * Station step, so it does not need the real shape — and it must not import it
 * from `../model/state.ts`, because `state.ts` re-exports this module's
 * {@link CoverIdentity} and a mutual import would be a cycle.
 *
 * It is therefore declared here as the same tagged skeleton `state.ts` uses
 * (`Skeleton<'Directive'>` — a phantom-tagged, optional-only record), so the two
 * are structurally identical: a `Directive[]` from the Station step assigns to
 * {@link StartingBrief.directives} without a cast, and when task 10.2 fills in
 * the real shape it replaces both in step.
 */
export type BriefDirective = {
  /** Phantom tag; never present at runtime. Replaced by task 10.2. */
  readonly __skeleton?: 'Directive';
};

/**
 * The opening HQ package (design, "Starting Brief"; Requirement 26.1). It
 * carries the Cover Identity, the Chief of Station, the starting known entities,
 * the 2–4 initial leads, the Dossiers, the known Channels, the player Dead
 * Drops, the starting Directives, the starting Budget and the starting Contact
 * Channels, and names the Cable Document it is delivered as (`cable`).
 *
 * The brief is Sim structure the world generator produces and the discovery-path
 * verifier (task 5.8) roots its learnability graph at (Property 19): its
 * `knownEntities`, `leads`, `channels` and `cable` are exactly the player's
 * starting knowledge.
 */
export interface StartingBrief {
  readonly coverIdentity: CoverIdentity;
  readonly chief: NpcId;
  /** Station staff, public Locations, public figures, starting contacts. */
  readonly knownEntities: readonly EntityId[];
  /** 2–4 initial leads, each sourced from the brief Cable. */
  readonly leads: readonly BriefLead[];
  readonly dossiers: readonly DocId[];
  readonly channels: readonly ChannelId[];
  readonly deadDrops: readonly DeadDropId[];
  readonly directives: readonly BriefDirective[];
  readonly budget: number;
  /** The starting Contact Channels (the player's starting contacts). */
  readonly contacts: readonly NpcId[];
  /** The Cable Document the brief is delivered as (Requirement 26.4). */
  readonly cable: DocId;
}

// ---------------------------------------------------------------------------
// Cover Identity generation
// ---------------------------------------------------------------------------

/** The least and most initial leads a brief carries (design: 2–4). */
export const MIN_BRIEF_LEADS = 2;
export const MAX_BRIEF_LEADS = 4;

/**
 * The fixed sub-stream index the brief draws on. The brief needs its own stream
 * so its draws do not shift the core stream the other steps read; a fixed
 * constant (not derived from the seed) suffices because {@link derive} already
 * folds the seed in. The value spells `brif`.
 */
export const BRIEF_STREAM_INDEX = 0x62726966;

/** The distinct Location Type ids the generated city stamps, id-sorted. */
function cityLocationTypes(city: City): Set<string> {
  const types = new Set<string>();
  for (const loc of Object.values(city.locations)) {
    types.add(loc.type);
  }
  return types;
}

/**
 * Choose a Cover Identity for the player from the content pool (design, step 8;
 * "Content Set" table).
 *
 * The pool is read id-sorted so the draw does not depend on registry iteration
 * order. A cover is *eligible* when at least one of its fit Location Types
 * occurs in the generated city, so the issued cover is plausible for this city
 * (its fit Types have real Locations to sit at). One eligible cover is drawn on
 * the brief stream; its recorded `fitLocationTypes` are narrowed to the Types
 * the city actually stamps. If no cover is eligible (a city with none of the
 * pool's fit Types — not possible with the core pack, but kept total), the first
 * cover by id is used with its full fit set.
 *
 * Throws when the content pool is empty — a pack gap the smoke tests catch, not
 * a runtime condition to paper over.
 */
export function generateCoverIdentity(
  prng: Prng,
  content: ContentSet,
  city: City,
): CoverIdentity {
  const covers = [...content.coverIdentities.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  if (covers.length === 0) {
    throw new Error(
      'generateCoverIdentity(): the content set defines no Cover Identities',
    );
  }

  const cityTypes = cityLocationTypes(city);
  const localType = (ref: string): string => ref.slice(ref.lastIndexOf('/') + 1);
  const fitsCity = (cover: CoverIdentityTemplate): string[] =>
    cover.fitLocationTypes.map(localType).filter((t) => cityTypes.has(t));

  const eligible = covers.filter((cover) => fitsCity(cover).length > 0);
  const pool = eligible.length > 0 ? eligible : covers;
  const chosen = prng.pick(pool);

  const narrowed = fitsCity(chosen);
  const fitLocationTypes =
    narrowed.length > 0 ? narrowed : chosen.fitLocationTypes.map(localType);

  return {
    id: chosen.id,
    title: chosen.title,
    employerOrg: chosen.employerOrg,
    fitLocationTypes,
    suspicionModifiers: {
      atFit: chosen.suspicionModifiers.atFit,
      elsewhere: chosen.suspicionModifiers.elsewhere,
    },
  };
}

// ---------------------------------------------------------------------------
// Lead drawing
// ---------------------------------------------------------------------------

/**
 * The pool of leads the brief draws from: the Station Knowledge Slice's true
 * leads and HQ false beliefs together, id-sorted so a draw against them is
 * deterministic. Every lead in the pool is a member of the slice, so Property 19
 * ("every initial lead is a member of the Station's Knowledge Slice") holds by
 * construction.
 */
function leadPool(slice: KnowledgeSlice): Proposition[] {
  return [...slice.known, ...slice.falseBeliefs].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/**
 * Draw 2–4 leads from the Station slice on the brief stream. The count is drawn
 * in `[MIN_BRIEF_LEADS, MAX_BRIEF_LEADS]`, clamped down to the pool size when
 * the slice holds fewer, and the leads are a shuffled prefix of the id-sorted
 * pool, so the draw is deterministic and the leads are a stable subset of the
 * slice. A slice with no leads yields an empty list (the discovery-path verifier
 * would then reject the seed, which is the intended signal).
 */
function drawLeadProps(prng: Prng, slice: KnowledgeSlice): Proposition[] {
  const pool = leadPool(slice);
  if (pool.length === 0) {
    return [];
  }
  const want = prng.int(MIN_BRIEF_LEADS, MAX_BRIEF_LEADS);
  const take = Math.min(want, pool.length);
  return prng.shuffle(pool).slice(0, take);
}

// ---------------------------------------------------------------------------
// Known entities
// ---------------------------------------------------------------------------

/**
 * The starting known entities (design: "Station staff, public Locations, public
 * figures, starting contacts"): the Chief, the Station staff, the starting
 * contacts, every public Location, and the entities named by the leads (so a
 * lead never points at an entity the player does not yet know of). The set is
 * de-duplicated in a stable first-seen order.
 */
function startingKnownEntities(
  principals: GeneratedPrincipals,
  city: City,
  leads: readonly Proposition[],
): EntityId[] {
  const seen = new Set<EntityId>();
  const out: EntityId[] = [];
  const add = (id: EntityId): void => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };

  add(principals.chief);
  for (const staff of principals.staff) {
    add(staff);
  }
  for (const contact of principals.contacts) {
    add(contact);
  }
  for (const loc of Object.values(city.locations)) {
    if (loc.public) {
      add(loc.id);
    }
  }
  for (const lead of leads) {
    add(lead.subject);
    if (typeof lead.object === 'string') {
      add(lead.object);
    }
    if (lead.place !== undefined) {
      add(lead.place);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// StartingBrief generation
// ---------------------------------------------------------------------------

/** The slice of the resolved preset the Starting Brief reads. */
export interface StartingBriefPreset {
  /** The starting Budget, in game currency. */
  readonly startingBudget: number;
}

/** Options for {@link generateStartingBrief}. */
export interface GenerateStartingBriefOptions {
  /**
   * The starting Directives, issued by task 10.2 (the Station and Directives
   * step). Defaults to none; the brief threads whatever it is handed onto
   * `StartingBrief.directives`.
   */
  readonly directives?: readonly BriefDirective[];
  /** The game time the brief Cable is dated. Defaults to day 0, morning. */
  readonly date?: GameTime;
}

/** The result of generating the Starting Brief: the brief and its Cable Document. */
export interface GeneratedStartingBrief {
  readonly brief: StartingBrief;
  /** The Cable Document the brief is delivered as, with the leads it asserts. */
  readonly cable: ComposedDocument;
}

/** The brief Cable's reference, derived from the seed so it reads stably. */
function briefCableRef(seed: string): string {
  // A short, upper-case HQ reference. The seed tail keeps distinct games apart
  // without exposing the whole seed on the Cable face.
  const tail = seed.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() || 'BRIEF';
  return `HQ-${tail}`;
}

/**
 * Generate the Cover Identity and the Starting Brief (design, step 8;
 * Requirements 26.1, 26.2, 26.4).
 *
 * The brief is assembled from the earlier core-stream outputs and delivered as a
 * telegraphic HQ Cable:
 *
 * 1. a Cover Identity is drawn from the content pool, narrowed to the city
 *    ({@link generateCoverIdentity});
 * 2. 2–4 leads are drawn from the Station's Knowledge Slice (true leads and HQ
 *    false beliefs alike, Requirement 26.2);
 * 3. the brief Cable is composed with {@link composeCable}, asserting the drawn
 *    leads, so reading it seeds the Case File (the Cable's `DocId` is the leads'
 *    source);
 * 4. the known-entity set is built from the Station staff, the public Locations,
 *    the starting contacts and the entities the leads name;
 * 5. the brief binds the Station's Channels and the player's Dead Drop (the
 *    Station drop), the starting Directives, the starting Budget and the
 *    starting contacts.
 *
 * `seed` is the game seed; the generator runs on a dedicated sub-stream derived
 * with `derive(seed, 'brief')`, so the brief's draws do not shift the core
 * stream the other steps read. The result is a pure function of the seed and the
 * content. The brief Cable carries no `obtainableAt` (it is delivered, not
 * obtained at a Location), and asserts exactly the leads.
 */
export function generateStartingBrief(
  seed: string,
  content: ContentSet,
  city: City,
  principals: GeneratedPrincipals,
  comms: GeneratedComms,
  stationSlice: KnowledgeSlice,
  cableTemplate: DocumentTemplate,
  namerCtx: NamerContext,
  preset: StartingBriefPreset,
  options: GenerateStartingBriefOptions = {},
): GeneratedStartingBrief {
  const prng = createPrng(derive(seed, BRIEF_STREAM_INDEX));
  const date: GameTime = options.date ?? { day: 0, phase: 0 };
  const directives = options.directives ?? [];

  // 1. The Cover Identity, drawn from the pool and narrowed to the city.
  const coverIdentity = generateCoverIdentity(prng, content, city);

  // 2. The leads, drawn from the Station slice (true leads and HQ false beliefs).
  const leadProps = drawLeadProps(prng, stationSlice);

  // 3. The brief Cable, asserting the leads. Its DocId is the leads' source.
  const cableRef = briefCableRef(seed);
  const cable = composeCable(
    cableTemplate,
    {
      cableRef,
      priority: 'IMMEDIATE',
      toStation: 'STATION',
      subject: 'STARTING BRIEF',
      instruction:
        'ASSUME COVER AND REPORT TO STATION STOP WORK THE LEADS ON FILE STOP ' +
        'CORROBORATE BEFORE ANY ACTION',
      budgetLine: `${preset.startingBudget} DRAWN ON STATION ACCOUNT`,
    },
    { ...namerCtx, date, asserts: leadProps },
  );
  const cableDocId = cable.document.id;

  const leads: BriefLead[] = leadProps.map((prop) => ({
    source: { kind: 'document', id: cableDocId },
    prop,
  }));

  // 4. The starting known entities.
  const knownEntities = startingKnownEntities(principals, city, leadProps);

  // 5. The brief's comms, directives, budget and contacts.
  const brief: StartingBrief = {
    coverIdentity,
    chief: principals.chief,
    knownEntities,
    leads,
    dossiers: [],
    channels: [...comms.stationChannels],
    deadDrops: [comms.stationDrop],
    directives,
    budget: preset.startingBudget,
    contacts: [...principals.contacts],
    cable: cableDocId,
  };

  return { brief, cable };
}
