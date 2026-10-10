/**
 * Ordinary life the player can read at a flat, a café, or a market.
 *
 * These lines do not change suspicion, time, or the draw streams. A phase
 * picks the sentence, the way a sector sentence does. The player's own flat,
 * café, and market are the first of each kind in the city, by id, so the
 * choice is fixed once the city is.
 */

import type { LocId } from '../model/core.js';
import type { City } from './city.js';

const FLAT_OWN = [
  "The landlady's wireless is on downstairs. She knocks only if the rent is late.",
  'The kettle takes a long time. The curtains stay half drawn.',
  "A neighbour's child runs the stairs. The flat smells of soup and coal.",
  'The stair creaks. From the window the street is ordinary, which is the point.',
] as const;

const FLAT = [
  'A rented flat: a table, a kettle, and curtains kept half drawn.',
  'The stair smells of soup and coal. Someone upstairs has a wireless on.',
  'A landlady watches the hall from a cracked door and says nothing.',
  'The room is dull on purpose. Nothing in it would survive a second glance.',
] as const;

const CAFE_OWN = [
  'Your usual table is free. The waiter brings coffee without being asked.',
  'The regulars argue over the paper. Nobody looks up when you sit down.',
  'The coffee is thin. A man at the counter sells cigarettes from a coat pocket.',
  'The evening crowd talks over the wireless. Your cup lasts as long as you need.',
] as const;

const CAFE = [
  'Cups and newspapers and the smell of weak coffee.',
  'A waiter wipes the marble and does not hurry anyone.',
  'Two regulars share a paper. The coffee is mostly chicory.',
  'Cigarettes change hands at the counter, under the saucers.',
] as const;

const MARKET_OWN = [
  'Under the apples a man has coffee and cigarettes, if you ask quietly.',
  'The stalls shout prices. A parcel could change hands and no one would notice.',
  'Black-market coffee costs more than the ration. The woman does not write it down.',
  'By afternoon the good produce is gone. The cigarettes are still under the cloth.',
] as const;

const MARKET = [
  'Rows of stalls, cabbage leaves in the gutter, and a lot of shouting.',
  'Coffee and cigarettes sit under the produce if you know who to ask.',
  'A woman weighs apples and does not look at what else changes hands.',
  'The crowd is thick enough to lose a follower and keep your parcels.',
] as const;

export interface PlayerHabits {
  readonly flat?: LocId;
  readonly cafe?: LocId;
  readonly market?: LocId;
}

function typeIs(type: string, id: string): boolean {
  return type === id || type.endsWith(`/${id}`);
}

function firstOf(city: City, id: string): LocId | undefined {
  const found = Object.values(city.locations)
    .filter((place) => typeIs(place.type, id))
    .map((place) => place.id)
    .sort();
  return found[0];
}

/** The player's flat, café, and market, or whichever of those the city has. */
export function habitsOf(city: City): PlayerHabits {
  const flat = firstOf(city, 'safehouse');
  const cafe = firstOf(city, 'kaffeehaus');
  const market = firstOf(city, 'market');
  return {
    ...(flat === undefined ? {} : { flat }),
    ...(cafe === undefined ? {} : { cafe }),
    ...(market === undefined ? {} : { market }),
  };
}

function linesFor(type: string, own: boolean): readonly string[] | undefined {
  if (typeIs(type, 'safehouse')) {
    return own ? FLAT_OWN : FLAT;
  }
  if (typeIs(type, 'kaffeehaus')) {
    return own ? CAFE_OWN : CAFE;
  }
  if (typeIs(type, 'market')) {
    return own ? MARKET_OWN : MARKET;
  }
  return undefined;
}

/** The sentence for this kind of place at this phase, when there is one. */
export function ordinaryLifeLine(type: string, phase: number, own: boolean): string | undefined {
  const lines = linesFor(type, own);
  if (lines === undefined) {
    return undefined;
  }
  const index = ((phase % lines.length) + lines.length) % lines.length;
  return lines[index];
}

/** The place description plus the ordinary-life sentence, when there is one. */
export function withOrdinaryLife(
  description: string,
  type: string,
  phase: number,
  own: boolean,
): string {
  const line = ordinaryLifeLine(type, phase, own);
  if (line === undefined) {
    return description;
  }
  return `${description} ${line}`;
}
