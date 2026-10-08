import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { derive } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { CAMPAIGN_STREAM, campaignStream, postingSeed } from './seed.js';
import { archiveView, campaignView, hqStepView } from './view.js';
import type { CampaignView } from './state.js';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('posting seeds', () => {
  it('depends only on the campaign seed and the posting index', () => {
    const seed = 'campaign-seed';
    expect(postingSeed.length).toBe(2);
    expect(postingSeed(seed, 3)).toBe(derive(seed, 3));
    expect(postingSeed(seed, 3)).toBe(postingSeed(seed, 3));
    expect(postingSeed(seed, 0)).not.toBe(postingSeed(seed, 1));
    expect(postingSeed('other-log', 3)).not.toBe(postingSeed(seed, 3));
  });

  it('keeps the campaign stream on derive(seed, 0xC0000)', () => {
    const seed = 'campaign-seed';
    expect(CAMPAIGN_STREAM).toBe(0xc0000);
    expect(campaignStream(seed)).toBe(derive(seed, 0xc0000));
    expect(campaignStream(seed)).not.toBe(postingSeed(seed, 0));
    expect(campaignStream(seed)).not.toBe(postingSeed(seed, 1));
  });
});

describe('campaign view entry', () => {
  const view: CampaignView = {
    officer: {
      name: 'Ada',
      background: 'analyst',
      rank: 'case-officer',
      skills: {},
      traits: [],
      stress: 0,
      reprimands: 0,
      legends: [],
      careerStanding: 0,
      careerPoints: 0,
      factions: {},
    },
    offers: [],
    pendingRequisitions: [],
    staged: { assets: [], endOffers: [] },
    hqCast: [],
    arcs: [],
    unk: {},
  };

  it('projects the view, the HQ step, and the archive without a truth field', () => {
    expect(campaignView({ view })).toBe(view);
    expect(
      hqStepView({ step: { kind: 'offers' }, view }),
    ).toEqual({
      kind: 'offers',
      offers: [],
      staged: view.staged,
      pendingRequisitions: [],
      arcs: [],
      trainingUsed: 0,
    });
    const archive = { visible: [] };
    expect(archiveView({ archive })).toEqual({ revealed: false, timeline: [] });
    const projected = JSON.stringify({
      view: campaignView({ view }),
      step: hqStepView({ step: { kind: 'creation' }, view }),
      archive: archiveView({ archive }),
    });
    expect(projected).not.toContain('hqMole');
    expect(projected).not.toContain('hostileControlled');
  });

  it('is the only campaign path the dependency rules leave open to player-view', () => {
    const rules = readFileSync(join(HERE, '..', '..', '..', '.dependency-cruiser.cjs'), 'utf8');
    expect(rules).toContain('no-tui-in-campaign');
    expect(rules).toContain('campaign-view-only');
    expect(rules).toContain('packages/campaign/src/view');
    const entry = readFileSync(join(HERE, 'view.ts'), 'utf8');
    expect(entry).toContain('export function campaignView');
    expect(entry).toContain('export function hqStepView');
    expect(entry).toContain('export function archiveView');
    expect(entry).not.toContain('.truth');
  });
});
