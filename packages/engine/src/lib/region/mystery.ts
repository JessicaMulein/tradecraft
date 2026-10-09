/**
 * The regional mystery trail.
 *
 * The region generator mints a plot, a leader and one cell member per city.
 * This pass writes the ground-truth propositions, a starting brief that names
 * a lead without closing the case, a second document the player can obtain,
 * a dead drop, a radio channel, weekly schedules and a station relationship.
 * The truth store is seeded from the same propositions so a claim can be
 * checked. Slice worlds never call it.
 */

import type { ContentSet } from '@tradecraft/content';

import type { Channel, DeadDrop } from '../city/comms.js';
import type { Npc, NpcSchedule } from '../city/npc.js';
import type { DeadDropId, TimeWindow } from '../model/core.js';
import {
  revealTruth,
  type EntityId,
  type LocId,
  type NpcId,
  type PropId,
  type Proposition,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { newRelationship } from '../recruit/asset.js';
import { TruthStore, type Allegiance } from '../truth/truth.js';
import type { CityId } from '../fidelity/types.js';

export interface RegionMystery {
  readonly facts: readonly Proposition[];
  readonly leads: readonly Proposition[];
  readonly corroboration: readonly Proposition[];
}

/** Ground truth, the brief's leads, and the second source that corroborates them. */
export function regionMystery(world: WorldState): RegionMystery {
  const leader = revealTruth(world.plot.leader);
  const members = cellMembers(world).filter((id) => id !== leader);
  const cutout = members[0] ?? leader;
  const meeting = meetingLoc(world, cutout);
  const orders = ordersLoc(world, meeting ?? world.player.loc);
  const channel = radioId(world);
  const facts: Proposition[] = [];
  for (const member of cellMembers(world)) {
    const org = world.npcs[member]?.org;
    if (org !== undefined) {
      facts.push(fact(`member-${member}`, member, 'MEMBER_OF', org));
    }
  }
  facts.push(
    fact('plans', leader, 'PLANS', { kind: 'text', value: 'the operation' }),
  );
  const target = revealTruth(world.plot.target);
  facts.push(fact('targets', leader, 'TARGETS', target));
  if (meeting !== undefined) {
    facts.push(
      fact('meets', cutout, 'MEETS_AT', leader, meeting, { from: { day: 0, phase: 2 } }),
    );
  }
  facts.push(fact('cache', cutout, 'LOCATED_AT', leader, orders));
  facts.push(fact('uses', cutout, 'USES_CHANNEL', channel));
  const materiel = revealTruth(world.plot.materiel);
  facts.push(
    fact('carries', cutout, 'CARRIES', { kind: 'text', value: materiel }),
  );
  const membership = facts.find((item) => item.id === `prop:region/member-${cutout}`);
  const meetingFact = facts.find((item) => item.id === 'prop:region/meets');
  const channelFact = facts.find((item) => item.id === 'prop:region/uses');
  const leads = [membership, meetingFact].filter((item): item is Proposition => item !== undefined);
  const corroboration = [membership, meetingFact, channelFact].filter(
    (item): item is Proposition => item !== undefined,
  );
  return { facts, leads, corroboration };
}

/** Write the trail onto the world. The truth store is seeded separately. */
export function attachMystery(world: WorldState): WorldState {
  if (world.region === undefined) {
    return world;
  }
  const mystery = regionMystery(world);
  const leader = revealTruth(world.plot.leader);
  const cutout = cellMembers(world).find((id) => id !== leader) ?? leader;
  const meeting = meetingLoc(world, cutout);
  const channelId = radioId(world);
  const dropId = `drop:${slug(cutout)}` as DeadDropId;
  const npcs = schedulePeople(world, cutout, meeting);
  const documents = { ...world.documents };
  const documentPropositions = { ...world.documentPropositions };
  for (const prop of mystery.facts) {
    documentPropositions[prop.id] = prop;
  }
  const brief = documents['doc:cable/brief'];
  if (brief !== undefined) {
    documents['doc:cable/brief'] = {
      ...brief,
      asserts: mystery.leads.map((prop) => prop.id),
    };
  }
  const obtainable = meeting ?? world.player.loc;
  const leaderMembership = mystery.facts.find((item) => item.id === `prop:region/member-${leader}`);
  const plans = mystery.facts.find((item) => item.id === 'prop:region/plans');
  const cache = mystery.facts.find((item) => item.id === 'prop:region/cache');
  const noteAsserts = [...mystery.corroboration];
  if (leaderMembership !== undefined && !noteAsserts.some((item) => item.id === leaderMembership.id)) {
    noteAsserts.push(leaderMembership);
  }
  if (plans !== undefined) {
    noteAsserts.push(plans);
  }
  if (cache !== undefined && !noteAsserts.some((item) => item.id === cache.id)) {
    noteAsserts.push(cache);
  }
  const orderAsserts = [leaderMembership, plans].filter((item): item is Proposition => item !== undefined);
  const ordersAt = ordersLoc(world, obtainable);
  documents['doc:note/cell-note'] = {
    id: 'doc:note/cell-note',
    kind: 'dossier',
    title: 'a note left at the meeting',
    date: world.time,
    body: 'A name, a meeting, and the shape of the operation. One source. Find the orders before you act.',
    asserts: noteAsserts.map((prop) => prop.id),
    obtainableAt: [obtainable],
  };
  documents['doc:note/orders'] = {
    id: 'doc:note/orders',
    kind: 'dossier',
    title: 'orders for the operation',
    date: world.time,
    body: 'The leader, the membership, and the operation. It confirms the note, and nothing else.',
    asserts: orderAsserts.map((prop) => prop.id),
    obtainableAt: [ordersAt],
  };
  const channel: Channel = {
    id: channelId,
    kind: 'radio',
    owner: world.npcs[cutout]?.org ?? cutout,
    schedule: { period: 1, start: { day: 1, phase: 2 }, phase: 2 },
    reception: world.region.order.map((city) => city),
  };
  const drop: DeadDrop = {
    id: dropId,
    loc: ordersAt,
    owner: world.npcs[cutout]?.org ?? cutout,
    contents: [],
  };
  const services = tellLiaisons(world, plans);
  const relationships = { ...world.relationships };
  for (const id of Object.keys(npcs) as NpcId[]) {
    if (relationships[id] === undefined) {
      relationships[id] = newRelationship(id);
    }
  }
  const chief = world.station.chief;
  const chiefRel = relationships[chief] ?? newRelationship(chief);
  relationships[chief] = { ...chiefRel, trust: 0.4, channel: true, contacts: 1 };
  const knownEntities = [...world.player.known.entities];
  for (const id of [chief, obtainable] as EntityId[]) {
    if (!knownEntities.includes(id)) {
      knownEntities.push(id);
    }
  }
  return {
    ...world,
    npcs,
    documents,
    documentPropositions,
    channels: { ...world.channels, [channel.id]: channel },
    deadDrops: { ...world.deadDrops, [drop.id]: drop },
    ...(services === undefined ? {} : { services }),
    relationships,
    player: {
      ...world.player,
      contacts: world.player.contacts.includes(chief) ? world.player.contacts : [...world.player.contacts, chief],
      known: { ...world.player.known, entities: knownEntities },
    },
  };
}

/** The truth store a regional game checks claims against. */
export function regionTruth(content: ContentSet, world: WorldState): TruthStore {
  const mystery = world.region === undefined ? undefined : regionMystery(world);
  const facts = mystery === undefined ? [] : [...mystery.facts];
  const allegiances = new Map<NpcId, Allegiance>();
  for (const npc of Object.values(world.npcs)) {
    allegiances.set(npc.id, revealTruth(npc.trueAllegiance));
  }
  if (world.station.mole !== undefined) {
    const mole = revealTruth(world.station.mole);
    const hostile = Object.values(world.orgs).find((org) => org.kind === 'hostile');
    if (hostile !== undefined) {
      allegiances.set(mole, { org: hostile.id });
    }
  }
  return TruthStore.from(content.predicates.evaluators, {
    facts,
    allegiances,
    identities: new Map(),
    claimTruths: [],
  });
}

function cellMembers(world: WorldState): NpcId[] {
  return (Object.values(world.npcs) as Npc[])
    .filter((npc) => npc.role === 'cell')
    .map((npc) => npc.id)
    .sort((a, b) => a.localeCompare(b));
}

function meetingLoc(world: WorldState, npc: NpcId): LocId | undefined {
  const placed = world.locationOf?.[npc];
  const cityId = placed !== undefined && 'city' in placed ? placed.city : world.player.city;
  if (cityId === undefined || cityId === null) {
    return world.player.loc;
  }
  const city = world.region?.cities[cityId as CityId];
  const locs = city === undefined ? [] : Object.keys(city.locations).sort();
  return (locs[0] as LocId | undefined) ?? world.player.loc;
}

function radioId(world: WorldState): `chan:${string}` {
  const leader = revealTruth(world.plot.leader);
  return `chan:radio:${slug(leader)}`;
}

function schedulePeople(world: WorldState, cutout: NpcId, meeting: LocId | undefined): Record<NpcId, Npc> {
  const npcs: Record<NpcId, Npc> = { ...world.npcs };
  for (const npc of Object.values(world.npcs)) {
    const placed = world.locationOf?.[npc.id];
    const cityId = placed !== undefined && 'city' in placed ? placed.city : world.player.city;
    const city = cityId === undefined || cityId === null ? undefined : world.region?.cities[cityId as CityId];
    const locs = city === undefined ? [npc.schedule.entries[0]?.loc ?? world.player.loc] : Object.keys(city.locations).sort() as LocId[];
    const home = locs[0] ?? world.player.loc;
    const evening = npc.id === cutout || npc.id === revealTruth(world.plot.leader)
      ? (meeting ?? home)
      : (locs[locs.length - 1] ?? home);
    npcs[npc.id] = { ...npc, schedule: weekSchedule(locs, home, evening) };
  }
  return npcs;
}

function weekSchedule(locs: readonly LocId[], home: LocId, evening: LocId): NpcSchedule {
  const entries = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const day = locs[weekday % locs.length] ?? home;
    entries.push({ weekday, phase: 0 as const, loc: day });
    entries.push({ weekday, phase: 1 as const, loc: day });
    entries.push({ weekday, phase: 2 as const, loc: evening });
    entries.push({ weekday, phase: 3 as const, loc: home });
  }
  return { entries };
}

