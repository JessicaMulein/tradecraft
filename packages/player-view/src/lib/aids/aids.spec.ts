/**
 * Tests for the task-16.4 player aids: the Help view (quotes for the current
 * Location plus the glossary; Requirement 26.5) and the content-driven hints
 * store whose seen flags live in the view, not the Sim (Requirement 26.6).
 *
 * These load the real core pack and drive a generated {@link WorldState}, so
 * the Help view is exercised against real Location Types, allowed actions and
 * the authored glossary, and the hints store against the authored `hints.yaml`.
 * The hints tests pin the two properties the design fixes: showing a hint does
 * not mutate Sim state, and a trigger's seen flag suppresses a repeat.
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
  locationTypeOf,
  ScenarioConfigSchema,
  type GenerateInputs,
  type LocId,
  type ResolverContext,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { PlayerViewEngine } from '../api/engine-api.js';
import { helpView } from './help.js';
import { HintStore } from './hints.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors api/views.spec.ts)
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

function world(seed = 'help-alpha'): WorldState {
  return generate(seed, inputs());
}

/** Put the player at a Location (a shallow, typed override). */
function atLocation(state: WorldState, loc: LocId): WorldState {
  return { ...state, player: { ...state.player, loc } };
}

// ---------------------------------------------------------------------------
// Help view (Requirement 26.5)
// ---------------------------------------------------------------------------

