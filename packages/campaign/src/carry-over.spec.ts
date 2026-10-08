/**
 * Carry-over folds a valid posting and refuses a corrupt one without touching
 * the campaign state it was given.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth, type Persona } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { carryOver } from './carry-over.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { loadCampaignConfig } from './config.js';
import { step } from './reducer.js';
import type { CampaignChoice, CampaignState, CarriedNpc, PostingResult } from './state.js';

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

function posting(): CampaignState {
  const state = created();
  return {
    ...state,
    step: { kind: 'posting', ctx: { index: 0, seed: 'posting-seed' } },
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
      officer: {
        ...state.view.officer,
        stress: 70,
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
  };
}

function face(name: string): Persona {
  return {
    name,
    given: name,
    family: name,
    library: 'core',
    culture: 'de',
    gender: 'male',
    voiceTraits: [],
    mannerisms: [],
    background: 'clerk',
    openness: 0.5,
  };
}

function hostile(): CarriedNpc {
  return {
    id: 'cp-4',
    archetype: 'hostile-officer',
    name: 'Otto',
    aliases: [],
    persona: face('Otto'),
    descriptor: 'a grey coat',
    allegiance: { true: 'svc-east', apparent: 'svc-east' },
    mice: asTruth({ money: 0, ideology: 1, coercion: 0, ego: 0 }),
    loyalty: 0.4,
    service: 'svc-east',
    status: 'at-large',
    seen: [{ posting: 0, city: 'core' }],
  };
}

function resultOf(state: CampaignState): PostingResult {
  const manifest = state.manifests[0];
  if (manifest === undefined) {
    throw new Error('missing manifest');
  }
  return {
    schema: 1,
    index: 0,
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
      decrypts: 3,
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
      observedBurns: ['lg-1'],
    },
    debrief: {
      full: asTruth({
        outcome: 'failure-burned',
        cause: 'burned',
        sections: [{ id: 'plot', text: 'The cover failed.' }],
      }),
      redacted: {
        sections: [{ id: 'plot', items: [{ kind: 'shown', item: { text: 'The cover failed.' } }] }],
      },
    },
    extract: asTruth({
      survivingHostiles: [hostile()],
      assets: [],
      arcClues: [],
      service: 'svc-east',
      cityId: 'core',
    }),
    outcome: {
      schema: 1,
      outcome: 'failure-burned',
      endedAt: { day: 30, phase: 2 },
      seed: 'posting-seed',
      generatorVersion: '0.7.0',
      content: manifest,
      difficulty: 'standard',
      standing: 4,
      directives: [],
      survivingAssets: [
        {
          npc: 'npc:cp-7',
          archetype: 'courier',
          persona: { name: 'Bruno', culture: 'de', background: 'clerk' },
          lever: 'ego',
          trust: 0.8,
          exposure: 0.2,
          doubled: true,
        },
      ],
      cover: { identity: 'clerk', blown: true, suspicion: 0.4 },
      hostileMemory: {
        knownCover: true,
        suspectedAssets: [],
        compromisedChannels: ['chan:radio'],
        compromisedDrops: ['drop:warehouse'],
        doctrineShift: { riskTolerance: 0.3 },
      },
      budgetRemaining: 12,
    },
  };
}

describe('carry-over', () => {
  it('archives the posting, advances the tour, and stages the consequences', () => {
    const state = posting();
    const result = resultOf(state);
    const before = JSON.stringify(state);
    const arcs = state.truth.arcs;
    const folded = carryOver(state, result, content, config.value);
    const again = carryOver(state, result, content, config.value);
    expect(JSON.stringify(state)).toBe(before);
    expect(folded.ok).toBe(true);
    expect(again.ok).toBe(true);
    if (!folded.ok || !again.ok) {
      return;
    }
    expect(again.value).toEqual(folded.value);

    const next = folded.value;
    expect(next.postings).toBe(1);
    expect(next.step).toEqual({ kind: 'debrief' });
    expect(next.calendar.year).toBe(1950);
    expect(next.archive.visible).toHaveLength(1);
    expect(next.archive.visible[0]).toMatchObject({
      index: 0,
      city: 'core',
      year: 1948,
      legend: 'lg-1',
      outcome: 'failure-burned',
      plotTemplate: 'rail-junction',
    });
    expect(next.truth.archive).toHaveLength(1);
    expect(next.truth.archive[0]?.debrief.sections[0]?.text).toBe('The cover failed.');
    expect(next.truth.arcs).toBe(arcs);

    const officer = next.view.officer;
    expect(officer.skills.cryptanalysis).toEqual({ level: 2, xp: 3 });
    expect(officer.stress).toBe(90);
    expect(officer.traits).toContain('strained');
    expect(officer.traits).toContain('methodical');
    expect(officer.rank).toBe('case-officer');
    expect(officer.reprimands).toBe(0);
    expect(officer.careerPoints).toBe(0);
    expect(officer.careerStanding).toBe(4);
    expect(officer.legends[0]?.observedBurnedBy).toEqual(['svc-east']);
    expect(next.view.staged.review).toMatchObject({ decision: 'reprimand', score: -5.5 });

    const dossier = next.truth.dossiers['svc-east'];
    expect(dossier?.burnedLegends).toEqual(['lg-1']);
    expect(dossier?.descriptorKnown).toBe(true);
    expect(dossier?.notoriety).toBeCloseTo(0.45);
    expect(dossier?.patterns).toEqual([{ locType: 'warehouse', uses: 1 }]);
    expect(dossier?.channelKinds).toEqual([{ kind: 'radio', uses: 1 }]);
    expect(dossier?.doctrineShift.riskTolerance).toBe(0.2);

    expect(next.truth.stagedAssets).toHaveLength(1);
    expect(next.truth.stagedAssets[0]).toMatchObject({
      trust: 0.8,
      hostileControlled: true,
      city: 'core',
      leftYear: 1950,
      person: { id: 'cp-7', name: 'Bruno' },
    });
    expect(next.view.staged.assets).toEqual([
      { id: 'cp-7', name: 'Bruno', rapport: 'trusted', history: 'core, 1950' },
    ]);
    expect(next.truth.carriedHostiles.map((row) => row.id)).toEqual(['cp-4']);
  });

  it('advances an arc from a held clue, and a truth clue only records', () => {
    const state = posting();
    const base = resultOf(state);
    const held = carryOver(
      state,
      {
        ...base,
        carry: {
          ...base.carry,
          heldClaims: [
            {
              id: 'mole-access',
              prop: {
                id: 'prop:mole-access',
                subject: 'npc:cp-1',
                predicate: 'KNOWS',
                object: 'org:svc-east',
              },
              text: 'A cable header matches one officer.',
              relation: 'none',
            },
          ],
        },
      },
      content,
      config.value,
    );
    expect(held.ok).toBe(true);
    if (!held.ok) {
      return;
    }
    expect(held.value.truth.arcs['mole-hunt']?.stage).toBe('charge');
    expect(held.value.truth.arcs['mole-hunt']?.clues['mole-access']).toBe(true);

    const present = carryOver(
      state,
      {
        ...base,
        extract: asTruth({
          ...base.extract,
          arcClues: [{ clue: 'mole-access', present: true }],
        }),
      },
      content,
      config.value,
    );
    expect(present.ok).toBe(true);
    if (!present.ok) {
      return;
    }
    expect(present.value.truth.arcs['mole-hunt']?.stage).toBe('rumour');
    expect(present.value.truth.arcs['mole-hunt']?.clues['mole-access']).toBe(true);
  });

  it('rejects a corrupt result with its field path and leaves the state unchanged', () => {
    const state = posting();
    const result = resultOf(state);
    const before = JSON.stringify(state);
    const corrupt = {
      ...result,
      outcome: { ...result.outcome, standing: 'no' },
    } as unknown as PostingResult;
    const folded = carryOver(state, corrupt, content, config.value);
    expect(folded.ok).toBe(false);
    if (folded.ok) {
      return;
    }
    expect(folded.error.paths).toContain('outcome.standing');
    expect(JSON.stringify(state)).toBe(before);

    const wrongSchema = { ...result, schema: 2 } as unknown as PostingResult;
    const rejected = carryOver(state, wrongSchema, content, config.value);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) {
      return;
    }
    expect(rejected.error.paths).toContain('schema');
  });
});
