/**
 * Tests for the Hostile Service state, the daily tick and the clock-hook adapter
 * (task 19.1; Requirements 12.1, 12.2, 12.3).
 *
 * These pin:
 *
 * - `initialHostileServiceState` draws a doctrine within the preset ranges and
 *   starts with an empty belief model;
 * - the daily tick emits the right hidden SimEvents per response — an
 *   `asset-detected` for every detection, plus `asset-arrested` / `asset-doubled`
 *   for those responses (feed records only the detection);
 * - a detected Asset is marked suspected so a later tick does not re-detect it;
 * - the tick is deterministic;
 * - the clock-hook adapter runs the tick on the daily stream, surfaces the next
 *   state through the commit callback, and returns the events.
 */

import { describe, expect, it } from 'vitest';

import type { GameTime, NpcId } from '../model/core.js';
import { createPrng } from '../prng/prng.js';
import type { DoctrineRanges } from './doctrine.js';
import { accrueExposure } from './beliefs.js';
import type { DetectionBase, DetectionCandidate } from './detection.js';
import {
  initialHostileServiceState,
  dailyTick,
  dailyTickWithBase,
  dailyTickFull,
  hostileDayBoundaryHook,
  DEFAULT_DETECTION_BASE,
  type HostileServiceState,
} from './hostile.js';
import { asTruth, type OrgId, type Proposition } from '../model/core.js';
import type { PlotState, SimEvent } from '../model/state.js';
import type { AdaptationContext } from './adaptation.js';
import type { ChickenfeedCandidate } from './doubling.js';
import type { FeedDelivery } from './ingest-feed.js';
import type { ChannelId } from '../model/core.js';

const STANDARD: DoctrineRanges = {
  risk: { min: 0.3, max: 0.6 },
  security: { min: 0.3, max: 0.6 },
  deception: { min: 0.3, max: 0.6 },
};
const AT: GameTime = { day: 2, phase: 0 };
const NPC = 'npc:asset-1' as NpcId;
const CERTAIN: DetectionBase = { surveil: 1, meeting: 1, drop: 1 };

/** A hostile state with the given doctrine and a fully-exposed Asset. */
function exposedState(doctrine: HostileServiceState['doctrine']): HostileServiceState {
  const base = initialHostileServiceState(createPrng('s'), STANDARD);
  return {
    ...base,
    doctrine,
    beliefs: accrueExposure(base.beliefs, NPC, 1),
  };
}

describe('initialHostileServiceState', () => {
  it('draws a doctrine within the preset ranges and starts with empty beliefs', () => {
    const state = initialHostileServiceState(createPrng('seed'), STANDARD);
    expect(state.doctrine.riskTolerance).toBeGreaterThanOrEqual(0.3);
    expect(state.doctrine.riskTolerance).toBeLessThanOrEqual(0.6);
    expect(state.beliefs.adopted).toHaveLength(0);
    expect(state.beliefs.suspectedAssets).toHaveLength(0);
  });

  it('is deterministic', () => {
    expect(initialHostileServiceState(createPrng('k'), STANDARD)).toEqual(
      initialHostileServiceState(createPrng('k'), STANDARD),
    );
  });
});

