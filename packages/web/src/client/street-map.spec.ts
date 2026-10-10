import { describe, expect, it } from 'vitest';

import { layoutStreetMap } from './street-map.js';

describe('street map layout', () => {
  it('puts north up and uses only the points in the view', () => {
    const laid = layoutStreetMap(
      {
        nodes: [
          { id: 'south', x: 0, y: 0 },
          { id: 'north', x: 0, y: 10 },
        ],
        edges: [
          {
            id: 'lane',
            from: 'south',
            to: 'north',
            street: 'Lane',
            known: 'driven',
            shape: [
              [0, 0],
              [0, 10],
            ],
            oneWay: false,
          },
        ],
        locations: [],
        checkpoints: [],
      },
      { width: 200, height: 200 },
    );
    const south = laid.nodes.find((node) => node.id === 'south');
    const north = laid.nodes.find((node) => node.id === 'north');
    expect(north?.y).toBeLessThan(south?.y ?? 0);
    expect(laid.edges.map((edge) => edge.id)).toEqual(['lane']);
    expect(laid.checkpoints).toEqual([]);
  });
});
