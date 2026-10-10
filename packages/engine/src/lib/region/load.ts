/**
 * Load packs with the regional kinds registered, then apply the regional
 * cross-reference checks (multi-city task 1.2). Schema failures stay the
 * slice loader's `ContentError`s. A regional pack that loads is hashed into
 * the Content Manifest with every other selected pack (Req 16.4).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  loadContent,
  type ContentError,
  type ContentKindRegistration,
  type ContentSet,
  type LoadResult,
} from '@tradecraft/content';
import { parse } from 'yaml';

import { checkRegionContent, itemsOf, regionRefs, type RegionSource } from './check.js';
import { REGION_KINDS } from './content.js';
import { AMBIENT_KINDS } from '../ambient/content.js';

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function listYaml(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (name.endsWith('.yaml') || name.endsWith('.yml')) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function packId(dir: string): string | undefined {
  try {
    const parsed = parse(readFileSync(join(dir, 'pack.yaml'), 'utf8')) as { id?: unknown };
    return typeof parsed.id === 'string' ? parsed.id : undefined;
  } catch {
    return undefined;
  }
}

function kindOf(relPath: string): string | undefined {
  const found = REGION_KINDS.find(
    (item) =>
      relPath === `${item.dir}.yaml` ||
      relPath === `${item.dir}.yml` ||
      relPath.startsWith(`${item.dir}/`),
  );
  return found?.kind;
}

/** Regional files in the packs `loadContent` actually merged. */
export function regionSources(
  dirs: readonly string[],
  packIds: ReadonlySet<string>,
): { readonly sources: readonly RegionSource[]; readonly errors: readonly ContentError[] } {
  const sources: RegionSource[] = [];
  const errors: ContentError[] = [];
  for (const dir of dirs) {
    const id = packId(dir);
    if (id === undefined || !packIds.has(id)) {
      continue;
    }
    let files: string[] = [];
    try {
      files = listYaml(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = toPosix(relative(dir, file));
      if (rel === 'pack.yaml') {
        continue;
      }
      const kind = kindOf(rel);
      if (kind === undefined) {
        continue;
      }
      try {
        const parsed = itemsOf(parse(readFileSync(file, 'utf8')));
        sources.push({ pack: id, file: rel, list: parsed.list, kind, items: parsed.items });
      } catch (error) {
        errors.push({
          pack: id,
          file: rel,
          path: '',
          message: error instanceof Error ? error.message : 'regional file did not parse',
        });
      }
    }
  }
  return { sources, errors };
}

/**
 * The slice load plus regional cross-reference checks. A miss returns every
 * `ContentError` and no content set, so generation does not start.
 */
export function loadRegionContent(
  dirs: readonly string[],
  selected: readonly string[],
  extraKinds?: readonly ContentKindRegistration[],
): LoadResult<ContentSet> {
  const loaded = loadContent(dirs, selected, {
    kinds: [...REGION_KINDS, ...AMBIENT_KINDS, ...(extraKinds ?? [])],
  });
  const packIds = new Set<string>(selected);
  if (loaded.ok) {
    for (const pack of loaded.value.manifest.packs) {
      packIds.add(pack.id);
    }
  }
  const read = regionSources(dirs, packIds);
  const checked = checkRegionContent(read.sources, loaded.ok ? regionRefs(loaded.value) : undefined);
  const errors = [...(loaded.ok ? [] : loaded.errors), ...read.errors, ...checked];
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return loaded;
}
