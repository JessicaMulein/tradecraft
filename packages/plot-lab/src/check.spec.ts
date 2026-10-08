import { describe, expect, it } from 'vitest';

import { createPrng, derive } from '@tradecraft/engine';
import { loadContent } from '@tradecraft/content';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { readFileSync } from 'node:fs';

import { checkTemplates, fixtureCity, parseThresholds, passes, reportCsv, reportMarkdown, thresholdFailures, type PlotLabReport } from './check.js';
import { playQuoteResolve } from './oracle-play.js';
import { coherenceIssues, oraclePlan, passiveReach, rerouteTargets } from './passive.js';
import type { PlotStateV2 } from '@tradecraft/engine';

const PACKS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'packs');

describe('plot lab', () => {
  it('is deterministic and clears the default thresholds on the fixture city', () => {
    const loaded = loadContent(
      [join(PACKS, 'core'), join(PACKS, 'coldwar-plots')],
      ['core', 'coldwar-plots'],
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const city = fixtureCity();
    const first = checkTemplates(loaded.value, 'standard', 4, city);
    const second = checkTemplates(loaded.value, 'standard', 4, city);
    expect(reportMarkdown(first)).toContain('never executed');
    expect(reportMarkdown(first)).toContain('failing seeds');
    expect(first.city).toBe('fixture');
    expect(first.preset).toBe('standard');
    expect(reportMarkdown(first)).toBe(reportMarkdown(second));
    expect(reportCsv(first)).toBe(reportCsv(second));
    for (const line of thresholdFailures(first, { finalVerification: 1, oracleWin: 0.95, passiveCompletion: 0.9 })) {
      expect(line).toContain('fixture standard');
      expect(line).toMatch(/plot-lab:/);
    }
    expect(createPrng(derive('1', 1)).next()).toBe(createPrng(derive('1', 1)).next());
  });

  it('repeats a five-seed passive report and plans an oracle', () => {
    const loaded = loadContent(
      [join(PACKS, 'core'), join(PACKS, 'coldwar-plots')],
      ['core', 'coldwar-plots'],
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const stories = [...(loaded.value.plotTemplatesV2?.values() ?? [])].filter((item) => !item.subOnly);
    const template = stories.find((item) => item.stages.some((entry) => 'branch' in entry && entry.resolve === 'runtime')) ?? stories[0];
    expect(template).toBeDefined();
    if (template === undefined) {
      return;
    }
    const preset = [...loaded.value.difficultyPresets.values()].find((item) => item.id === 'standard');
    expect(preset).toBeDefined();
    if (preset === undefined) {
      return;
    }
    const first = passiveReach(template, loaded.value.plotTemplatesV2 ?? new Map(), preset, 5, 12);
    const second = passiveReach(template, loaded.value.plotTemplatesV2 ?? new Map(), preset, 5, 12);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.keys(first.executed).length).toBeGreaterThan(0);
    expect(Object.keys(first.alternatives).length).toBeGreaterThan(0);
    const plan = oraclePlan(template);
    expect(plan.actions.length).toBeGreaterThan(0);
    for (const action of plan.actions) {
      expect(['surveil', 'follow', 'intercept', 'decrypt', 'seize', 'identify', 'arrest', 'wait', 'quote', 'resolve']).toContain(
        action,
      );
    }
    expect(rerouteTargets(template).length).toBeGreaterThan(0);
    expect(playQuoteResolve(plan.actions, createPrng(derive('oracle-play', 1)))).toBe(true);
    const rule = readFileSync(join(PACKS, '..', '..', '..', '.dependency-cruiser.cjs'), 'utf8');
    expect(rule).toContain('no-plot-lab-in-runtime');
    expect(rule).toContain('packages/plot-lab/');
  });

  it('rejects a debrief that hides a plot, a pending stage, or an empty twist', () => {
    const plot = {
      templateId: 'sample',
      stages: [
        { id: 'open', status: 'pending', offMap: false },
        { id: 'close', status: 'executed', offMap: false },
      ],
    } as PlotStateV2;
    expect(coherenceIssues([plot], [{ templateId: 'other', timeline: [] }])).toContain(
      'sample does not appear in the debrief',
    );
    expect(coherenceIssues([plot], [{ templateId: 'sample', timeline: [{ stage: 'open' }] }])).toContain(
      'sample timeline open did not happen',
    );
    expect(
      coherenceIssues([plot], [{ templateId: 'sample', timeline: [{ stage: 'close' }], twist: { propositions: [] } }]),
    ).toContain('sample twist has no propositions');
    expect(coherenceIssues([plot], [{ templateId: 'sample', timeline: [{ stage: 'close' }] }])).toEqual([]);
  });

  it('loads thresholds and names the template, city, preset and seeds on a miss', () => {
    const thresholds = parseThresholds('oracleWin: 0.5\n');
    expect(thresholds.oracleWin).toBe(0.5);
    expect(thresholds.finalVerification).toBe(1);
    const report: PlotLabReport = {
      city: 'fixture',
      preset: 'standard',
      finalVerification: 0,
      oracleWin: 0,
      passiveCompletion: 0,
      rows: [
        {
          templateId: 'sample',
          archetype: 'sabotage',
          bindRate: 1,
          expandRate: 1,
          coherent: false,
          oracleRate: 0.5,
          finalPassRate: 0.5,
          passiveCompletion: 0.5,
          neverExecuted: '',
          failingSeeds: 'plot-lab:sample:2',
          issues: 'sample twist has no propositions',
        },
      ],
    };
    const lines = thresholdFailures(report, thresholds);
    expect(lines.some((line) => line.includes('sample fixture standard') && line.includes('plot-lab:sample:2'))).toBe(true);
    expect(passes(report, thresholds)).toBe(false);
  });
});
