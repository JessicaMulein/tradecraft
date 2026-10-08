/**
 * Example-based tests for the scenario config schema and loader (task 2.7).
 *
 * These are not property tests. They pin two concrete contracts the design
 * calls for: the shipped `config/scenario.yaml` parses, validates and resolves
 * against a Content Set with the `standard` preset; and representative bad
 * fields — a bad YAML, an unknown preset, an unknown pack, an out-of-range
 * override, an unknown override field and a missing recruitment weight — are
 * each reported as a `ConfigIssue` carrying the file and the dotted field path
 * (Requirements 41.1, 41.2, 41.3).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import type { DifficultyPreset } from '@tradecraft/content';
import { describe, expect, it } from 'vitest';

import {
  formatConfigIssues,
  parseScenarioConfig,
  type ScenarioResolutionContext,
} from './load-scenario-config.js';

// --- fixtures ---------------------------------------------------------------

/** The repo-root `config/scenario.yaml`, relative to this test file. */
const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../..',
);
const SCENARIO_YAML_PATH = resolve(REPO_ROOT, 'config/scenario.yaml');

/** The `standard` Difficulty Preset from the design's table. */
const STANDARD: DifficultyPreset = {
  id: 'standard',
  plot: { stageCount: 5, deadlineSlackDays: 2 },
  noiseCounts: { backgroundNpcs: 16, sideThreads: 2, rumours: 6 },
  noiseTrafficRatio: { noise: 2, plot: 1 },
  hqFalseBeliefRate: 0.15,
  doctrine: {
    risk: { min: 0.3, max: 0.6 },
    security: { min: 0.3, max: 0.6 },
    deception: { min: 0.3, max: 0.6 },
  },
  detectionBase: { surveil: 0.1, meeting: 0.06, drop: 0.04 },
  madeRevealProbability: 0.6,
  tradecraftErrorProbability: 0.3,
  allowedCiphers: ['caesar', 'vigenere', 'columnar', 'book', 'otp'],
  arrest: {
    threshold: 3,
    wrongfulAuthorityPenalty: -1,
    wrongfulRaisesAlertness: false,
  },
  startingBudget: 3000,
  traceRequestDelayPhases: 2,
  coverSuspicionBurnThreshold: 0.8,
  hintsDefault: true,
};

/** A resolution context that knows the standard preset and the core pack. */
const CONTEXT: ScenarioResolutionContext = {
  presets: new Map([['standard', STANDARD]]),
  availablePackIds: new Set(['core']),
};

/**
 * A resolution context that also loads one City Pack (Vienna, start-date window
 * 1948..1950) and an Era Pack (Period Window 1945..1965), used to exercise the
 * setting checks (content-expansion Req 9.1).
 */
const SETTING_CONTEXT: ScenarioResolutionContext = {
  presets: new Map([['standard', STANDARD]]),
  availablePackIds: new Set(['core', 'city-vienna', 'era-cold-war-early']),
  cities: new Map([
    ['city-vienna/vienna', { startDates: { from: '1948-01-01', to: '1950-12-31' } }],
  ]),
  eraPeriod: { from: 1945, to: 1965 },
};

/** A minimal valid scenario document as text, for mutation in bad-field tests. */
const MINIMAL = `
difficulty:
  preset: standard
recruitment:
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 }
  firstContact: { a: 1, b: 1, c: 1, d: 1 }
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 }
  exposure: { k1: 1, k2: 1, k3: 1 }
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 }
`;

// --- the shipped default validates -----------------------------------------

