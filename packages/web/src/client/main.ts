/** Browser entry: renders API data, sends Action References, drives the Cue Director. */
import {
  getJson,
  postJson,
  postStream,
  readSse,
  type ApiError,
} from './api.js';
import { AudioPlayer } from './audio/player.js';
import { Director } from './director.js';
import * as aids from './aids.js';
import {
  hereStatus,
  isDutyAlert,
  isNoticeFact,
  placeWithholds,
  statusLine,
} from './city-text.js';
import {
  GROUPS,
  claimSentence,
  costLabel,
  emptyNames,
  loadNames,
  optionLabel,
  phaseName,
  tidy,
  type Names,
} from './labels.js';
import type { CueInputs, CueManifest, CueMap } from '../shared/cue/types.js';

interface TemplateField {
  name: string;
  label: string;
  type: string;
  required: boolean;
}
interface Offered {
  ref: string;
  option: {
    action: { kind: string } & Record<string, unknown>;
    quote: { allowed: boolean; reason?: string; phases: number; money: number };
  };
  template?: { fields: TemplateField[] };
}
interface StateBody {
  started: boolean;
  stateVersion: number;
  paused: boolean;
  turnRunning: boolean;
  status?: {
    time: { day: number; phase: number | string };
    date?: string;
    location: { name: string };
    budget: number;
    standing: number;
    ended: boolean;
    followed?: string;
  };
  here?: {
    location: {
      tags: string[];
      type: string;
      district: { id: string };
      status?: string;
    };
  };
  dutyAlert?: string | null;
  scene?: {
    location: {
      name: string;
      description: string;
      tags: string[];
      type: string;
      district: { id: string; name: string };
    };
    weather: string;
    crowd: string;
    visible: { label: string }[];
  };
  actions?: Offered[];
}
interface TutorialBody {
  suggestion: {
    text: string;
    action: {
      kind: string;
      npc?: string;
      doc?: string;
      intercept?: string;
      duty?: string;
      to?: string;
      vehicle?: string;
      countersurveillance?: boolean;
      phases?: number;
      target?: string;
      breakOff?: boolean;
    };
  } | null;
}

interface CueBody {
  cueMap: CueMap | null;
  manifest: CueManifest;
  formats: string[];
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing #${id}`);
  return el as T;
};
const text = (tag: string, cls: string, t: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls !== '') e.className = cls;
  e.textContent = t;
  return e;
};

let player: AudioPlayer | undefined;
let director: Director | undefined;
let busy = false;
let screen: CueInputs['screen'] = 'title';
let lastActionKind: string | undefined;
let dutyAlert: string | undefined;
let factKinds: string[] = [];
let gameOver: CueInputs['gameOver'];
let current: StateBody | undefined;
let tutorial: TutorialBody['suggestion'];
let names: Names = emptyNames();
/** The sector tag of the last Location the player saw, to notice a crossing. */
let lastSector: string | undefined;
const sectorOf = (tags: readonly string[] | undefined): string | undefined =>
  tags?.find((t) => t.startsWith('sector:'));

function notice(msg: string): void {
  const n = $('notices');
  n.textContent = msg;
}
function errText(e: unknown): string {
  const a = e as ApiError;
  if (a.status === 409 && a.code === 'stale-ref')
    return 'That choice is out of date; the list was refreshed.';
  if (a.status === 409) return 'A turn is already running.';
  return a.reason ?? a.code ?? 'Something went wrong.';
}

