/**
 * Typed regional items the loader schema-checks and then drops (multi-city
 * task 3). Ids are namespaced `<pack>/<name>`, matching the Content Set.
 */

import type { RegionSource } from './check.js';
import {
  BorderPostSchema,
  BorderSchema,
  CrossCityStageHookSchema,
  IntercityRouteTemplateSchema,
  RegionalPresetSchema,
  RegionTemplateSchema,
  RivalryTableSchema,
  ServiceExtensionSchema,
  TravelDocumentKindSchema,
  type Border,
  type BorderPost,
  type CrossCityStageHook,
  type IntercityRouteTemplate,
  type RegionalPreset,
  type RegionTemplate,
  type RivalryTable,
  type ServiceExtension,
  type TravelDocumentKind,
} from './content.js';

export interface RegionCatalog {
  readonly templates: ReadonlyMap<string, RegionTemplate>;
  readonly routes: ReadonlyMap<string, IntercityRouteTemplate>;
  readonly borders: ReadonlyMap<string, Border>;
  readonly posts: ReadonlyMap<string, BorderPost>;
  readonly documents: ReadonlyMap<string, TravelDocumentKind>;
  readonly extensions: ReadonlyMap<string, ServiceExtension>;
  readonly rivalries: ReadonlyMap<string, RivalryTable>;
  readonly hooks: ReadonlyMap<string, CrossCityStageHook>;
  readonly presets: ReadonlyMap<string, RegionalPreset>;
}

function namespaced(pack: string, id: string): string {
  return id.includes('/') ? id : `${pack}/${id}`;
}

function take<T extends { readonly id: string }>(
  sources: readonly RegionSource[],
  kind: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
): Map<string, T> {
  const out = new Map<string, T>();
  for (const source of sources) {
    if (source.kind !== kind) {
      continue;
    }
    for (const item of source.items) {
      const parsed = schema.safeParse(item);
      if (!parsed.success) {
        continue;
      }
      const id = namespaced(source.pack, parsed.data.id);
      out.set(id, { ...parsed.data, id });
    }
  }
  return out;
}

/** Index the regional sources a load already accepted. */
export function regionCatalog(sources: readonly RegionSource[]): RegionCatalog {
  return {
    templates: take(sources, 'region-template', RegionTemplateSchema),
    routes: take(sources, 'intercity-route-template', IntercityRouteTemplateSchema),
    borders: take(sources, 'border', BorderSchema),
    posts: take(sources, 'border-post', BorderPostSchema),
    documents: take(sources, 'travel-document-kind', TravelDocumentKindSchema),
    extensions: take(sources, 'service-extension', ServiceExtensionSchema),
    rivalries: take(sources, 'rivalry-table', RivalryTableSchema),
    hooks: take(sources, 'cross-city-stage-hook', CrossCityStageHookSchema),
    presets: take(sources, 'regional-preset', RegionalPresetSchema),
  };
}

/** Resolve a content ref against a namespaced catalog, from the owning pack. */
export function lookup<T>(
  map: ReadonlyMap<string, T>,
  ref: string,
  pack: string,
): T | undefined {
  return map.get(ref) ?? map.get(namespaced(pack, ref));
}

/** The namespaced id a ref denotes, whether or not the item was loaded. */
export function refId(ref: string, pack: string): string {
  return namespaced(pack, ref);
}
