/**
 * Feature: slice-integration, Property 50: Disruption context agrees with state.
 *
 * **Validates: Requirements 4.2, 4.3, 4.4**
 *
 * The design states (slice-integration design, "Property 50: Disruption context
 * agrees with state"): for any reachable state, `liveDisruption(state)`'s
 * predicates agree with the Draft — `isArrested(n)` holds exactly when NPC *n*
 * is out of play by the records Req 4.2 names, `isChannelCompromised(c)` exactly
 * when `c ∈ hostile.beliefs.compromisedChannels` (Req 4.3), and
 * `isMaterielSeized()` exactly when `plot.materielSeized` holds (Req 4.4).
 *
 * The slice design's Property statement names the headline records (arrested,
 * fled, Station Custody); the implementation (task 4.1) widens `isArrested`
 * from Req 4.2 to the full standing-record set: an NPC is arrested when
 *
 *  - their status is `arrested` or `fled`, OR
 *  - a hold is still running — Station Custody not yet handed over, or a
 *    running Hostile Service hold (a `hostile` custody with no `until`, or one
 *    whose `until` has not yet come), OR
 *  - the Station's arrest record (`player.arrests`) names them, by NPC id or by
 *    the player's `unk:` id for them (`player.unkIds`), since an arrest may
 *    target an Unidentified Subject and the record outlives the custody hold.
 *
 * ## Shape of the check
 *
 * Over a single core-pack world, an arbitrary independently sets, for a sampled
 * subset of NPCs: a status (`active`/`arrested`/`fled`), a custody record
 * (`none`/`station` running/`station` expired/`hostile` running/`hostile`
 * expired), and membership in `player.arrests` (none/by-NPC-id/by-`unk:`-alias);
 * and independently a set of compromised Channels (drawn from the real Channels,
 * so both compromised and un-compromised ones are checked) and the
 * `materielSeized` flag.
 *
 * From the SAME toggles the test computes an independent reference oracle — read
 * straight from Req 4.2/4.3/4.4, never by calling `liveDisruption` — and asserts
 * that `liveDisruption(state)` agrees with it for every sampled NPC and Channel
 * and for the flag. The oracle reproduces the running-vs-expired distinction for
 * both holders (a running hold counts; an expired one does not; but the arrest
 * RECORD persists past custody) and the `unk:` alias arrest form, so the two
 * computations are a genuine cross-check rather than the same code twice.
 *
 * The core-pack load and the state builders mirror `disruption.spec.ts` (task
 * 4.1); the fast-check shape mirrors the sibling `*.property.spec.ts` files.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

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
import { generate, type GenerateInputs } from '../generate.js';
import {
  asTruth,
  timeToPhases,
  type ChannelId,
  type EntityId,
  type GameTime,
  type NpcId,
  type UnkId,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { NpcStatus } from '../city/npc.js';
import { newRelationship, type Custody } from '../recruit/asset.js';
import { liveDisruption } from './disruption.js';

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

const STANDARD = preset('standard');

function inputs(): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: STANDARD.id },
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
    preset: STANDARD,
    scenario,
    cityData,
    descriptors,
    publicTexts,
  };
}

const BASE: WorldState = generate('disruption-agreement-alpha', inputs());

const NPC_IDS: readonly NpcId[] = (Object.keys(BASE.npcs) as NpcId[]).sort();
const CHANNEL_IDS: readonly ChannelId[] = (
  Object.keys(BASE.channels) as ChannelId[]
).sort();

if (NPC_IDS.length < 3) {
  throw new Error('the generated world has fewer than three NPCs');
}
if (CHANNEL_IDS.length < 2) {
  throw new Error('the generated world has fewer than two Channels');
}

// The base time all cases start from, and two anchors relative to it: a time
// strictly before `BASE.time` (so a hold "expiring" there is already over) and
// one strictly after (a hold still running). Using fixed anchors keeps the
// running-vs-expired split unambiguous for both the oracle and the context.
const NOW: GameTime = BASE.time;
const PAST: GameTime = earlier(NOW, 2);
const FUTURE: GameTime = earlier(NOW, -4);

/** `at` moved back by `phases` (4 phases a day); negative moves forward. */
function earlier(at: GameTime, phases: number): GameTime {
  const total = at.day * 4 + at.phase - phases;
  const clamped = total < 0 ? 0 : total;
  return {
    day: Math.floor(clamped / 4),
    phase: (clamped % 4) as GameTime['phase'],
  };
}

