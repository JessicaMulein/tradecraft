/**
 * Regional notices (multi-city task 11.1).
 */

import { describe, expect, it } from 'vitest';

import type { DocId, LocId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { cableLatency, publishCityEditions } from './notices.js';

const kiosk = 'loc:kiosk' as LocId;

function regional(): WorldState {
  return {
    player: { city: 'city:north' },
    documents: {},
    region: {
      template: 'central',
      order: ['city:north', 'city:east'],
      cities: {
        'city:north': {
          id: 'city:north',
          tier: 'full',
          country: 'Northland',
          districts: {},
          locations: {},
          routes: [],
          weather: { condition: 'clear', label: 'clear', season: 'summer' },
          sectorLines: [],
        },
        'city:east': {
          id: 'city:east',
          tier: 'coarse',
          country: 'Eastland',
          districts: {},
          locations: {},
          routes: [],
          weather: { condition: 'clear', label: 'clear', season: 'summer' },
          sectorLines: [],
        },
      },
      intercity: {},
      borderPosts: {},
      jurisdiction: {},
      latency: { sameCountry: 1, crossBorder: 3, acrossCurtain: 4 },
    },
  } as WorldState;
}

describe('regional notices', () => {
  it('adds the cross-border latency to a cable sent toward the hub', () => {
    const state = regional();
    expect(cableLatency(state, 2)).toBe(2);
    const away = { ...state, player: { ...state.player, city: 'city:east' as const } };
    expect(cableLatency(away, 2)).toBe(5);
  });

  it('holds a foreign edition until the next day, then sells it at the local kiosk', () => {
    const first = publishCityEditions(regional(), { day: 1, phase: 0 }, [kiosk]);
    const foreign = first.state.documents['doc:edition:east:1' as DocId];
    expect(foreign?.obtainableAt).toEqual([]);
    expect(first.events.map((event) => event.city)).toEqual(['city:east']);
    const second = publishCityEditions(first.state, { day: 2, phase: 0 }, [kiosk]);
    expect(second.state.documents['doc:edition:east:1' as DocId]?.obtainableAt).toEqual([kiosk]);
  });
});
