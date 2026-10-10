/**
 * Smoke tests for the Day-Boundary Hooks (slice-integration task 4.6;
 * Requirements 2.2–2.5, 3.1, 3.8, 4.1, 4.5, 5.1). They run each reducer from
 * {@link buildWorldHooks} once over a world generated from the real core pack
 * and check its headline effect, plus purity and determinism. Task 4.7 adds one
 * non-vacuous example per hook effect, each firing the effect end to end:
 *
 * - a Walk-in Contact Channel — the `schedules` hook driven with a daily stream
 *   seed (`daily-5`) that actually lands a Walk-in, asserting the Walk-in NPC
 *   becomes a contact with `relationships[npc].channel === true` (Req 2.4);
 * - a minted Intercept — the `plot` hook executing a `transmission` trace past
 *   the seeded horizon (a stage forced due with its seeded Transmission
 *   removed), asserting a fresh Transmission carrying its Intercept is appended
 *   while the player's collected `intercepts` set stays empty (Req 2.3);
 * - a published newspaper with a plant — the `newspaper` hook folding a plant
 *   that carries a real Proposition, asserting the published edition Document
 *   asserts it (Req 2.5, 3.8);
 * - a seizure-triggered abort — the `plot` (and `hostileTick`) hook on a running
 *   Plot with `materielSeized`, asserting the Plot ends `aborted` with cause
 *   `materiel-seized`, `plot-aborted` is emitted, and `WorldState.ended` is the
 *   success End Condition (Req 4.5).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generateGame, type GenerateInputs } from '../generate.js';
import { revealTruth, type Proposition } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import { plotTransmissionId } from '../cipher/world-intercepts.js';
import { createPrng } from '../prng/prng.js';
import { worldCipherKeyLookup } from '../cipher/world-intercepts.js';
import type { TruthStore } from '../truth/truth.js';
import { newDayScratch, type AdvanceWorldDeps, type WorldHookContext } from './world-types.js';
import { buildWorldHooks, worldAbortCheck } from './world-hooks.js';
import { visibleNpcsAt } from '../action/action.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors phase-step.spec.ts)
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

function loadCore(): GenerateInputs {
  const content = loadContent([CORE_DIR], ['core']);
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!content.ok || !cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('the core pack failed to load');
  }
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return {
    content: content.value,
    preset: presetOf(content.value, 'standard'),
    scenario,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

function presetOf(content: ContentSet, id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const INPUTS = loadCore();
const SEED = 'world-hooks-alpha';
const GAME = generateGame(SEED, INPUTS);
const BASE: WorldState = GAME.world;
const TRUTH: TruthStore = GAME.truth;

const HOOKS = buildWorldHooks();

/** The dependencies every hook reads: real content, cipher keys and Truth Store. */
const DEPS: AdvanceWorldDeps = {
  content: INPUTS.content,
  cityData: INPUTS.cityData,
  hooks: HOOKS,
  objectives: () => () => false,
  cipherKeys: worldCipherKeyLookup(SEED, BASE.documents),
  truth: TRUTH,
};

/** A hook context for the Day Boundary of `day` on a fresh scratch. */
function ctx(day: number, deps: AdvanceWorldDeps = DEPS): WorldHookContext {
  return {
    time: { day, phase: 0 },
    dailyStreamSeed: `daily-${day}`,
    rng: createPrng(`runtime-${day}`),
    scratch: newDayScratch(),
    deps,
  };
}

/** A hook context for `day` with an explicit daily stream seed (for the Walk-in roll). */
function ctxWithDailySeed(
  day: number,
  dailyStreamSeed: string,
  deps: AdvanceWorldDeps = DEPS,
): WorldHookContext {
  return {
    time: { day, phase: 0 },
    dailyStreamSeed,
    rng: createPrng(`runtime-${day}`),
    scratch: newDayScratch(),
    deps,
  };
}

/** The world moved to the Day Boundary of `day`. */
function atDay(state: WorldState, day: number): WorldState {
  return { ...state, time: { day, phase: 0 } };
}

