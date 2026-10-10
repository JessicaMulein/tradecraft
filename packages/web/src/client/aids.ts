/**
 * The player aids as readable pages: Journal, Map, People, Intercepts, Help.
 * Each renders one Player View value; nothing here reaches past the facade.
 */
import { cityLines, dutiesLines, mapStatus, placeWithholds, storiesLines } from './city-text.js';
import { phaseName, tidy, type Names } from './labels.js';
import { layoutStreetMap, type StreetLayoutMap } from './street-map.js';

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
  note?: string;
  districts: { id: string; name: string; sector: string; locations: MapLoc[]; routes: { toName: string; cost: number }[] }[];
}

const riskWord = (r: number): string => (r < 0.25 ? 'low' : r < 0.5 ? 'moderate' : r < 0.75 ? 'high' : 'very high');

function openHours(h: Record<string, boolean>): string {
  const open = Object.entries(h).filter(([, v]) => v).map(([k]) => phaseName(Number(k)));
  return open.length === 4 ? 'always open' : open.length === 0 ? 'closed' : `open ${open.join(', ')}`;
}

export function map(m: MapV): HTMLElement {
  const root = el('div');
  if (m.note !== undefined && m.note !== '') {
    root.append(el('p', '', m.note));
  }
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
  people: { id: string; identified: boolean; label: string; apparentAffiliation?: string; lastSighting?: Time; asset: boolean; rapport: string; claimsAsSubject: number; claimsAsSource: number; recruitment?: string; standing?: string }[];
  orgs: { id: string; name: string; allegiance: string }[];
}

