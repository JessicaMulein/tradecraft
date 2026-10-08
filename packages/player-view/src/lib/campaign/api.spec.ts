/**
 * Campaign API: HQ choices, an ended slice folded into the debrief, and save.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  campaignContent,
  campaignSources,
  loadCampaignConfig,
  loadCampaignContent,
  type CampaignChoice,
  type CampaignContent,
  type PostingResult,
  type RecruitmentWeights,
} from '@tradecraft/campaign';
import { asTruth } from '@tradecraft/engine';
import { afterEach, describe, expect, it } from 'vitest';

import type { EngineApi } from '../api/types.js';
import { createCampaignApi, type CampaignRuntime } from './api.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const sources = campaignSources([CORE], new Set(['core'])).sources;
const content = withCover(campaignContent(loaded.value, sources));
const loadedConfig = loadCampaignConfig(join(ROOT, 'config', 'campaign.yaml'));
if (!loadedConfig.ok) {
  throw new Error(loadedConfig.issues.map((issue) => issue.message).join('; '));
}
const config = loadedConfig.value;

const weights: RecruitmentWeights = {
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
  firstContact: { a: 1, b: 1, c: 1, d: 1 },
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
  exposure: { k1: 1, k2: 1, k3: 1 },
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
};

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function withCover(campaign: CampaignContent): CampaignContent {
  const bundle = {
    def: {
      id: 'core',
      name: 'Vienna',
      period: { from: 1948, to: 1962 },
      languages: [{ id: 'german' }],
      services: ['svc-east'],
    },
    covers: [{ id: 'clerk' }],
  } as unknown as CampaignContent['set']['cities'][string];
  return { ...campaign, set: { ...campaign.set, cities: { core: bundle } } };
}

function createChoice(seed: string): Extract<CampaignChoice, { kind: 'create' }> {
  return {
    kind: 'create',
    seed,
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  };
}

function quietResult(index: number): PostingResult {
  const saved = content.set.manifest;
  return {
    schema: 1,
    index,
    plotTemplate: 'rail-junction',
    plots: [
      {
        templateId: 'rail-junction',
        variantKey: 'rail-junction@1',
        archetype: 'sabotage',
        role: 'primary',
        outcome: 'succeeded',
      },
    ],
    stats: {
      decrypts: 0,
      recruits: 0,
      turned: 0,
      surveilObservations: 0,
      followsCompleted: 0,
      arrestsCorrect: 0,
      arrestsWrongful: 0,
      madeFactLines: 0,
      meetingsHeld: 0,
      dropsServiced: 0,
    },
    carry: {
      identified: [],
      unidentified: [],
      heldClaims: [],
      grades: [],
      notes: [],
      observedBurns: [],
    },
    debrief: {
      full: asTruth({
        outcome: 'success',
        cause: 'plot',
        sections: [{ id: 'plot', text: 'The posting ended.' }],
      }),
      redacted: {
        sections: [{ id: 'plot', items: [{ kind: 'shown', item: { text: 'The posting ended.' } }] }],
      },
    },
    extract: asTruth({
      survivingHostiles: [],
      assets: [],
      arcClues: [],
      service: 'svc-east',
      cityId: 'core',
    }),
    outcome: {
      schema: 1,
      outcome: 'success',
      endedAt: { day: 30, phase: 2 },
      seed: 'posting-seed',
      generatorVersion: '0.7.0',
      content: saved,
      difficulty: 'standard',
      standing: 1,
      directives: [],
      survivingAssets: [],
      cover: { identity: 'clerk', blown: false, suspicion: 0 },
      hostileMemory: {
        knownCover: false,
        suspectedAssets: [],
        compromisedChannels: [],
        compromisedDrops: [],
        doctrineShift: {},
      },
      budgetRemaining: 12,
    },
  };
}

function runtime(finished: PostingResult[]): CampaignRuntime {
  const saveRoot = mkdtempSync(join(tmpdir(), 'campaign-api-'));
  roots.push(saveRoot);
  const slice = {
    act() {
      return (async function* () {
        yield { kind: 'ended' as const, outcome: 'success' };
      })();
    },
  } as unknown as EngineApi;
  return {
    content,
    config,
    weights,
    saveRoot,
    startPosting() {
      return slice;
    },
    finishPosting(_api, index) {
      const result = quietResult(index);
      finished.push(result);
      return result;
    },
    postingLog() {
      return { actions: 'wait\n', recording: '' };
    },
  };
}

describe('campaign api', () => {
  it('opens a career at the offers step and refuses a choice that is not allowed', async () => {
    const api = createCampaignApi(runtime([]));
    const opened = await api.newCampaign(createChoice('career-seed'));
    expect(opened.officer.name).toBe('Ada');
    expect(opened.step).toBe('offers');
    expect(opened.offers.length).toBeGreaterThan(0);
    expect(api.hq.quote({ kind: 'advance' }).allowed).toBe(false);
    expect(api.hq.choose({ kind: 'advance' }).ok).toBe(false);
    expect(api.view().step).toBe('offers');
    expect(api.posting()).toBeNull();
    expect(api.officer().name).toBe('Ada');
    expect(api.enemies()).toEqual([]);
  });

  it('saves and loads the career view', async () => {
    const api = createCampaignApi(runtime([]));
    await api.newCampaign(createChoice('career-seed'));
    const saved = await api.saves.save();
    expect(api.saves.list().map((row) => row.id)).toContain(saved.id);
    const loaded = await api.saves.load(saved.id);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toEqual(api.view());
    }
  });

  it('folds an ended posting into the redacted debrief and saves it', async () => {
    const finished: PostingResult[] = [];
    const api = createCampaignApi(runtime(finished));
    await api.newCampaign(createChoice('career-seed'));
    const offer = api.view().offers[0];
    if (offer === undefined) {
      throw new Error('missing offer');
    }
    const accepted = api.hq.choose({ kind: 'accept-offer', offer: offer.id });
    expect(accepted.ok).toBe(true);
    const legend = api.hq.choose({ kind: 'legend', cover: 'clerk', name: 'Helen' });
    expect(legend.ok).toBe(true);
    const departed = api.hq.choose({ kind: 'advance' });
    expect(departed.ok).toBe(true);
    expect(api.view().step).toBe('posting');
    const posting = api.posting();
    if (posting === null) {
      throw new Error('expected a posting');
    }
    const chunks = [];
    for await (const chunk of posting.act({} as never)) {
      chunks.push(chunk.kind);
    }
    expect(chunks).toContain('ended');
    expect(finished).toHaveLength(1);
    expect(api.posting()).toBeNull();
    expect(api.view().step).toBe('debrief');
    expect(api.hq.step().kind).toBe('debrief');
    const timeline = api.archive().timeline;
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.debrief.sections[0]?.items[0]).toMatchObject({ kind: 'shown' });
    const saved = await api.saves.save();
    const loaded = await api.saves.load(saved.id);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.step).toBe('debrief');
      expect(loaded.value.officer.name).toBe('Ada');
    }
    expect(api.posting()).toBeNull();
  });
});
