import { readFileSync } from 'node:fs';

import type { ContentSet, PlotTemplateV2 } from '@tradecraft/content';
import {
  bindable,
  createPrng,
  derive,
  expand,
  libraryPreset,
  SELECT_STREAM,
  type BindCity,
} from '@tradecraft/engine';

import { passiveMaxDays, passiveReach, runOracle } from './passive.js';

export interface LabThresholds {
  readonly finalVerification: number;
  readonly oracleWin: number;
  readonly passiveCompletion: number;
}

export const DEFAULT_THRESHOLDS: LabThresholds = {
  finalVerification: 1,
  oracleWin: 0.95,
  passiveCompletion: 0.9,
};

/** Thresholds from a small YAML file, filled from the defaults when a key is absent. */
export function parseThresholds(text: string): LabThresholds {
  const values: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const match = /^(\w+):\s*([0-9]*\.?[0-9]+)\s*$/.exec(line.trim());
    if (match === null) {
      continue;
    }
    values[match[1] ?? ''] = Number(match[2]);
  }
  return {
    finalVerification: values.finalVerification ?? DEFAULT_THRESHOLDS.finalVerification,
    oracleWin: values.oracleWin ?? DEFAULT_THRESHOLDS.oracleWin,
    passiveCompletion: values.passiveCompletion ?? DEFAULT_THRESHOLDS.passiveCompletion,
  };
}

export function loadThresholds(path: string): LabThresholds {
  return parseThresholds(readFileSync(path, 'utf8'));
}

export interface PlotLabRow {
  readonly templateId: string;
  readonly archetype: string;
  readonly bindRate: number;
  readonly expandRate: number;
  readonly coherent: boolean;
  /** Fraction of seeds the oracle disrupted before the final stage. */
  readonly oracleRate: number;
  /** Fraction of seeds `verifyLibrary` accepted. */
  readonly finalPassRate: number;
  /** Fraction of passive seeds that reached a resolution. */
  readonly passiveCompletion: number;
  /** Stages and alternatives that executed in no passive seed. */
  readonly neverExecuted: string;
  /** Seeds that missed verification, passive resolution, coherence, or the oracle. */
  readonly failingSeeds: string;
  readonly issues: string;
}

export interface PlotLabReport {
  readonly city: string;
  readonly preset: string;
  readonly rows: readonly PlotLabRow[];
  readonly finalVerification: number;
  readonly oracleWin: number;
  readonly passiveCompletion: number;
}

/**
 * A city that answers every query the library templates use, so the lab
 * measures the template graph itself.
 */
export function fixtureCity(): BindCity {
  return {
    binders(kind, query) {
      const tag = query[0] ?? 'any';
      return [0, 1, 2].map((index) => `${kind}-${tag}-${index}`);
    },
    archetypesWithTags(tags) {
      return [`arch-${tags.join('-') || 'any'}`];
    },
  };
}

