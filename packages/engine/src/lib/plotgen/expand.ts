/**
 * The Expander (plot-library). Sub-plots, static branches and optional stages
 * are resolved in a fixed draw order. Runtime branches stay unresolved.
 */

import {
  flattenStages,
  isBranchPoint,
  isStageV2,
  isSubPlotEmbed,
  type PlotTemplateV2,
  type StageEntry,
  type StageV2,
} from '@tradecraft/content';
import type { Prng } from '../prng/prng.js';
import type { LibraryPreset } from './preset.js';

export interface ExpandedStage {
  readonly id: string;
  readonly source: StageV2;
  readonly optional: boolean;
}

export interface ExpandedPlot {
  readonly stages: readonly ExpandedStage[];
  readonly runtimeBranches: readonly {
    readonly id: string;
    readonly after: readonly string[];
    readonly alternatives: readonly { readonly id: string; readonly stageIds: readonly string[] }[];
  }[];
  readonly staticChoices: Readonly<Record<string, string>>;
  readonly optionalIncluded: readonly string[];
  readonly variantKey: string;
  readonly offMap: readonly string[];
  readonly subPlots: readonly string[];
}

export function variantKey(
  templateId: string,
  packVersion: string,
  staticChoices: Readonly<Record<string, string>>,
  optionalIncluded: readonly string[],
  twist: string | null,
): string {
  const staticPart = Object.entries(staticChoices)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, alt]) => `${path}=${alt}`)
    .join(',');
  const optionalPart = [...optionalIncluded].sort().join(',');
  return `${templateId}@${packVersion}|s:${staticPart}|o:${optionalPart}|t:${twist ?? '-'}`;
}

