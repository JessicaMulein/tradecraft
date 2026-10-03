/**
 * Cue Manifest discovery (design, "Cue Map and Cue Manifest"). Takes are found
 * by file name: `<Name>.mp3` and `<Name> 2.mp3` are Takes 1 and 2 of one cue.
 * Encoded files (Opus) live in `soundtrack/web/`.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { AudioFormat } from '../config.js';
import type { AudioFormatName, CueManifest, CueMap, Take, TakeMeta } from '../../shared/cue/types.js';

const FILE = /^(.*?)(?: (\d+))?\.(opus|mp3|wav)$/i;

export interface ManifestResult {
  readonly manifest: CueManifest;
  /** Relative paths (NFC) the audio route may serve. */
  readonly allowed: ReadonlySet<string>;
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export async function buildManifest(
  soundtrackDir: string,
  map: CueMap,
  formats: readonly AudioFormat[],
  meta: ReadonlyMap<string, ReadonlyMap<number, TakeMeta>>,
): Promise<ManifestResult> {
  // stem -> take number -> format -> relative path
  const found = new Map<string, Map<number, Partial<Record<AudioFormatName, string>>>>();
  const allowed = new Set<string>();

  const scan = async (sub: string): Promise<void> => {
    const names = await listDir(sub === '' ? soundtrackDir : join(soundtrackDir, sub));
    for (const raw of names) {
      const name = raw.normalize('NFC');
      const m = FILE.exec(name);
      if (m === null) {
        continue;
      }
      const stem = m[1] as string;
      const number = m[2] === undefined ? 1 : Number(m[2]);
      const format = (m[3] as string).toLowerCase() as AudioFormatName;
      if (!formats.includes(format)) {
        continue;
      }
      const rel = sub === '' ? name : `${sub}/${name}`;
      const byTake = found.get(stem) ?? new Map<number, Partial<Record<AudioFormatName, string>>>();
      const files = byTake.get(number) ?? {};
      files[format] = rel;
      byTake.set(number, files);
      found.set(stem, byTake);
      allowed.add(rel);
    }
  };
  await scan('');
  await scan('web');

  const takes: Record<string, readonly Take[]> = {};
  const missing: string[] = [];
  const singleTake: string[] = [];

  for (const [cue, def] of Object.entries(map.cues)) {
    if (def.file === undefined) {
      continue; // a Derived Cue is covered by its source
    }
    const stem = def.file.normalize('NFC');
    const byTake = found.get(stem);
    if (byTake === undefined || byTake.size === 0) {
      missing.push(cue);
      continue;
    }
    const list: Take[] = [...byTake.entries()]
      .sort(([a], [b]) => a - b)
      .map(([number, files]) => {
        const tm = meta.get(stem)?.get(number);
        return {
          id: `${stem}#${number}`,
          number,
          files,
          ...(tm !== undefined ? { meta: tm } : {}),
        };
      });
    takes[cue] = list;
    if (list.length === 1) {
      singleTake.push(cue);
    }
  }

  return { manifest: { takes, missing, singleTake }, allowed };
}
