/**
 * Cover duties (ambient-world Req 17). Each week draws two to four duties
 * that match the player's cover. Attendance and misses move standing here and
 * Cover Suspicion through the hook gateway. A low standing multiplies the
 * suspicion a high-risk visit already raises.
 */

import { asTruth, revealTruth, type LocId, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { ActionQuote } from '../action/result.js';
import { createPrng } from '../prng/prng.js';

import { ambientCatalogue } from './catalogue.js';
import { applyHook } from './hooks.js';
import { emptyLife, isPrincipalNpc } from './life.js';
import { ambientKeySeed } from './streams.js';
import type { CoverDuty, CoverMessage, DutyAlert, LifeState } from './state.js';

export const LOW_STANDING = 0.3;
export const LOW_STANDING_MULTIPLIER = 1.5;

export interface DutyTemplate {
  readonly id: string;
  readonly name: string;
  readonly phases: 1 | 2;
  readonly standing: number;
  readonly suspicion: number;
  readonly mandatory: boolean;
  readonly identities: readonly string[];
}

// Same amounts as packs/ambient/cover-duties. Suspicion stays under the
// tail-start floor across a season of misses; standing is what a miss costs.
const BUILTIN_DUTIES: readonly DutyTemplate[] = [
  { id: 'office-hours', name: 'Office hours', phases: 1, standing: 0.05, suspicion: 0.01, mandatory: true, identities: ['*'] },
  { id: 'desk-work', name: 'Desk work', phases: 1, standing: 0.04, suspicion: 0.01, mandatory: true, identities: ['*'] },
  { id: 'errand', name: 'An errand for the office', phases: 1, standing: 0.03, suspicion: 0.005, mandatory: false, identities: ['*'] },
  { id: 'briefing', name: 'A morning briefing', phases: 2, standing: 0.06, suspicion: 0.015, mandatory: true, identities: ['*'] },
];

function dutyTemplates(): readonly DutyTemplate[] {
  const loaded = ambientCatalogue().duties;
  return loaded.length === 0 ? BUILTIN_DUTIES : loaded;
}

function matchesCover(template: DutyTemplate, coverId: string): boolean {
  if (template.identities.includes('*') || template.identities.includes(coverId)) {
    return true;
  }
  return coverId.length > 0 && template.id.includes(coverId);
}

/** True when moving this person at this slot would rewrite an anchor. */
export function keepsAnchor(
  anchors: readonly string[],
  npc: string,
  weekday: number,
  phase: number,
): boolean {
  const prefix = `${npc}|${weekday}|${phase}|`;
  return anchors.some((anchor) => anchor.startsWith(prefix));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function beforeSlot(time: { day: number; phase: number }, slot: { day: number; phase: number }): boolean {
  return time.day < slot.day || (time.day === slot.day && time.phase < slot.phase);
}

function atSlot(time: { day: number; phase: number }, slot: { day: number; phase: number }): boolean {
  return time.day === slot.day && time.phase === slot.phase;
}

/** The slot, plus the following phase, so a one-phase walk still arrives for the shift. */
function dutyOpen(
  time: { day: number; phase: number },
  slot: { day: number; phase: number },
): boolean {
  if (atSlot(time, slot)) {
    return true;
  }
  if (slot.phase < 3) {
    return time.day === slot.day && time.phase === slot.phase + 1;
  }
  return time.day === slot.day + 1 && time.phase === 0;
}

function onePhaseBefore(
  slot: { day: number; phase: number },
): { day: number; phase: number } {
  if (slot.phase <= 0) {
    return { day: slot.day - 1, phase: 3 };
  }
  return { day: slot.day, phase: slot.phase - 1 };
}

function sameAlert(alerts: readonly DutyAlert[], duty: string, kind: DutyAlert['kind']): boolean {
  return alerts.some((alert) => alert.duty === duty && alert.kind === kind);
}

/**
 * High-risk visits raise Cover Suspicion. Below a standing of 0.3 that rise
 * is multiplied. A game with ambient off passes no standing and is unchanged.
 */
export function scaleHighRiskSuspicion(
  delta: number,
  risk: number,
  standing: number | undefined,
): number {
  if (standing === undefined || standing >= LOW_STANDING || delta <= 0 || risk <= 0) {
    return delta;
  }
  return delta * LOW_STANDING_MULTIPLIER;
}

function attendeesFor(
  world: WorldState,
  loc: LocId,
  weekday: number,
  phase: number,
): { readonly ids: NpcId[]; readonly deviations: Readonly<Record<NpcId, LifeState>> } {
  const ambient = world.ambient;
  const ids: NpcId[] = [];
  const deviations: Record<NpcId, LifeState> = {};
  if (ambient === undefined) {
    return { ids, deviations };
  }
  for (const id of Object.keys(world.npcs ?? {}).sort()) {
    const npc = world.npcs[id as NpcId];
    if (npc === undefined || npc.role === 'cell' || npc.role.startsWith('cell')) {
      continue;
    }
    if (ambient.multiCity === true && isPrincipalNpc(world, id)) {
      continue;
    }
    const org = npc.org === undefined ? undefined : world.orgs?.[npc.org];
    if (org?.kind === 'cell') {
      continue;
    }
    ids.push(id as NpcId);
    if (ids.length >= 3) {
      break;
    }
  }
  for (const id of ids) {
    if (keepsAnchor(ambient.gate.anchors, id, weekday, phase)) {
      continue;
    }
    const prior = ambient.life[id] ?? deviations[id] ?? emptyLife();
    deviations[id] = {
      ...prior,
      deviations: [
        ...prior.deviations,
        { untilDay: weekday + 7, weekday, phase: phase as 0 | 1 | 2 | 3, loc },
      ],
    };
  }
  return { ids, deviations };
}

/** On the first day of a week, draw two to four duties for the cover identity. */
export function stepCover(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined || world.time.day % 7 !== 0) {
    return world;
  }
  const week = Math.floor(world.time.day / 7);
  const already = ambient.duties.some((duty) => Math.floor(duty.slot.day / 7) === week);
  if (already) {
    return alertDue(world);
  }
  const coverId = world.player?.cover?.id ?? '';
  const matching = dutyTemplates().filter((template) => matchesCover(template, coverId));
  if (matching.length === 0) {
    return world;
  }
  const seed = world.meta?.seed ?? 'ambient';
  const rng = createPrng(ambientKeySeed(seed, 'cover', `week:${week}`, world.time.day));
  const count = rng.int(2, Math.min(4, matching.length));
  const picked = rng.shuffle([...matching]).slice(0, count);
  const loc = dutyLoc(world);
  let life = { ...ambient.life };
  const duties = [...ambient.duties];
  for (const template of picked) {
    const offset = rng.int(0, 6);
    const phase: 1 | 2 = rng.bool() ? 1 : 2;
    const day = world.time.day + offset;
    const weekday = day % 7;
    const placed = attendeesFor(
      { ...world, ambient: { ...ambient, life } },
      loc,
      weekday,
      phase,
    );
    life = { ...life, ...placed.deviations };
    duties.push({
      id: `duty:${template.id}:${day}:${phase}`,
      template: template.id,
      loc,
      slot: { day, phase },
      phases: template.phases,
      mandatory: template.mandatory,
      standingGain: template.standing,
      suspicionDelta: template.suspicion,
      attendees: placed.ids,
      status: 'pending',
    });
  }
  return alertDue({
    ...world,
    ambient: { ...ambient, duties, life },
  });
}

/** A cover keeps its shift where that cover fits, in the district the player is already in when one is there. */
function dutyLoc(world: WorldState): LocId {
  const keys = Object.keys(world.city?.locations ?? {}).sort();
  const fallback = (keys[0] as LocId | undefined) ?? world.player.loc;
  const types = world.player.cover?.fitLocationTypes ?? [];
  if (types.length === 0) {
    return fallback;
  }
  const wanted = new Set<string>(types);
  const fitting = Object.values(world.city.locations).filter((loc) => typeFits(loc.type, wanted));
  if (fitting.length === 0) {
    return fallback;
  }
  const home = world.city.locations[world.player.loc]?.district;
  const nearby = home === undefined ? [] : fitting.filter((loc) => loc.district === home);
  const pool = nearby.length > 0 ? nearby : fitting;
  const ranked = [...pool].sort((a, b) => {
    if (a.risk !== b.risk) {
      return a.risk - b.risk;
    }
    if (a.id < b.id) {
      return -1;
    }
    if (a.id > b.id) {
      return 1;
    }
    return 0;
  });
  return ranked[0]?.id ?? fallback;
}

function typeFits(locType: string, wanted: ReadonlySet<string>): boolean {
  if (wanted.has(locType)) {
    return true;
  }
  const slash = locType.lastIndexOf('/');
  return slash >= 0 && wanted.has(locType.slice(slash + 1));
}

function alertDue(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  const alerts = [...(ambient.dutyAlerts ?? [])];
  let changed = false;
  for (const duty of ambient.duties) {
    if (duty.status !== 'pending' || sameAlert(alerts, duty.id, 'due')) {
      continue;
    }
    const when = onePhaseBefore(duty.slot);
    const time = world.time;
    const due =
      (time.day === when.day && time.phase === when.phase) ||
      (time.day === duty.slot.day && time.phase === 0 && duty.slot.phase === 1 && world.time.day % 7 === 0);
    if (!due) {
      continue;
    }
    alerts.push({ duty: duty.id, kind: 'due', day: time.day, phase: time.phase });
    changed = true;
  }
  if (!changed) {
    return world;
  }
  return { ...world, ambient: { ...ambient, dutyAlerts: alerts } };
}

function missDuty(world: WorldState, duty: CoverDuty): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  const standing = clamp01(revealTruth(ambient.coverStanding) - duty.standingGain);
  const duties = ambient.duties.map((item) =>
    item.id === duty.id ? { ...item, status: 'missed' as const } : item,
  );
  const alerts: DutyAlert[] = [
    ...(ambient.dutyAlerts ?? []),
    { duty: duty.id, kind: 'missed', day: world.time.day, phase: world.time.phase },
  ];
  const messages: CoverMessage[] = [
    ...(ambient.coverMessages ?? []),
    {
      day: world.time.day,
      phase: world.time.phase,
      text: `Your employer notes that you missed ${duty.template}.`,
    },
  ];
  const updated: WorldState = {
    ...world,
    ambient: {
      ...ambient,
      duties,
      coverStanding: asTruth(standing),
      dutyAlerts: alerts,
      coverMessages: messages,
    },
  };
  return applyHook(updated, {
    kind: 'cover-suspicion-delta',
    amount: duty.suspicionDelta,
  }).next;
}

