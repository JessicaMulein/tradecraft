/**
 * Validation for the files task 3.1 authors in the core Content Pack:
 * `pack.yaml`, `predicates.yaml`, `difficulty.yaml` and `hints.yaml`.
 *
 * Tasks 3.2 and 3.3 author the rest of the core pack concurrently, so a full
 * `loadContent` of the pack may not succeed until all three land. These checks
 * therefore validate each file against its own schema in isolation: they read
 * the YAML from disk, parse it with the `yaml` dependency, and parse it with
 * the matching exported Zod schema. The content smoke test (task 3.6) covers
 * the end-to-end load once the pack is complete.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  DifficultyFileSchema,
  HINT_TRIGGERS,
  HintFileSchema,
  PackManifestSchema,
  PredicateFileSchema,
  compilePredicateRegistry,
} from '../index.js';

const PACK_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
  'core',
);

/** Read and YAML-parse one file from the core pack. */
function readPackYaml(name: string): unknown {
  return parseYaml(readFileSync(join(PACK_DIR, name), 'utf8'));
}

describe('core pack pack.yaml', () => {
  it('validates against PackManifestSchema with id "core"', () => {
    const manifest = PackManifestSchema.parse(readPackYaml('pack.yaml'));
    expect(manifest.id).toBe('core');
    expect(manifest.version).toBe('1.0.0');
    // content-expansion task 7.1 moves the core pack to schema 2 with the
    // explicit `role: core`, now that it ships the Tag Vocabulary.
    expect(manifest.contentSchema).toBe(2);
    expect(manifest.role).toBe('core');
    expect(manifest.requires).toEqual([]);
    expect(manifest.overrides).toEqual([]);
  });
});

describe('core pack predicates.yaml', () => {
  const predicates = PredicateFileSchema.parse(readPackYaml('predicates.yaml'));

  it('defines the 15 vocabulary predicates from the design', () => {
    expect(predicates).toHaveLength(15);
    const ids = predicates.map((p) => p.id).sort();
    expect(ids).toEqual(
      [
        'CARRIES',
        'IS_ALIAS_OF',
        'KNOWS',
        'LOCATED_AT',
        'MEETS_AT',
        'MEMBER_OF',
        'PLANS',
        'REPORTS_TO',
        'SCHEDULED_FOR',
        'SUPPLIES',
        'SUSPECTS',
        'TARGETS',
        'TRAVELS_TO',
        'USES_CHANNEL',
        'WORKS_FOR',
      ].sort(),
    );
  });

  it('compiles into a registry: unique ids, unique field codes, valid templates', () => {
    const result = compilePredicateRegistry(predicates);
    expect(result.ok).toBe(true);
  });

  it('lets KNOWS and SUSPECTS take an organisation subject', () => {
    for (const id of ['KNOWS', 'SUSPECTS']) {
      const predicate = predicates.find((p) => p.id === id);
      expect(predicate?.subject).toContain('org');
    }
  });

  it('uses the alias evaluator for IS_ALIAS_OF', () => {
    const alias = predicates.find((p) => p.id === 'IS_ALIAS_OF');
    expect(alias?.evaluator).toBe('alias');
  });

  it('carries the Arrest Evidence implication rules', () => {
    const by = new Map(predicates.map((p) => [p.id, p]));
    expect(by.get('MEMBER_OF')?.implication).toEqual({
      role: 'subject',
      other: ['hostile-org'],
      weight: 2,
    });
    expect(by.get('WORKS_FOR')?.implication).toEqual({
      role: 'subject',
      other: ['hostile-org'],
      weight: 2,
    });
    expect(by.get('REPORTS_TO')?.implication).toEqual({
      role: 'subject',
      other: ['hostile-person', 'hostile-org'],
      weight: 2,
    });
    expect(by.get('MEETS_AT')?.implication).toEqual({
      role: 'either',
      other: ['hostile-person'],
      weight: 2,
    });
    expect(by.get('CARRIES')?.implication).toEqual({
      role: 'subject',
      other: ['materiel'],
      weight: 2,
    });
    expect(by.get('SUPPLIES')?.implication).toEqual({
      role: 'subject',
      other: ['materiel'],
      weight: 2,
    });
    expect(by.get('USES_CHANNEL')?.implication).toEqual({
      role: 'subject',
      other: ['hostile-channel'],
      weight: 1,
    });
    expect(by.get('PLANS')?.implication).toEqual({
      role: 'subject',
      other: ['none'],
      weight: 3,
    });
    expect(by.get('TARGETS')?.implication).toEqual({
      role: 'subject',
      other: ['none'],
      weight: 3,
    });
  });
});

describe('core pack difficulty.yaml', () => {
  const presets = DifficultyFileSchema.parse(readPackYaml('difficulty.yaml'));

  it('defines the easy, standard and hard presets', () => {
    expect(presets.map((p) => p.id).sort()).toEqual([
      'easy',
      'hard',
      'standard',
    ]);
  });

  it('matches the pinned standard preset values', () => {
    const standard = presets.find((p) => p.id === 'standard');
    expect(standard).toEqual({
      id: 'standard',
      plot: { stageCount: 5, deadlineSlackDays: 2 },
      noiseCounts: { backgroundNpcs: 16, sideThreads: 2, rumours: 6 },
      noiseTrafficRatio: { noise: 2, plot: 1 },
      hqFalseBeliefRate: 0.15,
      doctrine: {
        risk: { min: 0.3, max: 0.6 },
        security: { min: 0.3, max: 0.6 },
        deception: { min: 0.3, max: 0.6 },
      },
      detectionBase: { surveil: 0.1, meeting: 0.06, drop: 0.04 },
      madeRevealProbability: 0.6,
      tradecraftErrorProbability: 0.3,
      allowedCiphers: ['caesar', 'vigenere', 'columnar', 'book', 'otp'],
      arrest: {
        threshold: 7,
        wrongfulAuthorityPenalty: -1,
        wrongfulRaisesAlertness: false,
      },
      startingBudget: 3000,
      traceRequestDelayPhases: 2,
      coverSuspicionBurnThreshold: 0.8,
      hintsDefault: true,
    });
  });

  it('makes hard raise alertness on a wrongful arrest and default hints off', () => {
    const hard = presets.find((p) => p.id === 'hard');
    expect(hard?.arrest.wrongfulRaisesAlertness).toBe(true);
    expect(hard?.hintsDefault).toBe(false);
    expect(hard?.allowedCiphers).toContain('otp');
  });

  it('makes easy more forgiving than standard', () => {
    const easy = presets.find((p) => p.id === 'easy');
    const standard = presets.find((p) => p.id === 'standard');
    expect(easy?.arrest.threshold).toBe(6);
    expect(easy?.arrest.threshold).toBeLessThan(standard?.arrest.threshold ?? 0);
    expect(easy?.hintsDefault).toBe(true);
    expect(easy?.detectionBase.surveil).toBeLessThan(0.1);
  });
});

describe('core pack hints.yaml', () => {
  const hints = HintFileSchema.parse(readPackYaml('hints.yaml'));

  it('defines one hint per trigger', () => {
    const triggers = hints.map((h) => h.trigger).sort();
    expect(triggers).toEqual([...HINT_TRIGGERS].sort());
    expect(new Set(triggers).size).toBe(HINT_TRIGGERS.length);
  });

  it('gives every hint a unique id and non-empty text', () => {
    const ids = hints.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const hint of hints) {
      expect(hint.text.trim().length).toBeGreaterThan(0);
    }
  });
});
