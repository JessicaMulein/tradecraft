/**
 * Arrest jurisdiction (multi-city task 10; Requirement 15).
 *
 * The slice evidence gate still decides whether the case is strong enough.
 * In a region, the arrest is also allowed only where the published
 * jurisdiction map names the station's own service, or a liaison service
 * whose player-known trust meets the regional preset threshold. The decision
 * reads the map, the liaison trust and the case file. It does not read the
 * truth store.
 */

import type { Proposition } from '../model/core.js';
import type { CityId, ServiceId } from '../fidelity/types.js';
import type { WorldState } from '../model/state.js';
import type { ResolverContext } from '../action/result.js';
import type { ServiceState } from './services.js';

export function servicePermitsArrest(service: ServiceState | undefined, threshold: number | undefined): boolean {
  if (service === undefined) {
    return false;
  }
  if (service.kind === 'own') {
    return true;
  }
  if (service.kind !== 'liaison' || threshold === undefined) {
    return false;
  }
  return (service.liaison?.trust ?? 0) >= threshold;
}

/** The controlling service for the player's city, with a district entry taking precedence. */
export function controllingService(state: WorldState): ServiceId | undefined {
  const region = state.region;
  const city = state.player.city;
  if (region === undefined || city === null || city === undefined) {
    return undefined;
  }
  const here = region.cities[city]?.locations[state.player.loc] ?? state.city.locations[state.player.loc];
  const district = here?.district;
  if (district !== undefined && region.jurisdiction[district] !== undefined) {
    return region.jurisdiction[district];
  }
  return region.jurisdiction[city];
}

function cityOfLoc(state: WorldState, loc: string): CityId | undefined {
  const region = state.region;
  if (region === undefined) {
    return undefined;
  }
  for (const city of Object.values(region.cities)) {
    if (city.locations[loc as keyof typeof city.locations] !== undefined) {
      return city.id;
    }
  }
  if (state.player.city !== null && state.player.city !== undefined) {
    const local = state.city.locations[loc as keyof typeof state.city.locations];
    if (local !== undefined) {
      return state.player.city;
    }
  }
  return undefined;
}

function entityOf(value: Proposition['object']): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (value.kind === 'text' && value.value.startsWith('city:')) {
    return value.value;
  }
  return undefined;
}

/** Cities named by case-file claims about the target. Sorted and unique. */
export function observedCities(
  state: WorldState,
  claims: ResolverContext['claims'],
  target: string,
): readonly string[] {
  const found = new Set<string>();
  for (const claim of Object.values(claims ?? {})) {
    if (claim.subject !== target) {
      continue;
    }
    const places = [claim.place, entityOf(claim.object)];
    for (const place of places) {
      if (place === undefined) {
        continue;
      }
      if (place.startsWith('city:')) {
        found.add(place);
        continue;
      }
      const city = cityOfLoc(state, place);
      if (city !== undefined) {
        found.add(city);
      }
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

export function jurisdictionReason(cities: readonly string[]): string {
  const listed = cities.length === 0 ? 'none' : cities.join(', ');
  return `jurisdiction forbids it; observed in ${listed}`;
}

export function jurisdictionAllows(state: WorldState): boolean {
  const region = state.region;
  if (region === undefined) {
    return true;
  }
  const id = controllingService(state);
  const service = id === undefined ? undefined : state.services?.[id];
  return servicePermitsArrest(service, region.rules?.liaisonTrustThreshold);
}
