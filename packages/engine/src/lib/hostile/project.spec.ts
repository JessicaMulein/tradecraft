/**
 * Smoke tests for the Hostile Full Tick projection and application
 * (slice-integration task 4.2; Requirement 3).
 *
 * Each test stages a World State generated from the real core pack, projects
 * it with `projectFullTick`, runs the real `dailyTickFull` on a fixed Prng and
 * writes the result back with `applyFullTick`, the way the `hostileTick` hook
 * composes them. They cover the main paths: the projected inputs, due feeds
 * and belief plants, the mole report, an arrest, a doubling, the burn, the
 * minted comms traffic and a newspaper plant. Task 4.3 adds one example per
 * row of the design's input and output tables.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, expectTypeOf, it } from 'vitest';

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

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generateGame, type GenerateInputs } from '../generate.js';
import {
  asTruth,
  revealTruth,
  type ChannelId,
  type GameTime,
  type LocId,
  type NpcId,
  type Phase,
  type Proposition,
} from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import type { NpcStatus } from '../city/npc.js';
import { isInterceptableKind, transmissionTimes } from '../city/comms.js';
import { createPrng } from '../prng/prng.js';
import { TruthStore, type TruthReader } from '../truth/truth.js';
import { newRelationship, type Relationship } from '../recruit/asset.js';
import { worldCipherKeyLookup } from '../cipher/world-intercepts.js';
import { scheduledLocationAt } from '../clock/schedules.js';
import {
  newDayScratch,
  type AdvanceWorldDeps,
  type DayScratch,
  type WorldHookContext,
} from '../clock/world-types.js';
import { adoptBelief, beliefKey } from './beliefs.js';
import type { Doctrine } from './doctrine.js';
import { dailyTickFull } from './hostile.js';
import {
  applyFullTick,
  projectFullTick,
  PRIOR_TRUST_CEILING,
  PRIOR_TRUST_FLOOR,
  type FullTickApplyContext,
  type FullTickProjectionDeps,
} from './project.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors disruption.spec.ts)
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

function inputs(): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: {
        trust: 1,
        riskAversion: 1,
        scheduleConflict: 1,
        agendaInterest: 1,
      },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return {
    content,
    preset: preset('standard'),
    scenario,
    cityData,
    descriptors,
    publicTexts,
  };
}

const GAME = generateGame('hostile-project-alpha', inputs());
const BASE: WorldState = GAME.world;
const TRUTH: TruthReader = GAME.truth;

/** The day whose Day Boundary most tests tick at. */
const DAY = 3;

/** Phase 0 of `day`. */
function boundary(day: number): GameTime {
  return { day, phase: 0 };
}

/** Civilians or contacts, by id: the Assets the tests recruit. */
const PEOPLE = (Object.keys(BASE.npcs) as NpcId[])
  .filter((id) => ['civilian', 'contact'].includes(BASE.npcs[id].role))
  .sort();
const ASSET = PEOPLE[0];
const OTHER = PEOPLE[1];
const TURNED = PEOPLE[2];

/** A Location in a District, for the arrest article's place. */
const LOC = (Object.keys(BASE.city.locations) as LocId[]).sort()[0];

/** A running Asset with access to {@link OTHER}. */
function assetRel(
  npc: NpcId,
  overrides: Partial<Relationship> = {},
): Relationship {
  return {
    ...newRelationship(npc),
    recruited: true,
    channel: true,
    trust: 0.6,
    exposure: 0.3,
    asset: {
      access: asTruth({ locs: [], orgs: [], npcs: [OTHER] }),
      reliability: asTruth(1),
      turned: false,
      hostileControlled: asTruth(false),
    },
    ...overrides,
  };
}

/** `BASE` with the given Relationships staged and anything else overridden. */
function staged(
  rels: readonly Relationship[],
  over: Partial<WorldState> = {},
): WorldState {
  const relationships = { ...BASE.relationships };
  for (const rel of rels) {
    relationships[rel.npc] = rel;
  }
  return { ...BASE, relationships, ...over };
}

