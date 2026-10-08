/**
 * Asset decisions: handover, exfiltration, and bring.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { BRING_REFUSAL, broughtPlacement } from './assets.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { loadCampaignConfig } from './config.js';
import { step } from './reducer.js';
import type { CampaignChoice, CampaignPersonId, CampaignState, CarriedAsset } from './state.js';

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

function asset(
  id: CampaignPersonId,
  archetype: string,
  hostileControlled: boolean,
  trust = 0.8,
): CarriedAsset {
  return {
    person: {
      id,
      archetype,
      name: 'Bruno',
      aliases: [],
      persona: {
        name: 'Bruno',
        given: 'Bruno',
        family: 'Bruno',
        library: '',
        culture: 'de',
        gender: 'male',
        voiceTraits: [],
        mannerisms: [],
        background: 'clerk',
        openness: 0.5,
      },
      descriptor: 'Bruno',
      allegiance: { true: '', apparent: '' },
      mice: asTruth({ money: 0, ideology: 0, coercion: 0, ego: 1 }),
      loyalty: 0,
      status: 'at-large',
      seen: [{ posting: 0, city: 'core' }],
    },
    trust,
    exposure: 0.2,
    reliability: 0.5,
    hostileControlled,
    turned: false,
    lever: 'ego',
    city: 'core',
    leftYear: 1950,
  };
}

function deciding(rows: readonly CarriedAsset[], careerPoints = 5): CampaignState {
  const state = created();
  return {
    ...state,
    step: { kind: 'assets' },
    view: {
      ...state.view,
      officer: { ...state.view.officer, careerPoints },
      staged: {
        ...state.view.staged,
        assets: rows.map((row) => ({
          id: row.person.id,
          name: row.person.name,
          rapport: 'trusted',
          history: 'recruited',
        })),
      },
    },
    truth: asTruth({ ...state.truth, stagedAssets: rows }),
  };
}

function decide(
  state: CampaignState,
  id: CampaignPersonId,
  decision: 'handover' | 'exfiltrate' | 'bring',
): ReturnType<typeof step> {
  return step(state, { kind: 'choice', choice: { kind: 'asset-decision', asset: id, decision } }, content);
}

function lastChoice(state: CampaignState): CampaignChoice | undefined {
  const entry = state.log.at(-1);
  return entry?.kind === 'choice' ? entry.choice : undefined;
}

describe('asset decisions', () => {
  it('hands an asset to the city and adds standing from its trust', () => {
    const kept = asset('cp-8', 'cafe-waiter', false, 0.4);
    const state = deciding([asset('cp-7', 'cafe-waiter', true, 0.8), kept]);
    const bonus = config.value.carry.handoverBonus;
    const handed = decide(state, 'cp-7', 'handover');
    expect(handed.ok).toBe(true);
    if (!handed.ok) {
      return;
    }
    const record = handed.value.truth.cities.core?.handedOver[0];
    expect(record?.person.id).toBe('cp-7');
    expect(record?.hostileControlled).toBe(true);
    expect(record?.trust).toBe(0.8);
    expect(handed.value.view.officer.careerStanding).toBe(bonus * 0.8);
    expect(handed.value.truth.stagedAssets.map((row) => row.person.id)).toEqual(['cp-8']);
    expect(handed.value.truth.stagedAssets[0]?.hostileControlled).toBe(false);
    expect(handed.value.truth.brought).toEqual([]);
    expect(handed.value.view.staged.assets.map((row) => row.id)).toEqual(['cp-8']);
    expect(handed.value.step).toEqual({ kind: 'assets' });
    expect(lastChoice(handed.value)).toEqual({
      kind: 'asset-decision',
      asset: 'cp-7',
      decision: 'handover',
    });

    const settled = JSON.stringify(handed.value);
    const again = decide(handed.value, 'cp-7', 'handover');
    expect(again.ok).toBe(false);
    expect(JSON.stringify(handed.value)).toBe(settled);
  });

  it('exfiltrates an asset for its cost and benefit, and refuses a short balance', () => {
    const sibling = asset('cp-8', 'friendly-journalist', true);
    const poor = deciding([asset('cp-7', 'cafe-waiter', false), sibling], 1);
    const before = JSON.stringify(poor);
    const refused = decide(poor, 'cp-7', 'exfiltrate');
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(poor)).toBe(before);

    const language = deciding([asset('cp-7', 'cafe-waiter', false), sibling], 5);
    const german = language.view.officer.skills.german?.level ?? 0;
    const taught = decide(language, 'cp-7', 'exfiltrate');
    expect(taught.ok).toBe(true);
    if (!taught.ok) {
      return;
    }
    expect(taught.value.view.officer.careerPoints).toBe(3);
    expect(taught.value.view.officer.skills.german?.level).toBe(german + 1);
    expect(taught.value.truth.stagedAssets.map((row) => row.person.id)).toEqual(['cp-8']);
    expect(taught.value.truth.stagedAssets[0]?.hostileControlled).toBe(true);
    expect(taught.value.truth.brought).toEqual([]);
    expect(taught.value.truth.cities.core).toBeUndefined();

    const lead = deciding([asset('cp-9', 'emigre-fixer', true)], 4);
    const extracted = decide(lead, 'cp-9', 'exfiltrate');
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) {
      return;
    }
    expect(extracted.value.view.officer.careerPoints).toBe(1);
    expect(extracted.value.truth.extraLeads).toBe(1);
    expect(extracted.value.truth.stagedAssets).toEqual([]);
    expect(extracted.value.truth.brought).toEqual([]);
    expect(extracted.value.step).toEqual({ kind: 'arcs' });

    const standing = deciding([asset('cp-10', 'friendly-journalist', false)], 2);
    const security = standing.view.officer.factions.security ?? 0;
    const reported = decide(standing, 'cp-10', 'exfiltrate');
    expect(reported.ok).toBe(true);
    if (!reported.ok) {
      return;
    }
    expect(reported.value.view.officer.factions.security).toBe(security + 1);
    expect(reported.value.view.officer.careerPoints).toBe(0);
  });

  it('brings only a mobile asset, as a contact with its trust and control flag', () => {
    const local = deciding([asset('cp-7', 'cafe-waiter', true)]);
    const before = JSON.stringify(local);
    const refused = decide(local, 'cp-7', 'bring');
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.kind === 'rejected' ? refused.error.reason : '').toBe(BRING_REFUSAL);
    }
    expect(JSON.stringify(local)).toBe(before);

    const state = deciding([asset('cp-9', 'emigre-fixer', true, 0.6)]);
    const brought = decide(state, 'cp-9', 'bring');
    expect(brought.ok).toBe(true);
    if (!brought.ok) {
      return;
    }
    const saved = brought.value.truth.brought[0];
    expect(saved?.person.id).toBe('cp-9');
    expect(saved?.hostileControlled).toBe(true);
    expect(saved?.trust).toBe(0.6);
    expect(brought.value.truth.stagedAssets).toEqual([]);
    expect(brought.value.truth.cities).toEqual({});
    expect(brought.value.view.officer.careerPoints).toBe(5);
    expect(brought.value.view.officer.careerStanding).toBe(state.view.officer.careerStanding);
    expect(brought.value.step).toEqual({ kind: 'arcs' });
    if (saved !== undefined) {
      expect(broughtPlacement(saved)).toMatchObject({
        as: 'asset',
        trust: 0.6,
        contact: true,
        hostileControlled: true,
        optional: false,
      });
    }
  });
});
