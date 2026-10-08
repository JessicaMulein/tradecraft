/**
 * Captures and campaign end: expulsion, the capture draw, and the only
 * path that sets `ended`.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth, type Prng } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { loadCampaignConfig } from './config.js';
import {
  applyCapture,
  closeCampaign,
  endTrigger,
  ERA_LAST_YEAR,
  resolveBurn,
  resolveCapture,
} from './endings.js';
import { step } from './reducer.js';
import type { CampaignChoice, CampaignState, Officer } from './state.js';

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

const options = {
  capture: config.value.capture,
  burned: config.value.stress.burned,
  captureStress: config.value.stress.capture,
  archiveReveal: config.value.archiveReveal,
};

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

function officer(patch: Partial<Officer> = {}): Officer {
  return { ...created().view.officer, careerStanding: 0, traits: [], ...patch };
}

/** A scripted stream. `next` returns the next value in `[0, 1)`. */
function rolls(values: readonly number[]): Prng {
  let index = 0;
  const next = (): number => {
    const value = values[index] ?? 0;
    index += 1;
    return value;
  };
  return {
    nextUint32: () => 0,
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    bool: (probability = 0.5) => next() < probability,
    pick: (items) => {
      const item = items[0];
      if (item === undefined) {
        throw new Error('empty pick');
      }
      return item;
    },
    shuffle: (items) => [...items],
    state: () => [0, 0, 0, 0],
  };
}

function withLegend(state: CampaignState): CampaignState {
  return {
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
    truth: asTruth({
      ...state.truth,
      archive: [
        {
          debrief: { outcome: 'failure-burned', cause: 'burned', sections: [{ id: 'plot', text: 'The cover failed.' }] },
          extract: {
            survivingHostiles: [],
            assets: [],
            arcClues: [],
            service: 'svc-east',
            cityId: 'core',
          },
        },
      ],
    }),
  };
}