/** `draft` with the given doctrine. */
function withDoctrine(draft: WorldState, doctrine: Doctrine): WorldState {
  return { ...draft, hostile: { ...draft.hostile, doctrine } };
}

/** `draft` with detection certain for a fully exposed Asset (`meeting` base 1). */
function withCertainDetection(draft: WorldState): WorldState {
  return {
    ...draft,
    meta: {
      ...draft.meta,
      preset: {
        ...draft.meta.preset,
        detectionBase: { surveil: 0, meeting: 1, drop: 0 },
      },
    },
  };
}

/** A Truth Store holding exactly `facts`. */
function truthWith(facts: readonly Proposition[]): TruthStore {
  return TruthStore.from(content.predicates.evaluators, {
    facts,
    allegiances: new Map(),
    identities: new Map(),
    claimTruths: [],
  });
}

/** Project, tick and apply the way the `hostileTick` hook does. */
function runTick(
  draft: WorldState,
  options: { day?: number; truth?: TruthReader; scratch?: DayScratch } = {},
) {
  const day = options.day ?? DAY;
  const at = boundary(day);
  const scratch = options.scratch ?? newDayScratch();
  const projection = projectFullTick(draft, day, scratch, {
    truth: options.truth ?? TRUTH,
  });
  const rng = createPrng(`hostile-project/${day}`);
  const result = dailyTickFull(
    projection.state,
    projection.candidates,
    at,
    rng,
    projection.base,
    projection.inputs,
  );
  const ctx: FullTickApplyContext = {
    time: at,
    rng,
    deps: {
      content,
      cipherKeys: worldCipherKeyLookup(draft.meta.seed, draft.documents),
    },
  };
  const output = applyFullTick(draft, result, scratch, ctx);
  return { projection, result, output, scratch, ctx };
}

// ---------------------------------------------------------------------------
// The hook's own context fits the module's signatures
// ---------------------------------------------------------------------------

describe('signatures', () => {
  it('accepts the hook context and the advanceWorld dependencies as they are', () => {
    expectTypeOf<WorldHookContext>().toExtend<FullTickApplyContext>();
    expectTypeOf<AdvanceWorldDeps>().toExtend<FullTickProjectionDeps>();
  });
});

// ---------------------------------------------------------------------------
// projectFullTick
// ---------------------------------------------------------------------------

