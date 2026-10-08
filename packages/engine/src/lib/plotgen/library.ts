/**
 * Opt-in library session: selection, instantiation, branch resolution,
 * off-map execution, outcomes and a structural verifier.
 *
 * The slice generator does not call this unless `scenario.plotSelection.enabled`
 * is set, so a core-only seed keeps its draws.
 */

import { isStageV2, type DocumentTemplate, type PlotTemplateV2, type StageV2 } from '@tradecraft/content';
import type { CityView } from '../setting/city-view.js';
import { composeCable } from '../docs/cable.js';
import { docId, type Document } from '../docs/document.js';
import type { NamerContext } from '../docs/namer.js';
import { asTruth, type DocId, type EntityId, type GameTime, type ItemId, type LocId, type NpcId } from '../model/core.js';
import type { PlotState, RoleBinding, StageState, StageTrace } from '../city/plot.js';
import type { EventId, SimEvent, StageId } from '../model/state.js';
import { createPrng, derive, type Prng } from '../prng/prng.js';
import { checkConsistency, reschedule, type Conflict, type ScheduleEntry } from './consistency.js';
import { bind, bindable, type BindCity } from './bind.js';
import { expand } from './expand.js';
import { instantiate, type InstantiateWorld } from './instantiate.js';
import { countsTowardAbort, evaluateOutcomes } from './outcomes.js';
import { accumulatedDeadlineDays, scopeStageRequires } from './deadlines.js';
import { libraryPreset, type PresetSource } from './preset.js';
import { resolveBranch, rerouteAlternative, type BranchWorld, type RuntimeBranch } from './branches.js';
import {
  select,
  type PlotSelectionConfig,
  type SelectionResult,
  type TemplateHistory,
} from './select.js';
import { type SideThreadState } from './sidethread.js';
import type { LibraryBranch, PlotStateV2 } from './types.js';

/** Selection could not produce a consistent set of plots. */
export class LibrarySelectionError extends Error {
  readonly log: readonly string[];

  constructor(log: readonly string[]) {
    super(log.join('; '));
    this.name = 'LibrarySelectionError';
    this.log = log;
  }
}

export interface LibrarySession {
  readonly plots: readonly PlotStateV2[];
  readonly threads: SideThreadState['threads'];
  readonly selection: SelectionResult;
  readonly log: readonly string[];
}

export interface LibraryBuildInput {
  readonly templates: readonly PlotTemplateV2[];
  readonly city: BindCity;
  readonly preset: PresetSource;
  readonly year: number;
  readonly world: InstantiateWorld;
  readonly sideThreads?: readonly PlotTemplateV2[];
  readonly sideThreadCount?: number;
  readonly config?: PlotSelectionConfig;
  readonly history?: TemplateHistory;
  /**
   * World seed. Present for a real generation, so a failed consistency attempt
   * reseeds from `derive(derive(seed, 0x31000), k)` instead of continuing the
   * caller's stream. Tests omit it and keep one stream.
   */
  readonly seed?: string;
}

/** Project a {@link CityView} into the binder, including exclude tags. */
export function bindCityFromView(view: CityView): BindCity {
  const tags = new Map<string, readonly string[]>();
  for (const kind of ['npc', 'loc', 'org', 'item', 'district'] as const) {
    for (const entity of view.entities(kind)) {
      tags.set(entity.id, entity.tags);
    }
  }
  return {
    binders: (kind, query) => view.binders(kind, query),
    archetypesWithTags: (query) => view.archetypesWithTags(query),
    tags: (id) => tags.get(id) ?? [],
  };
}

function templateMap(templates: readonly PlotTemplateV2[]): Map<string, PlotTemplateV2> {
  const map = new Map<string, PlotTemplateV2>();
  for (const template of templates) {
    map.set(template.id, template);
  }
  return map;
}

function slotHolders(template: PlotTemplateV2, cells: PlotStateV2['cells']): Map<string, string> {
  const holders = new Map<string, string>();
  template.cells.forEach((cell, index) => {
    const members = cells[index]?.members ?? [];
    cell.roles.forEach((slot, roleIndex) => {
      const npc = members[roleIndex];
      if (npc !== undefined) {
        holders.set(slot, npc);
      }
    });
  });
  return holders;
}

function knowledgeOf(
  template: PlotTemplateV2,
  cells: PlotStateV2['cells'],
  stages: PlotStateV2['stages'],
  cutouts: readonly string[],
): Record<string, readonly string[]> {
  const holders = slotHolders(template, cells);
  const known = new Map<string, Set<string>>();
  const add = (npc: string | undefined, item: string): void => {
    if (npc === undefined) {
      return;
    }
    const set = known.get(npc) ?? new Set<string>();
    set.add(item);
    known.set(npc, set);
  };
  for (const cell of cells) {
    for (const member of cell.members) {
      for (const other of cell.members) {
        add(member, other);
      }
    }
  }
  template.cutouts.forEach((cutout, index) => {
    const npc = cutouts[index];
    for (const link of cutout.links) {
      const linked = cells.find((cell) => cell.spec === link);
      for (const member of linked?.members ?? []) {
        add(npc, member);
      }
    }
  });
  const leader = holders.get('leader') ?? cells[0]?.members[0];
  for (const stage of stages) {
    add(leader, stage.id);
    for (const role of stage.roles) {
      add(holders.get(role), stage.id);
    }
  }
  const out: Record<string, string[]> = {};
  for (const [npc, items] of known) {
    out[npc] = [...items].sort();
  }
  return out;
}

