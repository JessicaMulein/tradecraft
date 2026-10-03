/**
 * Validation test for the files task 3.2 authors in the core content pack:
 * `location-types.yaml`, the persona libraries under `personas/`, and
 * `cover-identities.yaml`. Each entry is parsed from its YAML on disk and
 * checked against the published Zod schema, exactly as the loader would.
 *
 * The full pack cannot `loadContent` cleanly until tasks 3.1 and 3.3 land their
 * own files (predicates, archetypes, …), so this test validates these files
 * individually against their schemas rather than through the loader. The
 * one cross-reference that is self-contained within 3.2's files — a Cover
 * Identity's `fitLocationTypes` pointing at Location Types defined here — is
 * checked directly.
 *
 * `city.yaml` is authored content the loader tolerates without a schema (it
 * feeds later tasks), so it is only checked to be well-formed YAML.
 * `descriptors.yaml` is now a schema-validated Descriptor library kind; here it
 * is still only spot-checked for the pools later tasks depend on.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  CoverIdentitySchema,
  LocationTypeSchema,
  PersonaLibrarySchema,
} from '../index.js';

// --- locate the core pack on disk -----------------------------------------

const CORE_PACK_DIR = join(import.meta.dirname, '..', '..', 'packs', 'core');

/** Parse a YAML file from the core pack into a value. */
function loadYaml(relPath: string): unknown {
  const text = readFileSync(join(CORE_PACK_DIR, relPath), 'utf8');
  return parseYaml(text);
}

/** Coerce a file's content into the list of items the loader would see. */
function asList(content: unknown): unknown[] {
  if (Array.isArray(content)) return content;
  if (content === null || content === undefined) return [];
  return [content];
}

// --- Location Types --------------------------------------------------------

describe('core pack: location-types.yaml', () => {
  const items = asList(loadYaml('location-types.yaml'));

  it('defines at least the twelve period Location Types the task names', () => {
    expect(items.length).toBeGreaterThanOrEqual(12);
  });

  it('every Location Type validates against LocationTypeSchema', () => {
    for (const item of items) {
      const result = LocationTypeSchema.safeParse(item);
      if (!result.success) {
        throw new Error(
          `Location Type failed validation: ${JSON.stringify(item)}\n${result.error.message}`,
        );
      }
    }
  });

  it('gives every Location Type at least six descriptions (Req 21.9)', () => {
    for (const item of items) {
      const type = LocationTypeSchema.parse(item);
      expect(
        type.descriptionPool.length,
        `Location Type "${type.id}" has only ${type.descriptionPool.length} descriptions`,
      ).toBeGreaterThanOrEqual(6);
    }
  });

  it('adds the deepened-city Location Types (task 26.10)', () => {
    const ids = new Set(items.map((i) => (i as { id: string }).id));
    for (const added of ['heuriger', 'cinema', 'market']) {
      expect(ids).toContain(added);
    }
  });

  it('covers the required period Location Types', () => {
    const ids = new Set(items.map((i) => (i as { id: string }).id));
    for (const required of [
      'kaffeehaus',
      'tobacconist-kiosk',
      'library',
      'bookshop',
      'hotel-bar',
      'park',
      'danube-port',
      'warehouse',
      'safehouse',
      'embassy',
      'railway-station',
      'station-hq',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('uses only Location Type ids once (no duplicates)', () => {
    const ids = items.map((i) => (i as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// --- Persona libraries -----------------------------------------------------

describe('core pack: persona libraries', () => {
  const personaDir = join(CORE_PACK_DIR, 'personas');
  const files = readdirSync(personaDir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();

  it('ships a persona library file for each occupying and local culture', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it('every persona library validates against PersonaLibrarySchema', () => {
    for (const file of files) {
      const content = parseYaml(readFileSync(join(personaDir, file), 'utf8'));
      for (const item of asList(content)) {
        const result = PersonaLibrarySchema.safeParse(item);
        if (!result.success) {
          throw new Error(
            `Persona library ${file} failed validation:\n${result.error.message}`,
          );
        }
      }
    }
  });

  it('covers the Austrian, Central European and occupying-power cultures', () => {
    const cultures = new Set<string>();
    for (const file of files) {
      const content = parseYaml(readFileSync(join(personaDir, file), 'utf8'));
      for (const item of asList(content)) {
        const lib = PersonaLibrarySchema.parse(item);
        for (const pool of lib.namePools) cultures.add(pool.culture);
      }
    }
    expect(cultures).toContain('austrian');
    // at least one Central European émigré culture
    expect(
      ['hungarian', 'czech', 'polish', 'slovak'].some((c) => cultures.has(c)),
    ).toBe(true);
    // the four occupying powers
    expect(cultures).toContain('american');
    expect(cultures).toContain('british');
    expect(cultures).toContain('french');
    expect(cultures).toContain('russian');
  });
});

// --- Cover Identities ------------------------------------------------------

describe('core pack: cover-identities.yaml', () => {
  const items = asList(loadYaml('cover-identities.yaml'));
  const locationTypeIds = new Set(
    asList(loadYaml('location-types.yaml')).map((i) => (i as { id: string }).id),
  );

  it('every Cover Identity validates against CoverIdentitySchema', () => {
    for (const item of items) {
      const result = CoverIdentitySchema.safeParse(item);
      if (!result.success) {
        throw new Error(
          `Cover Identity failed validation: ${JSON.stringify(item)}\n${result.error.message}`,
        );
      }
    }
  });

  it('includes the period-plausible trade attaché and wire-service covers', () => {
    const ids = new Set(items.map((i) => (i as { id: string }).id));
    expect(ids).toContain('trade-attache');
    expect(ids).toContain('wire-service-correspondent');
  });

  it('every fitLocationTypes id resolves to a Location Type defined here', () => {
    for (const item of items) {
      const cover = CoverIdentitySchema.parse(item);
      for (const ref of cover.fitLocationTypes) {
        // bare ids resolve against this pack's own Location Types
        const id = ref.includes('/') ? ref.split('/')[1] : ref;
        expect(locationTypeIds).toContain(id);
      }
    }
  });
});

// --- tolerated authored files ---------------------------------------------

describe('core pack: tolerated authored files', () => {
  it('city.yaml is well-formed and carries weather tables and name pools', () => {
    const city = loadYaml('city.yaml') as Record<string, unknown>;
    expect(city).toBeTypeOf('object');
    expect(city.weather).toBeDefined();
    expect(city.namePools).toBeDefined();
    expect(city.districts).toBeDefined();
    expect(city.sectors).toBeDefined();
  });

  it('descriptors.yaml is well-formed and exposes 1950s clothing pools', () => {
    const descriptors = loadYaml('descriptors.yaml') as {
      pools?: Record<string, unknown>;
    };
    expect(descriptors.pools).toBeDefined();
    const poolIds = Object.keys(descriptors.pools ?? {});
    expect(poolIds).toContain('street-clothes');
    expect(poolIds).toContain('winter-coat');
    expect(poolIds.length).toBeGreaterThanOrEqual(5);
  });
});