export function checkTemplates(
  content: ContentSet,
  presetId: 'easy' | 'standard' | 'hard',
  seeds: number,
  city: BindCity = fixtureCity(),
  catalogue: 'plot' | 'side-thread' = 'plot',
  cityId = 'fixture',
): PlotLabReport {
  const source = [...content.difficultyPresets.values()].find((preset) => preset.id === presetId) ?? {
    id: presetId,
    plot: { stageCount: 3, deadlineSlackDays: 2 },
  };
  const preset = libraryPreset(source);
  const lookup = content.plotTemplatesV2 ?? new Map<string, PlotTemplateV2>();
  const templates =
    (catalogue === 'plot' ? content.plotTemplatesV2 : content.sideThreadTemplatesV2) ??
    new Map<string, PlotTemplateV2>();
  const stories = [...templates.values()].filter((template) => catalogue === 'side-thread' || !template.subOnly);
  const rows = stories.map((template) => {
    let bound = 0;
    let expanded = 0;
    for (let seed = 1; seed <= seeds; seed += 1) {
      if (!bindable(template, city).ok) {
        continue;
      }
      bound += 1;
      try {
        expand(template, preset, lookup, createPrng(derive(String(seed), SELECT_STREAM)));
        expanded += 1;
      } catch {
        // Counted as an expansion failure.
      }
    }
    const days = passiveMaxDays(template, source.plot.deadlineSlackDays);
    const reached = passiveReach(template, lookup, source, seeds, days);
    const oracle = runOracle(template, lookup, source, seeds, days);
    return {
      templateId: template.id,
      archetype: template.archetype,
      bindRate: seeds === 0 ? 0 : bound / seeds,
      expandRate: seeds === 0 ? 0 : expanded / seeds,
      coherent: reached.coherent,
      oracleRate: oracle.rate,
      finalPassRate: reached.finalPassRate,
      passiveCompletion: reached.completion,
      neverExecuted: reached.never.join(' '),
      failingSeeds: [...new Set([...reached.failingSeeds, ...oracle.losses])].sort().join(' '),
      issues: reached.issues.join('; '),
    };
  });
  const mean = (values: readonly number[]): number =>
    values.length === 0 ? 1 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    city: cityId,
    preset: presetId,
    rows,
    finalVerification: mean(rows.map((row) => row.finalPassRate)),
    oracleWin: mean(rows.map((row) => row.oracleRate)),
    passiveCompletion: mean(rows.map((row) => row.passiveCompletion)),
  };
}

export function reportMarkdown(report: PlotLabReport): string {
  const lines = [
    '| template | archetype | bind | expand | verify | oracle | passive | coherent | never executed |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.rows.map(
      (row) =>
        `| ${row.templateId} | ${row.archetype} | ${row.bindRate.toFixed(2)} | ${row.expandRate.toFixed(2)} | ${row.finalPassRate.toFixed(2)} | ${row.oracleRate.toFixed(2)} | ${row.passiveCompletion.toFixed(2)} | ${row.coherent} | ${row.neverExecuted} |`,
    ),
    '',
    `city ${report.city}`,
    `preset ${report.preset}`,
    `final verification ${report.finalVerification.toFixed(2)}`,
    `oracle win ${report.oracleWin.toFixed(2)}`,
    `passive completion ${report.passiveCompletion.toFixed(2)}`,
    'failing seeds',
    ...report.rows
      .filter((row) => row.failingSeeds !== '' || row.issues !== '')
      .map((row) => `- ${row.templateId} ${report.city} ${report.preset}: ${row.failingSeeds} ${row.issues}`.trim()),
  ];
  return lines.join('\n');
}

export function reportCsv(report: PlotLabReport): string {
  const lines = [
    'template,archetype,city,preset,bind,expand,verify,oracle,passive,coherent,neverExecuted,failingSeeds',
    ...report.rows.map(
      (row) =>
        `${row.templateId},${row.archetype},${report.city},${report.preset},${row.bindRate},${row.expandRate},${row.finalPassRate},${row.oracleRate},${row.passiveCompletion},${row.coherent},${row.neverExecuted},${row.failingSeeds}`,
    ),
  ];
  return lines.join('\n');
}

/** One line per template that misses a threshold or debrief coherence. */
export function thresholdFailures(report: PlotLabReport, thresholds: LabThresholds): readonly string[] {
  const lines: string[] = [];
  for (const row of report.rows) {
    const where = `${row.templateId} ${report.city} ${report.preset}`;
    if (row.finalPassRate + 1e-9 < thresholds.finalVerification) {
      lines.push(`${where} final verification ${row.failingSeeds}`);
    }
    if (row.oracleRate + 1e-9 < thresholds.oracleWin) {
      lines.push(`${where} oracle ${row.failingSeeds}`);
    }
    if (row.passiveCompletion + 1e-9 < thresholds.passiveCompletion) {
      lines.push(`${where} passive ${row.failingSeeds}`);
    }
    if (!row.coherent) {
      lines.push(`${where} coherence ${row.issues}`);
    }
  }
  return lines;
}

export function passes(report: PlotLabReport, thresholds: LabThresholds): boolean {
  return thresholdFailures(report, thresholds).length === 0;
}
