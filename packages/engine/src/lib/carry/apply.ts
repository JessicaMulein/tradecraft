/**
 * Place a posting's carry-in and arc threads onto a verified core world.
 *
 * The step only adds NPCs, channels, documents and bounded modifiers. Plot
 * paths are re-checked. Each arc clue is delivered on a brief document. A
 * failed check retries on the next carry and arc seeds, then drops optional
 * recognisers, the nemesis, and arc threads from lowest priority.
 */

import type { Archetype, ContentSet } from '@tradecraft/content';

import type { City } from '../city/city.js';
import type { Channel, DeadDrop, GeneratedComms } from '../city/comms.js';
import type { DiscoveryInputs, DiscoveryResult, FailedTarget } from '../city/discovery.js';
import type { GeneratedKnowledge } from '../city/knowledge.js';
import type { Descriptor, Npc, NpcSchedule, ScheduleEntry } from '../city/npc.js';
import type { PlotState } from '../city/plot.js';
import { CELL_ROLE_IDS, HOSTILE_ORG_ID, STATION_ORG_ID, type GeneratedOrgs, type GeneratedPrincipals } from '../city/principals.js';
import { cityScheduleBinder, resolveScheduleCandidates } from '../city/schedule-binding.js';
import type { BriefLead, StartingBrief } from '../city/starting-brief.js';
import { CONTENT_WEEKDAYS, enginePhaseOf, type ContentPhase } from '../city/time-mapping.js';
import type { Doctrine } from '../hostile/doctrine.js';
import {
  asTruth,
  type ChannelId,
  type DeadDropId,
  type DocId,
  type EntityId,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
  type PropId,
  type Proposition,
  type UnkId,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { SideThreadState, ThreadId } from '../noise/side-threads.js';
import { createPrng, type Prng } from '../prng/prng.js';
import { CARRY_ATTEMPTS, arcStreamSeed, carryStreamSeed } from './streams.js';
import {
  arcDropId,
  nextCarryDrop,
  type ArcThreadSpec,
  type CarryIn,
  type CarryState,
  type CarriedPerson,
  type CarriedPlacement,
  type PersonalFileInput,
  type PostingContext,
} from './types.js';

export interface CarryCore {
  readonly brief: StartingBrief;
  readonly plot: PlotState;
  readonly knowledge: GeneratedKnowledge;
  readonly comms: GeneratedComms;
  readonly city: City;
  readonly orgs: GeneratedOrgs;
  readonly principals: GeneratedPrincipals;
}

export interface CarryFailure {
  readonly attempts: number;
  readonly failure?: FailedTarget;
}

/** Resolve a Service Definition id to the name step 2 stamps on the hostile org. */
export function serviceDisplayName(
  services: ReadonlyMap<string, { readonly id: string; readonly name: string }>,
  serviceId: string,
): string | undefined {
  for (const service of services.values()) {
    if (sameId(service.id, serviceId)) {
      return service.name;
    }
  }
  return undefined;
}

/**
 * Apply carry-in. Returns the world, or how many attempts failed. The caller
 * turns a failure into a generator error so this module does not import it.
 */
export function applyPostingCarry(
  world: WorldState,
  core: CarryCore,
  ctx: PostingContext,
  content: ContentSet,
  burnThreshold: number,
  verify: (inputs: DiscoveryInputs) => DiscoveryResult,
): { readonly ok: true; readonly world: WorldState } | { readonly ok: false; readonly error: CarryFailure } {
  const dropped = new Set<string>();
  let lastFailure: FailedTarget | undefined;
  for (let attempt = 0; attempt < CARRY_ATTEMPTS; attempt += 1) {
    const placed = placeAttempt(world, core, ctx, content, burnThreshold, dropped, attempt);
    const result = verify(discoveryInputs(core, placed.world, placed.brief));
    if (result.ok && cluesReachable(placed.brief, placed.threads)) {
      return { ok: true, world: placed.world };
    }
    lastFailure = result.failure;
  }
  let attempt = CARRY_ATTEMPTS;
  for (;;) {
    const drop = nextCarryDrop(ctx.carry, dropped);
    if (drop === undefined) {
      return {
        ok: false,
        error: { attempts: attempt, ...(lastFailure === undefined ? {} : { failure: lastFailure }) },
      };
    }
    dropped.add(drop);
    const placed = placeAttempt(world, core, ctx, content, burnThreshold, dropped, attempt);
    attempt += 1;
    const result = verify(discoveryInputs(core, placed.world, placed.brief));
    if (result.ok && cluesReachable(placed.brief, placed.threads)) {
      return { ok: true, world: placed.world };
    }
    lastFailure = result.failure;
  }
}

interface Placed {
  readonly world: WorldState;
  readonly brief: StartingBrief;
  readonly threads: readonly ArcThreadSpec[];
}

function placeAttempt(
  world: WorldState,
  core: CarryCore,
  ctx: PostingContext,
  content: ContentSet,
  burnThreshold: number,
  dropped: ReadonlySet<string>,
  attempt: number,
): Placed {
  const carryRng = createPrng(carryStreamSeed(ctx.seed, attempt));
  // The arc stream is derived even when every slot is already bound, so a
  // later draw cannot land on the carry stream.
  createPrng(arcStreamSeed(ctx.seed, attempt));
  const binder = cityScheduleBinder(world.city, content);
  const cellIds = new Set<string>(core.principals.cell);
  const npcs: Record<NpcId, Npc> = { ...world.npcs };
  const channels: Record<ChannelId, Channel> = { ...world.channels };
  const placements: CarryState['placements'][number][] = [];
  const recognisers: NpcId[] = [];
  const contactNpcs: NpcId[] = [];
  const contactChannels: ChannelId[] = [];
  const placedIds = new Map<string, NpcId>();

  for (const placement of ctx.carry.placements) {
    if (dropped.has(placement.person.id) || !atLarge(placement)) {
      continue;
    }
    const npc = carriedNpc(placement, content, binder, carryRng);
    npcs[npc.id] = npc;
    placedIds.set(placement.person.id, npc.id);
    placements.push({
      npc: npc.id,
      as: placement.as,
      optional: placement.optional,
      priority: placement.priority,
    });
    if (placement.as === 'recogniser' || placement.as === 'nemesis') {
      recognisers.push(npc.id);
    }
    if (placement.contact && (placement.as === 'asset' || placement.as === 'handed-over')) {
      const channelId = `chan:carry/${placement.person.id}` as ChannelId;
      channels[channelId] = contactChannel(channelId, npc.id);
      contactNpcs.push(npc.id);
      contactChannels.push(channelId);
    }
  }

  const threads = ctx.carry.arcThreads.filter((thread) => !dropped.has(arcDropId(thread.arc)));
  const arcThreads = threads.map((thread) => arcSideThread(thread, placedIds, npcs, cellIds));
  const fileId = 'doc:dossier/personal-file' as DocId;
  const documents: Record<DocId, WorldState['documents'][DocId]> = { ...world.documents };
  const documentPropositions: Record<PropId, Proposition> = { ...world.documentPropositions };
  addDocument(
    documents,
    documentPropositions,
    fileId,
    'dossier',
    ctx.carry.personalFile,
    world.time,
  );
  const arcDocs: DocId[] = [];
  const clueLeads: BriefLead[] = [];
  for (const thread of threads) {
    const docId = `doc:cable/arc-${thread.arc}` as DocId;
    const props = thread.clues.map((clue) => clue.prop ?? clueProposition(clue.id, placedIds, thread));
    addDocument(documents, documentPropositions, docId, 'cable', { title: thread.template, body: thread.template, asserts: props }, world.time);
    arcDocs.push(docId);
    for (const prop of props) {
      clueLeads.push({ source: { kind: 'document', id: docId }, prop });
    }
  }

  const known = new Set<EntityId>(world.player.known.entities);
  for (const id of filePersons(ctx.carry.personalFile)) {
    known.add(id);
  }
  for (const id of placedIds.values()) {
    known.add(id);
  }

  const unk = preallocateUnk(world, ctx.carry, placedIds);
  const suspicionCap = Math.max(0, burnThreshold) / 2;
  const suspicion = Math.min(suspicionCap, Math.max(0, ctx.carry.modifiers.coverSuspicion));
  const { ledger, deadDrops, city } = applyRequisitions(world, ctx.carry);
  const carryState: CarryState = {
    placements,
    recognisers,
    unk: unk.record,
    patternDetection: ctx.carry.modifiers.patternDetection,
    requisitions: ctx.carry.requisitions,
    dropped: [...dropped],
    legendOfficial: ctx.legend.official,
    recogniserSuspicion: ctx.carry.recogniserSuspicion ?? 0,
    seen: [],
    pendingLines: [],
  };
  const brief: StartingBrief = {
    ...core.brief,
    knownEntities: [...new Set<EntityId>([...core.brief.knownEntities, ...known])],
    dossiers: [...core.brief.dossiers, fileId, ...arcDocs],
    channels: [...core.brief.channels, ...contactChannels],
    contacts: [...core.brief.contacts, ...contactNpcs],
    leads: [...core.brief.leads, ...clueLeads],
  };
  const next: WorldState = {
    ...world,
    city,
    npcs,
    whereabouts: { ...world.whereabouts, ...whereaboutsOf(npcs, placedIds) },
    sideThreads: [...world.sideThreads, ...arcThreads],
    channels,
    deadDrops,
    documents,
    documentPropositions,
    station: { ...world.station, ledger },
    hostile: {
      ...world.hostile,
      doctrine: shiftDoctrine(world.hostile.doctrine, ctx.carry.modifiers.doctrineShift),
    },
    player: {
      ...world.player,
      cover: { ...world.player.cover, id: ctx.legend.cover, title: ctx.legend.name },
      coverSuspicion: asTruth(suspicion),
      tailed: asTruth(ctx.carry.modifiers.tailed),
      known: {
        entities: [...known],
        channels: [...world.player.known.channels, ...contactChannels],
        drops: world.player.known.drops,
      },
      contacts: [...world.player.contacts, ...contactNpcs],
      unkIds: { ...world.player.unkIds, ...unk.byNpc },
    },
    carry: asTruth(carryState),
  };
  return { world: next, brief, threads };
}

function carriedNpc(
  placement: CarriedPlacement,
  content: ContentSet,
  binder: ReturnType<typeof cityScheduleBinder>,
  rng: Prng,
): Npc {
  const person = placement.person;
  const archetype = findArchetype(content, person.archetype);
  const hostile = placement.as === 'recogniser' || placement.as === 'nemesis';
  const org = hostile ? HOSTILE_ORG_ID : allegianceOrg(person.allegiance.true);
  return {
    id: npcIdOf(person.id),
    archetype: person.archetype,
    role: archetype?.role ?? (hostile ? 'hostile-officer' : 'contact'),
    ...(org === undefined ? {} : { org }),
    trueAllegiance: asTruth({ org: org ?? STATION_ORG_ID }),
    apparentAllegiance: apparentOf(person.allegiance.apparent, hostile),
    mice: asTruth(person.mice),
    moneyNeed: asTruth(0),
    reliability: asTruth(0.5),
    tradecraft: asTruth(person.tradecraft ?? 0),
    securityConsciousness: asTruth(person.securityConsciousness ?? 0),
    loyalty: asTruth(person.loyalty),
    status: asTruth(person.status === 'arrested' ? 'arrested' : 'active'),
    persona: person.persona,
    descriptor: descriptorOf(person),
    schedule: scheduleOf(rng, binder, archetype),
    wariness:
      archetype === undefined ? 0.5 : (archetype.wariness.min + archetype.wariness.max) / 2,
  };
}

function scheduleOf(
  rng: Prng,
  binder: ReturnType<typeof cityScheduleBinder>,
  archetype: Archetype | undefined,
): NpcSchedule {
  const entries: ScheduleEntry[] = [];
  const seen = new Set<string>();
  for (const slot of archetype?.schedule ?? []) {
    const candidates = resolveScheduleCandidates(binder, slot.at, archetype?.fallback, false);
    if (candidates.length === 0) {
      continue;
    }
    const phase: Phase = enginePhaseOf(slot.phase as ContentPhase);
    const weekday = Math.max(0, CONTENT_WEEKDAYS.indexOf(slot.weekday as (typeof CONTENT_WEEKDAYS)[number]));
    const key = `${weekday}:${phase}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({ weekday, phase, loc: rng.pick(candidates).id });
  }
  if (entries.length === 0) {
    const fallback = binder.allPublic()[0] ?? binder.all()[0];
    if (fallback !== undefined) {
      entries.push({ weekday: 0, phase: 0, loc: fallback.id });
    }
  }
  entries.sort((a, b) => a.weekday - b.weekday || a.phase - b.phase);
  return { entries };
}

function arcSideThread(
  spec: ArcThreadSpec,
  placedIds: ReadonlyMap<string, NpcId>,
  npcs: Readonly<Record<string, Npc>>,
  cellIds: ReadonlySet<string>,
): SideThreadState {
  const participants: NpcId[] = [];
  for (const person of Object.values(spec.bindings)) {
    const id = placedIds.get(person) ?? npcIdOf(person);
    const npc = npcs[id];
    if (npc === undefined || cellIds.has(id) || isCellMember(npc)) {
      continue;
    }
    if (!participants.includes(id)) {
      participants.push(id);
    }
  }
  const propositions = spec.clues.map(
    (clue) => clue.prop ?? clueProposition(clue.id, placedIds, spec),
  );
  return {
    id: `thread:arc-${spec.arc}` as ThreadId,
    template: spec.template,
    participants,
    propositions,
    traces: [],
    channels: [],
  };
}

function clueProposition(
  id: string,
  placedIds: ReadonlyMap<string, NpcId>,
  spec: ArcThreadSpec,
): Proposition {
  const first = Object.values(spec.bindings)[0];
  const subject = first === undefined ? STATION_ORG_ID : (placedIds.get(first) ?? npcIdOf(first));
  return { id, subject, predicate: 'KNOWS', object: HOSTILE_ORG_ID };
}

function addDocument(
  documents: Record<DocId, WorldState['documents'][DocId]>,
  propositions: Record<PropId, Proposition>,
  id: DocId,
  kind: 'dossier' | 'cable',
  file: { readonly title: string; readonly body: string; readonly asserts: readonly Proposition[] },
  date: WorldState['time'],
): void {
  documents[id] = {
    id,
    kind,
    title: file.title,
    date,
    body: file.body,
    asserts: file.asserts.map((prop) => prop.id as PropId),
  };
  for (const prop of file.asserts) {
    propositions[prop.id as PropId] = prop;
  }
}

function filePersons(file: PersonalFileInput): NpcId[] {
  const ids: NpcId[] = [];
  for (const person of file.persons ?? []) {
    ids.push(npcIdOf(person));
  }
  for (const prop of file.asserts) {
    if (prop.subject.startsWith('npc:')) {
      ids.push(prop.subject as NpcId);
    }
  }
  return ids;
}

function preallocateUnk(
  world: WorldState,
  carry: CarryIn,
  placedIds: ReadonlyMap<string, NpcId>,
): { readonly record: CarryState['unk']; readonly byNpc: Record<NpcId, UnkId> } {
  let next = 1;
  for (const id of Object.values(world.player.unkIds)) {
    const local = Number(id.slice('unk:'.length));
    if (Number.isInteger(local) && local >= next) {
      next = local + 1;
    }
  }
  const record: Record<
    string,
    { unk: UnkId; npc: NpcId; sightings: readonly { city: string; year: number }[] }
  > = {};
  const byNpc: Record<NpcId, UnkId> = {};
  for (const entry of carry.unkPrealloc) {
    const npc = placedIds.get(entry.person);
    if (npc === undefined) {
      continue;
    }
    const unk = `unk:${next}` as UnkId;
    next += 1;
    record[entry.ref] = { unk, npc, sightings: entry.sightings ?? [] };
    byNpc[npc] = unk;
  }
  return { record, byNpc };
}

function applyRequisitions(
  world: WorldState,
  carry: CarryIn,
): {
  readonly ledger: WorldState['station']['ledger'];
  readonly deadDrops: WorldState['deadDrops'];
  readonly city: City;
} {
  let ledger = world.station.ledger;
  let deadDrops = world.deadDrops;
  let city = world.city;
  for (const effect of carry.requisitions) {
    if (effect.kind === 'budget-credit') {
      ledger = {
        ...ledger,
        entries: [
          ...ledger.entries,
          { at: world.time, amount: effect.amount, reason: 'funds-grant', ref: 'requisition' },
        ],
      };
    }
    if (effect.kind === 'extra-player-drop') {
      const added = extraDrop(city, deadDrops, world.station.org);
      deadDrops = added.deadDrops;
      city = added.city;
    }
  }
  return { ledger, deadDrops, city };
}

function extraDrop(
  city: City,
  deadDrops: WorldState['deadDrops'],
  owner: OrgId,
): { readonly city: City; readonly deadDrops: WorldState['deadDrops'] } {
  const loc = Object.values(city.locations).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  if (loc === undefined) {
    return { city, deadDrops };
  }
  const id = 'drop:carry-extra' as DeadDropId;
  const drop: DeadDrop = { id, loc: loc.id, owner, contents: [] };
  const locations = {
    ...city.locations,
    [loc.id]: { ...loc, deadDropSites: [...loc.deadDropSites, id] },
  };
  return {
    city: { ...city, locations: locations as City['locations'] },
    deadDrops: { ...deadDrops, [id]: drop },
  };
}

function discoveryInputs(core: CarryCore, world: WorldState, brief: StartingBrief) {
  return {
    brief,
    plot: core.plot,
    knowledge: core.knowledge,
    comms: { ...core.comms, channels: world.channels },
    city: world.city,
    orgs: core.orgs,
    principals: { ...core.principals, npcs: world.npcs },
  };
}

function cluesReachable(brief: StartingBrief, threads: readonly ArcThreadSpec[]): boolean {
  const docs = new Set<string>([brief.cable, ...brief.dossiers]);
  const leads = new Set(brief.leads.map((lead) => lead.prop.id));
  for (const thread of threads) {
    const docId = `doc:cable/arc-${thread.arc}`;
    for (const clue of thread.clues) {
      const propId = clue.prop?.id ?? clue.id;
      if (!docs.has(docId) && !leads.has(propId)) {
        return false;
      }
    }
  }
  return true;
}

function shiftDoctrine(doctrine: Doctrine, shift: Partial<Doctrine>): Doctrine {
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  return {
    riskTolerance: clamp(doctrine.riskTolerance + (shift.riskTolerance ?? 0)),
    securityConsciousness: clamp(doctrine.securityConsciousness + (shift.securityConsciousness ?? 0)),
    deceptionAppetite: clamp(doctrine.deceptionAppetite + (shift.deceptionAppetite ?? 0)),
  };
}

function whereaboutsOf(
  npcs: Readonly<Record<NpcId, Npc>>,
  placedIds: ReadonlyMap<string, NpcId>,
): Record<NpcId, LocId | 'absent'> {
  const whereabouts: Record<NpcId, LocId | 'absent'> = {};
  for (const id of placedIds.values()) {
    whereabouts[id] = npcs[id]?.schedule.entries[0]?.loc ?? 'absent';
  }
  return whereabouts;
}

function atLarge(placement: CarriedPlacement): boolean {
  return placement.person.status === 'at-large' || placement.person.status === 'turned';
}

function npcIdOf(id: string): NpcId {
  return (id.startsWith('npc:') ? id : `npc:${id}`) as NpcId;
}

function findArchetype(content: ContentSet, id: string): Archetype | undefined {
  for (const archetype of content.archetypes.values()) {
    if (sameId(archetype.id, id)) {
      return archetype;
    }
  }
  return undefined;
}

function isCellMember(npc: Npc): boolean {
  if (npc.role === 'cell') {
    return true;
  }
  const local = npc.archetype.includes('/')
    ? npc.archetype.slice(npc.archetype.lastIndexOf('/') + 1)
    : npc.archetype;
  return local === 'cell' || (CELL_ROLE_IDS as readonly string[]).includes(local);
}

function allegianceOrg(value: string): OrgId | undefined {
  return value.startsWith('org:') ? (value as OrgId) : undefined;
}

function apparentOf(value: string, hostile: boolean): Npc['apparentAllegiance'] {
  if (
    value === 'station' ||
    value === 'hostile' ||
    value === 'cell' ||
    value === 'neutral' ||
    value === 'unknown'
  ) {
    return value;
  }
  return hostile ? 'hostile' : 'neutral';
}

function descriptorOf(person: CarriedPerson): Descriptor {
  return { summary: person.descriptor, phrases: [person.descriptor], pools: [] };
}

function contactChannel(id: ChannelId, owner: NpcId): Channel {
  return {
    id,
    kind: 'courier',
    owner,
    schedule: { period: 1, start: { day: 0, phase: 0 }, phase: 0 },
  };
}

function sameId(left: string, right: string): boolean {
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}
