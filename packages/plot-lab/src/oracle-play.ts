/**
 * The oracle plays a generated world through `quote` and `resolve` only.
 * The truth store names the cell leader and the true cipher key. The clock is
 * set to that leader's schedule, which is the trace window, and every move
 * after that is a quoted action.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';
import {
  generateGame,
  isAtStation,
  isOwnDrop,
  locationGate,
  quote,
  resolve,
  revealedSpec,
  revealTruth,
  scheduledLocationAt,
  ScenarioConfigSchema,
  stationCollection,
  TruthDraft,
  visibleNpcsAt,
  type Action,
  type GenerateInputs,
  type LocId,
  type NpcId,
  type Phase,
  type Prng,
  type ResolverContext,
  type TruthStore,
  type WorldState,
} from '@tradecraft/engine';

const CORE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'packs', 'core');

interface Bench {
  readonly content: ContentSet;
  readonly world: WorldState;
  readonly truth: TruthStore;
  readonly leader: NpcId;
}

let cached: Bench | undefined;

function presetOf(content: ContentSet): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === 'standard' || key.endsWith('/standard')) {
      return value;
    }
  }
  throw new Error('core pack has no standard preset');
}

function inputs(content: ContentSet, preset: DifficultyPreset): GenerateInputs {
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
  }
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: preset.id },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return { content, preset, scenario, cityData: cityData.value, descriptors: descriptors.value, publicTexts: publicTexts.value };
}

/** One slice world and its truth store, shared so each seed replays the same city. */
export function loadBench(): Bench {
  if (cached !== undefined) {
    return cached;
  }
  const loaded = loadContent([CORE_DIR], ['core']);
  if (!loaded.ok) {
    throw new Error('core pack failed to load');
  }
  const preset = presetOf(loaded.value);
  const generated = generateGame('plot-lab-oracle', inputs(loaded.value, preset));
  const leader = revealTruth(generated.world.plot.leader);
  cached = { content: loaded.value, world: generated.world, truth: generated.truth, leader };
  return cached;
}

function at(state: WorldState, day: number, phase: Phase, loc?: LocId): WorldState {
  return {
    ...state,
    time: { day, phase },
    player: loc === undefined ? state.player : { ...state.player, loc },
  };
}

function allows(bench: Bench, state: WorldState, action: Action): boolean {
  return (
    locationGate(state, bench.content, action) === undefined &&
    quote(state, action, { content: bench.content, truth: bench.truth }).allowed
  );
}

function act(state: WorldState, action: Action, rng: Prng, ctx: ResolverContext): WorldState | undefined {
  if (!quote(state, action, ctx).allowed) {
    return undefined;
  }
  return resolve(state, action, rng, ctx).next;
}

function travel(state: WorldState, loc: LocId, rng: Prng, ctx: ResolverContext): WorldState | undefined {
  if (state.player.loc === loc) {
    return state;
  }
  return act(state, { kind: 'travel', to: loc, countersurveillance: false }, rng, ctx);
}

/** A clock time in the next two weeks when the leader is outside the Soviet sector. */
function westernArrestTime(bench: Bench): { day: number; phase: Phase } | undefined {
  const npc = bench.world.npcs[bench.leader];
  if (npc === undefined) {
    return undefined;
  }
  const start = bench.world.meta.setting.startDate;
  for (let day = 0; day < 14; day += 1) {
    for (const phase of [0, 1, 2, 3] as const) {
      const loc = scheduledLocationAt(npc, { day, phase }, start);
      if (loc === undefined) {
        continue;
      }
      const place = bench.world.city.locations[loc];
      const sector = place === undefined ? undefined : bench.world.city.districts[place.district]?.sector;
      if (sector !== 'soviet') {
        return { day, phase };
      }
    }
  }
  return undefined;
}

function leaderWindow(bench: Bench, kind: 'surveil' | 'follow'): { day: number; phase: Phase; loc: LocId } | undefined {
  const npc = bench.world.npcs[bench.leader];
  if (npc === undefined) {
    return undefined;
  }
  for (const entry of npc.schedule.entries) {
    const stood =
      kind === 'follow'
        ? at(bench.world, entry.weekday, entry.phase, entry.loc)
        : at(bench.world, entry.weekday, entry.phase);
    const action: Action =
      kind === 'follow'
        ? { kind: 'follow', target: bench.leader }
        : { kind: 'surveil', at: entry.loc, phases: 1 };
    if (!allows(bench, stood, action)) {
      continue;
    }
    if (kind === 'follow' && !visibleNpcsAt(stood, entry.loc).includes(bench.leader)) {
      continue;
    }
    return { day: entry.weekday, phase: entry.phase, loc: entry.loc };
  }
  return undefined;
}

function stationOf(world: WorldState): LocId | undefined {
  for (const loc of Object.keys(world.city.locations) as LocId[]) {
    if (isAtStation({ ...world, player: { ...world.player, loc } })) {
      return loc;
    }
  }
  return undefined;
}

function stationWindow(bench: Bench, station: LocId, verb: 'intercept' | 'cable'): WorldState | undefined {
  for (let day = 0; day <= 21; day += 1) {
    for (const phase of [0, 1, 2, 3] as const) {
      const stood = at(bench.world, day, phase, station);
      if (verb === 'intercept') {
        const action: Action = { kind: 'intercept' };
        if (allows(bench, stood, action) && stationCollection(stood).length > 0) {
          return stood;
        }
      } else if (locationGate(stood, bench.content, { kind: 'intercept' }) === undefined && isAtStation(stood)) {
        return stood;
      }
    }
  }
  return undefined;
}

