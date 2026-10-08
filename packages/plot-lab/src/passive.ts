import type { OutcomeCondition, PlotTemplateV2 } from '@tradecraft/content';
import { loadBench, playQuoteResolve } from './oracle-play.js';
import {
  accumulatedDeadlineDays,
  advanceLibrary,
  createPrng,
  derive,
  expand,
  libraryPreset,
  rerouteAlternative,
  verifyLibrary,
  worstCaseDeadlineDay,
  type PlotStateV2,
  type Prng,
} from '@tradecraft/engine';

export interface PassiveReport {
  /** Fraction of seeds in which each on-map stage executed. */
  readonly executed: Readonly<Record<string, number>>;
  /** Fraction of seeds in which each runtime alternative was taken. */
  readonly alternatives: Readonly<Record<string, number>>;
  /** Stages and alternatives whose rate was zero. */
  readonly never: readonly string[];
  /** Fraction of seeds that reached a resolution. */
  readonly completion: number;
  /** Fraction of seeds that passed `verifyLibrary`. */
  readonly finalPassRate: number;
  readonly coherent: boolean;
  readonly issues: readonly string[];
  readonly failingSeeds: readonly string[];
}

const QUIET = {
  alertness: 0,
  adoptedBeliefs: [] as string[],
  roleStatus: {},
  arrestedRoles: new Set<string>(),
  seizedItems: new Set<string>(),
  identifiedRoles: new Set<string>(),
  protectedEntities: new Set<string>(),
  entityStatus: {},
  disrupted: new Set<string>(),
};

/** Days a passive watch waits: the worst-case accumulated deadline, plus three. */
export function passiveMaxDays(
  template: PlotTemplateV2,
  slackDays: number,
): number {
  return worstCaseDeadlineDay(deadlineStagesOf(template), slackDays) + 3;
}

function deadlineStagesOf(template: PlotTemplateV2): {
  id: string;
  requires: readonly string[];
  deadline?: { min: number; max: number };
}[] {
  const stages: { id: string; requires: readonly string[]; deadline?: { min: number; max: number } }[] = [];
  const walk = (entries: PlotTemplateV2['stages']): void => {
    for (const entry of entries) {
      if ('branch' in entry) {
        for (const alt of entry.alternatives) {
          walk(alt.stages);
        }
        continue;
      }
      if ('deadline' in entry && entry.deadline !== undefined) {
        stages.push({
          id: entry.id,
          requires: entry.requires,
          deadline: entry.deadline,
        });
      }
    }
  };
  walk(template.stages);
  return stages;
}

function runtimeBranches(template: PlotTemplateV2): PlotStateV2['runtimeBranches'] {
  const branches: PlotStateV2['runtimeBranches'][number][] = [];
  for (const entry of template.stages) {
    if (!('branch' in entry) || entry.resolve !== 'runtime') {
      continue;
    }
    branches.push({
      id: entry.branch,
      after: entry.after,
      alternatives: entry.alternatives.map((alt) => ({
        id: alt.id,
        when: alt.when,
        stageIds: alt.stages.map((stage) => stage.id),
      })),
    });
  }
  return branches;
}

function holdersOf(expanded: ReturnType<typeof expand>): Record<string, string> {
  const holders: Record<string, string> = {};
  for (const stage of expanded.stages) {
    for (const trace of stage.source.traces ?? []) {
      for (const role of trace.roles) {
        holders[role] = `npc:${role}`;
      }
    }
  }
  return holders;
}

/** The debrief card the lab checks. Timeline entries are stages that happened. */
export function debriefOf(template: PlotTemplateV2, plot: PlotStateV2): {
  readonly templateId: string;
  readonly timeline: readonly { readonly stage: string }[];
  readonly twist?: { readonly propositions: readonly string[] };
} {
  return {
    templateId: plot.templateId,
    timeline: plot.stages
      .filter((stage) => stage.status === 'executed' || stage.status === 'disrupted' || stage.offMap)
      .map((stage) => ({ stage: stage.id })),
    ...(template.twist === undefined
      ? {}
      : {
          twist: {
            propositions: template.twist.propositions.map(
              (proposition) => `${proposition.predicate} ${proposition.subject} ${proposition.object}`,
            ),
          },
        }),
  };
}

/**
 * Req 18.5: every timeline entry names a stage that happened, every twist lists
 * propositions, and every plot appears.
 */
