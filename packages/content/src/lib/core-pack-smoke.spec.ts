/**
 * The content smoke test (task 3.6): the holistic "the whole core pack loads
 * cleanly and is complete" check.
 *
 * Tasks 3.1–3.5 author the core pack one group of files at a time, and each has
 * its own spec that validates its files in isolation. This test is the
 * end-to-end counterpart: it loads the complete `core` pack from disk through
 * `loadContent` exactly as the Sim would, asserts the load succeeds with no
 * ContentErrors, and confirms the merged Content Set carries every content kind
 * the slice needs — so the core pack alone provides all content the slice needs
 * (Requirement 31.7). It then confirms all three shipped Difficulty Presets
 * (easy, standard, hard) are present and valid (Requirement 34.2).
 *
 * This deliberately avoids re-checking the per-file detail the 3.1–3.5 specs
 * already cover; it asserts presence and completeness, not shape.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DifficultyPresetSchema,
  loadContent,
  type ContentSet,
  type LoadResult,
} from '../index.js';

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
  'core',
);

/**
 * Load the core pack, failing with every located ContentError surfaced in the
 * message so a regression anywhere in 3.1–3.5 is immediately diagnosable.
 */
function loadCorePack(): ContentSet {
  const result: LoadResult<ContentSet> = loadContent([CORE_DIR], ['core']);
  if (!result.ok) {
    throw new Error(
      `core pack failed to load with ${result.errors.length} error(s):\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return result.value;
}

describe('core pack content smoke test', () => {
  it('loads the complete core pack cleanly with no ContentErrors', () => {
    const result = loadContent([CORE_DIR], ['core']);
    expect(result.ok).toBe(true);
  });

  describe('the loaded Content Set is complete (Req 31.7)', () => {
    const content = loadCorePack();

    it('derives the 15 vocabulary predicates', () => {
      expect(content.predicates.predicates).toHaveLength(15);
    });

    it('carries archetypes, location types and persona libraries', () => {
      expect(content.archetypes.size).toBeGreaterThan(0);
      expect(content.locationTypes.size).toBeGreaterThan(0);
      expect(content.personaLibraries.size).toBeGreaterThan(0);
    });

    it('carries cover identities, rumour templates, hints and documents', () => {
      expect(content.coverIdentities.size).toBeGreaterThan(0);
      expect(content.rumourTemplates.size).toBeGreaterThan(0);
      expect(content.hints.size).toBeGreaterThan(0);
      expect(content.documentTemplates.size).toBeGreaterThan(0);
    });

    it('ships the three Plot templates and four Side Thread templates', () => {
      // Req 31.7, pinned by count: three Plots, four Side Threads and twelve
      // Rumours after task 26.9 deepened the core pack.
      expect(content.plotTemplates.size).toBe(3);
      expect(content.sideThreadTemplates.size).toBe(4);
      expect(content.rumourTemplates.size).toBe(12);
    });

    it('gives every Plot and Side Thread trace a structured, resolvable shape', () => {
      // Loading already enforces that each trace's role/target/materiel/
      // Location-Type/evidence references resolve (Requirement 31.2); here we
      // confirm the authored traces are structured rather than bare prose
      // (task 26.1): every stage has at least one trace with a kind, prose text
      // and at least one evidence predicate.
      const templates = [
        ...content.plotTemplates.values(),
        ...content.sideThreadTemplates.values(),
      ];
      for (const template of templates) {
        for (const stage of template.stages) {
          expect(stage.traces.length).toBeGreaterThanOrEqual(1);
          for (const trace of stage.traces) {
            expect([
              'meeting',
              'transmission',
              'drop-loaded',
              'drop-emptied',
              'npc-moved',
            ]).toContain(trace.kind);
            expect(trace.text.length).toBeGreaterThan(0);
            expect(trace.evidences.length).toBeGreaterThanOrEqual(1);
          }
        }
      }
    });

    it('pins the core pack in the Content Manifest with a hex hash', () => {
      expect(content.manifest.packs).toHaveLength(1);
      const [core] = content.manifest.packs;
      expect(core.id).toBe('core');
      expect(core.version).toBe('1.0.0');
      // SHA-256 as lower-case hex: 64 hex characters.
      expect(core.hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('every Difficulty Preset validates (Req 34.2)', () => {
    const content = loadCorePack();

    it('ships the easy, standard and hard presets', () => {
      // Presets are namespaced <pack>/<id> in the merged Content Set.
      const ids = [...content.difficultyPresets.keys()].sort();
      expect(ids).toEqual(['core/easy', 'core/hard', 'core/standard']);
    });

    it('every preset is a valid DifficultyPreset', () => {
      for (const [id, preset] of content.difficultyPresets) {
        const result = DifficultyPresetSchema.safeParse(preset);
        if (!result.success) {
          throw new Error(
            `Difficulty Preset "${id}" failed validation:\n${result.error.message}`,
          );
        }
      }
    });
  });
});