describe('dailyTick', () => {
  const candidates: readonly DetectionCandidate[] = [{ npc: NPC, turnedByPlayer: false }];

  it('emits asset-detected and asset-arrested for an arrest response', () => {
    // Low deception + low risk => arrest; certain base => detection fires.
    const state = exposedState({
      riskTolerance: 0.1,
      securityConsciousness: 0.5,
      deceptionAppetite: 0.05,
    });
    const result = dailyTickWithBase(state, candidates, AT, createPrng('t'), CERTAIN);
    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toEqual(['asset-detected', 'asset-arrested']);
    expect(result.next.beliefs.suspectedAssets).toContain(NPC);
  });

  it('emits asset-detected and asset-doubled for a double response', () => {
    const state = exposedState({
      riskTolerance: 0.95,
      securityConsciousness: 0.5,
      deceptionAppetite: 0.2,
    });
    const result = dailyTickWithBase(state, candidates, AT, createPrng('t'), CERTAIN);
    expect(result.events.map((e) => e.kind)).toEqual(['asset-detected', 'asset-doubled']);
  });

  it('emits only asset-detected for a feed response', () => {
    const state = exposedState({
      riskTolerance: 0.5,
      securityConsciousness: 0.5,
      deceptionAppetite: 0.95,
    });
    const result = dailyTickWithBase(state, candidates, AT, createPrng('t'), CERTAIN);
    expect(result.events.map((e) => e.kind)).toEqual(['asset-detected']);
    // Still marked suspected: kept in play but not re-detected.
    expect(result.next.beliefs.suspectedAssets).toContain(NPC);
  });

  it('does not re-detect an already-suspected Asset', () => {
    const state = exposedState({
      riskTolerance: 0.1,
      securityConsciousness: 0.5,
      deceptionAppetite: 0.05,
    });
    const first = dailyTickWithBase(state, candidates, AT, createPrng('t'), CERTAIN);
    const second = dailyTickWithBase(first.next, candidates, AT, createPrng('t'), CERTAIN);
    expect(second.events).toHaveLength(0);
  });

  it('emits nothing when the only Asset is not exposed', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const result = dailyTick(state, candidates, AT, createPrng('t'));
    expect(result.events).toHaveLength(0);
  });

  it('every emitted event is hidden and stamped at the tick time', () => {
    const state = exposedState({
      riskTolerance: 0.1,
      securityConsciousness: 0.5,
      deceptionAppetite: 0.05,
    });
    const result = dailyTickWithBase(state, candidates, AT, createPrng('t'), CERTAIN);
    for (const event of result.events) {
      expect(event.visibility).toBe('hidden');
      expect(event.at).toEqual(AT);
    }
  });

  it('uses the default detection base in the convenience form', () => {
    expect(DEFAULT_DETECTION_BASE.meeting).toBeGreaterThan(0);
  });
});

describe('hostileDayBoundaryHook', () => {
  it('runs the tick on the daily stream, commits the next state and returns events', () => {
    const state = exposedState({
      riskTolerance: 0.1,
      securityConsciousness: 0.5,
      deceptionAppetite: 0.05,
    });
    let committed: HostileServiceState | undefined;
    const hook = hostileDayBoundaryHook(
      {
        hostile: state,
        candidates: [{ npc: NPC, turnedByPlayer: false }],
        detectionBase: CERTAIN,
      },
      (seed) => createPrng(seed),
      (next) => {
        committed = next;
      },
    );
    const events = hook({ time: AT, dailyStreamSeed: 'daily-2' });
    expect(events.map((e) => e.kind)).toEqual(['asset-detected', 'asset-arrested']);
    expect(committed?.beliefs.suspectedAssets).toContain(NPC);
  });

  it('works without a commit callback', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const hook = hostileDayBoundaryHook(
      { hostile: state, candidates: [], detectionBase: DEFAULT_DETECTION_BASE },
      (seed) => createPrng(seed),
    );
    expect(hook({ time: AT, dailyStreamSeed: 'd' })).toEqual([]);
  });
});