// ---------------------------------------------------------------------------
// Per-NPC toggles: status, custody record, arrest-record membership
// ---------------------------------------------------------------------------

type StatusToggle = 'active' | 'arrested' | 'fled';

type CustodyToggle =
  | 'none'
  | 'station-running'
  | 'station-expired'
  | 'hostile-running'
  | 'hostile-expired';

type ArrestToggle = 'none' | 'by-id' | 'by-alias';

interface NpcToggle {
  readonly status: StatusToggle;
  readonly custody: CustodyToggle;
  readonly arrest: ArrestToggle;
}

/** The custody record a toggle maps to, or undefined for `none`. */
function custodyFor(toggle: CustodyToggle): Custody | undefined {
  switch (toggle) {
    case 'none':
      return undefined;
    case 'station-running':
      return { by: 'station', since: PAST, until: FUTURE };
    case 'station-expired':
      return { by: 'station', since: PAST, until: PAST };
    case 'hostile-running':
      // No `until`: an open-ended hold, always running.
      return { by: 'hostile', since: PAST };
    case 'hostile-expired':
      return { by: 'hostile', since: PAST, until: PAST };
  }
}

/** Whether a custody toggle is a hold still running at {@link NOW}. */
function custodyHoldsAtNow(toggle: CustodyToggle): boolean {
  switch (toggle) {
    case 'none':
      return false;
    case 'station-running':
    case 'hostile-running':
      return true;
    case 'station-expired':
    case 'hostile-expired':
      // `until === PAST`, and `now = NOW > PAST`, so `timeToPhases(now) <
      // timeToPhases(until)` is false — the hold is over.
      return timeToPhases(NOW) < timeToPhases(PAST);
  }
}

// ---------------------------------------------------------------------------
// Reference oracle — read straight from Req 4.2 / 4.3 / 4.4
// ---------------------------------------------------------------------------

/**
 * The expected `isArrested(npc)` for `toggle`, computed independently of
 * {@link liveDisruption} from the records Req 4.2 names:
 *
 *   out of play by status  OR  a hold runs now  OR  in the arrest record.
 *
 * The arrest record persists regardless of the custody toggle, so an expired
 * hold with the NPC still in `player.arrests` is arrested; an expired hold with
 * no record is not.
 */
function oracleArrested(toggle: NpcToggle): boolean {
  const byStatus = toggle.status === 'arrested' || toggle.status === 'fled';
  const byHold = custodyHoldsAtNow(toggle.custody);
  const byRecord = toggle.arrest !== 'none';
  return byStatus || byHold || byRecord;
}

// ---------------------------------------------------------------------------
// Build the state from a sampled set of toggles
// ---------------------------------------------------------------------------

/** The `unk:` alias this test assigns to the `n`-th sampled NPC. */
function aliasFor(index: number): UnkId {
  return `unk:${index}`;
}

/**
 * Apply the sampled per-NPC toggles and the Channel/materiel toggles to
 * {@link BASE}, returning the state and the arrest-record entries the oracle
 * expects to find. Each NPC's status, custody and arrest membership are set
 * independently; the arrest `by-alias` form also records the NPC's `unk:` id.
 */
