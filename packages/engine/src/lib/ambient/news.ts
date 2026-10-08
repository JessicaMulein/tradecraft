/**
 * Rolling news and posted notices (ambient-world Req 14, 15).
 *
 * Stories open from events, emergent threads and queued developments. A beat
 * is offered only after the beat it follows. Outlet editions are ranked and
 * stored for the slice newspaper step. Notices are Documents the player can
 * read where they are posted, until they expire.
 */

import type { DocumentTemplate } from '@tradecraft/content';

import {
  type DocId,
  type EntityId,
  type GameTime,
  type LocId,
  type NpcId,
  type Proposition,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { docId, type Document } from '../docs/document.js';
import { publicTextLocations } from '../docs/public-text.js';
import {
  composeNewspaper,
  dailyMaterial,
  type NewspaperContext,
  type NewspaperItem,
} from '../docs/newspaper.js';
import type { NamerContext } from '../docs/namer.js';
import { createPrng, type Prng } from '../prng/prng.js';
import { distortProposition } from '../recruit/asset.js';

import { ambientBudgets } from './budgets.js';
import { ambientCatalogue } from './catalogue.js';
import { ambientKeySeed } from './streams.js';
import type {
  AmbientInboxOp,
  AmbientState,
  PreparedEdition,
  StoryBeat,
  StoryState,
} from './state.js';

const STALE_DAYS = 3;
const NOTICE_DAYS = 3;

const RANK = { development: 0, first: 1, filler: 2 } as const;

const SLANT_DISTORTION: Record<string, number> = {
  government: 0.25,
  opposition: 0.25,
  commercial: 0.1,
  church: 0.15,
};

export interface ArticleCandidate extends NewspaperItem {
  readonly rank: keyof typeof RANK;
  readonly story: string;
}

function activeCap(world: WorldState): number {
  const density = world.ambient?.density ?? 'standard';
  return ambientBudgets(density).activeStories;
}

function isEmergent(world: WorldState, id: string): boolean {
  const ambient = world.ambient;
  if (ambient?.threadOrigins?.[id] === 'emergent') {
    return true;
  }
  return (world.sideThreads ?? []).some(
    (thread) => thread.id === id && thread.origin !== undefined,
  );
}

/** Drop a story that has gone three days without a development. */
export function closeStale(
  stories: Readonly<Record<string, StoryState>>,
  day: number,
): Record<string, StoryState> {
  const next: Record<string, StoryState> = {};
  for (const [id, story] of Object.entries(stories)) {
    if (story.status === 'active' && day - story.lastDevelopment >= STALE_DAYS) {
      next[id] = { ...story, status: 'closed' };
    } else {
      next[id] = story;
    }
  }
  return next;
}

function activeStories(stories: Readonly<Record<string, StoryState>>): StoryState[] {
  return Object.values(stories).filter((story) => story.status === 'active');
}

function dropLowest(stories: Record<string, StoryState>): Record<string, StoryState> {
  const active = activeStories(stories).sort(
    (a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1),
  );
  const lowest = active[0];
  if (lowest === undefined) {
    return stories;
  }
  return { ...stories, [lowest.id]: { ...lowest, status: 'closed' } };
}

/**
 * Open a story on its first beat. A thirteenth active story closes the
 * lowest-priority one already open, unless the new story is that lowest.
 */
export function openStory(
  stories: Readonly<Record<string, StoryState>>,
  args: {
    readonly id: string;
    readonly key: string;
    readonly source: string;
    readonly chain: readonly string[];
    readonly day: number;
    readonly cap: number;
  },
): Record<string, StoryState> {
  if (stories[args.id] !== undefined) {
    return { ...stories };
  }
  const beat = args.chain[0];
  if (beat === undefined) {
    return { ...stories };
  }
  let next: Record<string, StoryState> = { ...stories };
  if (activeStories(next).length >= args.cap) {
    const lowest = activeStories(next).sort(
      (a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1),
    )[0];
    if (lowest !== undefined && lowest.priority <= 1) {
      next = dropLowest(next);
    }
    if (activeStories(next).length >= args.cap) {
      return next;
    }
  }
  const opened: StoryState = {
    id: args.id,
    key: args.key,
    source: args.source,
    chain: args.chain,
    beats: [{ beat, day: args.day, props: [] }],
    lastDevelopment: args.day,
    status: 'active',
    priority: 1,
  };
  return { ...next, [args.id]: opened };
}

/**
 * Append the next beat in the cause chain. A beat that skips ahead, or repeats,
 * leaves the story unchanged.
 */
export function addDevelopment(
  stories: Readonly<Record<string, StoryState>>,
  id: string,
  beat: string,
  day: number,
): Record<string, StoryState> {
  const story = stories[id];
  if (story === undefined || story.status !== 'active') {
    return { ...stories };
  }
  const expected = story.chain[story.beats.length];
  if (expected === undefined || beat !== expected) {
    return { ...stories };
  }
  const beats: StoryBeat[] = [...story.beats, { beat, day, props: [] }];
  return {
    ...stories,
    [id]: {
      ...story,
      beats,
      lastDevelopment: day,
      priority: beats.length,
    },
  };
}

/** Follow-up lines name the beat they follow. The first beat stands alone. */
export function printedArticles(story: StoryState): readonly string[] {
  const lines: string[] = [];
  for (let i = 0; i < story.beats.length; i += 1) {
    const beat = story.beats[i];
    if (beat === undefined) {
      continue;
    }
    if (i === 0) {
      lines.push(beat.beat);
      continue;
    }
    const prev = story.beats[i - 1];
    if (prev === undefined) {
      continue;
    }
    lines.push(`After ${prev.beat}, ${beat.beat}.`);
  }
  return lines;
}

function covers(outlet: AmbientState['outlets'][number], story: StoryState): boolean {
  const tags = outlet.covers ?? [];
  if (tags.length === 0) {
    return true;
  }
  return tags.some((tag) => story.key === tag || story.source.includes(tag));
}

function assertFor(story: StoryState, beat: StoryBeat, npc: NpcId | undefined): Proposition {
  const subject = (npc ?? (`loc:${story.key}` as EntityId));
  return {
    id: `prop:story:${story.id}:${beat.beat}`,
    subject,
    predicate: 'HAS_STATUS',
    object: { kind: 'text', value: beat.beat },
  };
}

function distortAssert(
  fact: Proposition,
  rate: number,
  npcs: readonly NpcId[],
  rng: Prng,
  records: Record<string, { readonly holds: boolean; readonly distorted: boolean }>,
): Proposition {
  if (rate <= 0 || !rng.bool(Math.min(1, rate))) {
    records[fact.id] = { holds: true, distorted: false };
    return fact;
  }
  const distorted = distortProposition(fact, { npcs, locs: [], orgs: [] }, rng);
  if (distorted.id === fact.id) {
    records[fact.id] = { holds: true, distorted: false };
    return fact;
  }
  records[fact.id] = { holds: true, distorted: false };
  records[distorted.id] = { holds: false, distorted: true };
  return distorted;
}

/**
 * Rank a day's articles for one outlet: a new development, then a first report,
 * then filler. A beat is included only when every earlier beat is already in
 * the story.
 */
export function editionCandidates(
  stories: Readonly<Record<string, StoryState>>,
  outlet: AmbientState['outlets'][number],
  day: number,
  rng: Prng,
  npcs: readonly NpcId[],
  records: Record<string, { readonly holds: boolean; readonly distorted: boolean }>,
): ArticleCandidate[] {
  const rate = outlet.distortion ?? SLANT_DISTORTION[outlet.slant] ?? 0;
  const npc = npcs[0];
  const items: ArticleCandidate[] = [];
  for (const story of activeStories(stories).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!covers(outlet, story)) {
      continue;
    }
    const lines = printedArticles(story);
    const latest = story.beats[story.beats.length - 1];
    if (latest === undefined || lines.length !== story.beats.length) {
      continue;
    }
    const rank = latest.day === day ? (story.beats.length === 1 ? 'first' : 'development') : 'filler';
    const summary = lines[lines.length - 1] ?? latest.beat;
    const fact = distortAssert(assertFor(story, latest, npc), rate, npcs, rng, records);
    items.push({
      id: `story/${outlet.id}/${story.id}/${latest.beat}`,
      source: 'city-event',
      headline: story.key,
      summary,
      asserts: [fact],
      rank,
      story: story.id,
    });
  }
  items.push({
    id: `story/${outlet.id}/filler/${day}`,
    source: 'city-event',
    headline: 'The city at large',
    summary: 'The markets and the ring trams kept their usual hours.',
    asserts: [],
    rank: 'filler',
    story: '',
  });
  return items.sort(
    (a, b) => RANK[a.rank] - RANK[b.rank] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function chainOf(key: string, beat: string, given?: readonly string[]): readonly string[] {
  if (given !== undefined && given.length > 0) {
    return given;
  }
  const authored = ambientCatalogue().stories.get(key);
  if (authored !== undefined && authored.length > 0) {
    return authored;
  }
  if (key === 'strike') {
    return ['announced', 'resolved'];
  }
  return [beat];
}

function rememberSource(
  stories: Record<string, StoryState>,
  world: WorldState,
  source: string,
  key: string,
  day: number,
): Record<string, StoryState> {
  const id = `story:${source}`;
  return openStory(stories, {
    id,
    key,
    source,
    chain: chainOf(key, 'announced'),
    day,
    cap: activeCap(world),
  });
}

/** Advance stories, close stale ones, and prepare one ranked edition per outlet. */
export function stepNews(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  const day = world.time.day;
  let stories = closeStale(ambient.stories, day);
  for (const id of Object.keys(ambient.events)) {
    stories = rememberSource(stories, world, id, 'city', day);
  }
  for (const thread of world.sideThreads ?? []) {
    if (isEmergent(world, thread.id)) {
      stories = rememberSource(stories, world, thread.id, thread.template, day);
    }
  }
  const inbox = ambient.inbox ?? [];
  const kept: AmbientInboxOp[] = [];
  for (const op of inbox) {
    if (op.op === 'news-development') {
      const id = op.story.startsWith('story:') ? op.story : `story:${op.story}`;
      if (stories[id] === undefined) {
        stories = openStory(stories, {
          id,
          key: op.story,
          source: op.story,
          chain: chainOf(op.story, op.beat, op.chain),
          day,
          cap: activeCap(world),
        });
      }
      stories = addDevelopment(stories, id, op.beat, day);
      continue;
    }
    if (op.op !== 'post-notice') {
      kept.push(op);
    }
  }
  const posted = postQueuedNotices(world, inbox, day);
  const records = { ...(ambient.truthRecords ?? {}) };
  const npcs = Object.keys(posted.npcs ?? world.npcs ?? {}) as NpcId[];
  const seed = world.meta?.seed ?? 'ambient';
  const preparedEditions: PreparedEdition[] = [];
  for (const outlet of ambient.outlets) {
    const rng = createPrng(ambientKeySeed(seed, 'news', outlet.id, day));
    const items = editionCandidates(stories, outlet, day, rng, npcs, records);
    preparedEditions.push({
      outlet: outlet.id,
      items: items.map((item) => ({
        id: item.id,
        source: 'city-event' as const,
        headline: item.headline,
        summary: item.summary,
        asserts: item.asserts,
      })),
    });
  }
  return {
    ...posted,
    ambient: {
      ...(posted.ambient ?? ambient),
      stories,
      inbox: kept,
      preparedEditions,
      truthRecords: records,
    },
  };
}

function postQueuedNotices(world: WorldState, inbox: readonly AmbientInboxOp[], day: number): WorldState {
  let next = world;
  for (const op of inbox) {
    if (op.op !== 'post-notice') {
      continue;
    }
    const locs = op.target
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.startsWith('loc:')) as LocId[];
    next = postNotice(next, {
      template: op.template,
      title: op.title ?? op.template,
      body: op.body ?? op.template,
      locs,
      day,
      days: op.days ?? NOTICE_DAYS,
    });
  }
  return next;
}

/** Create a notice Document obtainable at the named locations until it expires. */
export function postNotice(
  world: WorldState,
  args: {
    readonly template: string;
    readonly title: string;
    readonly body: string;
    readonly locs: readonly LocId[];
    readonly day: number;
    readonly days?: number;
  },
): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  const id = docId('notice', `${args.template}/${args.day}/${args.locs.join('-')}`);
  const subject = (args.locs[0] ?? 'loc:street') as EntityId;
  const fact: Proposition = {
    id: `prop:notice:${id}`,
    subject,
    predicate: 'HAS_STATUS',
    object: { kind: 'text', value: args.title },
  };
  const document: Document = {
    id,
    kind: 'notice',
    title: args.title,
    date: world.time,
    body: args.body,
    asserts: [fact.id],
    obtainableAt: args.locs,
  };
  const untilDay = args.day + (args.days ?? NOTICE_DAYS);
  return {
    ...world,
    documents: { ...(world.documents ?? {}), [id]: document },
    documentPropositions: { ...(world.documentPropositions ?? {}), [fact.id]: fact },
    ambient: {
      ...ambient,
      notices: [...(ambient.notices ?? []), { doc: id, untilDay }],
    },
  };
}

