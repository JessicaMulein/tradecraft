/**
 * Campaign arcs (design, "Arc engine"; Requirements 14.1, 14.2, 14.5).
 *
 * Bindings are drawn on the campaign stream: an HQ-cast slot takes the mole,
 * and a carried-hostile slot takes an at-large hostile or, when the template
 * says so, a newly minted person. `advanceArcs` is pure. A `clue-held`
 * condition reads player-held Claims. `clue-present` and `person-status` read
 * truth. A stage thread is active while that stage is current, its `when`
 * holds, and the arc has not resolved. A cell archetype is never a participant.
 * An empty `when` holds. An empty `advance` or `resolve` does not.
 */

import type { Prng } from '@tradecraft/engine';

import type { ArcCondition, ArcTemplate, ArcThreadTemplate, RankId } from './content/schemas.js';
import { RANKS } from './content/schemas.js';
import type {
  CampaignPersonId,
  CampaignState,
  CampaignTruth,
  CarryClaim,
  CarryIn,
  PostingResult,
} from './state.js';

export interface ArcFacts {
  readonly postingIndex: number;
  readonly year: number;
  readonly service: string;
  readonly rank: RankId;
  readonly notoriety: number;
  readonly heldClaims: readonly CarryClaim[];
  readonly presentClues: readonly { readonly clue: string; readonly present: boolean }[];
  readonly roster: Readonly<
    Record<string, { readonly status: 'at-large' | 'arrested' | 'turned' | 'dead'; readonly service?: string }>
  >;
}

export interface ArcBindSources {
  readonly mole: CampaignPersonId;
  readonly hostiles: readonly {
    readonly id: CampaignPersonId;
    readonly status: 'at-large' | 'arrested' | 'turned' | 'dead';
  }[];
  /** Next free `cp-n` number. Raised past any hostile id that is already higher. */
  readonly nextPerson: number;
}

export interface ArcInit {
  readonly arcs: CampaignTruth['arcs'];
  readonly view: CampaignState['view']['arcs'];
  readonly nextPerson: number;
  readonly nemesis?: CampaignPersonId;
}

type ArcRecord = CampaignTruth['arcs'][string];

/** Facts the fold can see: the posting that just ended, its claims, and truth. */
export function arcFactsFromPosting(state: CampaignState, result: PostingResult): ArcFacts {
  const service = result.extract.service;
  const roster: Record<string, { status: 'at-large' | 'arrested' | 'turned' | 'dead'; service?: string }> = {};
  for (const person of state.truth.carriedHostiles) {
    roster[person.id] = { status: person.status, service: person.service };
  }
  return {
    postingIndex: result.index,
    year: state.calendar.year,
    service,
    rank: state.view.officer.rank,
    notoriety: state.truth.dossiers[service]?.notoriety ?? 0,
    heldClaims: result.carry.heldClaims,
    presentClues: result.extract.arcClues,
    roster,
  };
}

/** Bind every arc on `rng` and start each one on its first stage. */
export function initArcs(
  templates: readonly ArcTemplate[],
  sources: ArcBindSources,
  rng: Prng,
): ArcInit {
  let nextPerson = sources.nextPerson;
  for (const hostile of sources.hostiles) {
    const n = Number(hostile.id.slice(3));
    if (Number.isInteger(n) && n >= nextPerson) {
      nextPerson = n + 1;
    }
  }
  const living = sources.hostiles
    .filter((hostile) => hostile.status === 'at-large')
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id));
  const arcs: Record<string, ArcRecord> = {};
  let nemesis: CampaignPersonId | undefined;
  for (const template of templates) {
    const first = template.stages[0];
    if (first === undefined) {
      continue;
    }
    const bindings: Record<string, CampaignPersonId> = {};
    for (const [slot, bind] of Object.entries(template.binds)) {
      if (bind.from === 'hq-cast') {
        bindings[slot] = sources.mole;
        continue;
      }
      if (living.length > 0) {
        bindings[slot] = rng.pick(living).id;
        continue;
      }
      if (bind.else === 'generate') {
        const id: CampaignPersonId = `cp-${nextPerson}`;
        nextPerson += 1;
        bindings[slot] = id;
        if (slot === 'nemesis') {
          nemesis = id;
        }
      }
    }
    arcs[template.id] = { bindings, stage: first.id, clues: {} };
  }
  return { arcs, view: arcViews(arcs), nextPerson, nemesis };
}