describe('captures and campaign end', () => {
  it('draws death, exchange, or imprisonment from standing, tension, and strain', () => {
    const odds = options.capture;
    const calm = officer();
    expect(resolveCapture(calm, 0.5, odds, rolls([0]))).toEqual({ kind: 'death' });
    expect(resolveCapture(calm, 0.5, odds, rolls([0.99, 0]))).toEqual({
      kind: 'exchange',
      yearsLost: 1,
      defectionOffer: false,
    });
    expect(resolveCapture(calm, 0.5, odds, rolls([0.99, 0.99, 0]))).toEqual({
      kind: 'imprisonment',
      yearsLost: 1,
      defectionOffer: true,
    });

    const worn = officer({ traits: ['strained'] });
    expect(resolveCapture(worn, 0.5, odds, rolls([0.22])).kind).toBe('death');
    expect(resolveCapture(calm, 0.5, odds, rolls([0.22, 0])).kind).toBe('exchange');

    const senior = officer({ careerStanding: 10 });
    expect(resolveCapture(senior, 0.5, odds, rolls([0.99, 0.8])).kind).toBe('exchange');
    expect(resolveCapture(calm, 0.5, odds, rolls([0.99, 0.8])).kind).toBe('imprisonment');

    const again = resolveCapture(calm, 0.5, odds, rolls([0.99, 0.99, 0.5]));
    expect(resolveCapture(calm, 0.5, odds, rolls([0.99, 0.99, 0.5]))).toEqual(again);
  });

  it('expels an official cover and captures a non-official one', () => {
    const state = withLegend(created());
    const expelled = resolveBurn(
      state,
      { blown: true, official: true, legend: 'lg-1', service: 'svc-east', tension: 0.5 },
      content,
      options,
    );
    expect(expelled.step.kind).not.toBe('ended');
    expect(expelled.view.staged.capture).toBeUndefined();
    expect(expelled.view.officer.stress).toBe(options.burned);
    expect(expelled.view.officer.legends[0]?.observedBurnedBy).toEqual(['svc-east']);
    expect(expelled.truth.dossiers['svc-east']?.burnedLegends).toEqual(['lg-1']);

    const twice = resolveBurn(
      expelled,
      { blown: true, official: true, legend: 'lg-1', service: 'svc-east', tension: 0.5 },
      content,
      options,
    );
    expect(twice.truth.dossiers['svc-east']?.burnedLegends).toEqual(['lg-1']);
    expect(twice.view.officer.legends[0]?.observedBurnedBy).toEqual(['svc-east']);

    const quiet = resolveBurn(
      state,
      { blown: false, official: false, legend: 'lg-1', service: 'svc-east', tension: 0.5 },
      content,
      options,
    );
    expect(quiet).toBe(state);

    const dead = applyCapture(state, 0.5, content, {
      ...options,
      capture: { deathBase: 1, deathMin: 1, deathMax: 1 },
    });
    expect(dead.step).toMatchObject({ kind: 'ended', end: { kind: 'death', at: { year: 1948, posting: 0 } } });
    expect(dead.calendar.year).toBe(1948);
    expect(dead.view.officer.stress).toBe(0);
    expect(dead.archive.reveal?.hqMole).toBe(state.truth.hqMole);
    expect(dead.archive.reveal?.debriefs).toEqual([
      { outcome: 'failure-burned', cause: 'burned', sections: [{ id: 'plot', text: 'The cover failed.' }] },
    ]);
    expect(closeCampaign(dead, 'at-end')).toBe(dead);

    const held = applyCapture(state, 0.5, content, {
      ...options,
      capture: { deathBase: 0, deathMin: 0, deathMax: 0 },
    });
    const capture = held.view.staged.capture;
    expect(capture?.kind === 'exchange' || capture?.kind === 'imprisonment').toBe(true);
    if (capture !== undefined && capture.kind !== 'death') {
      expect(held.calendar.year).toBe(1948 + capture.yearsLost);
      expect(capture.yearsLost).toBeGreaterThanOrEqual(1);
      expect(capture.yearsLost).toBeLessThanOrEqual(3);
      expect(held.view.officer.stress).toBe(options.captureStress);
      expect(held.step.kind).not.toBe('ended');
    }
  });

  it('ends only through endTrigger, including retirement, defection, disgrace, and 1962', () => {
    const base = withLegend(created());
    expect(endTrigger(base)).toBeNull();
    expect(endTrigger({ ...base, calendar: { year: ERA_LAST_YEAR } })).toBeNull();

    const late = closeCampaign({ ...base, calendar: { year: ERA_LAST_YEAR + 1 } }, 'at-end');
    expect(late.step).toMatchObject({
      kind: 'ended',
      end: { kind: 'retirement', cause: 'The calendar passed 1962.' },
    });

    const sealed = closeCampaign({ ...base, calendar: { year: 1963 } }, 'never');
    expect(sealed.step.kind).toBe('ended');
    expect(sealed.archive.reveal).toBeUndefined();

    const dismissed = closeCampaign(
      {
        ...base,
        view: {
          ...base.view,
          staged: {
            ...base.view.staged,
            review: { score: -9, decision: 'dismiss', text: 'Dismissed.' },
          },
        },
      },
      'at-end',
    );
    expect(dismissed.step).toMatchObject({ kind: 'ended', end: { kind: 'disgrace' } });

    const early = { ...base, step: { kind: 'end-offers' as const }, postings: 2 };
    const before = JSON.stringify(early);
    const refused = step(early, { kind: 'choice', choice: { kind: 'retire' } }, content);
    expect(refused.ok).toBe(false);
    expect(JSON.stringify(early)).toBe(before);

    const veteran = { ...base, step: { kind: 'end-offers' as const }, postings: 3 };
    const retired = step(veteran, { kind: 'choice', choice: { kind: 'retire' } }, content);
    expect(retired.ok).toBe(true);
    if (!retired.ok) {
      return;
    }
    expect(retired.value.step).toMatchObject({
      kind: 'ended',
      end: { kind: 'retirement', cause: 'Retired after three postings.', at: { posting: 3 } },
    });
    expect(retired.value.archive.reveal?.arcs).toBe(veteran.truth.arcs);

    const noOffer = { ...base, step: { kind: 'end-offers' as const } };
    const unwanted = step(noOffer, { kind: 'choice', choice: { kind: 'defect' } }, content);
    expect(unwanted.ok).toBe(false);

    const offered = {
      ...base,
      step: { kind: 'end-offers' as const },
      view: { ...base.view, staged: { ...base.view.staged, endOffers: ['defect' as const] } },
    };
    const defected = step(offered, { kind: 'choice', choice: { kind: 'defect' } }, content);
    expect(defected.ok).toBe(true);
    if (!defected.ok) {
      return;
    }
    expect(defected.value.step).toMatchObject({ kind: 'ended', end: { kind: 'defection' } });

    const stayed = step(
      { ...base, step: { kind: 'end-offers' } },
      { kind: 'choice', choice: { kind: 'decline-end-offer' } },
      content,
    );
    expect(stayed.ok).toBe(true);
    if (!stayed.ok) {
      return;
    }
    expect(stayed.value.step).toEqual({ kind: 'offers' });

    const passed = step(
      { ...base, step: { kind: 'end-offers' }, calendar: { year: 1963 } },
      { kind: 'choice', choice: { kind: 'decline-end-offer' } },
      content,
    );
    expect(passed.ok).toBe(true);
    if (!passed.ok) {
      return;
    }
    expect(passed.value.step).toMatchObject({
      kind: 'ended',
      end: { kind: 'retirement', cause: 'The calendar passed 1962.' },
    });
  });
});
