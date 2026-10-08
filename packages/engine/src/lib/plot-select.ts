/**
 * Plot selection for a posting (design, "Player History and Plot selection";
 * Requirements 21.1, 21.2, 21.6).
 *
 * `toTemplateHistory` reads archived schema-2 `plots[]` rows in posting order.
 * A record with no `plots` contributes nothing. `selectPlot` calls
 * plot-library's `select` when a selection input is supplied, and otherwise
 * draws uniformly from the templates that are not already in the history.
 * When every template has been used, the draw is over all of them.
 */

import type { PlotTemplate } from '@tradecraft/content';

import type { Prng } from './prng/prng.js';
import {
  select,
  type SelectionContext,
  type SelectionInput,
  type TemplateHistoryEntry,
} from './plotgen/select.js';

export interface PlotSelectHistory {
  readonly templateHistory: readonly TemplateHistoryEntry[];
  readonly context: {
    readonly year: number;
    readonly tension?: number;
    readonly epochFlags?: readonly string[];
    readonly rank?: string;
    readonly scaling?: number;
  };
}

/** What a posting passes into step 4. `selection` is null without plot-library. */
export interface PostingPlotSelection {
  readonly history: PlotSelectHistory;
  readonly selection: Omit<SelectionInput, 'history' | 'context'> | null;
}

/** One entry per archived schema-2 plot, oldest posting first. */
export function toTemplateHistory(
  visible: readonly { readonly plots?: readonly TemplateHistoryEntry[] }[],
): TemplateHistoryEntry[] {
  const entries: TemplateHistoryEntry[] = [];
  for (const posting of visible) {
    for (const plot of posting.plots ?? []) {
      entries.push({
        templateId: plot.templateId,
        variantKey: plot.variantKey,
        archetype: plot.archetype,
        outcome: plot.outcome,
      });
    }
  }
  return entries;
}

/**
 * Uniform over candidates whose id is not in the history. When that set is
 * empty, uniform over every candidate. Ids are compared with or without a
 * pack prefix. The draw uses `rng` once, the same way the slice picks a template.
 */
export function fallbackSelect(
  candidates: readonly Pick<PlotTemplate, 'id'>[],
  history: readonly Pick<TemplateHistoryEntry, 'templateId'>[],
  rng: Prng,
): string {
  if (candidates.length === 0) {
    throw new Error('fallbackSelect(): no Plot templates');
  }
  const used = history.map((entry) => entry.templateId);
  const fresh = candidates.filter((candidate) => !used.some((id) => sameId(candidate.id, id)));
  const pool = fresh.length > 0 ? fresh : candidates;
  const ordered = [...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rng.pick(ordered).id;
}

/**
 * The posting's plot. A selection input calls plot-library `select` and
 * returns its primary. No eligible library template, or no selection input,
 * uses {@link fallbackSelect}.
 */
export function selectPlot(
  history: PlotSelectHistory,
  input: Omit<SelectionInput, 'history' | 'context'> | null,
  candidates: readonly Pick<PlotTemplate, 'id'>[],
  rng: Prng,
): string {
  if (input !== null) {
    const chosen = select(
      {
        ...input,
        year: history.context.year,
        history: history.templateHistory,
        context: selectionContext(history),
      },
      rng,
    );
    if (chosen !== 'no-eligible-template') {
      return chosen.primary;
    }
  }
  return fallbackSelect(candidates, history.templateHistory, rng);
}

function selectionContext(history: PlotSelectHistory): SelectionContext {
  const { tension, epochFlags, rank, scaling } = history.context;
  return {
    ...(tension === undefined ? {} : { tension }),
    ...(epochFlags === undefined ? {} : { epochFlags }),
    ...(rank === undefined ? {} : { rank }),
    ...(scaling === undefined ? {} : { scaling }),
  };
}

function sameId(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}
