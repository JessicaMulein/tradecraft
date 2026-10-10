/**
 * How occupied Vienna reads once you are in a sector, or crossing into one.
 *
 * The district's risk number already raises cover suspicion. These lines do
 * not. They are the patrol, the papers check and the car the player can read,
 * chosen from the sector and the phase, with no draw. A night in the Soviet
 * sector is the abduction risk made visible: the car slows, and the men in it
 * do not get out. Nothing here removes the player or ends the game.
 */

import type { LocId } from '../model/core.js';
import type { City } from './city.js';

const SOVIET_STREET = [
  'A foot patrol works this street. They look at faces more than at the shops.',
  'At the corner a soldier checks papers against a list. People keep their eyes on the pavement.',
  'A dark car has passed twice. It does not stop.',
  'The street is almost empty. A car slows beside the pavement, then drives on.',
] as const;

/** The occupying sector of a location, when the city still has that district. */
export function districtSector(city: City, loc: LocId): string | undefined {
  const place = city.locations[loc];
  if (place === undefined) {
    return undefined;
  }
  return city.districts[place.district]?.sector;
}

/**
 * The sentence a scene in this sector carries at this phase. Only the Soviet
 * sector changes the street; the other sectors keep the place's own description.
 */
export function occupationSceneLine(sector: string | undefined, phase: number): string | undefined {
  if (sector !== 'soviet') {
    return undefined;
  }
  return SOVIET_STREET[phase];
}

/** The place description plus the sector sentence, when there is one. */
export function withOccupation(
  description: string,
  sector: string | undefined,
  phase: number,
): string {
  const line = occupationSceneLine(sector, phase);
  if (line === undefined) {
    return description;
  }
  return `${description} ${line}`;
}

/**
 * Vienna sat inside the Soviet zone of Lower Austria. The sentence is the map's
 * reminder. It is not a fact about a person, and it is not drawn.
 */
export const VIENNA_SURROUND =
  'The city sits inside the Soviet zone of Lower Austria. Every road out crosses a Soviet checkpoint.';

/** The map note for an occupied Vienna, and nothing for any other city. */
export function viennaSurround(displayName: string): string | undefined {
  if (displayName !== 'Vienna') {
    return undefined;
  }
  return VIENNA_SURROUND;
}

/**
 * The fact line for arriving in Mariahilf, where the west road and the
 * Westbahn leave the city and keep running through the Soviet zone.
 */
export function westRoadLine(
  displayName: string,
  districtId: string | undefined,
): string | undefined {
  if (displayName !== 'Vienna' || districtId === undefined) {
    return undefined;
  }
  if (!districtId.endsWith('mariahilf')) {
    return undefined;
  }
  return 'West of here the road and the railway leave the city and run on through the Soviet zone.';
}

/**
 * The fact line for crossing into or out of the Soviet sector inside the city.
 * Daytime papers are glanced at. After evening the pole stays down, and the
 * car at the line is the close call. Leaving reminds you that the roads out of
 * the city still run through the Soviet zone.
 */
export function sectorCheckpointLine(
  fromSector: string | undefined,
  toSector: string | undefined,
  phase: number,
): string | undefined {
  if (fromSector === undefined || toSector === undefined || fromSector === toSector) {
    return undefined;
  }
  if (toSector === 'soviet') {
    if (phase >= 2) {
      return 'The striped pole stays down at the sector line. They keep your papers a long time. A car is parked with its engine running, and the men in it do not get out.';
    }
    return 'The striped pole is down at the sector line. A soldier reads your papers and waves you through.';
  }
  if (fromSector === 'soviet') {
    return 'The pole lifts. Behind you the Soviet sector is still there, and the roads out of the city run through it.';
  }
  return undefined;
}
