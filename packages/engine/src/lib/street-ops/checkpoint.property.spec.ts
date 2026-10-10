/**
 * Property 8 (street-ops task 8.1). With one shared draw, a harder search
 * finds everything an easier search found.
 *
 * **Validates: Requirements 8.2, 8.3, 8.4**
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { borderCheck } from '../border/check.js';
import { asTruth } from '../model/core.js';
import { createPrng } from '../prng/prng.js';
import {
  avoidanceDelta,
  checkpointsAhead,
  checkpointsCrossed,
  detectionChance,
  policePressure,
  randomStop,
  withCrackdownPosts,
  withPressureStop,
  searchLevel,
  SEARCH_LEVELS,
  VEHICLE_BORDER,
  vehicleCheck,
  type HiddenCargo,
  type VehicleCheckInput,
} from './checkpoint.js';
import { CheckpointKindSchema } from './content.js';
import { compileStreetGraph, gridGraph } from './graph.js';

const SEARCH_RANK = { none: 0, visual: 1, interior: 2, boot: 3, undercarriage: 4 } as const;

function kind(thoroughness: number, strictness = 0.5) {
  return CheckpointKindSchema.parse({
    id: 'sector-line',
    borderCheck: 'pass',
    thoroughness,
    strictness,
    hours: ['morning', 'afternoon', 'evening', 'night'],
    searches: ['visual', 'interior', 'boot', 'undercarriage'],
    watchesAvoidance: false,
    avoidanceSuspicion: 0,
  });
}

function input(thoroughness: number, cargo: HiddenCargo, suspicion = 0.2): VehicleCheckInput {
  return {
    vehicle: { id: 'car', plate: 'P-1' },
    passengers: [],
    concealment: [cargo],
    kind: kind(thoroughness),
    papersValid: true,
    onWatch: false,
    suspicion,
  };
}

describe('checkpoint check', () => {
  it('never finds less when the search is harder and the draw is the same', () => {
    // Feature: street-ops, Property 8: Checkpoint monotonicity
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 0.8, noNaN: true }),
        fc.double({ min: 0.05, max: 0.2, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 2, noNaN: true }),
        fc.double({ min: 0.2, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (draw, thoroughness, step, suspicion, difficulty, ticks, composure, endurance) => {
          const cargo: HiddenCargo = {
            id: 'boot',
            difficulty,
            endurance,
            ticksConcealed: ticks,
            composure,
            kind: 'item',
          };
          const low = detectionChance({
            thoroughness,
            searchLevelRank: 1,
            suspicion,
            ticksConcealed: ticks,
            endurance,
            difficulty,
            composure,
          });
          const high = detectionChance({
            thoroughness: Math.min(1, thoroughness + step),
            searchLevelRank: 2,
            suspicion: Math.min(1, suspicion + step),
            ticksConcealed: ticks + step,
            endurance,
            difficulty: Math.max(0, difficulty - step),
            composure: Math.max(0, composure - step),
          });
          expect(high).toBeGreaterThanOrEqual(low - 1e-9);
          const easier = vehicleCheck(input(thoroughness, cargo, suspicion), draw).found;
          const harder = vehicleCheck(
            input(Math.min(1, thoroughness + step), { ...cargo, difficulty: Math.max(0, difficulty - step), composure: Math.max(0, composure - step), ticksConcealed: ticks + step }, Math.min(1, suspicion + step)),
            draw,
          ).found;
          for (const id of easier) expect(harder).toContain(id);
          const quiet = searchLevel(kind(thoroughness, 0.2), suspicion);
          const strict = searchLevel(kind(Math.min(1, thoroughness + step), Math.min(1, 0.2 + step)), Math.min(1, suspicion + step));
          expect(SEARCH_RANK[strict]).toBeGreaterThanOrEqual(SEARCH_RANK[quiet]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('shows a sector checkpoint before the car reaches it, and only notes a turn-back when the post watches', () => {
    const file = gridGraph(2, 2);
    const segment = file.segments[0]?.id;
    if (segment === undefined) throw new Error('grid has no segment');
    const graph = compileStreetGraph({
      ...file,
      checkpoints: [{ id: 'halt', kind: 'document-halt', segment, at: 0.6, visibleM: 20 }],
    });
    const post = CheckpointKindSchema.parse({
      id: 'document-halt',
      borderCheck: 'pass',
      thoroughness: 0.4,
      hours: ['morning'],
      watchesAvoidance: true,
      avoidanceSuspicion: 0.15,
    });
    const before = { segment, dir: 'fwd' as const, progress: 0.2 };
    expect(checkpointsAhead(graph, before, 'morning', [post], 120).map((site) => site.id)).toEqual(['halt']);
    expect(checkpointsAhead(graph, before, 'night', [post], 120)).toEqual([]);
    const after = { segment, dir: 'fwd' as const, progress: 1 };
    expect(checkpointsCrossed(graph, before, after, 'morning', [post])).toHaveLength(1);
    expect(avoidanceDelta(post)).toBe(0.15);
    expect(avoidanceDelta({ ...post, watchesAvoidance: false })).toBe(0);
    const hidden = vehicleCheck(
      input(0.2, { id: 'crate', difficulty: 0.1, endurance: 1, ticksConcealed: 0, composure: 0, kind: 'item', reachedBy: ['undercarriage'] }),
      0,
    );
    expect(hidden.search).not.toBe('undercarriage');
    expect(hidden.found).toEqual([]);
    expect(randomStop(0.1, 0, post)).toBeUndefined();
    expect(randomStop(0.1, 0.5, post)?.id).toBe('document-halt');
  });

  it('leaves an on-foot border check unchanged and checks a car through the seam', () => {
    const papers = {
      id: 'paper:passport' as const,
      kind: 'passport',
      holder: 'player' as const,
      quality: asTruth(1),
      issuedBy: { kind: 'station' as const, id: 'station' },
    };
    const onFoot = {
      post: { id: 'post:line', name: 'the line', strictness: 0.2, documents: ['passport'] },
      at: { day: 1, phase: 0 as const },
      traveller: { identity: 'player', descriptor: 'a clerk' },
      papers: [papers],
      items: [],
      watch: { persons: [], descriptors: [] },
      rules: { watchListSensitivity: 0.5, detentionPhases: 2, contrabandCashThreshold: 40 },
    };
    expect(borderCheck(onFoot, createPrng('foot'))).toEqual(borderCheck(onFoot, createPrng('foot'), VEHICLE_BORDER));
    const driving = borderCheck(
      { ...onFoot, traveller: { ...onFoot.traveller, vehicle: { plate: 'P-1' } }, papers: [] },
      createPrng('car'),
      VEHICLE_BORDER,
    );
    expect(driving.outcome).toBe('refused');
    expect(SEARCH_LEVELS).toContain('visual');
  });

  it('places a roadblock for an active crackdown and a stop only when pressure wins the draw', () => {
    const file = gridGraph(2, 2);
    const graph = compileStreetGraph(file);
    const segment = file.segments[0]?.id;
    if (segment === undefined) throw new Error('grid has no segment');
    const quiet = withCrackdownPosts(graph, 3, { 'evt:curfew': { templateId: 'crackdown-1', name: 'Night curfew', start: 1, end: 2 } }, 'roadblock');
    expect(quiet.checkpoints).toHaveLength(0);
    const posted = withCrackdownPosts(graph, 3, { 'evt:curfew': { templateId: 'crackdown-1', name: 'Night curfew', start: 1, end: 4 } }, 'roadblock');
    expect(posted.checkpoints).toHaveLength(1);
    expect(posted.checkpoints[0]?.kind).toBe('roadblock');
    expect(withCrackdownPosts(graph, 3, { 'evt:curfew': { templateId: 'crackdown-1', start: 1, end: 4 } }, undefined)).toBe(graph);
    const before = { segment, dir: 'fwd' as const, progress: 0.2 };
    const after = { segment, dir: 'fwd' as const, progress: 1 };
    const kind = CheckpointKindSchema.parse({
      id: 'document-halt',
      borderCheck: 'pass',
      thoroughness: 0.3,
      hours: ['morning', 'afternoon', 'evening', 'night'],
    });
    expect(policePressure(0, 0)).toBe(0);
    expect(withPressureStop(graph, before, after, 0.1, 0, kind)).toBe(graph);
    const stopped = withPressureStop(graph, before, after, 0, 1, kind);
    expect(stopped.checkpoints.map((site) => site.kind)).toEqual(['document-halt']);
    expect(checkpointsCrossed(stopped, before, after, 'morning', [kind])).toHaveLength(1);
  });
});
