/**
 * Property 18 — Interception completeness (dedicated formal version; task
 * 11.10; Requirement 25.3).
 *
 * The design states Property 18 as:
 *
 * > **Property 18: Interception completeness.** For any transmission schedule
 * > and sequence of intercept actions at the Station, every transmission on a
 * > known radio or numbers Channel is delivered at most once. Every such
 * > transmission is delivered if an intercept action occurs within its
 * > retention window.
 *
 * `intercept.spec.ts` (task 11.7) already covers Station collection by example,
 * including the idempotence case tagged "(Property 18)"; this is the NEW
 * dedicated Property-18 file, driving the real generated world through
 * fast-check over arbitrary schedules and action sequences. Test-only — it
 * touches no production code.
 *
 * ## What is being checked, precisely
 *
 * We seed `WorldState.transmissions` (what the Cipher Engine mints at world
 * assembly, task 26.3) with an arbitrary schedule — transmissions across many
 * days and phases, on channels that are known-and-interceptable (radio /
 * numbers), known-but-not-interceptable (courier / dead-drop), and unknown — and
 * then run an arbitrary sequence of Station intercept actions, each at its own
 * game time (we advance the clock between actions by replaying the resolver on a
 * re-timed state). After the whole sequence we assert:
 *
 * - **(a) at-most-once delivery.** No Intercept id is ever delivered twice: the
 *   delivered-id multiset has no duplicate, every collected count across the
 *   whole sequence sums to the number of *distinct* ids delivered, and
 *   re-running an action from the post-collection state collects nothing new
 *   (collection is idempotent — a fixed point).
 *
 * - **(b) completeness.** Every seeded transmission on a *known radio/numbers*
 *   Channel whose time lies in the retention window `[t − retentionDays, t]`
 *   ending at some action's time `t` IS present in `WorldState.intercepts` after
 *   the sequence. Conversely, nothing on an unknown or non-interceptable Channel,
 *   and nothing outside every action's window, is ever delivered — so "delivered"
 *   is exactly "due at some action".
 *
 * The resolver under test is `resolveIntercept` / `stationCollection` /
 * `retentionDays` in `./intercept.ts`. We reuse the core-pack `world()` fixture,
 * the `testTransmission` / `atStation` / `withKnownRadioChannel` / `fixedPrng`
 * shapes mirrored from `intercept.spec.ts` so the two files stay in step.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
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

import { createPrng } from '../prng/prng.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import {
  asTruth,
  compareTime,
  type ChannelId,
  type GameTime,
  type InterceptId,
  type Phase,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { Channel, ChannelKind } from '../city/comms.js';
import type { Intercept, Transmission } from '../cipher/intercept.js';
import {
  resolveIntercept,
  stationCollection,
  retentionDays,
  isAtStation,
  STATION_LOCATION_TYPE,
} from './intercept.js';
import type { InterceptAction } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors intercept.spec.ts)
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
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
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

function inputs(): GenerateInputs {
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
  return { content, preset: STANDARD, scenario, cityData, descriptors, publicTexts };
}

function world(seed = 'interception-completeness'): WorldState {
  return generate(seed, inputs());
}

/** A Prng whose `next()` always returns the given constant (for coin control). */
function fixedPrng(value: number): ReturnType<typeof createPrng> {
  const base = createPrng('ignored');
  return { ...base, next: () => value };
}

const noRender = (): string[] => [];

// ---------------------------------------------------------------------------
// Transmission + world shaping (mirrors intercept.spec.ts)
// ---------------------------------------------------------------------------

/**
 * A minimal real {@link Transmission} on a Channel at a time, carrying an
 * {@link Intercept} whose id is deterministic in the channel and time, so a test
 * can assert which firings were delivered. The action reads only `at`, `channel`
 * and the carried Intercept, so a trivial Intercept exercises the sweep
 * faithfully. (In production the Cipher Engine seeds these at world assembly.)
 */
function testTransmission(channel: Channel, at: GameTime): Transmission {
  const local = channel.id.slice(channel.id.indexOf(':') + 1);
  const slug = local.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const id = `int:${slug}@${at.day}.${at.phase}` as InterceptId;
  const intercept: Intercept = {
    id,
    at,
    channel: channel.id,
    owner: channel.owner,
    direction: 'outbound',
    meta: { length: 12, callsign: slug.slice(0, 4).toUpperCase() || 'STN' },
    ciphertext: 'ABCDEFGHIJKL',
    spec: asTruth({ kind: 'caesar', shift: 1 } as const),
    plaintextProps: asTruth(['p:0'] as readonly string[]),
    origin: asTruth('noise' as const),
  };
  return {
    id: `tx:${slug}@${at.day}.${at.phase}`,
    at,
    channel: channel.id,
    owner: channel.owner,
    origin: asTruth('noise' as const),
    intercept,
  };
}

