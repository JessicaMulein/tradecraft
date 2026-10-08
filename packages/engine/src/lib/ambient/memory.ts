/**
 * Recollections and regard (ambient-world Req 12). A recollection is grounded
 * in something the NPC witnessed, took part in, or heard from someone who
 * held it. Salience decays each day.
 */

import { asTruth, revealTruth, type GameTime, type LocId, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng, type Prng } from '../prng/prng.js';
import { crowdLevel, type CrowdLevel } from '../city/city.js';

import { ambientCatalogue } from './catalogue.js';
import { ambientKeySeed } from './streams.js';
import type { Townsfolk } from './state.js';

export type RecollectionKind =
  | 'saw'
  | 'talked'
  | 'paid'
  | 'threatened'
  | 'seen-with'
  | 'asked-about'
  | 'attended'
  | 'introduced';

export interface Recollection {
  readonly id: string;
  readonly kind: RecollectionKind;
  readonly at: GameTime;
  readonly loc: LocId;
  readonly with?: NpcId;
  /** Set when the NPC cannot name the other person. */
  readonly withDescriptor?: string;
  readonly aboutPlayer: boolean;
  readonly salience: number;
  readonly reported?: boolean;
  readonly ground:
    | { readonly kind: 'participant' | 'witness'; readonly event: string; readonly loc: LocId }
    | { readonly kind: 'gossip'; readonly from: NpcId; readonly item: string };
}

export interface Regard {
  readonly warmth: number;
  readonly wariness: number;
  readonly familiarity: number;
}

const SALIENCE_DECAY = 0.9;
const SALIENCE_FLOOR = 0.1;
const FULL_CAP = 16;
const TOWNSFOLK_CAP = 4;
const NOTICE_BASE = 0.5;

const CROWD_FACTOR: Readonly<Record<CrowdLevel, number>> = {
  empty: 1.2,
  sparse: 1,
  busy: 0.6,
  packed: 0.3,
};

const BUILTIN_REGARD: Readonly<Record<string, Regard>> = {
  approach: { warmth: 0.05, wariness: 0, familiarity: 0.02 },
  talk: { warmth: 0.02, wariness: 0, familiarity: 0.05 },
  pay: { warmth: 0.1, wariness: 0, familiarity: 0.05 },
  confront: { warmth: -0.2, wariness: 0.3, familiarity: 0.05 },
  introduce: { warmth: 0.05, wariness: -0.05, familiarity: 0.1 },
};

function regardRule(kind: string): Regard | undefined {
  const loaded = ambientCatalogue().regard;
  if (Object.keys(loaded).length > 0) {
    return loaded[kind];
  }
  return BUILTIN_REGARD[kind];
}

const KIND_FOR_ACTION: Readonly<Record<string, RecollectionKind>> = {
  talk: 'talked',
  approach: 'talked',
  pay: 'paid',
  confront: 'threatened',
  introduce: 'introduced',
};

export function emptyRegard(): Regard {
  return { warmth: 0, wariness: 0, familiarity: 0 };
}

export function noticeCheck(attentiveness: number, crowdFactor: number, rng: Prng): boolean {
  const p = Math.min(1, Math.max(0, NOTICE_BASE * attentiveness * crowdFactor));
  return rng.bool(p);
}

export function compact(recs: readonly Recollection[], cap: number, floor = SALIENCE_FLOOR): Recollection[] {
  return recs
    .map((rec) => ({ ...rec, salience: rec.salience * SALIENCE_DECAY }))
    .filter((rec) => rec.salience >= floor - 1e-9)
    .sort((a, b) => b.salience - a.salience || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, cap);
}

export function recollectionGrounded(
  rec: Recollection,
  sourceHeld: ReadonlySet<string> | undefined,
): boolean {
  if (rec.ground.kind === 'gossip') {
    return sourceHeld?.has(rec.ground.item) === true && rec.ground.from.length > 0;
  }
  return rec.ground.event.length > 0 && rec.ground.loc === rec.loc;
}

