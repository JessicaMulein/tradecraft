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
  /** Intercept id or channel id → call sign and frequency. */
  intercept: Map<string, string>;
}

/** `loc:the-station-13` → `The station`. Last resort only. */
export function tidy(id: string): string {
  const tail = id.slice(id.lastIndexOf(':') + 1).split('/').pop() ?? id;
  const words = tail.replace(/-\d+$/, '').replace(/-/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function emptyNames(): Names {
  return { loc: new Map(), doc: new Map(), person: new Map(), drop: new Map(), intercept: new Map() };
}

interface MapBody { map: { districts: { name: string; locations: { id: string; name: string }[] }[]; deadDrops: { id: string; locName: string }[] } }
interface DocsBody { documents: { documents: { id: string; title: string }[] } }
interface PeopleBody { people: { people: { id: string; label: string; aliases: string[] }[]; orgs: { id: string; name: string }[] } }
interface TrafficBody { intercepts: { intercepts: { id: string; channel: string; callsign?: string; signal?: string }[] } }

export async function loadNames(): Promise<Names> {
  const n = emptyNames();
  const [map, docs, people, traffic] = await Promise.allSettled([
    getJson<MapBody>('/api/views/map'),
    getJson<DocsBody>('/api/views/documents'),
    getJson<PeopleBody>('/api/views/people'),
    getJson<TrafficBody>('/api/views/intercepts'),
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
  if (traffic.status === 'fulfilled') {
    for (const row of traffic.value.intercepts.intercepts) {
      const label = [row.callsign, row.signal].filter((part) => part !== undefined).join(', ');
      if (label.length === 0) continue;
      n.intercept.set(row.id, label);
      n.intercept.set(row.channel, row.signal ?? row.callsign ?? label);
    }
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
  ['attend-duty', 'Attend to cover'],
  ['street-ops.drive', 'Drive'],
  ['street-ops.turn', 'Turn'],
  ['street-ops.park', 'Park'],
  ['street-ops.look', 'Look'],
  ['street-ops.maneuver', 'Maneuver'],
  ['street-ops.pickup', 'Passenger'],
  ['street-ops.dropoff', 'Passenger'],
  ['street-ops.bluff', 'Story'],
  ['street-ops.read-map', 'Map'],
  ['street-ops.navigate', 'Navigation'],
  ['street-ops.hire', 'Hire'],
  ['street-ops.return', 'Return'],
  ['street-ops.swap-plate', 'Plates'],
  ['depart', 'Depart'],
  ['request-papers', 'Papers'],
  ['apply-visa', 'Visa'],
  ['liaison-request', 'Liaison'],
  ['liaison-share', 'Liaison'],
  ['exfiltrate', 'Exfiltrate'],
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
    case 'talk':
      if (a['breakOff'] === true) return `break off the meeting with ${get(n.person, a['npc'])}`;
      return get(n.person, a['npc']);
    case 'approach': case 'follow': case 'arrest': case 'pay': case 'confront':
      return get(n.person, a['npc'] ?? a['target']);
    case 'surveil': return `${get(n.loc, a['at'])} for ${phases(a['phases'])}`;
    case 'read': return get(n.doc, a['doc']);
    case 'intercept': {
      const channel = a['channel'];
      if (typeof channel !== 'string') return 'the airwaves';
      return n.intercept.get(channel) ?? 'the airwaves';
    }
    case 'decrypt': return n.intercept.get(String(a['intercept'])) ?? 'a collected message';
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
    case 'attend-duty': return tidy(String(a['duty']));
    case 'street-ops.drive': {
      const vehicle = a['vehicle'];
      return typeof vehicle === 'string' ? `drive the ${tidy(vehicle)}` : 'drive';
    }
    case 'street-ops.turn': {
      const relative = typeof a['relative'] === 'string' ? a['relative'] : 'turn';
      const street = a['street'];
      return typeof street === 'string' ? `${relative} onto ${street}` : relative;
    }
    case 'street-ops.park': return 'park';
    case 'street-ops.look': return a['mode'] === 'check-mirror' ? 'check the mirror' : 'look around';
    case 'street-ops.maneuver': {
      const id = a['id'];
      return typeof id === 'string' ? `take the ${tidy(id)}` : 'maneuver';
    }
    case 'street-ops.pickup': {
      const who = typeof a['npc'] === 'string' ? tidy(a['npc']) : 'a passenger';
      return a['mode'] === 'concealed' ? `hide ${who}` : `take ${who} in the car`;
    }
    case 'street-ops.dropoff': {
      const who = typeof a['npc'] === 'string' ? tidy(a['npc']) : 'a passenger';
      return `let ${who} out`;
    }
    case 'street-ops.bluff': {
      const template = a['template'];
      return typeof template === 'string' ? `tell the ${tidy(template)} story` : 'give a story';
    }
    case 'street-ops.read-map': return 'read the map';
    case 'street-ops.navigate': return 'consult a navigation aid';
    case 'street-ops.hire': return typeof a['vehicle'] === 'string' ? `hire the ${tidy(a['vehicle'])}` : 'hire a car';
    case 'street-ops.return': return typeof a['vehicle'] === 'string' ? `return the ${tidy(a['vehicle'])}` : 'return a car';
    case 'street-ops.swap-plate': return 'change the plates';
    case 'depart': return 'depart';
    case 'request-papers': return 'request papers';
    case 'apply-visa': return typeof a['country'] === 'string' ? `apply for a visa to ${tidy(a['country'])}` : 'apply for a visa';
    case 'liaison-request': return 'ask a liaison';
    case 'liaison-share': return 'share with a liaison';
    case 'exfiltrate': return 'exfiltrate an asset';
    default: return a.kind;
  }
}

const SPOKEN: Readonly<Record<string, string>> = {
  MEMBER_OF: 'belongs to',
  WORKS_FOR: 'works for',
  REPORTS_TO: 'reports to',
  MEETS_AT: 'meets',
  LOCATED_AT: 'is seen at',
  TRAVELS_TO: 'travels to',
  SCHEDULED_FOR: 'is expected',
  PLANS: 'is planning',
  TARGETS: 'is targeting',
  CARRIES: 'is carrying',
  SUPPLIES: 'supplies',
  USES_CHANNEL: 'uses the channel',
  KNOWS: 'knows',
  SUSPECTS: 'suspects',
  IS_ALIAS_OF: 'is also known as',
};

function claimObject(value: unknown, name: (id: string) => string): string {
  if (typeof value === 'string') return name(value);
  if (typeof value === 'object' && value !== null && 'kind' in value) {
    const literal = value as { kind: string; value: unknown };
    if (literal.kind === 'text' && typeof literal.value === 'string') return literal.value;
    if (literal.kind === 'amount') return String(literal.value);
    if (literal.kind === 'time') {
      const time = literal.value as { day?: number; phase?: number };
      return `day ${time.day ?? ''} ${phaseName(time.phase ?? 0)}`;
    }
  }
  return String(value);
}

/** The same sentence the terminal Case File shows. */
export function claimSentence(
  prop: { subject: string; predicate: string; object: unknown; place?: string },
  name: (id: string) => string,
): string {
  const local = prop.predicate.slice(prop.predicate.lastIndexOf('/') + 1);
  const verb = SPOKEN[local.toUpperCase()] ?? local.replace(/_/g, ' ').toLowerCase();
  const subject = name(prop.subject);
  const placeOnly = verb === 'is seen at' || verb === 'travels to';
  const line = placeOnly
    ? `${subject} ${verb} ${prop.place === undefined ? claimObject(prop.object, name) : name(prop.place)}`
    : `${subject} ${verb} ${claimObject(prop.object, name)}`;
  if (!placeOnly && prop.place !== undefined) return `${line} at ${name(prop.place)}`;
  return line;
}

export function costLabel(q: { phases: number; money: number }): string {
  const t = q.phases === 0 ? 'no time' : phases(q.phases);
  return q.money > 0 ? `${t}, ${q.money}` : t;
}