export function coherenceIssues(
  plots: readonly PlotStateV2[],
  debrief: readonly { readonly templateId: string; readonly timeline: readonly { readonly stage: string }[]; readonly twist?: { readonly propositions: readonly string[] } }[],
): readonly string[] {
  const issues: string[] = [];
  const shown = new Set(debrief.map((item) => item.templateId));
  for (const plot of plots) {
    if (!shown.has(plot.templateId)) {
      issues.push(`${plot.templateId} does not appear in the debrief`);
    }
    const card = debrief.find((item) => item.templateId === plot.templateId);
    const happened = new Set(
      plot.stages
        .filter((stage) => stage.status === 'executed' || stage.status === 'disrupted' || stage.offMap)
        .map((stage) => stage.id),
    );
    for (const entry of card?.timeline ?? []) {
      if (!happened.has(entry.stage)) {
        issues.push(`${plot.templateId} timeline ${entry.stage} did not happen`);
      }
    }
    if (card?.twist !== undefined && card.twist.propositions.length === 0) {
      issues.push(`${plot.templateId} twist has no propositions`);
    }
  }
  return issues;
}

function plotOf(
  template: PlotTemplateV2,
  expanded: ReturnType<typeof expand>,
  rng: Prng,
  slackDays: number,
): PlotStateV2 {
  const membership = new Map<string, { branch: string; alt: string }>();
  for (const branch of expanded.runtimeBranches) {
    for (const alt of branch.alternatives) {
      for (const id of alt.stageIds) {
        membership.set(id, { branch: branch.id, alt: alt.id });
      }
    }
  }
  const deadlineDays = accumulatedDeadlineDays(
    expanded.stages.map((item) => ({
      id: item.id,
      requires: item.source.requires,
      ...(item.source.deadline === undefined ? {} : { deadline: item.source.deadline }),
    })),
    slackDays,
    rng,
  );
  return {
    id: `plot:${template.id}`,
    templateId: template.id,
    displayName: template.displayName,
    archetype: template.archetype,
    role: 'primary',
    variantKey: expanded.variantKey,
    cells: [],
    cutouts: [],
    roleHolders: holdersOf(expanded),
    knowledge: {},
    runtimeBranches: runtimeBranches(template),
    outcomes: template.outcomes,
    offMap: expanded.offMap,
    bindings: { place: 'loc:trace' },
    stages: expanded.stages.map((stage) => {
      const member = membership.get(stage.id);
      return {
        id: stage.id,
        status: 'pending' as const,
        deadlineDay: deadlineDays.get(stage.id) ?? stage.source.deadline?.max ?? 4,
        offMap: expanded.offMap.includes(stage.id),
        facade: false,
        roles: [],
        traces: (stage.source.traces ?? []).map((trace) => ({
          kind: trace.kind,
          roles: trace.roles,
          text: trace.text,
          evidences: trace.evidences,
          ...(trace.channel === undefined ? {} : { channel: trace.channel }),
        })),
        ...(member === undefined ? {} : { branch: member.branch, alt: member.alt }),
      };
    }),
    subPlots: [...expanded.subPlots],
    standingPenalty: 0,
    standingReward: 0,
  };
}

/**
 * Passive run: wait, with no player action, until the plot resolves or
 * `maxDays` passes. Records how often each stage executed and each runtime
 * alternative was taken.
 */