/** Mark a pending duty missed once its slot has passed, and alert the phase before. */
export function settleDuties(world: WorldState): WorldState {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return world;
  }
  let next = alertDue(world);
  for (const duty of next.ambient?.duties ?? []) {
    if (duty.status !== 'pending' || !duty.mandatory) {
      continue;
    }
    if (beforeSlot(next.time, duty.slot) || dutyOpen(next.time, duty.slot)) {
      continue;
    }
    next = missDuty(next, duty);
  }
  return next;
}

export function quoteAttendDuty(state: WorldState, dutyId: string): ActionQuote {
  const duty = state.ambient?.duties.find((item) => item.id === dutyId);
  if (duty === undefined || duty.status !== 'pending') {
    return { allowed: false, reason: `no pending duty ${dutyId}`, phases: 0, money: 0 };
  }
  if (state.player.loc !== duty.loc) {
    return {
      allowed: false,
      reason: `${duty.template} is kept at ${duty.loc}`,
      phases: duty.phases,
      money: 0,
    };
  }
  if (!dutyOpen(state.time, duty.slot)) {
    return {
      allowed: false,
      reason: `${duty.template} is at day ${duty.slot.day} phase ${duty.slot.phase}`,
      phases: duty.phases,
      money: 0,
    };
  }
  return { allowed: true, phases: duty.phases, money: 0 };
}

