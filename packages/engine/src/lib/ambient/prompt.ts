/**
 * What an NPC may say about the city, and what a scene may show (ambient-world
 * Req 21). The day's proposition list is snapshotted at the day boundary.
 * Recollections name an unnamed person by descriptor only.
 */

import type { EntityId, LocId, NpcId, Proposition } from '../model/core.js';
import type { WorldState } from '../model/state.js';

import { ambientCatalogue } from './catalogue.js';
import { effectiveLocation, type LocationStatusKind } from './locations.js';
import { memoryOf, type Recollection } from './memory.js';
import type { AmbientPromptFact, AmbientState } from './state.js';

export type { AmbientPromptFact };

export const AMBIENT_FACT_CAP = 8;

export interface AmbientPromptMemory {
  readonly text: string;
  readonly salience: number;
  readonly entities: readonly EntityId[];
}

export interface AmbientScene {
  readonly events: readonly string[];
  readonly status?: LocationStatusKind;
  readonly incidents: readonly string[];
}

interface CityEventRecord {
  readonly name?: unknown;
  readonly start?: unknown;
  readonly end?: unknown;
  readonly public?: unknown;
}

function bySalience<T extends { readonly salience: number; readonly proposition?: Proposition; readonly text?: string }>(
  items: readonly T[],
): T[] {
  return [...items].sort((a, b) => {
    if (b.salience !== a.salience) {
      return b.salience - a.salience;
    }
    const aKey = a.proposition?.id ?? a.text ?? '';
    const bKey = b.proposition?.id ?? b.text ?? '';
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}

/** The highest-salience facts, at most `cap`, in a stable order. */
export function selectAmbientFacts(
  facts: readonly AmbientPromptFact[],
  cap = AMBIENT_FACT_CAP,
): AmbientPromptFact[] {
  return bySalience(facts).slice(0, cap);
}

function tieSalience(ambient: AmbientState, npc: string): number {
  let best = 0.2;
  for (const tie of ambient.ties) {
    if (tie.a === npc || tie.b === npc) {
      best = Math.max(best, tie.affinity);
    }
  }
  return best;
}

function holdings(ambient: AmbientState, npc: NpcId): AmbientPromptFact[] {
  const salience = tieSalience(ambient, npc);
  const facts: AmbientPromptFact[] = [];
  for (const proposition of ambient.tieKnowledge[npc] ?? []) {
    facts.push({ proposition, salience });
  }
  for (const proposition of ambient.falseBeliefs[npc] ?? []) {
    facts.push({ proposition, salience: Math.min(salience, 0.15) });
  }
  return selectAmbientFacts(facts);
}

/** Snapshot each NPC's ambient propositions for the day that is starting. */
export function refreshPromptCache(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  const ids = new Set<string>([
    ...Object.keys(ambient.tieKnowledge),
    ...Object.keys(ambient.falseBeliefs),
  ]);
  const facts: Record<string, readonly AmbientPromptFact[]> = {};
  for (const id of [...ids].sort()) {
    facts[id] = holdings(ambient, id as NpcId);
  }
  return {
    ...world,
    ambient: {
      ...ambient,
      promptCache: { day: world.time.day, facts },
    },
  };
}

/**
 * The propositions this NPC may speak about the city today. Empty until the
 * day boundary that recorded them, so a turn during the day does not change
 * the list.
 */
export function promptFactsFor(world: WorldState, npc: NpcId): readonly AmbientPromptFact[] {
  const cache = world.ambient?.promptCache;
  if (cache === undefined || cache.day !== world.time.day) {
    return [];
  }
  return cache.facts[npc] ?? [];
}

function otherLabel(rec: Recollection, nameOf: (id: string) => string): string | undefined {
  if (rec.withDescriptor !== undefined && rec.withDescriptor.length > 0) {
    return rec.withDescriptor;
  }
  if (rec.with !== undefined) {
    return nameOf(rec.with);
  }
  return undefined;
}

const MEMORY_VERB: Readonly<Record<Recollection['kind'], string>> = {
  saw: 'seeing',
  talked: 'speaking with',
  paid: 'a payment involving',
  threatened: 'a threat toward',
  'seen-with': 'seeing you with',
  'asked-about': 'a question about',
  attended: 'the gathering with',
  introduced: 'an introduction to',
};

/** One recollection as a sentence. An unnamed person is the descriptor only. */
export function recollectionLine(rec: Recollection, nameOf: (id: string) => string): string {
  const place = nameOf(rec.loc);
  const other = otherLabel(rec, nameOf);
  const verb = MEMORY_VERB[rec.kind];
  if (other === undefined) {
    return `You remember ${verb} at ${place}.`;
  }
  return `You remember ${verb} ${other} at ${place}.`;
}

export function recollectionPrompts(
  world: WorldState,
  npc: NpcId,
  nameOf: (id: string) => string,
): readonly AmbientPromptMemory[] {
  if (world.ambient === undefined) {
    return [];
  }
  const lines: AmbientPromptMemory[] = [];
  for (const rec of memoryOf(world)[npc] ?? []) {
    const entities: EntityId[] = [rec.loc];
    if (rec.with !== undefined && (rec.withDescriptor === undefined || rec.withDescriptor.length === 0)) {
      entities.push(rec.with);
    }
    lines.push({
      text: recollectionLine(rec, nameOf),
      salience: rec.salience,
      entities,
    });
  }
  if (lines.length === 0) {
    const templates = ambientCatalogue().recollections;
    if (templates.length === 0) {
      return [];
    }
    const index = [...npc].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % templates.length;
    const picked = templates[index];
    if (picked === undefined) {
      return [];
    }
    return [{ text: picked.text, salience: 0.2, entities: [] }];
  }
  return bySalience(lines);
}

function eventLabel(value: unknown, day: number): string | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }
  const record = value as CityEventRecord;
  if (record.public === false || typeof record.name !== 'string' || record.name.length === 0) {
    return undefined;
  }
  if (typeof record.start === 'number' && day < record.start) {
    return undefined;
  }
  if (typeof record.end === 'number' && day >= record.end) {
    return undefined;
  }
  return record.name;
}

/** Public event labels, a non-open location status, and this phase's incidents. */
export function ambientScene(world: WorldState, loc: LocId): AmbientScene | undefined {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return undefined;
  }
  const day = world.time.day;
  const events = Object.keys(ambient.events)
    .sort()
    .map((id) => eventLabel(ambient.events[id as keyof typeof ambient.events], day))
    .filter((label): label is string => label !== undefined);
  const place = world.city?.locations?.[loc];
  let status: LocationStatusKind | undefined;
  if (place !== undefined && ambient.overlays.length > 0) {
    const effective = effectiveLocation(place, ambient.overlays, world.time);
    if (effective.status !== 'open') {
      status = effective.status;
    }
  }
  const incidents = (ambient.incidentLog ?? [])
    .filter((item) => item.loc === loc && item.phase === world.time.phase)
    .map((item) => item.factLine)
    .sort();
  if (events.length === 0 && status === undefined && incidents.length === 0) {
    return undefined;
  }
  return {
    events,
    ...(status === undefined ? {} : { status }),
    incidents,
  };
}

/** Incident sentences for the action's Fact Lines. Empty when ambient is off. */
export function incidentFactLines(world: WorldState, loc: LocId): readonly string[] {
  return ambientScene(world, loc)?.incidents ?? [];
}
