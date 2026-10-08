import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrng } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { quoteChoice, selectHqCast, step } from './reducer.js';
import { campaignStream, postingSeed } from './seed.js';
import { campaignView } from './view.js';
import type { CampaignChoice } from './state.js';

const CORE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'content',
  'packs',
  'core',
);

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(
  loaded.value,
  campaignSources([CORE], new Set(['core'])).sources,
);

function createChoice(seed?: string): Extract<CampaignChoice, { kind: 'create' }> {
  return {
    kind: 'create',
    ...(seed === undefined ? {} : { seed }),
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  };
}

function keysOf(value: unknown, found: string[] = []): string[] {
  if (value === null || typeof value !== 'object') {
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    found.push(key);
    keysOf(child, found);
  }
  return found;
}

describe('campaign creation', () => {
  it('records the seed, preset, officer and manifest, and draws the cast on the campaign stream', () => {
    const choice = createChoice('career-seed');
    const first = step(undefined, { kind: 'choice', choice }, content);
    const second = step(undefined, { kind: 'choice', choice }, content);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.value).toEqual(first.value);

    const state = first.value;
    expect(state.seed).toBe('career-seed');
    expect(state.preset).toBe('core/standard');
    expect(state.calendar.year).toBe(1948);
    expect(state.manifests).toEqual([loaded.value.manifest]);
    expect(state.step).toEqual({ kind: 'offers' });
    expect(state.view.officer).toMatchObject({
      name: 'Ada',
      background: 'analyst',
      rank: 'case-officer',
      traits: ['methodical'],
      factions: { security: 1 },
      skills: {
        cryptanalysis: { level: 1, xp: 0 },
        german: { level: 1, xp: 0 },
      },
    });

    const drawn = selectHqCast(content.hqCast, createPrng(campaignStream('career-seed')));
    expect(state.view.hqCast.map((person) => person.name)).toEqual(drawn.cast.map((person) => person.name));
    expect(state.view.hqCast.length).toBeGreaterThanOrEqual(5);
    expect(state.view.hqCast.length).toBeLessThanOrEqual(7);
    expect(state.view.hqCast.map((person) => person.id)).toEqual(
      state.view.hqCast.map((_, index) => `cp-${index + 1}`),
    );
    const mole = state.view.hqCast[drawn.mole];
    expect(mole).toBeDefined();
    expect(state.truth.hqMole).toBe(mole?.id);
    expect(state.truth.hqFigures.map((figure) => figure.id)).toEqual(
      state.view.hqCast.map((person) => person.id),
    );
    expect(state.truth.arcs['mole-hunt']?.bindings.mole).toBe(state.truth.hqMole);
    expect(state.truth.arcs['nemesis']?.bindings.nemesis).toBe(`cp-${drawn.cast.length + 1}`);
    expect(state.truth.nemesis).toBe(`cp-${drawn.cast.length + 1}`);
    expect(state.view.arcs.map((arc) => arc.id).sort()).toEqual(['mole-hunt', 'nemesis']);

    const visible = keysOf(campaignView(state));
    expect(visible).not.toContain('hqMole');
    expect(visible).not.toContain('access');
    expect(visible).not.toContain('bindings');
    expect(visible).not.toContain('hostileControlled');

    expect(state.log).toEqual([
      { seq: 1, kind: 'choice', choice },
    ]);
  });

  it('mints a seed when the choice does not name one and records that seed', () => {
    const result = step(undefined, { kind: 'choice', choice: createChoice() }, content);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.seed.length).toBeGreaterThan(0);
    expect(result.value.log[0]).toMatchObject({
      kind: 'choice',
      choice: { kind: 'create', seed: result.value.seed },
    });
  });

  it('rejects a disallowed choice and leaves the state unchanged', () => {
    const created = step(undefined, { kind: 'choice', choice: createChoice('career-seed') }, content);
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const before = structuredClone(created.value);
    const quote = quoteChoice(
      created.value,
      { kind: 'train', skill: 'cryptanalysis' },
      content,
    );
    expect(quote.allowed).toBe(false);
    const rejected = step(
      created.value,
      { kind: 'choice', choice: { kind: 'train', skill: 'cryptanalysis' } },
      content,
    );
    expect(rejected).toEqual({
      ok: false,
      error: { kind: 'rejected', reason: quote.reason },
    });
    expect(created.value).toEqual(before);

    const early = step(
      undefined,
      { kind: 'choice', choice: { ...createChoice('x'), kind: 'create', startYear: 1951 } },
      content,
    );
    expect(early.ok).toBe(false);
    const unknown = step(
      undefined,
      { kind: 'choice', choice: { ...createChoice('x'), kind: 'create', background: 'sailor' } },
      content,
    );
    expect(unknown.ok).toBe(false);
    const blank = step(
      undefined,
      { kind: 'choice', choice: { ...createChoice('x'), kind: 'create', officerName: '' } },
      content,
    );
    expect(blank.ok).toBe(false);
    const posted = step(
      created.value,
      { kind: 'posting-result', index: 0, result: {} as never },
      content,
    );
    expect(posted.ok).toBe(false);
    expect(created.value).toEqual(before);
  });
});