/** Fact lines for unread notices still posted at this location. */
export function noticeLines(world: WorldState, loc: LocId): readonly string[] {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return [];
  }
  const read = new Set(world.player?.readDocuments ?? []);
  const day = world.time?.day ?? 0;
  const lines: string[] = [];
  for (const notice of ambient.notices ?? []) {
    if (day >= notice.untilDay || read.has(notice.doc as DocId)) {
      continue;
    }
    const doc = world.documents?.[notice.doc as DocId];
    if (doc === undefined || !(doc.obtainableAt ?? []).includes(loc)) {
      continue;
    }
    lines.push(`A notice is posted here: ${doc.title}.`);
  }
  return lines;
}

/** A notice that has come down cannot be read. */
export function noticeStillPosted(world: WorldState, doc: DocId): boolean {
  const notice = world.ambient?.notices?.find((item) => item.doc === doc);
  if (notice === undefined) {
    return true;
  }
  return (world.time?.day ?? 0) < notice.untilDay;
}

/**
 * Publish each outlet's prepared edition as its own newspaper Document,
 * sold at the same kiosks as the city edition. A paper with no
 * `obtainableAt` would sit in the player's hand and cost a phase to read
 * wherever they stood.
 * The slice edition in `newspapers[day]` is left as the hook wrote it.
 * An outlet with no story articles is already covered by that slice edition.
 */