/** Raise or lower the security of the cell that contains `member`, and no other cell. */
export function adaptCell(plot: PlotStateV2, member: string, delta: number): PlotStateV2 {
  const index = plot.cells.findIndex((cell) => cell.members.includes(member));
  if (index < 0) {
    return plot;
  }
  const cells = plot.cells.map((cell, cellIndex) =>
    cellIndex === index
      ? { ...cell, security: Math.min(1, Math.max(0, cell.security + delta)) }
      : cell,
  );
  return { ...plot, cells };
}

function toBranches(template: PlotTemplateV2): LibraryBranch[] {
  const branches: LibraryBranch[] = [];
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

function cityHooksOf(template: PlotTemplateV2): NonNullable<PlotStateV2['cityHooks']> {
  const hooks: {
    id: string;
    city?: string;
    fallback?: string;
    handoff?: StageV2['handoff'];
  }[] = [];
  for (const entry of template.stages) {
    if (!isStageV2(entry)) {
      continue;
    }
    if (entry.city === undefined && entry.fallback === undefined && entry.handoff === undefined) {
      continue;
    }
    hooks.push({
      id: entry.id,
      ...(entry.city === undefined ? {} : { city: entry.city }),
      ...(entry.fallback === undefined ? {} : { fallback: entry.fallback }),
      ...(entry.handoff === undefined ? {} : { handoff: entry.handoff }),
    });
  }
  return hooks;
}

function outcomesWithoutOffMap(
  outcomes: PlotTemplateV2['outcomes'],
  offMap: readonly string[],
): PlotStateV2['outcomes'] {
  const hidden = new Set(offMap);
  const keep = (condition: { readonly stage?: string }): boolean =>
    condition.stage === undefined || !hidden.has(condition.stage);
  return {
    success: outcomes.success.filter(keep),
    failure: outcomes.failure.filter(keep),
  };
}

function toPlot(
  template: PlotTemplateV2,
  role: 'primary' | 'secondary',
  city: BindCity,
  content: ReadonlyMap<string, PlotTemplateV2>,
  preset: PresetSource,
  world: InstantiateWorld,
  rng: Prng,
  claimed: Set<string>,
  shareableHeld: Set<string>,
): PlotStateV2 | undefined {
  if (!bindable(template, city).ok) {
    return undefined;
  }
  const bound = bind(template, city, rng);
  if (!bound.ok) {
    return undefined;
  }
  const knobs = libraryPreset(preset);
  const expanded = expand(template, knobs, content, rng);
  const made = instantiate(
    template,
    expanded,
    knobs,
    world,
    rng,
    role,
    '1',
    bound.bindings,
    claimed,
    shareableHeld,
  );
  const facade = new Set(made.twist?.facadeStages ?? []);
  const deadlineDays = accumulatedDeadlineDays(
    expanded.stages.map((stage) => ({
      id: stage.id,
      requires: scopeStageRequires(stage.id, stage.source.requires),
      ...(stage.source.deadline === undefined ? {} : { deadline: stage.source.deadline }),
    })),
    knobs.deadlineSlackDays,
    rng,
  );
  const stages = expanded.stages.map((stage) => {
    const branch = expanded.runtimeBranches.find((item) =>
      item.alternatives.some((alt) => alt.stageIds.includes(stage.id)),
    );
    const alt = branch?.alternatives.find((item) => item.stageIds.includes(stage.id));
    return {
      id: stage.id,
      status: 'pending' as const,
      deadlineDay: deadlineDays.get(stage.id) ?? stage.source.deadline?.max ?? 4,
      offMap: expanded.offMap.includes(stage.id),
      facade: facade.has(stage.id),
      ...(branch === undefined ? {} : { branch: branch.id }),
      ...(alt === undefined ? {} : { alt: alt.id }),
      roles: stage.source.traces.flatMap((trace) => trace.roles),
      traces: stage.source.traces.map((trace) => ({
        kind: trace.kind,
        roles: trace.roles,
        text: trace.text,
        evidences: trace.evidences,
        ...(trace.channel === undefined ? {} : { channel: trace.channel }),
        ...(trace.materiel === undefined ? {} : { materiel: trace.materiel }),
      })),
      ...(stage.source.onDisrupted === undefined ? {} : { onDisrupted: stage.source.onDisrupted }),
      ...(stage.source.requires.length === 0 ? {} : { requires: stage.source.requires }),
      ...(stage.source.city === undefined ? {} : { city: stage.source.city }),
      ...(stage.source.fallback === undefined ? {} : { fallback: stage.source.fallback }),
      ...(stage.source.handoff === undefined ? {} : { handoff: stage.source.handoff }),
    };
  });
  const hooks = cityHooksOf(template);
  return {
    id: `plot:${template.id}`,
    templateId: template.id,
    displayName: template.displayName,
    archetype: template.archetype,
    role,
    variantKey: made.variantKey,
    cells: made.cells,
    cutouts: made.cutouts,
    bindings: bound.bindings,
    roleHolders: Object.fromEntries(slotHolders(template, made.cells)),
    knowledge: knowledgeOf(template, made.cells, stages, made.cutouts),
    runtimeBranches: toBranches(template),
    ...(made.twist === undefined
      ? {}
      : {
          twist: {
            kind: made.twist.kind,
            facadeStages: made.twist.facadeStages,
            ...(made.twist.decoy === undefined ? {} : { decoy: made.twist.decoy }),
            ...(made.twist.inside === undefined ? {} : { inside: made.twist.inside }),
            ...(made.twist.cover === undefined ? {} : { cover: made.twist.cover }),
            ...(made.twist.plants === undefined ? {} : { plants: made.twist.plants }),
            ...(made.twist.trueAllegiance === undefined ? {} : { trueAllegiance: made.twist.trueAllegiance }),
            ...(made.twist.apparentAllegiance === undefined
              ? {}
              : { apparentAllegiance: made.twist.apparentAllegiance }),
            propositions: template.twist?.propositions.map((item) => item.predicate) ?? [],
          },
        }),
    outcomes: outcomesWithoutOffMap(template.outcomes, made.offMap),
    offMap: made.offMap,
    ...(template.cityRoles === undefined ? {} : { cityRoles: template.cityRoles }),
    ...(hooks.length === 0 ? {} : { cityHooks: hooks }),
    stages,
    subPlots: made.subPlots,
    standingPenalty: made.standingPenalty,
    standingReward: made.standingReward,
    itemOrigins: made.itemOrigins,
    ...(made.damageReport === undefined ? {} : { damageReport: made.damageReport }),
  };
}

const SELECT_STREAM = 0x31000;
const CONSISTENCY_ATTEMPTS = 8;
const RESELECT_ATTEMPTS = 4;
const DAY_PHASES = 4;
const FUNCTIONAL = new Set(['HOLDS', 'LOCATED_AT']);

function bookingsOf(plots: readonly PlotStateV2[]): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  plots.forEach((plot, index) => {
    const place = Object.values(plot.bindings).find((value) => value.startsWith('loc:')) ?? plot.id;
    for (const stage of plot.stages) {
      if (stage.offMap || stage.roles.length === 0) {
        continue;
      }
      for (const role of new Set(stage.roles)) {
        const npc = plot.roleHolders[role];
        if (npc === undefined) {
          continue;
        }
        entries.push({
          npc,
          at: stage.traceAt ?? stage.deadlineDay * DAY_PHASES,
          place,
          source: `${plot.id}:${stage.id}`,
          precedence: plot.role === 'primary' ? 0 : index + 1,
        });
      }
    }
  });
  return entries;
}

