/**
 * The Preview CLI renderers (`content-tools/preview/render`).
 *
 * Each preview kind is a pure function from the generated {@link PreviewWorld}
 * (and the `--reveal` flag and `--count`) to a block of plain UTF-8 text. The
 * text uses `\n` line endings and nothing locale- or clock-dependent, so a
 * given `(packs, city, preset, seed, kind, reveal, count)` always renders the
 * identical bytes (design, "Preview CLI"; Req 14.3).
 *
 * The renderers read the world the same way the game's own `player-view`
 * projections do — Location names and public facts, a person's descriptor (or
 * persona name once identified), a Document's fact-layer body, an Intercept's
 * ciphertext — so without `--reveal` the preview shows only projection output
 * (Req 14.1, 14.2). With `--reveal` a renderer additionally prints the
 * ground truth it otherwise hides (an NPC's persona name, true allegiance and
 * culture; an Intercept's decrypted plaintext), behind the warning header the
 * CLI stamps (Req 14.6).
 *
 * The two day-boundary kinds (`newspaper`, `fact-lines`) read material the clock
 * produces; {@link import('./world.js').buildPreviewWorld} advances the world
 * for them before rendering.
 */

import {
  decryptToFieldMessage,
  renderPropositionLine,
  resolveCipherSpec,
  revealedSpec,
  revealTruth,
  worldCipherKeyLookup,
  type Document,
  type Intercept,
  type Proposition,
  type WorldState,
} from '@tradecraft/engine';
import { personLabel } from '@tradecraft/player-view';

import type { PreviewWorld } from './world.js';

/** The preview kinds the CLI renders (design, "Preview CLI"). */
export const PREVIEW_KINDS = [
  'city',
  'locations',
  'npcs',
  'newspaper',
  'documents',
  'dossiers',
  'cables',
  'fact-lines',
  'intercepts',
] as const;

/** A single preview kind. */
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

/** Whether `value` is one of the {@link PREVIEW_KINDS}. */
export function isPreviewKind(value: string): value is PreviewKind {
  return (PREVIEW_KINDS as readonly string[]).includes(value);
}

/** The kinds that read day-boundary material and so need the clock advanced. */
export function needsAdvance(kind: PreviewKind): boolean {
  return kind === 'newspaper' || kind === 'fact-lines';
}

/** The one-line warning header `--reveal` stamps at the top of the output
 * (Req 14.6): it tells the reader the block below contains ground truth no
 * player ever sees. */
export const REVEAL_WARNING =
  '!! REVEAL: this output contains ground truth hidden from the player !!';

