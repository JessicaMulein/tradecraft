/**
 * Street-data fetch and the offline street-graph builder (street-ops task 13).
 *
 * Fetch is the only command that talks to the network, and only after the
 * named source's licence is accepted. The builder, the period pass and the
 * review sheets read files already on disk.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { parse, stringify } from 'yaml';

export interface StreetSource {
  readonly name: string;
  readonly kind: 'geometry' | 'period-names' | 'imagery';
  readonly method: string;
  readonly url: string;
  readonly licence: string;
  readonly licenceText: string;
  readonly attribution: string;
  readonly query?: string;
  readonly layer?: string;
  readonly city?: string;
  readonly stores?: readonly string[];
}

export interface BBox {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

export interface Acceptance {
  readonly source: string;
  readonly area: string;
  readonly accepted: string;
  readonly licence: string;
  readonly attribution: string;
}

const DRIVABLE = new Set([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
]);

const CONFIDENCE = new Set(['certain', 'likely', 'inferred']);
const OVERRIDE_OPS = new Set(['rename', 'remove', 'add', 'close', 'reclassify', 'replace-area']);

export function loadStreetSources(text: string): readonly StreetSource[] {
  const parsed = parse(text) as { sources?: StreetSource[] };
  return parsed.sources ?? [];
}

export function sourceByName(sources: readonly StreetSource[], name: string): StreetSource | undefined {
  return sources.find((source) => source.name === name);
}

export function parseBBox(text: string): BBox | undefined {
  const parts = text.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return undefined;
  const [south, west, north, east] = parts;
  if (south === undefined || west === undefined || north === undefined || east === undefined) return undefined;
  if (south >= north || west >= east) return undefined;
  return { south, west, north, east };
}

export function licenceNotice(source: StreetSource): string {
  return [`Source: ${source.name}`, `Licence: ${source.licence}`, source.licenceText.trim(), `Attribution: ${source.attribution}`].join('\n');
}

export interface FetchRequest {
  readonly source: StreetSource;
  readonly city: string;
  readonly area: string;
  readonly acceptLicence: string | undefined;
  readonly outDir: string;
  readonly now: string;
  readonly get: (url: string) => Promise<string> | string;
}

export async function fetchStreetSource(request: FetchRequest): Promise<{ readonly ok: true; readonly notice: string; readonly dir: string } | { readonly ok: false; readonly notice: string; readonly error: string }> {
  const notice = licenceNotice(request.source);
  if (request.acceptLicence !== request.source.name) {
    return { ok: false, notice, error: `refusing to fetch ${request.source.name} without --accept-licence ${request.source.name}` };
  }
  const box = parseBBox(request.area);
  if (box === undefined) return { ok: false, notice, error: 'area must be south,west,north,east' };
  const url = requestUrl(request.source, box);
  let body = await request.get(url);
  if (request.source.method === 'overpass' && !body.trimStart().startsWith('{')) {
    const map = `https://api.openstreetmap.org/api/0.6/map?bbox=${box.west},${box.south},${box.east},${box.north}`;
    const xml = await request.get(map);
    if (xml.includes('<osm')) body = osmMapToOverpassJson(xml);
  }
  if (request.source.method === 'wms' && body.trimStart().startsWith('<')) {
    return { ok: false, notice, error: 'the imagery service rejected the layer' };
  }
  if (request.source.method === 'wmts' && request.source.layer !== undefined) {
    const tiles = tileRange(box, 16);
    const lines: string[] = [];
    for (const tile of tiles) {
      const tileUrl = `${request.source.url.replace(/\/$/, '')}/${request.source.layer}/grau/google3857/16/${tile.y}/${tile.x}.jpeg`;
      const bytes = tileUrl === url ? body : await request.get(tileUrl);
      const name = `${request.source.layer}-${tile.x}-${tile.y}.jpeg`;
      lines.push(name);
      mkdirSync(join(request.outDir, request.source.name, request.city), { recursive: true });
      writeFileSync(join(request.outDir, request.source.name, request.city, name), bytes);
    }
    body = lines.join('\n');
  }
  const dir = join(request.outDir, request.source.name, request.city);
  mkdirSync(dir, { recursive: true });
  const acceptance: Acceptance = {
    source: request.source.name,
    area: request.area,
    accepted: request.now,
    licence: request.source.licence,
    attribution: request.source.attribution,
  };
  writeFileSync(join(dir, 'acceptance.yaml'), stringify(acceptance));
  writeFileSync(join(dir, 'body.txt'), body);
  if (request.source.method === 'mediawiki') {
    let records: PeriodRecord[] = [];
    try {
      records = wikiAskToRecords(body);
    } catch {
      records = [];
    }
    writeFileSync(join(dir, 'records.json'), JSON.stringify(records));
  }
  return { ok: true, notice, dir };
}

export function requestUrl(source: StreetSource, box: BBox): string {
  const query = (source.query ?? '').replaceAll('{south}', String(box.south)).replaceAll('{west}', String(box.west)).replaceAll('{north}', String(box.north)).replaceAll('{east}', String(box.east));
  if (source.method === 'overpass') return `${source.url}?data=${encodeURIComponent(query)}`;
  if (source.method === 'mediawiki') {
    const ask = query === '' ? '[[Kategorie:Topografisches Objekt]]|?Datum von|?Datum bis|?Frühere Bezeichnung|limit=20' : query;
    return `${source.url}?action=ask&format=json&query=${encodeURIComponent(ask)}`;
  }
  if (source.method === 'wmts' && source.layer !== undefined) {
    const tile = tileRange(box, 16)[0];
    const zoom = tile ?? { x: 0, y: 0 };
    return `${source.url.replace(/\/$/, '')}/${source.layer}/grau/google3857/16/${zoom.y}/${zoom.x}.jpeg`;
  }
  if (source.method === 'wms' && source.layer !== undefined) {
    return `${source.url}?service=WMS&version=1.1.1&request=GetMap&layers=${encodeURIComponent(source.layer)}&styles=&bbox=${box.west},${box.south},${box.east},${box.north}&width=256&height=256&format=image/png&srs=EPSG:4326`;
  }
  if (source.layer !== undefined) return `${source.url}?layer=${encodeURIComponent(source.layer)}&bbox=${box.west},${box.south},${box.east},${box.north}`;
  return `${source.url}?city=${encodeURIComponent(source.city ?? '')}`;
}

function tileXY(lat: number, lon: number, zoom: number): { readonly x: number; readonly y: number } {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y };
}

function tileRange(box: BBox, zoom: number): { readonly x: number; readonly y: number }[] {
  const sw = tileXY(box.south, box.west, zoom);
  const ne = tileXY(box.north, box.east, zoom);
  const out: { x: number; y: number }[] = [];
  const x0 = Math.min(sw.x, ne.x);
  const x1 = Math.max(sw.x, ne.x);
  const y0 = Math.min(sw.y, ne.y);
  const y1 = Math.max(sw.y, ne.y);
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      out.push({ x, y });
      if (out.length >= 36) return out;
    }
  }
  return out;
}

interface Point {
  readonly lon: number;
  readonly lat: number;
}

interface Way {
  readonly id: string;
  readonly name: string;
  readonly highway: string;
  readonly oneway: boolean;
  readonly points: readonly Point[];
}

export function readWays(text: string): Way[] {
  const parsed = JSON.parse(text) as {
    features?: { geometry?: { type?: string; coordinates?: number[][] }; properties?: Record<string, string> }[];
    elements?: { type?: string; id?: number; tags?: Record<string, string>; geometry?: { lon: number; lat: number }[] }[];
  };
  const ways: Way[] = [];
  for (const feature of parsed.features ?? []) {
    if (feature.geometry?.type !== 'LineString' || feature.geometry.coordinates === undefined) continue;
    const name = feature.properties?.name ?? feature.properties?.['name'] ?? '';
    const highway = feature.properties?.highway ?? '';
    if (!DRIVABLE.has(highway) || name === '') continue;
    ways.push({
      id: feature.properties?.id ?? name,
      name,
      highway,
      oneway: feature.properties?.oneway === 'yes',
      points: feature.geometry.coordinates.map(([lon, lat]) => ({ lon: lon ?? 0, lat: lat ?? 0 })),
    });
  }
  for (const element of parsed.elements ?? []) {
    if (element.type !== 'way' || element.geometry === undefined) continue;
    const name = element.tags?.name ?? '';
    const highway = element.tags?.highway ?? '';
    if (!DRIVABLE.has(highway) || name === '') continue;
    ways.push({
      id: String(element.id ?? name),
      name,
      highway,
      oneway: element.tags?.oneway === 'yes',
      points: element.geometry.map((point) => ({ lon: point.lon, lat: point.lat })),
    });
  }
  ways.sort((a, b) => a.id.localeCompare(b.id));
  return ways;
}

/**
 * Turn an OpenStreetMap map response into the Overpass JSON `readWays` reads.
 * Only named drivable highways are kept. A `oneway=-1` way is reversed so the
 * stored direction is the legal one.
 */
