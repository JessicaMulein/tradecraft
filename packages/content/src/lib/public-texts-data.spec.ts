/**
 * Tests for the public-texts loader (task 5.6 support).
 *
 * The loader reduces each authored corpus (almanac, anthology, timetable) under
 * `public-texts/` to a common {@link PublicText}: id, kind, title and a flat,
 * ordered list of readable lines. These checks confirm the real core-pack
 * corpora load, flatten to a word-rich body (so a book cipher has letters to key
 * across), and that bad input is reported as a located error rather than thrown.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  PUBLIC_TEXT_FILES,
  loadPublicText,
  loadPublicTexts,
  parsePublicText,
} from './public-texts-data.js';

const PACK_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
  'core',
);

/** Count ASCII letters, the measure the book cipher keys off. */
function countLetters(text: string): number {
  return (text.match(/[A-Za-z]/g) ?? []).length;
}

describe('public-texts loader — core pack corpora', () => {
  it('loads every corpus and flattens it to a readable body', () => {
    const result = loadPublicTexts(PACK_DIR);
    if (!result.ok) {
      throw new Error(
        `public texts failed to load:\n${result.errors
          .map((e) => `  ${e.file} ${e.path}: ${e.message}`)
          .join('\n')}`,
      );
    }
    expect(result.value.length).toBe(PUBLIC_TEXT_FILES.length);
    for (const text of result.value) {
      expect(text.kind).toBe('public-text');
      expect(text.id.length).toBeGreaterThan(0);
      expect(text.title.length).toBeGreaterThan(0);
      expect(text.lines.length).toBeGreaterThan(0);
      for (const line of text.lines) {
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('flattens each corpus to a letter-rich body (keyable for a book cipher)', () => {
    const result = loadPublicTexts(PACK_DIR);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const text of result.value) {
      const body = text.lines.join('\n');
      expect(
        countLetters(body),
        `${text.id} should be letter-rich`,
      ).toBeGreaterThanOrEqual(800);
    }
  });

  it('is deterministic: loading the same file twice yields the same body', () => {
    for (const relPath of PUBLIC_TEXT_FILES) {
      const a = loadPublicText(PACK_DIR, relPath);
      const b = loadPublicText(PACK_DIR, relPath);
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) {
        expect(a.value.lines).toEqual(b.value.lines);
      }
    }
  });

  it('reports a missing file as a located error rather than throwing', () => {
    const result = loadPublicText(PACK_DIR, 'public-texts/does-not-exist.yaml');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].file).toBe('public-texts/does-not-exist.yaml');
    }
  });

  it('reports a schema violation as a located error (almanac with no lines)', () => {
    const relPath = PUBLIC_TEXT_FILES[0];
    expect(() =>
      parsePublicText(relPath, { id: 'bad', kind: 'public-text', title: 'x', lines: [] }),
    ).toThrow();
  });

  it('matches a hand-parsed flatten of the almanac lines in order', () => {
    const relPath = 'public-texts/almanac.yaml';
    const raw = parseYaml(readFileSync(join(PACK_DIR, relPath), 'utf8')) as {
      lines: string[];
    };
    const text = parsePublicText(relPath, raw);
    expect(text.lines).toEqual(raw.lines.map((l) => l.trim()));
  });
});
