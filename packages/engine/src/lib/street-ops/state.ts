/**
 * Street-ops state and truth slices (task 4.1).
 *
 * Both slices are absent until the add-on writes them. A slice world and a
 * disabled game never gain `ext`, so their saves stay the saves they were.
 * An older save that has no slice loads as the empty slice.
 */

import type { GameTime } from '../model/core.js';

export const STREET_SLICE_VERSION = 1;

export type KnowledgeSource = 'driven' | 'seen' | 'map' | 'local' | 'aid';

export interface StreetPosition {
  readonly segment: string;
  readonly dir: 'fwd' | 'rev';
  readonly progress: number;
}

export interface VehicleRecord {
  readonly id: string;
  readonly def: string;
  readonly plate: string;
  /** Set only after the player was told the plate is burned. */
  readonly knownBurned: boolean;
}

export interface ToldStory {
  readonly id: string;
  readonly template: string;
  readonly at: GameTime;
}

/** A person the player put in the car. Composure and time hidden stay in the truth slice. */
export interface PassengerView {
  readonly npc: string;
  readonly mode: 'declared' | 'concealed';
  readonly spot?: string;
  /** Set once the car has passed a checkpoint since this person got in. */
  readonly crossed: boolean;
}

/** A completed drop-off the objective evaluator can read. */
export interface SmuggleDelivery {
  readonly npc: string;
  readonly loc: string;
  readonly at: GameTime;
}

export interface DriveState {
  readonly sessionKey: string;
  readonly vehicle: string;
  readonly at: StreetPosition;
  readonly speed: 'slow' | 'normal' | 'fast';
  readonly ticks: number;
  readonly phasesCharged: number;
  readonly path: readonly StreetPosition[];
  readonly passengers: readonly string[];
  readonly pendingCheckpoint?: string;
  /** Vehicle lines already shown, repeated when a surveillance route finishes. */
  readonly noted?: readonly string[];
}

export interface StreetReplayHeader {
  readonly stream: 'street';
  /** `derive(seed, base)` is the street stream. */
  readonly base: number;
  readonly substreams: readonly ['tail', 'spot', 'checkpoint', 'bluff'];
}

/** View-safe slice: what the player could know. */
export interface StreetOpsState {
  readonly version: typeof STREET_SLICE_VERSION;
  readonly vehicles: readonly VehicleRecord[];
  readonly knowledge: Readonly<Record<string, KnowledgeSource>>;
  /** A map's street name, kept until the player drives or sees the real street. */
  readonly mapNames: Readonly<Record<string, string>>;
  /** Checkpoints the player has seen from the car. Unseen posts stay off the map. */
  readonly seenCheckpoints: readonly string[];
  /** Map documents already paid for. */
  readonly mapsRead: readonly string[];
  readonly session?: DriveState;
  readonly told: readonly ToldStory[];
  readonly rides: Readonly<Record<string, readonly PassengerView[]>>;
  readonly deliveries: readonly SmuggleDelivery[];
  /** Plates a checkpoint has already taken down. Border checks read this list. */
  readonly notedPlates: readonly string[];
  readonly counters: { readonly sessions: number };
  readonly replay: StreetReplayHeader;
}

export type TailStatus = 'attached' | 'lost' | 'handed-off' | 'burned';

export interface TailVehicle {
  readonly id: string;
  readonly descriptor: string;
  readonly lag: number;
  readonly role: 'lead' | 'parallel' | 'backup';
  readonly segment?: string;
}

/**
 * A team the player must not see. `lost` with `lostFor` still below the
 * timeout is the brief loss; once `lostFor` reaches the timeout the team is
 * dropped. Attached and handed-off keep `player.tailed` set.
 */
export interface TailTeam {
  readonly id: string;
  readonly service: string;
  readonly profile: string;
  readonly status: TailStatus;
  readonly since: number;
  readonly lostFor: number;
  readonly obvious: boolean;
  readonly vehicles: readonly TailVehicle[];
  readonly lastKnown?: string;
}

/** One told story. `wasLie` stays on this truth entry and off the player's told list. */
export interface StoryEntry {
  readonly template: string;
  readonly at: GameTime;
  readonly wasLie: boolean;
  readonly identity: string;
  readonly service: string;
  readonly place: string;
  readonly slots: Readonly<Record<string, string>>;
}

export interface PlayerStatementTruth {
  readonly id: string;
  readonly wasLie: boolean;
}

export interface ServicePosture {
  readonly alert: boolean;
  readonly search: boolean;
}
export interface ConcealmentRecord {
  readonly npc: string;
  readonly ticksConcealed: number;
  readonly composure: number;
  readonly strained: boolean;
}

/** Truth slice. The player view does not receive this. */
export interface StreetOpsTruth {
  readonly version: typeof STREET_SLICE_VERSION;
  readonly teams: Readonly<Record<string, TailTeam>>;
  readonly vehicleContents: Readonly<Record<string, readonly string[]>>;
  readonly knownBy: Readonly<Record<string, readonly string[]>>;
  readonly ledger: Readonly<Record<string, readonly StoryEntry[]>>;
  readonly statements: readonly PlayerStatementTruth[];
  readonly concealment: Readonly<Record<string, readonly ConcealmentRecord[]>>;
  readonly posture: Readonly<Record<string, ServicePosture>>;
  /** Uses of a navigation aid. The player is not shown this list. */
  readonly traces: readonly { readonly kind: 'navigation-aid'; readonly at: GameTime }[];
}