/**
 * Put the player at the Station: restamp their current Location's type to
 * `station-hq`, open in every phase, so `isAtStation` holds. (Mirrors
 * `atStation` in intercept.spec.ts.)
 */
function atStation(base: WorldState): WorldState {
  const locId = base.player.loc;
  const loc = base.city.locations[locId];
  return {
    ...base,
    city: {
      ...base.city,
      locations: {
        ...base.city.locations,
        [locId]: {
          ...loc,
          type: STATION_LOCATION_TYPE,
          public: false,
          hours: { 0: true, 1: true, 2: true, 3: true },
        },
      },
    },
  };
}

/**
 * The channel palette the schedule draws from. Four channels register on the
 * World State; the player *knows* only the two interceptable ones and the one
 * non-interceptable one, so an "unknown" channel exercises the known-gate too.
 *
 * - `radio` + `numbers` — known and interceptable (the only deliverable ones);
 * - `courier` — known but NOT interceptable (never deliverable at the Station);
 * - `unknown` — a numbers Channel the player does NOT know (never deliverable).
 */
interface ChannelPalette {
  readonly radio: Channel;
  readonly numbers: Channel;
  readonly courier: Channel;
  readonly unknown: Channel;
}

/** The channel key the schedule arbitrary picks for each transmission. */
type ChannelKey = keyof ChannelPalette;

const CHANNEL_KEYS: readonly ChannelKey[] = ['radio', 'numbers', 'courier', 'unknown'];

/**
 * Register four channels and mark three of them known. Returns the palette and
 * the shaped state. The channels fire nothing on their own schedules — the test
 * seeds transmissions directly — so the schedule here is a placeholder that
 * never matters to Station collection (which reads `WorldState.transmissions`,
 * not channel schedules).
 */
function withChannels(base: WorldState): { state: WorldState; palette: ChannelPalette } {
  const owner = base.station.org;
  const schedule = {
    period: 1,
    start: { day: 0, phase: 0 as Phase },
    phase: 0 as Phase,
  };
  const mk = (id: string, kind: ChannelKind): Channel => {
    if (kind === 'courier') {
      return { id: id as ChannelId, kind, owner, route: base.player.loc, schedule };
    }
    if (kind === 'radio') {
      return { id: id as ChannelId, kind, owner, schedule, reception: ['city:home'] };
    }
    return { id: id as ChannelId, kind, owner, schedule };
  };

  const palette: ChannelPalette = {
    radio: mk('chan:test/radio', 'radio'),
    numbers: mk('chan:test/numbers', 'numbers'),
    courier: mk('chan:test/courier', 'courier'),
    unknown: mk('chan:test/unknown', 'numbers'),
  };

  const channels = {
    ...base.channels,
    [palette.radio.id]: palette.radio,
    [palette.numbers.id]: palette.numbers,
    [palette.courier.id]: palette.courier,
    [palette.unknown.id]: palette.unknown,
  };
  // The player knows radio, numbers and courier — but NOT the unknown channel.
  const known = [
    ...base.player.known.channels,
    palette.radio.id,
    palette.numbers.id,
    palette.courier.id,
  ];
  const state: WorldState = {
    ...base,
    channels,
    player: { ...base.player, known: { ...base.player.known, channels: known } },
  };
  return { state, palette };
}

/** True when a Channel key is known-and-interceptable (deliverable at the Station). */
function isDeliverableKey(key: ChannelKey): boolean {
  // Every radio/numbers Channel is audible at the Station, known or not; a
  // courier is not a broadcast and is never swept.
  return key !== 'courier';
}

// ---------------------------------------------------------------------------
// Arbitraries: a transmission schedule and a sequence of action times
// ---------------------------------------------------------------------------

/** A single scheduled transmission: which channel, which day, which phase. */
interface ScheduledTx {
  readonly key: ChannelKey;
  readonly day: number;
  readonly phase: Phase;
}

const MAX_DAY = 12;

const phaseArb: fc.Arbitrary<Phase> = fc.constantFrom(0, 1, 2, 3) as fc.Arbitrary<Phase>;

const scheduledTxArb: fc.Arbitrary<ScheduledTx> = fc.record({
  key: fc.constantFrom(...CHANNEL_KEYS),
  day: fc.integer({ min: 0, max: MAX_DAY }),
  phase: phaseArb,
});

/** An arbitrary transmission schedule: a handful of firings across the window. */
const scheduleArb: fc.Arbitrary<readonly ScheduledTx[]> = fc.array(scheduledTxArb, {
  minLength: 0,
  maxLength: 24,
});