function holdsFacts(plots: readonly PlotStateV2[]) {
  const facts = [];
  for (const plot of plots) {
    for (const [item, holder] of Object.entries(plot.itemOrigins ?? {})) {
      facts.push({
        id: `${plot.id}:${item}`,
        predicate: 'HOLDS',
        subject: item,
        object: holder,
        from: 0,
        to: 10_000,
      });
    }
  }
  return facts;
}

/**
 * Shift later double-bookings to a free phase on the same day. A functional
 * conflict, or a day with no free phase, fails the attempt.
 */
export function reconcilePlots(plots: readonly PlotStateV2[]):
  | { readonly ok: true; readonly plots: readonly PlotStateV2[] }
  | { readonly ok: false; readonly templateId: string } {
  let schedule = bookingsOf(plots);
  const facts = holdsFacts(plots);
  let conflicts = checkConsistency(facts, FUNCTIONAL, schedule);
  const moved = new Map<string, number>();
  let guard = 0;
  while (conflicts.length > 0 && guard < 32) {
    const functional = conflicts.find((conflict) => conflict.kind === 'functional');
    if (functional !== undefined) {
      return { ok: false, templateId: blamed(plots, functional.a) };
    }
    const conflict = conflicts.find((item) => item.kind === 'double-booked');
    if (conflict === undefined || conflict.kind !== 'double-booked') {
      break;
    }
    const deadline = conflict.at - (conflict.at % DAY_PHASES) + (DAY_PHASES - 1);
    const next = reschedule(schedule, conflict, deadline);
    if (next === undefined) {
      return { ok: false, templateId: blamed(plots, conflict.b) };
    }
    for (const entry of next) {
      const previous = schedule.find((item) => item.source === entry.source && item.npc === entry.npc);
      if (previous !== undefined && previous.at !== entry.at) {
        moved.set(entry.source, entry.at);
      }
    }
    schedule = next;
    conflicts = checkConsistency(facts, FUNCTIONAL, schedule);
    guard += 1;
  }
  if (conflicts.length > 0) {
    const first = conflicts[0];
    return { ok: false, templateId: blamed(plots, first === undefined ? '' : first.kind === 'double-booked' ? first.b : first.a) };
  }
  if (moved.size === 0) {
    return { ok: true, plots };
  }
  return {
    ok: true,
    plots: plots.map((plot) => ({
      ...plot,
      stages: plot.stages.map((stage) => {
        const at = moved.get(`${plot.id}:${stage.id}`);
        return at === undefined ? stage : { ...stage, traceAt: at };
      }),
    })),
  };
}

function blamed(plots: readonly PlotStateV2[], source: string): string {
  const plot = plots.find((item) => source.startsWith(`${item.id}:`) || source.startsWith(item.id));
  return plot?.templateId ?? plots[0]?.templateId ?? source;
}

function instantiateSelection(
  input: LibraryBuildInput,
  content: ReadonlyMap<string, PlotTemplateV2>,
  chosen: readonly string[],
  rng: Prng,
  log: string[],
): PlotStateV2[] {
  const plots: PlotStateV2[] = [];
  const claimed = new Set<string>();
  const shareableHeld = new Set<string>();
  for (const [index, id] of chosen.entries()) {
    const template = content.get(id);
    if (template === undefined) {
      continue;
    }
    const plot = toPlot(
      template,
      index === 0 ? 'primary' : 'secondary',
      input.city,
      content,
      input.preset,
      input.world,
      rng,
      claimed,
      shareableHeld,
    );
    if (plot === undefined) {
      log.push(`instantiate failed ${id}`);
      continue;
    }
    plots.push(plot);
  }
  return plots;
}