export function publishOutletEditions(
  world: WorldState,
  template: DocumentTemplate,
  namer: NamerContext,
  date: GameTime,
  rng: Prng,
): WorldState {
  const prepared = world.ambient?.preparedEditions ?? [];
  if (prepared.length === 0) {
    return world;
  }
  let documents = { ...world.documents };
  let documentPropositions = { ...world.documentPropositions };
  for (const edition of prepared) {
    const stories = edition.items.filter((item) => !item.id.includes('/filler/'));
    if (stories.length === 0) {
      continue;
    }
    const material = dailyMaterial(date.day, undefined, [], [], []);
    const composed = composeNewspaper(
      template,
      { ...material, cityEvents: [...stories, ...material.cityEvents] },
      { ...namer, date } satisfies NewspaperContext,
      rng,
    );
    const id = docId('newspaper', `outlet/${edition.outlet}/${date.day}`);
    const stands = publicTextLocations(world.city);
    const title =
      world.ambient?.outlets?.find((outlet) => outlet.id === edition.outlet)?.name ??
      edition.outlet;
    const document: Document =
      stands.length > 0
        ? { ...composed.document, id, title, obtainableAt: stands }
        : { ...composed.document, id, title };
    documents = { ...documents, [id]: document };
    for (const prop of composed.propositions) {
      documentPropositions = { ...documentPropositions, [prop.id]: prop };
    }
  }
  return { ...world, documents, documentPropositions };
}

/** Yesterday's papers come off the rack. A kiosk sells today's edition, not the back catalogue. */
export function retirePreviousEditions(world: WorldState, day: number): WorldState {
  let changed = false;
  const documents = { ...world.documents };
  for (const doc of Object.values(world.documents)) {
    if (doc.kind !== 'newspaper' || doc.date.day >= day) continue;
    if (doc.obtainableAt === undefined || doc.obtainableAt.length === 0) continue;
    documents[doc.id] = { ...doc, obtainableAt: [] };
    changed = true;
  }
  return changed ? { ...world, documents } : world;
}
