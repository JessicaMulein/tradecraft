/**
 * Regional cross-reference checks (multi-city task 1.2; Req 16.2, 16.4).
 *
 * The slice loader schema-checks caller-registered kinds and does not keep the
 * items. This check reads those items and refuses the load when a region
 * template, route, border post, jurisdiction entry or cross-city hook points
 * at something the Content Set did not load. Every failure is a
 * {@link ContentError}.
 */

import type { ContentError, ContentSet } from '@tradecraft/content';

import {
  BorderPostSchema,
  CrossCityStageHookSchema,
  IntercityRouteTemplateSchema,
  RegionTemplateSchema,
} from './content.js';

export interface RegionSource {
  readonly pack: string;
  readonly file: string;
  /** True when the file is a YAML list, so error paths start at `[i]`. */
  readonly list: boolean;
  readonly kind: string;
  readonly items: readonly unknown[];
}

/** Ids a regional reference may resolve to. All ids are namespaced where the loader namespaces them. */
export interface RegionRefs {
  readonly cities: ReadonlySet<string>;
  readonly districts: ReadonlySet<string>;
  readonly locations: ReadonlySet<string>;
  readonly locationTypes: ReadonlySet<string>;
  readonly services: ReadonlySet<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pathAt(source: RegionSource, index: number, rest: string): string {
  const base = source.list ? `[${index}]` : '';
  if (rest === '') {
    return base;
  }
  if (base === '') {
    return rest;
  }
  return rest.startsWith('[') ? `${base}${rest}` : `${base}.${rest}`;
}

function issue(source: RegionSource, path: string, message: string): ContentError {
  return { pack: source.pack, file: source.file, path, message };
}

function refResolves(ref: string, pack: string, ids: ReadonlySet<string>): boolean {
  if (ids.has(ref)) {
    return true;
  }
  return !ref.includes('/') && ids.has(`${pack}/${ref}`);
}

function dangling(source: RegionSource, path: string, what: string, ref: string): ContentError {
  return issue(source, path, `${what} "${ref}" does not resolve to any loaded content`);
}

/** City, district, location, location-type and service ids the loaded set can satisfy. */
export function regionRefs(set: ContentSet): RegionRefs {
  const cities = new Set(Object.keys(set.cities));
  const districts = new Set<string>();
  const locations = new Set<string>();
  const locationTypes = new Set(set.locationTypes.keys());
  for (const [cityId, bundle] of Object.entries(set.cities)) {
    const slash = cityId.indexOf('/');
    const pack = slash === -1 ? cityId : cityId.slice(0, slash);
    districts.add(cityId);
    for (const district of bundle.districts) {
      districts.add(district.id);
      districts.add(`${pack}/${district.id}`);
    }
    for (const location of bundle.locations) {
      locations.add(location.id);
      locations.add(`${pack}/${location.id}`);
    }
    for (const type of bundle.locationTypes) {
      locationTypes.add(type.id);
      locationTypes.add(`${pack}/${type.id}`);
    }
  }
  return {
    cities,
    districts,
    locations,
    locationTypes,
    services: new Set(set.services.keys()),
  };
}

function checkTemplate(source: RegionSource, index: number, item: unknown, refs: RegionRefs): ContentError[] {
  const parsed = RegionTemplateSchema.safeParse(item);
  if (!parsed.success) {
    return [];
  }
  const errors: ContentError[] = [];
  parsed.data.cities.forEach((slot, slotIndex) => {
    if (!refResolves(slot.city, source.pack, refs.cities)) {
      errors.push(dangling(source, pathAt(source, index, `cities[${slotIndex}].city`), 'city', slot.city));
    }
  });
  parsed.data.jurisdiction.forEach((entry, entryIndex) => {
    const placeIds = new Set<string>([...refs.cities, ...refs.districts]);
    if (!refResolves(entry.place, source.pack, placeIds)) {
      errors.push(
        dangling(source, pathAt(source, index, `jurisdiction[${entryIndex}].place`), 'jurisdiction', entry.place),
      );
    }
  });
  return errors;
}

function checkRoute(source: RegionSource, index: number, item: unknown, refs: RegionRefs): ContentError[] {
  const parsed = IntercityRouteTemplateSchema.safeParse(item);
  if (!parsed.success) {
    return [];
  }
  const terminals = new Set<string>([...refs.locationTypes, ...refs.locations]);
  const errors: ContentError[] = [];
  parsed.data.terminals.forEach((terminal, terminalIndex) => {
    if (!refResolves(terminal, source.pack, terminals)) {
      errors.push(dangling(source, pathAt(source, index, `terminals[${terminalIndex}]`), 'terminal', terminal));
    }
  });
  return errors;
}

function checkPost(source: RegionSource, index: number, item: unknown, refs: RegionRefs): ContentError[] {
  const parsed = BorderPostSchema.safeParse(item);
  if (!parsed.success) {
    return [];
  }
  if (!refResolves(parsed.data.service, source.pack, refs.services)) {
    return [dangling(source, pathAt(source, index, 'service'), 'service', parsed.data.service)];
  }
  return [];
}

function checkHook(
  source: RegionSource,
  index: number,
  item: unknown,
  modes: ReadonlySet<string>,
): ContentError[] {
  const parsed = CrossCityStageHookSchema.safeParse(item);
  if (!parsed.success) {
    return [];
  }
  const errors: ContentError[] = [];
  if (!Object.prototype.hasOwnProperty.call(parsed.data.cityRoles, parsed.data.city)) {
    errors.push(
      issue(
        source,
        pathAt(source, index, 'city'),
        `city role "${parsed.data.city}" is not declared in cityRoles`,
      ),
    );
  }
  const handoff = parsed.data.handoff;
  if (handoff !== undefined && !handoff.modes.some((mode) => modes.has(mode))) {
    errors.push(
      issue(
        source,
        pathAt(source, index, 'handoff.modes'),
        `city role "${parsed.data.city}" has no intercity route in an allowed mode`,
      ),
    );
  }
  return errors;
}

/** Travel modes of the route templates in this load. Schema-invalid routes are skipped. */
function routeModes(sources: readonly RegionSource[]): Set<string> {
  const modes = new Set<string>();
  for (const source of sources) {
    if (source.kind !== 'intercity-route-template') {
      continue;
    }
    for (const item of source.items) {
      const parsed = IntercityRouteTemplateSchema.safeParse(item);
      if (parsed.success) {
        modes.add(parsed.data.mode);
      }
    }
  }
  return modes;
}

/**
 * Resolve region template City slots, route Terminals, Border Post Services,
 * Jurisdiction places and hook City roles. A hook whose handoff names no
 * loaded route mode is refused too. Schema failures are left to the loader;
 * an item that does not parse is skipped here.
 */
export function checkRegionContent(
  sources: readonly RegionSource[],
  refs: RegionRefs | undefined,
): ContentError[] {
  const errors: ContentError[] = [];
  const modes = routeModes(sources);
  for (const source of sources) {
    source.items.forEach((item, index) => {
      if (source.kind === 'cross-city-stage-hook') {
        errors.push(...checkHook(source, index, item, modes));
        return;
      }
      if (refs === undefined) {
        return;
      }
      if (source.kind === 'region-template') {
        errors.push(...checkTemplate(source, index, item, refs));
        return;
      }
      if (source.kind === 'intercity-route-template') {
        errors.push(...checkRoute(source, index, item, refs));
        return;
      }
      if (source.kind === 'border-post') {
        errors.push(...checkPost(source, index, item, refs));
      }
    });
  }
  return errors;
}

/** True when a parsed YAML value looks like a regional item list. */
export function itemsOf(content: unknown): { readonly list: boolean; readonly items: readonly unknown[] } {
  if (Array.isArray(content)) {
    return { list: true, items: content };
  }
  if (isRecord(content) && Array.isArray(content['items'])) {
    return { list: false, items: content['items'] };
  }
  if (isRecord(content)) {
    return { list: false, items: [content] };
  }
  return { list: false, items: [] };
}