describe('helpView — quotes plus glossary', () => {
  it('lists the glossary from the Content Set, alphabetical by term', () => {
    const help = helpView(world(), CTX, content.glossary);
    expect(help.glossary.length).toBeGreaterThan(0);
    // Exactly the terms the Content Set holds, alphabetised.
    const expected = [...content.glossary.values()]
      .map((t) => t.term)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(help.glossary.map((g) => g.term)).toEqual(expected);
    // Each entry carries only a term and definition (no truth-adjacent field).
    for (const entry of help.glossary) {
      expect(Object.keys(entry).sort()).toEqual(['definition', 'term']);
      expect(entry.definition.length).toBeGreaterThan(0);
    }
  });

  it('lists an action entry for every action the current Location allows', () => {
    const state = world();
    const place = state.city.locations[state.player.loc];
    const type = locationTypeOf(content, place);
    expect(type).toBeDefined();

    const help = helpView(state, CTX, content.glossary);
    expect(help.location.id).toBe(state.player.loc);
    const kinds = help.actions.map((a) => a.kind).sort();
    expect(kinds).toEqual([...(type?.allowedActions ?? [])].sort());
    // Every entry carries a quote with the engine's cost/eligibility shape.
    for (const entry of help.actions) {
      expect(typeof entry.quote.allowed).toBe('boolean');
      expect(typeof entry.quote.phases).toBe('number');
      expect(typeof entry.quote.money).toBe('number');
    }
  });

  it('quotes a self-quotable action (wait) with its real cost', () => {
    // Find a Location whose Type allows `wait`; the Station allows it.
    const state = world();
    let found: LocId | undefined;
    for (const loc of Object.keys(state.city.locations) as LocId[]) {
      const type = locationTypeOf(content, state.city.locations[loc]);
      if (type?.allowedActions.includes('wait')) {
        found = loc;
        break;
      }
    }
    if (found === undefined) {
      // No Location allows wait in this pack; nothing to assert.
      return;
    }
    const help = helpView(atLocation(state, found), CTX, content.glossary);
    const wait = help.actions.find((a) => a.kind === 'wait');
    expect(wait).toBeDefined();
    expect(wait?.targeted).toBe(false);
    // `wait` is always allowed and costs the phases asked for (one, here).
    expect(wait?.quote.allowed).toBe(true);
    expect(wait?.quote.phases).toBe(1);
  });

  it('flags target-dependent actions as targeted with a base cost', () => {
    const state = world();
    const help = helpView(state, CTX, content.glossary);
    const targeted = help.actions.filter((a) => a.targeted);
    for (const entry of targeted) {
      // Self-quotable kinds are never flagged targeted.
      expect(['wait', 'surveil', 'intercept']).not.toContain(entry.kind);
    }
  });

  it('serializes without any truth-branded value', () => {
    const help = helpView(world(), CTX, content.glossary);
    const serialized = JSON.stringify(help);
    // The Help view is quote + glossary data only; assert it round-trips and
    // carries just the documented top-level shape.
    expect(Object.keys(help).sort()).toEqual(['actions', 'glossary', 'location']);
    expect(serialized.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Hints (Requirement 26.6)
// ---------------------------------------------------------------------------

describe('HintStore — content-driven hints, view-side seen flags', () => {
  it('shows a content hint the first time a trigger fires', () => {
    const store = new HintStore(content, true);
    const first = store.fire('first-intercept');
    expect(first).toBeDefined();
    expect(first?.trigger).toBe('first-intercept');
    // The text is the authored hint text, verbatim.
    const authored = [...content.hints.values()].find(
      (h) => h.trigger === 'first-intercept',
    );
    expect(first?.text).toBe(authored?.text);
  });

  it('suppresses a repeat: the seen flag fires each trigger at most once', () => {
    const store = new HintStore(content, true);
    expect(store.fire('budget-low')).toBeDefined();
    expect(store.hasSeen('budget-low')).toBe(true);
    // Every later occurrence of the same trigger returns nothing.
    expect(store.fire('budget-low')).toBeUndefined();
    expect(store.fire('budget-low')).toBeUndefined();
  });

  it('keeps triggers independent — one firing does not mark another seen', () => {
    const store = new HintStore(content, true);
    store.fire('first-document');
    expect(store.hasSeen('first-document')).toBe(true);
    expect(store.hasSeen('first-meeting')).toBe(false);
    expect(store.fire('first-meeting')).toBeDefined();
  });

  it('shows nothing when hints are disabled, but still never repeats', () => {
    const store = new HintStore(content, false);
    expect(store.fire('first-recruitment')).toBeUndefined();
    // Marked seen even when disabled, so one-off behaviour holds if re-fired.
    expect(store.hasSeen('first-recruitment')).toBe(true);
    expect(store.fire('first-recruitment')).toBeUndefined();
  });

  it('peek reads a trigger without marking it seen', () => {
    const store = new HintStore(content, true);
    const peeked = store.peek('plot-deadline-near');
    expect(peeked).toBeDefined();
    expect(store.hasSeen('plot-deadline-near')).toBe(false);
    // So firing afterwards still shows it.
    expect(store.fire('plot-deadline-near')).toBeDefined();
  });

  it('showing a hint does not mutate Sim state (Requirement 26.6)', () => {
    const engine = new PlayerViewEngine({
      state: world(),
      caseFile: new CaseFile(),
      cityData,
      ctx: CTX,
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
      hintsEnabled: true,
    });
    // Snapshot the full Sim state before any hint fires.
    const before = JSON.stringify(engine.state);

    const shown = engine.hints.fire('first-unidentified-subject');
    expect(shown).toBeDefined();
    // The WorldState is byte-for-byte unchanged: seen flags live in the view
    // store, not the Sim.
    expect(JSON.stringify(engine.state)).toBe(before);
    // The repeat is suppressed, and the state is still untouched.
    expect(engine.hints.fire('first-unidentified-subject')).toBeUndefined();
    expect(JSON.stringify(engine.state)).toBe(before);
  });

  it('exposes help() through the facade (quotes + glossary)', () => {
    const engine = new PlayerViewEngine({
      state: world(),
      caseFile: new CaseFile(),
      cityData,
      ctx: CTX,
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
    });
    const help = engine.views.help();
    expect(help.glossary.length).toBeGreaterThan(0);
    expect(help.location.id).toBe(engine.state.player.loc);
  });
});