describe('the shipped config/scenario.yaml', () => {
  it('parses, validates and resolves against the standard preset', () => {
    const text = readFileSync(SCENARIO_YAML_PATH, 'utf8');
    const result = parseScenarioConfig(text, SCENARIO_YAML_PATH, CONTEXT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // It selects standard, loads core and runs full narration (design default).
    expect(result.value.scenario.difficulty.preset).toBe('standard');
    expect(result.value.scenario.packs.load).toEqual(['core']);
    expect(result.value.scenario.narration).toBe('full');
    expect(result.value.scenario.mole).toBe(false);

    // With no overrides the resolved preset is the named preset verbatim.
    expect(result.value.preset).toEqual(STANDARD);
  });

  it('carries the starting recruitment weights through', () => {
    const text = readFileSync(SCENARIO_YAML_PATH, 'utf8');
    const result = parseScenarioConfig(text, SCENARIO_YAML_PATH, CONTEXT);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { recruitment } = result.value.scenario;
    expect(Object.keys(recruitment.pitch)).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(Object.keys(recruitment.turn)).toEqual([
      'w1',
      'w2',
      'w3',
      'w4',
      'w5',
    ]);
  });
});

// --- overrides resolve ------------------------------------------------------

describe('difficulty override resolution', () => {
  it('deep-merges an override onto the named preset and re-validates', () => {
    const text = `
difficulty:
  preset: standard
  overrides:
    startingBudget: 500
    doctrine:
      risk: { min: 0.5, max: 0.9 }
recruitment:
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 }
  firstContact: { a: 1, b: 1, c: 1, d: 1 }
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 }
  exposure: { k1: 1, k2: 1, k3: 1 }
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 }
`;
    const result = parseScenarioConfig(text, 'test.yaml', CONTEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The overridden fields changed; everything else is the standard preset.
    expect(result.value.preset.startingBudget).toBe(500);
    expect(result.value.preset.doctrine.risk).toEqual({ min: 0.5, max: 0.9 });
    expect(result.value.preset.doctrine.security).toEqual({
      min: 0.3,
      max: 0.6,
    });
    expect(result.value.preset.id).toBe('standard');
  });
});

// --- bad fields are reported with their paths -------------------------------

/** Collect the located issues for a document that must fail to load. */
function issuesFor(text: string): ReadonlyArray<{ path: string }> {
  const result = parseScenarioConfig(text, 'bad.yaml', CONTEXT);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('expected failure');
  return result.issues;
}

describe('bad fields are reported with file and field path', () => {
  it('reports a YAML syntax error as a document-level issue', () => {
    const result = parseScenarioConfig('difficulty: [unclosed', 'bad.yaml', CONTEXT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.file).toBe('bad.yaml');
    expect(result.issues[0]?.path).toBe('');
  });

  it('reports an unknown difficulty preset on difficulty.preset', () => {
    const text = MINIMAL.replace('preset: standard', 'preset: brutal');
    const issues = issuesFor(text);
    const issue = issues.find((i) => i.path === 'difficulty.preset');
    expect(issue).toBeDefined();
  });

  it('reports an unknown pack on its position in packs.load', () => {
    const text = `${MINIMAL}
packs:
  load:
    - core
    - mystery
`;
    const issues = issuesFor(text);
    expect(issues.some((i) => i.path === 'packs.load[1]')).toBe(true);
  });

  it('reports an out-of-range override on its nested field path', () => {
    const text = `
difficulty:
  preset: standard
  overrides:
    hqFalseBeliefRate: 2
recruitment:
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 }
  firstContact: { a: 1, b: 1, c: 1, d: 1 }
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 }
  exposure: { k1: 1, k2: 1, k3: 1 }
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 }
`;
    const issues = issuesFor(text);
    expect(
      issues.some(
        (i) => i.path === 'difficulty.overrides.hqFalseBeliefRate',
      ),
    ).toBe(true);
  });

  it('reports an unknown override field as a strict-object error', () => {
    const text = `
difficulty:
  preset: standard
  overrides:
    bogusKnob: 1
recruitment:
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 }
  firstContact: { a: 1, b: 1, c: 1, d: 1 }
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 }
  exposure: { k1: 1, k2: 1, k3: 1 }
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 }
`;
    // An unknown override field fails during the scenario-schema validation
    // (DifficultyOverridesSchema is strict), located under difficulty.overrides.
    const issues = issuesFor(text);
    expect(
      issues.some((i) => i.path.startsWith('difficulty.overrides')),
    ).toBe(true);
  });

  it('reports a missing recruitment weight on its field path', () => {
    const text = `
difficulty:
  preset: standard
recruitment:
  pitch: { w1: 1, w2: 1, w3: 1 }
  firstContact: { a: 1, b: 1, c: 1, d: 1 }
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 }
  exposure: { k1: 1, k2: 1, k3: 1 }
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 }
`;
    const issues = issuesFor(text);
    expect(issues.some((i) => i.path === 'recruitment.pitch.w4')).toBe(true);
  });

  it('reports an invalid narration mode on narration', () => {
    const text = MINIMAL.replace(
      'preset: standard',
      'preset: standard\nmole: false',
    ).concat('\nnarration: loud\n');
    const issues = issuesFor(text);
    expect(issues.some((i) => i.path === 'narration')).toBe(true);
  });
});

// --- setting selection (content-expansion Req 9.1) --------------------------

describe('setting selection', () => {
  it('defaults to the Core City when no setting is named', () => {
    const result = parseScenarioConfig(MINIMAL, 'test.yaml', SETTING_CONTEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scenario.setting.city).toBe('core');
    expect(result.value.scenario.setting.startDate).toBeUndefined();
  });

  it('accepts a loaded city with a start date inside both windows', () => {
    const text = `${MINIMAL}
setting:
  city: city-vienna/vienna
  startDate: 1949-06-01
`;
    const result = parseScenarioConfig(text, 'test.yaml', SETTING_CONTEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scenario.setting.city).toBe('city-vienna/vienna');
    expect(result.value.scenario.setting.startDate).toBe('1949-06-01');
  });

  it('reports an unknown city on setting.city', () => {
    const text = `${MINIMAL}
setting:
  city: city-atlantis/atlantis
`;
    const result = parseScenarioConfig(text, 'bad.yaml', SETTING_CONTEXT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === 'setting.city')).toBe(true);
  });

  it('rejects a malformed start date at schema validation on setting.startDate', () => {
    const text = `${MINIMAL}
setting:
  startDate: 1949/06/01
`;
    const result = parseScenarioConfig(text, 'bad.yaml', SETTING_CONTEXT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path === 'setting.startDate')).toBe(true);
  });

  it('reports a start date outside the city window on setting.startDate', () => {
    const text = `${MINIMAL}
setting:
  city: city-vienna/vienna
  startDate: 1951-01-01
`;
    const result = parseScenarioConfig(text, 'bad.yaml', SETTING_CONTEXT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some(
        (i) =>
          i.path === 'setting.startDate' &&
          i.message.includes("city's start-date window"),
      ),
    ).toBe(true);
  });

  it('reports a start date outside the era window on setting.startDate', () => {
    // 1944 is before the era Period Window; the Core City has no city window,
    // so only the era check fires.
    const text = `${MINIMAL}
setting:
  startDate: 1944-01-01
`;
    const result = parseScenarioConfig(text, 'bad.yaml', SETTING_CONTEXT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(
      result.issues.some(
        (i) =>
          i.path === 'setting.startDate' &&
          i.message.includes('era period window'),
      ),
    ).toBe(true);
  });

  it('rejects an unknown field in the setting block', () => {
    const text = `${MINIMAL}
setting:
  city: core
  mystery: 1
`;
    const result = parseScenarioConfig(text, 'bad.yaml', SETTING_CONTEXT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.path.startsWith('setting'))).toBe(true);
  });

  it('accepts a core setting with no city or era context loaded', () => {
    // The slice core-only setup supplies no cities/eraPeriod; a core setting
    // with no start date still resolves.
    const result = parseScenarioConfig(MINIMAL, 'test.yaml', CONTEXT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scenario.setting.city).toBe('core');
  });
});

