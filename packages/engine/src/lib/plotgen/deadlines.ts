/**
 * Library stage deadlines, accumulated the way slice `buildStages` does.
 *
 * A stage's day is the latest predecessor day (the game start, when it has
 * none) plus a span drawn from its `[min, max]` window plus the preset's
 * deadline slack. Sibling alternatives share predecessors, so each span is
 * relative to the branch point rather than stacked on the other sibling.
 * Design: "Deadlines. As in the slice, with preset slack. Runtime Alternatives
 * get deadlines relative to the branch resolution time."
 */

import type { Prng } from '../prng/prng.js';

export interface DeadlineStage {
  readonly id: string;
  readonly requires: readonly string[];
  readonly deadline?: { readonly min: number; readonly max: number };
}

const FALLBACK_MIN = 2;
const FALLBACK_MAX = 4;

/**
 * A subplot stage is expanded under a path prefix (`cross/confirm`) while its
 * authored requirements keep the local id (`begin`). Scope those requirements
 * to the same prefix so the stage waits on its own opening instead of a
 * same-named stage in the parent, or on nothing.
 */
export function scopeStageRequires(id: string, requires: readonly string[]): readonly string[] {
  const slash = id.lastIndexOf('/');
  if (slash < 0) {
    return requires;
  }
  const prefix = id.slice(0, slash + 1);
  return requires.map((req) =>
    req
      .split('|')
      .map((part) => {
        const token = part.trim();
        if (token.length === 0 || token.includes('/')) {
          return token;
        }
        return `${prefix}${token}`;
      })
      .join('|'),
  );
}

function windowOf(stage: DeadlineStage): { readonly min: number; readonly max: number } {
  const min = Math.max(0, Math.round(stage.deadline?.min ?? FALLBACK_MIN));
  const max = Math.max(min, Math.round(stage.deadline?.max ?? FALLBACK_MAX));
  return { min, max };
}

/**
 * The day a requirement is satisfied. A `|` list is an OR (the earliest known
 * alternative). A single id is that stage's day. Unknown ids are skipped.
 */
function requirementDay(req: string, dayOf: ReadonlyMap<string, number>): number | undefined {
  const parts = req
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const known = parts.flatMap((part) => {
    const day = dayOf.get(part);
    return day === undefined ? [] : [day];
  });
  if (known.length === 0) {
    return undefined;
  }
  if (parts.length > 1) {
    return Math.min(...known);
  }
  return known[0];
}

function baseDay(stage: DeadlineStage, dayOf: ReadonlyMap<string, number>, startDay: number): number {
  let base = startDay;
  for (const req of stage.requires) {
    const gate = requirementDay(req, dayOf);
    if (gate !== undefined && gate > base) {
      base = gate;
    }
  }
  return base;
}

/**
 * Concrete deadline day for each stage, drawn on `rng` in list order. Stages
 * must already be in an order where requirements point at earlier ids.
 */
export function accumulatedDeadlineDays(
  stages: readonly DeadlineStage[],
  slackDays: number,
  rng: Prng,
  startDay = 0,
): ReadonlyMap<string, number> {
  const slack = Math.max(0, Math.round(slackDays));
  const dayOf = new Map<string, number>();
  for (const stage of stages) {
    const window = windowOf(stage);
    const span = rng.int(window.min, window.max) + slack;
    dayOf.set(stage.id, baseDay(stage, dayOf, startDay) + span);
  }
  return dayOf;
}

/**
 * The latest deadline if every stage draws its maximum span. Used to bound a
 * passive watch so it cannot stop before the plot's last stage.
 */
export function worstCaseDeadlineDay(
  stages: readonly DeadlineStage[],
  slackDays: number,
  startDay = 0,
): number {
  const slack = Math.max(0, Math.round(slackDays));
  const dayOf = new Map<string, number>();
  let latest = startDay;
  for (const stage of stages) {
    const span = windowOf(stage).max + slack;
    const day = baseDay(stage, dayOf, startDay) + span;
    dayOf.set(stage.id, day);
    if (day > latest) {
      latest = day;
    }
  }
  return latest;
}