function dropWindow(bench: Bench): { drop: (typeof bench.world.deadDrops)[keyof typeof bench.world.deadDrops]; stood: WorldState } | undefined {
  for (const drop of Object.values(bench.world.deadDrops)) {
    if (isOwnDrop(bench.world, drop)) {
      continue;
    }
    for (const phase of [0, 1, 2, 3] as const) {
      const stood = at(bench.world, 0, phase, drop.loc);
      const action: Action = { kind: 'service-drop', drop: drop.id, leave: [], hostileMode: 'seize' };
      if (allows(bench, stood, action)) {
        return { drop, stood };
      }
    }
  }
  return undefined;
}

function roleOf(world: WorldState, leader: NpcId): string {
  return world.plot.roles.find((role) => role.npc === leader)?.slot ?? 'leader';
}

/**
 * Play `verbs` in order. Returns true only when every verb is quoted allowed
 * and resolved. Writes stay on a truth draft, so the cached store is unchanged.
 */
export function playQuoteResolve(verbs: readonly string[], rng: Prng): boolean {
  if (verbs.length === 0 || verbs[0] === 'wait') {
    return true;
  }
  const bench = loadBench();
  const draft = TruthDraft.over(bench.truth);
  const base: ResolverContext = { content: bench.content, truth: draft };
  let state = bench.world;
  try {
    for (const verb of verbs) {
      const next = playVerb(bench, state, verb, rng, base);
      if (next === undefined) {
        return false;
      }
      state = next;
    }
    return true;
  } catch {
    return false;
  } finally {
    draft.discard();
  }
}

function playVerb(
  bench: Bench,
  state: WorldState,
  verb: string,
  rng: Prng,
  ctx: ResolverContext,
): WorldState | undefined {
  if (verb === 'surveil') {
    const window = leaderWindow(bench, 'surveil');
    if (window === undefined) {
      return undefined;
    }
    const timed = at(state, window.day, window.phase);
    return act(timed, { kind: 'surveil', at: window.loc, phases: 1 }, rng, ctx);
  }
  if (verb === 'follow') {
    const window = leaderWindow(bench, 'follow');
    if (window === undefined) {
      return undefined;
    }
    const timed = at(state, window.day, window.phase);
    const there = travel(timed, window.loc, rng, ctx);
    if (there === undefined) {
      return undefined;
    }
    return act(there, { kind: 'follow', target: bench.leader }, rng, ctx);
  }
  if (verb === 'intercept') {
    const station = stationOf(bench.world);
    if (station === undefined) {
      return undefined;
    }
    const window = stationWindow(bench, station, 'intercept');
    if (window === undefined) {
      return undefined;
    }
    const timed = at(state, window.time.day, window.time.phase);
    const there = travel(timed, station, rng, ctx);
    if (there === undefined) {
      return undefined;
    }
    return act(there, { kind: 'intercept' }, rng, ctx);
  }
  if (verb === 'decrypt') {
    const id = Object.keys(state.intercepts).sort()[0];
    if (id === undefined) {
      return undefined;
    }
    const intercept = state.intercepts[id as keyof typeof state.intercepts];
    if (intercept === undefined) {
      return undefined;
    }
    const next = act(
      state,
      { kind: 'decrypt', intercept: intercept.id, submission: { kind: 'key', spec: revealedSpec(intercept) } },
      rng,
      ctx,
    );
    if (next?.intercepts[intercept.id]?.broken !== true) {
      return undefined;
    }
    return next;
  }
  if (verb === 'seize') {
    const found = dropWindow(bench);
    if (found === undefined) {
      return undefined;
    }
    const timed = at(state, found.stood.time.day, found.stood.time.phase);
    const there = travel(timed, found.drop.loc, rng, ctx);
    if (there === undefined) {
      return undefined;
    }
    return act(
      there,
      { kind: 'service-drop', drop: found.drop.id, leave: [], hostileMode: 'seize' },
      rng,
      ctx,
    );
  }
  if (verb === 'identify' || verb === 'arrest') {
    const station = stationOf(bench.world);
    if (station === undefined) {
      return undefined;
    }
    const window = stationWindow(bench, station, 'cable');
    if (window === undefined) {
      return undefined;
    }
    const evidence = bench.world.meta.preset.arrest.threshold;
    const gated: ResolverContext = {
      ...ctx,
      arrestEvidence: { [bench.leader]: evidence },
    };
    const timed = at(state, window.time.day, window.time.phase);
    const there = travel(timed, station, rng, ctx);
    if (there === undefined) {
      return undefined;
    }
    if (verb === 'identify') {
      return act(
        there,
        {
          kind: 'cable',
          body: {
            kind: 'report',
            body: 'Identification of the cell leader.',
            identify: { entity: bench.leader, roleTag: roleOf(bench.world, bench.leader) },
          },
        },
        rng,
        gated,
      );
    }
    const opened = westernArrestTime(bench);
    const when = opened === undefined ? there : at(there, opened.day, opened.phase);
    return act(when, { kind: 'arrest', npc: bench.leader }, rng, gated);
  }
  if (verb === 'wait') {
    return act(state, { kind: 'wait', phases: 1 }, rng, ctx);
  }
  return undefined;
}
