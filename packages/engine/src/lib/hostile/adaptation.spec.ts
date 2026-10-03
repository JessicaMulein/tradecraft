/**
 * Tests for belief-driven Plot adaptation (task 19.2; Requirements 11.4, 11.5).
 *
 * These pin:
 *
 * - `classifyBelief` qualifies only `KNOWS`/`SUSPECTS(org:station, X)` where X is
 *   a Cell member (reroute) or the Plot target (retarget), by predicate tail so
 *   the `core/` prefix is irrelevant; other beliefs do not qualify;
 * - `adaptToBeliefs` raises Abort Pressure once per qualifying belief key through
 *   the existing plot-abort hook and emits a hidden `plot-adapted` event per
 *   adaptation;
 * - an already-counted belief key adds no pressure and no event;
 * - the adaptation is deterministic.
 *
 * The Plot is a minimal stand-in carrying only the abort-pressure fields the
 * adaptation reads/writes (via `applyBeliefPressure`); the full `PlotState` is
 * built by the core stream and exercised in plot-abort.spec.ts.
 */

import { describe, expect, it } from 'vitest';

import type { EntityId, GameTime, NpcId, OrgId, Proposition } from '../model/core.js';
import type { PlotState } from '../model/state.js';
import { classifyBelief, adaptToBeliefs, type AdaptationContext } from './adaptation.js';

const AT: GameTime = { day: 4, phase: 0 };
const STATION = 'org:station' as OrgId;
const CELL_MEMBER = 'npc:cell-leader' as NpcId;
const TARGET = 'npc:target' as NpcId;

const CTX: AdaptationContext = {
  stationOrg: STATION,
  cellMembers: [CELL_MEMBER],
  target: TARGET,
};

/** A minimal Plot carrying only the abort-pressure fields adaptation touches. */
function plotAt(abortPressure: number, pressureKeys: readonly string[]): PlotState {
  return { abortPressure, pressureKeys } as unknown as PlotState;
}

/** A belief Proposition: `<predicate>(subject, object)`. */
function belief(predicate: string, subject: EntityId, object: EntityId, id = 'prop:b'): Proposition {
  return { id, subject, predicate, object } as Proposition;
}

describe('classifyBelief', () => {
  it('qualifies KNOWS(station, cell-member) as a reroute', () => {
    expect(classifyBelief(belief('core/KNOWS', STATION, CELL_MEMBER), CTX)).toBe(
      'reroute-cell-member',
    );
  });

  it('qualifies SUSPECTS(station, target) as a retarget', () => {
    expect(classifyBelief(belief('core/SUSPECTS', STATION, TARGET), CTX)).toBe('retarget');
  });

  it('matches by predicate tail, ignoring the pack prefix', () => {
    expect(classifyBelief(belief('KNOWS', STATION, CELL_MEMBER), CTX)).toBe(
      'reroute-cell-member',
    );
  });

  it('does not qualify a non-KNOWS/SUSPECTS predicate', () => {
    expect(classifyBelief(belief('core/MEETS_AT', STATION, CELL_MEMBER), CTX)).toBeNull();
  });

  it('does not qualify a belief whose subject is not the Station', () => {
    expect(classifyBelief(belief('core/KNOWS', 'org:other' as OrgId, CELL_MEMBER), CTX)).toBeNull();
  });

  it('does not qualify a belief about an entity outside the Cell and not the target', () => {
    expect(classifyBelief(belief('core/KNOWS', STATION, 'npc:bystander' as NpcId), CTX)).toBeNull();
  });

  it('prefers reroute when the target is also a Cell member', () => {
    const ctx: AdaptationContext = { stationOrg: STATION, cellMembers: [TARGET], target: TARGET };
    expect(classifyBelief(belief('core/KNOWS', STATION, TARGET), ctx)).toBe('reroute-cell-member');
  });
});

describe('adaptToBeliefs', () => {
  it('raises Abort Pressure once per qualifying belief and emits a plot-adapted event', () => {
    const plot = plotAt(0, []);
    const result = adaptToBeliefs(
      plot,
      [belief('core/KNOWS', STATION, CELL_MEMBER, 'prop:1')],
      CTX,
      AT,
    );
    expect(result.plot.abortPressure).toBe(1);
    expect(result.events).toHaveLength(1);
    const [event] = result.events;
    expect(event.kind).toBe('plot-adapted');
    expect(event.visibility).toBe('hidden');
    expect(event.at).toEqual(AT);
  });

  it('ignores non-qualifying beliefs', () => {
    const plot = plotAt(0, []);
    const result = adaptToBeliefs(
      plot,
      [belief('core/MEETS_AT', STATION, CELL_MEMBER)],
      CTX,
      AT,
    );
    expect(result.plot.abortPressure).toBe(0);
    expect(result.events).toHaveLength(0);
  });

  it('presses once per distinct belief key across the day', () => {
    const plot = plotAt(0, []);
    const result = adaptToBeliefs(
      plot,
      [
        belief('core/KNOWS', STATION, CELL_MEMBER, 'prop:1'),
        belief('core/SUSPECTS', STATION, TARGET, 'prop:2'),
      ],
      CTX,
      AT,
    );
    expect(result.plot.abortPressure).toBe(2);
    expect(result.events).toHaveLength(2);
  });

  it('does not re-press a belief key already counted on the Plot', () => {
    // The reroute belief key was already counted (its `belief:` key is present).
    const prop = belief('core/KNOWS', STATION, CELL_MEMBER, 'prop:1');
    const first = adaptToBeliefs(plotAt(0, []), [prop], CTX, AT);
    const second = adaptToBeliefs(first.plot, [prop], CTX, AT);
    expect(second.plot.abortPressure).toBe(first.plot.abortPressure);
    expect(second.events).toHaveLength(0);
  });

  it('is deterministic', () => {
    const plot = plotAt(0, []);
    const beliefs = [
      belief('core/SUSPECTS', STATION, TARGET, 'prop:2'),
      belief('core/KNOWS', STATION, CELL_MEMBER, 'prop:1'),
    ];
    expect(adaptToBeliefs(plot, beliefs, CTX, AT)).toEqual(
      adaptToBeliefs(plot, beliefs, CTX, AT),
    );
  });
});
