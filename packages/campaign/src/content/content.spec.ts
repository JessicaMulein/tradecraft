import { describe, expect, it } from 'vitest';

import { coverOfficial } from './city-pack.js';
import { CAMPAIGN_KINDS, campaignJsonSchema } from './kinds.js';
import {
  ArcConditionSchema,
  ArcTemplateSchema,
  ArcThreadTemplateSchema,
  BackgroundSchema,
  EpochSchema,
  ModifierEffectSchema,
  RequisitionSchema,
} from './schemas.js';

const background = {
  id: 'analyst',
  name: 'Analyst',
  text: 'A desk officer sent to the field.',
  rank: 'case-officer',
  skills: { cryptanalysis: 1 },
  languages: ['german'],
  traits: ['methodical'],
  factions: { security: 1 },
};

describe('campaign content kinds', () => {
  it('registers every campaign kind with field declarations and no service kind', () => {
    const names = CAMPAIGN_KINDS.map((item) => item.kind);
    expect(names).toEqual([
      'background',
      'rank',
      'skill',
      'trait',
      'faction',
      'hq-cast',
      'requisition',
      'exfiltration',
      'arc',
      'arc-thread',
      'epoch',
      'review-weights',
      'campaign-text',
    ]);
    expect(names).not.toContain('service');
    for (const item of CAMPAIGN_KINDS) {
      expect(item.owner).toBe('@tradecraft/campaign');
      expect(item.dir.startsWith('campaign/')).toBe(true);
      expect(item.cityScoped).toBe(false);
      expect(campaignJsonSchema(item.kind).type).toBe('object');
    }
  });

  it('accepts a background and rejects an unknown rank', () => {
    expect(BackgroundSchema.safeParse(background).success).toBe(true);
    expect(BackgroundSchema.safeParse({ ...background, rank: 'director' }).success).toBe(false);
  });

  it('rejects an unknown arc condition, an unknown requisition and inverted bounds', () => {
    expect(ArcConditionSchema.safeParse({ kind: 'fly-away' }).success).toBe(false);
    expect(
      ArcConditionSchema.safeParse({ kind: 'person-status', slot: 'nemesis', in: ['arrested'] })
        .success,
    ).toBe(true);
    expect(RequisitionSchema.safeParse({ id: 'aid', cost: 2, effect: { kind: 'teleport' } }).success).toBe(
      false,
    );
    expect(
      ModifierEffectSchema.safeParse({
        path: 'detection.surveil',
        op: 'mul',
        perLevel: -0.06,
        bounds: [1, 0.7],
      }).success,
    ).toBe(false);
  });

  it('accepts an arc thread and an ordered epoch', () => {
    expect(
      ArcThreadTemplateSchema.safeParse({
        id: 'nemesis-shadow',
        stages: [
          {
            id: 'seen',
            deadline: { min: 1, max: 4 },
            onDisrupted: { delay: 1, reroute: 1, abort: 0 },
          },
        ],
        clues: [{ id: 'nemesis-identified', prop: 'MEMBER_OF' }],
        slots: [{ id: 'nemesis', binding: 'nemesis' }],
      }).success,
    ).toBe(true);
    expect(
      ArcTemplateSchema.safeParse({
        id: 'nemesis',
        priority: 2,
        binds: { nemesis: { from: 'carried-hostile', else: 'generate', archetype: 'hostile-officer' } },
        stages: [
          {
            id: 'shadow',
            when: [{ kind: 'posting-index-at-least', n: 1 }],
            thread: 'nemesis-shadow',
          },
        ],
        resolve: [{ kind: 'person-status', slot: 'nemesis', in: ['arrested', 'turned', 'dead'] }],
      }).success,
    ).toBe(true);
    expect(
      EpochSchema.safeParse({
        id: 'occupation',
        years: [1950, 1948],
        ciphers: ['caesar'],
        tension: [0.4, 0.6],
      }).success,
    ).toBe(false);
  });

  it('treats a missing official flag as official', () => {
    expect(coverOfficial({})).toBe(true);
    expect(coverOfficial({ official: true })).toBe(true);
    expect(coverOfficial({ official: false })).toBe(false);
  });
});