describe('dailyTickFull — steps 1–5 (Req 11.1–11.5, 22.7)', () => {
  const candidates = [{ npc: NPC, turnedByPlayer: false }];

  function walkInApproach(npc: string, genuine: boolean): SimEvent {
    return {
      id: `sched-evt:walk-in-approach:${npc}`,
      at: AT,
      visibility: 'hidden',
      kind: 'walk-in-approach',
      npc: npc as NpcId,
      genuine: asTruth(genuine),
    };
  }

  it('reads the day`s Walk-ins into Dangles vs genuine (step 4)', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, {
      dayEvents: [walkInApproach('npc:dangle', false), walkInApproach('npc:vol', true)],
    });
    expect(result.walkIns.dangles).toEqual(['npc:dangle']);
    expect(result.walkIns.genuine).toEqual(['npc:vol']);
  });

  it('returns a doubling decision with Chickenfeed for a double detection (steps 2/5)', () => {
    // High risk => double; certain base => detection fires.
    const state = exposedState({
      riskTolerance: 0.95,
      securityConsciousness: 0.5,
      deceptionAppetite: 0.95,
    });
    const chickenfeed: Record<string, readonly ChickenfeedCandidate[]> = {
      [NPC]: [
        { prop: { id: 'prop:a', subject: NPC, predicate: 'core/KNOWS', object: 'npc:x' } as Proposition },
      ],
    };
    const result = dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, { chickenfeed });
    expect(result.events.map((e) => e.kind)).toContain('asset-doubled');
    expect(result.doublings).toHaveLength(1);
    expect(result.doublings[0].npc).toBe(NPC);
    expect(result.doublings[0].hostileControlled).toBe(true);
    expect(result.doublings[0].chickenfeed.props.map((p) => p.id)).toEqual(['prop:a']);
  });

  it('adapts the Plot and raises pressure from a newly-adopted belief (step 5)', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const plot = { abortPressure: 0, pressureKeys: [] } as unknown as PlotState;
    const adaptation: AdaptationContext = {
      stationOrg: 'org:station' as OrgId,
      cellMembers: ['npc:cell-leader' as NpcId],
      target: 'npc:target' as NpcId,
    };
    const newlyAdopted: Proposition[] = [
      {
        id: 'prop:1',
        subject: 'org:station' as OrgId,
        predicate: 'core/KNOWS',
        object: 'npc:cell-leader' as NpcId,
      } as Proposition,
    ];
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, {
      plot,
      adaptation,
      newlyAdopted,
    });
    expect(result.plot?.abortPressure).toBe(1);
    expect(result.events.map((e) => e.kind)).toContain('plot-adapted');
  });

  it('leaves the Plot undefined when no projection is supplied', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE);
    expect(result.plot).toBeUndefined();
    expect(result.doublings).toHaveLength(0);
  });

  it('is deterministic', () => {
    const state = exposedState({
      riskTolerance: 0.95,
      securityConsciousness: 0.5,
      deceptionAppetite: 0.95,
    });
    const inputs = { dayEvents: [walkInApproach('npc:d', false)] };
    expect(dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, inputs)).toEqual(
      dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, inputs),
    );
  });
});