export function passiveReach(
  template: PlotTemplateV2,
  templates: ReadonlyMap<string, PlotTemplateV2>,
  preset: { readonly id: string; readonly plot: { readonly stageCount: number; readonly deadlineSlackDays: number } },
  seeds: number,
  maxDays: number,
): PassiveReport {
  const stageCounts: Record<string, number> = {};
  const altCounts: Record<string, number> = {};
  const seenStages = new Set<string>();
  const seenAlts = new Set<string>();
  let resolved = 0;
  let verified = 0;
  const failing: string[] = [];
  const issues = new Set<string>();
  for (let seed = 1; seed <= seeds; seed += 1) {
    const seedId = `plot-lab:${template.id}:${seed}`;
    try {
      const rng = createPrng(derive(`plot-lab:${template.id}:${seed}`, 0x32000));
      const expanded = expand(template, libraryPreset(preset), templates, rng);
      for (const stage of expanded.stages) {
        seenStages.add(stage.id);
      }
      for (const branch of expanded.runtimeBranches) {
        for (const alt of branch.alternatives) {
          seenAlts.add(`alt:${branch.id}/${alt.id}`);
        }
      }
      let plots = [plotOf(template, expanded, rng, preset.plot.deadlineSlackDays)];
      if (verifyLibrary(plots).ok) {
        verified += 1;
      } else {
        failing.push(seedId);
      }
      for (let day = 1; day <= maxDays; day += 1) {
        const stepped = advanceLibrary(plots, QUIET, { day, phase: 3 }, rng);
        plots = [...stepped.plots];
        if (plots[0]?.resolution !== undefined) {
          break;
        }
      }
      const plot = plots[0];
      if (plot === undefined) {
        failing.push(seedId);
        continue;
      }
      if (plot.resolution !== undefined) {
        resolved += 1;
      } else {
        failing.push(seedId);
      }
      for (const issue of coherenceIssues([plot], [debriefOf(template, plot)])) {
        issues.add(issue);
        failing.push(seedId);
      }
      for (const stage of plot.stages) {
        if (stage.status === 'executed') {
          stageCounts[stage.id] = (stageCounts[stage.id] ?? 0) + 1;
        }
      }
      for (const branch of plot.runtimeBranches) {
        if (branch.resolved !== undefined) {
          const key = `alt:${branch.id}/${branch.resolved.alt}`;
          altCounts[key] = (altCounts[key] ?? 0) + 1;
        }
      }
    } catch {
      failing.push(seedId);
    }
  }
  const rate = (counts: Record<string, number>, ids: Set<string>): Record<string, number> =>
    Object.fromEntries([...ids].sort().map((id) => [id, seeds === 0 ? 0 : (counts[id] ?? 0) / seeds]));
  const executed = rate(stageCounts, seenStages);
  const alternatives = rate(altCounts, seenAlts);
  const never = [
    ...[...seenStages].filter((id) => (stageCounts[id] ?? 0) === 0),
    ...[...seenAlts].filter((id) => (altCounts[id] ?? 0) === 0),
  ].sort();
  return {
    executed,
    alternatives,
    never,
    completion: seeds === 0 ? 1 : resolved / seeds,
    finalPassRate: seeds === 0 ? 1 : verified / seeds,
    coherent: issues.size === 0,
    issues: [...issues].sort(),
    failingSeeds: [...new Set(failing)].sort(),
  };
}

const ACTION: Readonly<Record<string, readonly string[]>> = {
  'arrest-role': ['surveil', 'follow', 'identify', 'arrest'],
  'seize-item': ['surveil', 'intercept', 'decrypt', 'seize'],
  'identify-role': ['surveil', 'follow', 'identify'],
  'protect-until': ['surveil', 'follow'],
  'entity-status': ['surveil'],
};

const PLAYER_SUCCESS = new Set(['arrest-role', 'seize-item', 'identify-role', 'protect-until', 'entity-status']);

/** The cheapest player success condition. Abort is not a quote/resolve plan. */
export function cheapestSuccess(template: PlotTemplateV2): OutcomeCondition | undefined {
  const playable = template.outcomes.success.filter((condition) => PLAYER_SUCCESS.has(condition.kind));
  return [...playable].sort(
    (a, b) => (ACTION[a.kind]?.length ?? 9) - (ACTION[b.kind]?.length ?? 9),
  )[0];
}

/** The cheapest success condition and the quote/resolve actions that pursue it. */
export function oraclePlan(template: PlotTemplateV2): { readonly target: string; readonly actions: readonly string[] } {
  const chosen = cheapestSuccess(template);
  if (chosen === undefined) {
    return { target: 'none', actions: ['wait'] };
  }
  const name = chosen.role ?? chosen.item ?? chosen.entity ?? chosen.kind;
  return { target: `${chosen.kind}:${name}`, actions: ACTION[chosen.kind] ?? ['quote', 'resolve'] };
}

function quietFacts(): {
  alertness: number;
  adoptedBeliefs: string[];
  roleStatus: Record<string, string>;
  arrestedRoles: Set<string>;
  seizedItems: Set<string>;
  identifiedRoles: Set<string>;
  protectedEntities: Set<string>;
  entityStatus: Record<string, string>;
  disrupted: Set<string>;
} {
  return {
    alertness: 0,
    adoptedBeliefs: [],
    roleStatus: {},
    arrestedRoles: new Set(),
    seizedItems: new Set(),
    identifiedRoles: new Set(),
    protectedEntities: new Set(),
    entityStatus: {},
    disrupted: new Set(),
  };
}

/** Facts the planned quote/resolve sequence would establish. */
function factsAfterPlan(condition: OutcomeCondition | undefined) {
  const facts = quietFacts();
  if (condition === undefined) {
    return facts;
  }
  if (condition.kind === 'arrest-role' && condition.role !== undefined) {
    facts.arrestedRoles.add(condition.role);
  } else if (condition.kind === 'seize-item' && condition.item !== undefined) {
    facts.seizedItems.add(condition.item);
  } else if (condition.kind === 'identify-role' && condition.role !== undefined) {
    facts.identifiedRoles.add(condition.role);
  } else if (condition.kind === 'protect-until' && condition.entity !== undefined) {
    facts.protectedEntities.add(condition.entity);
  } else if (condition.kind === 'entity-status' && condition.entity !== undefined && condition.status !== undefined) {
    facts.entityStatus[condition.entity] = condition.status;
  }
  return facts;
}

