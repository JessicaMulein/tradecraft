/**
 * The player aids as readable pages: Journal, Map, People, Intercepts, Help.
 * Each renders one Player View value; nothing here reaches past the facade.
 */
import { cityLines, dutiesLines, mapStatus, storiesLines } from './city-text.js';
import { phaseName, tidy, type Names } from './labels.js';

type Time = { day: number; phase: number };
const when = (t: Time | undefined): string => (t === undefined ? '—' : `Day ${t.day}, ${phaseName(t.phase)}`);

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== '') e.className = cls;
  e.append(...kids);
  return e;
}

function table(head: readonly string[], rows: readonly (readonly (Node | string)[])[]): HTMLTableElement {
  const t = el('table', 'aid-table');
  t.append(el('thead', '', el('tr', '', ...head.map((h) => el('th', '', h)))));
  t.append(el('tbody', '', ...rows.map((r) => el('tr', '', ...r.map((c) => el('td', '', c))))));
  return t;
}

const empty = (msg: string): HTMLElement => el('p', 'dim', msg);

// --- Journal -------------------------------------------------------------

interface Journal {
  days: { day: number; phases: { phase: number; entries: { factLines: string[] }[] }[] }[];
  notes: { at: Time; attachTo: number | string; text: string }[];
}

export function journal(j: Journal, names: Names, onNote: (text: string) => void): HTMLElement {
  const root = el('div');
  const form = el('form', 'note-form');
  const input = el('input');
  input.placeholder = 'Add a note for today';
  input.setAttribute('aria-label', 'New note');
  const add = el('button', '', 'Add note');
  add.type = 'submit';
  form.append(input, add);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (t !== '') { onNote(t); input.value = ''; }
  });
  root.append(form);

  if (j.notes.length > 0) {
    root.append(el('h3', '', 'Your notes'));
    root.append(el('ul', 'notes', ...j.notes.map((n) => {
      const about = typeof n.attachTo === 'number' ? `day ${n.attachTo}`
        : (names.person.get(n.attachTo) ?? names.loc.get(n.attachTo) ?? names.doc.get(n.attachTo) ?? tidy(n.attachTo));
      return el('li', '', el('span', 'dim', `${when(n.at)} · ${about}: `), n.text);
    })));
  }
  if (j.days.length === 0) { root.append(empty('Nothing has happened yet.')); return root; }
  for (const d of [...j.days].reverse()) {
    root.append(el('h3', '', `Day ${d.day}`));
    for (const p of d.phases) {
      const lines = p.entries.flatMap((e) => e.factLines);
      if (lines.length === 0) continue;
      root.append(el('h4', '', phaseName(p.phase)), el('ul', 'facts', ...lines.map((l) => el('li', '', l))));
    }
  }
  return root;
}

// --- Map -----------------------------------------------------------------

interface MapLoc { id: string; name: string; type: string; risk: number; hours: Record<string, boolean>; crowd: string; deadDrops: { id: string }[]; travelCost: number; lastVisit?: Time; status?: string }
interface MapV {
  here: string;
  districts: { id: string; name: string; sector: string; locations: MapLoc[]; routes: { toName: string; cost: number }[] }[];
}

const riskWord = (r: number): string => (r < 0.25 ? 'low' : r < 0.5 ? 'moderate' : r < 0.75 ? 'high' : 'very high');

function openHours(h: Record<string, boolean>): string {
  const open = Object.entries(h).filter(([, v]) => v).map(([k]) => phaseName(Number(k)));
  return open.length === 4 ? 'always open' : open.length === 0 ? 'closed' : `open ${open.join(', ')}`;
}

export function map(m: MapV): HTMLElement {
  const root = el('div');
  for (const d of m.districts) {
    const sector = d.sector === '' ? '' : ` · ${d.sector.charAt(0).toUpperCase()}${d.sector.slice(1)} sector`;
    root.append(el('h3', '', d.name, el('span', 'dim', sector)));
    const rows = d.locations.map((l) => [
      l.id === m.here ? el('strong', '', `${l.name} (you are here)`) : l.name,
      tidy(l.type),
      openHours(l.hours),
      `${riskWord(l.risk)} risk`,
      l.crowd,
      l.id === m.here ? '—' : `${l.travelCost} phase${l.travelCost === 1 ? '' : 's'}`,
      l.deadDrops.length > 0 ? 'dead drop' : '',
      l.lastVisit === undefined ? '' : `last visit ${when(l.lastVisit)}`,
      mapStatus(l),
    ]);
    root.append(table(['Place', 'Kind', 'Hours', 'Risk', 'Crowd', 'Travel', '', '', 'Status'], rows));
    if (d.routes.length > 0) {
      root.append(el('p', 'dim', 'Routes: ' + d.routes.map((r) => `${r.toName} (${r.cost})`).join(', ')));
    }
  }
  return root;
}