function ordersLoc(world: WorldState, meeting: LocId): LocId {
  const cities = world.region?.order ?? [];
  for (const cityId of cities) {
    const locs = Object.keys(world.region?.cities[cityId]?.locations ?? {}).sort();
    const other = locs.find((loc) => loc !== meeting);
    if (other !== undefined) {
      return other as LocId;
    }
  }
  return meeting;
}

/** Liaison services can confirm the plan. Membership stays in the papers. */
function tellLiaisons(
  world: WorldState,
  plans: Proposition | undefined,
): WorldState['services'] | undefined {
  if (world.services === undefined || plans === undefined) {
    return world.services;
  }
  const services = { ...world.services };
  for (const service of Object.values(world.services)) {
    if (service.liaison === undefined) {
      continue;
    }
    if (service.knowledge.known.some((item) => item.id === plans.id)) {
      continue;
    }
    services[service.id] = {
      ...service,
      knowledge: {
        ...service.knowledge,
        known: [...service.knowledge.known, plans],
        knownEntities: service.knowledge.knownEntities.includes(plans.subject)
          ? service.knowledge.knownEntities
          : [...service.knowledge.knownEntities, plans.subject],
      },
    };
  }
  return services;
}

function fact(
  tag: string,
  subject: EntityId,
  predicate: string,
  object: Proposition['object'],
  place?: LocId,
  window?: TimeWindow,
): Proposition {
  const id = `prop:region/${tag}` as PropId;
  return {
    id,
    subject,
    predicate,
    object,
    ...(place === undefined ? {} : { place }),
    ...(window === undefined ? {} : { window }),
  };
}

function slug(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
