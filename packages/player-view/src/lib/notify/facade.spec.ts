/**
 * Integration tests for the Notifications surface on the {@link PlayerViewEngine}
 * facade (task 16.6; Requirements 39.2, 39.6).
 *
 * These load the real core pack, build a generated {@link WorldState}, and drive
 * the facade's `deliverEvents` seam and `notifications` surface end to end:
 *
 * - delivering a turn's player-visible events writes each one's Fact Line to the
 *   Journal under the event's own day and phase (Req 39.2) and surfaces the
 *   Notifications on the status-bar list (Req 39.6);
 * - a hidden event delivered alongside leaves both the Journal and the
 *   Notification list untouched (Req 39.4/39.5); and
 * - dismissing a Notification removes it from the undismissed status-bar list.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type PublicText,
} from '@tradecraft/content';
import {
  generate,
  ScenarioConfigSchema,
  type GenerateInputs,
  type NpcId,
  type ResolverContext,
  type SimEvent,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { Journal } from '../journal/journal.js';
import { PlayerViewEngine } from '../api/engine-api.js';
import { NotificationStore } from './store.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors api/views.spec.ts / aids/aids.spec.ts)
// ---------------------------------------------------------------------------

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

function loadCore(): {
  content: ContentSet;
  cityData: CityData;
  descriptors: DescriptorData;
  publicTexts: readonly PublicText[];
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) {
    throw new Error('city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) {
    throw new Error('descriptors.yaml failed to load');
  }
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) {
    throw new Error('public texts failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { content, cityData, descriptors, publicTexts } = loadCore();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');
const CTX: ResolverContext = { content };
const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };
const NO_RULES = implicationRules([]);

function scenario() {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: true,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function inputs(): GenerateInputs {
  return { content, preset: STANDARD, scenario: scenario(), cityData, descriptors, publicTexts };
}

function world(seed = 'notify-alpha'): WorldState {
  return generate(seed, inputs());
}

function engine(state: WorldState): {
  api: PlayerViewEngine;
  journal: Journal;
  notifications: NotificationStore;
} {
  const journal = new Journal();
  const notifications = new NotificationStore();
  const api = new PlayerViewEngine({
    state,
    caseFile: new CaseFile(),
    journal,
    notifications,
    cityData,
    ctx: CTX,
    brief: EMPTY_BRIEF,
    rules: NO_RULES,
  });
  return { api, journal, notifications };
}

/** A player-visible Cable event (names only a Document, so it is state-agnostic). */
function cableEvent(day = 1, phase: 0 | 1 | 2 | 3 = 0): SimEvent {
  return {
    id: `e:cable:${day}.${phase}`,
    at: { day, phase },
    visibility: 'player',
    kind: 'cable',
    doc: 'doc:brief',
  } as SimEvent;
}

/** A hidden off-screen arrest, which must never notify. */
function hiddenArrest(): SimEvent {
  return {
    id: 'e:arrest',
    at: { day: 1, phase: 0 },
    visibility: 'hidden',
    kind: 'asset-arrested',
    npc: 'npc:someone' as NpcId,
  } as SimEvent;
}

// ---------------------------------------------------------------------------
// deliverEvents + the notifications surface
// ---------------------------------------------------------------------------

describe('PlayerViewEngine — Notifications', () => {
  it('delivers a player-visible event to the Journal and the status-bar list', () => {
    const { api, journal } = engine(world());
    const delivered = api.deliverEvents([cableEvent(2, 1)]);

    expect(delivered).toHaveLength(1);
    expect(delivered[0].kind).toBe('cable');

    // The Fact Line is in the Journal under the event's own day and phase.
    const entries = journal.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0].at).toEqual({ day: 2, phase: 1 });
    expect(entries[0].factLines[0]).toMatch(/Cable/);

    // The status bar lists the undismissed Notification.
    const list = api.notifications.list();
    expect(list.map((n) => n.kind)).toEqual(['cable']);
  });

  it('ignores a hidden event: no Journal entry, no Notification', () => {
    const { api, journal } = engine(world());
    const delivered = api.deliverEvents([hiddenArrest()]);
    expect(delivered).toEqual([]);
    expect(journal.entryCount).toBe(0);
    expect(api.notifications.list()).toEqual([]);
  });

  it('delivers only the player-visible event when mixed with a hidden one', () => {
    const { api, journal } = engine(world());
    api.deliverEvents([hiddenArrest(), cableEvent(1, 0)]);
    expect(journal.entryCount).toBe(1);
    expect(api.notifications.list()).toHaveLength(1);
  });

  it('dismiss removes a Notification from the status-bar list', () => {
    const { api } = engine(world());
    const [n] = api.deliverEvents([cableEvent(1, 0)]);
    expect(api.notifications.list()).toHaveLength(1);
    api.notifications.dismiss(n.id);
    expect(api.notifications.list()).toEqual([]);
  });

  it('notifies subscribers as events are delivered', () => {
    const { api } = engine(world());
    const seen: string[] = [];
    const off = api.notifications.subscribe((n) => seen.push(n.kind));
    api.deliverEvents([cableEvent(1, 0)]);
    expect(seen).toEqual(['cable']);
    off();
  });
});
