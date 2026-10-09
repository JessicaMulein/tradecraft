/**
 * Known city names for the Specifics Guard (Requirement 17.5).
 */

import { describe, expect, it } from 'vitest';

import { knownCityNames } from './city-names.js';

describe('knownCityNames', () => {
  it('is empty when the world has no region', () => {
    expect(knownCityNames({})).toEqual([]);
  });

  it('lists every published city name', () => {
    expect(
      knownCityNames({
        region: {
          order: ['city:east', 'city:north'],
          cities: {
            'city:north': { name: 'Northport' },
            'city:east': { name: 'Eastport' },
          },
        },
      }),
    ).toEqual(['Eastport', 'Northport']);
  });
});