/** An arbitrary action time (an intercept at the Station happens at this time). */
const actionTimeArb: fc.Arbitrary<GameTime> = fc.record({
  day: fc.integer({ min: 0, max: MAX_DAY }),
  phase: phaseArb,
});

/** An arbitrary sequence of Station-intercept action times. */
const actionsArb: fc.Arbitrary<readonly GameTime[]> = fc.array(actionTimeArb, {
  minLength: 1,
  maxLength: 8,
});

// ---------------------------------------------------------------------------
// Driving the schedule + action sequence
// ---------------------------------------------------------------------------

/** Materialise a schedule into seeded `WorldState.transmissions` on the palette. */
function seed(
  state: WorldState,
  palette: ChannelPalette,
  schedule: readonly ScheduledTx[],
): WorldState {
  const txs: Transmission[] = schedule.map((s) =>
    testTransmission(palette[s.key], { day: s.day, phase: s.phase }),
  );
  return { ...state, transmissions: [...state.transmissions, ...txs] };
}

/** The intercept id a scheduled firing carries (matches `testTransmission`). */
function expectedId(palette: ChannelPalette, s: ScheduledTx): InterceptId {
  return testTransmission(palette[s.key], { day: s.day, phase: s.phase }).intercept.id;
}

/**
 * Run the whole action sequence from `start`, each action re-timing the state to
 * its action time. Returns the final state and the per-action delivered-id lists
 * (so the caller can check at-most-once across the sequence).
 */
function runSequence(
  start: WorldState,
  actions: readonly GameTime[],
): { final: WorldState; deliveredPerAction: readonly InterceptId[][] } {
  let current = start;
  const deliveredPerAction: InterceptId[][] = [];
  const a: InterceptAction = { kind: 'intercept' };
  for (const time of actions) {
    const timed: WorldState = { ...current, time };
    const before = new Set(Object.keys(timed.intercepts));
    const { next } = resolveIntercept(timed, a, fixedPrng(1), noRender);
    const delivered = Object.keys(next.intercepts).filter((id) => !before.has(id));
    deliveredPerAction.push(delivered as InterceptId[]);
    current = next;
  }
  return { final: current, deliveredPerAction };
}

/**
 * The ids that SHOULD be delivered: every scheduled firing on a known/interceptable
 * channel whose time is in the retention window `[t − retentionDays, t]` of at
 * least one action time `t`. Dedup to a set (an id delivered by two overlapping
 * windows is still one id).
 */