/**
 * Select and instantiate the primary, then secondaries. Lookalike side
 * threads are placed later by the noise generator. A bind failure or an
 * unresolvable consistency conflict excludes that template and selects again.
 */
export function buildLibrarySession(input: LibraryBuildInput, rng: Prng): LibrarySession | undefined {
  const stories = input.templates.filter((template) => template.kind === 'plot');
  if (stories.length === 0) {
    return undefined;
  }
  const content = templateMap(stories);
  const excluded: string[] = [];
  const log: string[] = [];
  for (let reselect = 0; reselect < RESELECT_ATTEMPTS; reselect += 1) {
    const selectRng =
      input.seed === undefined || reselect === 0
        ? rng
        : createPrng(derive(derive(input.seed, SELECT_STREAM), reselect));
    const selection = select(
      {
        templates: stories,
        city: input.city,
        preset: input.preset,
        year: input.year,
        history: input.history,
        excluded,
        ...(input.config === undefined ? {} : { config: input.config }),
      },
      selectRng,
    );
    if (selection === 'no-eligible-template') {
      log.push(`reselect ${reselect}: none eligible`);
      if (log.length > 1) {
        throw new LibrarySelectionError(log);
      }
      return undefined;
    }
    const primary = content.get(selection.primary);
    if (primary === undefined || !bindable(primary, input.city).ok) {
      log.push(`reselect ${reselect}: ${selection.primary} unbindable`);
      excluded.push(selection.primary);
      continue;
    }
    const chosen = [selection.primary, ...selection.secondaries];
    let blame = selection.primary;
    for (let attempt = 0; attempt < CONSISTENCY_ATTEMPTS; attempt += 1) {
      const attemptRng =
        input.seed === undefined || attempt === 0
          ? selectRng
          : createPrng(derive(derive(input.seed, SELECT_STREAM), 0x100 + attempt));
      const plots = instantiateSelection(input, content, chosen, attemptRng, log);
      if (plots.length === 0) {
        log.push(`consistency ${blame} seed ${input.seed ?? 'unset'}`);
        continue;
      }
      const reconciled = reconcilePlots(plots);
      if (reconciled.ok) {
        const verified = verifyLibrary(reconciled.plots, { mole: input.world.mole });
        if (verified.ok) {
          return { plots: reconciled.plots, threads: [], selection, log };
        }
        const failure = verified.failures[0];
        const named = reconciled.plots.find((item) => item.id === failure?.plot);
        blame = named?.templateId ?? failure?.plot ?? blame;
        log.push(
          `verify ${blame} ${failure?.target ?? ''} ${failure?.reason ?? 'no-signal'} seed ${input.seed ?? 'unset'}`,
        );
        continue;
      }
      blame = reconciled.templateId;
      log.push(`consistency ${blame} seed ${input.seed ?? 'unset'}`);
    }
    log.push(`reselect ${reselect}: ${blame}`);
    excluded.push(blame);
  }
  throw new LibrarySelectionError(log);
}

/** Plot bookings plus side-thread traces, after any consistency reschedule. */
export function libraryConflicts(
  plots: readonly PlotStateV2[],
  threads: SideThreadState['threads'],
): Conflict[] {
  const schedule = [...bookingsOf(plots), ...threadBookings(threads)];
  return checkConsistency(holdsFacts(plots), FUNCTIONAL, schedule);
}

function threadBookings(threads: SideThreadState['threads']): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  for (const thread of threads) {
    if (thread.place === undefined || thread.at === undefined) {
      continue;
    }
    for (const npc of thread.participants ?? []) {
      entries.push({
        npc,
        at: thread.at,
        place: thread.place,
        source: thread.id,
        precedence: 100,
      });
    }
  }
  return entries;
}

export interface LibraryFacts {
  readonly alertness: number;
  readonly adoptedBeliefs: readonly string[];
  readonly roleStatus: Readonly<Record<string, string>>;
  readonly arrestedRoles: ReadonlySet<string>;
  readonly seizedItems: ReadonlySet<string>;
  readonly identifiedRoles: ReadonlySet<string>;
  readonly protectedEntities: ReadonlySet<string>;
  readonly entityStatus: Readonly<Record<string, string>>;
  readonly disrupted: ReadonlySet<string>;
}

/** The world fields the clock can see when it builds {@link LibraryFacts}. */
export interface LibraryFactSource {
  readonly arrests: readonly string[];
  readonly identifications?: readonly { readonly roleTag: string; readonly correct: boolean }[];
  /**
   * Hostile alertness in `[0, 1]`. The engine records that reading as the
   * player's cover suspicion.
   */
  readonly alertness?: number;
  /** Adopted-belief predicates and proposition ids the service already holds. */
  readonly adoptedBeliefs?: readonly string[];
  /** The day being resolved. Protection is checked against this day. */
  readonly nowDay?: number;
  readonly people?: readonly {
    readonly id: string;
    readonly status?: string;
    readonly hostileCustody?: boolean;
  }[];
  readonly plots?: readonly {
    readonly roleHolders: Readonly<Record<string, string>>;
    readonly bindings: Readonly<Record<string, string>>;
    readonly stages: readonly { readonly id: string; readonly status: string; readonly deadlineDay?: number }[];
    readonly outcomes?: {
      readonly success: readonly { readonly kind: string; readonly entity?: string; readonly until?: 'final-deadline' | number }[];
      readonly failure: readonly { readonly kind: string; readonly entity?: string; readonly until?: 'final-deadline' | number }[];
    };
  }[];
  readonly sliceRoles: readonly { readonly slot: string; readonly npc?: string }[];
  readonly sliceDisruptedStageIds: readonly string[];
  readonly seizedItemIds: readonly string[];
}

