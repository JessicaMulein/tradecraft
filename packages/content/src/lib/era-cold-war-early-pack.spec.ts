/**
 * The Era Pack load test (content-expansion task 7.2).
 *
 * Loads the shipped `era-cold-war-early` Era Pack together with the core pack
 * from disk through `loadContent`, exactly as a scenario with a 1945–1965
 * setting would, and asserts the load succeeds with no ContentErrors. It then
 * confirms the merged Content Set carries the era content this task authored:
 * the Era record with its 1945–1965 Period Window, the era Locale, the shared
 * Service Definitions (own, hostile, liaison) and the technology list the
 * anachronism rule reads.
 *
 * The task 7.2 slice is era / technology / ciphers / styles / services /
 * locale; the quality lists (7.3) and public texts (7.4) are separate tasks, so
 * this test does not require them.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { loadContent, type ContentSet, type LoadResult } from '../index.js';
import { CipherConventionsSchema } from '../kinds/era.js';
import { ServiceDefinitionSchema } from '../kinds/service.js';

const PACKS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
);
const CORE_DIR = join(PACKS_DIR, 'core');
const ERA_DIR = join(PACKS_DIR, 'era-cold-war-early');

/** Read a YAML file under the Era Pack as a list of items. */
function readEraList(relPath: string): unknown[] {
  const parsed = parseYaml(readFileSync(join(ERA_DIR, relPath), 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${relPath} did not parse to a list`);
  }
  return parsed;
}

/** Load core + the Era Pack, surfacing every ContentError in the message. */
function loadEraPack(): ContentSet {
  const result: LoadResult<ContentSet> = loadContent(
    [CORE_DIR, ERA_DIR],
    ['core', 'era-cold-war-early'],
  );
  if (!result.ok) {
    throw new Error(
      `era pack failed to load with ${result.errors.length} error(s):\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return result.value;
}

describe('era-cold-war-early Era Pack', () => {
  it('loads cleanly with the core pack (no ContentErrors)', () => {
    const result = loadContent(
      [CORE_DIR, ERA_DIR],
      ['core', 'era-cold-war-early'],
    );
    if (!result.ok) {
      throw new Error(
        result.errors
          .map((e) => `${e.pack}/${e.file} ${e.path}: ${e.message}`)
          .join('\n'),
      );
    }
    expect(result.ok).toBe(true);
  });

  describe('the merged Content Set carries the era content', () => {
    const content = loadEraPack();

    it('exposes the Era bundle with the 1945–1965 Period Window', () => {
      expect(content.era).toBeDefined();
      expect(content.era?.id).toBe('era-cold-war-early/cold-war-early');
      expect(content.era?.period).toEqual({ from: 1945, to: 1965 });
    });

    it('exposes the era Locale as the fallback', () => {
      expect(content.era?.locale).toBeDefined();
      expect(content.era?.locale?.date.months).toHaveLength(12);
      expect(content.era?.locale?.date.weekdays).toHaveLength(7);
    });

    it('ships the shared services (own, hostile, liaison)', () => {
      const kinds = new Map(
        [...content.services.values()].map((s) => [s.id, s.kind]),
      );
      expect(kinds.get('own-service')).toBe('own');
      expect(kinds.get('hostile-foreign-directorate')).toBe('hostile');
      expect(kinds.get('liaison-atlantic-agency')).toBe('liaison');

      const byKind = [...content.services.values()].reduce<Record<string, number>>(
        (acc, s) => ({ ...acc, [s.kind]: (acc[s.kind] ?? 0) + 1 }),
        {},
      );
      expect(byKind.own).toBeGreaterThanOrEqual(1);
      expect(byKind.hostile).toBeGreaterThanOrEqual(1);
      expect(byKind.liaison).toBeGreaterThanOrEqual(1);
    });
  });

  describe('the authored era files are well-formed', () => {
    it('ships at least 60 technology items with introduced years in/around period', () => {
      const tech = readEraList('technology/technology.yaml') as {
        introduced: number;
      }[];
      expect(tech.length).toBeGreaterThanOrEqual(60);
      for (const item of tech) {
        expect(item.introduced).toBeGreaterThanOrEqual(1940);
        expect(item.introduced).toBeLessThanOrEqual(1965);
      }
    });

    it('ships a valid CipherConventions with a five-letter pad and numbers format', () => {
      const [raw] = readEraList('cipher-conventions/ciphers.yaml');
      const parsed = CipherConventionsSchema.safeParse(raw);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.padFormat.groupSize).toBe(5);
        expect(parsed.data.headers.length).toBeGreaterThanOrEqual(1);
        expect(parsed.data.numbersFormat.groups).toBeGreaterThan(0);
      }
    });

    it('ships document styles for every slice Document kind and the Fact Line', () => {
      const rules = readEraList('style-guide/document-styles.yaml') as {
        appliesTo: string[];
      }[];
      const targets = new Set(rules.flatMap((r) => r.appliesTo));
      for (const kind of [
        'document:newspaper',
        'document:dossier',
        'document:cable',
        'document:seized',
        'document:public-text',
        'fact-line',
      ]) {
        expect(targets.has(kind)).toBe(true);
      }
    });

    it('every service parses against ServiceDefinitionSchema', () => {
      const services = readEraList('services/services.yaml');
      expect(services.length).toBeGreaterThanOrEqual(5);
      for (const s of services) {
        const parsed = ServiceDefinitionSchema.safeParse(s);
        if (!parsed.success) {
          throw new Error(
            `service failed validation: ${JSON.stringify(parsed.error.issues)}`,
          );
        }
      }
    });
  });
});
