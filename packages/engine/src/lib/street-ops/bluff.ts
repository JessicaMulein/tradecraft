/**
 * Bluff engine and story ledger (street-ops task 10).
 *
 * A selected answer and an extracted proposition list decide the outcome.
 * The guard's spoken line is not an input. The same claims and the same draw
 * always give the same result.
 */

import type { GameTime } from '../model/core.js';

import type { StoryEntry } from './state.js';

export const PROTECTED_SLOTS = ['origin', 'purpose', 'occupation', 'declared-passengers'] as const;

export interface StoryTemplate {
  readonly id: string;
  readonly slots: readonly string[];
  readonly fits: readonly string[];
  readonly followUps: readonly string[];
}

export interface SlotProposition {
  readonly slot: string;
  readonly value: string;
}

export interface Contradiction {
  readonly slot: string;
  readonly previous: string;
  readonly claimed: string;
  readonly service: string;
}

export interface BluffRequest {
  readonly template: StoryTemplate;
  readonly claims: readonly SlotProposition[];
  readonly evasive: boolean;
  readonly identity: string;
  readonly service: string;
  readonly sharedWith: readonly string[];
  readonly place: string;
  readonly at: GameTime;
  readonly windowDays: number;
  readonly ledger: Readonly<Record<string, readonly StoryEntry[]>>;
  readonly tags: readonly string[];
  readonly paperKinds: readonly string[];
  readonly truth: {
    readonly origin?: string;
    readonly destination?: string;
    readonly occupation?: string;
    readonly passengers: readonly string[];
    readonly cargo: readonly string[];
  };
  readonly composure: number;
  readonly failureSuspicion: number;
}

export interface BluffResult {
  readonly passed: boolean;
  readonly plausibility: number;
  readonly suspicionDelta: number;
  readonly contradictions: readonly Contradiction[];
  readonly wasLie: boolean;
  readonly facts: readonly string[];
  readonly entry: StoryEntry;
  readonly services: readonly string[];
}

const WORD: Readonly<Record<string, string>> = {
  from: 'origin',
  origin: 'origin',
  to: 'destination',
  destination: 'destination',
  for: 'purpose',
  purpose: 'purpose',
  as: 'occupation',
  occupation: 'occupation',
  with: 'declared-passengers',
  passengers: 'declared-passengers',
};

