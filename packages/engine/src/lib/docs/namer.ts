/**
 * The player-perspective {@link Namer} the Document composers render templates
 * with (design, "Template language": "the engine never stringifies a binding
 * itself, it asks the namer").
 *
 * A Document template binds slots to a mix of values: raw strings (a cable's
 * instruction text, a dossier's assessment), {@link GameTime} dates, and
 * {@link EntityId}s (the subject of a dossier, a Location a lead places someone
 * at). The namer turns each into the text the *player* should see:
 *
 * - An NPC id renders as the NPC's persona name (`persona.name`).
 * - A Location id renders as the Location's name.
 * - An Org id renders as the org's name.
 * - A {@link GameTime} renders as a plain `Day N, <phase>` form.
 * - Anything else (a string, a number) renders by plain stringification.
 *
 * The namer reads only view-safe surface — persona names, Location names, org
 * names — never a {@link import('../model/core.js').Truth} field, so a rendered
 * `body` leaks no ground truth. An unknown or unresolved entity id renders as a
 * neutral placeholder (its local id) rather than throwing, so a Document can
 * still be composed when a lead names an entity the composer does not hold a
 * record for.
 */

import {
  phaseName,
  type EntityId,
  type GameTime,
} from '../model/core.js';
import type { Namer } from '@tradecraft/content';
import type { City } from '../city/city.js';
import type { Npc, Org } from '../city/npc.js';

/** The world records the namer resolves entity ids against. */
export interface NamerContext {
  readonly city: City;
  readonly npcs: Readonly<Record<string, Npc>>;
  readonly orgs: Readonly<Record<string, Org>>;
}

/** True when a {@link GameTime}-shaped value is bound. */
function isGameTime(value: unknown): value is GameTime {
  return (
    typeof value === 'object' &&
    value !== null &&
    'day' in value &&
    'phase' in value &&
    typeof (value as { day: unknown }).day === 'number'
  );
}

/** Render a {@link GameTime} as the plain `Day N, <phase>` form the player reads. */
export function formatDate(time: GameTime): string {
  return `Day ${time.day}, ${phaseName(time.phase)}`;
}

/** The local part of a namespaced entity id (`npc:ana` -> `ana`). */
function localOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
}

/**
 * Resolve an entity id to its view-safe display name, or `undefined` if the
 * context holds no record for it.
 */
function displayNameOf(id: EntityId, ctx: NamerContext): string | undefined {
  if (id.startsWith('npc:')) {
    return ctx.npcs[id]?.persona.name;
  }
  if (id.startsWith('loc:')) {
    return ctx.city.locations[id as keyof typeof ctx.city.locations]?.name;
  }
  if (id.startsWith('org:')) {
    return ctx.orgs[id]?.name;
  }
  return undefined;
}

/**
 * Build a player-perspective {@link Namer} over the given world records. The
 * returned namer is pure: for the same context and value it always yields the
 * same text.
 */
export function playerNamer(ctx: NamerContext): Namer {
  return (value: unknown): string => {
    if (value === undefined || value === null) {
      return '';
    }
    if (isGameTime(value)) {
      return formatDate(value);
    }
    if (typeof value === 'string') {
      // An entity id resolves to its display name; otherwise it is plain text.
      if (/^(?:npc|loc|org|item|doc|chan|unk):/.test(value)) {
        const name = displayNameOf(value as EntityId, ctx);
        return name ?? localOf(value);
      }
      return value;
    }
    return String(value);
  };
}