export function osmMapToOverpassJson(xml: string): string {
  const nodes = new Map<string, { lon: number; lat: number }>();
  const nodePattern = /<node id="(\d+)"[^>]* lat="([^"]+)" lon="([^"]+)"/g;
  for (const match of xml.matchAll(nodePattern)) {
    const id = match[1];
    const lat = Number(match[2]);
    const lon = Number(match[3]);
    if (id === undefined || Number.isNaN(lat) || Number.isNaN(lon)) continue;
    nodes.set(id, { lon, lat });
  }
  const elements: {
    type: 'way';
    id: number;
    tags: Record<string, string>;
    geometry: { lon: number; lat: number }[];
  }[] = [];
  for (const chunk of xml.split('<way ')) {
    if (!chunk.startsWith('id="')) continue;
    const id = Number(chunk.slice(4, chunk.indexOf('"')));
    const tags: Record<string, string> = {};
    for (const tag of chunk.matchAll(/<tag k="([^"]+)" v="([^"]*)"\/>/g)) {
      const key = tag[1];
      const value = tag[2];
      if (key !== undefined && value !== undefined) tags[key] = value;
    }
    const refs = [...chunk.matchAll(/<nd ref="(\d+)"\/>/g)].map((item) => item[1] ?? '');
    let geometry = refs.flatMap((ref) => {
      const point = nodes.get(ref);
      return point === undefined ? [] : [point];
    });
    if (tags.oneway === '-1') geometry = geometry.reverse();
    if (!Number.isFinite(id) || geometry.length < 2) continue;
    elements.push({
      type: 'way',
      id,
      tags: { ...tags, oneway: tags.oneway === '-1' ? 'yes' : (tags.oneway ?? 'no') },
      geometry,
    });
  }
  elements.sort((a, b) => a.id - b.id);
  return JSON.stringify({ elements });
}

function wikiYear(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const year = Number(raw.split('/')[1]);
  if (!Number.isInteger(year)) return undefined;
  return year;
}

function wikiTitle(title: string): string {
  return title.replace(/ \(\d+\)$/, '');
}

/** A wiki link stores the page title, not the label. */
function wikiLink(value: string): string {
  const linked = value.match(/^\[\[([^\]|]+)/);
  const title = linked?.[1] ?? value;
  return title.trim();
}

/** Facts from a Semantic MediaWiki `ask` response. Article text is dropped. */
export function wikiAskToRecords(json: string): PeriodRecord[] {
  const parsed = JSON.parse(json) as {
    query?: {
      results?: Record<
        string,
        {
          fulltext?: string;
          printouts?: {
            'Datum von'?: { raw?: string }[];
            'Datum bis'?: { raw?: string }[];
            'Frühere Bezeichnung'?: string[];
            Koordinaten?: { lat?: number; lon?: number }[];
          };
        }
      >;
    };
  };
  const results = parsed.query?.results ?? {};
  const records: PeriodRecord[] = [];
  for (const page of Object.values(results)) {
    const id = page.fulltext;
    if (id === undefined || id === '') continue;
    const prints = page.printouts ?? {};
    const fromYear = wikiYear(prints['Datum von']?.[0]?.raw);
    const toYear = wikiYear(prints['Datum bis']?.[0]?.raw);
    const point = prints.Koordinaten?.[0];
    const predecessors = (prints['Frühere Bezeichnung'] ?? []).map(wikiLink).filter((item) => item !== '');
    records.push({
      id,
      name: wikiTitle(id),
      ...(fromYear === undefined ? {} : { fromYear }),
      ...(toYear === undefined ? {} : { toYear }),
      predecessors,
      ...(point?.lat === undefined || point.lon === undefined ? {} : { lat: point.lat, lon: point.lon }),
    });
  }
  records.sort((a, b) => a.id.localeCompare(b.id));
  return records;
}

function speedOf(highway: string): 'slow' | 'normal' | 'fast' {
  if (highway === 'motorway' || highway === 'trunk') return 'fast';
  if (highway === 'primary' || highway === 'secondary') return 'normal';
  return 'slow';
}

function nodeId(point: Point): string {
  return `n-${point.lon.toFixed(5)}-${point.lat.toFixed(5)}`;
}

function metres(a: Point, b: Point): number {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const x = (b.lon - a.lon) * 111_320 * Math.cos(lat);
  const y = (b.lat - a.lat) * 110_540;
  return Math.hypot(x, y);
}

export interface BuiltSegment {
  readonly id: string;
  readonly street: string;
  readonly from: string;
  readonly to: string;
  readonly lengthM: number;
  readonly speed: 'slow' | 'normal' | 'fast';
  readonly oneWay: boolean;
  readonly lanes: number;
  readonly mapped: boolean;
  readonly closed: boolean;
  readonly highway: string;
  readonly traffic: { morning: number; afternoon: number; evening: number; night: number };
}

export interface BuiltGraph {
  readonly id: string;
  readonly city: string;
  readonly origin: 'built';
  readonly fidelity: 'modern-base' | 'period-checked' | 'period-authored';
  readonly sources: readonly { name: string; licence: string; attribution: string; retrieved: string }[];
  readonly verifiedArea: readonly (readonly (readonly [number, number])[])[];
  readonly junctions: readonly { id: string; x: number; y: number }[];
  readonly segments: readonly BuiltSegment[];
  readonly frontages: readonly { location: string; segment: string; at: number; side: 'left' | 'right' }[];
  readonly checkpoints: readonly [];
}

export interface LocationPoint {
  readonly id: string;
  readonly lon: number;
  readonly lat: number;
}

function pointInRing(x: number, y: number, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    const crosses = a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function insideArea(area: readonly (readonly (readonly [number, number])[])[], x: number, y: number): boolean {
  if (area.length === 0) return true;
  return area.some((ring) => pointInRing(x, y, ring));
}

export function buildGraph(input: {
  readonly city: string;
  readonly ways: readonly Way[];
  readonly locations: readonly LocationPoint[];
  readonly verifiedArea: readonly (readonly (readonly [number, number])[])[];
  readonly acceptance: Acceptance;
}): BuiltGraph {
  const keyOf = (point: Point): string => `${point.lon.toFixed(5)},${point.lat.toFixed(5)}`;
  const seen = new Map<string, number>();
  for (const way of input.ways) {
    for (const point of way.points) seen.set(keyOf(point), (seen.get(keyOf(point)) ?? 0) + 1);
  }
  const junctions = new Map<string, { id: string; x: number; y: number }>();
  const segments: BuiltSegment[] = [];
  for (const way of input.ways) {
    const cuts: number[] = [];
    way.points.forEach((point, index) => {
      const shared = (seen.get(keyOf(point)) ?? 0) > 1;
      if (index === 0 || index === way.points.length - 1 || shared) cuts.push(index);
    });
    for (let cut = 1; cut < cuts.length; cut += 1) {
      const start = cuts[cut - 1];
      const end = cuts[cut];
      if (start === undefined || end === undefined) continue;
      const fromPoint = way.points[start];
      const toPoint = way.points[end];
      if (fromPoint === undefined || toPoint === undefined) continue;
      const from = nodeId(fromPoint);
      const to = nodeId(toPoint);
      if (from === to) continue;
      junctions.set(from, { id: from, x: Number(fromPoint.lon.toFixed(5)), y: Number(fromPoint.lat.toFixed(5)) });
      junctions.set(to, { id: to, x: Number(toPoint.lon.toFixed(5)), y: Number(toPoint.lat.toFixed(5)) });
      let length = 0;
      for (let i = start + 1; i <= end; i += 1) {
        const prev = way.points[i - 1];
        const next = way.points[i];
        if (prev === undefined || next === undefined) continue;
        length += metres(prev, next);
      }
      const midLon = (fromPoint.lon + toPoint.lon) / 2;
      const midLat = (fromPoint.lat + toPoint.lat) / 2;
      const mapped = insideArea(input.verifiedArea, midLon, midLat);
      segments.push({
        id: `s-${way.id}-${cut}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
        street: way.name,
        from,
        to,
        lengthM: Math.max(1, Math.round(length)),
        speed: speedOf(way.highway),
        oneWay: way.oneway,
        lanes: way.oneway ? 1 : 2,
        mapped,
        closed: false,
        highway: way.highway,
        traffic: { morning: 1, afternoon: 1, evening: 1, night: 1 },
      });
    }
  }
  segments.sort((a, b) => a.id.localeCompare(b.id));
  const frontages = input.locations.map((location) => {
    let best = segments[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const segment of segments) {
      const from = junctions.get(segment.from);
      const to = junctions.get(segment.to);
      if (from === undefined || to === undefined) continue;
      const distance = Math.hypot(location.lon - (from.x + to.x) / 2, location.lat - (from.y + to.y) / 2);
      if (distance < bestDistance) {
        best = segment;
        bestDistance = distance;
      }
    }
    return { location: location.id, segment: best?.id ?? '', at: 0.5, side: 'right' as const };
  }).filter((frontage) => frontage.segment !== '');
  frontages.sort((a, b) => a.location.localeCompare(b.location));
  const junctionList = [...junctions.values()].sort((a, b) => a.id.localeCompare(b.id));
  return {
    id: input.city.replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
    city: input.city,
    origin: 'built',
    fidelity: 'modern-base',
    sources: [{ name: input.acceptance.source, licence: input.acceptance.licence, attribution: input.acceptance.attribution, retrieved: input.acceptance.accepted }],
    verifiedArea: input.verifiedArea,
    junctions: junctionList,
    segments,
    frontages,
    checkpoints: [],
  };
}

export interface OverrideOp {
  readonly op: string;
  readonly street?: string;
  readonly segment?: string;
  readonly name?: string;
  readonly oneWay?: boolean;
  readonly highway?: string;
  readonly source?: string;
  readonly confidence?: string;
  readonly from?: string;
  readonly to?: string;
  readonly points?: readonly (readonly [number, number])[];
  readonly area?: readonly (readonly [number, number])[];
  readonly add?: readonly { readonly street: string; readonly from: string; readonly to: string; readonly lengthM?: number }[];
}

export function applyOverrides(graph: BuiltGraph, ops: readonly OverrideOp[]): { readonly graph: BuiltGraph; readonly errors: readonly string[] } {
  const errors: string[] = [];
  let segments = [...graph.segments];
  let junctions = [...graph.junctions];
  for (const op of ops) {
    if (!OVERRIDE_OPS.has(op.op)) {
      errors.push(`unknown override ${op.op}`);
      continue;
    }
    if (op.source === undefined || op.source === '' || op.confidence === undefined || !CONFIDENCE.has(op.confidence)) {
      errors.push(`${op.op} needs a source and a confidence`);
      continue;
    }
    if (op.op === 'add') {
      if (op.from === undefined || op.to === undefined || op.name === undefined) {
        errors.push('add needs a name and endpoints');
        continue;
      }
      const id = `s-add-${segments.length}`;
      segments.push({
        id,
        street: op.name,
        from: op.from,
        to: op.to,
        lengthM: 10,
        speed: 'slow',
        oneWay: op.oneWay === true,
        lanes: 1,
        mapped: true,
        closed: false,
        highway: 'residential',
        traffic: { morning: 1, afternoon: 1, evening: 1, night: 1 },
      });
      continue;
    }
    const index = segments.findIndex((segment) => segment.id === op.segment || segment.street === op.street);
    if (op.op !== 'replace-area' && index < 0) {
      errors.push(`${op.op} target does not exist`);
      continue;
    }
    if (op.op === 'rename' && index >= 0 && op.name !== undefined) {
      const current = segments[index];
      if (current !== undefined) segments[index] = { ...current, street: op.name };
    }
    if (op.op === 'remove' && index >= 0) segments.splice(index, 1);
    if (op.op === 'close' && index >= 0) {
      const current = segments[index];
      if (current !== undefined) segments[index] = { ...current, closed: true };
    }
    if (op.op === 'reclassify' && index >= 0) {
      const current = segments[index];
      if (current !== undefined) {
        segments[index] = {
          ...current,
          ...(op.oneWay === undefined ? {} : { oneWay: op.oneWay }),
          ...(op.highway === undefined ? {} : { highway: op.highway, speed: speedOf(op.highway) }),
        };
      }
    }
    if (op.op === 'replace-area' && op.area !== undefined) {
      segments = segments.filter((segment) => {
        const from = junctions.find((junction) => junction.id === segment.from);
        const to = junctions.find((junction) => junction.id === segment.to);
        if (from === undefined || to === undefined) return true;
        return !pointInRing((from.x + to.x) / 2, (from.y + to.y) / 2, op.area ?? []);
      });
      for (const added of op.add ?? []) {
        segments.push({
          id: `s-add-${segments.length}-${added.street}`,
          street: added.street,
          from: added.from,
          to: added.to,
          lengthM: added.lengthM ?? 10,
          speed: 'slow',
          oneWay: false,
          lanes: 1,
          mapped: true,
          closed: false,
          highway: 'residential',
          traffic: { morning: 1, afternoon: 1, evening: 1, night: 1 },
        });
      }
    }
  }
  segments.sort((a, b) => a.id.localeCompare(b.id));
  junctions = junctions.filter((junction) => segments.some((segment) => segment.from === junction.id || segment.to === junction.id));
  return { graph: { ...graph, junctions, segments }, errors };
}

export function readAcceptance(dir: string): Acceptance | undefined {
  try {
    return parse(readFileSync(join(dir, 'acceptance.yaml'), 'utf8')) as Acceptance;
  } catch {
    return undefined;
  }
}

export function buildAccepted(input: {
  readonly dataDir: string;
  readonly city: string;
  readonly body: string;
  readonly locations: readonly LocationPoint[];
  readonly verifiedArea: readonly (readonly (readonly [number, number])[])[];
}): { readonly ok: true; readonly graph: BuiltGraph } | { readonly ok: false; readonly error: string } {
  const acceptance = readAcceptance(input.dataDir);
  if (acceptance === undefined) return { ok: false, error: 'no licence acceptance is recorded for this dataset' };
  const graph = buildGraph({
    city: input.city,
    ways: readWays(input.body),
    locations: input.locations,
    verifiedArea: input.verifiedArea,
    acceptance,
  });
  return { ok: true, graph };
}

export function writeBuiltPack(graph: BuiltGraph, outDir: string): { readonly graphPath: string; readonly attributionPath: string; readonly hash: string } {
  const graphPath = join(outDir, 'graphs', 'streets.yaml');
  const body = stringify({ items: [graph] });
  const hash = createHash('sha256').update(body).digest('hex');
  mkdirSync(dirname(graphPath), { recursive: true });
  writeFileSync(graphPath, body);
  writeFileSync(
    join(outDir, 'pack.yaml'),
    stringify({
      id: 'street-ops-local',
      version: '1.0.0',
      contentSchema: 2,
      role: 'extension',
      requires: [],
      overrides: [],
    }),
  );
  const attributionPath = join(outDir, 'ATTRIBUTION.md');
  const lines = ['# Street data attribution', '', ...graph.sources.map((source) => `- ${source.attribution} (${source.licence}, retrieved ${source.retrieved})`), '', `Graph sha256: ${hash}`, ''];
  writeFileSync(attributionPath, lines.join('\n'));
  const coverage = streetCoverage(graph);
  writeFileSync(join(outDir, 'COVERAGE.md'), coverage);
  return { graphPath, attributionPath, hash };
}

export function streetCoverage(graph: BuiltGraph): string {
  const locations = new Set(graph.frontages.map((frontage) => frontage.location));
  const withFrontage = locations.size;
  const share = graph.frontages.length === 0 ? 0 : 1;
  return [
    '# Street graph coverage',
    '',
    `| city | junctions | segments | locations with a frontage | share |`,
    `| --- | ---: | ---: | ---: | ---: |`,
    `| ${graph.city} | ${graph.junctions.length} | ${graph.segments.length} | ${withFrontage} | ${share.toFixed(2)} |`,
    '',
  ].join('\n');
}

export function attributionLines(graph: BuiltGraph): readonly string[] {
  return graph.sources.map((source) => `${source.attribution} (${source.licence})`);
}

export interface PeriodRecord {
  readonly id: string;
  readonly name: string;
  readonly fromYear?: number;
  readonly toYear?: number;
  readonly predecessors: readonly string[];
  readonly lat?: number;
  readonly lon?: number;
}

export type PeriodResolution =
  | { readonly status: 'rename'; readonly name: string; readonly cite: string }
  | { readonly status: 'unchanged'; readonly name: string }
  | { readonly status: 'not-yet-built'; readonly cite: string }
  | { readonly status: 'overlap'; readonly names: readonly string[] }
  | { readonly status: 'gap' }
  | { readonly status: 'no-record' };

function containsYear(record: PeriodRecord, year: number): boolean {
  if (record.fromYear !== undefined && year < record.fromYear) return false;
  if (record.toYear !== undefined && year > record.toYear) return false;
  return record.fromYear !== undefined || record.toYear !== undefined;
}

function chain(records: readonly PeriodRecord[], start: PeriodRecord): PeriodRecord[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const out: PeriodRecord[] = [];
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current.id)) continue;
    seen.add(current.id);
    out.push(current);
    for (const id of current.predecessors) {
      const next = byId.get(id);
      if (next !== undefined) queue.push(next);
    }
  }
  return out;
}

export function resolvePeriodName(records: readonly PeriodRecord[], modernName: string, year: number): PeriodResolution {
  const start = records.find((record) => record.name === modernName);
  if (start === undefined) return { status: 'no-record' };
  const linked = chain(records, start);
  const hits = linked.filter((record) => containsYear(record, year));
  if (hits.length > 1) return { status: 'overlap', names: hits.map((record) => record.name).sort((a, b) => a.localeCompare(b)) };
  if (hits.length === 1) {
    const hit = hits[0];
    if (hit === undefined) return { status: 'no-record' };
    if (hit.name === modernName) return { status: 'unchanged', name: modernName };
    return { status: 'rename', name: hit.name, cite: hit.id };
  }
  const earliest = linked.reduce((min, record) => (record.fromYear === undefined ? min : Math.min(min, record.fromYear)), Number.POSITIVE_INFINITY);
  if (earliest !== Number.POSITIVE_INFINITY && earliest > year) return { status: 'not-yet-built', cite: start.id };
  return { status: 'gap' };
}

export interface PeriodReport {
  readonly year: number;
  readonly overrides: readonly OverrideOp[];
  readonly open: readonly { readonly street: string; readonly reason: string; readonly names?: readonly string[] }[];
  readonly confirmed: number;
  readonly changed: number;
  readonly unchecked: number;
}

export function periodPass(graph: BuiltGraph, records: readonly PeriodRecord[], year: number): PeriodReport {
  const overrides: OverrideOp[] = [];
  const open: { street: string; reason: string; names?: readonly string[] }[] = [];
  let confirmed = 0;
  let changed = 0;
  let unchecked = 0;
  const seenStreets = new Set<string>();
  for (const segment of graph.segments) {
    if (!segment.mapped || seenStreets.has(segment.street)) continue;
    seenStreets.add(segment.street);
    const resolved = resolvePeriodName(records, segment.street, year);
    if (resolved.status === 'no-record' || resolved.status === 'gap') {
      unchecked += 1;
      open.push({ street: segment.street, reason: resolved.status });
    } else if (resolved.status === 'overlap') {
      unchecked += 1;
      open.push({ street: segment.street, reason: 'overlap', names: resolved.names });
    } else if (resolved.status === 'not-yet-built') {
      changed += 1;
      confirmed += 1;
      overrides.push({ op: 'remove', street: segment.street, source: resolved.cite, confidence: 'certain' });
    } else if (resolved.status === 'rename') {
      changed += 1;
      confirmed += 1;
      overrides.push({ op: 'rename', street: segment.street, name: resolved.name, source: resolved.cite, confidence: 'certain' });
    } else {
      confirmed += 1;
    }
  }
  return { year, overrides, open, confirmed, changed, unchecked };
}

export function fidelityFor(report: PeriodReport, reviewedTiles: number, tileCount: number): 'modern-base' | 'period-checked' {
  if (report.unchecked === 0 && report.open.length === 0 && reviewedTiles >= tileCount) return 'period-checked';
  return 'modern-base';
}

export function fidelityWarning(graph: { readonly fidelity?: string; readonly sources?: readonly { retrieved?: string }[] }, periodTo: number | undefined): string | undefined {
  if (graph.fidelity !== 'modern-base') return undefined;
  const retrieved = graph.sources?.[0]?.retrieved;
  const year = retrieved === undefined ? undefined : Number(retrieved.slice(0, 4));
  if (periodTo === undefined || year === undefined || Number.isNaN(year) || year <= periodTo) return undefined;
  return `modern-base street graph was retrieved in ${year}, after the period window ends in ${periodTo}. Vienna and other old cities need hand overrides before this graph is period-checked.`;
}

export interface ReviewLine {
  readonly street: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface ReviewTile {
  readonly id: string;
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
  readonly segments: readonly string[];
  readonly lines: readonly ReviewLine[];
  readonly layers: readonly string[];
}

function projectPoint(x: number, y: number, box: BBox): { readonly x: number; readonly y: number } {
  const width = box.east - box.west || 1;
  const height = box.north - box.south || 1;
  return { x: ((x - box.west) / width) * 100, y: ((box.north - y) / height) * 100 };
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function layerImage(imageryDir: string | undefined, layer: string, sheetDir: string): string | undefined {
  if (imageryDir === undefined || !existsSync(imageryDir)) return undefined;
  const names = readdirSync(imageryDir)
    .filter((name) => name.startsWith(`${layer}-`) || name.startsWith(`${layer}.`))
    .sort((a, b) => a.localeCompare(b));
  const name = names[0];
  if (name === undefined) return undefined;
  return relative(sheetDir, join(imageryDir, name)).split('\\').join('/');
}

/** The period layer is the backdrop. Segment lines are drawn over it. */
function sheetSvg(layer: string, lines: readonly ReviewLine[], imageHref: string | undefined): string {
  const marks = lines
    .map((line) => `<line x1="${line.x1.toFixed(1)}" y1="${line.y1.toFixed(1)}" x2="${line.x2.toFixed(1)}" y2="${line.y2.toFixed(1)}" stroke="currentColor" stroke-width="1"><title>${xml(line.street)}</title></line>`)
    .join('');
  const backdrop =
    imageHref === undefined
      ? `<rect width="100" height="100" fill="none" stroke="currentColor"/><text x="2" y="8" font-size="4">${xml(layer)}</text>`
      : `<image href="${xml(imageHref)}" x="0" y="0" width="100" height="100" preserveAspectRatio="none"/>`;
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">${backdrop}${marks}</svg>`;
}

export function reviewTiles(graph: BuiltGraph, layers: readonly string[], metresPerTile = 300): ReviewTile[] {
  const xs = graph.junctions.map((junction) => junction.x);
  const ys = graph.junctions.map((junction) => junction.y);
  if (xs.length === 0 || ys.length === 0) return [];
  const west = Math.min(...xs);
  const east = Math.max(...xs);
  const south = Math.min(...ys);
  const north = Math.max(...ys);
  const span = metresPerTile / 111_320;
  const tiles: ReviewTile[] = [];
  let row = 0;
  for (let y = south; y <= north + span / 2; y += span) {
    let col = 0;
    for (let x = west; x <= east + span / 2; x += span) {
      const box = { west: x, south: y, east: x + span, north: y + span };
      const hits = graph.segments.filter((segment) => {
        if (!segment.mapped) return false;
        const from = graph.junctions.find((junction) => junction.id === segment.from);
        const to = graph.junctions.find((junction) => junction.id === segment.to);
        if (from === undefined || to === undefined) return false;
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        return mx >= box.west && mx < box.east && my >= box.south && my < box.north;
      });
      const segments = [...new Set(hits.map((segment) => segment.street))].sort((a, b) => a.localeCompare(b));
      const lines = hits.flatMap((segment) => {
        const from = graph.junctions.find((junction) => junction.id === segment.from);
        const to = graph.junctions.find((junction) => junction.id === segment.to);
        if (from === undefined || to === undefined) return [];
        const a = projectPoint(from.x, from.y, box);
        const b = projectPoint(to.x, to.y, box);
        return [{ street: segment.street, x1: a.x, y1: a.y, x2: b.x, y2: b.y }];
      });
      if (segments.length > 0) {
        tiles.push({ id: `tile-${col}-${row}`, ...box, segments, lines, layers });
      }
      col += 1;
      if (col > 50) break;
    }
    row += 1;
    if (row > 50) break;
  }
  return tiles;
}

export function writeReviewSheets(tiles: readonly ReviewTile[], outDir: string, imageryDir?: string): string[] {
  mkdirSync(outDir, { recursive: true });
  const paths: string[] = [];
  for (const tile of tiles) {
    const path = join(outDir, `${tile.id}.md`);
    const lines = [
      `# ${tile.id}`,
      '',
      `Extent: ${tile.west}, ${tile.south}, ${tile.east}, ${tile.north}`,
      '',
      'Period layers:',
      ...tile.layers.flatMap((layer) => ['', `### ${layer}`, '', sheetSvg(layer, tile.lines, layerImage(imageryDir, layer, outDir)), '']),
      '',
      'Modern segments:',
      ...tile.segments.map((street) => `- ${street}`),
      '',
      'Review this sheet and record overrides. A difference you cannot read stays an open Period Report item.',
      '',
    ];
    writeFileSync(path, lines.join('\n'));
    paths.push(path);
  }
  return paths;
}

export function coverageShares(report: PeriodReport): { readonly confirmed: number; readonly changed: number; readonly unchecked: number } {
  const total = report.confirmed + report.unchecked;
  if (total === 0) return { confirmed: 0, changed: 0, unchecked: 0 };
  return {
    confirmed: report.confirmed / total,
    changed: report.changed / total,
    unchecked: report.unchecked / total,
  };
}