export function people(p: PeopleV): HTMLElement {
  const root = el('div');
  if (p.people.length === 0) root.append(empty('You have not met or heard of anyone yet.'));
  else {
    root.append(table(['Person', 'Seems to work for', 'Rapport', 'Last seen', 'Claims about / from'],
      p.people.map((x) => [
        el('span', '', x.label, x.asset ? el('span', 'tag', 'your asset') : '', x.identified ? '' : el('span', 'dim', ' (unidentified)'), x.recruitment === undefined ? '' : el('span', 'dim', ` ${x.recruitment}`), x.standing === undefined ? '' : el('span', 'dim', ` ${x.standing}`)),
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

interface InterceptsV { intercepts: { id: string; channel: string; owner: string; direction: string; at: Time; length: number; callsign?: string; signal?: string; hasTradecraftError: boolean }[] }

export function intercepts(v: InterceptsV, _names: Names): HTMLElement {
  if (v.intercepts.length === 0) return empty('No intercepts collected yet. Listen in from the Station.');
  return table(['When', 'Call sign', 'Frequency', 'Direction', 'Length', ''],
    v.intercepts.map((i) => [
      when(i.at),
      i.callsign ?? 'traffic',
      i.signal ?? 'an unnamed frequency',
      i.direction,
      `${i.length} groups`,
      i.hasTradecraftError ? el('span', 'tag', 'operator error') : '',
    ]));
}

// --- Help ----------------------------------------------------------------

interface HelpV {
  location: { name: string };
  actions: { kind: string; quote: { allowed: boolean; reason?: string; phases: number; money: number } }[];
  glossary: { term: string; definition: string }[];
  credits?: string[];
}

export function help(h: HelpV, title: (kind: string) => string, cost: (q: { phases: number; money: number }) => string): HTMLElement {
  const root = el('div');
  root.append(el('h3', '', `What you can do at ${h.location.name}`));
  const seen = new Set<string>();
  const rows = h.actions
    .filter((a) => a.quote.allowed || !placeWithholds(a.quote.reason))
    .filter((a) => !seen.has(a.kind) && (seen.add(a.kind), true))
    .map((a) => [
    title(a.kind),
    a.quote.allowed ? cost(a.quote) : el('span', 'dim', a.quote.reason ?? 'unavailable'),
  ]);
  root.append(table(['Action', 'Cost'], rows));
  if (h.credits !== undefined && h.credits.length > 0) {
    root.append(el('h3', '', 'Street data'));
    for (const line of h.credits) root.append(el('p', '', line));
  }
  if (h.glossary.length > 0) {
    root.append(el('h3', '', 'Glossary'));
    const dl = el('dl', 'glossary');
    for (const g of h.glossary) dl.append(el('dt', '', g.term), el('dd', '', g.definition));
    root.append(dl);
  }
  return root;
}

// --- Region, departures, papers, carriage, case file ---------------------

interface RegionCity { id: string; name: string; country?: string; locations: { id: string; name: string }[] }
interface RegionV {
  template: string;
  here?: string;
  cities: RegionCity[];
  routes: { id: string; mode: string; fromName: string; toName: string; duration: number; fare: number; borders: string[] }[];
}
interface DepartureV {
  route: string;
  mode: string;
  destination: string;
  duration: number;
  fare: number;
  borders: string[];
  quote?: { allowed: boolean; reason?: string; phases: number };
}
interface PaperV {
  id: string;
  kind: string;
  holder: string;
  issuedBy: { kind: string; id: string };
  satisfies: string[];
}
interface CarriageV { destination: string; travellers: string[] }

function quoteText(quote: DepartureV['quote']): string {
  if (quote === undefined) return '';
  if (quote.allowed) return `${quote.phases} phases`;
  return quote.reason ?? 'refused';
}

export function region(view: RegionV | null): HTMLElement {
  if (view === null) return empty('This game is a single city.');
  const root = el('div');
  root.append(el('p', '', view.template));
  for (const city of view.cities) {
    const here = city.id === view.here ? 'You are here. ' : '';
    const country = city.country === undefined ? '' : ` · ${city.country}`;
    root.append(el('h3', '', `${here}${city.name}${country}`));
    if (city.locations.length > 0) {
      root.append(el('ul', '', ...city.locations.map((loc) => el('li', '', loc.name))));
    }
  }
  root.append(el('h3', '', 'Routes'));
  if (view.routes.length === 0) {
    root.append(empty('No intercity routes.'));
    return root;
  }
  root.append(el('ul', '', ...view.routes.map((route) => {
    const borders = route.borders.length === 0 ? '' : ` · ${route.borders.join(', ')}`;
    return el('li', '', `${route.fromName} → ${route.toName} · ${route.mode} · ${route.duration} phases · ${route.fare}${borders}`);
  })));
  return root;
}

export function departures(rows: readonly DepartureV[]): HTMLElement {
  if (rows.length === 0) return empty('No departure from here.');
  return table(
    ['Mode', 'Destination', 'Fare', 'Quote'],
    rows.map((row) => [row.mode, row.destination, String(row.fare), quoteText(row.quote)]),
  );
}

export function papers(rows: readonly PaperV[]): HTMLElement {
  if (rows.length === 0) return empty('No papers in hand.');
  return table(
    ['Kind', 'Holder', 'Issued by', 'Satisfies'],
    rows.map((paper) => [
      paper.kind,
      paper.holder,
      `${paper.issuedBy.kind} ${paper.issuedBy.id}`,
      paper.satisfies.join(', '),
    ]),
  );
}

export function carriage(view: CarriageV | null): HTMLElement {
  if (view === null) return empty('You are not in transit.');
  const root = el('div');
  root.append(el('p', '', `Toward ${view.destination}`));
  if (view.travellers.length === 0) root.append(empty('No one else in the carriage.'));
  else root.append(el('ul', '', ...view.travellers.map((who) => el('li', '', who))));
  root.append(el('p', 'dim', 'Talk and observe from the scene.'));
  return root;
}

const STROKE: Record<string, string> = {
  driven: '',
  seen: '6 4',
  map: '2 3',
  local: '8 3',
  aid: '2 3',
};

export function street(view: { readonly map: StreetLayoutMap; readonly localMap: readonly string[]; readonly network: readonly string[]; readonly drive?: { readonly options: readonly { readonly relative: string; readonly street: string }[] } } | null): HTMLElement {
  if (view === null) return empty('No street map is loaded.');
  const root = el('div');
  const laid = layoutStreetMap(view.map, { width: 640, height: 360 });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${laid.width} ${laid.height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Streets you know');
  for (const edge of laid.edges) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', edge.points.map((point) => `${point.x},${point.y}`).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'currentColor');
    const dash = STROKE[edge.known] ?? '';
    if (dash !== '') line.setAttribute('stroke-dasharray', dash);
    if (edge.traffic !== undefined) {
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${edge.street}, ${edge.traffic} traffic`;
      line.append(title);
    }
    svg.append(line);
  }
  if (laid.position !== undefined) {
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    marker.setAttribute('points', '0,-8 6,8 -6,8');
    marker.setAttribute('transform', `translate(${laid.position.x} ${laid.position.y}) rotate(${-laid.position.headingDeg + 90})`);
    marker.setAttribute('fill', 'currentColor');
    svg.append(marker);
  }
  root.append(svg);
  if (view.localMap.length > 0) root.append(el('pre', '', view.localMap.join('\n')));
  else root.append(el('ul', '', ...view.network.map((line) => el('li', '', line))));
  const options = view.drive?.options ?? [];
  if (options.length > 0) {
    root.append(el('p', '', options.map((option) => `${option.relative} onto ${option.street}`).join(' · ')));
  }
  return root;
}

interface CaseClaim {
  id: string;
  prop: { subject: string; predicate: string; object: unknown; place?: string };
  hedged: boolean;
}

export function caseFile(
  claims: readonly CaseClaim[],
  sentence: (prop: CaseClaim['prop']) => string,
): HTMLElement {
  if (claims.length === 0) return empty('The case file is empty.');
  return table(
    ['Claim', 'What it says'],
    claims.map((claim) => [tidy(claim.id), `${sentence(claim.prop)}${claim.hedged ? ' (hedged)' : ''}`]),
  );
}
