/**
 * Plot-library difficulty knobs. Omitted preset fields take the design defaults
 * so the core `difficulty.yaml` stays byte-for-byte the slice values.
 */

import type { PresetId } from '@tradecraft/content';

export interface LibraryPreset {
  readonly id: string;
  readonly secondaryPlots: number;
  readonly twistProbability: number;
  readonly maxCells: number;
  readonly lookalikeShare: number;
  readonly plotStages: number;
  readonly deadlineSlackDays: number;
}

const DEFAULTS: Readonly<Record<string, Omit<LibraryPreset, 'id' | 'plotStages' | 'deadlineSlackDays'>>> = {
  easy: { secondaryPlots: 0, twistProbability: 0, maxCells: 2, lookalikeShare: 0.25 },
  standard: { secondaryPlots: 1, twistProbability: 0.35, maxCells: 3, lookalikeShare: 0.4 },
  hard: { secondaryPlots: 2, twistProbability: 0.6, maxCells: 3, lookalikeShare: 0.5 },
};

export interface PresetSource {
  readonly id: string;
  readonly plot: { readonly stageCount: number; readonly deadlineSlackDays: number };
  readonly secondaryPlots?: number;
  readonly twistProbability?: number;
  readonly maxCells?: number;
  readonly lookalikeShare?: number;
}

/** Resolve the plot-library fields of a difficulty preset. */
export function libraryPreset(preset: PresetSource): LibraryPreset {
  const defaults = DEFAULTS[preset.id] ?? DEFAULTS.standard;
  if (defaults === undefined) {
    throw new Error('libraryPreset: missing standard defaults');
  }
  return {
    id: preset.id,
    secondaryPlots: preset.secondaryPlots ?? defaults.secondaryPlots,
    twistProbability: preset.twistProbability ?? defaults.twistProbability,
    maxCells: preset.maxCells ?? defaults.maxCells,
    lookalikeShare: preset.lookalikeShare ?? defaults.lookalikeShare,
    plotStages: preset.plot.stageCount,
    deadlineSlackDays: preset.plot.deadlineSlackDays,
  };
}

/** Preset rank for `minPreset` checks. Unknown ids sort as standard. */
export function presetRank(id: string): number {
  const order: Record<PresetId, number> = { easy: 0, standard: 1, hard: 2 };
  return order[id as PresetId] ?? 1;
}
