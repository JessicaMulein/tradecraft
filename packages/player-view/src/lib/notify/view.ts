/**
 * The Player View slice {@link import('./notify.js').notify} reads, and the
 * player-perspective namer built from it (task 16.6; design, "Notifications":
 * "`notify(events, view)` … builds each Notification … with the player-
 * perspective `namer`").
 *
 * The design writes `notify(events: SimEvent[], view: PlayerView)`. In this
 * codebase the Player View is the view-safe surface of the
 * {@link WorldState} (the same surface the scene, "here" and Document
 * projections read): the NPC records' persona names and descriptors, the
 * player's known set, the city Locations, the Directives and the Dead Drops.
 * {@link NotifyView} is exactly that slice, so `notify` stays a pure function of
 * view-safe data and never touches the Truth Store.
 *
 * {@link notifyNamer} turns that slice into the identity-aware
 * {@link NotifyNamer} the templates render through: an NPC becomes their persona
 * name only when identified and their descriptor otherwise, a Location/Document/
 * Dead Drop becomes its view-safe label, and a Directive becomes its player-
 * facing wording. Nothing here reads a {@link import('@tradecraft/engine').Truth}
 * field.
 */

import { isIdentified, type NpcId, type WorldState } from '@tradecraft/engine';

import type { NotifyNamer } from './templates.js';

/**
 * The view-safe slice of the game `notify` reads. Supplying the whole
 * {@link WorldState} satisfies it (the facade does), but the narrow type
 * documents that `notify` reads only this surface — never the Truth Store, never
 * `apparentAllegiance`, never a hidden event's payload.
 */
export type NotifyView = Pick<
  WorldState,
  'npcs' | 'city' | 'player' | 'deadDrops' | 'station' | 'meetings'
>;

/** The local part of a namespaced entity id (`npc:ana` -> `ana`). */
function localOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
}

/**
 * Build the identity-aware player-perspective namer over a {@link NotifyView}.
 *
 * - An **NPC** id renders as the persona name when the player has identified
 *   them (it is in the known set), and as the physical descriptor otherwise, so
 *   an unidentified person is referenced only by descriptor and never by name
 *   (Requirement 39.7; Property 28).
 * - A **Location** id renders as the Location's name.
 * - A **Dead Drop** id renders by its Location (a drop has no name of its own):
 *   "the Marktplatz" rather than the raw `drop:` id.
 * - A **Directive** id renders as the Directive's player-facing wording.
 * - Any other view-safe id falls back to its local id — a neutral placeholder,
 *   never a Truth read.
 */
export function notifyNamer(view: NotifyView): NotifyNamer {
  return (id: string): string => {
    if (id.startsWith('npc:')) {
      const npc = id as NpcId;
      const record = view.npcs[npc];
      if (record === undefined) {
        return localOf(id);
      }
      return isIdentified(view as WorldState, npc)
        ? record.persona.name
        : record.descriptor.summary;
    }
    if (id.startsWith('loc:')) {
      return view.city.locations[id as keyof typeof view.city.locations]?.name ?? localOf(id);
    }
    if (id.startsWith('drop:')) {
      const drop = view.deadDrops[id as keyof typeof view.deadDrops];
      if (drop === undefined) {
        return localOf(id);
      }
      const loc = view.city.locations[drop.loc];
      return loc?.name ?? localOf(drop.loc);
    }
    // A Directive id is a plain string keyed on the Station's directive list.
    const directive = view.station.directives.find((d) => d.id === id);
    if (directive !== undefined) {
      return directive.text;
    }
    return localOf(id);
  };
}
