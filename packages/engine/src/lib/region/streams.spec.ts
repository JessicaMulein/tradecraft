import { describe, expect, it } from 'vitest';

import { createPrng, derive } from '../prng/prng.js';
import {
  REGION_STREAM_BASE,
  REGION_STREAM_END,
  cityAmbientSeed,
  cityCoreSeed,
  cityDailySeed,
  cityNoiseRetrySeed,
  cityNoiseSeed,
  citySpineSeed,
  initialCityStreams,
  regionRetrySeed,
  regionSeed,
} from './streams.js';

describe('regional PRNG streams', () => {
  it('derives a stable layout from the region seed', () => {
    const seed = 'posting-seed';
    const region = regionSeed(seed);

    expect(REGION_STREAM_BASE).toBe(0x70000);
    expect(REGION_STREAM_END).toBe(0x7ffff);
    expect(region).toBe(derive(seed, 0x70000));
    expect(regionSeed(seed)).toBe(region);
    expect(regionRetrySeed(seed, 4)).toBe(derive(region, 4));

    expect(cityCoreSeed(seed, 0)).toBe(derive(region, 0x100));
    expect(cityCoreSeed(seed, 2)).toBe(derive(region, 0x102));
    expect(cityCoreSeed(seed, 0)).not.toBe(cityCoreSeed(seed, 1));

    expect(cityNoiseSeed(seed, 1)).toBe(derive(region, 0x201));
    expect(cityNoiseRetrySeed(seed, 1, 3)).toBe(derive(cityNoiseSeed(seed, 1), 3));
    expect(cityDailySeed(seed, 1, 12)).toBe(derive(derive(region, 0x301), 12));
    expect(citySpineSeed(seed, 1)).toBe(derive(region, 0x401));
    expect(cityAmbientSeed(seed, 1)).toBe(derive(region, 0x501));

    const cities = ['city:north', 'city:east'] as const;
    const streams = initialCityStreams(seed, cities);
    expect(streams.spine['city:north']).toEqual(createPrng(citySpineSeed(seed, 0)).state());
    expect(streams.spine['city:east']).toEqual(createPrng(citySpineSeed(seed, 1)).state());
    expect(streams.ambient['city:north']).toEqual(createPrng(cityAmbientSeed(seed, 0)).state());
    expect(streams.ambient['city:east']).toEqual(createPrng(cityAmbientSeed(seed, 1)).state());
    expect(streams.spine['city:north']).not.toEqual(streams.ambient['city:north']);
    expect(streams.spine['city:north']).not.toEqual(streams.spine['city:east']);
    expect(initialCityStreams(seed, cities)).toEqual(streams);
  });
});
