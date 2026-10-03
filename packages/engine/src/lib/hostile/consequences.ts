/**
 * The off-screen consequences of the Hostile Service's hidden events (task
 * 19.5; design, "Notifications" → "Hidden events and their observable
 * consequences"; Requirements 39.4, 39.5).
 *
 * The daily tick (`./hostile.ts`) emits three hidden events — `asset-detected`,
 * `asset-arrested`, `asset-doubled` — that the player must never be notified of
 * directly (Req 39.4). But some carry a consequence the player *can* observe
 * later, and this leaf turns the hidden events into exactly that observable
 * data (Req 39.5). It owns two concerns:
 *
 * ## 1. The arrested Asset's missed meetings and unserviced drops
 *
 * When the service arrests an Asset, the Asset is gone: it misses the meetings
 * the player arranged with it and leaves unloaded the drops it was supposed to
 * load. The design's consequence table reads:
 *
 * > Asset arrested → `meeting-no-show` at the next arranged meeting the player
 * > attends; `drop-unserviced` when the player next services a drop the Asset
 * > should have loaded; `asset-silent` after `silenceDays`; a newspaper arrest
 * > article with p = `1 − deceptionAppetite`.
 *
 * player-view's task 16.6 (`notify/derived.ts`) raises the derived
 * `meeting-no-show` / `drop-unserviced` player-visible events, but it reads
 * **only player-side expectations** — arranged meetings now due, drops the
 * player just serviced — never the hidden Sim state that caused them. So this
 * leaf's job is not to raise those events itself (that would leak the hidden
 * arrest); it is to apply the arrest to the *ground-truth expectation* the
 * player set up, so that when the player later keeps the meeting or services the
 * drop, 16.6 sees a genuine no-show / unserviced drop and surfaces it.
 *
 * {@link arrestConsequences} is pure: from the day's `asset-arrested` events and
 * a projection of each arrested Asset's upcoming commitments (the meetings the
 * player arranged with it and the drops it was tasked to load), it returns the
 * commitments the arrest voids — the meetings the Asset will no-show and the
 * drops it will leave unserviced. The Turn Pipeline applies these to
 * `WorldState.meetings` (marking the slot a `no-show` when the player attends)
 * and to the drop's expected-loader record, from where 16.6's expectations are
 * then read. Keeping this leaf Relationship-/WorldState-light mirrors 19.1/19.2:
 * it takes the commitments as a projection and returns data, never reaching into
 * the Relationship or meeting state itself.
 *
 * ## 2. The public arrest article (Req 39.4)
 *
 * An arrest may make the papers. The doctrine's `deceptionAppetite` gates it: a
 * service that runs deception keeps its arrests quiet, a service that does not
 * is content to see them printed, so the article is printed with
 * **p = `1 − deceptionAppetite`** (design; doctrine docblock: "gates the public
 * arrest article (printed with `1 − deceptionAppetite`)"). {@link arrestArticle}
 * draws one coin on the passed {@link Prng} against that probability and, on a
 * hit, returns a {@link NewspaperItem} the newspaper composer prints into the
 * day's edition. The article is a public document, not a Notification — the
 * player learns of the arrest the way anyone would, by reading the paper — so it
 * respects Req 39.4 (no Notification for the hidden event) while delivering the
 * Req 39.5 observable consequence.
 *
 * ## Doubling carries no consequence here (Req 39.4)
 *
 * A quietly doubled Asset has no observable consequence at all — "Nothing
 * directly; only the content of later reports changes" (design). The
 * `asset-doubled` path (`./doubling.ts`) deliberately carries no player-visible
 * event, and this leaf adds none: it ignores `asset-doubled` events entirely, so
 * a double stays signal-free (design, Req 39.4: "keep doubling free of any
 * direct signal").
 *
 * ## Purity / determinism
 *
 * {@link arrestConsequences} makes no draws (it is a pure projection). The only
 * randomness is {@link arrestArticle}'s single coin per arrest, drawn on the
 * passed Prng, so the same doctrine, seed and arrests always yield the same
 * articles (Requirement 1.2). {@link arrestArticles} draws one coin per arrested
 * Asset in id-sorted order so the stream is independent of event order.
 */

import type { GameTime, NpcId, Proposition } from '../model/core.js';
import type { DeadDropId, MeetingId, SimEvent } from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import type { Doctrine } from './doctrine.js';
import type { NewspaperItem } from '../docs/newspaper.js';

// ---------------------------------------------------------------------------
// The arrested Asset's missed meetings and unserviced drops (Req 39.5)
// ---------------------------------------------------------------------------

/**
 * A meeting the player arranged with an Asset that is now void because the Asset
 * was arrested. The Turn Pipeline marks the meeting a `no-show` at its slot so
 * that, when the player attends, 16.6 raises the `meeting-no-show` derived
 * event. Carries the meeting id and its slot (16.6 stamps the event with the
 * slot), so the pipeline needs no extra lookup.
 */