describe('ambient scenario block', () => {
  it('accepts density and the regard weight, and reports a bad density with its path', () => {
    const ok = parseScenarioConfig(
      `
difficulty:
  preset: standard
ambient:
  enabled: true
  density: rich
recruitment:
  pitch: { w1: 1, w2: 1, w3: 1, w4: 1 }
  firstContact: { a: 1, b: 1, c: 1, d: 1, e: 1 }
  meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1, regard: 1 }
  exposure: { k1: 1, k2: 1, k3: 1 }
  turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 }
`,
      'test.yaml',
      CONTEXT,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.scenario.ambient).toEqual({ enabled: true, density: 'rich' });
      expect(ok.value.scenario.recruitment.firstContact.e).toBe(1);
      expect(ok.value.scenario.recruitment.meeting.regard).toBe(1);
    }
    const bad = parseScenarioConfig(
      `${MINIMAL}ambient:\n  enabled: true\n  density: crowded\n`,
      'test.yaml',
      CONTEXT,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues.some((issue) => issue.path.includes('ambient.density'))).toBe(true);
    }
  });
});

// --- formatting -------------------------------------------------------------

describe('formatConfigIssues', () => {
  it('renders field issues and document issues distinctly', () => {
    const out = formatConfigIssues([
      { file: 'f.yaml', path: 'difficulty.preset', message: 'unknown' },
      { file: 'f.yaml', path: '', message: 'bad yaml' },
    ]);
    expect(out).toBe(
      'f.yaml: difficulty.preset: unknown\nf.yaml: bad yaml',
    );
  });
});
