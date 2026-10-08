/**
 * Outcome evaluation (plot-library Req 10). Success is checked before failure.
 * The caller decides whether a Primary resolution ends the game.
 */

import type { OutcomeCondition } from '@tradecraft/content';

export interface OutcomeFacts {
  readonly arrestedRoles: ReadonlySet<string>;
  readonly seizedItems: ReadonlySet<string>;
  readonly aborted: boolean;
  readonly completedStages: ReadonlySet<string>;
  readonly identifiedRoles: ReadonlySet<string>;
  readonly entityStatus: Readonly<Record<string, string>>;
  /** Entities that are still active and not in hostile custody. */
  readonly protectedEntities: ReadonlySet<string>;
}

export interface OutcomePlot {
  readonly success: readonly OutcomeCondition[];
  readonly failure: readonly OutcomeCondition[];
}

function holds(condition: OutcomeCondition, facts: OutcomeFacts): boolean {
  switch (condition.kind) {
    case 'arrest-role':
      return condition.role !== undefined && facts.arrestedRoles.has(condition.role);
    case 'seize-item':
      return condition.item !== undefined && facts.seizedItems.has(condition.item);
    case 'abort':
      return facts.aborted;
    case 'stage-completed':
      return condition.stage !== undefined && facts.completedStages.has(condition.stage);
    case 'identify-role':
      return condition.role !== undefined && facts.identifiedRoles.has(condition.role);
    case 'entity-status':
      return (
        condition.entity !== undefined &&
        condition.status !== undefined &&
        facts.entityStatus[condition.entity] === condition.status
      );
    case 'protect-until':
      return condition.entity !== undefined && facts.protectedEntities.has(condition.entity);
    default:
      return false;
  }
}

/**
 * The first matching success condition, else the first matching failure
 * condition, else null. `by` names the condition kind that decided it.
 */
export function evaluateOutcomes(
  plot: OutcomePlot,
  facts: OutcomeFacts,
): { readonly result: 'disrupted' | 'succeeded'; readonly by: string } | null {
  for (const condition of plot.success) {
    if (holds(condition, facts)) {
      return { result: 'disrupted', by: condition.kind };
    }
  }
  for (const condition of plot.failure) {
    if (holds(condition, facts)) {
      return { result: 'succeeded', by: condition.kind };
    }
  }
  return null;
}

/** Facade-stage disruptions do not add abort pressure (Req 7.3). */
export function countsTowardAbort(stageId: string, facadeStages: readonly string[]): boolean {
  return !facadeStages.includes(stageId);
}