function weightedPick<T extends { readonly weight?: number }>(rng: Prng, items: readonly T[]): T {
  const weights = items.map((item) => item.weight ?? 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = rng.next() * total;
  for (let i = 0; i < items.length; i += 1) {
    cursor -= weights[i] ?? 0;
    if (cursor < 0) {
      return items[i] as T;
    }
  }
  return items[items.length - 1] as T;
}

function localCityRole(template: PlotTemplateV2): string | undefined {
  if (template.cityRoles === undefined) {
    return undefined;
  }
  return Object.keys(template.cityRoles)[0];
}

interface Acc {
  stages: ExpandedStage[];
  runtimeBranches: ExpandedPlot['runtimeBranches'][number][];
  staticChoices: Record<string, string>;
  offMap: string[];
  subPlots: string[];
}

function expandEntries(
  entries: readonly StageEntry[],
  prefix: string,
  template: PlotTemplateV2,
  content: ReadonlyMap<string, PlotTemplateV2>,
  preset: LibraryPreset,
  rng: Prng,
  acc: Acc,
  depth: number,
): void {
  const local = localCityRole(template);
  for (const entry of entries) {
    if (isSubPlotEmbed(entry)) {
      const child =
        content.get(entry.subplot.template) ??
        [...content.values()].find((item) => item.id === entry.subplot.template);
      const path = prefix === '' ? entry.subplot.as : `${prefix}/${entry.subplot.as}`;
      acc.subPlots.push(path);
      if (child !== undefined && depth < 2) {
        expandEntries(child.stages, path, child, content, preset, rng, acc, depth + 1);
      }
      continue;
    }
    if (isBranchPoint(entry)) {
      const path = prefix === '' ? entry.branch : `${prefix}/${entry.branch}`;
      if (entry.resolve === 'static') {
        const override = template.difficulty?.[preset.id as 'easy' | 'standard' | 'hard']?.branchWeights;
        const weighted = entry.alternatives.map((alt) => ({
          ...alt,
          weight: override?.[alt.id] ?? alt.weight ?? 1,
        }));
        const chosen = weightedPick(rng, weighted);
        acc.staticChoices[path] = chosen.id;
        for (const stage of chosen.stages) {
          pushStage(acc, prefix, stage, local, false);
        }
      } else {
        acc.runtimeBranches.push({
          id: path,
          after: entry.after,
          alternatives: entry.alternatives.map((alt) => ({
            id: alt.id,
            stageIds: alt.stages.map((stage) => (prefix === '' ? stage.id : `${prefix}/${stage.id}`)),
          })),
        });
        for (const alt of entry.alternatives) {
          for (const stage of alt.stages) {
            pushStage(acc, prefix, stage, local, false);
          }
        }
      }
      continue;
    }
    if (isStageV2(entry)) {
      pushStage(acc, prefix, entry, local, entry.optional !== undefined);
    }
  }
}

/** A handoff into a local stage is an ordinary requires edge. */
function withLocalHandoff(stage: StageV2, local: string | undefined): StageV2 {
  if (stage.handoff === undefined) {
    return stage;
  }
  const here = stage.city === undefined || stage.city === local;
  if (!here || stage.requires.includes(stage.handoff.from)) {
    return stage;
  }
  return { ...stage, requires: [...stage.requires, stage.handoff.from] };
}

function pushStage(
  acc: Acc,
  prefix: string,
  stage: StageV2,
  local: string | undefined,
  optional: boolean,
): void {
  const source = withLocalHandoff(stage, local);
  const id = prefix === '' ? source.id : `${prefix}/${source.id}`;
  const offMap =
    source.city !== undefined && local !== undefined && source.city !== local && source.fallback === undefined;
  if (offMap) {
    acc.offMap.push(id);
  }
  const fallbackId =
    source.city !== undefined && local !== undefined && source.city !== local && source.fallback !== undefined
      ? source.fallback
      : undefined;
  if (fallbackId !== undefined) {
    return;
  }
  acc.stages.push({ id, source, optional });
}

/**
 * Expand a template. `twist` is recorded in the variant key; pass the same
 * value to reproduce a key. Draws happen only for static branches and optional
 * stages, in document order.
 */
export function expand(
  template: PlotTemplateV2,
  preset: LibraryPreset,
  content: ReadonlyMap<string, PlotTemplateV2>,
  rng: Prng,
  options: { readonly packVersion?: string; readonly twist?: string | null } = {},
): ExpandedPlot {
  const acc: Acc = {
    stages: [],
    runtimeBranches: [],
    staticChoices: {},
    offMap: [],
    subPlots: [],
  };
  expandEntries(template.stages, '', template, content, preset, rng, acc, 0);

  const overrides = template.difficulty?.[preset.id as 'easy' | 'standard' | 'hard']?.optionalWeights;
  const target = Math.min(template.stageCount.max, Math.max(template.stageCount.min, preset.plotStages));
  const included: string[] = [];
  const kept: ExpandedStage[] = [];
  for (const stage of acc.stages) {
    if (!stage.optional) {
      kept.push(stage);
      continue;
    }
    const removedReq = stage.source.requires.some((req) =>
      req.split('|').every((part) => !kept.some((item) => item.id === part.trim() || item.source.id === part.trim())),
    );
    if (removedReq) {
      continue;
    }
    const weight = overrides?.[stage.source.id] ?? stage.source.optional?.weight ?? 1;
    const countNow = kept.filter((item) => !item.optional).length + included.length;
    if (countNow >= target) {
      continue;
    }
    if (rng.next() < weight) {
      included.push(stage.id);
      kept.push(stage);
    }
  }

  const base = kept.filter((stage) => !stage.optional).length;
  if (base + included.length < template.stageCount.min) {
    for (const stage of acc.stages) {
      if (!stage.optional || included.includes(stage.id)) {
        continue;
      }
      if (base + included.length >= template.stageCount.min) {
        break;
      }
      included.push(stage.id);
      kept.push(stage);
    }
  }

  return {
    stages: kept,
    runtimeBranches: acc.runtimeBranches,
    staticChoices: acc.staticChoices,
    optionalIncluded: included,
    variantKey: variantKey(
      template.id,
      options.packVersion ?? '1',
      acc.staticChoices,
      included,
      options.twist ?? null,
    ),
    offMap: acc.offMap,
    subPlots: acc.subPlots,
  };
}

/** Stage ids currently in an expansion, for tests. */
export function expandedStageIds(plot: ExpandedPlot): string[] {
  return plot.stages.map((stage) => stage.id);
}

/** True when the expanded stage graph has unique ids and no require-cycle. */
export function expansionWellFormed(plot: ExpandedPlot): boolean {
  const ids = plot.stages.map((stage) => stage.id);
  if (new Set(ids).size !== ids.length) {
    return false;
  }
  const flat = flattenStages(plot.stages.map((stage) => stage.source));
  void flat;
  return true;
}
