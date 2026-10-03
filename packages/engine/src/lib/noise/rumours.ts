/**
 * Rumours and Noise Traffic: steps 3 and 4 of the world generator's **noise**
 * stream (design, "Noise Generator", steps 3–4; Requirements 29.3, 29.4).
 *
 * The core generator (`../generate.ts`) builds and verifies the world on the
 * core PRNG stream. The noise generator then runs on a *separate* stream
 * (`derive(seed, 0x10000)`, {@link import('../generate.js').NOISE_STREAM_BASE})
 * and only ever *adds* entities and beliefs; it never mutates core entities
 * (design: "Noise only adds entities and beliefs"). This module owns the last
 * two of those additions — the Rumours and the Noise Traffic Channels — as pure,
 * standalone generators. Task 6.4 wires them (and the earlier noise steps) into
 * `generate()`'s noise stream; this module does not touch `generate.ts`.
 *
 * ## Rumours (step 3; Requirement 29.3)
 *
 * A **Rumour** is a false belief a Background NPC holds and passes along: café
 * gossip that has drifted from the truth. The core pack authors Rumour
 * *templates* (`rumours.yaml`) as "a predicate pattern with distortions (swap
 * subject, shift day, invent target)" (design, Content-Set table). This step
 * takes a true-ish *source* Proposition — drawn from the Plot, a Side Thread or
 * a Background NPC's local facts — and applies a template's distortions to it,
 * yielding a Proposition that does **not** hold in the Truth Store:
 *
 * - **swap-subject** — the Proposition's subject (and, for an entity-object
 *   predicate, sometimes its object) is replaced by *another* entity of a
 *   compatible kind, so the wrong face is put at the table;
 * - **shift-day** — the Proposition's time window has its day slid by a nonzero
 *   amount within the template's `shiftDays` bound, so the retelling has the day
 *   wrong (and a window is minted if the source carried none, so the drift is
 *   observable);
 * - **invent-target** — the Proposition's object is replaced by an invented or
 *   mismatched entity (a conjured target), so a target is named where there was
 *   none or a different one.
 *
 * Each distorted Proposition gets a fresh `prop:rumour/<n>` id (so it never
 * collides with a core, Side-Thread or local prop id) and is attached to a
 * Background NPC as a **false belief**. The same Rumour is also returned in a
 * flat list the newspaper step (task 9.1) can read, with its source and the
 * holder recorded, so a rumour is "available to newspapers" (design, step 3).
 *
 * A distortion only ever rewrites subject / object / window — never the
 * predicate — so the result is still a well-formed Proposition over the
 * Predicate Vocabulary, just a *false* one. The module guarantees the distorted
 * Proposition differs from its source (it retries the random pick a bounded
 * number of times and, failing that, falls back to a guaranteed-different
 * choice), so a Rumour is always a genuine distortion, not an accidental echo
 * of the truth.
 *
 * ## Noise Traffic (step 4; Requirement 29.4)
 *
 * **Noise Traffic Channels** are decoy comms — diplomatic, commercial and
 * criminal chatter — generated "at the preset ratio" so the player's intercepts
 * are *mostly* noise and they must triage signal from static (design, step 4;
 * Requirement 29.4). The Difficulty Preset carries the ratio as
 * `noiseTrafficRatio = { noise, plot }` (the design's "1 : 1", "2 : 1", "4 : 1");
 * given the number of *signal* (Plot) Channels the core comms generator made,
 * the count of noise channels is `round(plotSignalCount × noise / plot)` — so a
 * 2 : 1 preset over three Plot channels yields six noise channels, and intercepts
 * are two-thirds noise.
 *
 * Each noise channel is a real engine {@link Channel} (reusing the
 * `kind`/`owner`/`schedule` shape {@link import('../city/comms.js').generateComms}
 * builds core channels with), owned by a distinct **noise source** — a minted
 * `org:noise-diplomatic` / `org:noise-commercial` / `org:noise-criminal` org id
 * that is *not* one of the three real orgs (Station, Hostile Service, Cell), so a
 * noise channel never reads back to a real operator. The three channel families
 * are cycled in a fixed order so the mix is deterministic, each with a drawn
 * interceptable kind (`radio`/`numbers` — never a dead drop) and a well-formed
 * schedule drawn exactly as `generateComms` / `side-threads.ts` draw theirs.
 * Channel ids are namespaced `chan:noise/<n>/<family>` so they can never collide
 * with a core (`chan:<owner>/<tag>`) or Side-Thread (`chan:thread/<n>/<tag>`)
 * channel id.
 *
 * ## Determinism
 *
 * Both generators draw every choice from the passed {@link Prng} in a fixed
 * order over id-sorted lists, exactly as the city, principal, Plot, comms,
 * Background-NPC and Side-Thread generators do, so each result is a pure function
 * of the noise seed, the inputs and the content (Requirement 1.2, underpinning
 * Property 1 — seed determinism; Requirement 29.5 — the noise stream is
 * independent of the core).
 */