export function attendDutyLocation(state: WorldState, dutyId: string): LocId | undefined {
  return state.ambient?.duties.find((item) => item.id === dutyId)?.loc;
}

/** Charge the duty, raise standing, and lower suspicion through the hook. */
export function resolveAttendDuty(
  state: WorldState,
  dutyId: string,
): { readonly next: WorldState; readonly lines: readonly string[] } {
  const ambient = state.ambient;
  const duty = ambient?.duties.find((item) => item.id === dutyId);
  if (ambient === undefined || duty === undefined) {
    return { next: state, lines: [] };
  }
  const standing = clamp01(revealTruth(ambient.coverStanding) + duty.standingGain);
  const duties = ambient.duties.map((item) =>
    item.id === duty.id ? { ...item, status: 'attended' as const } : item,
  );
  const updated: WorldState = {
    ...state,
    ambient: { ...ambient, duties, coverStanding: asTruth(standing) },
  };
  const hooked = applyHook(updated, {
    kind: 'cover-suspicion-delta',
    amount: -duty.suspicionDelta,
  });
  const names = duty.attendees.length === 0 ? 'no one else' : duty.attendees.join(', ');
  return {
    next: hooked.next,
    lines: [`You keep ${duty.template} at ${duty.loc}. Present: ${names}.`],
  };
}