export interface OracleReport {
  readonly plan: { readonly target: string; readonly actions: readonly string[] };
  readonly rate: number;
  readonly losses: readonly string[];
  readonly reroutes: readonly { readonly stage: string; readonly switched: boolean }[];
}

/**
 * Oracle player. It picks the cheapest success condition and plays that plan
 * through `quote` and `resolve` on a generated world, using the truth store
 * for the leader and the true cipher key. A seed wins when that play is
 * allowed and the primary is disrupted while the final stage is still pending.
 * Reroute mode disrupts the first stage of each runtime alternative.
 */
export function runOracle(
  template: PlotTemplateV2,
  templates: ReadonlyMap<string, PlotTemplateV2>,
  preset: { readonly id: string; readonly plot: { readonly stageCount: number; readonly deadlineSlackDays: number } },
  seeds: number,
  maxDays: number,
): OracleReport {
  const plan = oraclePlan(template);
  const condition = cheapestSuccess(template);
  const reroutes = exerciseReroutes(template);
  if (condition === undefined || seeds === 0) {
    return { plan, rate: 1, losses: [], reroutes };
  }
  loadBench();
  let wins = 0;
  const losses: string[] = [];
  for (let seed = 1; seed <= seeds; seed += 1) {
    const seedId = `plot-lab:${template.id}:${seed}`;
    try {
      const rng = createPrng(derive(`plot-lab:${template.id}:oracle:${seed}`, 0x32000));
      if (!playQuoteResolve(plan.actions, rng)) {
        losses.push(seedId);
        continue;
      }
      const expanded = expand(template, libraryPreset(preset), templates, rng);
      let plots = [plotOf(template, expanded, rng, preset.plot.deadlineSlackDays)];
      const finalId = plots[0]?.stages
        .filter((stage) => !stage.offMap)
        .reduce<{ id: string; day: number } | undefined>((latest, stage) => {
          if (latest === undefined || stage.deadlineDay >= latest.day) {
            return { id: stage.id, day: stage.deadlineDay };
          }
          return latest;
        }, undefined);
      const actDay = Math.max(1, (finalId?.day ?? 1) - 1);
      for (let day = 1; day <= maxDays; day += 1) {
        const facts = day >= actDay ? factsAfterPlan(condition) : quietFacts();
        const stepped = advanceLibrary(plots, facts, { day, phase: 3 }, rng);
        plots = [...stepped.plots];
        if (plots[0]?.resolution !== undefined) {
          break;
        }
      }
      const plot = plots[0];
      const finalStage = plot?.stages.find((stage) => stage.id === finalId?.id);
      if (plot?.resolution?.result === 'disrupted' && finalStage?.status !== 'executed') {
        wins += 1;
      } else {
        losses.push(seedId);
      }
    } catch {
      losses.push(seedId);
    }
  }
  return { plan, rate: wins / seeds, losses, reroutes };
}

/** Disrupt the first stage of each runtime alternative and record whether a sibling was taken. */
export function exerciseReroutes(
  template: PlotTemplateV2,
): readonly { readonly stage: string; readonly switched: boolean }[] {
  const results: { stage: string; switched: boolean }[] = [];
  for (const entry of template.stages) {
    if (!('branch' in entry) || entry.resolve !== 'runtime') {
      continue;
    }
    for (const alt of entry.alternatives) {
      const first = alt.stages[0];
      if (first === undefined) {
        continue;
      }
      const switched = rerouteAlternative(
        {
          id: entry.branch,
          after: entry.after,
          alternatives: entry.alternatives.map((item) => ({
            id: item.id,
            when: item.when,
            stageIds: item.stages.map((stage) => stage.id),
          })),
          resolved: { alt: alt.id, cause: 'default' },
        },
        first.id,
      );
      results.push({ stage: first.id, switched: switched !== undefined });
    }
  }
  return results;
}

/** The first stage of each runtime alternative, for a reroute exercise. */
export function rerouteTargets(template: PlotTemplateV2): readonly string[] {
  const ids: string[] = [];
  for (const entry of template.stages) {
    if (!('branch' in entry) || entry.resolve !== 'runtime') {
      continue;
    }
    for (const alt of entry.alternatives) {
      const first = alt.stages[0];
      if (first !== undefined) {
        ids.push(first.id);
      }
    }
  }
  return ids;
}
