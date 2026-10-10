import { describe, expect, it } from 'vitest';

import type { LocId } from '../model/core.js';
import type { City, Location } from './city.js';
import { habitsOf, ordinaryLifeLine, withOrdinaryLife } from './ordinary-life.js';

function place(id: string, type: string): Location {
  return {
    id: id as LocId,
    name: id,
    aliases: [],
    type,
    district: 'd' as Location['district'],
    public: true,
    description: 'A place.',
    atmosphere: [],
    hours: { 0: true, 1: true, 2: true, 3: true },
    risk: 0,
    deadDropSites: [],
  };
}

function city(places: readonly Location[]): City {
  const locations: City['locations'] = {};
  for (const item of places) {
    locations[item.id] = item;
  }
  return { locations } as City;
}

describe('ordinary life', () => {
  it('picks the first flat, café, and market by id', () => {
    const habits = habitsOf(
      city([
        place('loc:b', 'core/safehouse'),
        place('loc:a', 'core/safehouse'),
        place('loc:z', 'core/kaffeehaus'),
        place('loc:m', 'market'),
      ]),
    );
    expect(habits.flat).toBe('loc:a');
    expect(habits.cafe).toBe('loc:z');
    expect(habits.market).toBe('loc:m');
  });

  it('names the player at their own café and stays generic at another', () => {
    expect(ordinaryLifeLine('core/kaffeehaus', 0, true)).toContain('Your usual table');
    expect(ordinaryLifeLine('kaffeehaus', 0, false)).not.toContain('Your usual');
    expect(withOrdinaryLife('A room.', 'core/market', 2, true)).toContain('Black-market coffee');
    expect(ordinaryLifeLine('core/station-hq', 0, false)).toBeUndefined();
  });
});