/**
 * Turn player-visible records into the role and item names outcome conditions
 * use. An arrest stores an entity id; a condition names the role slot that
 * entity holds.
 */
export function projectLibraryFacts(source: LibraryFactSource): LibraryFacts {
  const arrestedRoles = new Set<string>();
  const seizedItems = new Set<string>(source.seizedItemIds);
  const disrupted = new Set<string>(source.sliceDisruptedStageIds);
  const holders = new Map<string, Set<string>>();
  const note = (npc: string | undefined, slot: string): void => {
    if (npc === undefined || npc === '') {
      return;
    }
    const slots = holders.get(npc) ?? new Set<string>();
    slots.add(slot);
    holders.set(npc, slots);
  };

  for (const role of source.sliceRoles) {
    note(role.npc, role.slot);
  }
  for (const plot of source.plots ?? []) {
    for (const [slot, npc] of Object.entries(plot.roleHolders)) {
      note(npc, slot);
    }
    for (const [name, id] of Object.entries(plot.bindings)) {
      if (seizedItems.has(id)) {
        seizedItems.add(name);
      }
    }
    for (const stage of plot.stages) {
      if (stage.status === 'disrupted') {
        disrupted.add(stage.id);
      }
    }
  }
  for (const arrest of source.arrests) {
    for (const slot of holders.get(arrest) ?? []) {
      arrestedRoles.add(slot);
    }
  }

  const people = new Map((source.people ?? []).map((person) => [person.id, person]));
  const roleStatus: Record<string, string> = {};
  const entityStatus: Record<string, string> = {};
  const statusOf = (npc: string): string => {
    const person = people.get(npc);
    if (person?.hostileCustody === true) {
      return 'hostile-custody';
    }
    return person?.status ?? 'active';
  };
  for (const [npc, slots] of holders) {
    const status = statusOf(npc);
    entityStatus[npc] = status;
    for (const slot of slots) {
      roleStatus[slot] = status;
      entityStatus[slot] = status;
    }
  }

  const protectedEntities = new Set<string>();
  if (source.nowDay !== undefined) {
    for (const plot of source.plots ?? []) {
      const deadlines = plot.stages.flatMap((stage) =>
        stage.deadlineDay === undefined ? [] : [stage.deadlineDay],
      );
      const finalDeadline = deadlines.length === 0 ? undefined : Math.max(...deadlines);
      const conditions = [...(plot.outcomes?.success ?? []), ...(plot.outcomes?.failure ?? [])];
      for (const condition of conditions) {
        if (condition.kind !== 'protect-until' || condition.entity === undefined || condition.until === undefined) {
          continue;
        }
        const due =
          condition.until === 'final-deadline'
            ? finalDeadline !== undefined && source.nowDay >= finalDeadline
            : source.nowDay >= condition.until;
        const npc = plot.roleHolders[condition.entity] ?? plot.bindings[condition.entity];
        if (due && npc !== undefined && statusOf(npc) === 'active') {
          protectedEntities.add(condition.entity);
        }
      }
    }
  }

  return {
    alertness: source.alertness ?? 0,
    adoptedBeliefs: source.adoptedBeliefs ?? [],
    roleStatus,
    arrestedRoles,
    seizedItems,
    identifiedRoles: new Set(
      (source.identifications ?? []).flatMap((item) => (item.correct ? [item.roleTag] : [])),
    ),
    protectedEntities,
    entityStatus,
    disrupted,
  };
}

function asBranch(branch: LibraryBranch): RuntimeBranch {
  return {
    id: branch.id,
    after: branch.after,
    alternatives: branch.alternatives.map((alt) => ({
      id: alt.id,
      when: alt.when.map((condition) => ({
        kind: condition.kind as 'default',
        negate: condition.negate,
        value: condition.value,
        stage: condition.stage,
        role: condition.role,
        status: condition.status,
        pattern: condition.pattern,
        weight: condition.weight,
      })),
      stageIds: alt.stageIds,
    })),
    ...(branch.resolved === undefined ? {} : { resolved: { alt: branch.resolved.alt, cause: branch.resolved.cause } }),
  };
}

function hidden(kind: SimEvent['kind'], at: GameTime, seq: number, extra: Record<string, unknown>): SimEvent {
  return {
    id: `lib:${at.day}:${at.phase}:${seq}` as EventId,
    at,
    visibility: 'hidden',
    kind,
    ...extra,
  } as SimEvent;
}

const DEFAULT_WEIGHTS = { delay: 0.5, reroute: 0.4, abort: 0.1 };

/**
 * The slice plot the clock executes. It is the library Primary: on-map stages
 * only, in order, with the traces and deadlines the phase step already runs.
 * Off-map stages stay on `plots` and never enter this plot.
 */
