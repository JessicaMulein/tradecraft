/**
 * Street graph compile and turn options (tasks 3.1, 3.2, 3.3).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  compileStreetGraph,
  DEFAULT_SPEED_M_PER_TICK,
  gridGraph,
  validateStreetGraph,
  type Directed,
  type StreetGraph,
} from './graph.js';
import { StreetGraphSchema, type StreetPhase } from './content.js';

const PACK = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'street-ops-core',
);

function loadGraph(file: string) {
  const parsed = parse(readFileSync(join(PACK, file), 'utf8')) as { items: unknown[] };
  const item = parsed.items[0];
  const graph = StreetGraphSchema.parse(item);
  return graph;
}

function arrivals(graph: StreetGraph): Directed[] {
  const edges: Directed[] = [];
  for (const [segmentId, segment] of graph.segments) {
    edges.push({ segment: segmentId, dir: 'fwd' });
    if (!segment.oneWay) edges.push({ segment: segmentId, dir: 'rev' });
  }
  return edges;
}

function head(graph: StreetGraph, edge: Directed): string | undefined {
  const segment = graph.segments.get(edge.segment);
  if (segment === undefined) return undefined;
  return edge.dir === 'fwd' ? segment.to : segment.from;
}

describe('street graph', () => {
  it('accepts the demo graphs and refuses a disconnected two-way pair', () => {
    const inner = loadGraph('graphs/inner-court.yaml');
    const grid = loadGraph('graphs/block-grid.yaml');
    expect(validateStreetGraph(inner, 'city-vienna/cafe-mohnblume')).toEqual([]);
    expect(validateStreetGraph(grid, 'city-berlin/lindenallee-cafe')).toEqual([]);
    const broken = StreetGraphSchema.parse({
      ...gridGraph(2, 1),
      segments: [
        {
          id: 'left',
          street: 'Left',
          from: 'g-0-0',
          to: 'g-1-0',
          lengthM: 10,
          speed: 'normal',
          oneWay: false,
          lanes: 1,
          traffic: { morning: 1, afternoon: 1, evening: 1, night: 1 },
        },
        {
          id: 'away',
          street: 'Away',
          from: 'g-0-0',
          to: 'g-0-0',
          lengthM: 10,
          speed: 'normal',
          oneWay: false,
          lanes: 1,
          traffic: { morning: 1, afternoon: 1, evening: 1, night: 1 },
        },
      ],
    });
    expect(validateStreetGraph(broken).some((error) => error.includes('loop'))).toBe(true);
  });

  it('offers only legal exits, including a u-turn and omitting a barred turn', () => {
    const inner = compileStreetGraph(loadGraph('graphs/inner-court.yaml'));
    const atEnd = inner.turnOptions({ segment: 'spur', dir: 'fwd' }, 'morning', DEFAULT_SPEED_M_PER_TICK);
    expect(atEnd).toEqual([]);
    const cross: StreetGraph = compileStreetGraph(
      StreetGraphSchema.parse({
        id: 'cross',
        city: 'fixture',
        junctions: [
          { id: 'west', x: 0, y: 0 },
          { id: 'mid', x: 10, y: 0, barred: [['east-road', 'north-road']] },
          { id: 'east', x: 20, y: 0 },
          { id: 'north', x: 10, y: 10 },
        ],
        segments: [
          {
            id: 'east-road',
            street: 'East Road',
            from: 'west',
            to: 'mid',
            lengthM: 10,
            speed: 'normal',
            oneWay: false,
            lanes: 1,
            traffic: { morning: 1, afternoon: 1, evening: 1, night: 1 },
          },
          {
            id: 'onward',
            street: 'Onward',
            from: 'mid',
            to: 'east',
            lengthM: 10,
            speed: 'normal',
            oneWay: false,
            lanes: 1,
            traffic: { morning: 2, afternoon: 1, evening: 1, night: 1 },
          },
          {
            id: 'north-road',
            street: 'North Road',
            from: 'mid',
            to: 'north',
            lengthM: 10,
            speed: 'normal',
            oneWay: false,
            lanes: 1,
            traffic: { morning: 1, afternoon: 1, evening: 1, night: 1 },
          },
        ],
        frontages: [],
        checkpoints: [],
      }),
    );
    const options = cross.turnOptions({ segment: 'east-road', dir: 'fwd' }, 'morning', DEFAULT_SPEED_M_PER_TICK);
    expect(options.map((option) => option.relative)).toEqual(['u-turn', 'straight']);
    expect(options.map((option) => option.street)).toEqual(['East Road', 'Onward']);
    const straight = options.find((option) => option.relative === 'straight');
    expect(straight?.ticks).toBe(Math.ceil((10 / 10) * 2));
  });

  it('lists exactly the legal moves on random grids', () => {
    // Feature: street-ops, Property 3: Legal moves only
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 2, max: 4 }),
        fc.integer({ min: 0, max: 3 }),
        fc.constantFrom<StreetPhase>('morning', 'afternoon', 'evening', 'night'),
        (cols, rows, oneWayCol, phase) => {
          const file = gridGraph(cols, rows, oneWayCol < cols ? oneWayCol : undefined);
          expect(validateStreetGraph(file, 'hub')).toEqual([]);
          const graph = compileStreetGraph(file);
          for (const arrival of arrivals(graph)) {
            const at = head(graph, arrival);
            expect(at).toBeDefined();
            const options = graph.turnOptions(arrival, phase, DEFAULT_SPEED_M_PER_TICK);
            const offered = options.map((option) => `${option.to.segment}:${option.to.dir}`);
            expect(new Set(offered).size).toBe(offered.length);
            const legal = (graph.out.get(at ?? '') ?? []).filter((edge) => {
              if (edge.segment === arrival.segment && edge.dir === arrival.dir) return false;
              return true;
            });
            expect(offered.sort()).toEqual(legal.map((edge) => `${edge.segment}:${edge.dir}`).sort());
            for (const option of options) {
              expect(legal.some((edge) => edge.segment === option.to.segment && edge.dir === option.to.dir)).toBe(
                true,
              );
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
