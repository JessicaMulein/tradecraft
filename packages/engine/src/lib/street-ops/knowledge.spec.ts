/**
 * Street knowledge (task 12). A map can be wrong until the player drives the street.
 */

import { describe, expect, it } from 'vitest';

import type { ResolverContext } from '../action/result.js';
import type { WorldState } from '../model/state.js';
import { compileStreetGraph, gridGraph } from './graph.js';
import { learnDocument, learnLocal, learnTravel } from './knowledge.js';
import { driveActions, runtimeFromScenario } from './drive.js';

const graph = compileStreetGraph(gridGraph(2, 2));
const segment = [...graph.segments.keys()][0] ?? 'h-0-0';

function bare(year: number, money: number): WorldState {
  return {
    meta: { setting: { year } },
    player: { loc: 'hub' },
    station: { ledger: { start: money, entries: [] } },
    time: { day: 1, phase: 0 },
  } as WorldState;
}

describe('street knowledge', () => {
  it('keeps a map name until the street is driven, then corrects it', () => {
    const learned = learnDocument(graph, { knowledge: {}, mapNames: {} }, {
      segments: [segment],
      aliases: [{ segment, street: 'Wrong Name' }],
    });
    expect(learned.knowledge[segment]).toBe('map');
    expect(learned.mapNames[segment]).toBe('Wrong Name');
    const driven = learnTravel(graph, learned, { segment, dir: 'fwd', progress: 1 }, true);
    expect(driven.books.knowledge[segment]).toBe('driven');
    expect(driven.books.mapNames[segment]).toBeUndefined();
    expect(driven.correction).toBe('The map called this street Wrong Name.');
    const quieter = learnLocal(graph, driven.books, [segment]);
    expect(quieter.knowledge[segment]).toBe('driven');
  });

  it('sells a map in its year and refuses one outside it', () => {
    const runtime = runtimeFromScenario(
      {},
      {
        graphs: [graph],
        maps: [{ id: 'sheet', title: 'Sheet', era: { from: 1946, to: 1955 }, price: 2, at: 'hub', segments: [segment], aliases: [] }],
      },
    );
    const read = driveActions(runtime).find((action) => action.kind === 'street-ops.read-map');
    expect(read).toBeDefined();
    const ctx = { content: {} } as ResolverContext;
    const bought = read?.quote(bare(1950, 5), { kind: 'street-ops.read-map', id: 'sheet' }, ctx);
    expect(bought).toEqual({ allowed: true, phases: 0, money: 2 });
    const early = read?.quote(bare(1900, 5), { kind: 'street-ops.read-map', id: 'sheet' }, ctx);
    expect(early).toMatchObject({ allowed: false });
    const broke = read?.quote(bare(1950, 0), { kind: 'street-ops.read-map', id: 'sheet' }, ctx);
    expect(broke).toMatchObject({ allowed: false });
  });
});