export function slicePlotOf(primary: PlotStateV2): PlotState {
  const onMap = primary.stages.filter((stage) => !stage.offMap);
  const leaderNpc =
    (Object.values(primary.roleHolders)[0] as NpcId | undefined) ??
    ((primary.cells[0]?.members[0] as NpcId | undefined) ?? ('npc:unknown' as NpcId));
  const materielId = (Object.keys(primary.itemOrigins ?? {})[0] ??
    Object.values(primary.bindings).find((value) => value.startsWith('item:')) ??
    `item:${primary.id}`) as ItemId;
  const targetId = (Object.values(primary.bindings).find(
    (value) => value.startsWith('loc:') || value.startsWith('org:'),
  ) ?? 'org:cell') as EntityId;
  const venue = Object.values(primary.bindings).find((value) => value.startsWith('loc:'));
  const stages: StageState[] = onMap.map((stage, index) => {
    const traces: StageTrace[] = (stage.traces ?? []).map((trace, traceIndex) => {
      const participants = trace.roles.flatMap((role) => {
        const npc = primary.roleHolders[role];
        return npc === undefined ? [] : [npc as NpcId];
      });
      const boundMateriel = trace.materiel === undefined ? undefined : primary.bindings[trace.materiel];
      return {
        index: traceIndex,
        kind: trace.kind,
        participants,
        evidences: trace.evidences,
        template: trace.text,
        ...(venue === undefined ? {} : { place: { kind: 'loc' as const, loc: venue as LocId } }),
        ...(trace.channel === undefined ? {} : { channelKind: trace.channel }),
        ...(boundMateriel === undefined ? {} : { materiel: boundMateriel as ItemId }),
      };
    });
    const previous = onMap[index - 1];
    return {
      id: stage.id,
      templateId: stage.id,
      requires: previous === undefined ? [] : [`prop:${previous.id}`],
      produces: [`prop:${stage.id}`],
      deadline: { day: stage.deadlineDay, phase: 0 },
      traces,
      onDisrupted: stage.onDisrupted ?? DEFAULT_WEIGHTS,
      status: stage.status,
    };
  });
  const roles: RoleBinding[] = Object.entries(primary.roleHolders).map(([slot, npc]) => ({
    slot,
    archetype: slot,
    npc: npc as NpcId,
  }));
  const resolved = primary.resolution;
  const status = resolved === undefined ? 'running' : resolved.result === 'disrupted' ? 'aborted' : 'completed';
  return {
    template: primary.templateId,
    status,
    stages,
    roles,
    materielSlots: [{ slot: 'materiel', item: materielId }],
    targetSlots: [{ slot: 'target', entity: targetId }],
    materiel: asTruth(materielId),
    leader: asTruth(leaderNpc),
    target: asTruth(targetId),
    abortPressure: 0,
    pressureKeys: [],
    materielSeized: false,
  };
}

/**
 * Copy stage status and delayed deadlines from the slice plot back onto the
 * Primary, matched by stage id. Off-map stages have no slice counterpart.
 */
export function syncPrimaryStages(plot: PlotState, plots: readonly PlotStateV2[]): readonly PlotStateV2[] {
  const primary = plots[0];
  if (primary === undefined) {
    return plots;
  }
  const byId = new Map(plot.stages.map((stage) => [stage.id, stage]));
  const stages = primary.stages.map((stage) => {
    const slice = byId.get(stage.id);
    if (slice === undefined) {
      return stage;
    }
    const status = slice.status === 'pending' ? stage.status : slice.status;
    return { ...stage, status, deadlineDay: slice.deadline.day };
  });
  return [{ ...primary, stages }, ...plots.slice(1)];
}

/**
 * Resolve due branches, execute off-map stages, then evaluate outcomes.
 * Facade disruptions do not add abort pressure.
 */