function asRecollections(value: readonly unknown[] | undefined): Recollection[] {
  const found: Recollection[] = [];
  for (const item of value ?? []) {
    if (item !== null && typeof item === 'object' && 'ground' in item && 'id' in item) {
      found.push(item as Recollection);
    }
  }
  return found;
}

export function memoryOf(world: WorldState): Record<NpcId, readonly Recollection[]> {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return {};
  }
  const stored = revealTruth(ambient.memory);
  const out: Record<string, readonly Recollection[]> = {};
  for (const [id, value] of Object.entries(stored)) {
    out[id] = asRecollections(value);
  }
  return out as Record<NpcId, readonly Recollection[]>;
}

export function regardOf(world: WorldState, id: NpcId): Regard {
  const ambient = world.ambient;
  const record = ambient === undefined ? undefined : revealTruth(ambient.regard)[id];
  if (record !== null && typeof record === 'object' && 'warmth' in record && 'wariness' in record) {
    const regard = record as Regard;
    return {
      warmth: regard.warmth,
      wariness: regard.wariness,
      familiarity: 'familiarity' in regard ? regard.familiarity : 0,
    };
  }
  return ambient?.townsfolk[id]?.regard ?? emptyRegard();
}

/** Warmth minus wariness. Zero when ambient is off, so the slice formulae are unchanged. */
export function regardDelta(world: WorldState, id: string): number {
  if (world.ambient === undefined) {
    return 0;
  }
  const regard = regardOf(world, id as NpcId);
  return regard.warmth - regard.wariness;
}

