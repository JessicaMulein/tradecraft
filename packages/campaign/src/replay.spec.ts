/**
 * Campaign replay folds the choice log and checks each rebuilt posting.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { loadCampaignConfig } from './config.js';
import { campaignContent, type CampaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { step } from './reducer.js';
import { postingResultHash, ReplayFailed, replayCampaign, type PostingLogEntry } from './replay.js';
import type { CampaignChoice, CampaignLogEntry, CampaignState, PostingResult } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const sources = campaignSources([CORE], new Set(['core'])).sources;
const base = campaignContent(loaded.value, sources);
const content = withCover(base);
const config = loadCampaignConfig(join(ROOT, 'config', 'campaign.yaml'));
if (!config.ok) {
  throw new Error(config.issues.map((issue) => issue.message).join('; '));
}
const manifest = loaded.value.manifest;

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
  return {
    ...campaign,
    set: { ...campaign.set, cities: { core: bundle } },
  };
}

function must(result: { ok: true; value: CampaignState } | { ok: false; error: { reason: string } }): CampaignState {
  if (!result.ok) {
    throw new Error(result.error.reason);
  }
  return result.value;
}

function choose(state: CampaignState | undefined, choice: CampaignChoice): CampaignState {
  return must(step(state, { kind: 'choice', choice }, content));
}

function departed(): CampaignState {
  const created = choose(undefined, {
    kind: 'create',
    seed: 'career-seed',
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  });
  const offer = created.view.offers[0];
  if (offer === undefined) {
    throw new Error('missing offer');
  }
  const accepted = choose(created, { kind: 'accept-offer', offer: offer.id });
  const legend = choose(accepted, { kind: 'legend', cover: 'clerk', name: 'Helen' });
  return choose(legend, { kind: 'advance' });
}

function quietResult(state: CampaignState): PostingResult {
  const saved = state.manifests[0];
  if (saved === undefined) {
    throw new Error('missing manifest');
  }
  return {
    schema: 1,
    index: state.postings,
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

describe('campaign replay', () => {
  it('folds a choice log back to the same campaign', () => {
    const created = choose(undefined, {
      kind: 'create',
      seed: 'career-seed',
      preset: 'standard',
      officerName: 'Ada',
      background: 'analyst',
      startYear: 1948,
    });
    const offer = created.view.offers[0];
    if (offer === undefined) {
      throw new Error('missing offer');
    }
    const accepted = choose(created, { kind: 'accept-offer', offer: offer.id });
    const replayed = replayCampaign('career-seed', accepted.log, () => content, () => {
      throw new Error('no posting');
    }, { manifest, config: config.value });
    expect(replayed).toEqual(accepted);
  });

  it('rebuilds a posting from its log and checks the result hash', () => {
    const state = departed();
    if (state.step.kind !== 'posting') {
      throw new Error('expected a posting');
    }
    const result = quietResult(state);
    const entry: PostingLogEntry = {
      seq: state.log.length + 1,
      kind: 'posting',
      index: state.step.ctx.index,
      seed: state.step.ctx.seed,
      manifest,
      actions: '{"kind":"wait"}\n',
      recording: '',
      resultHash: postingResultHash(result),
    };
    const log: CampaignLogEntry[] = [...state.log, entry];
    let seen: PostingLogEntry | undefined;
    const replayed = replayCampaign(
      'career-seed',
      log,
      () => content,
      (posting) => {
        seen = posting;
        return result;
      },
      { manifest, config: config.value },
    );
    expect(seen).toEqual(entry);
    expect(replayed.postings).toBe(1);
    expect(replayed.step).toEqual({ kind: 'debrief' });
    expect(replayed.log).toEqual(log);
    expect(replayed.archive.visible).toHaveLength(1);
  });

  it('refuses a mismatched result hash and a choice the log should not contain', () => {
    const state = departed();
    if (state.step.kind !== 'posting') {
      throw new Error('expected a posting');
    }
    const result = quietResult(state);
    const entry: PostingLogEntry = {
      seq: state.log.length + 1,
      kind: 'posting',
      index: state.step.ctx.index,
      seed: state.step.ctx.seed,
      manifest,
      actions: '',
      recording: '',
      resultHash: 'deadbeef',
    };
    expect(() =>
      replayCampaign('career-seed', [...state.log, entry], () => content, () => result, {
        manifest,
        config: config.value,
      }),
    ).toThrow(ReplayFailed);

    const rejected: CampaignLogEntry = {
      seq: state.log.length + 1,
      kind: 'choice',
      choice: { kind: 'train', skill: 'cryptanalysis' },
    };
    expect(() =>
      replayCampaign('career-seed', [...state.log, rejected], () => content, () => result, {
        manifest,
        config: config.value,
      }),
    ).toThrow(/rejected/);
  });
});