/**
 * Record clues and walk stages whose advance conditions hold. The input
 * record is returned unchanged when no arc moves.
 */
export function advanceArcs(
  arcs: CampaignTruth['arcs'],
  templates: readonly ArcTemplate[],
  facts: ArcFacts,
): CampaignTruth['arcs'] {
  let changed = false;
  const next: Record<string, ArcRecord> = {};
  for (const [id, arc] of Object.entries(arcs)) {
    const template = templates.find((item) => sameId(item.id, id));
    const updated = template === undefined ? arc : stepArc(arc, template, facts);
    next[id] = updated;
    if (updated !== arc) {
      changed = true;
    }
  }
  return changed ? next : arcs;
}

/** Threads for stages that are current, open, and not resolved. Higher priority first. */
export function activeArcThreads(
  arcs: CampaignTruth['arcs'],
  templates: readonly ArcTemplate[],
  threads: readonly ArcThreadTemplate[],
  facts: ArcFacts,
): CarryIn['arcThreads'] {
  const specs: CarryIn['arcThreads'][number][] = [];
  const ordered = templates.slice().sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  for (const template of ordered) {
    const arc = lookupArc(arcs, template.id);
    if (arc === undefined || conditionsHold(template.resolve, template, arc, facts)) {
      continue;
    }
    const stage = template.stages.find((item) => sameId(item.id, arc.stage));
    if (stage === undefined || !conditionsHold(stage.when, template, arc, facts)) {
      continue;
    }
    const thread = threads.find((item) => sameId(item.id, stage.thread));
    specs.push({
      arc: template.id,
      template: stage.thread,
      bindings: participantBindings(thread, arc),
      clues: thread?.clues.map((clue) => ({ id: clue.id })) ?? [],
      priority: template.priority,
    });
  }
  return specs;
}

/** Whether one condition holds for this arc. */
export function conditionHolds(
  condition: ArcCondition,
  template: ArcTemplate,
  arc: ArcRecord,
  facts: ArcFacts,
): boolean {
  if (condition.kind === 'posting-index-at-least') {
    return facts.postingIndex >= condition.n;
  }
  if (condition.kind === 'year-between') {
    return facts.year >= condition.from && facts.year <= condition.to;
  }
  if (condition.kind === 'service-is') {
    const person = arc.bindings[condition.slot];
    const row = person === undefined ? undefined : facts.roster[person];
    return row?.service !== undefined && sameId(row.service, facts.service);
  }
  if (condition.kind === 'stage-done') {
    const current = stageIndex(template, arc.stage);
    const named = stageIndex(template, condition.stage);
    return named >= 0 && current > named;
  }
  if (condition.kind === 'clue-held') {
    return clueRecorded(arc, condition.clue) || facts.heldClaims.some((claim) => claimMatches(claim, condition.clue));
  }
  if (condition.kind === 'clue-present') {
    return (
      clueRecorded(arc, condition.clue) ||
      facts.presentClues.some((clue) => clue.present && sameId(clue.clue, condition.clue))
    );
  }
  if (condition.kind === 'rank-at-least') {
    return RANKS.indexOf(facts.rank) >= RANKS.indexOf(condition.rank);
  }
  if (condition.kind === 'notoriety-at-least') {
    return facts.notoriety >= condition.value;
  }
  const person = arc.bindings[condition.slot];
  const status = person === undefined ? undefined : facts.roster[person]?.status;
  return status !== undefined && condition.in.some((allowed) => allowed === status);
}

function conditionsHold(
  conditions: readonly ArcCondition[],
  template: ArcTemplate,
  arc: ArcRecord,
  facts: ArcFacts,
): boolean {
  return conditions.every((condition) => conditionHolds(condition, template, arc, facts));
}