export function emptyStreetOpsState(replay: StreetReplayHeader): StreetOpsState {
  return {
    version: STREET_SLICE_VERSION,
    vehicles: [],
    knowledge: {},
    mapNames: {},
    seenCheckpoints: [],
    mapsRead: [],
    told: [],
    rides: {},
    deliveries: [],
    notedPlates: [],
    counters: { sessions: 0 },
    replay,
  };
}

export function emptyStreetOpsTruth(): StreetOpsTruth {
  return {
    version: STREET_SLICE_VERSION,
    teams: {},
    vehicleContents: {},
    knownBy: {},
    ledger: {},
    statements: [],
    concealment: {},
    posture: {},
    traces: [],
  };
}

function phaseOf(value: unknown): GameTime['phase'] {
  if (value === 1 || value === 2 || value === 3) return value;
  return 0;
}

function storyFrom(value: unknown, service: string): StoryEntry | undefined {
  if (!isRecord(value) || typeof value.template !== 'string') return undefined;
  const at = isRecord(value.at) ? { day: typeof value.at.day === 'number' ? value.at.day : 0, phase: phaseOf(value.at.phase) } : { day: 0, phase: 0 as const };
  const slots: Record<string, string> = {};
  if (isRecord(value.slots)) {
    for (const [key, slot] of Object.entries(value.slots)) {
      if (typeof slot === 'string') slots[key] = slot;
    }
  }
  return {
    template: value.template,
    at,
    wasLie: value.wasLie === true,
    identity: typeof value.identity === 'string' ? value.identity : '',
    service: typeof value.service === 'string' ? value.service : service,
    place: typeof value.place === 'string' ? value.place : '',
    slots,
  };
}

function ledgerFrom(saved: unknown): StreetOpsTruth['ledger'] {
  if (!isRecord(saved)) return {};
  const ledger: Record<string, StoryEntry[]> = {};
  for (const [service, entries] of Object.entries(saved)) {
    if (!Array.isArray(entries)) continue;
    const next = entries.map((entry) => storyFrom(entry, service)).filter((entry): entry is StoryEntry => entry !== undefined);
    if (next.length > 0) ledger[service] = next;
  }
  return ledger;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Older saves and a missing slice load as the empty slice at the current version. */
export function migrateStreetOpsState(saved: unknown, replay: StreetReplayHeader): StreetOpsState {
  if (!isRecord(saved) || saved.version !== STREET_SLICE_VERSION) return emptyStreetOpsState(replay);
  const empty = emptyStreetOpsState(replay);
  return {
    version: STREET_SLICE_VERSION,
    vehicles: Array.isArray(saved.vehicles) ? (saved.vehicles as VehicleRecord[]) : empty.vehicles,
    knowledge: isRecord(saved.knowledge) ? (saved.knowledge as StreetOpsState['knowledge']) : {},
    mapNames: stringRecord(saved.mapNames),
    seenCheckpoints: stringList(saved.seenCheckpoints),
    mapsRead: stringList(saved.mapsRead),
    ...(isRecord(saved.session) ? { session: saved.session as unknown as DriveState } : {}),
    told: Array.isArray(saved.told) ? (saved.told as ToldStory[]) : [],
    rides: isRecord(saved.rides) ? (saved.rides as StreetOpsState['rides']) : {},
    deliveries: Array.isArray(saved.deliveries) ? (saved.deliveries as SmuggleDelivery[]) : [],
    notedPlates: Array.isArray(saved.notedPlates) ? saved.notedPlates.filter((item): item is string => typeof item === 'string') : [],
    counters:
      isRecord(saved.counters) && typeof saved.counters.sessions === 'number'
        ? { sessions: saved.counters.sessions }
        : { sessions: 0 },
    replay,
  };
}

export function migrateStreetOpsTruth(saved: unknown): StreetOpsTruth {
  if (!isRecord(saved) || saved.version !== STREET_SLICE_VERSION) return emptyStreetOpsTruth();
  const empty = emptyStreetOpsTruth();
  return {
    version: STREET_SLICE_VERSION,
    teams: isRecord(saved.teams) ? (saved.teams as StreetOpsTruth['teams']) : empty.teams,
    vehicleContents: isRecord(saved.vehicleContents)
      ? (saved.vehicleContents as StreetOpsTruth['vehicleContents'])
      : {},
    knownBy: isRecord(saved.knownBy) ? (saved.knownBy as StreetOpsTruth['knownBy']) : {},
    ledger: ledgerFrom(saved.ledger),
    statements: Array.isArray(saved.statements) ? (saved.statements as PlayerStatementTruth[]) : [],
    concealment: isRecord(saved.concealment) ? (saved.concealment as StreetOpsTruth['concealment']) : {},
    posture: isRecord(saved.posture) ? (saved.posture as StreetOpsTruth['posture']) : {},
    traces: traceList(saved.traces),
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const names: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') names[key] = item;
  }
  return names;
}

function traceList(value: unknown): StreetOpsTruth['traces'] {
  if (!Array.isArray(value)) return [];
  const traces: { kind: 'navigation-aid'; at: GameTime }[] = [];
  for (const item of value) {
    if (!isRecord(item) || item.kind !== 'navigation-aid' || !isRecord(item.at)) continue;
    const day = item.at.day;
    const phase = item.at.phase;
    if (typeof day !== 'number' || (phase !== 0 && phase !== 1 && phase !== 2 && phase !== 3)) continue;
    traces.push({ kind: 'navigation-aid', at: { day, phase } });
  }
  return traces;
}