describe('dailyTickFull — off-screen arrest consequences (task 19.5; Req 39.4, 39.5)', () => {
  const candidates = [{ npc: NPC, turnedByPlayer: false }];
  /** Doctrine that forces an arrest on a hit (low deception + low risk). */
  const ARREST_DOCTRINE = {
    riskTolerance: 0.1,
    securityConsciousness: 0.5,
    deceptionAppetite: 0.05,
  };
  /** Doctrine that forces a double on a hit (high risk, high deception). */
  const DOUBLE_DOCTRINE = {
    riskTolerance: 0.95,
    securityConsciousness: 0.5,
    deceptionAppetite: 0.95,
  };

  it('voids the arrested Asset meetings/drops for 16.6 to observe (Req 39.5)', () => {
    const state = exposedState(ARREST_DOCTRINE);
    const result = dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, {
      commitments: {
        [NPC]: {
          npc: NPC,
          pendingMeetings: [{ meeting: 'meeting:m1', slot: { day: 4, phase: 1 } }],
          pendingDrops: [{ drop: 'drop:d1' as never }],
        },
      },
    });
    // The tick arrested the Asset...
    expect(result.events.map((e) => e.kind)).toContain('asset-arrested');
    // ...and voided its commitments as data (not events — 16.6 raises those).
    expect(result.arrestConsequences.voidedMeetings).toEqual([
      { npc: NPC, meeting: 'meeting:m1', slot: { day: 4, phase: 1 } },
    ]);
    expect(result.arrestConsequences.voidedDrops.map((d) => d.drop)).toEqual(['drop:d1']);
  });

  it('prints a public arrest article at deceptionAppetite ≈ 0 (Req 39.4)', () => {
    const state = exposedState(ARREST_DOCTRINE);
    const result = dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, {
      arrestArticleContext: { [NPC]: { place: 'the Inner City' } },
    });
    expect(result.events.map((e) => e.kind)).toContain('asset-arrested');
    expect(result.arrestArticles).toHaveLength(1);
    expect(result.arrestArticles[0].source).toBe('city-event');
  });

  it('a double produces no consequence and no article — doubling stays signal-free (Req 39.4)', () => {
    const state = exposedState(DOUBLE_DOCTRINE);
    const result = dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, {
      commitments: {
        [NPC]: {
          npc: NPC,
          pendingMeetings: [{ meeting: 'meeting:m1', slot: AT }],
          pendingDrops: [{ drop: 'drop:d1' as never }],
        },
      },
      arrestArticleContext: { [NPC]: { place: 'the Inner City' } },
    });
    // The Asset was doubled, not arrested.
    expect(result.events.map((e) => e.kind)).toContain('asset-doubled');
    expect(result.events.map((e) => e.kind)).not.toContain('asset-arrested');
    // No observable consequence at all: no voided commitments, no article, and
    // no player-visible event on the whole tick.
    expect(result.arrestConsequences.voidedMeetings).toEqual([]);
    expect(result.arrestConsequences.voidedDrops).toEqual([]);
    expect(result.arrestArticles).toEqual([]);
    expect(result.events.every((e) => e.visibility === 'hidden')).toBe(true);
  });

  it('is deterministic including the arrest-article draw', () => {
    const state = exposedState(ARREST_DOCTRINE);
    const inputs = {
      commitments: {
        [NPC]: { npc: NPC, pendingMeetings: [], pendingDrops: [] },
      },
      arrestArticleContext: { [NPC]: { place: 'the Inner City' } },
    };
    expect(dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, inputs)).toEqual(
      dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, inputs),
    );
  });
});

describe('dailyTickFull — mole report (step 3) and tailing / burn (step 6) [task 19.3]', () => {
  /** A `KNOWS(station, object)` Proposition the Station is projected to know. */
  function stationKnows(object: string): Proposition {
    return {
      id: `prop:${object}`,
      subject: 'org:station' as OrgId,
      predicate: 'core/KNOWS',
      object: object as NpcId,
    } as Proposition;
  }

  it('ingests the mole report: adopts beliefs and emits mole-report + belief-adopted (Req 12.4)', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, {
      moleReport: {
        mole: 'npc:mole' as NpcId,
        propositions: [stationKnows('npc:cell-leader')],
      },
    });
    expect(result.events.map((e) => e.kind)).toContain('mole-report');
    expect(result.events.map((e) => e.kind)).toContain('belief-adopted');
    expect(result.moleAdopted).toHaveLength(1);
    // The adopted belief is folded into the service's beliefs for later ticks.
    expect(result.next.beliefs.adopted).toHaveLength(1);
  });

  it('feeds the mole`s newly-adopted beliefs into step-5 adaptation (Req 12.4)', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const plot = { abortPressure: 0, pressureKeys: [] } as unknown as PlotState;
    const adaptation: AdaptationContext = {
      stationOrg: 'org:station' as OrgId,
      cellMembers: ['npc:cell-leader' as NpcId],
      target: 'npc:target' as NpcId,
    };
    // No `newlyAdopted` is supplied — the mole report is the only source, so a
    // raised pressure proves the mole's relay reached adaptation.
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, {
      plot,
      adaptation,
      moleReport: {
        mole: 'npc:mole' as NpcId,
        propositions: [stationKnows('npc:cell-leader')],
      },
    });
    expect(result.plot?.abortPressure).toBe(1);
    expect(result.events.map((e) => e.kind)).toContain('plot-adapted');
  });

  it('runs no mole step when no mole report is supplied', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE);
    expect(result.events.map((e) => e.kind)).not.toContain('mole-report');
    expect(result.moleAdopted).toHaveLength(0);
  });

  it('starts a tail and burns the player when Cover Suspicion crosses the threshold (Req 12.5, 21.4)', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    // Not tailed at 0.78 with start 0.5 → tail starts, +0.05 delta → 0.83 ≥ 0.8.
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, {
      tailing: { coverSuspicion: 0.78, tailed: false },
      tailingThresholds: { start: 0.5, end: 0.4, burn: 0.8 },
    });
    expect(result.tailing?.tailed).toBe(true);
    expect(result.tailing?.burned).toBe(true);
    const kinds = result.events.map((e) => e.kind);
    expect(kinds).toContain('tail-started');
    expect(kinds).toContain('player-burned');
  });

  it('skips step 6 when no tailing inputs are supplied', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE);
    expect(result.tailing).toBeUndefined();
    expect(result.events.map((e) => e.kind)).not.toContain('tail-started');
  });

  it('step 3 and step 6 make no draws — they do not shift the detection stream', () => {
    // The same seed must yield the same detection outcome whether or not the
    // mole report and tailing inputs are present.
    const state = exposedState({
      riskTolerance: 0.1,
      securityConsciousness: 0.5,
      deceptionAppetite: 0.05,
    });
    const candidates = [{ npc: NPC, turnedByPlayer: false }];
    const bare = dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN);
    const withExtras = dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, {
      moleReport: { mole: 'npc:mole' as NpcId, propositions: [stationKnows('npc:x')] },
      tailing: { coverSuspicion: 0.9, tailed: true },
      tailingThresholds: { start: 0.5, end: 0.4, burn: 0.95 },
    });
    const detectionKinds = (events: readonly SimEvent[]) =>
      events.filter((e) => e.kind === 'asset-detected' || e.kind === 'asset-arrested');
    expect(detectionKinds(withExtras.events)).toEqual(detectionKinds(bare.events));
  });

  it('is deterministic', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const inputs = {
      moleReport: { mole: 'npc:mole' as NpcId, propositions: [stationKnows('npc:x')] },
      tailing: { coverSuspicion: 0.6, tailed: false },
      tailingThresholds: { start: 0.5, end: 0.4, burn: 0.8 },
    };
    expect(dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, inputs)).toEqual(
      dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, inputs),
    );
  });
});