function stepArc(arc: ArcRecord, template: ArcTemplate, facts: ArcFacts): ArcRecord {
  // Advance from the sources as they stand. Recording happens after, so a
  // truth-only clue cannot satisfy `clue-held` in the same fold.
  let current = arc;
  const resolved = template.resolve.length > 0 && conditionsHold(template.resolve, template, current, facts);
  if (!resolved) {
    for (let guard = 0; guard < template.stages.length; guard += 1) {
      const stage = template.stages.find((item) => sameId(item.id, current.stage));
      const at = stage === undefined ? -1 : template.stages.indexOf(stage);
      const following = at >= 0 ? template.stages[at + 1] : undefined;
      if (stage === undefined || stage.advance.length === 0 || following === undefined) {
        break;
      }
      if (!conditionsHold(stage.advance, template, current, facts)) {
        break;
      }
      current = { ...current, stage: following.id };
    }
  }
  const clues = absorbClues(current, template, facts);
  if (current.stage === arc.stage && clues === arc.clues) {
    return arc;
  }
  return { ...current, clues };
}

function absorbClues(
  arc: ArcRecord,
  template: ArcTemplate,
  facts: ArcFacts,
): ArcRecord['clues'] {
  const ids = clueIds(template);
  let added = false;
  const clues: Record<string, boolean> = { ...arc.clues };
  for (const id of ids) {
    if (clues[id] === true) {
      continue;
    }
    const held = facts.heldClaims.some((claim) => claimMatches(claim, id));
    const present = facts.presentClues.some((clue) => clue.present && sameId(clue.clue, id));
    if (held || present) {
      clues[id] = true;
      added = true;
    }
  }
  return added ? clues : arc.clues;
}

function clueIds(template: ArcTemplate): string[] {
  const ids: string[] = [];
  for (const stage of template.stages) {
    for (const condition of [...stage.when, ...stage.advance]) {
      if ((condition.kind === 'clue-held' || condition.kind === 'clue-present') && !ids.includes(condition.clue)) {
        ids.push(condition.clue);
      }
    }
  }
  for (const condition of template.resolve) {
    if ((condition.kind === 'clue-held' || condition.kind === 'clue-present') && !ids.includes(condition.clue)) {
      ids.push(condition.clue);
    }
  }
  return ids;
}

function participantBindings(
  thread: ArcThreadTemplate | undefined,
  arc: ArcRecord,
): Readonly<Record<string, CampaignPersonId>> {
  const blocked = new Set(
    (thread?.roleSlots ?? []).filter((slot) => slot.archetypes.some(cellArchetype)).map((slot) => slot.id),
  );
  const bindings: Record<string, CampaignPersonId> = {};
  if (thread === undefined || thread.slots.length === 0) {
    for (const [slot, person] of Object.entries(arc.bindings)) {
      if (!blocked.has(slot)) {
        bindings[slot] = person;
      }
    }
    return bindings;
  }
  for (const slot of thread.slots) {
    if (blocked.has(slot.id)) {
      continue;
    }
    const person = arc.bindings[slot.binding];
    if (person !== undefined) {
      bindings[slot.id] = person;
    }
  }
  return bindings;
}

function arcViews(arcs: CampaignTruth['arcs']): CampaignState['view']['arcs'] {
  return Object.entries(arcs)
    .map(([id, arc]) => ({ id, stage: arc.stage, status: 'active' as const }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function lookupArc(arcs: CampaignTruth['arcs'], id: string): ArcRecord | undefined {
  if (arcs[id] !== undefined) {
    return arcs[id];
  }
  for (const [key, arc] of Object.entries(arcs)) {
    if (sameId(key, id)) {
      return arc;
    }
  }
  return undefined;
}

function stageIndex(template: ArcTemplate, id: string): number {
  return template.stages.findIndex((stage) => sameId(stage.id, id));
}

function clueRecorded(arc: ArcRecord, clue: string): boolean {
  if (arc.clues[clue] === true) {
    return true;
  }
  return Object.entries(arc.clues).some(([id, held]) => held && sameId(id, clue));
}

function claimMatches(claim: CarryClaim, clue: string): boolean {
  return sameId(claim.id, clue) || sameId(claim.prop.id, clue);
}

function cellArchetype(id: string): boolean {
  return id === 'cell' || id.endsWith('/cell');
}

function sameId(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}