describe('HQ phase handlers', () => {
  function career() {
    const created = step(undefined, { kind: 'choice', choice: createChoice('career-seed') }, content);
    if (!created.ok) {
      throw new Error(created.error.reason);
    }
    return created.value;
  }

  it('accepts an offer, then departs once a legend is chosen', () => {
    const state = career();
    const offer = state.view.offers[0];
    if (offer === undefined) {
      throw new Error('missing offer');
    }
    const accepted = step(state, { kind: 'choice', choice: { kind: 'accept-offer', offer: offer.id } }, content);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.value.step).toEqual({ kind: 'prepare' });
    expect(accepted.value.view.chosen).toBe(offer.id);

    const early = step(accepted.value, { kind: 'choice', choice: { kind: 'advance' } }, content);
    expect(early.ok).toBe(false);

    const ready = {
      ...accepted.value,
      view: {
        ...accepted.value.view,
        officer: {
          ...accepted.value.view.officer,
          legends: [
            {
              id: 'lg-1' as const,
              cover: 'clerk',
              name: 'Marta',
              official: true,
              posting: 0,
              observedBurnedBy: [],
            },
          ],
        },
      },
    };
    const departed = step(ready, { kind: 'choice', choice: { kind: 'advance' } }, content);
    expect(departed.ok).toBe(true);
    if (!departed.ok) {
      return;
    }
    expect(departed.value.step).toEqual({
      kind: 'posting',
      ctx: { index: 0, seed: postingSeed('career-seed', 0) },
    });
  });

  it('reads the debrief, applies the review, and opens an accusation', () => {
    const state = career();
    const debrief = step(
      { ...state, step: { kind: 'debrief' } },
      { kind: 'choice', choice: { kind: 'advance' } },
      content,
    );
    expect(debrief.ok).toBe(true);
    if (!debrief.ok) {
      return;
    }
    expect(debrief.value.step).toEqual({ kind: 'review' });

    const reviewed = step(
      {
        ...debrief.value,
        view: {
          ...debrief.value.view,
          staged: {
            ...debrief.value.view.staged,
            review: { score: 6, decision: 'promote', text: 'The board promotes Ada.' },
          },
        },
      },
      { kind: 'choice', choice: { kind: 'advance' } },
      content,
    );
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) {
      return;
    }
    expect(reviewed.value.view.officer.rank).toBe('senior-case-officer');
    expect(reviewed.value.view.officer.careerPoints).toBe(6);
    expect(reviewed.value.step).toEqual({ kind: 'assets' });

    const mole = state.truth.hqMole;
    const accused = state.view.hqCast.find((figure) => figure.id === mole);
    const other = state.view.hqCast.find((figure) => figure.id !== mole);
    if (accused === undefined || other === undefined) {
      throw new Error('missing cast');
    }
    const claims = (id: string) =>
      (['KNOWS', 'MEETS_AT', 'MEMBER_OF'] as const).map((predicate) => ({
        id: `${id}-${predicate}`,
        prop: {
          id: `prop:${id}-${predicate}`,
          subject: `npc:${id}` as const,
          predicate,
          object: 'org:svc-east' as const,
        },
        text: predicate,
        relation: 'corroborated' as const,
      }));
    const onArcs = {
      ...state,
      step: { kind: 'arcs' as const },
      archive: {
        visible: [
          {
            index: 0,
            city: 'core',
            year: 1948,
            legend: 'lg-1' as const,
            rankAtStart: 'case-officer' as const,
            outcome: 'success' as const,
            redacted: { sections: [] },
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
              heldClaims: claims(other.id),
              grades: [],
              notes: [],
              observedBurns: [],
            },
            caseFileRef: 'case-file:0',
            plotTemplate: 'rail-junction',
            plots: [],
          },
        ],
      },
    };
    const wrong = step(onArcs, { kind: 'choice', choice: { kind: 'accuse', figure: other.id } }, content);
    expect(wrong.ok).toBe(true);
    if (!wrong.ok) {
      return;
    }
    expect(wrong.value.view.officer.reprimands).toBe(1);
    expect(wrong.value.view.staged.accusation?.text).toContain(other.name);
    expect(wrong.value.view.staged.accusation?.text).not.toContain(accused.name);
    expect(wrong.value.truth.hqMole).toBe(mole);
    expect(wrong.value.view.hqCast.map((figure) => figure.id)).toContain(mole);

    const rightState = {
      ...onArcs,
      archive: {
        visible: [
          {
            ...onArcs.archive.visible[0],
            carry: { ...onArcs.archive.visible[0].carry, heldClaims: claims(mole) },
          },
        ],
      },
    };
    const right = step(rightState, { kind: 'choice', choice: { kind: 'accuse', figure: mole } }, content);
    expect(right.ok).toBe(true);
    if (!right.ok) {
      return;
    }
    expect(right.value.view.officer.careerStanding).toBe(state.view.officer.careerStanding + 2);
    expect(right.value.view.hqCast.map((figure) => figure.id)).not.toContain(mole);
    expect(right.value.view.arcs.find((arc) => arc.id === 'mole-hunt')?.status).toBe('resolved');
    expect(right.value.truth.hqMole).toBe(mole);

    const onward = step(right.value, { kind: 'choice', choice: { kind: 'advance' } }, content);
    expect(onward.ok).toBe(true);
    if (!onward.ok) {
      return;
    }
    expect(onward.value.step).toEqual({ kind: 'end-offers' });
  });
});
