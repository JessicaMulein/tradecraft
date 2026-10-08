/**
 * Hostile Dossier (design, "Hostile Dossier"; Requirements 12.1–12.4, 12.7, 18.4).
 *
 * A posting's hostile memory folds into one service's dossier. Burned legends
 * and pattern counts only grow. Notoriety is
 * `min(1, n + a·coverSuspicion + b·knownCover + c·|suspectedAssets|)`, then
 * falls by `notorietyDecay` per year and never below 0. Doctrine shifts sum
 * and stay inside ±`maxDoctrineShift`. Carry-in turns that dossier into a
 * capped starting suspicion, a tail, and a detection multiplier per location
 * type.
 *
 * The design names the notoriety weights a, b and c and does not give them
 * numbers. This module uses 0.5, 0.25 and 0.05.
 */

import type {
  ChannelId,
  ChannelKind,
  DeadDropId,
  DifficultyPreset,
  HostileDoctrine,
  OutcomeRecord,
} from '@tradecraft/engine';

import type { CampaignConfig } from './config.js';
import type { CarryModifiers, HostileDossier, LegendId } from './state.js';

/** a: weight on the posting's final cover suspicion. */
export const NOTORIETY_SUSPICION = 0.5;
/** b: added once when the service learned the cover. */
export const NOTORIETY_KNOWN_COVER = 0.25;
/** c: added once per suspected asset in this posting's memory. */
export const NOTORIETY_SUSPECTED = 0.05;

const DOCTRINE_KEYS = ['riskTolerance', 'securityConsciousness', 'deceptionAppetite'] as const;
const CHANNEL_KINDS = new Set<ChannelKind>(['radio', 'numbers', 'courier', 'dead-drop']);

type Memory = OutcomeRecord['hostileMemory'];
type Cover = OutcomeRecord['cover'];

/**
 * Fold one posting's hostile memory into a dossier. `localTypes` turns a
 * compromised drop into its location type and a compromised channel into its
 * channel kind.
 */
export function mergeHostileMemory(
  dossier: HostileDossier,
  memory: Memory,
  cover: Cover,
  legend: LegendId,
  localTypes: (id: DeadDropId | ChannelId) => string,
  maxDoctrineShift: number,
): HostileDossier {
  const burned = [...dossier.burnedLegends];
  if (memory.knownCover && !burned.includes(legend)) {
    burned.push(legend);
  }
  let patterns = dossier.patterns.map((row) => ({ locType: row.locType, uses: row.uses }));
  for (const drop of memory.compromisedDrops) {
    patterns = addLocType(patterns, localTypes(drop));
  }
  let channelKinds = dossier.channelKinds.map((row) => ({ kind: row.kind, uses: row.uses }));
  for (const channel of memory.compromisedChannels) {
    const kind = localTypes(channel);
    if (!isChannelKind(kind)) {
      continue;
    }
    channelKinds = addChannel(channelKinds, kind);
  }
  const suspected = [...dossier.suspectedAssets];
  for (const asset of memory.suspectedAssets) {
    const person = campaignPerson(asset);
    if (person !== undefined && !suspected.includes(person)) {
      suspected.push(person);
    }
  }
  const known = memory.knownCover ? 1 : 0;
  const notoriety = clamp01(
    dossier.notoriety +
      NOTORIETY_SUSPICION * cover.suspicion +
      NOTORIETY_KNOWN_COVER * known +
      NOTORIETY_SUSPECTED * memory.suspectedAssets.length,
  );
  return {
    service: dossier.service,
    notoriety,
    descriptorKnown: dossier.descriptorKnown || memory.knownCover,
    burnedLegends: burned,
    patterns,
    channelKinds,
    suspectedAssets: suspected,
    doctrineShift: mergeShift(dossier.doctrineShift, memory.doctrineShift, maxDoctrineShift),
  };
}

/** Subtract `decayPerYear` once per year. At or below zero it stays at zero. */
export function decayNotoriety(notoriety: number, years: number, decayPerYear: number): number {
  if (!(years > 0) || !(notoriety > 0)) {
    return clamp01(notoriety);
  }
  return clamp01(notoriety - decayPerYear * years);
}

/**
 * Carry-in for the next posting. Suspicion is at most half the burn threshold.
 * The tail starts when the descriptor is known and notoriety has reached
 * `tailFrom`. Each location-type pattern multiplies detection by
 * `1 + min(patternCap, 0.1·uses)`.
 */
export function dossierCarry(
  dossier: HostileDossier,
  preset: Pick<DifficultyPreset, 'coverSuspicionBurnThreshold'>,
  carry: Pick<CampaignConfig['carry'], 'coverSuspicionK' | 'tailFrom' | 'patternCap'>,
): CarryModifiers {
  const halfBurn = 0.5 * preset.coverSuspicionBurnThreshold;
  const fromNotoriety = carry.coverSuspicionK * dossier.notoriety;
  const patternDetection: Record<string, number> = {};
  for (const pattern of dossier.patterns) {
    patternDetection[pattern.locType] = 1 + Math.min(carry.patternCap, 0.1 * pattern.uses);
  }
  return {
    coverSuspicion: Math.min(halfBurn, Math.max(0, fromNotoriety)),
    tailed: dossier.descriptorKnown && dossier.notoriety >= carry.tailFrom,
    doctrineShift: dossier.doctrineShift,
    patternDetection,
  };
}

function mergeShift(
  current: Partial<HostileDoctrine>,
  incoming: Partial<HostileDoctrine>,
  cap: number,
): Partial<HostileDoctrine> {
  const next: {
    riskTolerance?: number;
    securityConsciousness?: number;
    deceptionAppetite?: number;
  } = {};
  for (const key of DOCTRINE_KEYS) {
    const left = current[key];
    const right = incoming[key];
    if (left === undefined && right === undefined) {
      continue;
    }
    const sum = (left ?? 0) + (right ?? 0);
    next[key] = Math.min(cap, Math.max(-cap, sum));
  }
  return next;
}

function addLocType(
  rows: readonly { locType: string; uses: number }[],
  locType: string,
): { locType: string; uses: number }[] {
  const next = rows.map((row) => ({ locType: row.locType, uses: row.uses }));
  const index = next.findIndex((row) => row.locType === locType);
  if (index < 0) {
    next.push({ locType, uses: 1 });
  } else {
    const row = next[index];
    if (row !== undefined) {
      next[index] = { locType: row.locType, uses: row.uses + 1 };
    }
  }
  return next;
}

function addChannel(
  rows: readonly { kind: ChannelKind; uses: number }[],
  kind: ChannelKind,
): { kind: ChannelKind; uses: number }[] {
  const next = rows.map((row) => ({ kind: row.kind, uses: row.uses }));
  const index = next.findIndex((row) => row.kind === kind);
  if (index < 0) {
    next.push({ kind, uses: 1 });
  } else {
    const row = next[index];
    if (row !== undefined) {
      next[index] = { kind: row.kind, uses: row.uses + 1 };
    }
  }
  return next;
}

function campaignPerson(id: string): `cp-${number}` | undefined {
  const bare = id.startsWith('npc:') ? id.slice(4) : id;
  const match = /^cp-(\d+)$/.exec(bare);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return `cp-${Number(match[1])}`;
}

function isChannelKind(value: string): value is ChannelKind {
  return CHANNEL_KINDS.has(value as ChannelKind);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