function direct(): void {
  const s = current;
  const tags = s?.scene?.location.tags ?? s?.here?.location.tags ?? [];
  const inputs: Omit<CueInputs, 'minutesInState'> = {
    screen,
    locationTags: tags,
    phase:
      s?.status?.time.phase === undefined ? '' : phaseName(s.status.time.phase),
    factKinds,
    alerts: [],
    dialogueStreaming: busy && screen === 'talk',
  };
  const d = s?.scene?.location.district.id;
  if (d !== undefined) (inputs as { district?: string }).district = d;
  const lt = s?.scene?.location.type;
  if (lt !== undefined) (inputs as { locationType?: string }).locationType = lt;
  if (lastActionKind !== undefined)
    (inputs as { lastActionKind?: string }).lastActionKind = lastActionKind;
  if (gameOver !== undefined)
    (inputs as { gameOver?: CueInputs['gameOver'] }).gameOver = gameOver;
  director?.update(inputs);
}

function render(s: StateBody): void {
  current = s;
  if (!s.started || s.status === undefined || s.scene === undefined) return;
  // A sector crossing is something the player sees: the sector tag changed
  // across their own travel. It drives the checkpoint cue.
  const sector = sectorOf(s.scene.location.tags);
  if (
    lastActionKind === 'travel' &&
    lastSector !== undefined &&
    sector !== undefined &&
    sector !== lastSector
  ) {
    factKinds = [...factKinds, 'sector-crossed'];
  }
  lastSector = sector;
  $('title').hidden = true;
  $('game').hidden = false;
  const st = s.status;
  if (s.dutyAlert !== undefined) {
    dutyAlert = s.dutyAlert ?? undefined;
  }
  $('status').textContent = statusLine(
    {
      day: st.time.day,
      date: st.date,
      phase: phaseName(st.time.phase),
      location: st.location.name,
      budget: st.budget,
      standing: st.standing,
      followed: st.followed,
    },
    dutyAlert,
  );
  const sc = $('scene');
  const statusNote = hereStatus(s.here?.location.status);
  sc.replaceChildren(
    text('h2', '', s.scene.location.name),
    text('p', '', s.scene.location.description),
    text(
      'p',
      'dim',
      `${s.scene.weather}; ${s.scene.crowd} crowd. ${s.scene.visible.map((v) => v.label).join(', ')}`,
    ),
    ...(statusNote === undefined ? [] : [text('p', 'dim', statusNote)]),
  );
  renderActions(s.actions ?? []);
  showTutorial();
  direct();
}

async function refresh(): Promise<void> {
  const [state, n, tip] = await Promise.all([
    getJson<StateBody>('/api/state'),
    loadNames(),
    getJson<TutorialBody>('/api/tutorial').catch(() => ({ suggestion: null })),
  ]);
  names = n;
  tutorial = tip.suggestion;
  render(state);
}

function showTutorial(): void {
  const el = $('tutorial');
  const textValue =
    screen === 'talk'
      ? 'Ask what they know, then leave. A long conversation spends the day.'
      : tutorial?.text;
  if (textValue === undefined) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = textValue;
}

function suggested(offered: Offered): boolean {
  const tip = tutorial;
  if (tip === null || tip === undefined || screen === 'talk') return false;
  const action = offered.option.action;
  const want = tip.action;
  if (action.kind !== want.kind) return false;
  if (
    want.npc !== undefined &&
    action['npc'] !== want.npc &&
    action['target'] !== want.npc
  )
    return false;
  if (want.doc !== undefined && action['doc'] !== want.doc) return false;
  if (want.intercept !== undefined && action['intercept'] !== want.intercept)
    return false;
  if (want.duty !== undefined && action['duty'] !== want.duty) return false;
  if (want.to !== undefined && action['to'] !== want.to) return false;
  if (want.vehicle !== undefined && action['vehicle'] !== want.vehicle) return false;
  if (want.breakOff === true && action['breakOff'] !== true) return false;
  if (want.breakOff !== true && action['breakOff'] === true) return false;
  if (
    want.countersurveillance !== undefined &&
    action['countersurveillance'] !== want.countersurveillance
  ) {
    return false;
  }
  if (want.phases !== undefined && action['phases'] !== want.phases)
    return false;
  if (want.target !== undefined) {
    const body = action['body'] as { target?: string } | undefined;
    if (body?.target !== want.target) return false;
  }
  return true;
}

