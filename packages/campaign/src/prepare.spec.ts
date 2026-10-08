/**
 * HQ preparation: training slots, leave, requisitions, legends, and manifests.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContentManifest } from '@tradecraft/content';
import { asTruth } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { loadCampaignConfig } from './config.js';
import {
  applyPreparation,
  LEGEND_REFUSAL,
  quotePreparation,
  TRAINING_SLOTS,
} from './prepare.js';
import { step } from './reducer.js';
import type { CampaignChoice, CampaignState, HostileDossier } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);
const config = loadCampaignConfig(join(ROOT, 'config', 'campaign.yaml'));
if (!config.ok) {
  throw new Error(config.issues.map((issue) => issue.message).join('; '));
}
const relief = config.value.stress.leaveRelief;

const city = { covers: ['clerk', 'journalist'], services: ['svc-east'] };

function created(): CampaignState {
  const choice: Extract<CampaignChoice, { kind: 'create' }> = {
    kind: 'create',
    seed: 'career-seed',
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  };
  const result = step(undefined, { kind: 'choice', choice }, content);
  if (!result.ok) {
    throw new Error(result.error.kind);
  }
  return result.value;
}

function preparing(patch: Partial<CampaignState['view']['officer']> = {}): CampaignState {
  const state = created();
  return {
    ...state,
    step: { kind: 'prepare' },
    view: {
      ...state.view,
      chosen: 'offer-1',
      offers: [
        {
          id: 'offer-1',
          city: 'core',
          service: 'svc-east',
          year: 1948,
          tourYears: 2,
          tier: 'standard',
          theme: 'surveillance',
          assigned: false,
        },
      ],
      officer: { ...state.view.officer, careerPoints: 5, ...patch },
    },
  };
}

function lastChoice(state: CampaignState): CampaignChoice | undefined {
  const entry = state.log.at(-1);
  return entry?.kind === 'choice' ? entry.choice : undefined;
}

function dossier(burned: 'lg-1'[]): HostileDossier {
  return {
    service: 'svc-east',
    notoriety: 0.2,
    descriptorKnown: false,
    burnedLegends: burned,
    patterns: [],
    channelKinds: [],
    suspectedAssets: [],
    doctrineShift: {},
  };
}

describe('HQ preparation', () => {
  it('trains up to the two slots and the rank cap, and records the choice', () => {
    let state = preparing();
    const first = step(state, { kind: 'choice', choice: { kind: 'train', skill: 'cryptanalysis' } }, content);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    state = first.value;
    expect(state.view.officer.skills.cryptanalysis?.level).toBe(2);
    expect(state.view.trainingUsed).toBe(1);
    expect(lastChoice(state)).toEqual({ kind: 'train', skill: 'cryptanalysis' });

    const second = step(state, { kind: 'choice', choice: { kind: 'train', skill: 'cryptanalysis' } }, content);
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.value.view.officer.skills.cryptanalysis?.level).toBe(3);
    expect(second.value.view.trainingUsed).toBe(TRAINING_SLOTS);

    const before = JSON.stringify(second.value);
    const third = step(second.value, { kind: 'choice', choice: { kind: 'train', skill: 'cryptanalysis' } }, content);
    expect(third.ok).toBe(false);
    expect(JSON.stringify(second.value)).toBe(before);

    const capped = preparing();
    const atCap = {
      ...capped,
      view: {
        ...capped.view,
        officer: {
          ...capped.view.officer,
          skills: { ...capped.view.officer.skills, cryptanalysis: { level: 3 as const, xp: 0 } },
        },
      },
    };
    const refused = quotePreparation(atCap, { kind: 'train', skill: 'cryptanalysis' }, content);
    expect(refused.allowed).toBe(false);
    expect(atCap.view.trainingUsed).toBeUndefined();
  });

  it('spends a slot on leave and lowers stress by the configured relief', () => {
    const state = preparing({ stress: 90, traits: ['methodical', 'strained'] });
    const left = applyPreparation(state, { kind: 'leave' }, content, { leaveRelief: relief });
    expect(left.ok).toBe(true);
    if (!left.ok) {
      return;
    }
    expect(left.value.view.officer.stress).toBe(90 - relief);
    expect(left.value.view.officer.traits).toContain('methodical');
    expect(left.value.view.officer.traits).not.toContain('strained');
    expect(left.value.view.trainingUsed).toBe(1);

    const medical = preparing({ stress: 100 });
    expect(quotePreparation(medical, { kind: 'train', skill: 'cryptanalysis' }, content).allowed).toBe(false);
    const rested = applyPreparation(medical, { kind: 'leave' }, content, { leaveRelief: relief });
    expect(rested.ok).toBe(true);
    if (!rested.ok) {
      return;
    }
    expect(quotePreparation(rested.value, { kind: 'train', skill: 'cryptanalysis' }, content).allowed).toBe(true);
  });

  it('debits a requisition the officer can afford and rejects one they cannot', () => {
    const state = preparing({ careerPoints: 2 });
    const before = JSON.stringify(state);
    const short = step(state, { kind: 'choice', choice: { kind: 'requisition', id: 'cipher-aid' } }, content);
    expect(short.ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);

    const bought = step(state, { kind: 'choice', choice: { kind: 'requisition', id: 'language-course' } }, content);
    expect(bought.ok).toBe(true);
    if (!bought.ok) {
      return;
    }
    expect(bought.value.view.officer.careerPoints).toBe(0);
    expect(bought.value.view.pendingRequisitions).toEqual(['language-course']);
    expect(lastChoice(bought.value)).toEqual({ kind: 'requisition', id: 'language-course' });
  });

  it('refuses a burned or foreign cover without naming the reason, and accepts a safe one', () => {
    const state = preparing();
    const burned: CampaignState = {
      ...state,
      view: {
        ...state.view,
        officer: {
          ...state.view.officer,
          legends: [
            {
              id: 'lg-1',
              cover: 'clerk',
              name: 'Helen',
              official: true,
              posting: 0,
              observedBurnedBy: [],
            },
          ],
        },
      },
      truth: asTruth({ ...state.truth, dossiers: { 'svc-east': dossier(['lg-1']) } }),
    };
    const unsafe = quotePreparation(burned, { kind: 'legend', cover: 'clerk', name: 'Helen' }, content, city);
    const foreign = quotePreparation(burned, { kind: 'legend', cover: 'other', name: 'Helen' }, content, city);
    expect(unsafe.allowed).toBe(false);
    expect(foreign.allowed).toBe(false);
    expect(unsafe.reason).toBe(LEGEND_REFUSAL);
    expect(foreign.reason).toBe(unsafe.reason);
    expect(unsafe.reason).not.toContain('svc-east');

    const chosen = applyPreparation(
      burned,
      { kind: 'legend', cover: 'journalist', name: 'Marta' },
      content,
      { leaveRelief: relief, city },
    );
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) {
      return;
    }
    expect(chosen.value.view.officer.legends.at(-1)).toMatchObject({
      id: 'lg-2',
      cover: 'journalist',
      name: 'Marta',
      official: true,
    });
  });

  it('adopts a manifest only during preparation and records the choice', () => {
    const manifest: ContentManifest = {
      schema: 1,
      packs: [{ id: 'extra', version: '1.0.0', hash: 'abc' }],
    };
    const state = preparing();
    const adopted = step(state, { kind: 'choice', choice: { kind: 'adopt-manifest', manifest } }, content);
    expect(adopted.ok).toBe(true);
    if (!adopted.ok) {
      return;
    }
    expect(adopted.value.manifests).toHaveLength(state.manifests.length + 1);
    expect(adopted.value.manifests.at(-1)).toEqual(manifest);
    expect(lastChoice(adopted.value)).toEqual({ kind: 'adopt-manifest', manifest });

    const early = created();
    const refused = step(early, { kind: 'choice', choice: { kind: 'adopt-manifest', manifest } }, content);
    expect(refused.ok).toBe(false);
    expect(early.manifests).toEqual(state.manifests);
  });
});
