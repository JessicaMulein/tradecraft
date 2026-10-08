/**
 * Runtime branch resolution (plot-library Req 4). Pure over world facts, the
 * hostile alertness reading, and one shared weighted draw per branch.
 */

import type { BranchCondition } from '@tradecraft/content';
import type { Prng } from '../prng/prng.js';

export interface BranchAlternative {
  readonly id: string;
  readonly when: readonly BranchCondition[];
  readonly stageIds: readonly string[];
}

export interface RuntimeBranch {
  readonly id: string;
  readonly after: readonly string[];
  readonly alternatives: readonly BranchAlternative[];
  readonly resolved?: { readonly alt: string; readonly cause: string };
}

export interface BranchWorld {
  /** Stage ids that have executed or been disrupted. */
  readonly finishedStages: ReadonlySet<string>;
  readonly disruptedStages: ReadonlySet<string>;
  /** Role slot → status string. */
  readonly roleStatus: Readonly<Record<string, string>>;
  readonly alertness: number;
  readonly adoptedBeliefs: readonly string[];
}

function conditionHolds(
  condition: BranchCondition,
  world: BranchWorld,
  weightedAlt: string | undefined,
): boolean {
  let holds = false;
  switch (condition.kind) {
    case 'default':
      holds = true;
      break;
    case 'alertness-at-least':
      holds = world.alertness >= (condition.value ?? 0);
      break;
    case 'stage-disrupted':
      holds = condition.stage !== undefined && world.disruptedStages.has(condition.stage);
      break;
    case 'participant-status':
      holds =
        condition.role !== undefined &&
        condition.status !== undefined &&
        world.roleStatus[condition.role] === condition.status;
      break;
    case 'belief-adopted':
      holds =
        condition.pattern !== undefined && world.adoptedBeliefs.some((belief) => belief.includes(condition.pattern ?? ''));
      break;
    case 'weighted':
      holds = weightedAlt !== undefined;
      break;
    default:
      holds = false;
  }
  return condition.negate === true ? !holds : holds;
}

function weightedChoice(branch: RuntimeBranch, rng: Prng): string | undefined {
  const weighted = branch.alternatives.filter((alt) => alt.when.some((cond) => cond.kind === 'weighted'));
  if (weighted.length === 0) {
    return undefined;
  }
  const weights = weighted.map((alt) => alt.when.find((cond) => cond.kind === 'weighted')?.weight ?? 1);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = rng.next() * total;
  for (let i = 0; i < weighted.length; i += 1) {
    cursor -= weights[i] ?? 0;
    if (cursor < 0) {
      return weighted[i]?.id;
    }
  }
  return weighted[weighted.length - 1]?.id;
}

/**
 * The first alternative, in declared order, whose conditions all hold.
 * `weighted` alternatives share one draw.
 */
export function resolveBranch(
  branch: RuntimeBranch,
  world: BranchWorld,
  rng: Prng,
): { readonly alt: string; readonly cause: string } {
  const weightedAlt = weightedChoice(branch, rng);
  for (const alt of branch.alternatives) {
    const conditions = alt.when.length === 0 ? [{ kind: 'default' as const }] : alt.when;
    const ok = conditions.every((condition) =>
      condition.kind === 'weighted' ? alt.id === weightedAlt : conditionHolds(condition, world, weightedAlt),
    );
    if (ok) {
      const deciding = alt.when.find((condition) => condition.kind !== 'default')?.kind ?? 'default';
      return { alt: alt.id, cause: deciding };
    }
  }
  const fallback = branch.alternatives[branch.alternatives.length - 1];
  return { alt: fallback?.id ?? '', cause: 'default' };
}

/**
 * When a stage inside the active alternative draws `reroute`, switch to an
 * unused sibling that does not require the disrupted stage, if one exists.
 */
export function rerouteAlternative(
  branch: RuntimeBranch,
  disruptedStage: string,
): { readonly alt: string; readonly cause: 'reroute' } | undefined {
  if (branch.resolved === undefined) {
    return undefined;
  }
  const active = branch.alternatives.find((alt) => alt.id === branch.resolved?.alt);
  if (active === undefined || !active.stageIds.includes(disruptedStage)) {
    return undefined;
  }
  const sibling = branch.alternatives.find(
    (alt) => alt.id !== active.id && !alt.stageIds.includes(disruptedStage),
  );
  if (sibling === undefined) {
    return undefined;
  }
  return { alt: sibling.id, cause: 'reroute' };
}