/** How a renderer is called: the world, the reveal flag and the item count. */
export interface RenderOptions {
  readonly reveal: boolean;
  /** The maximum number of items a list kind prints (`--count`). */
  readonly count: number;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Render one preview kind to byte-stable text. The caller ({@link
 * import('./index.js').runPreview}) prepends the {@link REVEAL_WARNING} line
 * when `--reveal` is set; this returns the body for the kind.
 */
export function renderPreview(
  kind: PreviewKind,
  preview: PreviewWorld,
  options: RenderOptions,
): string {
  switch (kind) {
    case 'city':
      return renderCity(preview.world);
    case 'locations':
      return renderLocations(preview.world, options);
    case 'npcs':
      return renderNpcs(preview.world, options);
    case 'documents':
      return renderDocuments(preview.world, options, undefined);
    case 'dossiers':
      return renderDocuments(preview.world, options, 'dossier');
    case 'cables':
      return renderDocuments(preview.world, options, 'cable');
    case 'newspaper':
      return renderNewspaper(preview.world, options);
    case 'fact-lines':
      return renderFactLines(preview, options);
    case 'intercepts':
      return renderIntercepts(preview, options);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The local part of a namespaced id (`loc:kiosk` -> `kiosk`). */
function localOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
}

/** Order ids for a total, stable listing. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A section header line, e.g. `== City ==`. */
function heading(title: string): string {
  return `== ${title} ==`;
}

// ---------------------------------------------------------------------------
// city — the Instantiated City summary (Districts and Routes)
// ---------------------------------------------------------------------------

/**
 * Render the city summary: its display name and id, its Districts (with sector)
 * and its Routes with costs (design: "a summary of the Instantiated City with
 * Districts and Routes"). All of it is published geography, so there is nothing
 * `--reveal` adds here.
 */
function renderCity(world: WorldState): string {
  const city = world.city;
  const lines: string[] = [];
  lines.push(heading(`City: ${city.displayName}`));
  lines.push(`setting: ${world.meta.setting.city} (year ${world.meta.setting.year})`);
  lines.push(`districts: ${Object.keys(city.districts).length}`);
  lines.push(`locations: ${Object.keys(city.locations).length}`);
  lines.push(`routes: ${city.routes.length}`);

  lines.push('');
  lines.push(heading('Districts'));
  const districts = Object.values(city.districts).sort((a, b) => compareIds(a.id, b.id));
  for (const d of districts) {
    lines.push(`- ${d.name} [${localOf(d.id)}] — sector ${d.sector}`);
  }

  lines.push('');
  lines.push(heading('Routes'));
  const routes = [...city.routes].sort(
    (a, b) => compareIds(a.a, b.a) || compareIds(a.b, b.b),
  );
  for (const r of routes) {
    const from = city.districts[r.a]?.name ?? localOf(r.a);
    const to = city.districts[r.b]?.name ?? localOf(r.b);
    lines.push(`- ${from} <-> ${to} (cost ${r.cost})`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// locations
// ---------------------------------------------------------------------------

/**
 * Render the city's Locations: name, type, District and risk, with the public
 * flag. These are the view-safe facts the scene/map projections expose; nothing
 * here is truth, so `--reveal` adds nothing.
 */
function renderLocations(world: WorldState, options: RenderOptions): string {
  const city = world.city;
  const locations = Object.values(city.locations)
    .slice()
    .sort((a, b) => compareIds(a.id, b.id))
    .slice(0, options.count);

  const lines: string[] = [heading(`Locations (${locations.length})`)];
  for (const loc of locations) {
    const district = city.districts[loc.district]?.name ?? localOf(loc.district);
    const flags = loc.public ? ' (public)' : '';
    lines.push(`- ${loc.name} [${localOf(loc.id)}]${flags}`);
    lines.push(`    type: ${loc.type}  district: ${district}  risk: ${loc.risk}`);
    if (loc.atmosphere.length > 0) {
      lines.push(`    atmosphere: ${loc.atmosphere.join(', ')}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// npcs
// ---------------------------------------------------------------------------

/**
 * Render the generated NPCs through the player-perspective label: the persona
 * name once identified, the physical descriptor until then (`personLabel`). A
 * freshly generated world has identified no one, so the plain output is the
 * descriptor the player would first see. With `--reveal` the renderer adds the
 * ground truth the label hides: the persona name, the Culture Group and gender,
 * and the true allegiance.
 */
function renderNpcs(world: WorldState, options: RenderOptions): string {
  const npcs = Object.values(world.npcs)
    .slice()
    .sort((a, b) => compareIds(a.id, b.id))
    .slice(0, options.count);

  const lines: string[] = [heading(`NPCs (${npcs.length})`)];
  for (const npc of npcs) {
    const label = personLabel(world, npc.id);
    // The apparent allegiance is view-safe (the category the NPC presents), so
    // it is shown without `--reveal`.
    lines.push(`- ${label.label}  [apparent: ${npc.apparentAllegiance}]`);
    if (options.reveal) {
      const allegiance = revealTruth(npc.trueAllegiance);
      lines.push(
        `    truth: ${npc.persona.name} — ${npc.persona.culture}/${npc.persona.gender}` +
          ` — role ${npc.role} — true allegiance ${allegiance.org}`,
      );
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// documents / dossiers / cables
// ---------------------------------------------------------------------------

/**
 * Render the world's Documents of a kind (or every kind for `documents`): the
 * title, kind and date, and the fact-layer `body` the Document reader shows. A
 * Document carries no truth field by construction, so `--reveal` adds nothing.
 */
function renderDocuments(
  world: WorldState,
  options: RenderOptions,
  only: Document['kind'] | undefined,
): string {
  const docs = Object.values(world.documents)
    .filter((d) => only === undefined || d.kind === only)
    .sort((a, b) => compareIds(a.id, b.id))
    .slice(0, options.count);

  const title = only === undefined ? 'Documents' : capitalise(`${only}s`);
  const lines: string[] = [heading(`${title} (${docs.length})`)];
  for (const doc of docs) {
    lines.push('');
    lines.push(`--- ${doc.title} [${doc.kind}] ---`);
    lines.push(doc.body);
  }
  return lines.join('\n');
}

/** Capitalise the first letter of a label (`dossiers` -> `Dossiers`). */
function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// newspaper
// ---------------------------------------------------------------------------

/**
 * Render the latest published newspaper edition (the world is advanced so one
 * exists). The edition is an ordinary Document, so its fact-layer body is the
 * view-safe text; `--reveal` adds nothing a reader of the paper could not see.
 */
function renderNewspaper(world: WorldState, options: RenderOptions): string {
  void options;
  const days = Object.keys(world.newspapers)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (days.length === 0) {
    return heading('Newspaper') + '\nno edition published yet';
  }
  const lastDay = days[days.length - 1];
  const docId = world.newspapers[lastDay];
  const doc = docId === undefined ? undefined : world.documents[docId];
  if (doc === undefined) {
    return heading('Newspaper') + '\nno edition published yet';
  }
  return [heading(`Newspaper — ${doc.title}`), '', doc.body].join('\n');
}

// ---------------------------------------------------------------------------
// fact-lines
// ---------------------------------------------------------------------------

/**
 * Render third-person Fact Lines for a deterministic sample of the first days'
 * facts, through the player-perspective namer (design: "the third-person
 * predicate templates for a deterministic sample of Sim events from the first 3
 * days, through the player-perspective namer").
 *
 * The sample is the Propositions behind the Documents the world holds after the
 * advance (the brief, the Dossiers, and each published edition's asserts),
 * de-duplicated and id-ordered so the sample is stable. Each is rendered with
 * {@link renderPropositionLine}, which uses the predicate's third-person
 * template and the player namer — exactly the Fact Line the game shows. These
 * Propositions are the apparent facts the Documents assert (not ground truth),
 * so the output is identical with or without `--reveal`.
 */
function renderFactLines(preview: PreviewWorld, options: RenderOptions): string {
  const { world, content } = preview;
  const props = sampleFactPropositions(world);
  const lines: string[] = [heading('Fact Lines')];
  for (const prop of props.slice(0, options.count)) {
    lines.push(`- ${renderPropositionLine(content, world, prop)}`);
  }
  return lines.join('\n');
}

/**
 * The deterministic sample of Propositions the Fact Lines render: every
 * Document's asserted Propositions, resolved through `documentPropositions`,
 * de-duplicated by Proposition id and ordered by id so the sample is stable
 * across runs.
 */
function sampleFactPropositions(world: WorldState): Proposition[] {
  const byId = new Map<string, Proposition>();
  for (const doc of Object.values(world.documents)) {
    for (const propId of doc.asserts) {
      const prop = world.documentPropositions[propId];
      if (prop !== undefined && !byId.has(prop.id)) {
        byId.set(prop.id, prop);
      }
    }
  }
  return [...byId.values()].sort((a, b) => compareIds(a.id, b.id));
}

// ---------------------------------------------------------------------------
// intercepts
// ---------------------------------------------------------------------------

/**
 * Render the world's intercepted traffic: the ciphertext captures the Cipher
 * Engine minted for the world's Transmissions. Each entry prints the view-safe
 * traffic metadata (channel, owner, direction, time, length, optional header
 * crib) and the ciphertext. With `--reveal` it additionally prints the
 * recovered plaintext — the design's "`intercepts` prints plaintexts only with
 * `--reveal` and ciphertexts otherwise" — decrypting each Intercept with its
 * true cipher spec against the world's own cipher key material.
 */
function renderIntercepts(preview: PreviewWorld, options: RenderOptions): string {
  const { world } = preview;
  const intercepts = Object.values(world.intercepts)
    .concat(world.transmissions.map((t) => t.intercept))
    .reduce<Map<string, Intercept>>((acc, i) => {
      if (!acc.has(i.id)) {
        acc.set(i.id, i);
      }
      return acc;
    }, new Map());
  const sorted = [...intercepts.values()]
    .sort((a, b) => compareIds(a.id, b.id))
    .slice(0, options.count);

  const cipherKeys = options.reveal
    ? worldCipherKeyLookup(world.meta.seed, world.documents)
    : undefined;

  const lines: string[] = [heading(`Intercepts (${sorted.length})`)];
  for (const intercept of sorted) {
    lines.push('');
    const header =
      intercept.meta.header !== undefined ? `  header "${intercept.meta.header}"` : '';
    const callsign =
      intercept.meta.callsign !== undefined ? `  callsign ${intercept.meta.callsign}` : '';
    lines.push(
      `--- ${intercept.channel} (${intercept.owner}, ${intercept.direction}) ` +
        `day ${intercept.at.day} phase ${intercept.at.phase} ` +
        `len ${intercept.meta.length}${callsign}${header} ---`,
    );
    lines.push(`ciphertext: ${intercept.ciphertext}`);
    if (cipherKeys !== undefined) {
      const spec = resolveCipherSpec(revealedSpec(intercept), cipherKeys);
      lines.push(`plaintext: ${decryptToFieldMessage(intercept, spec)}`);
    }
  }
  return lines.join('\n');
}
