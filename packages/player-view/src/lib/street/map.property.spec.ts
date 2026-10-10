/**
 * Feature: street-ops, Property 15: Map view is a projection.
 */

import { compileStreetGraph, gridGraph, type WorldState } from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { renderLocalMap, renderNetwork, streetMapView, type DriveView } from './map.js';

function world(knowledge: Record<string, 'driven' | 'map' | 'aid'>): WorldState {
  return {
    ext: { streetOps: { knowledge, mapNames: {}, seenCheckpoints: [], vehicles: [], told: [], rides: {} } },
    city: { locations: {} },
    time: { day: 1, phase: 0 },
    player: { loc: 'hub' },
  } as WorldState;
}

describe('street map projection', () => {
  it('shows only segments and junctions the player knows', () => {
    // Feature: street-ops, Property 15: Map view is a projection
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 2, max: 4 }),
        fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }),
        (cols, rows, bits) => {
          const graph = compileStreetGraph(gridGraph(cols, rows));
          const ids = [...graph.segments.keys(), ...graph.junctions.keys()];
          const knowledge: Record<string, 'driven'> = {};
          ids.forEach((id, index) => {
            if (bits[index % bits.length] === true) knowledge[id] = 'driven';
          });
          const view = streetMapView(world(knowledge), graph);
          for (const edge of view.edges) {
            expect(knowledge[edge.id]).toBe('driven');
            expect(knowledge[edge.from]).toBe('driven');
            expect(knowledge[edge.to]).toBe('driven');
            expect(edge.traffic).toBeUndefined();
          }
          for (const node of view.nodes) expect(knowledge[node.id]).toBe('driven');
          expect(view.checkpoints).toEqual([]);
          expect(JSON.stringify(view)).not.toContain('tail');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('draws the local map from the drive view alone', () => {
    const view: DriveView = {
      vehicle: { name: 'Opel', plate: 'P-1' },
      street: 'Court Lane',
      heading: 'east',
      options: [{ relative: 'left', street: 'Lamp Cut', ticks: 2 }],
      speed: 'normal',
      onApproach: [{ loc: 'loc:cafe', name: 'Cafe' }],
      traffic: 'light',
      clock: { phase: 1, ticksInPhase: 3 },
      passengers: [],
    };
    const text = renderLocalMap(view).join('\n');
    expect(text).toContain('Court Lane');
    expect(text).toContain('Lamp Cut');
    expect(text).toContain('Cafe');
    expect(text).not.toContain('tail');
    expect(text).not.toContain('suspicion');
  });

  it('shows this phase of traffic on a street the navigation aid taught', () => {
    const graph = compileStreetGraph(gridGraph(2, 2));
    const segment = [...graph.segments.values()][0];
    if (segment === undefined) throw new Error('no segment');
    const view = streetMapView(
      world({ [segment.id]: 'aid', [segment.from]: 'aid', [segment.to]: 'aid' }),
      graph,
    );
    const edge = view.edges.find((item) => item.id === segment.id);
    expect(edge?.traffic).toBe('light');
    expect(renderNetwork(view).join('\n')).toContain('light traffic');
  });
});