function buildState(
  toggles: ReadonlyMap<NpcId, NpcToggle>,
  compromised: readonly ChannelId[],
  materielSeized: boolean,
): WorldState {
  const npcs = { ...BASE.npcs };
  const relationships = { ...BASE.relationships };
  const unkIds = { ...BASE.player.unkIds };
  const arrests: EntityId[] = [];

  let aliasSeq = 1;
  for (const [npc, toggle] of toggles) {
    npcs[npc] = { ...BASE.npcs[npc], status: asTruth<NpcStatus>(toggle.status) };

    const custody = custodyFor(toggle.custody);
    const rel = relationships[npc] ?? newRelationship(npc);
    relationships[npc] = custody === undefined ? rel : { ...rel, custody };

    if (toggle.arrest === 'by-id') {
      arrests.push(npc);
    } else if (toggle.arrest === 'by-alias') {
      const alias = aliasFor(aliasSeq);
      aliasSeq += 1;
      unkIds[npc] = alias;
      arrests.push(alias);
    }
  }

  return {
    ...BASE,
    time: NOW,
    npcs,
    relationships,
    plot: { ...BASE.plot, materielSeized },
    hostile: {
      ...BASE.hostile,
      beliefs: {
        ...BASE.hostile.beliefs,
        compromisedChannels: [...compromised],
      },
    },
    player: { ...BASE.player, unkIds, arrests },
  };
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const RUNS = 200;

const statusArb: fc.Arbitrary<StatusToggle> = fc.constantFrom(
  'active',
  'arrested',
  'fled',
);

const custodyArb: fc.Arbitrary<CustodyToggle> = fc.constantFrom(
  'none',
  'station-running',
  'station-expired',
  'hostile-running',
  'hostile-expired',
);

const arrestArb: fc.Arbitrary<ArrestToggle> = fc.constantFrom(
  'none',
  'by-id',
  'by-alias',
);

const npcToggleArb: fc.Arbitrary<NpcToggle> = fc.record({
  status: statusArb,
  custody: custodyArb,
  arrest: arrestArb,
});

/**
 * A sampled subset of NPCs (always non-empty, to keep the per-NPC assertion
 * meaningful) each with an independent toggle. NPCs not in the subset are left
 * at their generated defaults.
 */
const togglesArb: fc.Arbitrary<ReadonlyMap<NpcId, NpcToggle>> = fc
  .uniqueArray(fc.constantFrom(...NPC_IDS), {
    minLength: 1,
    maxLength: NPC_IDS.length,
  })
  .chain((chosen) =>
    fc
      .tuple(...chosen.map(() => npcToggleArb))
      .map(
        (toggleList) =>
          new Map(chosen.map((npc, i) => [npc, toggleList[i]] as const)),
      ),
  );

/** A subset of the real Channels marked compromised. May be empty. */
const compromisedArb: fc.Arbitrary<readonly ChannelId[]> = fc.uniqueArray(
  fc.constantFrom(...CHANNEL_IDS),
  { maxLength: CHANNEL_IDS.length },
);

const caseArb = fc.record({
  toggles: togglesArb,
  compromised: compromisedArb,
  materielSeized: fc.boolean(),
});

// ---------------------------------------------------------------------------
// Property 50 (Req 4.2, 4.3, 4.4)
// ---------------------------------------------------------------------------

describe('Property 50: Disruption context agrees with state', () => {
  it('isArrested agrees with the arrest oracle for every sampled NPC (Req 4.2)', () => {
    fc.assert(
      fc.property(caseArb, ({ toggles, compromised, materielSeized }) => {
        const state = buildState(toggles, compromised, materielSeized);
        const ctx = liveDisruption(state);
        for (const [npc, toggle] of toggles) {
          expect(ctx.isArrested(npc)).toBe(oracleArrested(toggle));
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('isChannelCompromised agrees with membership for every real Channel (Req 4.3)', () => {
    fc.assert(
      fc.property(caseArb, ({ toggles, compromised, materielSeized }) => {
        const state = buildState(toggles, compromised, materielSeized);
        const ctx = liveDisruption(state);
        const expected = new Set<ChannelId>(compromised);
        // Checks both compromised and un-compromised Channels: every real
        // Channel is asserted, so a Channel absent from the set must read false.
        for (const channel of CHANNEL_IDS) {
          expect(ctx.isChannelCompromised(channel)).toBe(expected.has(channel));
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('isMaterielSeized agrees with the plot flag (Req 4.4)', () => {
    fc.assert(
      fc.property(caseArb, ({ toggles, compromised, materielSeized }) => {
        const state = buildState(toggles, compromised, materielSeized);
        expect(liveDisruption(state).isMaterielSeized()).toBe(materielSeized);
      }),
      { numRuns: RUNS },
    );
  });
});