export function normaliseClaim(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function servicesFor(service: string, sharedWith: readonly string[]): string[] {
  const services = [service];
  for (const other of sharedWith) {
    if (!services.includes(other)) services.push(other);
  }
  return services;
}

export function templateFits(template: StoryTemplate, tags: readonly string[], paperKinds: readonly string[]): boolean {
  if (template.fits.length === 0) return true;
  for (const fit of template.fits) {
    if (tags.includes(fit)) return true;
    if (fit === 'papers' && paperKinds.length > 0) return true;
  }
  return false;
}

/** File a typed answer as slot propositions. Nothing parsed is an evasive answer. */
export function extractSlotClaims(text: string, allowed: readonly string[]): SlotProposition[] | undefined {
  const open = new Set(allowed);
  const found: SlotProposition[] = [];
  for (const part of text.split(/[.;\n]/)) {
    const trimmed = part.trim();
    const explicit = /^([a-z][a-z-]*)\s*[:=]\s*(.+)$/i.exec(trimmed);
    if (explicit !== null) {
      const slot = explicit[1]?.toLowerCase() ?? '';
      const value = explicit[2] ?? '';
      if (open.has(slot) && value.trim() !== '') found.push({ slot, value: normaliseClaim(value) });
      continue;
    }
    const loose = /^(from|to|for|as|with)\s+(.+)$/i.exec(trimmed);
    if (loose === null) continue;
    const slot = WORD[loose[1]?.toLowerCase() ?? ''] ?? '';
    const value = loose[2] ?? '';
    if (open.has(slot) && value.trim() !== '') found.push({ slot, value: normaliseClaim(value) });
  }
  if (found.length === 0) return undefined;
  return found;
}

export function claimsFor(input: {
  readonly template: StoryTemplate;
  readonly street: string;
  readonly origin?: string;
  readonly destination?: string;
  readonly occupation?: string;
  readonly passengers?: string;
  readonly text?: string;
  readonly propositions?: readonly SlotProposition[];
}): { readonly claims: readonly SlotProposition[]; readonly evasive: boolean } {
  if (input.propositions !== undefined) {
    if (input.propositions.length === 0) return { claims: [], evasive: true };
    return { claims: input.propositions.map((claim) => ({ slot: claim.slot, value: normaliseClaim(claim.value) })), evasive: false };
  }
  if (input.text !== undefined) {
    const extracted = extractSlotClaims(input.text, [...input.template.slots, ...PROTECTED_SLOTS, 'destination', 'document']);
    if (extracted === undefined) return { claims: [], evasive: true };
    return { claims: extracted, evasive: false };
  }
  const claims: SlotProposition[] = [{ slot: 'purpose', value: normaliseClaim(input.template.id) }];
  claims.push({ slot: 'origin', value: normaliseClaim(input.origin ?? input.street) });
  if (input.destination !== undefined && input.destination !== '') claims.push({ slot: 'destination', value: normaliseClaim(input.destination) });
  if (input.occupation !== undefined && input.occupation !== '') claims.push({ slot: 'occupation', value: normaliseClaim(input.occupation) });
  if (input.passengers !== undefined && input.passengers !== '') {
    claims.push({ slot: 'declared-passengers', value: normaliseClaim(input.passengers) });
  }
  return { claims, evasive: false };
}

function slotsOf(claims: readonly SlotProposition[]): Record<string, string> {
  const slots: Record<string, string> = {};
  for (const claim of claims) slots[claim.slot] = normaliseClaim(claim.value);
  return slots;
}

function withinWindow(told: number, day: number, windowDays: number): boolean {
  return day >= told && day - told <= windowDays;
}

export function findContradictions(input: {
  readonly identity: string;
  readonly service: string;
  readonly sharedWith: readonly string[];
  readonly day: number;
  readonly windowDays: number;
  readonly slots: Readonly<Record<string, string>>;
  readonly ledger: Readonly<Record<string, readonly StoryEntry[]>>;
}): Contradiction[] {
  const found: Contradiction[] = [];
  const seen = new Set<string>();
  for (const service of servicesFor(input.service, input.sharedWith)) {
    for (const entry of input.ledger[service] ?? []) {
      const key = `${entry.service}:${entry.identity}:${entry.at.day}:${entry.at.phase}:${entry.template}:${JSON.stringify(entry.slots)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (entry.identity !== input.identity) continue;
      if (!withinWindow(entry.at.day, input.day, input.windowDays)) continue;
      for (const slot of PROTECTED_SLOTS) {
        const previous = entry.slots[slot];
        const claimed = input.slots[slot];
        if (previous === undefined || claimed === undefined) continue;
        if (normaliseClaim(previous) === normaliseClaim(claimed)) continue;
        found.push({ slot, previous, claimed, service: entry.service });
      }
    }
  }
  return found;
}

function listed(value: string): string[] {
  return value.split(',').map((part) => normaliseClaim(part)).filter((part) => part !== '');
}

function truthValue(slot: string, truth: BluffRequest['truth']): string | undefined {
  if (slot === 'origin') return truth.origin;
  if (slot === 'destination') return truth.destination;
  if (slot === 'occupation') return truth.occupation;
  return undefined;
}

export function fileStory(
  ledger: Readonly<Record<string, readonly StoryEntry[]>>,
  entry: StoryEntry,
  services: readonly string[],
): Record<string, readonly StoryEntry[]> {
  const next: Record<string, readonly StoryEntry[]> = { ...ledger };
  for (const service of services) {
    next[service] = [...(next[service] ?? []), entry];
  }
  return next;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Decide the bluff. `draw` is in `[0, 1)`. It is used only when the story
 * agrees with the papers, the car, and the ledger.
 */
export function assessBluff(request: BluffRequest, draw: number): BluffResult {
  const slots = slotsOf(request.claims);
  const services = servicesFor(request.service, request.sharedWith);
  const contradictions = request.evasive
    ? []
    : findContradictions({
        identity: request.identity,
        service: request.service,
        sharedWith: request.sharedWith,
        day: request.at.day,
        windowDays: request.windowDays,
        slots,
        ledger: request.ledger,
      });
  const needsPapers = request.template.fits.includes('papers') || slots.document !== undefined;
  const papersFail = needsPapers && request.paperKinds.length === 0;
  let contentsFail = false;
  let truthFail = false;
  if (!request.evasive) {
    const claimedPassengers = slots['declared-passengers'];
    if (claimedPassengers !== undefined) {
      const present = new Set(request.truth.passengers.map((passenger) => normaliseClaim(passenger)));
      for (const name of listed(claimedPassengers)) {
        if (!present.has(name)) contentsFail = true;
      }
    }
    const claimedCargo = slots.cargo;
    if (claimedCargo !== undefined) {
      const present = new Set(request.truth.cargo.map((item) => normaliseClaim(item)));
      for (const name of listed(claimedCargo)) {
        if (!present.has(name)) contentsFail = true;
      }
    }
    for (const slot of ['origin', 'destination', 'occupation'] as const) {
      const claimed = slots[slot];
      const actual = truthValue(slot, request.truth);
      if (claimed === undefined || actual === undefined) continue;
      if (normaliseClaim(claimed) !== normaliseClaim(actual)) truthFail = true;
    }
  }
  const coverFit = request.template.fits.length === 0 || request.template.fits.some((fit) => request.tags.includes(fit));
  let plausibility = 0.5;
  if (coverFit) plausibility += 0.25;
  if (!needsPapers || request.paperKinds.length > 0) plausibility += 0.15;
  plausibility = clamp01(plausibility);
  const hardFail = request.evasive || contradictions.length > 0 || papersFail || contentsFail || truthFail;
  const chance = clamp01(plausibility * (0.5 + 0.5 * clamp01(request.composure)));
  const passed = !hardFail && draw < chance;
  let suspicionDelta = 0;
  if (request.evasive) suspicionDelta = request.failureSuspicion * 0.75;
  else if (hardFail) suspicionDelta = request.failureSuspicion;
  else if (!passed) suspicionDelta = request.failureSuspicion * 0.5;
  const wasLie = contradictions.length > 0 || contentsFail || truthFail;
  const facts: string[] = [];
  if (request.evasive) facts.push('You do not answer.');
  else if (contradictions.length > 0) facts.push('The story does not match what you said before.');
  else if (papersFail) facts.push('The papers do not match the story.');
  else if (contentsFail) facts.push('The story does not match what is in the car.');
  else if (truthFail) facts.push('The story does not match where you are.');
  else if (!passed) facts.push('The guard is not convinced.');
  else facts.push('The guard accepts the story.');
  const follow = request.template.followUps[0];
  if (passed && follow !== undefined) facts.push(`They ask about ${follow.replace(/-/g, ' ')}.`);
  const entry: StoryEntry = {
    template: request.template.id,
    at: request.at,
    wasLie,
    identity: request.identity,
    service: request.service,
    place: request.place,
    slots,
  };
  return { passed, plausibility, suspicionDelta, contradictions, wasLie, facts, entry, services };
}