export interface VoidedMeeting {
  /** The meeting the arrested Asset will not keep. */
  readonly meeting: MeetingId;
  /** When the meeting is due (16.6 stamps `meeting-no-show` with this). */
  readonly slot: GameTime;
}

/**
 * A Dead Drop an arrested Asset was tasked to load but now will not, so the
 * player finds it unserviced when they next service it. The Turn Pipeline marks
 * the drop's expected load as not-coming so 16.6 raises `drop-unserviced` on the
 * player's next servicing.
 */
export interface VoidedDrop {
  /** The Dead Drop the arrested Asset will not load. */
  readonly drop: DeadDropId;
}

/**
 * One Asset's upcoming commitments to the player, projected in by the Turn
 * Pipeline (this leaf is Relationship-/meeting-state-free). The caller supplies,
 * per Asset, the meetings the player arranged with it that are still pending
 * (not yet kept/declined) and the drops it was tasked to load but has not yet.
 * {@link arrestConsequences} voids exactly these when the Asset is arrested.
 */
export interface AssetCommitments {
  /** The Asset. */
  readonly npc: NpcId;
  /** Meetings the player arranged with the Asset that are still pending. */
  readonly pendingMeetings: readonly VoidedMeeting[];
  /** Drops the Asset was tasked to load but has not serviced yet. */
  readonly pendingDrops: readonly VoidedDrop[];
}

/**
 * A projection of every Asset's upcoming commitments, keyed by NPC id. An Asset
 * absent from the map (or with empty commitment lists) voids nothing when
 * arrested — a careful arrest with no scheduled contact is observable only
 * through silence and the newspaper, not a no-show or unserviced drop.
 */
export type CommitmentProjection = Readonly<Record<NpcId, AssetCommitments>>;

/**
 * The commitments an arrest voids: the meetings the arrested Asset will no-show
 * and the drops it will leave unserviced, each tagged with the arrested Asset so
 * the Turn Pipeline can attribute them. Pure data for the pipeline to apply to
 * `WorldState.meetings` / the drops' expected-loader records, from where 16.6's
 * player-side expectations are read (Req 39.5).
 */
export interface ArrestConsequences {
  /** Meetings now destined to no-show, from every arrested Asset. */
  readonly voidedMeetings: readonly (VoidedMeeting & { readonly npc: NpcId })[];
  /** Drops now destined to be unserviced, from every arrested Asset. */
  readonly voidedDrops: readonly (VoidedDrop & { readonly npc: NpcId })[];
}

/**
 * The hidden `asset-arrested` event shape: it shares a union-keyed SimEvent
 * member with `asset-detected` / `asset-doubled` (`{ kind: …; npc }`), so a
 * single-literal `Extract` collapses to `never`; we narrow to the `npc`-bearing
 * member explicitly instead.
 */
type ArrestEvent = Extract<SimEvent, { readonly npc: NpcId }> & {
  readonly kind: 'asset-arrested';
};

/** Is this a hidden `asset-arrested` event? */
function isArrest(event: SimEvent): event is ArrestEvent {
  return event.kind === 'asset-arrested';
}

/**
 * Compute the off-screen consequences of the day's arrests (Req 39.5). Pure, no
 * draws. For each `asset-arrested` event in `events`, it looks up the arrested
 * Asset's upcoming commitments in `commitments` and voids them: every pending
 * meeting becomes a destined no-show and every pending drop a destined
 * unserviced drop. Events that are not arrests (`asset-detected`,
 * `asset-doubled`, …) are ignored — a double, in particular, voids nothing, so
 * it stays signal-free (Req 39.4).
 *
 * The arrested Assets are processed in id-sorted order and each Asset's own
 * meetings/drops are kept in the projection's order, so the result is a
 * deterministic function of the inputs regardless of event order. The returned
 * commitments are *not* events — raising the derived `meeting-no-show` /
 * `drop-unserviced` events is 16.6's job, and only when the player actually
 * attends the meeting or services the drop — so this leaf never leaks the hidden
 * arrest (Req 39.4).
 */
export function arrestConsequences(
  events: readonly SimEvent[],
  commitments: CommitmentProjection,
): ArrestConsequences {
  const arrestedNpcs = events
    .filter(isArrest)
    .map((event) => event.npc)
    // Dedupe (an Asset is arrested at most once) and id-sort for determinism.
    .filter((npc, index, all) => all.indexOf(npc) === index)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const voidedMeetings: (VoidedMeeting & { npc: NpcId })[] = [];
  const voidedDrops: (VoidedDrop & { npc: NpcId })[] = [];

  for (const npc of arrestedNpcs) {
    const commitment = commitments[npc];
    if (commitment === undefined) {
      continue;
    }
    for (const meeting of commitment.pendingMeetings) {
      voidedMeetings.push({ npc, meeting: meeting.meeting, slot: meeting.slot });
    }
    for (const drop of commitment.pendingDrops) {
      voidedDrops.push({ npc, drop: drop.drop });
    }
  }

  return { voidedMeetings, voidedDrops };
}