/** The kinds of a list of events, in order. */
function kinds(events: readonly SimEvent[]): string[] {
  return events.map((e) => e.kind);
}

// ---------------------------------------------------------------------------
// buildWorldHooks
// ---------------------------------------------------------------------------

describe('buildWorldHooks', () => {
  it('returns the four reducers keyed for the hook order', () => {
    expect(Object.keys(HOOKS).sort()).toEqual([
      'hostileTick',
      'newspaper',
      'plot',
      'schedules',
    ]);
  });
});

// ---------------------------------------------------------------------------
// plot hook (Req 2.3, 4.1, 5.1)
// ---------------------------------------------------------------------------

describe('plot hook', () => {
  it('writes the advanced Plot and never shrinks the transmission list', () => {
    // Run the Plot forward to the last stage's deadline so a stage executes.
    const lastDeadline = Math.max(
      ...BASE.plot.stages.map((s) => s.deadline.day),
    );
    const world = atDay(BASE, lastDeadline);

    const { state, events } = HOOKS.plot(world, ctx(lastDeadline));

    // The Plot is a value of its own (never the input), and the transmission
    // list only ever grows (minted traffic is appended, never dropped).
    expect(state.plot).toBeDefined();
    expect(state.transmissions.length).toBeGreaterThanOrEqual(
      world.transmissions.length,
    );
    // The hook returns an array of events (trace events land at their stage's
    // own deadline, so they are not pinned to the Day Boundary time).
    expect(Array.isArray(events)).toBe(true);
  });

  it('mints a fresh Transmission and Intercept for a transmission trace past the seeded horizon (Req 2.3)', () => {
    // World assembly seeds the opening traffic, so the hook only mints a trace
    // the Draft does not already carry. Find a stage whose transmission trace
    // was seeded, force that stage due (its prerequisite stages marked
    // executed, the clock at the stage's deadline) and remove exactly that
    // seeded Transmission. The hook then re-mints it. Which plot the seed drew
    // is not fixed: office schedules and the station draw shift the world.
    const dueStage = BASE.plot.stages.find((stage) => {
      const index = stage.traces.findIndex((trace) => trace.kind === 'transmission');
      if (index < 0) {
        return false;
      }
      const id = plotTransmissionId(stage.id, index);
      return BASE.transmissions.some((tx) => tx.id === id);
    });
    expect(dueStage).toBeDefined();
    if (dueStage === undefined) {
      return;
    }
    const traceIndex = dueStage.traces.findIndex((trace) => trace.kind === 'transmission');
    const txId = plotTransmissionId(dueStage.id, traceIndex);
    const produced = new Set(dueStage.requires);
    const prereqs = new Set(
      BASE.plot.stages
        .filter((stage) => stage.produces.some((prop) => produced.has(prop)))
        .map((stage) => stage.id),
    );

    // Sanity: generation seeded this stage's Transmission, so the mint below is
    // not vacuous — it is re-adding one we deliberately removed.
    expect(BASE.transmissions.some((tx) => tx.id === txId)).toBe(true);

    const dueDay = dueStage.deadline.day;

    const stages = BASE.plot.stages.map((s) => {
      if (s.id === dueStage.id) {
        return s;
      }
      if (prereqs.has(s.id)) {
        return { ...s, status: 'executed' as const };
      }
      return { ...s, deadline: { day: dueDay + 1, phase: 0 as const } };
    });
    const draft: WorldState = {
      ...BASE,
      time: { day: dueDay, phase: 0 },
      plot: { ...BASE.plot, stages },
      transmissions: BASE.transmissions.filter((tx) => tx.id !== txId),
      // The player's collected set — must stay untouched by minting.
      intercepts: {},
    };

    const beforeCount = draft.transmissions.length;
    const { state, events } = HOOKS.plot(draft, ctx(dueDay));

    // The stage executed and emitted its transmission event.
    expect(kinds(events)).toContain('transmission');

    // A new Transmission carrying its Intercept was appended for the fresh trace.
    const minted = state.transmissions.find((tx) => tx.id === txId);
    expect(minted).toBeDefined();
    expect(minted?.intercept).toBeDefined();
    expect(minted?.intercept.id).toBeDefined();
    // Besides the stage's own trace, the Cell's routine traffic for the day may
    // add messages on its other Channels (`cell-tx:` ids); nothing else is new.
    const fresh = state.transmissions.slice(beforeCount);
    expect(fresh.some((tx) => tx.id === txId)).toBe(true);
    for (const tx of fresh) {
      expect(tx.id === txId || tx.id.startsWith('cell-tx:')).toBe(true);
    }

    // `intercepts` (what the player has collected) is unchanged by minting:
    // the Intercept rides inside its Transmission; the intercept action collects
    // it later.
    expect(state.intercepts).toEqual({});
  });

  it('puts routine Cell traffic on the air while the Plot runs, signed by its sender', () => {
    // Over the operation's first days the Cell's own interceptable Channels
    // carry messages naming their sender's Cell membership.
    let draft: WorldState = { ...BASE, intercepts: {} };
    const before = new Set(BASE.transmissions.map((tx) => tx.id));
    for (let day = 1; day <= 6; day += 1) {
      draft = HOOKS.plot(atDay(draft, day), ctx(day)).state;
    }
    const routine = draft.transmissions.filter(
      (tx) => tx.id.startsWith('cell-tx:') && !before.has(tx.id),
    );
    expect(routine.length).toBeGreaterThan(0);
    for (const tx of routine) {
      const props = revealTruth(tx.intercept.plaintextProps);
      expect(props.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic for the same inputs', () => {
    const day = BASE.plot.stages[0]?.deadline.day ?? 1;
    const a = HOOKS.plot(atDay(BASE, day), ctx(day));
    const b = HOOKS.plot(atDay(BASE, day), ctx(day));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('does not mutate the Draft it is handed', () => {
    const day = BASE.plot.stages[0]?.deadline.day ?? 1;
    const world = atDay(BASE, day);
    const before = JSON.stringify(world);
    HOOKS.plot(world, ctx(day));
    expect(JSON.stringify(world)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// schedules hook (Req 2.4, 5.1)
// ---------------------------------------------------------------------------

describe('schedules hook', () => {
  it('stores the day events in the scratch and writes whereabouts for boundary moves', () => {
    const c = ctx(1);
    const { state, events } = HOOKS.schedules(atDay(BASE, 1), c);

    // The day's events are handed to the Hostile tick through the scratch.
    expect(c.scratch.dayEvents).toEqual(events);
    // Every boundary npc-moved lands at the recorded whereabouts.
    for (const e of events) {
      if (e.kind === 'npc-moved') {
        expect(state.whereabouts[e.npc]).toBe(e.to);
      }
    }
  });

  it('gives a rolled-in Walk-in a Contact Channel with the Station (Req 2.4)', () => {
    // Drive the hook with a daily stream seed that actually lands a Walk-in, so
    // this exercises the Contact-Channel effect end to end rather than holding
    // it vacuously. The daily seed `daily-5` lands a Walk-in for this world's
    // roster at probability 0.1 — found by sweeping `createPrng('daily-<day>')`
    // through `rollWalkIn` over the generated NPCs (days 5, 13, 16, 28 … land
    // one); day 5 is the first.
    const day = 5;
    const context = ctxWithDailySeed(day, `daily-${day}`);
    const { state, events } = HOOKS.schedules(atDay(BASE, day), context);

    // The roll fired: a player-visible `walk-in` event names the NPC.
    const walkIn = events.find((e) => e.kind === 'walk-in');
    expect(walkIn?.kind).toBe('walk-in');
    if (walkIn?.kind !== 'walk-in') {
      throw new Error('expected the daily-5 roll to land a Walk-in');
    }
    const npc = walkIn.npc;

    // The Walk-in NPC gains a Contact Channel with the Station: they are a
    // contact AND their Relationship carries `channel = true` (created if the
    // world had no Relationship for them yet).
    expect(state.player.contacts).toContain(npc);
    expect(state.relationships[npc]).toBeDefined();
    expect(state.relationships[npc]?.channel).toBe(true);

    // They are not a colleague, and they spend the day at the Station, where
    // the player can talk to them.
    const staff = new Set<string>([BASE.station.chief, ...BASE.station.staff]);
    expect(staff.has(npc)).toBe(false);
    expect(['contact', 'civilian', 'hostile-officer']).toContain(state.npcs[npc]?.role);
    const calling = state.relationships[npc]?.callingAt;
    expect(calling?.day).toBe(day);
    expect(calling).toBeDefined();
    if (calling !== undefined) {
      expect(visibleNpcsAt(state, calling.loc)).toContain(npc);
    }
  });

  it('is deterministic and does not mutate the Draft', () => {
    const world = atDay(BASE, 2);
    const before = JSON.stringify(world);
    const a = HOOKS.schedules(world, ctx(2));
    const b = HOOKS.schedules(world, ctx(2));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(world)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// hostileTick hook (Req 3.1, 5.1)
// ---------------------------------------------------------------------------

describe('hostileTick hook', () => {
  it('runs the Full Tick and leaves the Draft a value of its own', () => {
    const c = ctx(1);
    // The schedules hook fills the scratch the tick reads; run it first.
    const sched = HOOKS.schedules(atDay(BASE, 1), c);
    const { state, events } = HOOKS.hostileTick(sched.state, c);

    expect(state.hostile).toBeDefined();
    // All the tick's own events are hidden; only consequences reach the player.
    for (const e of events) {
      expect(e.visibility === 'hidden' || e.kind === 'plot-aborted').toBe(true);
    }
  });

  it('is deterministic and does not mutate the Draft', () => {
    const world = atDay(BASE, 1);
    const before = JSON.stringify(world);
    const a = HOOKS.hostileTick(world, ctx(1));
    const b = HOOKS.hostileTick(world, ctx(1));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(world)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// newspaper hook (Req 2.5, 3.8, 5.1)
// ---------------------------------------------------------------------------

describe('newspaper hook', () => {
  it('publishes the edition and emits a player-visible newspaper event', () => {
    const { state, events } = HOOKS.newspaper(atDay(BASE, 1), ctx(1));

    const docId = state.newspapers[1];
    expect(docId).toBeDefined();
    expect(state.documents[docId]).toBeDefined();
    expect(state.documents[docId].kind).toBe('newspaper');
    // The edition is obtainable at the city's kiosk/library/bookshop Locations.
    expect(state.documents[docId].obtainableAt?.length ?? 0).toBeGreaterThan(0);

    expect(kinds(events)).toContain('newspaper');
    const event = events.find((e) => e.kind === 'newspaper');
    expect(event?.kind === 'newspaper' && event.doc).toBe(docId);
  });

  it('sells an outlet edition at the same kiosks as the city paper', () => {
    const base = atDay(BASE, 1);
    const armed = {
      ...base,
      ambient: {
        preparedEditions: [
          {
            outlet: 'tagblatt',
            items: [
              {
                id: 'story:strike',
                source: 'city-event' as const,
                headline: 'The works are out',
                summary: 'The morning shift did not report.',
                asserts: [],
              },
            ],
          },
        ],
        outlets: [{ id: 'tagblatt', name: 'The Tagblatt', slant: 'commercial' as const }],
      },
    } as WorldState;
    const { state } = HOOKS.newspaper(armed, ctx(1));
    const cityPaper = state.documents[state.newspapers[1]];
    const outletId = Object.keys(state.documents).find((id) => id.includes('outlet-tagblatt'));
    expect(outletId).toBeDefined();
    if (outletId === undefined || cityPaper === undefined) {
      return;
    }
    expect(state.documents[outletId]?.obtainableAt).toEqual(cityPaper.obtainableAt);
    expect(state.documents[outletId]?.obtainableAt?.length ?? 0).toBeGreaterThan(0);
    expect(state.documents[outletId]?.title).toBe('The Tagblatt');
  });

  it('takes yesterday\'s paper off the rack when today\'s edition is published', () => {
    const armed = { ...atDay(BASE, 1), ambient: { preparedEditions: [] } } as WorldState;
    const first = HOOKS.newspaper(armed, ctx(1)).state;
    const yesterday = first.documents[first.newspapers[1]];
    expect(yesterday?.obtainableAt?.length ?? 0).toBeGreaterThan(0);
    const second = HOOKS.newspaper(atDay(first, 2), ctx(2)).state;
    expect(second.documents[first.newspapers[1]]?.obtainableAt).toEqual([]);
    const today = second.documents[second.newspapers[2]];
    expect(today?.obtainableAt?.length ?? 0).toBeGreaterThan(0);
  });

  it('folds a scratch plant into the published edition, asserting its Proposition (Req 2.5, 3.8)', () => {
    // A real plant carries a real false-belief Proposition. The edition must
    // provably assert it — not merely be published. With only the city-weather
    // filler and this one plant in the pool, the composer draws a target count
    // in [3, 6] clamped to the pool size (2), so both items are always selected:
    // the plant always rides the edition on any daily seed.
    const prop: Proposition = revealTruth(TRUTH.facts()[0]);
    const c = ctx(1);
    c.scratch.newspaperPlants = [
      {
        id: 'news:plant/real',
        source: 'rumour' as const,
        headline: 'A sighting in the ring',
        summary: 'A well-known face was seen where it should not have been.',
        asserts: [prop],
      },
    ];

    const { state } = HOOKS.newspaper(atDay(BASE, 1), c);
    const docId = state.newspapers[1];
    const edition = state.documents[docId];

    expect(edition).toBeDefined();
    // The plant's Proposition is asserted by the published edition Document …
    expect(edition.asserts).toContain(prop.id);
    // … and its full Proposition rode into the Document's Propositions, so a
    // reader seeds the Case File with the planted Claim.
    expect(state.documentPropositions[prop.id]).toEqual(prop);
  });

  it('prints the paper name, the weekday, the day weather, and a stage that ran today', () => {
    const base = atDay(BASE, 1);
    const stage = base.plot.stages[0];
    expect(stage).toBeDefined();
    if (stage === undefined) {
      return;
    }
    const armed = {
      ...base,
      plot: {
        ...base.plot,
        stages: base.plot.stages.map((item, index) =>
          index === 0
            ? { ...item, status: 'executed' as const, deadline: { day: 1, phase: 0 as const } }
            : item,
        ),
      },
    };
    const { state } = HOOKS.newspaper(armed, ctx(1));
    const edition = state.documents[state.newspapers[1]];
    expect(edition).toBeDefined();
    if (edition === undefined) {
      return;
    }
    expect(edition.title).toContain('Wiener Tagblatt');
    expect(edition.title).toMatch(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/);
    expect(edition.title).not.toContain('newspaper-');
    expect(edition.body).not.toContain('the the');
    expect(edition.body).not.toContain('held fair');
    expect(edition.body).toContain('WIENER TAGESBLATT');
    expect(edition.body).toMatch(/weather was (?!quiet)/);
    expect(edition.title).toContain('1952');
  });

  it('prints no news on Sunday or Christmas, and shuts the office on Christmas', () => {
    const sunday = HOOKS.newspaper(atDay(BASE, 6), ctx(6)).state;
    const sundayEdition = sunday.documents[sunday.newspapers[6]];
    expect(sundayEdition).toBeDefined();
    expect(sundayEdition?.body).toContain('does not publish on Sunday');

    const christmas = HOOKS.newspaper(atDay(BASE, 24), ctx(24)).state;
    const christmasEdition = christmas.documents[christmas.newspapers[24]];
    expect(christmasEdition?.body).toContain('Christmas');
    expect(christmasEdition?.title).toContain('Thursday');

    const chief = BASE.station.chief;
    const office = BASE.npcs[chief]?.schedule.entries.find(
      (entry) => entry.weekday === 3 && entry.phase === 0,
    );
    expect(office).toBeDefined();
    if (office === undefined) {
      return;
    }
    expect(visibleNpcsAt(atDay(BASE, 3), office.loc)).toContain(chief);
    expect(visibleNpcsAt(atDay(BASE, 24), office.loc)).not.toContain(chief);
  });

  it('is deterministic and does not mutate the Draft', () => {
    const world = atDay(BASE, 3);
    const before = JSON.stringify(world);
    const a = HOOKS.newspaper(world, ctx(3));
    const b = HOOKS.newspaper(world, ctx(3));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(world)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// worldAbortCheck (Req 4.5)
// ---------------------------------------------------------------------------

describe('worldAbortCheck', () => {
  it('aborts a running Plot when the materiel is seized, writing a success end', () => {
    const seized: WorldState = {
      ...BASE,
      plot: { ...BASE.plot, status: 'running', materielSeized: true },
    };
    const { state, events } = worldAbortCheck(seized, { day: 1, phase: 0 });

    expect(state.plot.status).toBe('aborted');
    expect(state.plot.abortCause).toBe('materiel-seized');
    expect(state.ended?.outcome).toBe('success');
    expect(state.ended?.cause).toBe('materiel-seized');
    expect(kinds(events)).toContain('plot-aborted');
  });

  it('leaves a running Plot untouched when nothing triggers an abort', () => {
    const running: WorldState = {
      ...BASE,
      plot: { ...BASE.plot, status: 'running', materielSeized: false },
    };
    const { state, events } = worldAbortCheck(running, { day: 1, phase: 0 });
    expect(state).toBe(running);
    expect(events).toEqual([]);
  });

  it('does not re-stamp an already-aborted Plot', () => {
    const aborted: WorldState = {
      ...BASE,
      plot: {
        ...BASE.plot,
        status: 'aborted',
        abortCause: 'pressure',
        materielSeized: true,
      },
    };
    const { state, events } = worldAbortCheck(aborted, { day: 1, phase: 0 });
    expect(state).toBe(aborted);
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Seizure-triggered abort through a hook (Req 4.5)
// ---------------------------------------------------------------------------

describe('a seizure aborts the Plot through a Day-Boundary Hook', () => {
  /** A running Plot with its materiel seized, at the Day Boundary of day 1. */
  function seizedDraft(): WorldState {
    return {
      ...BASE,
      time: { day: 1, phase: 0 },
      plot: { ...BASE.plot, status: 'running', materielSeized: true },
    };
  }

  it('the plot hook ends the Plot aborted with cause materiel-seized and a success End Condition', () => {
    // The abort fires inside the `plot` hook's own output (its embedded abort
    // check reads the materiel-seized flag off the live Disruption Context), so
    // this exercises the whole hook path, not `worldAbortCheck` in isolation.
    const { state, events } = HOOKS.plot(seizedDraft(), ctx(1));

    expect(state.plot.status).toBe('aborted');
    expect(state.plot.abortCause).toBe('materiel-seized');
    expect(kinds(events)).toContain('plot-aborted');

    // `detectEnd` later sees the success End the hook wrote to WorldState.ended.
    expect(state.ended?.outcome).toBe('success');
    expect(state.ended?.cause).toBe('materiel-seized');
  });

  it('the hostileTick hook also aborts a Plot whose materiel is seized (Req 4.5)', () => {
    // The Hostile tick runs its own abort check after adaptation, so a seizure
    // standing in the Draft aborts the Plot through this hook too.
    const c = ctx(1);
    // The tick reads the schedules hook's day events through the scratch; run
    // schedules first so the scratch is populated as it is in a real boundary.
    const sched = HOOKS.schedules(seizedDraft(), c);
    const { state, events } = HOOKS.hostileTick(sched.state, c);

    expect(state.plot.status).toBe('aborted');
    expect(state.plot.abortCause).toBe('materiel-seized');
    expect(kinds(events)).toContain('plot-aborted');
    expect(state.ended?.outcome).toBe('success');
    expect(state.ended?.cause).toBe('materiel-seized');
  });
});