export function advanceLibrary(
  plots: readonly PlotStateV2[],
  facts: LibraryFacts,
  at: GameTime,
  rng: Prng,
): {
  readonly plots: readonly PlotStateV2[];
  readonly events: readonly SimEvent[];
  readonly standingDelta: number;
  readonly abortPressure: Readonly<Record<string, number>>;
  readonly primaryEnded?: { readonly outcome: 'success' | 'failure'; readonly cause: 'plot-completed' };
  /** HQ damage reports for Secondaries the opposition just completed. */
  readonly damageCables: readonly { readonly doc: DocId; readonly text: string; readonly plotId: string }[];
} {
  const events: SimEvent[] = [];
  const damageCables: { doc: DocId; text: string; plotId: string }[] = [];
  let seq = 0;
  let standingDelta = 0;
  const abortPressure: Record<string, number> = {};
  let primaryEnded: { outcome: 'success' | 'failure'; cause: 'plot-completed' } | undefined;
  const next = plots.map((plot) => {
    if (plot.resolution !== undefined) {
      return plot;
    }
    const branches = plot.runtimeBranches.map((branch) => ({ ...branch }));
    const stages = plot.stages.map((stage) => ({ ...stage }));
    let pressure = plot.abortCount ?? 0;
    const finished = new Set(stages.filter((stage) => stage.status !== 'pending').map((stage) => stage.id));
    for (const id of facts.disrupted) {
      finished.add(id);
    }
    for (const branch of branches) {
      if (branch.resolved !== undefined) {
        continue;
      }
      if (!branch.after.every((id) => finished.has(id) || stages.find((stage) => stage.id === id)?.status !== 'pending')) {
        continue;
      }
      const world: BranchWorld = {
        finishedStages: finished,
        disruptedStages: facts.disrupted,
        roleStatus: facts.roleStatus,
        alertness: facts.alertness,
        adoptedBeliefs: facts.adoptedBeliefs,
      };
      const resolved = resolveBranch(asBranch(branch), world, rng);
      branch.resolved = { ...resolved, at };
      events.push(hidden('branch-resolved', at, seq, { branch: branch.id, alt: resolved.alt, cause: resolved.cause }));
      seq += 1;
    }
    for (const stage of stages) {
      if (stage.status !== 'pending' || stage.deadlineDay > at.day) {
        continue;
      }
      if (stage.branch !== undefined) {
        const branch = branches.find((item) => item.id === stage.branch);
        if (branch?.resolved === undefined || branch.resolved.alt !== stage.alt) {
          continue;
        }
      }
      if (facts.disrupted.has(stage.id)) {
        stage.status = 'disrupted';
        if (countsTowardAbort(stage.id, plot.twist?.facadeStages ?? [])) {
          pressure += 1;
          abortPressure[plot.id] = pressure;
        }
        const branch = branches.find((item) => item.id === stage.branch);
        if (branch?.resolved !== undefined) {
          const rerouted = rerouteAlternative(asBranch({ ...branch, resolved: branch.resolved }), stage.id);
          if (rerouted !== undefined) {
            branch.resolved = { ...rerouted, at };
            events.push(hidden('branch-resolved', at, seq, { branch: branch.id, alt: rerouted.alt, cause: rerouted.cause }));
            seq += 1;
          }
        }
        continue;
      }
      if (stage.offMap) {
        stage.status = 'executed';
        events.push(
          hidden('stage-executed', at, seq, { stage: stage.id as StageId, cause: 'off-map' }),
        );
        seq += 1;
        continue;
      }
      const done = new Set(
        stages
          .filter((item) => item.status === 'executed' || item.status === 'disrupted')
          .map((item) => item.id),
      );
      for (const id of facts.disrupted) {
        done.add(id);
      }
      if ((stage.requires ?? []).every((id) => done.has(id))) {
        stage.status = 'executed';
        events.push(
          hidden('stage-executed', at, seq, { stage: stage.id as StageId, cause: 'deadline' }),
        );
        seq += 1;
        if (plot.role === 'secondary') {
          const text = stage.traces?.map((trace) => trace.text.trim()).find((line) => line.length > 0);
          if (text !== undefined) {
            events.push({
              id: `lib:${at.day}:${at.phase}:${seq}` as EventId,
              at,
              visibility: 'player',
              kind: 'public-announcement',
              text,
            });
            seq += 1;
          }
        }
      }
    }
    const completed = new Set(stages.filter((stage) => stage.status === 'executed').map((stage) => stage.id));
    const outcome = evaluateOutcomes(
      {
        success: plot.outcomes.success as Parameters<typeof evaluateOutcomes>[0]['success'],
        failure: plot.outcomes.failure as Parameters<typeof evaluateOutcomes>[0]['success'],
      },
      {
        arrestedRoles: facts.arrestedRoles,
        seizedItems: facts.seizedItems,
        aborted: pressure >= 3,
        completedStages: completed,
        identifiedRoles: facts.identifiedRoles,
        entityStatus: facts.entityStatus,
        protectedEntities: facts.protectedEntities,
      },
    );
    let resolution: PlotStateV2['resolution'] = plot.resolution;
    if (outcome !== null) {
      resolution = { result: outcome.result, at, by: outcome.by };
      events.push(hidden('plot-resolved', at, seq, { plot: plot.id, result: outcome.result }));
      seq += 1;
      if (plot.role === 'secondary') {
        standingDelta += outcome.result === 'succeeded' ? -plot.standingPenalty : plot.standingReward;
        if (outcome.result === 'succeeded') {
          const text = plot.damageReport ?? 'Headquarters reports damage from a second operation.';
          const doc = damageCableDocId(plot.id, at);
          damageCables.push({ doc, text, plotId: plot.id });
          events.push({
            id: `lib:${at.day}:${at.phase}:${seq}` as EventId,
            at,
            visibility: 'player',
            kind: 'cable',
            doc,
          });
          seq += 1;
        }
      } else {
        primaryEnded = { outcome: outcome.result === 'disrupted' ? 'success' : 'failure', cause: 'plot-completed' };
      }
    }
    return {
      ...plot,
      runtimeBranches: branches,
      stages,
      ...(pressure === 0 ? {} : { abortCount: pressure }),
      ...(resolution === undefined ? {} : { resolution }),
    };
  });
  return {
    plots: next,
    events,
    standingDelta,
    abortPressure,
    damageCables,
    ...(primaryEnded === undefined ? {} : { primaryEnded }),
  };
}

/** The Cable id a Secondary's damage report is filed under. */
export function damageCableDocId(plotId: string, at: GameTime): DocId {
  return docId('cable', `damage ${plotId} ${at.day}.${at.phase}`);
}

/**
 * Render the HQ damage-report Cable. `template` is the plot's named document
 * template when `text` is one, otherwise the HQ cable template. The authored
 * sentence is the instruction, so the rendered body carries it.
 */
export function renderDamageCable(
  text: string,
  at: GameTime,
  plotId: string,
  template: DocumentTemplate | undefined,
  ctx: NamerContext,
): Document {
  const id = damageCableDocId(plotId, at);
  if (template === undefined) {
    return { id, kind: 'cable', title: `CABLE ${plotId}`, date: at, body: text, asserts: [] };
  }
  const composed = composeCable(
    template,
    {
      cableRef: `HQ-${at.day}.${at.phase}`,
      priority: 'IMMEDIATE',
      toStation: 'STATION',
      subject: 'SECOND OPERATION',
      instruction: text,
    },
    { ...ctx, date: at },
  );
  return { ...composed.document, id };
}