import {
  type EntityId,
  type GameTime,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
  type Proposition,
  type PropId,
  type TimeWindow,
} from '../model/core.js';
import { type Prng } from '../prng/prng.js';
import {
  CHANNEL_KINDS,
  MAX_CHANNEL_PERIOD,
  MIN_CHANNEL_PERIOD,
  type Channel,
  type ChannelKind,
  type ChannelSchedule,
} from '../city/comms.js';
import { type GeneratedBackgroundNpcs } from './background.js';
import { type GeneratedSideThreads } from './side-threads.js';
import type { ContentSet, RumourTemplate } from '@tradecraft/content';

// ---------------------------------------------------------------------------
// Rumour result shapes
// ---------------------------------------------------------------------------

/** The id prefix every Rumour Proposition carries, so ids never collide. */
export const RUMOUR_PROP_PREFIX = 'rumour';

/**
 * The maximum day a shift-day distortion may slide a window to; a window's day
 * never goes negative (the game starts on day 0) nor past this soft ceiling, so
 * a shifted window stays well-formed. Chosen generously — a rumour that drifts a
 * few days is plausible gossip.
 */
export const MAX_RUMOUR_DAY = 365;

/** How many times to redraw a distortion pick before falling back to a forced different value. */
const MAX_DISTORT_RETRIES = 8;

/**
 * One generated Rumour: a distorted (false) Proposition, the source Proposition
 * it drifted from, the distortions that were applied, the template it came from,
 * and the Background NPC that holds it as a false belief.
 *
 * A Rumour is unbranded Sim structure, like a Side Thread: the player learns of
 * it only by talking to a Background NPC or reading a newspaper that carries it,
 * then has to work out it is false. The `proposition` is deliberately a plain
 * {@link Proposition} (not {@link import('../model/core.js').Truth}-wrapped) —
 * it is a *belief*, held and spread, not ground truth.
 */
export interface Rumour {
  /** The distorted, false Proposition (fresh `prop:rumour/<n>` id). */
  readonly proposition: Proposition;
  /** The id of the source Proposition this Rumour drifted from. */
  readonly source: PropId;
  /** The distortions applied (a subset of the template's), in applied order. */
  readonly distortions: readonly RumourDistortion[];
  /** The id of the Rumour template this Rumour was built from. */
  readonly template: string;
  /** The Background NPC that holds this Rumour as a false belief. */
  readonly holder: NpcId;
}

/** The distortion kinds a Rumour template may apply (mirrors the content enum). */
export type RumourDistortion = 'swap-subject' | 'shift-day' | 'invent-target';

/** The output of {@link generateRumours}. */
export interface GeneratedRumours {
  /** Every generated Rumour, in generation order (available to newspapers). */
  readonly rumours: readonly Rumour[];
  /**
   * The false beliefs each Background NPC gained, keyed by NPC id. Task 6.4
   * folds these into each Background NPC's `falseBeliefs`; an NPC that holds no
   * Rumour has no entry.
   */
  readonly falseBeliefsByHolder: Readonly<Record<NpcId, readonly Proposition[]>>;
}

// ---------------------------------------------------------------------------
// Noise Traffic result shapes
// ---------------------------------------------------------------------------

