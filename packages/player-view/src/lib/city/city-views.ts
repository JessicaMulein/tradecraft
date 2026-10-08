/**
 * City, Stories and Duties projections (ambient-world Req 8.6, 14.7, 17, 20.4).
 *
 * These read only what the player has learned. A City event appears after a
 * Document, Notice, Observation, Notification or Claim names it. The Map status
 * is {@link knownLocationStatus}, never the live overlay. Regard, recollections,
 * informants, the hook ledger and emergent-thread origins are not projected.
 */

import { revealTruth, type WorldState } from '@tradecraft/engine';

import type { CaseFile } from '../casefile/casefile.js';
import type { Notification } from '../notify/notification.js';

const EVENT_ID = /evt:[a-z0-9]+(?:-[a-z0-9]+)*/g;

export interface CityEventView {
  readonly id: string;
  readonly name: string;
}

export interface CityView {
  readonly events: readonly CityEventView[];
}

export interface StoryArticleView {
  readonly doc: string;
  readonly title: string;
}

export interface StoryGroupView {
  readonly id: string;
  readonly title: string;
  readonly status: 'active' | 'closed';
  readonly articles: readonly StoryArticleView[];
}

export interface StoriesView {
  readonly stories: readonly StoryGroupView[];
}

export interface DutyView {
  readonly id: string;
  readonly template: string;
  readonly loc: string;
  readonly day: number;
  readonly phase: number;
  readonly status: 'pending' | 'attended' | 'missed';
  readonly mandatory: boolean;
}

export interface DutiesView {
  readonly standing: number;
  readonly band: 'low' | 'fair' | 'good';
  readonly duties: readonly DutyView[];
}

function harvest(text: string, into: Set<string>): void {
  for (const match of text.matchAll(EVENT_ID)) {
    const id = match[0];
    if (id !== undefined) {
      into.add(id);
    }
  }
}

function eventName(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'name' in value && typeof value.name === 'string') {
    return value.name;
  }
  return '';
}

/** Status the player has learned for a Location, or absent when they have not. */
export function knownLocationStatus(state: WorldState, loc: string): string | undefined {
  return state.ambient?.lastKnownStatus?.[loc];
}

/** Event ids named by the player's known set, read Documents, Claims or Notifications. */
export function knownEventIds(
  state: WorldState,
  caseFile: CaseFile,
  notifications: readonly Notification[] = [],
): string[] {
  const found = new Set<string>();
  for (const id of state.player.known.entities) {
    if (id.startsWith('evt:')) {
      found.add(id);
    }
  }
  for (const claim of caseFile.list()) {
    harvest(claim.prop.id, found);
    harvest(String(claim.prop.subject), found);
    const object = claim.prop.object;
    if (typeof object === 'string') {
      harvest(object, found);
    } else if (object !== null && typeof object === 'object' && 'value' in object) {
      harvest(String(object.value), found);
    }
    if (claim.prop.place !== undefined) {
      harvest(claim.prop.place, found);
    }
  }
  const read = new Set(state.player.readDocuments);
  for (const doc of Object.values(state.documents)) {
    if (!read.has(doc.id)) {
      continue;
    }
    harvest(`${doc.title}\n${doc.body}`, found);
    for (const propId of doc.asserts) {
      harvest(propId, found);
      const prop = state.documentPropositions[propId];
      if (prop === undefined) {
        continue;
      }
      harvest(String(prop.subject), found);
      if (typeof prop.object === 'string') {
        harvest(prop.object, found);
      }
    }
  }
  const events = state.ambient?.events ?? {};
  for (const note of notifications) {
    harvest(note.factLine, found);
    if (note.kind === 'public-announcement') {
      for (const [id, value] of Object.entries(events)) {
        const name = eventName(value);
        if (name.length > 0 && note.text === name) {
          found.add(id);
        }
      }
    }
  }
  return [...found].sort();
}

/** City events the player has learned of. Unlearned events are omitted. */
export function cityView(
  state: WorldState,
  caseFile: CaseFile,
  notifications: readonly Notification[] = [],
): CityView {
  const events = state.ambient?.events;
  if (events === undefined) {
    return { events: [] };
  }
  const listed: CityEventView[] = [];
  for (const id of knownEventIds(state, caseFile, notifications)) {
    const name = eventName(events[id as keyof typeof events]);
    if (name.length === 0) {
      continue;
    }
    listed.push({ id, name });
  }
  return { events: listed };
}

/** Articles the player has read, grouped by the Story they belong to. */
export function storiesView(state: WorldState): StoriesView {
  const stories = state.ambient?.stories;
  if (stories === undefined) {
    return { stories: [] };
  }
  const read = new Set(state.player.readDocuments);
  const groups: StoryGroupView[] = [];
  for (const story of Object.values(stories).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const articles = Object.values(state.documents)
      .filter((doc) => read.has(doc.id))
      .filter((doc) => {
        const text = `${doc.title}\n${doc.body}`;
        return story.beats.some((beat) => text.includes(beat.beat)) || text.includes(story.key);
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((doc) => ({ doc: doc.id, title: doc.title }));
    if (articles.length === 0) {
      continue;
    }
    groups.push({ id: story.id, title: story.key, status: story.status, articles });
  }
  return { stories: groups };
}

export function standingBand(standing: number): 'low' | 'fair' | 'good' {
  if (standing < 0.3) {
    return 'low';
  }
  if (standing < 0.7) {
    return 'fair';
  }
  return 'good';
}

/** Pending and past cover duties, with standing as a band. */
export function dutiesView(state: WorldState): DutiesView {
  const ambient = state.ambient;
  if (ambient === undefined) {
    return { standing: 0, band: 'fair', duties: [] };
  }
  const standing = revealTruth(ambient.coverStanding);
  return {
    standing,
    band: standingBand(standing),
    duties: [...ambient.duties]
      .sort((a, b) => a.slot.day - b.slot.day || a.slot.phase - b.slot.phase || (a.id < b.id ? -1 : 1))
      .map((duty) => ({
        id: duty.id,
        template: duty.template,
        loc: duty.loc,
        day: duty.slot.day,
        phase: duty.slot.phase,
        status: duty.status,
        mandatory: duty.mandatory,
      })),
  };
}
