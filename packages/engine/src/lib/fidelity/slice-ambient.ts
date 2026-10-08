/**
 * Slice fallback. When ambient-world is not loaded, both tiers place Background
 * NPCs with the slice schedule lookup. The weekly schedules themselves stay
 * put, reconcile is the identity, and the slice emits no couplings.
 */

import type { Npc, NpcSchedule } from '../city/npc.js';
import { whereaboutsAt } from '../clock/schedules.js';
import type { LocId, NpcId, Proposition } from '../model/core.js';

import type { AmbientSimulator, AmbientStep, CityId, SpineView } from './types.js';

export interface SliceCity {
  readonly cityId: CityId;
  /** Weekly Background NPC schedules. Advance does not rewrite them. */
  readonly schedules: Readonly<Record<string, NpcSchedule>>;
  /** Where the slice schedule places each NPC at the last advanced time. */
  readonly whereabouts: Readonly<Record<string, LocId | 'absent'>>;
  readonly disclosed: readonly Proposition[];
  readonly spineStamp: string;
}

function npcsOf(schedules: Readonly<Record<string, NpcSchedule>>): Record<NpcId, Npc> {
  const npcs: Record<string, Npc> = {};
  for (const [id, schedule] of Object.entries(schedules)) {
    npcs[id] = { id, schedule } as unknown as Npc;
  }
  return npcs as Record<NpcId, Npc>;
}

function place(ambient: SliceCity, spine: SpineView): AmbientStep<SliceCity> {
  return {
    next: { ...ambient, whereabouts: whereaboutsAt(npcsOf(ambient.schedules), spine.time) },
    events: [],
  };
}

export function sliceAmbient(): AmbientSimulator<SliceCity> {
  return {
    advanceFull(_city, ambient, spine): AmbientStep<SliceCity> {
      return place(ambient, spine);
    },
    advanceCoarse(_city, ambient, spine): AmbientStep<SliceCity> {
      return place(ambient, spine);
    },
    reconcile(_city, ambient): SliceCity {
      return ambient;
    },
    couplings(): readonly [] {
      return [];
    },
  };
}

export function sliceCity(
  city: CityId,
  schedules: Readonly<Record<string, NpcSchedule>> = {},
): SliceCity {
  return { cityId: city, schedules, whereabouts: {}, disclosed: [], spineStamp: 'slice' };
}

export function sliceSpine(city: CityId): SpineView {
  return { time: { day: 0, phase: 0 }, placements: { [city]: { city, loc: 'loc:station' } } };
}