/** One row per kind of action: a single button, or a menu plus a button. */
function renderActions(list: readonly Offered[]): void {
  const ul = $('actions');
  ul.replaceChildren();
  const byKind = new Map<string, Offered[]>();
  for (const o of list) {
    if (!o.option.quote.allowed && placeWithholds(o.option.quote.reason)) continue;
    const k = o.option.action.kind;
    byKind.set(k, [...(byKind.get(k) ?? []), o]);
  }
  const order = [
    ...GROUPS.map(([k]) => k),
    ...[...byKind.keys()].filter((k) => !GROUPS.some(([g]) => g === k)),
  ];
  for (const kind of order) {
    const opts = byKind.get(kind);
    if (opts === undefined) continue;
    const title = GROUPS.find(([k]) => k === kind)?.[1] ?? kind;
    ul.append(
      kind === 'travel' ? travelRow(title, opts) : groupRow(title, opts),
    );
  }
}

function row(title: string): { li: HTMLLIElement; head: HTMLElement } {
  const li = document.createElement('li');
  li.className = 'group';
  const head = text('span', 'group-title', title);
  li.append(head);
  return { li, head };
}

/** All disallowed for one reason: show the reason once, no controls. */
function blockedRow(
  title: string,
  opts: readonly Offered[],
): HTMLLIElement | undefined {
  if (opts.some((o) => o.option.quote.allowed)) return undefined;
  const reasons = new Set(
    opts.map((o) => o.option.quote.reason ?? 'unavailable'),
  );
  if (reasons.size !== 1) return undefined;
  const { li } = row(title);
  li.classList.add('blocked');
  li.append(text('span', 'reason', [...reasons][0] ?? ''));
  return li;
}

function selectFor(
  title: string,
  opts: readonly { label: string; o: Offered }[],
): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', title);
  let first = -1;
  opts.forEach(({ label, o }, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    const q = o.option.quote;
    opt.textContent = q.allowed
      ? label
      : `${label} — ${q.reason ?? 'unavailable'}`;
    opt.disabled = !q.allowed;
    if (q.allowed && first === -1) first = i;
    sel.append(opt);
  });
  if (first >= 0) sel.value = String(first);
  return sel;
}

function goButton(
  label: string,
  pick: () => Offered | undefined,
): { b: HTMLButtonElement; cost: HTMLElement; update: () => void } {
  const b = text('button', '', label) as HTMLButtonElement;
  b.type = 'button';
  const cost = text('span', 'reason', '');
  const update = (): void => {
    const o = pick();
    b.disabled = o === undefined || !o.option.quote.allowed;
    b.classList.toggle('suggested', o !== undefined && suggested(o));
    cost.textContent =
      o === undefined
        ? ''
        : o.option.quote.allowed
          ? costLabel(o.option.quote)
          : (o.option.quote.reason ?? 'unavailable');
  };
  b.addEventListener('click', () => {
    const o = pick();
    if (o?.option.quote.allowed) void choose(o);
  });
  return { b, cost, update };
}

