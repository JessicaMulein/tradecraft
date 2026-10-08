/**
 * Hostile dossier: memory merge, yearly notoriety decay, and carry-in clamps.
 */

import { describe, expect, it } from 'vitest';

import {
  decayNotoriety,
  dossierCarry,
  mergeHostileMemory,
  NOTORIETY_KNOWN_COVER,
  NOTORIETY_SUSPECTED,
  NOTORIETY_SUSPICION,
} from './dossier.js';
import type { HostileDossier } from './state.js';

const empty: HostileDossier = {
  service: 'svc-east',
  notoriety: 0,
  descriptorKnown: false,
  burnedLegends: [],
  patterns: [],
  channelKinds: [],
  suspectedAssets: [],
  doctrineShift: {},
};

function localTypes(id: string): string {
  if (id.startsWith('drop:')) {
    return id === 'drop:box' ? 'warehouse' : 'cafe';
  }
  return id === 'chan:one' ? 'radio' : 'numbers';
}

describe('hostile dossier', () => {
  it('merges burns, patterns, notoriety and a clamped doctrine shift', () => {
    const once = mergeHostileMemory(
      empty,
      {
        knownCover: true,
        suspectedAssets: ['npc:cp-1', 'npc:cp-1', 'npc:local'],
        compromisedChannels: ['chan:one'],
        compromisedDrops: ['drop:box', 'drop:box'],
        doctrineShift: { riskTolerance: 0.3, deceptionAppetite: -0.5 },
      },
      { identity: 'clerk', blown: true, suspicion: 0.4 },
      'lg-1',
      localTypes,
      0.2,
    );
    expect(once.burnedLegends).toEqual(['lg-1']);
    expect(once.descriptorKnown).toBe(true);
    expect(once.suspectedAssets).toEqual(['cp-1']);
    expect(once.patterns).toEqual([{ locType: 'warehouse', uses: 2 }]);
    expect(once.channelKinds).toEqual([{ kind: 'radio', uses: 1 }]);
    expect(once.notoriety).toBeCloseTo(
      NOTORIETY_SUSPICION * 0.4 + NOTORIETY_KNOWN_COVER + NOTORIETY_SUSPECTED * 3,
    );
    expect(once.doctrineShift.riskTolerance).toBe(0.2);
    expect(once.doctrineShift.deceptionAppetite).toBe(-0.2);

    const again = mergeHostileMemory(
      once,
      {
        knownCover: false,
        suspectedAssets: ['npc:cp-1'],
        compromisedChannels: ['chan:one'],
        compromisedDrops: ['drop:cafe'],
        doctrineShift: { riskTolerance: 0.1 },
      },
      { identity: 'clerk', blown: false, suspicion: 0 },
      'lg-2',
      localTypes,
      0.2,
    );
    expect(again.burnedLegends).toEqual(['lg-1']);
    expect(again.descriptorKnown).toBe(true);
    expect(again.patterns).toEqual([
      { locType: 'warehouse', uses: 2 },
      { locType: 'cafe', uses: 1 },
    ]);
    expect(again.channelKinds).toEqual([{ kind: 'radio', uses: 2 }]);
    expect(again.suspectedAssets).toEqual(['cp-1']);
    expect(again.doctrineShift.riskTolerance).toBe(0.2);
  });

  it('decays notoriety by the yearly amount and does not raise it', () => {
    expect(decayNotoriety(0.55, 2, 0.1)).toBeCloseTo(0.35);
    expect(decayNotoriety(0.05, 1, 0.1)).toBe(0);
    expect(decayNotoriety(0, 3, 0.1)).toBe(0);
    expect(decayNotoriety(0.4, 0, 0.1)).toBe(0.4);
  });

  it('caps starting suspicion, starts a tail, and multiplies detection by pattern use', () => {
    const dossier: HostileDossier = {
      ...empty,
      notoriety: 0.55,
      descriptorKnown: true,
      patterns: [{ locType: 'warehouse', uses: 10 }],
      doctrineShift: { securityConsciousness: 0.2 },
    };
    const quiet = dossierCarry(
      dossier,
      { coverSuspicionBurnThreshold: 0.8 },
      { coverSuspicionK: 0.5, tailFrom: 0.6, patternCap: 0.4 },
    );
    expect(quiet.coverSuspicion).toBeCloseTo(0.5 * 0.55);
    expect(quiet.tailed).toBe(false);
    expect(quiet.patternDetection.warehouse).toBeCloseTo(1.4);
    expect(quiet.doctrineShift.securityConsciousness).toBe(0.2);

    const tailed = dossierCarry(
      { ...dossier, notoriety: 1 },
      { coverSuspicionBurnThreshold: 0.8 },
      { coverSuspicionK: 0.5, tailFrom: 0.6, patternCap: 0.4 },
    );
    expect(tailed.coverSuspicion).toBeCloseTo(0.4);
    expect(tailed.tailed).toBe(true);

    const light = dossierCarry(
      { ...dossier, patterns: [{ locType: 'cafe', uses: 1 }] },
      { coverSuspicionBurnThreshold: 0.8 },
      { coverSuspicionK: 0.5, tailFrom: 0.6, patternCap: 0.4 },
    );
    expect(light.patternDetection.cafe).toBeCloseTo(1.1);
  });
});
