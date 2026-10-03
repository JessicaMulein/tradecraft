/**
 * Player-facing names for the ids inside Offered Actions. Built only from the
 * Player View (map, documents, people), so a name shows only what the player
 * already knows; anything unknown falls back to a tidied form of its id.
 */
import { getJson } from './api.js';

export const PHASE_NAMES = ['morning', 'afternoon', 'evening', 'night'] as const;

export function phaseName(p: number | string): string {
  return typeof p === 'number' ? (PHASE_NAMES[p] ?? String(p)) : p;
}

export interface Names {
  loc: Map<string, string>;
  doc: Map<string, string>;
  person: Map<string, string>;
  drop: Map<string, string>;
}

/** `loc:the-station-13` → `The station`. Last resort only. */
export function tidy(id: string): string {
  const tail = id.slice(id.lastIndexOf(':') + 1).split('/').pop() ?? id;
  const words = tail.replace(/-\d+$/, '').replace(/-/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function emptyNames(): Names {
  return { loc: new Map(), doc: new Map(), person: new Map(), drop: new Map() };
}

interface MapBody { map: { districts: { name: string; locations: { id: string; name: string }[] }[]; deadDrops: { id: string; locName: string }[] } }
interface DocsBody { documents: { documents: { id: string; title: string }[] } }
interface PeopleBody { people: { people: { id: string; label: string; aliases: string[] }[]; orgs: { id: string; name: string }[] } }

export async function loadNames(): Promise<Names> {
  const n = emptyNames();
  const [map, docs, people] = await Promise.allSettled([
    getJson<MapBody>('/api/views/map'),
    getJson<DocsBody>('/api/views/documents'),
    getJson<PeopleBody>('/api/views/people'),
  ]);
  if (map.status === 'fulfilled') {
    for (const d of map.value.map.districts) for (const l of d.locations) n.loc.set(l.id, l.name);
    for (const dd of map.value.map.deadDrops) n.drop.set(dd.id, dd.locName);
  }
  if (docs.status === 'fulfilled') for (const d of docs.value.documents.documents) n.doc.set(d.id, d.title);
  if (people.status === 'fulfilled') {
    for (const p of people.value.people.people) {
      n.person.set(p.id, p.label);
      for (const a of p.aliases) n.person.set(a, p.label);
    }
    for (const o of people.value.people.orgs) n.person.set(o.id, o.name);
  }
  return n;
}

const get = (m: Map<string, string>, id: unknown): string =>
  typeof id === 'string' ? (m.get(id) ?? tidy(id)) : String(id);

export type Act = { kind: string } & Record<string, unknown>;

/** Group heading per action kind, in display order. */
export const GROUPS: readonly (readonly [string, string])[] = [
  ['travel', 'Travel to'],
  ['talk', 'Talk to'],
  ['approach', 'Approach'],
  ['follow', 'Follow'],
  ['surveil', 'Watch'],
  ['read', 'Read'],
  ['intercept', 'Listen in'],
  ['decrypt', 'Work on intercept'],
  ['service-drop', 'Service dead drop'],
  ['arrange-meeting', 'Arrange a meeting'],
  ['pay', 'Pay'],
  ['task', 'Task an asset'],
  ['confront', 'Confront'],
  ['turn-agent', 'Pitch'],
  ['feed', 'Feed material to'],
  ['arrest', 'Arrest'],
  ['cable', 'Send a cable'],
  ['wait', 'Wait'],
];

/** Any entity: a person or organisation, else a place, else a document. */
const entity = (n: Names, id: unknown): string => {
  if (typeof id !== 'string') return String(id);
  return n.person.get(id) ?? n.loc.get(id) ?? n.drop.get(id) ?? n.doc.get(id) ?? tidy(id);
};

const phases = (n: unknown): string => `${String(n)} phase${n === 1 ? '' : 's'}`;

/** The option text inside a group (the group heading supplies the verb). */
export function optionLabel(a: Act, n: Names): string {
  switch (a.kind) {
    case 'travel': return get(n.loc, a['to']);
    case 'talk': case 'approach': case 'follow': case 'arrest': case 'pay': case 'confront':
      return get(n.person, a['npc'] ?? a['target']);
    case 'surveil': return `${get(n.loc, a['at'])} for ${phases(a['phases'])}`;
    case 'read': return get(n.doc, a['doc']);
    case 'intercept': return a['channel'] === undefined ? 'the airwaves' : tidy(String(a['channel']));
    case 'decrypt': return tidy(String(a['intercept']));
    case 'service-drop': return `at ${get(n.drop, a['drop'])}`;
    case 'arrange-meeting': {
      const slot = a['slot'] as { day: number; phase: number };
      return `${get(n.person, a['npc'])} at ${get(n.loc, a['at'])}, day ${slot.day} ${phaseName(slot.phase)}`;
    }
    case 'task': {
      const t = a['task'] as Record<string, unknown>;
      const what = t['kind'] === 'collect' ? `watch ${get(n.person, t['target'])}`
        : t['kind'] === 'introduce' ? `introduce ${get(n.person, t['target'])}`
        : t['kind'] === 'service' ? `service the drop at ${get(n.drop, t['drop'])}`
        : 'plant a story';
      return `${get(n.person, a['asset'])}: ${what}`;
    }
    case 'turn-agent': return `${get(n.person, a['npc'])} (${String(a['lever'])})`;
    case 'feed': return get(n.person, a['asset']);
    case 'cable': {
      const b = a['body'] as Record<string, unknown>;
      return b['kind'] === 'trace' ? `trace ${entity(n, b['target'])}`
        : b['kind'] === 'funds' ? 'request funds' : 'report to HQ';
    }
    case 'wait': return phases(a['phases']);
    default: return a.kind;
  }
}

export function costLabel(q: { phases: number; money: number }): string {
  const t = q.phases === 0 ? 'no time' : phases(q.phases);
  return q.money > 0 ? `${t}, ${q.money}` : t;
}
