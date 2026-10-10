/**
 * Player-facing action labels. The terminal menu and the web shell name the
 * same targets: a place, a person, a document. Anything still unknown is a
 * tidied id, never a raw `loc:` or `npc:` string.
 */

import { describeCatalogueAction } from '../street/phrasebook.js';

export interface KnownNames {
  readonly person: ReadonlyMap<string, string>;
  readonly loc: ReadonlyMap<string, string>;
  readonly doc: ReadonlyMap<string, string>;
  readonly drop: ReadonlyMap<string, string>;
  /** Intercept id or channel id → call sign and frequency. */
  readonly intercept?: ReadonlyMap<string, string>;
}

const PHASES = ['morning', 'afternoon', 'evening', 'night'] as const;

export function emptyKnownNames(): KnownNames {
  return { person: new Map(), loc: new Map(), doc: new Map(), drop: new Map() };
}

/** `loc:the-station-3` → `The station`. */
export function tidyId(id: string): string {
  const tail = id.slice(id.lastIndexOf(':') + 1).split('/').pop() ?? id;
  const words = tail.replace(/-\d+$/, '').replace(/-/g, ' ').trim();
  if (words.length === 0) return id;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function lookupName(names: KnownNames, id: string): string {
  return names.person.get(id) ?? names.loc.get(id) ?? names.doc.get(id) ?? names.drop.get(id) ?? tidyId(id);
}

function entity(names: KnownNames, id: unknown): string {
  return typeof id === 'string' ? lookupName(names, id) : String(id);
}

function phases(n: unknown): string {
  return `${String(n)} phase${n === 1 ? '' : 's'}`;
}

/**
 * The row both shells show for one offered action. Street and travel phrases
 * come from the shared catalogue describer when this function has nothing
 * more specific to say.
 */
export function labelPlayerAction(action: { readonly kind: string }, names: KnownNames): string {
  const field = action as Record<string, unknown>;
  switch (action.kind) {
    case 'travel':
      return entity(names, field['to']);
    case 'talk':
      if (field['breakOff'] === true) {
        return `break off the meeting with ${entity(names, field['npc'])}`;
      }
      return entity(names, field['npc']);
    case 'approach':
    case 'follow':
    case 'arrest':
    case 'pay':
    case 'confront':
      return entity(names, field['npc'] ?? field['target']);
    case 'surveil':
      return `${entity(names, field['at'])} for ${phases(field['phases'])}`;
    case 'read':
      return entity(names, field['doc']);
    case 'service-drop':
      return `at ${entity(names, field['drop'])}`;
    case 'arrange-meeting': {
      const slot = field['slot'] as { day: number; phase: number } | undefined;
      const when = slot === undefined ? '' : `, day ${slot.day} ${PHASES[slot.phase] ?? slot.phase}`;
      return `${entity(names, field['npc'])} at ${entity(names, field['at'])}${when}`;
    }
    case 'task': {
      const task = field['task'] as Record<string, unknown> | undefined;
      let what = 'plant a story';
      if (task?.['kind'] === 'collect') what = `watch ${entity(names, task['target'])}`;
      else if (task?.['kind'] === 'introduce') what = `introduce ${entity(names, task['target'])}`;
      else if (task?.['kind'] === 'service') what = `service the drop at ${entity(names, task['drop'])}`;
      return `${entity(names, field['asset'])}: ${what}`;
    }
    case 'turn-agent':
      return `${entity(names, field['npc'])} (${String(field['lever'])})`;
    case 'feed':
      return entity(names, field['asset']);
    case 'cable': {
      const body = field['body'] as Record<string, unknown> | undefined;
      if (body?.['kind'] === 'trace') return `trace ${entity(names, body['target'])}`;
      if (body?.['kind'] === 'funds') return 'request funds';
      return 'report to HQ';
    }
    case 'decrypt': {
      const id = String(field['intercept'] ?? '');
      return names.intercept?.get(id) ?? 'a collected message';
    }
    case 'intercept': {
      const channel = field['channel'];
      if (typeof channel !== 'string') return 'the airwaves';
      return names.intercept?.get(channel) ?? 'the airwaves';
    }
    case 'wait':
      return phases(field['phases']);
    case 'attend-duty':
      return tidyId(String(field['duty']));
    default:
      return describeCatalogueAction(action);
  }
}

/** Names the player can already see, gathered from the facade views. */
export function knownNames(api: {
  views: {
    people: () => {
      people: readonly { id: string; label: string; aliases: readonly string[] }[];
      orgs: readonly { id: string; name: string }[];
    };
    map: () => {
      districts: readonly { locations: readonly { id: string; name: string }[] }[];
      deadDrops: readonly { id: string; locName: string }[];
    };
    documents: () => { documents: readonly { id: string; title: string }[] };
    intercepts?: () => {
      intercepts: readonly { id: string; channel: string; callsign?: string; signal?: string }[];
    };
  };
}): KnownNames {
  const person = new Map<string, string>();
  const loc = new Map<string, string>();
  const doc = new Map<string, string>();
  const drop = new Map<string, string>();
  const intercept = new Map<string, string>();
  const people = api.views.people();
  for (const entry of people.people) {
    person.set(entry.id, entry.label);
    for (const alias of entry.aliases) person.set(alias, entry.label);
  }
  for (const org of people.orgs) person.set(org.id, org.name);
  for (const district of api.views.map().districts) {
    for (const place of district.locations) loc.set(place.id, place.name);
  }
  for (const site of api.views.map().deadDrops) drop.set(site.id, site.locName);
  for (const document of api.views.documents().documents) doc.set(document.id, document.title);
  const traffic = api.views.intercepts?.().intercepts ?? [];
  for (const row of traffic) {
    const label = [row.callsign, row.signal].filter((part) => part !== undefined).join(', ');
    if (label.length === 0) continue;
    intercept.set(row.id, label);
    intercept.set(row.channel, row.signal ?? row.callsign ?? label);
  }
  return { person, loc, doc, drop, intercept };
}