/** The three noise-traffic families the design names (diplomatic, commercial, criminal). */
export const NOISE_TRAFFIC_FAMILIES = ['diplomatic', 'commercial', 'criminal'] as const;

/** One noise-traffic family. */
export type NoiseTrafficFamily = (typeof NOISE_TRAFFIC_FAMILIES)[number];

/** The minted org id of a noise-traffic source for a family: `org:noise-<family>`. */
export function noiseOrgId(family: NoiseTrafficFamily): OrgId {
  return `org:noise-${family}` as OrgId;
}

/** The three noise-source org ids, one per family, in family order. */
export const NOISE_TRAFFIC_OWNERS: readonly OrgId[] = NOISE_TRAFFIC_FAMILIES.map(noiseOrgId);

/**
 * The channel kinds a noise-traffic channel may take: the interceptable kinds
 * (`radio`, `numbers`) only, so the noise actually lands in the player's
 * intercept take and competes with the signal (Requirement 29.4; design: "so the
 * player can triage"). Never a `courier` or `dead-drop` — those are serviced or
 * walked, not intercepted at the Station. Drawn id-stably from
 * {@link CHANNEL_KINDS}.
 */
export const NOISE_TRAFFIC_KINDS: readonly ChannelKind[] = CHANNEL_KINDS.filter(
  (k) => k === 'radio' || k === 'numbers',
);

/** The output of {@link generateNoiseTraffic}. */
export interface GeneratedNoiseTraffic {
  /** Every noise-traffic Channel keyed by id, as `WorldState.channels` holds them. */
  readonly channels: Readonly<Record<string, Channel>>;
  /** The noise-traffic Channels in generation order. */
  readonly traffic: readonly Channel[];
  /**
   * The channel ids grouped by family, so a caller (or test) can see the
   * diplomatic / commercial / criminal mix without re-parsing ids.
   */
  readonly byFamily: Readonly<Record<NoiseTrafficFamily, readonly string[]>>;
}

// ---------------------------------------------------------------------------
// Slugging and id minting (mirrors ../city/comms.ts and ../noise/side-threads.ts)
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

/** Mint a stable PropId for a Rumour: `prop:rumour/<n>`. */
function rumourPropId(index: number): PropId {
  return `prop:${RUMOUR_PROP_PREFIX}/${index}`;
}

/**
 * Mint a Channel id for a noise-traffic channel, namespaced under `noise/` so it
 * never collides with a core (`chan:<owner>/<tag>`) or Side-Thread
 * (`chan:thread/<n>/<tag>`) channel id: `chan:noise/<n>/<family>`.
 */
function noiseChannelId(index: number, family: NoiseTrafficFamily): string {
  return `chan:noise/${index}/${slug(family)}`;
}

// ---------------------------------------------------------------------------
// Rumour template selection
// ---------------------------------------------------------------------------

/**
 * The Rumour templates in the content set, id-sorted so the draw order is a pure
 * function of the content. The core pack ships several (Requirement 31.7).
 */
