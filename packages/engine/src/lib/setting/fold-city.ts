/**
 * Fold an {@link InstantiatedCity} into a slice {@link City}
 * (content-expansion task 3.8).
 *
 * `instantiateCity` (task 3.3) chooses a subset of a City Pack's authored
 * Districts, Locations and Routes and returns their ids. The rest of world
 * generation (orgs, Principals, Plot, comms, knowledge, brief) reads the slice
 * {@link City} shape — Districts and Locations keyed by id, a Route list, crowd
 * models per Location Type and a start month. This module builds that slice
 * `City` from the Instantiated City's selection and the authored
 * {@link CityBundle}, so a City Pack feeds the slice generators exactly as the
 * procedural Core City does.
 *
 * The authored {@link CityLocation} carries the slice Location fields (name,
 * aliases, Location Type, District, public, description, atmosphere); the hours,
 * risk and crowd model come from the Location's Location Type, read from the
 * loaded Content Set exactly as the procedural city generator reads them
 * (`foldHours`, `crowdModelOf`). Dead-drop sites are left empty here — task 5.4
 * populates them for drop-bearing types, mirroring the procedural path.
 *
 * The fold is a pure function of its inputs and draws no randomness: the
 * Instantiated City already made every random selection on the setting stream,
 * so this only maps authored records onto the slice shapes.
 */

import type { Alias } from '../model/registry.js';
import type { LocId, Phase } from '../model/core.js';
import {
  type City,
  type CrowdModel,
  type District,
  type DistrictId,
  type Location,
  type Route,
} from '../city/city.js';
import { crowdModelOf, foldHours } from '../city/generate.js';
import { districtEntityId } from './instantiate-city.js';
import type { InstantiatedCity } from './instantiate-city.js';
import type { CityBundle } from './content-set-v2.js';
import type { ContentSet, LocationType } from '@tradecraft/content';

/** The result of folding an Instantiated City: the slice {@link City} plus the public-known set. */
export interface FoldedCity {
  readonly city: City;
  /** The public Locations the player knows from game start (Requirement 21.8). */
  readonly knownLocations: readonly LocId[];
}

/** Mint the slice Location id for an authored Location, matching `instantiateCity`. */
function locationEntityId(locationId: string): LocId {
  return `loc:${locationId}` as LocId;
}

/** Build the Location-Type lookup, keyed by both namespaced and bare id. */
function locationTypeIndex(content: ContentSet): Map<string, LocationType> {
  const out = new Map<string, LocationType>();
  for (const [id, type] of content.locationTypes) {
    const typed = type as LocationType;
    out.set(id, typed);
    const slash = id.indexOf('/');
    if (slash !== -1) {
      out.set(id.slice(slash + 1), typed);
    }
  }
  return out;
}

/**
 * Fold an {@link InstantiatedCity} into a slice {@link City}
 * (content-expansion task 3.8).
 *
 * `instantiated` is the selection `instantiateCity` returned (selected District
 * and Location ids and the Routes between them); `bundle` is the authored City
 * Bundle (already year-filtered by the setting step); `content` carries the
 * Location Types the hours/risk/crowd models come from; `startMonth` is the
 * 1-based calendar month of the Start Date, so the daily weather draw reads the
 * right season.
 *
 * Only the selected Districts and Locations are folded in; a Location whose
 * Location Type the Content Set does not carry is skipped (a defensive floor —
 * the loader guarantees a City Pack's Location Types resolve).
 */
export function foldInstantiatedCity(
  instantiated: InstantiatedCity,
  bundle: CityBundle,
  content: ContentSet,
  startMonth: number,
): FoldedCity {
  const typeIndex = locationTypeIndex(content);

  // Districts: fold each selected authored District into a slice District.
  const selectedDistrictIds = new Set<DistrictId>(instantiated.districts);
  const authoredDistrictById = new Map(bundle.districts.map((d) => [d.id, d]));
  const districtMap: Record<DistrictId, District> = {};
  for (const districtEid of instantiated.districts) {
    // The slice District id is `district:<authored-id>`; recover the authored id.
    const authoredId = districtEid.slice('district:'.length);
    const authored = authoredDistrictById.get(authoredId);
    districtMap[districtEid] = {
      id: districtEid,
      name: authored?.name ?? authoredId,
      // The slice District carries a single `sector` string; the authored
      // District's sector (if any, and in period) names the occupying power.
      sector: authored?.sector?.power ?? '',
    };
  }

  // Locations: fold each selected authored Location into a slice Location, with
  // hours, risk and crowd model from its Location Type.
  const authoredLocById = new Map(bundle.locations.map((l) => [l.id, l]));
  const locations: Record<LocId, Location> = {};
  const knownLocations: LocId[] = [];
  const crowdModels: Record<string, CrowdModel> = {};
  for (const locEid of instantiated.locations) {
    const authoredId = locEid.slice('loc:'.length);
    const authored = authoredLocById.get(authoredId);
    if (authored === undefined) {
      continue;
    }
    const type = typeIndex.get(authored.type);
    if (type === undefined) {
      continue;
    }
    if (crowdModels[authored.type] === undefined) {
      crowdModels[authored.type] = crowdModelOf(type);
    }
    const districtEid = districtEntityId(authored.district);
    if (!selectedDistrictIds.has(districtEid)) {
      // A selected Location must sit in a selected District — the instantiation
      // guarantees this; skip defensively if the data disagrees.
      continue;
    }
    const aliases: Alias[] = [...authored.aliases];
    const hours = foldHours(type) as Record<Phase, boolean>;
    const location: Location = {
      id: locationEntityId(authoredId),
      name: authored.name,
      aliases,
      type: authored.type,
      district: districtEid,
      public: authored.public,
      description: authored.description,
      atmosphere: [...authored.atmosphere],
      hours,
      risk: type.baseRisk,
      deadDropSites: [],
    };
    locations[location.id] = location;
    if (location.public) {
      knownLocations.push(location.id);
    }
  }

  // Routes: the authored Routes between selected Districts, with district ids
  // mapped onto the slice `district:<id>` form.
  const routes: Route[] = instantiated.routes.map((route) => ({
    a: districtEntityId(route.a),
    b: districtEntityId(route.b),
    cost: route.cost,
  }));

  const city: City = {
    displayName: bundle.def.name,
    districts: districtMap,
    locations,
    routes,
    crowdModels,
    startMonth,
  };

  return { city, knownLocations };
}