function groupRow(title: string, opts: readonly Offered[]): HTMLLIElement {
  const blocked = blockedRow(title, opts);
  if (blocked !== undefined) return blocked;
  // Collapse exact duplicates by label (same text, same quote).
  const seen = new Set<string>();
  const items: { label: string; o: Offered }[] = [];
  for (const o of opts) {
    const label = optionLabel(o.option.action, names);
    const key = `${label}|${o.option.quote.allowed}|${o.option.quote.reason ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ label, o });
  }
  const { li, head } = row(title);
  if (items.length === 1) {
    const only = items[0] as { label: string; o: Offered };
    head.textContent = '';
    const g = goButton(`${title} ${only.label}`, () => only.o);
    g.update();
    li.append(g.b, g.cost);
    return li;
  }
  const sel = selectFor(title, items);
  const hinted = items.findIndex(({ o }) => suggested(o));
  if (hinted >= 0) sel.value = String(hinted);
  const g = goButton('Go', () => items[Number(sel.value)]?.o);
  sel.addEventListener('change', g.update);
  g.update();
  li.append(sel, g.b, g.cost);
  return li;
}

/** Destinations in one menu, with a checkbox for the slower careful route. */
function travelRow(title: string, opts: readonly Offered[]): HTMLLIElement {
  const blocked = blockedRow(title, opts);
  if (blocked !== undefined) return blocked;
  const dests = new Map<string, { plain?: Offered; careful?: Offered }>();
  for (const o of opts) {
    const a = o.option.action;
    const to = String(a['to']);
    const e = dests.get(to) ?? {};
    if (a['countersurveillance'] === true) e.careful = o;
    else e.plain = o;
    dests.set(to, e);
  }
  const entries = [...dests.values()]
    .map((e) => {
      const o = (e.plain ?? e.careful) as Offered;
      return { label: optionLabel(o.option.action, names), o, e };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const { li } = row(title);
  const sel = selectFor(
    title,
    entries.map(({ label, o }) => ({ label, o })),
  );
  const box = document.createElement('label');
  box.className = 'careful';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  box.append(cb, ' careful route (checks for a tail)');
  const pick = (): Offered | undefined => {
    const e = entries[Number(sel.value)]?.e;
    return cb.checked ? (e?.careful ?? e?.plain) : (e?.plain ?? e?.careful);
  };
  const hinted = entries.findIndex(
    ({ e }) =>
      (e.careful !== undefined && suggested(e.careful)) ||
      (e.plain !== undefined && suggested(e.plain)),
  );
  if (hinted >= 0) {
    sel.value = String(hinted);
    const chosen = entries[hinted]?.e;
    if (chosen?.careful !== undefined && suggested(chosen.careful))
      cb.checked = true;
  }
  const g = goButton('Go', pick);
  sel.addEventListener('change', g.update);
  cb.addEventListener('change', g.update);
  g.update();
  li.append(sel, box, g.b, g.cost);
  return li;
}

function showParams(o: Offered): Promise<Record<string, unknown> | undefined> {
  if (o.option.action.kind === 'decrypt') return showCipherForm(o);
  const box = $('params');
  return new Promise((resolve) => {
    const form = document.createElement('form');
    const fields = o.template?.fields ?? [];
    const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
    for (const f of fields) {
      const label = document.createElement('label');
      label.append(f.label + ' ');
      const input =
        f.type === 'textarea'
          ? document.createElement('textarea')
          : document.createElement('input');
      if (f.type === 'integer') (input as HTMLInputElement).type = 'number';
      input.required = f.required && f.type !== 'item-list';
      if (f.type === 'item-list') input.placeholder = 'comma-separated items';
      label.append(input);
      form.append(label);
      inputs.set(f.name, input);
    }
    const ok = text('button', '', 'Do it') as HTMLButtonElement;
    ok.type = 'submit';
    const cancel = text('button', '', 'Cancel') as HTMLButtonElement;
    cancel.type = 'button';
    form.append(ok, cancel);
    box.replaceChildren(form);
    box.hidden = false;
    const done = (v: Record<string, unknown> | undefined): void => {
      box.hidden = true;
      box.replaceChildren();
      resolve(v);
    };
    cancel.addEventListener('click', () => done(undefined));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        const v = inputs.get(f.name)?.value ?? '';
        if (f.type === 'integer') out[f.name] = Number(v);
        else if (f.type === 'item-list')
          out[f.name] = v
            .split(',')
            .map((x) => x.trim())
            .filter((x) => x !== '')
            .map((item) => ({ item }));
        else out[f.name] = v;
      }
      done(out);
    });
    (inputs.values().next().value as HTMLElement | undefined)?.focus();
  });
}

interface CipherWorkbench {
  ciphertext: string;
  coincidence: { overall: number; rows: { length: number; coincidence: number }[] };
}

function showCipherForm(o: Offered): Promise<Record<string, unknown> | undefined> {
  const box = $('params');
  const intercept = String(o.option.action['intercept'] ?? '');
  return new Promise((resolve) => {
    const form = document.createElement('form');
    const note = text(
      'p',
      'dim',
      'A length near 0.065 is a word of that many letters. The trial does not spend a phase. File the reading only when it is language.',
    );
    const stats = text('p', '', '…');
    const cipher = document.createElement('select');
    for (const kind of ['vigenere', 'columnar', 'caesar', 'book'] as const) {
      const option = document.createElement('option');
      option.value = kind;
      option.textContent = kind;
      cipher.append(option);
    }
    const word = document.createElement('input');
    word.placeholder = 'word, shift, or a stretch of a public text';
    const preview = text('p', '', '');
    const reading = document.createElement('textarea');
    reading.required = true;
    reading.placeholder = 'The reading you will file';
    const useTrial = text('button', '', 'Use this reading') as HTMLButtonElement;
    useTrial.type = 'button';
    const ok = text('button', '', 'File it') as HTMLButtonElement;
    ok.type = 'submit';
    const cancel = text('button', '', 'Cancel') as HTMLButtonElement;
    cancel.type = 'button';
    form.append(note, stats, cipher, word, preview, useTrial, reading, ok, cancel);
    box.replaceChildren(form);
    box.hidden = false;

    let ciphertext = '';
    const refresh = (): void => {
      if (ciphertext === '') return;
      const kind = cipher.value;
      let body: { kind: string; ciphertext: string; shift?: number; text?: string; keyword?: string };
      if (kind === 'caesar') body = { kind, ciphertext, shift: Number(word.value) || 0 };
      else if (kind === 'book') body = { kind, ciphertext, text: word.value };
      else body = { kind, ciphertext, keyword: word.value };
      void postJson<{ text: string }>('/api/cipher/trial', body)
        .then((result) => {
          preview.textContent = result.text;
        })
        .catch(() => {
          preview.textContent = '';
        });
    };
    cipher.addEventListener('change', refresh);
    word.addEventListener('input', refresh);
    useTrial.addEventListener('click', () => {
      reading.value = preview.textContent ?? '';
    });

    void getJson<{ workbench: CipherWorkbench }>(`/api/views/workbench/${encodeURIComponent(intercept)}`)
      .then((body) => {
        ciphertext = body.workbench.ciphertext;
        const rows = body.workbench.coincidence.rows
          .map((row) => `${row.length} ${row.coincidence.toFixed(3)}`)
          .join('  ');
        stats.textContent = `whole text ${body.workbench.coincidence.overall.toFixed(3)} · ${rows}`;
        refresh();
      })
      .catch(() => {
        stats.textContent = 'No capture is open.';
      });

    const done = (v: Record<string, unknown> | undefined): void => {
      box.hidden = true;
      box.replaceChildren();
      resolve(v);
    };
    cancel.addEventListener('click', () => done(undefined));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      done({ text: reading.value });
    });
    word.focus();
  });
}

function appendChunk(c: Record<string, unknown>): void {
  const feed = $('feed');
  const kind = c['kind'] as string;
  let el: HTMLElement | undefined;
  if (kind === 'fact') {
    const line = String(c['text']);
    el = text('p', isNoticeFact(line) ? 'fact notice' : 'fact', line);
  } else if (kind === 'flavour') el = text('p', 'flavour', String(c['text']));
  else if (kind === 'speech') {
    el = document.createElement('p');
    el.className = 'speech';
    el.append(text('b', '', String(c['speaker']) + ': '), String(c['text']));
  } else if (kind === 'hint') el = text('p', 'hint', String(c['text']));
  else if (kind === 'interrupted') el = text('p', 'dim', '(interrupted)');
  else if (kind === 'paused') {
    const e = c['error'] as { message: string };
    el = text('p', 'dim', `Paused: ${e.message}`);
    const b = text('button', '', 'Retry') as HTMLButtonElement;
    b.type = 'button';
    b.addEventListener(
      'click',
      () => void runTurn('/api/retry', {}, undefined),
    );
    el.append(' ', b);
  } else if (kind === 'ended') {
    const o = String(c['outcome']);
    screen = 'gameover';
    gameOver = /burn/i.test(o)
      ? 'burned'
      : /plot/i.test(o)
        ? 'plot-completes'
        : 'success';
    el = text('p', 'fact', `The game has ended: ${o}`);
  }
  if (el !== undefined) {
    feed.append(el);
    el.scrollIntoView({ block: 'nearest' });
  }
}

async function runTurn(
  path: string,
  body: unknown,
  kind: string | undefined,
  after?: () => Promise<void>,
): Promise<void> {
  if (busy) return;
  busy = true;
  factKinds = [];
  lastActionKind = kind;
  if (kind === 'talk') {
    screen = 'talk';
    showTutorial();
  } else if (kind === 'decrypt') screen = 'workbench';
  else if (kind === 'intercept') screen = 'intercept';
  direct();
  let ok = false;
  try {
    for await (const ev of readSse(await postStream(path, body))) {
      if (ev.event === 'chunk') appendChunk(ev.data as Record<string, unknown>);
      else if (ev.event === 'end') {
        const end = ev.data as { ok: boolean };
        if (!end.ok) notice('The turn did not complete.');
        else ok = true;
      }
    }
  } catch (e) {
    notice(errText(e));
  } finally {
    busy = false;
    if (screen === 'workbench' || screen === 'intercept') screen = 'city';
    try {
      await refresh();
    } catch (e) {
      notice(errText(e));
    }
  }
  if (ok && after !== undefined) await after();
}

interface DocBody {
  document: { id: string; title: string; dateLabel: string; body: string };
}

/** Show one Document's text in the reader (the facade's Document view). */
async function openDocument(id: string): Promise<void> {
  try {
    const { document: d } = await getJson<DocBody>(
      `/api/views/document/${encodeURIComponent(id)}`,
    );
    $('reader-title').textContent = d.title;
    $('reader-date').textContent = d.dateLabel;
    $('reader-body').textContent = d.body;
    const r = $('reader');
    r.hidden = false;
    r.focus();
    r.scrollIntoView({ block: 'start' });
  } catch (e) {
    notice(errText(e));
  }
}

interface DocsBody {
  documents: {
    documents: {
      id: string;
      title: string;
      dateLabel: string;
      read: boolean;
    }[];
  };
}

/** The Documents aid: titles to open in the reader. */
async function showDocuments(): Promise<void> {
  const box = $('doc-list');
  if (!box.hidden) {
    box.hidden = true;
    return;
  }
  $('aid').hidden = true;
  try {
    const { documents } = await getJson<DocsBody>('/api/views/documents');
    const ul = document.createElement('ul');
    for (const d of documents.documents) {
      const li = document.createElement('li');
      const b = text(
        'button',
        d.read ? '' : 'unread',
        d.title,
      ) as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => void openDocument(d.id));
      li.append(
        b,
        text('span', 'reason', `${d.dateLabel}${d.read ? '' : ' · unread'}`),
      );
      ul.append(li);
    }
    box.replaceChildren(
      documents.documents.length === 0
        ? text('p', 'dim', 'No documents yet.')
        : ul,
    );
    box.hidden = false;
  } catch (e) {
    notice(errText(e));
  }
}

async function choose(o: Offered): Promise<void> {
  // Working a cipher is the workbench, from the moment the form opens.
  if (o.option.action.kind === 'decrypt') {
    screen = 'workbench';
    direct();
  }
  const params = o.template !== undefined ? await showParams(o) : {};
  if (params === undefined) {
    if (screen === 'workbench') {
      screen = 'city';
      direct();
    }
    return;
  }
  const body: { ref: string; params?: Record<string, unknown> } = {
    ref: o.ref,
  };
  if (o.template !== undefined) body.params = params;
  const a = o.option.action;
  const after =
    a.kind === 'read' && typeof a['doc'] === 'string'
      ? () => openDocument(a['doc'] as string)
      : undefined;
  const turnKind = a.kind === 'talk' && a['breakOff'] === true ? 'break-off' : a.kind;
  await runTurn('/api/act', body, turnKind, after);
}

const AID_TITLES: Record<string, string> = {
  journal: 'Journal',
  map: 'Map',
  people: 'People',
  intercepts: 'Intercepts',
  help: 'Help',
  city: 'City',
  stories: 'Stories',
  duties: 'Cover duties',
  region: 'Region',
  departures: 'Departures',
  papers: 'Papers',
  carriage: 'Carriage',
  street: 'Streets',
  case: 'Case File',
};

/** The same letter commands as the terminal shell. */
const VIEW_KEYS: Readonly<Record<string, string>> = {
  j: 'journal',
  m: 'map',
  y: 'city',
  r: 'stories',
  k: 'duties',
  p: 'people',
  d: 'documents',
  i: 'intercepts',
  g: 'street',
  c: 'case',
  n: 'region',
  b: 'departures',
  a: 'papers',
  t: 'carriage',
  '?': 'help',
};

function openView(name: string): void {
  if (name === 'documents') {
    void showDocuments();
    return;
  }
  if (name === 'case') {
    void showCase();
    return;
  }
  $('doc-list').hidden = true;
  void showAid(name);
}

async function showAid(name: string): Promise<void> {
  const box = $('aid');
  if (!box.hidden && box.dataset['name'] === name) {
    box.hidden = true;
    if (screen === 'intercept') {
      screen = 'city';
      direct();
    }
    return;
  }
  try {
    const body = await getJson<Record<string, unknown>>(`/api/views/${name}`);
    const v = body[name] as never;
    let content: HTMLElement;
    switch (name) {
      case 'journal':
        content = aids.journal(v, names, (t) => void addNote(t));
        break;
      case 'map':
        content = aids.map(v);
        break;
      case 'city':
        content = aids.city(v);
        break;
      case 'stories':
        content = aids.stories(v);
        break;
      case 'duties':
        content = aids.duties(v);
        break;
      case 'region':
        content = aids.region(v);
        break;
      case 'departures':
        content = aids.departures(v);
        break;
      case 'papers':
        content = aids.papers(v);
        break;
      case 'carriage':
        content = aids.carriage(v);
        break;
      case 'street':
        content = aids.street(v);
        break;
      case 'people':
        content = aids.people(v);
        break;
      case 'intercepts':
        content = aids.intercepts(v, names);
        break;
      default:
        content = aids.help(
          v,
          (k) => GROUPS.find(([g]) => g === k)?.[1] ?? k,
          costLabel,
        );
    }
    box.replaceChildren(aids.el('h2', '', AID_TITLES[name] ?? name), content);
    box.dataset['name'] = name;
    box.hidden = false;
    if (name === 'intercepts' && screen === 'city') {
      screen = 'intercept';
      direct();
    } else if (name !== 'intercepts' && screen === 'intercept') {
      screen = 'city';
      direct();
    }
  } catch (e) {
    notice(errText(e));
  }
}

async function showCase(): Promise<void> {
  const box = $('aid');
  if (!box.hidden && box.dataset['name'] === 'case') {
    box.hidden = true;
    return;
  }
  try {
    const body = await getJson<{
      claims: { id: string; prop: { subject: string; predicate: string; object: unknown; place?: string }; hedged: boolean }[];
    }>('/api/casefile');
    const nameOf = (id: string): string =>
      names.person.get(id) ?? names.loc.get(id) ?? names.doc.get(id) ?? names.drop.get(id) ?? tidy(id);
    box.replaceChildren(
      aids.el('h2', '', 'Case File'),
      aids.caseFile(body.claims, (prop) => claimSentence(prop, nameOf)),
    );
    box.dataset['name'] = 'case';
    box.hidden = false;
    $('doc-list').hidden = true;
  } catch (e) {
    notice(errText(e));
  }
}

async function addNote(textValue: string): Promise<void> {
  const day = current?.status?.time.day ?? 0;
  try {
    await postJson('/api/notes', { attachTo: day, text: textValue });
    $('aid').hidden = true;
    await showAid('journal');
  } catch (e) {
    notice(errText(e));
  }
}

async function setupAudio(): Promise<void> {
  try {
    const c = await getJson<CueBody>('/api/cue-map');
    if (c.cueMap === null) return;
    player = new AudioPlayer(c.cueMap, c.manifest, c.formats);
    director = new Director(c.cueMap, c.manifest, player);
  } catch {
    /* no audio is a normal state */
  }
}

function unlockAudio(): void {
  if (player === undefined) return;
  player.resume();
  direct();
}

async function main(): Promise<void> {
  await setupAudio();
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
  const mute = $('mute') as HTMLButtonElement;
  mute.addEventListener('click', () => {
    const off = mute.getAttribute('aria-pressed') !== 'true';
    mute.setAttribute('aria-pressed', String(off));
    mute.textContent = off ? 'Sound off' : 'Sound on';
    player?.setMuted(off);
  });
  for (const b of document.querySelectorAll<HTMLButtonElement>(
    '#views button',
  )) {
    b.addEventListener('click', () => {
      openView(b.dataset['view'] ?? 'help');
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    }
    if ($('game').hidden) return;
    const view = VIEW_KEYS[event.key];
    if (view === undefined) return;
    event.preventDefault();
    openView(view);
  });
  $('reader-close').addEventListener('click', () => {
    $('reader').hidden = true;
  });
  $('new-game').addEventListener('submit', (e) => {
    e.preventDefault();
    unlockAudio();
    screen = 'opening';
    postJson('/api/new-game', {
      preset: ($('preset') as HTMLSelectElement).value,
      mole: ($('mole') as HTMLInputElement).checked,
      narration: 'full',
    })
      .then(async () => {
        screen = 'city';
        await refresh();
      })
      .catch((err: unknown) => {
        screen = 'title';
        $('title-error').textContent = errText(err);
      });
  });
  $('say').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('line') as HTMLInputElement;
    const line = input.value.trim();
    if (line === '') return;
    input.value = '';
    void runTurn('/api/say', { line }, 'say');
  });
  $('end-scene').addEventListener('click', () => {
    screen = 'city';
    showTutorial();
    void runTurn('/api/end-scene', {}, 'end-scene');
  });
  // Re-evaluate now and then so timed holds (checkpoint, pursuit) can end.
  window.setInterval(() => {
    if (screen !== 'title') direct();
  }, 5000);
  const es = new EventSource('/api/events');
  es.addEventListener('notification', (e) => {
    const n = JSON.parse((e as MessageEvent<string>).data) as {
      kind?: string;
      factLine?: string;
      text?: string;
    };
    const line = n.factLine ?? n.text;
    if (line === undefined) return;
    if (isDutyAlert(n.kind)) {
      dutyAlert = line;
      if (current?.status !== undefined && current.scene !== undefined) {
        render({ ...current, dutyAlert: line });
      }
      return;
    }
    notice(line);
  });
  try {
    const s = await getJson<StateBody>('/api/state');
    if (s.started) {
      screen = 'city';
      await refresh();
    } else direct();
  } catch (e) {
    notice(errText(e));
  }
}

void main();