function clampRegard(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function applyRegard(current: Regard, rule: Regard): Regard {
  return {
    warmth: clampRegard(current.warmth + rule.warmth),
    wariness: clampRegard(current.wariness + rule.wariness),
    familiarity: clampRegard(current.familiarity + rule.familiarity),
  };
}

function presentAt(world: WorldState, loc: string): NpcId[] {
  const ids: NpcId[] = [];
  for (const [id, where] of Object.entries(world.whereabouts ?? {})) {
    if (where === loc) {
      ids.push(id as NpcId);
    }
  }
  return ids.sort();
}

function crowdFactorAt(world: WorldState, loc: LocId): number {
  const location = world.city?.locations?.[loc];
  const model = location === undefined ? undefined : world.city.crowdModels?.[location.type];
  if (model === undefined) {
    return 1;
  }
  return CROWD_FACTOR[crowdLevel(model, world.time, new Set())];
}

function attentiveness(world: WorldState, id: NpcId): number {
  const npc = world.npcs?.[id];
  if (npc === undefined) {
    return 0.5;
  }
  return revealTruth(npc.securityConsciousness);
}

function descriptorFor(world: WorldState, viewer: NpcId, other: NpcId): string | undefined {
  const known = world.ambient?.tieKnowledge[viewer]?.some(
    (fact) => fact.subject === other || fact.object === other,
  );
  if (known === true) {
    return undefined;
  }
  return world.npcs?.[other]?.descriptor.summary ?? world.ambient?.townsfolk[other]?.descriptor;
}

function witnessRec(args: {
  readonly npc: NpcId;
  readonly kind: RecollectionKind;
  readonly at: GameTime;
  readonly loc: LocId;
  readonly with?: NpcId;
  readonly withDescriptor?: string;
  readonly aboutPlayer: boolean;
  readonly event: string;
}): Recollection {
  return {
    id: `rec:${args.npc}:${args.event}:${args.kind}`,
    kind: args.kind,
    at: args.at,
    loc: args.loc,
    ...(args.with !== undefined ? { with: args.with } : {}),
    ...(args.withDescriptor !== undefined ? { withDescriptor: args.withDescriptor } : {}),
    aboutPlayer: args.aboutPlayer,
    salience: 0.6,
    ground: { kind: 'witness', event: args.event, loc: args.loc },
  };
}

export interface NoticeAction {
  readonly kind: string;
  readonly npc?: string;
  readonly task?: { readonly kind: string; readonly target?: string };
}

function directTarget(action: NoticeAction | undefined): { readonly id?: NpcId; readonly kind: string } {
  if (action === undefined) {
    return { kind: 'saw' };
  }
  if (action.kind === 'task' && action.task?.kind === 'introduce' && action.task.target !== undefined) {
    return { id: action.task.target as NpcId, kind: 'introduce' };
  }
  return { id: action.npc as NpcId | undefined, kind: action.kind };
}

/**
 * Notice checks for NPCs at the player's location, then regard for a direct
 * talk, payment, threat or introduction. Draws use the notice stream keyed by
 * the turn and the NPC.
 */
export function noticeTurn(world: WorldState, action?: NoticeAction): WorldState {
  const ambient = world.ambient;
  const loc = world.player?.loc;
  if (ambient === undefined || loc === undefined) {
    return world;
  }
  const seed = world.meta?.seed ?? 'ambient';
  const turnKey = `${world.time.day}:${world.time.phase}:${action?.kind ?? 'wait'}:${loc}`;
  const memory = { ...memoryOf(world) };
  const regard = { ...revealTruth(ambient.regard) } as Record<NpcId, Regard>;
  let townsfolk: Record<NpcId, Townsfolk> = { ...ambient.townsfolk };
  const crowd = crowdFactorAt(world, loc);
  const direct = directTarget(action);
  for (const id of presentAt(world, loc)) {
    const directHit = direct.id === id;
    const rng = createPrng(ambientKeySeed(seed, 'notice', `${turnKey}|${id}`, world.time.day));
    if (!directHit && !noticeCheck(attentiveness(world, id), crowd, rng)) {
      continue;
    }
    const event = `turn:${turnKey}`;
    const other = direct.id !== undefined && direct.id !== id ? direct.id : undefined;
    const kind: RecollectionKind =
      direct.id === id
        ? (KIND_FOR_ACTION[direct.kind] ?? 'saw')
        : other !== undefined
          ? 'seen-with'
          : 'saw';
    const rec = witnessRec({
      npc: id,
      kind,
      at: world.time,
      loc,
      ...(other !== undefined ? { with: other } : {}),
      ...(other !== undefined ? { withDescriptor: descriptorFor(world, id, other) } : {}),
      aboutPlayer: true,
      event,
    });
    const held = memory[id] ?? [];
    if (!held.some((item) => item.id === rec.id)) {
      memory[id] = [...held, rec];
    }
    const rule = regardRule(direct.id === id ? direct.kind : '');
    if (rule !== undefined) {
      const nextRegard = applyRegard(regard[id] ?? regardOf(world, id), rule);
      regard[id] = nextRegard;
      const person = townsfolk[id];
      if (person !== undefined) {
        townsfolk = { ...townsfolk, [id]: { ...person, regard: nextRegard } };
      }
    }
  }
  return {
    ...world,
    ambient: {
      ...ambient,
      memory: asTruth(memory),
      regard: asTruth(regard),
      townsfolk,
    },
  };
}

/** A greeting when someone present already knows the player well. */
export function greetingLine(world: WorldState, loc: LocId): string | undefined {
  if (world.ambient === undefined) {
    return undefined;
  }
  for (const id of presentAt(world, loc)) {
    if (regardOf(world, id).familiarity >= 0.6) {
      const name = world.npcs?.[id]?.persona.name ?? 'Someone';
      return `${name} greets you by name.`;
    }
  }
  return undefined;
}

export function stepMemory(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  const memory = memoryOf(world);
  const next: Record<NpcId, readonly Recollection[]> = {};
  for (const [id, recs] of Object.entries(memory)) {
    const cap = world.npcs?.[id as NpcId] !== undefined ? FULL_CAP : TOWNSFOLK_CAP;
    next[id as NpcId] = compact(recs, cap);
  }
  return { ...world, ambient: { ...ambient, memory: asTruth(next) } };
}
