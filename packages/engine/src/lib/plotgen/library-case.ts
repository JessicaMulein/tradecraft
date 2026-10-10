/**
 * The facts a library game can actually be won on.
 *
 * Selecting a library plot replaces the operation the clock runs, but the
 * Station's brief and the Cell's radio were written for the core plot. A
 * meeting the player watches then says something the radio never said, and the
 * brief names a plan the leader on the street is not carrying out. One source
 * is never enough to arrest, and two messages on the same radio are one voice.
 * This module files one shared case: the library leader belongs to the Cell,
 * is planning the operation, and is targeting the operation's target. The
 * brief states those, and the radio carries the same facts, so a single break
 * confirms them. When another Cell member can be met at a place a stage
 * actually uses, the brief states that meeting too.
 */

import { CELL_ORG_ID } from '../city/principals.js';
import type { PlotState } from '../city/plot.js';
import {
  revealTruth,
  type EntityId,
  type LocId,
  type NpcId,
  type PropId,
  type Proposition,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';

const CASE_PREFIX = 'prop:library-case/';

export interface LibraryCase {
  /** Facts the opening brief must assert, reused from the Cell when it already says them. */
  readonly brief: readonly Proposition[];
  /** Facts that are not already in the Cell's pool, so the radio and the truth store must gain them. */
  readonly extra: readonly Proposition[];
  /** The clock plot, with one meeting that is the brief's meeting. */
  readonly plot: PlotState;
}

/**
 * The arrest case for a library primary. Undefined when this world is not a
 * library game, or when the Cell has no second member to meet.
 */
export function buildLibraryCase(
  world: Pick<WorldState, 'plots' | 'plot' | 'npcs'>,
  existing: readonly Proposition[],
): LibraryCase | undefined {
  if (world.plots === undefined || world.plots.length === 0) {
    return undefined;
  }
  const leader = revealTruth(world.plot.leader);
  const members = cellMembers(world.npcs);
  const partner = partnerFor(leader, members, existing);
  const meet =
    partner === undefined
      ? undefined
      : meetingFact(leader, partner, venueOf(world.plot), existing);
  const brief = [
    membershipFact(leader, existing),
    planFact(leader, existing),
    targetFact(leader, world.plot, existing),
  ];
  if (partner !== undefined) {
    brief.push(membershipFact(partner, existing));
  }
  if (meet !== undefined) {
    brief.push(meet.prop);
  }
  const extra = brief.filter((prop) => !existing.some((held) => held.id === prop.id));
  return {
    brief,
    extra,
    plot:
      meet === undefined || partner === undefined
        ? world.plot
        : alignMeeting(world.plot, leader, partner, meet.place),
  };
}

/** Propositions this world added for the library case. Empty on a core game. */
export function libraryCaseExtras(world: WorldState): Proposition[] {
  return Object.values(world.documentPropositions)
    .filter((prop) => prop.id.startsWith(CASE_PREFIX))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Write the library case onto the brief, the known set, the Station's
 * knowledge and the clock plot. A world that is not a library game is returned
 * unchanged.
 */
export function applyLibraryCase(world: WorldState, existing: readonly Proposition[]): WorldState {
  const built = buildLibraryCase(world, existing);
  if (built === undefined) {
    return world;
  }
  const cable = Object.values(world.documents).find((doc) => doc.kind === 'cable');
  const documentPropositions = { ...world.documentPropositions };
  for (const prop of built.extra) {
    documentPropositions[prop.id] = prop;
  }
  for (const prop of built.brief) {
    if (documentPropositions[prop.id] === undefined) {
      documentPropositions[prop.id] = prop;
    }
  }
  const documents =
    cable === undefined
      ? world.documents
      : {
          ...world.documents,
          [cable.id]: { ...cable, asserts: assertAll(cable.asserts, built.brief, documentPropositions) },
        };
  const entities = entitiesOf(built.brief);
  const known = world.station.knowledge;
  return {
    ...world,
    plot: built.plot,
    documents,
    documentPropositions,
    player: {
      ...world.player,
      known: {
        ...world.player.known,
        entities: appendUnique(world.player.known.entities, entities),
      },
    },
    station: {
      ...world.station,
      knowledge: {
        ...known,
        known: appendProps(known.known, built.brief),
        knownEntities: appendUnique(known.knownEntities, entities),
      },
    },
  };
}

function cellMembers(npcs: WorldState['npcs']): NpcId[] {
  return Object.values(npcs)
    .filter((npc) => npc.org === CELL_ORG_ID)
    .map((npc) => npc.id)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Another Cell member. Prefer someone the leader does not already meet in the
 * Cell's pool, so the new meeting cannot contradict a meeting the radio
 * already carries at a different place.
 */
function partnerFor(
  leader: NpcId,
  members: readonly NpcId[],
  existing: readonly Proposition[],
): NpcId | undefined {
  const already = new Set<string>();
  for (const prop of existing) {
    if (prop.predicate !== 'MEETS_AT' || typeof prop.object !== 'string') {
      continue;
    }
    if (prop.subject === leader) {
      already.add(prop.object);
    }
    if (prop.object === leader) {
      already.add(prop.subject);
    }
  }
  const fresh = members.find((id) => id !== leader && !already.has(id));
  if (fresh !== undefined) {
    return fresh;
  }
  return members.find((id) => id !== leader);
}

function venueOf(plot: PlotState): LocId | undefined {
  for (const stage of plot.stages) {
    for (const trace of stage.traces) {
      if (trace.place?.kind === 'loc') {
        return trace.place.loc;
      }
    }
  }
  return undefined;
}

function meetingFact(
  leader: NpcId,
  partner: NpcId,
  venue: LocId | undefined,
  existing: readonly Proposition[],
): { prop: Proposition; place: LocId } | undefined {
  const held = existing.find(
    (prop) =>
      prop.predicate === 'MEETS_AT' &&
      typeof prop.object === 'string' &&
      ((prop.subject === leader && prop.object === partner) ||
        (prop.subject === partner && prop.object === leader)),
  );
  if (held !== undefined && held.place !== undefined) {
    return { prop: held, place: held.place };
  }
  if (venue === undefined) {
    return undefined;
  }
  return {
    place: venue,
    prop: fact(leader, 'meet', leader, 'MEETS_AT', partner, venue),
  };
}

function membershipFact(npc: NpcId, existing: readonly Proposition[]): Proposition {
  const held = existing.find(
    (prop) => prop.predicate === 'MEMBER_OF' && prop.subject === npc && typeof prop.object === 'string',
  );
  const org = held !== undefined && typeof held.object === 'string' ? held.object : CELL_ORG_ID;
  // A fresh id so the radio carries this membership even when the cell already
  // knew it. The object stays the one the cell already uses, so the new line
  // agrees with it instead of naming a second organisation.
  return fact(npc, 'member', npc, 'MEMBER_OF', org);
}

function planFact(leader: NpcId, existing: readonly Proposition[]): Proposition {
  const held = existing.find((prop) => prop.predicate === 'PLANS' && prop.subject === leader);
  if (held !== undefined) {
    return held;
  }
  return fact(leader, 'plan', leader, 'PLANS', { kind: 'text', value: 'the operation' });
}

/**
 * The operation's target, reused when the Cell already names one for this
 * leader. A second target would contradict the first and wipe both. The brief
 * has to state this same fact: the radio repeats it, but every message on one
 * channel is a single voice and cannot confirm itself.
 */
function targetFact(leader: NpcId, plot: PlotState, existing: readonly Proposition[]): Proposition {
  const held = existing.find((prop) => prop.predicate === 'TARGETS' && prop.subject === leader);
  if (held !== undefined) {
    return held;
  }
  return fact(leader, 'target', leader, 'TARGETS', revealTruth(plot.target));
}

function fact(
  owner: NpcId,
  tag: string,
  subject: EntityId,
  predicate: Proposition['predicate'],
  object: Proposition['object'],
  place?: LocId,
): Proposition {
  const id = `${CASE_PREFIX}${tag}/${owner}` as PropId;
  return {
    id,
    subject,
    predicate,
    object,
    ...(place === undefined ? {} : { place }),
  };
}

/**
 * The first meeting names the brief's pair at the brief's place, and the
 * first radio trace evidences that meeting so the message carries it.
 */
function alignMeeting(plot: PlotState, leader: NpcId, partner: NpcId, place: LocId): PlotState {
  let meetingAligned = false;
  let radioAligned = false;
  const stages = plot.stages.map((stage) => ({
    ...stage,
    traces: stage.traces.map((trace) => {
      if (!meetingAligned && trace.kind === 'meeting') {
        meetingAligned = true;
        return {
          ...trace,
          participants: dedupeIds([leader, partner, ...trace.participants]),
          place: { kind: 'loc' as const, loc: place },
          evidences: withEvidence(trace.evidences, 'MEETS_AT'),
        };
      }
      if (!radioAligned && trace.kind === 'transmission') {
        radioAligned = true;
        const participants =
          trace.participants.length === 0
            ? [leader, partner]
            : dedupeIds([...trace.participants, leader, partner]);
        return {
          ...trace,
          participants,
          evidences: withEvidence(trace.evidences, 'MEETS_AT'),
        };
      }
      return trace;
    }),
  }));
  return { ...plot, stages };
}

function withEvidence(evidences: readonly string[], predicate: string): string[] {
  if (evidences.includes(predicate)) {
    return [...evidences];
  }
  return [...evidences, predicate];
}

function dedupeIds(ids: readonly NpcId[]): NpcId[] {
  const out: NpcId[] = [];
  for (const id of ids) {
    if (!out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

function assertAll(
  asserts: readonly PropId[],
  brief: readonly Proposition[],
  props: Readonly<Record<string, Proposition>>,
): PropId[] {
  const out = [...asserts];
  for (const prop of brief) {
    const already = out.some((id) => {
      const held = props[id];
      return held !== undefined && sameFact(held, prop);
    });
    if (!already) {
      out.push(prop.id);
    }
  }
  return out;
}

function sameFact(a: Proposition, b: Proposition): boolean {
  return (
    a.predicate === b.predicate &&
    a.subject === b.subject &&
    sameObject(a.object, b.object) &&
    a.place === b.place
  );
}

function sameObject(a: Proposition['object'], b: Proposition['object']): boolean {
  if (typeof a === 'string' || typeof b === 'string') {
    return a === b;
  }
  if (a.kind !== b.kind) {
    return false;
  }
  if (a.kind === 'text' && b.kind === 'text') {
    return a.value === b.value;
  }
  if (a.kind === 'amount' && b.kind === 'amount') {
    return a.value === b.value;
  }
  return false;
}

function entitiesOf(props: readonly Proposition[]): EntityId[] {
  const out: EntityId[] = [];
  for (const prop of props) {
    pushEntity(out, prop.subject);
    if (typeof prop.object === 'string') {
      pushEntity(out, prop.object);
    }
    if (prop.place !== undefined) {
      pushEntity(out, prop.place);
    }
  }
  return out;
}

function pushEntity(out: EntityId[], id: EntityId): void {
  if (!out.includes(id)) {
    out.push(id);
  }
}

function appendUnique<T extends string>(current: readonly T[], extra: readonly T[]): T[] {
  const out = [...current];
  for (const id of extra) {
    if (!out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

function appendProps(current: readonly Proposition[], extra: readonly Proposition[]): Proposition[] {
  const out = [...current];
  for (const prop of extra) {
    if (!out.some((held) => held.id === prop.id)) {
      out.push(prop);
    }
  }
  return out;
}