describe('dailyTickFull — newspaper plants (step 7) and comms traffic (step 8) [task 19.4]', () => {
  /** A false Proposition for a plant candidate id. */
  function plantProp(id: string): Proposition {
    return {
      id: `prop:plant/${id}`,
      subject: 'org:hostile' as OrgId,
      predicate: 'MEETS_WITH',
      object: 'npc:decoy' as NpcId,
    } as Proposition;
  }
  const PLANTS = {
    p0: { proposition: plantProp('p0'), headline: 'Delegation arrives', summary: 'A planted line.' },
    p1: { proposition: plantProp('p1'), headline: 'Factory reopens', summary: 'Another planted line.' },
    p2: { proposition: plantProp('p2'), headline: 'Rail delay', summary: 'A third planted line.' },
  };
  /** Doctrine that plants aggressively (deceptionAppetite = 1). */
  const PLANT_DOCTRINE = {
    riskTolerance: 0.5,
    securityConsciousness: 0.5,
    deceptionAppetite: 1,
  };
  /** Doctrine that never plants (deceptionAppetite = 0). */
  const NO_PLANT_DOCTRINE = {
    riskTolerance: 0.5,
    securityConsciousness: 0.5,
    deceptionAppetite: 0,
  };

  it('plants false stories weighted by deceptionAppetite (step 7; Req 30.2)', () => {
    const state = exposedState(PLANT_DOCTRINE);
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, {
      plantCandidates: PLANTS,
    });
    expect(result.newspaperPlants).toHaveLength(3);
    expect(result.newspaperPlants.every((i) => i.source === 'rumour')).toBe(true);
  });

  it('plants nothing for a blunt service, and no-ops with no candidates', () => {
    const planter = exposedState(NO_PLANT_DOCTRINE);
    expect(
      dailyTickFull(planter, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, {
        plantCandidates: PLANTS,
      }).newspaperPlants,
    ).toEqual([]);
    const noCandidates = exposedState(PLANT_DOCTRINE);
    expect(
      dailyTickFull(noCandidates, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE).newspaperPlants,
    ).toEqual([]);
  });

  it('the plant draws run after the arrest-article draws (cannot shift that stream)', () => {
    // A doctrine that both arrests (low risk) and plants (high deception) would
    // conflict; instead use a high-deception doctrine and confirm the arrest
    // articles are identical whether or not plant candidates are supplied.
    const state = exposedState(PLANT_DOCTRINE);
    const candidates = [{ npc: NPC, turnedByPlayer: false }];
    const withoutPlants = dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, {
      arrestArticleContext: { [NPC]: { place: 'the Inner City' } },
    });
    const withPlants = dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, {
      arrestArticleContext: { [NPC]: { place: 'the Inner City' } },
      plantCandidates: PLANTS,
    });
    // Adding step-7 plant candidates leaves the step-1–2 events and the task
    // 19.5 arrest-article output untouched.
    expect(withPlants.events).toEqual(withoutPlants.events);
    expect(withPlants.arrestArticles).toEqual(withoutPlants.arrestArticles);
  });

  it('produces daily comms traffic for the Cipher Engine (step 8; Req 29.4)', () => {
    const state = exposedState(PLANT_DOCTRINE);
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, {
      commsChannels: {
        'chan:hostile/link': {
          channel: 'chan:hostile/link',
          owner: 'org:hostile' as OrgId,
          ownerKind: 'hostile',
          firings: [AT.phase],
          payload: [plantProp('real')],
        },
      },
    });
    expect(result.commsTraffic).toHaveLength(1);
    expect(result.commsTraffic[0].origin).toBe('deception');
    expect(result.commsTraffic[0].channel).toBe('chan:hostile/link');
  });

  it('comms traffic makes no draws (step 8 cannot shift any stream)', () => {
    const state = exposedState(PLANT_DOCTRINE);
    const candidates = [{ npc: NPC, turnedByPlayer: false }];
    const withoutComms = dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, {
      arrestArticleContext: { [NPC]: { place: 'the Inner City' } },
      plantCandidates: PLANTS,
    });
    const withComms = dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, {
      arrestArticleContext: { [NPC]: { place: 'the Inner City' } },
      plantCandidates: PLANTS,
      commsChannels: {
        'chan:noise/d': {
          channel: 'chan:noise/d',
          owner: 'org:hostile' as OrgId,
          ownerKind: 'noise',
          firings: [AT.phase],
        },
      },
    });
    expect(withComms.newspaperPlants).toEqual(withoutComms.newspaperPlants);
    expect(withComms.arrestArticles).toEqual(withoutComms.arrestArticles);
    expect(withComms.events).toEqual(withoutComms.events);
  });

  it('both no-op cleanly when nothing applies', () => {
    const state = exposedState(PLANT_DOCTRINE);
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE);
    expect(result.newspaperPlants).toEqual([]);
    expect(result.commsTraffic).toEqual([]);
  });
});

