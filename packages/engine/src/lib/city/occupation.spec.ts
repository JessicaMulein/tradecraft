import { describe, expect, it } from 'vitest';

import {
  occupationSceneLine,
  sectorCheckpointLine,
  viennaSurround,
  westRoadLine,
  withOccupation,
} from './occupation.js';

describe('occupation scenes', () => {
  it('keeps a western street as the place itself', () => {
    expect(occupationSceneLine('american', 3)).toBeUndefined();
    expect(withOccupation('A quiet café.', 'british', 0)).toBe('A quiet café.');
  });

  it('puts a patrol on a Soviet street by day and a car there at night', () => {
    expect(occupationSceneLine('soviet', 0)).toContain('foot patrol');
    expect(occupationSceneLine('soviet', 1)).toContain('papers');
    expect(occupationSceneLine('soviet', 2)).toContain('dark car');
    expect(occupationSceneLine('soviet', 3)).toContain('slows beside the pavement');
    expect(withOccupation('A market square.', 'soviet', 0)).toContain('foot patrol');
  });

  it('checks papers at the line into the Soviet sector, and names the zone on the way out', () => {
    expect(sectorCheckpointLine('american', 'soviet', 0)).toContain('waves you through');
    expect(sectorCheckpointLine('international', 'soviet', 3)).toContain('engine running');
    expect(sectorCheckpointLine('soviet', 'french', 1)).toContain('roads out of the city');
    expect(sectorCheckpointLine('american', 'british', 2)).toBeUndefined();
    expect(sectorCheckpointLine('soviet', 'soviet', 3)).toBeUndefined();
    expect(viennaSurround('Vienna')).toContain('Soviet zone');
    expect(viennaSurround('Trieste')).toBeUndefined();
    expect(westRoadLine('Vienna', 'district:mariahilf')).toContain('Soviet zone');
    expect(westRoadLine('Vienna', 'district:innere-stadt')).toBeUndefined();
    expect(westRoadLine('Berlin', 'district:mariahilf')).toBeUndefined();
  });
});