export function rumourTemplates(content: ContentSet): RumourTemplate[] {
  return [...content.rumourTemplates.values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/**
 * The Rumour templates whose predicate matches a source Proposition's
 * predicate, id-sorted. A Rumour template is a *predicate pattern* — it only
 * applies to a source that uses the same predicate, so swapping/inventing keeps
 * the Proposition well-formed over the Predicate Vocabulary.
 */
function templatesForPredicate(
  templates: readonly RumourTemplate[],
  predicate: string,
): RumourTemplate[] {
  return templates.filter((t) => t.predicate === predicate);
}

// ---------------------------------------------------------------------------
// Source-proposition pool
// ---------------------------------------------------------------------------

/**
 * Gather the pool of source Propositions a Rumour may distort: the Plot's, the
 * Side Threads' and the Background NPCs' local facts (design, step 3: "applied
 * to Plot, Side Thread or local Propositions"). The pool is id-sorted and
 * de-duplicated by Proposition id so a draw against it is a pure function of the
 * inputs regardless of record order.
 */
export function rumourSourcePool(
  plotPropositions: readonly Proposition[],
  sideThreads: GeneratedSideThreads,
  background: GeneratedBackgroundNpcs,
): Proposition[] {
  const byId = new Map<PropId, Proposition>();
  const add = (p: Proposition): void => {
    if (!byId.has(p.id)) {
      byId.set(p.id, p);
    }
  };
  for (const p of plotPropositions) {
    add(p);
  }
  for (const thread of sideThreads.sideThreads) {
    for (const p of thread.propositions) {
      add(p);
    }
  }
  for (const bg of background.background) {
    for (const p of bg.knowledge.known) {
      add(p);
    }
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// The entity pool a swap / invent draws its replacement from
// ---------------------------------------------------------------------------

/**
 * The id-sorted pool of Background-NPC ids a swap-subject or invent-target
 * distortion draws its replacement entity from. Rumours name only civilians and
 * their haunts (the content guardrail: "rumours name no real people and depict
 * no real atrocities — they are café gossip"), so the pool is the Background
 * NPCs, never a Principal, a Cell member or an org.
 */
function rumourEntityPool(background: GeneratedBackgroundNpcs): NpcId[] {
  return background.background
    .map((bg) => bg.npc.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---------------------------------------------------------------------------
// The distortion operators
// ---------------------------------------------------------------------------

/**
 * Draw an entity from `pool` that differs from every id in `avoid`. Retries a
 * bounded number of times, then falls back to the first pool entry not in
 * `avoid`; returns `undefined` only when the pool offers no distinct entity.
 */
function pickDistinctEntity(
  prng: Prng,
  pool: readonly NpcId[],
  avoid: ReadonlySet<EntityId>,
): NpcId | undefined {
  if (pool.length === 0) {
    return undefined;
  }
  for (let i = 0; i < MAX_DISTORT_RETRIES; i += 1) {
    const pick = prng.pick(pool);
    if (!avoid.has(pick)) {
      return pick;
    }
  }
  return pool.find((id) => !avoid.has(id));
}

/** True when a predicate's object in this Proposition is an entity id (not a literal). */
function objectIsEntity(prop: Proposition): boolean {
  return typeof prop.object === 'string';
}

/**
 * Shift a Proposition's window day by a nonzero amount within `[-shiftDays,
 * shiftDays]`, clamped to `[0, MAX_RUMOUR_DAY]`. When the source carries no
 * window, mint one at a drawn day so the drift is observable. Returns the new
 * window and whether the day actually changed.
 */
function shiftWindow(
  prng: Prng,
  window: TimeWindow | undefined,
  shiftDays: number,
  phaseFloor: Phase,
): { window: TimeWindow; changed: boolean } {
  const bound = Math.max(1, Math.min(shiftDays, MAX_RUMOUR_DAY));
  if (window === undefined) {
    // Mint a window at a drawn, strictly-positive day so a sourceless window is
    // visibly "wrong" against a truth that has none.
    const day = prng.int(1, bound);
    return {
      window: { from: { day, phase: phaseFloor } },
      changed: true,
    };
  }
  const baseDay = window.from.day;
  // Draw a nonzero delta in [-bound, bound], then clamp the resulting day.
  let delta = prng.int(-bound, bound);
  for (let i = 0; i < MAX_DISTORT_RETRIES && delta === 0; i += 1) {
    delta = prng.int(-bound, bound);
  }
  if (delta === 0) {
    delta = 1;
  }
  const newDay = Math.max(0, Math.min(MAX_RUMOUR_DAY, baseDay + delta));
  const changed = newDay !== baseDay;
  const shifted: TimeWindow = {
    from: { day: newDay, phase: window.from.phase },
    ...(window.to !== undefined
      ? { to: { day: Math.max(newDay, window.to.day), phase: window.to.phase } }
      : {}),
  };
  return { window: shifted, changed };
}

/**
 * Apply one Rumour template's distortions to a source Proposition, minting a new
 * false Proposition with the given id. Returns the distorted Proposition, the
 * distortions actually applied (those that changed something), or `undefined`
 * when no distortion could be applied (e.g. an empty entity pool for a
 * swap/invent and a predicate with no window to shift) — the caller then skips
 * this (template, source) pairing rather than emit a Rumour identical to the
 * truth.
 */
function distort(
  prng: Prng,
  source: Proposition,
  template: RumourTemplate,
  entityPool: readonly NpcId[],
  id: PropId,
): { proposition: Proposition; applied: RumourDistortion[] } | undefined {
  let subject = source.subject;
  let object = source.object;
  let window = source.window;
  const applied: RumourDistortion[] = [];

  for (const distortion of template.distortions) {
    if (distortion === 'swap-subject') {
      // Put the wrong person at the centre: replace the subject (and, for an
      // entity-object predicate, occasionally the object) with another civilian.
      const avoid = new Set<EntityId>([subject]);
      if (typeof object === 'string') {
        avoid.add(object);
      }
      const replacement = pickDistinctEntity(prng, entityPool, avoid);
      if (replacement !== undefined) {
        subject = replacement;
        applied.push('swap-subject');
      }
    } else if (distortion === 'shift-day') {
      const shiftDays = template.shiftDays ?? 1;
      const { window: shifted, changed } = shiftWindow(
        prng,
        window,
        shiftDays,
        source.window?.from.phase ?? (0 as Phase),
      );
      if (changed) {
        window = shifted;
        applied.push('shift-day');
      }
    } else {
      // invent-target: conjure a target where the predicate takes an entity
      // object. For a literal-object predicate (PLANS, CARRIES, …) invent a
      // free-text target instead, so the rumour still names something false.
      if (objectIsEntity(source)) {
        const avoid = new Set<EntityId>([subject]);
        if (typeof object === 'string') {
          avoid.add(object);
        }
        const invented = pickDistinctEntity(prng, entityPool, avoid);
        if (invented !== undefined) {
          object = invented;
          applied.push('invent-target');
        }
      } else {
        object = { kind: 'text', value: 'something nobody can quite name' };
        applied.push('invent-target');
      }
    }
  }

  if (applied.length === 0) {
    return undefined;
  }

  const proposition: Proposition = {
    id,
    subject,
    predicate: source.predicate,
    object,
    ...(source.place !== undefined ? { place: source.place } : {}),
    ...(window !== undefined ? { window } : {}),
  };

  // A distortion must actually change the Proposition — guard against the rare
  // case where swaps cancelled out to the original shape.
  if (propositionsEqual(proposition, source)) {
    return undefined;
  }

  return { proposition, applied };
}

/** Structural equality of two Propositions on the fields a distortion touches. */
function propositionsEqual(a: Proposition, b: Proposition): boolean {
  return (
    a.subject === b.subject &&
    a.predicate === b.predicate &&
    JSON.stringify(a.object) === JSON.stringify(b.object) &&
    a.place === b.place &&
    JSON.stringify(a.window) === JSON.stringify(b.window)
  );
}

// ---------------------------------------------------------------------------
// generateRumours
// ---------------------------------------------------------------------------

/**
 * Generate the Rumours from the content set's Rumour templates, applied to the
 * Plot / Side-Thread / local source Propositions and attached to Background NPCs
 * as false beliefs (design, "Noise Generator", step 3; Requirement 29.3).
 *
 * `prng` must be the **noise** stream for the current attempt
 * (`derive(seed, 0x10000)`), independent of the core stream (Requirement 29.5).
 * `count` is the Rumour count from the Difficulty Preset's `noiseCounts.rumours`;
 * task 6.4 reads it from the resolved preset. `plotPropositions` are the Plot's
 * true Propositions (a source pool), `sideThreads` and `background` are the
 * outputs of tasks 6.2 and 6.1.
 *
 * The draw order is fixed so the result is a pure function of the noise stream:
 * for each of the `count` Rumours, in order, it
 *
 * 1. draws a source Proposition from the id-sorted source pool;
 * 2. draws a Rumour template whose predicate matches that source;
 * 3. applies the template's distortions to mint a fresh, false Proposition
 *    (`prop:rumour/<n>`); and
 * 4. draws a Background NPC to hold it as a false belief.
 *
 * A (source, template) pairing that cannot be distorted (no entity to swap in and
 * no window to shift) is skipped and the next source/template is tried, up to a
 * bounded number of attempts per Rumour, so the generator makes a genuine
 * distortion or produces fewer Rumours rather than emit an echo of the truth.
 *
 * Returns no Rumour when there is no source pool, no matching template, or no
 * Background NPC to hold one — the noise stream degrades gracefully rather than
 * throwing. Throws only on a negative or non-integer `count` (a programming
 * error).
 */
export function generateRumours(
  prng: Prng,
  content: ContentSet,
  plotPropositions: readonly Proposition[],
  sideThreads: GeneratedSideThreads,
  background: GeneratedBackgroundNpcs,
  count: number,
): GeneratedRumours {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(
      `generateRumours(): count must be a non-negative integer, received ${String(count)}`,
    );
  }

  const templates = rumourTemplates(content);
  const sources = rumourSourcePool(plotPropositions, sideThreads, background);
  const entityPool = rumourEntityPool(background);
  const holders = background.background
    .map((bg) => bg.npc.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const rumours: Rumour[] = [];
  // Bail early when the stream cannot produce a Rumour, so we never draw from
  // the prng for an impossible request (keeps the draw order tight).
  if (count === 0 || templates.length === 0 || sources.length === 0 || holders.length === 0) {
    return { rumours, falseBeliefsByHolder: {} };
  }

  // Up to this many (source, template) attempts per Rumour before giving up on
  // that slot — bounded so a pathological pack cannot loop forever.
  const MAX_ATTEMPTS_PER_RUMOUR = 6;

  for (let i = 0; i < count; i += 1) {
    let made: Rumour | undefined;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_RUMOUR && made === undefined; attempt += 1) {
      const source = prng.pick(sources);
      const matching = templatesForPredicate(templates, source.predicate);
      if (matching.length === 0) {
        continue;
      }
      const template = prng.pick(matching);
      const id = rumourPropId(rumours.length);
      const distorted = distort(prng, source, template, entityPool, id);
      if (distorted === undefined) {
        continue;
      }
      const holder = prng.pick(holders);
      made = {
        proposition: distorted.proposition,
        source: source.id,
        distortions: distorted.applied,
        template: template.id,
        holder,
      };
    }
    if (made !== undefined) {
      rumours.push(made);
    }
  }

  const falseBeliefsByHolder: Record<NpcId, Proposition[]> = {};
  for (const rumour of rumours) {
    const list = falseBeliefsByHolder[rumour.holder];
    if (list === undefined) {
      falseBeliefsByHolder[rumour.holder] = [rumour.proposition];
    } else {
      list.push(rumour.proposition);
    }
  }

  return { rumours, falseBeliefsByHolder };
}

// ---------------------------------------------------------------------------
// Noise Traffic schedule drawing (mirrors ../city/comms.ts drawSchedule)
// ---------------------------------------------------------------------------

/**
 * Draw a well-formed {@link ChannelSchedule} on the noise stream, exactly as
 * `generateComms` / `side-threads.ts` draw theirs: a period in
 * `[MIN_CHANNEL_PERIOD, MAX_CHANNEL_PERIOD]` days, a start day within the first
 * `period` days, and a phase drawn from the four. The firing phase is the
 * start's phase, so `isWellFormedSchedule` holds.
 */
function drawSchedule(prng: Prng, start: GameTime): ChannelSchedule {
  const period = prng.int(MIN_CHANNEL_PERIOD, MAX_CHANNEL_PERIOD);
  const dayOffset = prng.int(0, period - 1);
  const phase = prng.int(0, 3) as Phase;
  return {
    period,
    start: { day: start.day + dayOffset, phase },
    phase,
  };
}

// ---------------------------------------------------------------------------
// Noise-traffic count from the preset ratio
// ---------------------------------------------------------------------------

/**
 * The number of noise-traffic Channels to generate, given the number of signal
 * (Plot) Channels and the preset's `noise : plot` ratio (Requirement 29.4). The
 * count is `round(plotSignalCount × noise / plot)`, so the player's intercept
 * take runs noise-heavy at the preset mix: a 2 : 1 ratio over three Plot
 * channels yields six noise channels. Clamped to be non-negative; a zero or
 * negative signal count yields zero noise channels.
 */
export function noiseTrafficCount(
  plotSignalCount: number,
  ratio: { readonly noise: number; readonly plot: number },
): number {
  if (plotSignalCount <= 0 || ratio.plot <= 0 || ratio.noise <= 0) {
    return 0;
  }
  return Math.max(0, Math.round((plotSignalCount * ratio.noise) / ratio.plot));
}

// ---------------------------------------------------------------------------
// generateNoiseTraffic
// ---------------------------------------------------------------------------

/**
 * Generate the Noise Traffic Channels — diplomatic, commercial and criminal
 * decoy comms — at the preset ratio (design, "Noise Generator", step 4;
 * Requirement 29.4).
 *
 * `prng` must be the **noise** stream for the current attempt
 * (`derive(seed, 0x10000)`), independent of the core stream (Requirement 29.5).
 * `plotSignalCount` is the number of interceptable *signal* Channels the core
 * comms generator made (the Plot's radio/numbers channels — task 6.4 passes
 * `GeneratedComms.plotChannels.length` or the interceptable subset); `ratio` is
 * the preset's `noiseTrafficRatio`. The channel count is
 * {@link noiseTrafficCount}`(plotSignalCount, ratio)`.
 *
 * The three families are cycled in a fixed order (`diplomatic`, `commercial`,
 * `criminal`, repeating) so the mix is deterministic and balanced, each channel
 * owned by its family's minted `org:noise-<family>` id — a non-colliding noise
 * source that is **not** one of the three real orgs. Each channel draws an
 * interceptable kind and a well-formed schedule from the noise stream, in a
 * fixed per-channel order (kind, then schedule). Channel ids are namespaced
 * `chan:noise/<n>/<family>` so they can never collide with a core or
 * Side-Thread channel.
 *
 * `start` is the game start time, the floor for every schedule. The result is a
 * pure function of the noise seed, the signal count and the ratio.
 */
export function generateNoiseTraffic(
  prng: Prng,
  plotSignalCount: number,
  ratio: { readonly noise: number; readonly plot: number },
  start: GameTime,
): GeneratedNoiseTraffic {
  const count = noiseTrafficCount(plotSignalCount, ratio);

  const traffic: Channel[] = [];
  const channels: Record<string, Channel> = {};
  const byFamily: Record<NoiseTrafficFamily, string[]> = {
    diplomatic: [],
    commercial: [],
    criminal: [],
  };

  for (let i = 0; i < count; i += 1) {
    const family = NOISE_TRAFFIC_FAMILIES[i % NOISE_TRAFFIC_FAMILIES.length];
    const kind = prng.pick(NOISE_TRAFFIC_KINDS);
    const schedule = drawSchedule(prng, start);
    const id = noiseChannelId(i, family);
    const channel: Channel = {
      id: id as Channel['id'],
      kind,
      owner: noiseOrgId(family),
      schedule,
    };
    traffic.push(channel);
    channels[id] = channel;
    byFamily[family].push(id);
  }

  return { channels, traffic, byFamily };
}

// ---------------------------------------------------------------------------
// Invariants (exported for tests / later tasks)
// ---------------------------------------------------------------------------

/**
 * True when an owner id is a noise-traffic source (`org:noise-<family>`), i.e.
 * one of {@link NOISE_TRAFFIC_OWNERS}. The direct check of Requirement 29.4's
 * "noise source, not a real operator": a noise channel's owner must satisfy
 * this, and must *not* be a Station / Hostile / Cell org id.
 */
export function isNoiseOwner(owner: EntityId): boolean {
  return (NOISE_TRAFFIC_OWNERS as readonly string[]).includes(owner);
}

/** Every entity id a Rumour's Proposition names (subject, entity object, place). */
export function rumourEntities(rumour: Rumour): Set<EntityId> {
  const out = new Set<EntityId>();
  const p = rumour.proposition;
  out.add(p.subject);
  if (typeof p.object === 'string') {
    out.add(p.object);
  }
  if (p.place !== undefined) {
    out.add(p.place as LocId);
  }
  return out;
}