// ---------------------------------------------------------------------------
// The public arrest article (Req 39.4)
// ---------------------------------------------------------------------------

/**
 * The probability a public arrest article is printed for a service of the given
 * doctrine: `1 − deceptionAppetite` (design; doctrine docblock). A service that
 * loves deception (`deceptionAppetite → 1`) almost never lets an arrest reach
 * the papers; a blunt service (`deceptionAppetite → 0`) nearly always does.
 */
export function arrestArticleProbability(doctrine: Doctrine): number {
  return 1 - doctrine.deceptionAppetite;
}

/**
 * The facts the newspaper needs to render an arrest article beyond the arrested
 * Asset: where the arrest took place and an optional Proposition the article
 * asserts (so a reader who files the edition can seed the Case File with the
 * publicly-reported arrest). The Turn Pipeline projects these in; a caller with
 * nothing to assert passes an empty `asserts`.
 */
export interface ArrestArticleContext {
  /** A short, public place phrase ("the Second District", "a Ring café"). */
  readonly place: string;
  /** The Proposition(s) the arrest article asserts, if any (true facts). */
  readonly asserts?: readonly Proposition[];
}

/**
 * Build the {@link NewspaperItem} for an arrest, independent of the gate. Pure,
 * no draws. The id is scoped to the arrested Asset and day so it is stable and
 * distinct within an edition. The headline/summary are fact-layer phrasing the
 * newspaper composer renders through its namer; the asserted Propositions (if
 * any) are the public facts a reader can seed into the Case File.
 */
export function buildArrestArticle(
  npc: NpcId,
  day: number,
  ctx: ArrestArticleContext,
): NewspaperItem {
  return {
    id: `arrest/${npc}/${day}`,
    source: 'city-event',
    headline: 'Arrest reported',
    summary: `The authorities confirmed an arrest in ${ctx.place}; details were not released.`,
    asserts: ctx.asserts ?? [],
  };
}

/**
 * Decide whether a single arrest is printed and, if so, build its article
 * (Req 39.4). Draws exactly one coin on `rng` against
 * {@link arrestArticleProbability} — always one draw, so the stream advances
 * identically whether or not the article is printed — and returns the
 * {@link NewspaperItem} on a hit or `undefined` on a miss.
 *
 * At `deceptionAppetite = 0` the probability is `1` and the article is always
 * printed; at `deceptionAppetite = 1` it is `0` and never printed (the coin
 * still draws, so determinism does not depend on the extremes).
 */
export function arrestArticle(
  npc: NpcId,
  day: number,
  doctrine: Doctrine,
  ctx: ArrestArticleContext,
  rng: Prng,
): NewspaperItem | undefined {
  const printed = rng.bool(arrestArticleProbability(doctrine));
  if (!printed) {
    return undefined;
  }
  return buildArrestArticle(npc, day, ctx);
}

/**
 * The place/assertion context for each arrested Asset's article, keyed by NPC
 * id. An Asset absent from the map falls back to a neutral place and no
 * assertion, so a caller that supplies nothing still gets a renderable article.
 */
export type ArrestArticleProjection = Readonly<Record<NpcId, ArrestArticleContext>>;

/** The neutral article context used for an arrested Asset absent from the projection. */
const DEFAULT_ARTICLE_CONTEXT: ArrestArticleContext = {
  place: 'the city',
  asserts: [],
};

/**
 * Decide the public arrest articles for the day's arrests (Req 39.4). Draws one
 * coin per arrested Asset on `rng`, in id-sorted order (so the stream is
 * independent of event order), each against `1 − deceptionAppetite`, and returns
 * the {@link NewspaperItem}s for the arrests that made the papers — the material
 * the Turn Pipeline folds into the day's newspaper pool (`NewspaperMaterial`),
 * where the composer prints them like any other city-event article.
 *
 * `asset-doubled` and other hidden events are ignored (only arrests can print),
 * so doubling stays signal-free (Req 39.4). An empty / arrest-free day draws
 * nothing and prints nothing.
 */
export function arrestArticles(
  events: readonly SimEvent[],
  day: number,
  doctrine: Doctrine,
  projection: ArrestArticleProjection,
  rng: Prng,
): NewspaperItem[] {
  const arrestedNpcs = events
    .filter(isArrest)
    .map((event) => event.npc)
    .filter((npc, index, all) => all.indexOf(npc) === index)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const articles: NewspaperItem[] = [];
  for (const npc of arrestedNpcs) {
    const ctx = projection[npc] ?? DEFAULT_ARTICLE_CONTEXT;
    const article = arrestArticle(npc, day, doctrine, ctx, rng);
    if (article !== undefined) {
      articles.push(article);
    }
  }
  return articles;
}