describe('projectFullTick', () => {
  it('projects the Assets in play with their Exposure, the preset base and the player state, and writes nothing', () => {
    const held = assetRel(OTHER, {
      custody: {
        by: 'station',
        since: boundary(DAY),
        until: boundary(DAY + 1),
      },
    });
    // Arrested by the Station, turned and released back to work: still in play.
    const released = assetRel(TURNED, {
      custody: { by: 'station', since: boundary(1), until: boundary(2) },
    });
    const turned: Relationship = {
      ...released,
      asset:
        released.asset === undefined
          ? undefined
          : { ...released.asset, turned: true },
    };
    const draft = staged([assetRel(ASSET), held, turned], {
      player: { ...BASE.player, arrests: [TURNED] },
    });
    const before = JSON.stringify(draft);
    const scratch = newDayScratch();

    const {
      state,
      candidates,
      base,
      inputs: projected,
    } = projectFullTick(draft, DAY, scratch, { truth: TRUTH });

    expect(candidates).toEqual(
      [
        { npc: ASSET, turnedByPlayer: false },
        { npc: TURNED, turnedByPlayer: true },
      ].sort((a, b) => (a.npc < b.npc ? -1 : 1)),
    );
    expect(state.beliefs.exposure[ASSET]).toBe(0.3);
    expect(state.doctrine).toEqual(draft.hostile.doctrine);
    expect(base).toEqual(draft.meta.preset.detectionBase);
    expect(projected.dayEvents).toBe(scratch.dayEvents);
    expect(projected.plot).toBe(draft.plot);
    expect(projected.adaptation?.stationOrg).toBe(draft.station.org);
    expect(projected.adaptation?.target).toBe(revealTruth(draft.plot.target));
    expect(projected.adaptation?.cellMembers).toContain(
      revealTruth(draft.plot.leader),
    );
    expect(projected.tailing).toEqual({
      coverSuspicion: revealTruth(draft.player.coverSuspicion),
      tailed: revealTruth(draft.player.tailed),
    });
    expect(projected.tailingThresholds?.burn).toBe(
      draft.meta.preset.coverSuspicionBurnThreshold,
    );
    expect(projected.moleReport).toBeUndefined();
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('builds the mole report from station.reportable while the mole is at liberty', () => {
    const mole = BASE.station.staff[0];
    const reportable: Proposition[] = [
      {
        id: 'prop:project-test/reportable',
        subject: BASE.station.org,
        predicate: 'KNOWS',
        object: OTHER,
      },
    ];
    const draft = staged([], {
      station: { ...BASE.station, mole: asTruth(mole), reportable },
    });
    expect(
      projectFullTick(draft, DAY, newDayScratch(), {}).inputs.moleReport,
    ).toEqual({
      mole,
      propositions: reportable,
    });

    const arrested: WorldState = {
      ...draft,
      npcs: {
        ...draft.npcs,
        [mole]: { ...draft.npcs[mole], status: asTruth<NpcStatus>('fled') },
      },
    };
    expect(
      projectFullTick(arrested, DAY, newDayScratch(), {}).inputs.moleReport,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Feeds and belief plants (Req 3.5)
// ---------------------------------------------------------------------------

describe('feeds and belief plants', () => {
  const deliveredAt: GameTime = { day: DAY, phase: 2 };
  const trueFact = TRUTH.facts()
    .map((fact) => revealTruth(fact))
    .find((fact) => TRUTH.holds(fact, deliveredAt));
  if (trueFact === undefined) {
    throw new Error(
      'the generated Truth Store holds no fact at the delivery time',
    );
  }
  const falseFact: Proposition = {
    ...trueFact,
    id: 'prop:project-test/false',
    object: 'npc:project-test/nobody',
  };
  const planted: Proposition = {
    id: 'prop:project-test/planted',
    subject: BASE.station.org,
    predicate: 'SUSPECTS',
    object: OTHER,
  };

  function feed(
    agent: NpcId,
    at: GameTime,
    props: readonly Proposition[],
  ): SimEvent {
    return {
      id: `event:feed-delivered:${agent}:${at.day}.${at.phase}`,
      at,
      visibility: 'hidden',
      kind: 'feed-delivered',
      agent,
      props,
    };
  }

  function plant(at: GameTime, prop: Proposition): SimEvent {
    return {
      id: `event:belief-plant:${ASSET}:${prop.id}:${at.day}.${at.phase}`,
      at,
      visibility: 'hidden',
      kind: 'belief-plant',
      prop,
      by: ASSET,
    };
  }

  const dueToday = feed(ASSET, deliveredAt, [trueFact, falseFact]);
  const overdue = feed(OTHER, { day: DAY - 1, phase: 3 }, [falseFact]);
  const tomorrow = feed(ASSET, { day: DAY + 1, phase: 1 }, [trueFact]);
  const duePlant = plant(boundary(DAY), planted);
  const laterPlant = plant(boundary(DAY + 1), {
    ...planted,
    id: 'prop:project-test/later',
  });
  const draft = staged([], {
    scheduled: [overdue, duePlant, dueToday, laterPlant, tomorrow],
  });

  it('projects the feeds and plants due by the Day Boundary, and nothing later', () => {
    const { inputs: projected, state } = projectFullTick(
      draft,
      DAY,
      newDayScratch(),
      {
        truth: TRUTH,
      },
    );

    expect(projected.feeds?.map((delivery) => delivery.agent)).toEqual([
      OTHER,
      ASSET,
    ]);
    const today = projected.feeds?.[1];
    expect(today?.items.map((item) => item.holdsInTruth)).toEqual([
      true,
      false,
    ]);
    for (const delivery of projected.feeds ?? []) {
      expect(delivery.priorTrust).toBeGreaterThanOrEqual(PRIOR_TRUST_FLOOR);
      expect(delivery.priorTrust).toBeLessThanOrEqual(PRIOR_TRUST_CEILING);
    }
    expect(projected.newlyAdopted).toEqual([planted]);
    expect(state.beliefs.adoptedKeys).toContain(beliefKey(planted));
  });

  it('removes exactly the delivered events from scheduled and logs each fed agent', () => {
    const { output, result } = runTick(draft);

    expect(output.state.scheduled).toEqual([laterPlant, tomorrow]);
    expect(output.state.hostile.feedLog).toEqual([
      { at: boundary(DAY), agent: OTHER, classes: result.feedClasses[OTHER] },
      {
        at: boundary(DAY),
        agent: ASSET,
        classes: ['chickenfeed', 'deception'],
      },
    ]);
    expect(output.state.hostile.beliefs.adoptedKeys).toContain(
      beliefKey(planted),
    );
  });
});

// ---------------------------------------------------------------------------
// applyFullTick: arrests, doublings, the burn
// ---------------------------------------------------------------------------

describe('applyFullTick — responses to a detection', () => {
  it('arrests a detected Asset: status, Hostile custody, the voided meeting and an arrest article', () => {
    const meetingId = 'meeting:project-test/1' as const;
    const draft = withCertainDetection(
      withDoctrine(
        staged([assetRel(ASSET, { exposure: 1 })], {
          whereabouts: { ...BASE.whereabouts, [ASSET]: LOC },
          meetings: {
            ...BASE.meetings,
            [meetingId]: {
              id: meetingId,
              npc: ASSET,
              at: LOC,
              slot: { day: DAY + 1, phase: 1 },
              status: 'accepted',
              acceptance: 0.9,
            },
          },
        }),
        { riskTolerance: 0, securityConsciousness: 0.5, deceptionAppetite: 0 },
      ),
    );

    const { output, result, scratch } = runTick(draft);

    expect(
      result.events.some((e) => e.kind === 'asset-arrested' && e.npc === ASSET),
    ).toBe(true);
    expect(output.state.npcs[ASSET].status).toBe('arrested');
    expect(output.state.relationships[ASSET].custody).toEqual({
      by: 'hostile',
      since: boundary(DAY),
    });
    expect(output.state.meetings[meetingId].status).toBe('void');
    const district =
      BASE.city.districts[BASE.city.locations[LOC].district].name;
    expect(scratch.arrestArticles).toHaveLength(1);
    expect(scratch.arrestArticles[0].summary).toContain(district);
    expect(output.events).toBe(result.events);
    expect(output.events.every((e) => e.visibility === 'hidden')).toBe(true);
    // The same Draft and stream give the same next Draft.
    expect(runTick(draft).output.state).toEqual(output.state);
  });

  it('doubles a detected Asset: the hidden flip and the Chickenfeed pool it feeds back', () => {
    const fact: Proposition = {
      id: 'prop:project-test/chickenfeed',
      subject: OTHER,
      predicate: 'MEETS_AT',
      object: ASSET,
      place: LOC,
    };
    const draft = withCertainDetection(
      withDoctrine(staged([assetRel(ASSET, { exposure: 1 })]), {
        riskTolerance: 1,
        securityConsciousness: 0.5,
        deceptionAppetite: 0.5,
      }),
    );

    const { output, result } = runTick(draft, { truth: truthWith([fact]) });

    expect(result.doublings.map((d) => d.npc)).toEqual([ASSET]);
    const asset = output.state.relationships[ASSET].asset;
    expect(
      asset === undefined ? undefined : revealTruth(asset.hostileControlled),
    ).toBe(true);
    expect(output.state.hostile.chickenfeed?.[ASSET]).toEqual([fact]);
    expect(output.state.npcs[ASSET].status).toEqual(BASE.npcs[ASSET].status);
  });

  it('burns a player whose Cover Suspicion is at the burn threshold after the tick', () => {
    const exposed = staged([], {
      player: {
        ...BASE.player,
        coverSuspicion: asTruth(0.85),
        tailed: asTruth(false),
      },
    });
    const burned = runTick(exposed).output.state.player;
    expect(burned.burned).toBe(true);
    expect(revealTruth(burned.tailed)).toBe(true);

    const quiet = staged([], {
      player: {
        ...BASE.player,
        coverSuspicion: asTruth(0.1),
        tailed: asTruth(false),
      },
    });
    const free = runTick(quiet).output.state.player;
    expect(free.burned).toBe(false);
    expect(revealTruth(free.tailed)).toBe(false);
    expect(revealTruth(free.coverSuspicion)).toBe(0.1);
  });
});

// ---------------------------------------------------------------------------
// applyFullTick: comms traffic and newspaper plants
// ---------------------------------------------------------------------------

describe('applyFullTick — comms traffic and plants', () => {
  it('mints the Hostile Service traffic into transmissions for the intercept action', () => {
    const hostileOrg = Object.values(BASE.orgs).find(
      (org) => org.kind === 'hostile',
    )?.id;
    const channel = Object.values(BASE.channels)
      .filter((c) => isInterceptableKind(c.kind))
      .find(
        (c) =>
          c.owner === hostileOrg ||
          BASE.npcs[c.owner as NpcId]?.org === hostileOrg,
      );
    if (channel === undefined) {
      throw new Error(
        'the generated world has no Hostile Service signal Channel',
      );
    }
    const fireDay = [1, 2, 3, 4, 5, 6].find((d) =>
      transmissionTimes(channel.schedule, d).some((t) => t.day === d),
    );
    if (fireDay === undefined) {
      throw new Error(
        'the Hostile Service Channel does not fire in the first week',
      );
    }

    const draft = staged([]);
    const { projection, output, result, scratch, ctx } = runTick(draft, {
      day: fireDay,
    });

    const firings =
      projection.inputs.commsChannels?.[channel.id as ChannelId]?.firings ?? [];
    expect(firings.length).toBeGreaterThan(0);
    const minted = output.state.transmissions.slice(draft.transmissions.length);
    expect(minted).toHaveLength(result.commsTraffic.length);
    expect(minted.length).toBeGreaterThanOrEqual(firings.length);
    for (const tx of minted) {
      expect(tx.intercept.id.startsWith('int:')).toBe(true);
      expect(revealTruth(tx.origin)).toBe('deception');
    }
    expect(minted.map((tx) => tx.channel)).toContain(channel.id);
    // Not collected: the intercept action delivers them.
    expect(output.state.intercepts).toEqual(draft.intercepts);
    // The same firing is never minted twice.
    const again = applyFullTick(output.state, result, scratch, ctx);
    expect(again.state.transmissions).toHaveLength(
      output.state.transmissions.length,
    );
  });

  it('plants a false sighting of a Station-known NPC in the scratch for the newspaper', () => {
    const knows: Proposition = {
      id: 'prop:project-test/knows',
      subject: BASE.station.org,
      predicate: 'KNOWS',
      object: OTHER,
    };
    const adopted = adoptBelief(BASE.hostile.beliefs, knows).beliefs;
    const draft = withDoctrine(
      staged([], { hostile: { ...BASE.hostile, beliefs: adopted } }),
      { riskTolerance: 0.5, securityConsciousness: 0.5, deceptionAppetite: 1 },
    );

    const { projection, scratch } = runTick(draft);

    const candidate = projection.inputs.plantCandidates?.[`plant:${OTHER}`];
    expect(candidate).toBeDefined();
    const prop = candidate?.proposition;
    expect(prop?.subject).toBe(OTHER);
    expect(prop?.predicate).toBe('LOCATED_AT');
    const place = prop?.place;
    expect(
      place === undefined ? false : BASE.city.locations[place].public,
    ).toBe(true);
    for (let phase = 0; phase < 4; phase += 1) {
      expect(
        scheduledLocationAt(BASE.npcs[OTHER], {
          day: DAY,
          phase: phase as Phase,
        }),
      ).not.toBe(place);
    }
    expect(prop === undefined ? true : TRUTH.holds(prop, boundary(DAY))).toBe(
      false,
    );
    expect(
      scratch.newspaperPlants.some((item) =>
        item.asserts.includes(prop as Proposition),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// projectFullTick — the remaining input-table rows (task 4.3)
// ---------------------------------------------------------------------------

describe('projectFullTick — input rows: chickenfeed and commitments', () => {
  it('projects each Asset chickenfeed from the Truth Store facts in its access, with no reliability draw (input row: chickenfeed)', () => {
    // A fact about OTHER, who is in ASSET's access, dated after the game start
    // so `factsSinceLastReport` keeps it for an Asset that has never reported.
    const fact: Proposition = {
      id: 'prop:project-test/chickenfeed-input',
      subject: OTHER,
      predicate: 'MEETS_AT',
      object: ASSET,
      place: LOC,
      window: { from: { day: DAY - 1, phase: 0 } },
    };
    const draft = staged([assetRel(ASSET)]);

    const { inputs: projected } = projectFullTick(draft, DAY, newDayScratch(), {
      truth: truthWith([fact]),
    });

    // The candidate's chickenfeed pool is the in-access fact, as a bare
    // ChickenfeedCandidate with no reliability field.
    expect(projected.chickenfeed?.[ASSET]).toEqual([{ prop: fact }]);
  });

  it('projects each Asset commitments: accepted meetings and the player drops it should load (input row: commitments)', () => {
    const meetingId = 'meeting:project-test/commit' as const;
    const dropId = 'drop:project-test/commit' as const;
    const draft = staged([assetRel(ASSET)], {
      meetings: {
        ...BASE.meetings,
        [meetingId]: {
          id: meetingId,
          npc: ASSET,
          at: LOC,
          slot: { day: DAY + 1, phase: 1 },
          status: 'accepted',
          acceptance: 0.9,
        },
      },
      deadDrops: {
        ...BASE.deadDrops,
        [dropId]: {
          id: dropId,
          loc: LOC,
          owner: BASE.station.org,
          expectedLoader: ASSET,
          contents: [],
        },
      },
      player: {
        ...BASE.player,
        known: {
          ...BASE.player.known,
          drops: [...BASE.player.known.drops, dropId],
        },
      },
    });

    const { inputs: projected } = projectFullTick(draft, DAY, newDayScratch(), {
      truth: TRUTH,
    });

    expect(projected.commitments?.[ASSET]).toEqual({
      npc: ASSET,
      pendingMeetings: [{ meeting: meetingId, slot: { day: DAY + 1, phase: 1 } }],
      pendingDrops: [{ drop: dropId }],
    });
  });
});

// ---------------------------------------------------------------------------
// applyFullTick — the remaining output-table rows (task 4.3)
// ---------------------------------------------------------------------------

describe('applyFullTick — output rows: plot adaptation and compromised channels', () => {
  it('adapts the Plot and raises Abort Pressure from a newly adopted belief about a Cell member, and writes it to draft.plot (output row: plot)', () => {
    // A due belief plant that the Station suspects the Plot leader (a Cell
    // member) drives step-5 adaptation: the Plot gains Abort Pressure and a
    // hidden `plot-adapted` event, and applyFullTick writes the adapted Plot.
    const leader = revealTruth(BASE.plot.leader);
    const planted: Proposition = {
      id: 'prop:project-test/suspects-leader',
      subject: BASE.station.org,
      predicate: 'SUSPECTS',
      object: leader,
    };
    const plant: SimEvent = {
      id: 'event:belief-plant:project-test/leader',
      at: boundary(DAY),
      visibility: 'hidden',
      kind: 'belief-plant',
      prop: planted,
      by: ASSET,
    };
    const draft = staged([], { scheduled: [plant] });

    const { output, result } = runTick(draft);

    expect(result.plot?.abortPressure).toBe(BASE.plot.abortPressure + 1);
    expect(
      result.events.some(
        (e) => e.kind === 'plot-adapted' && e.change === `reroute:cell-member:${leader}`,
      ),
    ).toBe(true);
    expect(output.state.plot.abortPressure).toBe(BASE.plot.abortPressure + 1);
  });

  it('marks a Plot Channel compromised from a credible feed and writes it to next.beliefs.compromisedChannels (output row: compromisedChannels)', () => {
    // A plot-owned Channel the Station is fed as knowing about. The item is
    // unverifiable (the service neither confirms nor refutes it), so with a low
    // adoption threshold (securityConsciousness 0) and a high prior trust the
    // service adopts it and marks the Channel compromised.
    const plotChannel = (Object.values(BASE.channels).find(
      (c) => c.owner === 'org:cell',
    )?.id ?? Object.keys(BASE.channels)[0]) as ChannelId;
    const knows: Proposition = {
      id: 'prop:project-test/station-knows-channel',
      subject: BASE.station.org,
      predicate: 'KNOWS',
      object: plotChannel,
    };
    const feedEvent: SimEvent = {
      id: 'event:feed-delivered:project-test/channel',
      at: { day: DAY, phase: 1 },
      visibility: 'hidden',
      kind: 'feed-delivered',
      agent: ASSET,
      props: [knows],
    };
    const draft = withDoctrine(
      staged([assetRel(ASSET)], { scheduled: [feedEvent] }),
      { riskTolerance: 0.5, securityConsciousness: 0, deceptionAppetite: 0 },
    );

    const { output, result } = runTick(draft, { truth: TRUTH });

    expect(result.compromisedChannels).toContain(plotChannel);
    expect(output.state.hostile.beliefs.compromisedChannels).toContain(
      plotChannel,
    );
  });
});

describe('applyFullTick — output row: next (the service state)', () => {
  it('writes the tick result into hostile, keeping the Draft hostile fields it does not set (output row: next)', () => {
    const draft = staged([assetRel(ASSET)]);
    const { output, result } = runTick(draft);

    // next → hostile: beliefs, credibility, agent suspicion, adopted and
    // compromised channels all come from the tick's result.
    expect(output.state.hostile.beliefs).toEqual(result.next.beliefs);
    expect(output.state.hostile.doctrine).toEqual(result.next.doctrine);
    // The Draft's own hostile fields (the doctrine, here) are preserved.
    expect(output.state.hostile.doctrine).toEqual(draft.hostile.doctrine);
  });
});

// ---------------------------------------------------------------------------
// The four documented deviations from the design text (task 4.3)
// ---------------------------------------------------------------------------

describe('documented deviations from the design', () => {
  it('deviation 1: comms traffic goes to transmissions only, leaving intercepts for the intercept action to collect', () => {
    // Find a Hostile Channel that fires in the first week, as the smoke test does.
    const hostileOrg = Object.values(BASE.orgs).find(
      (org) => org.kind === 'hostile',
    )?.id;
    const channel = Object.values(BASE.channels)
      .filter((c) => isInterceptableKind(c.kind))
      .find(
        (c) =>
          c.owner === hostileOrg ||
          BASE.npcs[c.owner as NpcId]?.org === hostileOrg,
      );
    if (channel === undefined) {
      throw new Error('the generated world has no Hostile Service signal Channel');
    }
    const fireDay = [1, 2, 3, 4, 5, 6].find((d) =>
      transmissionTimes(channel.schedule, d).some((t) => t.day === d),
    );
    if (fireDay === undefined) {
      throw new Error('the Hostile Service Channel does not fire in the first week');
    }
    const draft = staged([]);
    const { output } = runTick(draft, { day: fireDay });

    // The traffic is appended to transmissions...
    expect(output.state.transmissions.length).toBeGreaterThan(
      draft.transmissions.length,
    );
    // ...and intercepts (the player's collected set) is left unchanged.
    expect(output.state.intercepts).toEqual(draft.intercepts);
  });

  it('deviation 2: feeds and belief plants are due when at.day <= day, and exactly the delivered events leave scheduled', () => {
    const planted: Proposition = {
      id: 'prop:project-test/dev2-plant',
      subject: BASE.station.org,
      predicate: 'SUSPECTS',
      object: OTHER,
    };
    const overduePlant: SimEvent = {
      id: 'event:belief-plant:project-test/overdue',
      at: { day: DAY - 1, phase: 3 },
      visibility: 'hidden',
      kind: 'belief-plant',
      prop: planted,
      by: ASSET,
    };
    const laterPlant: SimEvent = {
      id: 'event:belief-plant:project-test/later',
      at: { day: DAY + 1, phase: 0 },
      visibility: 'hidden',
      kind: 'belief-plant',
      prop: { ...planted, id: 'prop:project-test/dev2-later' },
      by: ASSET,
    };
    const draft = staged([], { scheduled: [overduePlant, laterPlant] });

    // Projection: the overdue (at.day < day) plant is delivered; the later one is not.
    const { inputs: projected } = projectFullTick(draft, DAY, newDayScratch(), {});
    expect(projected.newlyAdopted).toEqual([planted]);

    // Application: exactly the delivered (due-by) event leaves scheduled.
    const { output } = runTick(draft);
    expect(output.state.scheduled).toEqual([laterPlant]);
  });

  it('deviation 3: a voided drop keeps its expectedLoader after the Asset is arrested', () => {
    const dropId = 'drop:project-test/dev3' as const;
    const meetingId = 'meeting:project-test/dev3' as const;
    const draft = withCertainDetection(
      withDoctrine(
        staged([assetRel(ASSET, { exposure: 1 })], {
          whereabouts: { ...BASE.whereabouts, [ASSET]: LOC },
          deadDrops: {
            ...BASE.deadDrops,
            [dropId]: {
              id: dropId,
              loc: LOC,
              owner: BASE.station.org,
              expectedLoader: ASSET,
              contents: [],
            },
          },
          meetings: {
            ...BASE.meetings,
            [meetingId]: {
              id: meetingId,
              npc: ASSET,
              at: LOC,
              slot: { day: DAY + 1, phase: 1 },
              status: 'accepted',
              acceptance: 0.9,
            },
          },
          player: {
            ...BASE.player,
            known: {
              ...BASE.player.known,
              drops: [...BASE.player.known.drops, dropId],
            },
          },
        }),
        { riskTolerance: 0, securityConsciousness: 0.5, deceptionAppetite: 0 },
      ),
    );

    const { output, result } = runTick(draft);

    // The Asset is arrested and its meeting voided...
    expect(
      result.events.some((e) => e.kind === 'asset-arrested' && e.npc === ASSET),
    ).toBe(true);
    expect(output.state.meetings[meetingId].status).toBe('void');
    // ...but the drop keeps naming the arrested Asset, so the Phase Step can
    // raise `drop-unserviced` and clear it.
    expect(output.state.deadDrops[dropId].expectedLoader).toBe(ASSET);
  });

  it('deviation 4: a candidate with only a Station arrest record stays in play; a custodial/arrested/fled Asset does not', () => {
    const released = assetRel(TURNED, {
      custody: { by: 'station', since: boundary(1), until: boundary(2) },
    });
    const held = assetRel(OTHER, {
      custody: { by: 'station', since: boundary(DAY), until: boundary(DAY + 1) },
    });
    const draft = staged([assetRel(ASSET), released, held], {
      // The Station's arrest record names TURNED, but it is not in custody now.
      player: { ...BASE.player, arrests: [TURNED] },
    });

    const { candidates } = projectFullTick(draft, DAY, newDayScratch(), {
      truth: TRUTH,
    });
    const npcs = candidates.map((c) => c.npc).sort();

    // ASSET and TURNED are in play; the still-held OTHER is out.
    expect(npcs).toEqual([ASSET, TURNED].sort());
  });
});

// ---------------------------------------------------------------------------
// suspectedApproaches survives the project → dailyTickFull → apply round trip
// (task 3.2's extra check)
// ---------------------------------------------------------------------------

describe('hostile.beliefs.suspectedApproaches round trip', () => {
  it('survives a full project → dailyTickFull → apply round trip', () => {
    const draft = staged([], {
      hostile: {
        ...BASE.hostile,
        beliefs: {
          ...BASE.hostile.beliefs,
          suspectedApproaches: [OTHER],
        },
      },
    });

    const { output } = runTick(draft);

    expect(output.state.hostile.beliefs.suspectedApproaches).toEqual([OTHER]);
  });
});