export interface VerifyFailure {
  readonly plot: string;
  readonly config: string;
  readonly target: string;
  readonly reason: 'no-human' | 'no-signal' | 'not-disjoint';
}

/** One string per runtime configuration, capped at 32. */
export function branchConfigurations(plot: PlotStateV2): string[] {
  const lists = plot.runtimeBranches.map((branch) => branch.alternatives.map((alt) => alt.id));
  if (lists.length === 0) {
    return ['default'];
  }
  let configs = [''];
  for (const alts of lists) {
    const next: string[] = [];
    for (const prefix of configs) {
      for (const alt of alts) {
        next.push(prefix === '' ? alt : `${prefix}+${alt}`);
        if (next.length >= 32) {
          return next;
        }
      }
    }
    configs = next;
  }
  return configs;
}

interface GraphEdge {
  readonly kind: 'human' | 'signal';
  readonly node: string;
}

function chosenAlts(config: string): Set<string> {
  return new Set(config.split('+').filter((part) => part !== '' && part !== 'default'));
}

/** On-map stages that belong to this branch configuration. */
function activeStages(plot: PlotStateV2, config: string): PlotStateV2['stages'][number][] {
  const chosen = chosenAlts(config);
  return plot.stages.filter((stage) => {
    if (stage.offMap) {
      return false;
    }
    if (stage.branch !== undefined && stage.alt !== undefined && chosen.size > 0 && !chosen.has(stage.alt)) {
      return false;
    }
    return true;
  });
}

/** Trace edges for one stage. A meeting is human; a transmission or drop is signal. */
function stageEdges(plot: PlotStateV2, stage: PlotStateV2['stages'][number]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const trace of stage.traces ?? []) {
    const participant = trace.roles
      .map((role) => plot.roleHolders[role])
      .find((npc) => npc !== undefined);
    if (trace.kind === 'meeting' || trace.kind === 'npc-moved') {
      if (participant !== undefined) {
        edges.push({ kind: 'human', node: participant });
      }
    } else if (trace.kind === 'transmission') {
      edges.push({ kind: 'signal', node: `channel:${trace.channel ?? 'radio'}` });
    } else if (trace.kind === 'drop-loaded' || trace.kind === 'drop-emptied') {
      const place = Object.values(plot.bindings).find((value) => value.startsWith('loc:'));
      const node = place ?? participant;
      if (node !== undefined) {
        edges.push({ kind: 'signal', node });
      }
    }
  }
  return edges;
}

/** Two node-disjoint routes, one human and one signal. */
function coverEdges(edges: readonly GraphEdge[]): 'ok' | VerifyFailure['reason'] {
  const humans = edges.filter((edge) => edge.kind === 'human');
  const signals = edges.filter((edge) => edge.kind === 'signal');
  if (humans.length === 0) {
    return 'no-human';
  }
  if (signals.length === 0) {
    return 'no-signal';
  }
  for (const human of humans) {
    for (const signal of signals) {
      if (human.node !== signal.node) {
        return 'ok';
      }
    }
  }
  return 'not-disjoint';
}

/**
 * Learnability graph for every branch configuration of every plot. Each
 * on-map stage, each twist proposition and (once) the mole need a human
 * trace and a signal trace on different nodes. Off-map stages add no edges.
 */
export function verifyLibrary(
  plots: readonly PlotStateV2[],
  options: { readonly mole?: string } = {},
): { readonly ok: boolean; readonly failures: readonly VerifyFailure[] } {
  const failures: VerifyFailure[] = [];
  const moleEdges: GraphEdge[] = [];
  for (const plot of plots) {
    const configs = branchConfigurations(plot);
    for (const config of configs) {
      const active = activeStages(plot, config);
      const edges = active.flatMap((stage) => stageEdges(plot, stage));
      if (config === configs[0]) {
        moleEdges.push(...edges);
      }
      for (const stage of active) {
        const reason = coverEdges(stageEdges(plot, stage));
        if (reason !== 'ok') {
          failures.push({ plot: plot.id, config, target: stage.id, reason });
        }
      }
      for (const proposition of plot.twist?.propositions ?? []) {
        const reason = coverEdges(edges);
        if (reason !== 'ok') {
          failures.push({ plot: plot.id, config, target: proposition, reason });
        }
      }
    }
  }
  if (options.mole !== undefined) {
    const reason = coverEdges(moleEdges);
    if (reason !== 'ok') {
      failures.push({
        plot: plots[0]?.id ?? 'mole',
        config: 'mole',
        target: options.mole,
        reason,
      });
    }
  }
  return { ok: failures.length === 0, failures };
}

/** Quote gate and acknowledgement for an identification report. */
export function identifyReport(input: {
  readonly evidenceCount: number;
  readonly threshold: number;
  readonly reported: string;
  readonly holder: string;
}): { readonly allowed: boolean; readonly correct: boolean; readonly penalty: boolean; readonly ack: string } {
  const allowed = input.evidenceCount >= input.threshold;
  const correct = input.reported === input.holder;
  return {
    allowed,
    correct: allowed && correct,
    penalty: allowed && !correct,
    ack: 'HQ acknowledges your report.',
  };
}

/** An unactivated alternative is believed by the speaker and false in truth. */
export function contingentBelief(activated: boolean): { readonly holds: boolean; readonly speakerBelieved: true } {
  return { holds: activated, speakerBelieved: true };
}