function dueIds(
  state: WorldState,
  palette: ChannelPalette,
  schedule: readonly ScheduledTx[],
  actions: readonly GameTime[],
): Set<InterceptId> {
  const windowDays = retentionDays(state);
  const out = new Set<InterceptId>();
  for (const s of schedule) {
    if (!isDeliverableKey(s.key)) {
      continue;
    }
    const at: GameTime = { day: s.day, phase: s.phase };
    const inSomeWindow = actions.some(
      (t) => s.day >= t.day - windowDays && compareTime(at, t) <= 0,
    );
    if (inSomeWindow) {
      out.add(expectedId(palette, s));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Property 18
// ---------------------------------------------------------------------------

describe('Property 18: interception completeness (Req 25.3)', () => {
  const BASE = (() => {
    const { state, palette } = withChannels(atStation(world()));
    return { state, palette };
  })();

  it('is driving a world where the player is at the Station', () => {
    expect(isAtStation(BASE.state)).toBe(true);
    expect(retentionDays(BASE.state)).toBeGreaterThanOrEqual(1);
  });

  it('(a) delivers every Intercept at most once across any action sequence', () => {
    fc.assert(
      fc.property(scheduleArb, actionsArb, (schedule, actions) => {
        const seeded = seed(BASE.state, BASE.palette, schedule);
        const { final, deliveredPerAction } = runSequence(seeded, actions);

        // No id is delivered twice across the whole sequence.
        const all = deliveredPerAction.flat();
        const unique = new Set(all);
        expect(all.length).toBe(unique.size);

        // The final Case File holds exactly the distinct delivered ids.
        expect(new Set(Object.keys(final.intercepts))).toEqual(
          new Set([...Object.keys(BASE.state.intercepts), ...unique]),
        );
      }),
    );
  });

  it('(a) re-collecting from the post-sequence state is a fixed point (idempotent)', () => {
    fc.assert(
      fc.property(scheduleArb, actionsArb, (schedule, actions) => {
        const seeded = seed(BASE.state, BASE.palette, schedule);
        const { final } = runSequence(seeded, actions);

        // Any further action at the last action's time collects nothing new.
        const lastTime = actions[actions.length - 1];
        const timed: WorldState = { ...final, time: lastTime };
        expect(stationCollection(timed).length).toBe(0);
        const again = resolveIntercept(
          timed,
          { kind: 'intercept' },
          fixedPrng(1),
          noRender,
        );
        expect(Object.keys(again.next.intercepts).sort()).toEqual(
          Object.keys(final.intercepts).sort(),
        );
        expect(again.result.observations.length).toBe(0);
      }),
    );
  });

  it('(b) delivers exactly the transmissions due within some action window', () => {
    fc.assert(
      fc.property(scheduleArb, actionsArb, (schedule, actions) => {
        const seeded = seed(BASE.state, BASE.palette, schedule);
        const { final } = runSequence(seeded, actions);

        const expected = dueIds(BASE.state, BASE.palette, schedule, actions);
        const delivered = new Set(
          Object.keys(final.intercepts).filter(
            (id) =>
              BASE.state.intercepts[id as InterceptId] === undefined &&
              schedule.some((t) => expectedId(BASE.palette, t) === id),
          ),
        );

        // Completeness: every due transmission is delivered.
        for (const id of expected) {
          expect(delivered.has(id)).toBe(true);
        }
        // Soundness of the window: nothing outside every action's window, and
        // nothing on a non-broadcast channel, is delivered.
        expect(delivered).toEqual(expected);
      }),
    );
  });

  it('(b) a transmission outside every retention window is never delivered', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ChannelKey>('radio', 'numbers'),
        phaseArb,
        actionsArb,
        (key, phase, actions) => {
          // Place the firing strictly before every action's window start, so it
          // can never be due no matter how the windows fall.
          const windowDays = retentionDays(BASE.state);
          const earliestStart = Math.min(
            ...actions.map((t) => t.day - windowDays),
          );
          const day = earliestStart - 1;
          const schedule: ScheduledTx[] = [{ key, day, phase }];
          const seeded = seed(BASE.state, BASE.palette, schedule);
          const { final } = runSequence(seeded, actions);
          const id = expectedId(BASE.palette, schedule[0]);
          expect(final.intercepts[id]).toBeUndefined();
        },
      ),
    );
  });

  it('(b) a known/interceptable transmission at an action time is always delivered', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ChannelKey>('radio', 'numbers'),
        actionTimeArb,
        (key, time) => {
          // One firing exactly at the action time: inside the window [t−k, t].
          const schedule: ScheduledTx[] = [{ key, day: time.day, phase: time.phase }];
          const seeded = seed(BASE.state, BASE.palette, schedule);
          const { final } = runSequence(seeded, [time]);
          const id = expectedId(BASE.palette, schedule[0]);
          expect(final.intercepts[id]).toBeDefined();
        },
      ),
    );
  });

  it('hearing traffic on a Channel the player did not know reveals it', () => {
    fc.assert(
      fc.property(actionTimeArb, (time) => {
        const schedule: ScheduledTx[] = [{ key: 'unknown', day: time.day, phase: time.phase }];
        const seeded = seed(BASE.state, BASE.palette, schedule);
        const { final } = runSequence(seeded, [time]);
        expect(final.intercepts[expectedId(BASE.palette, schedule[0])]).toBeDefined();
        expect(final.player.known.channels).toContain(BASE.palette.unknown.id);
      }),
    );
  });

  it('never delivers a transmission on a non-broadcast (courier) channel', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ChannelKey>('courier'),
        actionTimeArb,
        (key, time) => {
          const schedule: ScheduledTx[] = [{ key, day: time.day, phase: time.phase }];
          const seeded = seed(BASE.state, BASE.palette, schedule);
          const { final } = runSequence(seeded, [time]);
          const id = expectedId(BASE.palette, schedule[0]);
          expect(final.intercepts[id]).toBeUndefined();
        },
      ),
    );
  });

  it('an outstation hears numbers everywhere and radio only inside its reception set', () => {
    const at = { day: 1, phase: 'morning' as Phase };
    const seeded = seed(BASE.state, BASE.palette, [
      { key: 'radio', day: at.day, phase: at.phase },
      { key: 'numbers', day: at.day, phase: at.phase },
    ]);
    const away: WorldState = { ...seeded, time: at, player: { ...seeded.player, city: 'city:away' } };
    const heard = stationCollection(away).map((tx) => tx.channel);
    expect(heard).toContain(BASE.palette.numbers.id);
    expect(heard).not.toContain(BASE.palette.radio.id);
    const home: WorldState = { ...seeded, time: at, player: { ...seeded.player, city: 'city:home' } };
    const atHome = stationCollection(home).map((tx) => tx.channel);
    expect(atHome).toContain(BASE.palette.radio.id);
  });
});