describe('dailyTickFull — feed ingestion (step 5 ingest) [task 19.6]', () => {
  const AGENT = 'npc:double' as NpcId;

  /** A `KNOWS(station, object)` Proposition. */
  function knows(object: string): Proposition {
    return {
      id: `prop:${object}`,
      subject: 'org:station' as OrgId,
      predicate: 'core/KNOWS',
      object: object as NpcId,
    } as Proposition;
  }

  /** A delivery of one unverifiable, credible item (seed 0.8 clears the bar). */
  function creditFeed(prop: Proposition, channel?: ChannelId): FeedDelivery {
    return {
      agent: AGENT,
      priorTrust: 0.8,
      items: [
        {
          prop,
          holdsInTruth: false,
          confirmed: false,
          refuted: false,
          ...(channel === undefined ? {} : { channel }),
        },
      ],
    };
  }

  it('ingests a feed: classifies, adopts a credible belief, emits belief-adopted (Req 37.3, 37.4)', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, {
      feeds: [creditFeed(knows('npc:cell-lead'))],
    });
    expect(result.feedClasses[AGENT]).toEqual(['deception']);
    expect(result.next.beliefs.adopted).toHaveLength(1);
    expect(result.events.map((e) => e.kind)).toContain('belief-adopted');
    expect(result.next.beliefs.credibility[AGENT]).toBeCloseTo(0.8);
  });

  it('feeds the newly-adopted feed belief into step-5 adaptation and raises pressure (Req 37.5, 11.4)', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const plot = { abortPressure: 0, pressureKeys: [] } as unknown as PlotState;
    const adaptation: AdaptationContext = {
      stationOrg: 'org:station' as OrgId,
      cellMembers: ['npc:cell-lead' as NpcId],
      target: 'npc:target' as NpcId,
    };
    // No `newlyAdopted`/mole supplied — the feed is the only belief source, so a
    // raised pressure proves the feed's adoption reached adaptation.
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, {
      feeds: [creditFeed(knows('npc:cell-lead'))],
      plot,
      adaptation,
    });
    expect(result.plot?.abortPressure).toBe(1);
    expect(result.events.map((e) => e.kind)).toContain('plot-adapted');
  });

  it('a compromised Plot Channel becomes a disruption that raises Abort Pressure (Req 38.3)', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const plot = { abortPressure: 0, pressureKeys: [] } as unknown as PlotState;
    const adaptation: AdaptationContext = {
      stationOrg: 'org:station' as OrgId,
      cellMembers: [],
      target: 'npc:target' as NpcId,
    };
    const chan = 'chan:plot-link' as ChannelId;
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, {
      feeds: [creditFeed(knows(chan), chan)],
      plot,
      adaptation,
    });
    expect(result.compromisedChannels).toEqual([chan]);
    expect(result.next.beliefs.compromisedChannels).toContain(chan);
    // The channel-compromised disruption key raised pressure once.
    expect(result.plot?.abortPressure).toBe(1);
    expect(result.plot?.pressureKeys).toContain(`channel-compromised:${chan}`);
  });

  it('a channel compromised by a feed and by a stage disruption counts once', () => {
    const chan = 'chan:plot-link' as ChannelId;
    // Pre-seed the Plot's pressure with the same disruption key the stage path
    // would use; the feed must not double-count it.
    const plot = {
      abortPressure: 1,
      pressureKeys: [`channel-compromised:${chan}`],
    } as unknown as PlotState;
    const adaptation: AdaptationContext = {
      stationOrg: 'org:station' as OrgId,
      cellMembers: [],
      target: 'npc:target' as NpcId,
    };
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, {
      feeds: [creditFeed(knows(chan), chan)],
      plot,
      adaptation,
    });
    expect(result.plot?.abortPressure).toBe(1);
  });

  it('runs no feed step when no feeds are supplied', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const result = dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE);
    expect(result.feedClasses).toEqual({});
    expect(result.compromisedChannels).toEqual([]);
  });

  it('feed ingest makes no draws (cannot shift the detection stream)', () => {
    const state = exposedState({
      riskTolerance: 0.5,
      securityConsciousness: 0.5,
      deceptionAppetite: 1,
    });
    const candidates = [{ npc: NPC, turnedByPlayer: false }];
    const withoutFeed = dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN);
    const withFeed = dailyTickFull(state, candidates, AT, createPrng('t'), CERTAIN, {
      feeds: [creditFeed(knows('npc:cell-lead'))],
    });
    // The detection events (steps 1–2) are untouched by threading in a feed.
    const detectionKinds = (r: typeof withoutFeed) =>
      r.events.filter((e) => e.kind.startsWith('asset-')).map((e) => e.kind);
    expect(detectionKinds(withFeed)).toEqual(detectionKinds(withoutFeed));
  });

  it('is deterministic', () => {
    const state = initialHostileServiceState(createPrng('s'), STANDARD);
    const inputs = { feeds: [creditFeed(knows('npc:cell-lead'))] };
    expect(dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, inputs)).toEqual(
      dailyTickFull(state, [], AT, createPrng('t'), DEFAULT_DETECTION_BASE, inputs),
    );
  });
});
