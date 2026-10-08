/**
 * Load packs with the campaign kinds registered, then apply the campaign
 * cross-reference checks. Schema failures stay the slice loader's
 * `ContentError`s; reference, path, bounds and epoch failures are added beside
 * them.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import {
  loadContent,
  type ContentError,
  type ContentSet,
  type LoadResult,
} from '@tradecraft/content';
import { parse } from 'yaml';

import { checkCampaignContent, type CampaignSource } from './check.js';
import { CAMPAIGN_KINDS } from './kinds.js';

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
  const found = CAMPAIGN_KINDS.find(
    (item) =>
      relPath === `${item.dir}.yaml` ||
      relPath === `${item.dir}.yml` ||
      relPath.startsWith(`${item.dir}/`),
  );
  return found?.kind;
}

function itemsOf(content: unknown): { readonly list: boolean; readonly items: readonly unknown[] } {
  if (Array.isArray(content)) {
    return { list: true, items: content };
  }
  if (content !== null && typeof content === 'object' && Array.isArray((content as { items?: unknown }).items)) {
    return { list: false, items: (content as { items: unknown[] }).items };
  }
  if (content !== null && typeof content === 'object') {
    return { list: false, items: [content] };
  }
  return { list: false, items: [] };
}

/** Campaign files in the packs `loadContent` actually merged. */
export function campaignSources(
  dirs: readonly string[],
  packIds: ReadonlySet<string>,
): { readonly sources: readonly CampaignSource[]; readonly errors: readonly ContentError[] } {
  const sources: CampaignSource[] = [];
  const errors: ContentError[] = [];
  for (const dir of dirs) {
    const id = packId(dir);
    if (id === undefined || !packIds.has(id)) {
      continue;
    }
    const root = join(dir, 'campaign');
    let files: string[] = [];
    try {
      if (!statSync(root).isDirectory()) {
        continue;
      }
      files = listYaml(root);
    } catch {
      continue;
    }
    for (const file of files) {
      const rel = toPosix(relative(dir, file));
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
          message: error instanceof Error ? error.message : 'campaign file did not parse',
        });
      }
    }
  }
  return { sources, errors };
}

/**
 * The slice load plus campaign cross-reference checks. A miss returns every
 * `ContentError` and no content set.
 */
export function loadCampaignContent(
  dirs: readonly string[],
  selected: readonly string[],
): LoadResult<ContentSet> {
  const loaded = loadContent(dirs, selected, { kinds: [...CAMPAIGN_KINDS] });
  const packIds = new Set<string>(selected);
  if (loaded.ok) {
    for (const pack of loaded.value.manifest.packs) {
      packIds.add(pack.id);
    }
  }
  const read = campaignSources(dirs, packIds);
  const checked = checkCampaignContent(
    read.sources,
    loaded.ok
      ? {
          archetypes: new Set(loaded.value.archetypes.keys()),
          predicates: new Set(loaded.value.predicates.predicates.map((predicate) => predicate.id)),
        }
      : undefined,
  );
  const errors = [
    ...(loaded.ok ? [] : loaded.errors),
    ...read.errors,
    ...checked,
  ];
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return loaded;
}