// --- City, stories, duties ----------------------------------------------

interface CityV { events: { id: string; name: string }[] }
interface StoriesV { stories: { title: string; status: string; articles: { title: string }[] }[] }
interface DutiesV { standing: number; band: string; duties: { template: string; day: number; status: string; mandatory: boolean }[] }

function lines(title: string, rows: readonly string[]): HTMLElement {
  const root = el('div');
  root.append(el('h3', '', title));
  root.append(el('ul', 'facts', ...rows.map((row) => el('li', '', row))));
  return root;
}

export function city(view: CityV): HTMLElement {
  return lines('City', cityLines(view.events));
}

export function stories(view: StoriesV): HTMLElement {
  return lines('Stories', storiesLines(view.stories));
}

export function duties(view: DutiesV): HTMLElement {
  return lines('Cover duties', dutiesLines(view.band, view.standing, view.duties));
}

// --- People --------------------------------------------------------------

interface PeopleV {
  people: { id: string; identified: boolean; label: string; apparentAffiliation?: string; lastSighting?: Time; asset: boolean; rapport: string; claimsAsSubject: number; claimsAsSource: number }[];
  orgs: { id: string; name: string; allegiance: string }[];
}

export function people(p: PeopleV): HTMLElement {
  const root = el('div');
  if (p.people.length === 0) root.append(empty('You have not met or heard of anyone yet.'));
  else {
    root.append(table(['Person', 'Seems to work for', 'Rapport', 'Last seen', 'Claims about / from'],
      p.people.map((x) => [
        el('span', '', x.label, x.asset ? el('span', 'tag', 'your asset') : '', x.identified ? '' : el('span', 'dim', ' (unidentified)')),
        x.apparentAffiliation ?? '—',
        x.rapport,
        when(x.lastSighting),
        `${x.claimsAsSubject} / ${x.claimsAsSource}`,
      ])));
  }
  if (p.orgs.length > 0) {
    root.append(el('h3', '', 'Organisations'));
    root.append(el('ul', '', ...p.orgs.map((o) => el('li', '', o.name, el('span', 'dim', ` · ${o.allegiance}`)))));
  }
  return root;
}

// --- Intercepts ----------------------------------------------------------

interface InterceptsV { intercepts: { id: string; channel: string; owner: string; direction: string; at: Time; length: number; callsign?: string; hasTradecraftError: boolean }[] }

export function intercepts(v: InterceptsV, names: Names): HTMLElement {
  if (v.intercepts.length === 0) return empty('No intercepts collected yet. Listen in from the Station.');
  return table(['When', 'Call sign', 'From', 'Direction', 'Length', ''],
    v.intercepts.map((i) => [
      when(i.at),
      i.callsign ?? tidy(i.channel),
      names.person.get(i.owner) ?? tidy(i.owner),
      i.direction,
      `${i.length} groups`,
      i.hasTradecraftError ? el('span', 'tag', 'operator error') : '',
    ]));
}

// --- Help ----------------------------------------------------------------

interface HelpV { location: { name: string }; actions: { kind: string; quote: { allowed: boolean; reason?: string; phases: number; money: number } }[]; glossary: { term: string; definition: string }[] }

export function help(h: HelpV, title: (kind: string) => string, cost: (q: { phases: number; money: number }) => string): HTMLElement {
  const root = el('div');
  root.append(el('h3', '', `What you can do at ${h.location.name}`));
  const seen = new Set<string>();
  const rows = h.actions.filter((a) => !seen.has(a.kind) && (seen.add(a.kind), true)).map((a) => [
    title(a.kind),
    a.quote.allowed ? cost(a.quote) : el('span', 'dim', a.quote.reason ?? 'unavailable'),
  ]);
  root.append(table(['Action', 'Cost'], rows));
  if (h.glossary.length > 0) {
    root.append(el('h3', '', 'Glossary'));
    const dl = el('dl', 'glossary');
    for (const g of h.glossary) dl.append(el('dt', '', g.term), el('dd', '', g.definition));
    root.append(dl);
  }
  return root;
}
