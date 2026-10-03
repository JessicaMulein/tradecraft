/**
 * Focused unit tests for the Player-View {@link Session} (task 7.1; design,
 * "Player View: Session"; Requirements 12.3, 13.4, 13.5).
 *
 * These build a Session over a real generated `{ world, truth }` pair from the
 * core pack — the same fixture pattern as `turn-pipeline.spec.ts` and
 * `views.spec.ts` — and pin the two things task 7.1 owns:
 *
 *  - the accessors return the exact pieces the Session was built with (the
 *    consolidation the facade and the Turn Pipeline both read through); and
 *  - `commit(next)` swaps the committed state and advances the per-commit view
 *    state (the turn counter) without mutating the pre-commit state object
 *    (World State is immutable; a commit is a reference swap, design step 8).
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
  ScenarioConfigSchema,
  generateGame,
  type GenerateInputs,
  type ResolverContext,
  type TruthStore,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { HintStore } from '../aids/hints.js';
import { Journal } from '../journal/journal.js';
import { NotificationStore } from '../notify/store.js';
import { Session } from './session.js';
import { ActionLog, ExtractionQueue } from './turn-pipeline.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors views.spec.ts / turn-pipeline.spec.ts)
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
  if (!content.ok) throw new Error('core pack failed to load');
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) throw new Error('public texts failed to load');
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
    if (key === id || key.endsWith(`/${id}`)) return value;
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');

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

/** A real generated world and its seeded Truth Store (as the debrief spec does). */
function game(seed = 'alpha'): { world: WorldState; truth: TruthStore } {
  const { world, truth } = generateGame(seed, inputs());
  return { world, truth };
}

const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };
const NO_RULES = implicationRules([]);

/**
 * Build a Session over a fresh generated world, returning the Session and every
 * piece it was built with so the accessor tests can assert identity.
 */
function makeSession(seed = 'alpha') {
  const { world, truth } = game(seed);
  const caseFile = new CaseFile();
  const journal = new Journal();
  const notifications = new NotificationStore();
  const hints = new HintStore(content, false);
  const actionLog = new ActionLog();
  const extractionQueue = new ExtractionQueue();
  const ctx: ResolverContext = { content };
  const session = new Session({
    state: world,
    truth,
    caseFile,
    journal,
    notifications,
    hints,
    actionLog,
    extractionQueue,
    flavourCache: {},
    turnCounter: 0,
    brief: EMPTY_BRIEF,
    outcomeWritten: false,
    ctx,
    cityData,
    rules: NO_RULES,
  });
  return {
    session,
    world,
    truth,
    caseFile,
    journal,
    notifications,
    hints,
    actionLog,
    extractionQueue,
    ctx,
  };
}

// ---------------------------------------------------------------------------
// Accessors: the Session returns the pieces it was built with
// ---------------------------------------------------------------------------

describe('Session — accessors', () => {
  it('exposes every store and the fixed resolver dependencies by identity', () => {
    const f = makeSession();

    expect(f.session.state).toBe(f.world);
    expect(f.session.truth).toBe(f.truth);
    expect(f.session.caseFile).toBe(f.caseFile);
    expect(f.session.journal).toBe(f.journal);
    expect(f.session.notifications).toBe(f.notifications);
    expect(f.session.hints).toBe(f.hints);
    expect(f.session.actionLog).toBe(f.actionLog);
    expect(f.session.extractionQueue).toBe(f.extractionQueue);
    expect(f.session.ctx).toBe(f.ctx);
    expect(f.session.cityData).toBe(cityData);
    expect(f.session.brief).toBe(EMPTY_BRIEF);
  });

  it('starts with the view state the design names (counter 0, no outcome, not paused)', () => {
    const f = makeSession();
    expect(f.session.turnCounter).toBe(0);
    expect(f.session.outcomeWritten).toBe(false);
    expect(f.session.paused).toBeUndefined();
    expect(f.session.flavourCache).toEqual({});
    // Recorded feeds default to empty when none are supplied.
    expect(f.session.feeds).toEqual([]);
  });

  it('holds the Truth Store but exposes no view-safe projection of it (Property 3)', () => {
    const f = makeSession();
    // The Truth Store is reachable as a deliberate field (the pipeline and the
    // debrief need it), but the Session has no `views`/projection surface that
    // reads a Truth value — the only methods are `commit` and the field reads.
    const methodNames = Object.getOwnPropertyNames(
      Object.getPrototypeOf(f.session),
    ).filter((n) => n !== 'constructor');
    expect(methodNames).toEqual(['commit']);
  });
});

// ---------------------------------------------------------------------------
// commit: swaps state, advances the turn counter, leaves the old state intact
// ---------------------------------------------------------------------------

describe('Session — commit', () => {
  it('swaps the committed state and advances the turn counter', () => {
    const f = makeSession();
    const before = f.session.state;
    const next: WorldState = { ...before };

    f.session.commit(next);

    expect(f.session.state).toBe(next);
    expect(f.session.state).not.toBe(before);
    expect(f.session.turnCounter).toBe(1);

    // A second commit advances again and swaps again.
    const next2: WorldState = { ...next };
    f.session.commit(next2);
    expect(f.session.state).toBe(next2);
    expect(f.session.turnCounter).toBe(2);
  });

  it('does not mutate the pre-commit state object', () => {
    const f = makeSession();
    const before = f.session.state;
    const snapshot = structuredClone(before);

    f.session.commit({ ...before, time: { ...before.time, day: before.time.day + 1 } });

    // The old state value is byte-for-byte what it was; the commit swapped the
    // reference rather than mutating in place (World State is immutable).
    expect(before).toEqual(snapshot);
  });
});
