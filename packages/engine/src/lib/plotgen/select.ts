/**
 * The Selector (plot-library). Pure: eligibility, history penalties, then a
 * weighted draw of one Primary and up to `secondaryPlots` Secondaries.
 */

import { createHash } from 'node:crypto';

import { presetAtLeast, type PlotTemplateV2, type PresetId } from '@tradecraft/content';
import type { Prng } from '../prng/prng.js';
import { bindable, type BindCity } from './bind.js';
import { libraryPreset, type PresetSource } from './preset.js';

export interface TemplateHistoryEntry {
  readonly templateId: string;
  readonly variantKey: string;
  readonly archetype: string;
  readonly outcome: string;
}

export type TemplateHistory = readonly TemplateHistoryEntry[];

export interface SelectionContext {
  readonly tension?: number;
  readonly epochFlags?: readonly string[];
  readonly rank?: string;
  readonly scaling?: number;
}

export interface PlotSelectionConfig {
  readonly archetypePenalty: number;
  readonly variantPenalty: number;
  readonly historyWindow: number;
}

export const DEFAULT_PLOT_SELECTION: PlotSelectionConfig = {
  archetypePenalty: 0.3,
  variantPenalty: 0.5,
  historyWindow: 5,
};

export interface SelectionInput {
  readonly templates: readonly PlotTemplateV2[];
  readonly city: BindCity;
  readonly preset: PresetSource;
  readonly year: number;
  readonly history?: TemplateHistory;
  readonly context?: SelectionContext;
  readonly excluded: readonly string[];
  readonly config?: PlotSelectionConfig;
}

export interface SelectionResult {
  readonly primary: string;
  readonly secondaries: readonly string[];
  readonly historyHash: string;
  readonly context?: SelectionContext;
}

export function historyHash(history: TemplateHistory | undefined): string {
  const canonical =
    history === undefined
      ? ''
      : JSON.stringify(
          history.map((entry) => ({
            archetype: entry.archetype,
            outcome: entry.outcome,
            templateId: entry.templateId,
            variantKey: entry.variantKey,
          })),
        );
  return createHash('sha256').update(canonical).digest('hex');
}

function eligible(template: PlotTemplateV2, input: SelectionInput): boolean {
  if (template.subOnly || template.kind !== 'plot') {
    return false;
  }
  if (template.era.from > input.year || template.era.to < input.year) {
    return false;
  }
  const presetId = (input.preset.id === 'easy' || input.preset.id === 'standard' || input.preset.id === 'hard'
    ? input.preset.id
    : 'standard') as PresetId;
  if (!presetAtLeast(presetId, template.minPreset)) {
    return false;
  }
  const knobs = libraryPreset(input.preset);
  if (template.cells.length > knobs.maxCells) {
    return false;
  }
  if (input.excluded.includes(template.id)) {
    return false;
  }
  return bindable(template, input.city).ok;
}

function staticSignatures(template: PlotTemplateV2): string[] {
  const branches = template.stages.flatMap((entry) =>
    'branch' in entry && entry.resolve === 'static' ? [entry.alternatives.map((alt) => alt.id)] : [],
  );
  if (branches.length === 0) {
    return [''];
  }
  let combos = [''];
  for (const alts of branches) {
    const next: string[] = [];
    for (const combo of combos) {
      for (const alt of alts) {
        next.push(combo === '' ? alt : `${combo},${alt}`);
      }
    }
    combos = next;
  }
  return combos;
}

function seenEveryVariant(template: PlotTemplateV2, history: TemplateHistory): boolean {
  const seen = new Set(
    history.filter((entry) => entry.templateId === template.id).map((entry) => entry.variantKey),
  );
  if (seen.size === 0) {
    return false;
  }
  return staticSignatures(template).every((sig) =>
    [...seen].some((key) => key.includes(`|s:${sig}|`) || (sig === '' && key.includes('|s:|'))),
  );
}

function weightOf(
  template: PlotTemplateV2,
  history: TemplateHistory,
  config: PlotSelectionConfig,
): number {
  const window = history.slice(-config.historyWindow);
  const nArch = window.filter((entry) => entry.archetype === template.archetype).length;
  const seen = seenEveryVariant(template, history) ? 1 : 0;
  return (
    template.selection.weight *
    config.archetypePenalty ** nArch *
    config.variantPenalty ** seen
  );
}

function weightedDraw(rng: Prng, items: readonly { readonly id: string; readonly weight: number }[]): string {
  const ordered = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const total = ordered.reduce((sum, item) => sum + item.weight, 0);
  let cursor = rng.next() * (total === 0 ? 1 : total);
  for (const item of ordered) {
    cursor -= item.weight;
    if (cursor < 0) {
      return item.id;
    }
  }
  return ordered[ordered.length - 1]?.id ?? '';
}

function mutuallyAllowed(primary: PlotTemplateV2, secondary: PlotTemplateV2): boolean {
  if (primary.archetype === secondary.archetype) {
    return false;
  }
  return (
    secondary.concurrency.tags.every((tag) => primary.concurrency.allowWith.includes(tag)) &&
    primary.concurrency.tags.every((tag) => secondary.concurrency.allowWith.includes(tag))
  );
}

/**
 * Choose a Primary and its Secondaries. Returns `no-eligible-template` when
 * nothing can be a Primary.
 */
export function select(input: SelectionInput, rng: Prng): SelectionResult | 'no-eligible-template' {
  const config = input.config ?? DEFAULT_PLOT_SELECTION;
  const history = input.history ?? [];
  let pool = input.templates.filter((template) => eligible(template, input));
  const recent = new Set(history.slice(-2).map((entry) => entry.templateId));
  const withoutRecent = pool.filter((template) => !recent.has(template.id));
  if (withoutRecent.length > 0) {
    pool = withoutRecent;
  }
  if (pool.length === 0) {
    return 'no-eligible-template';
  }
  const primaryId = weightedDraw(
    rng,
    pool.map((template) => ({ id: template.id, weight: weightOf(template, history, config) })),
  );
  const primary = pool.find((template) => template.id === primaryId);
  if (primary === undefined) {
    return 'no-eligible-template';
  }
  const wanted = libraryPreset(input.preset).secondaryPlots;
  const secondaries: string[] = [];
  let remaining = input.templates.filter(
    (template) => template.id !== primary.id && eligible(template, input) && mutuallyAllowed(primary, template),
  );
  const withoutRecentSecondary = remaining.filter((template) => !recent.has(template.id));
  if (withoutRecentSecondary.length > 0) {
    remaining = withoutRecentSecondary;
  }
  while (secondaries.length < wanted && remaining.length > 0) {
    const id = weightedDraw(
      rng,
      remaining.map((template) => ({ id: template.id, weight: weightOf(template, history, config) })),
    );
    secondaries.push(id);
    const chosen = remaining.find((template) => template.id === id);
    remaining = remaining.filter(
      (template) =>
        template.id !== id &&
        (chosen === undefined || template.archetype !== chosen.archetype) &&
        mutuallyAllowed(primary, template),
    );
  }
  return {
    primary: primary.id,
    secondaries,
    historyHash: historyHash(input.history),
    ...(input.context === undefined ? {} : { context: input.context }),
  };
}
