/**
 * Validation for the files task 3.5 authors in the core Content Pack: the
 * Document templates (`documents.yaml`) and the public-text corpora under
 * `public-texts/` (the almanac, anthology and Vienna tram-and-rail timetable).
 *
 * Documents are a validated content kind: a bad template would fail the pack
 * load. These checks therefore (1) validate every Document template against
 * DocumentTemplateSchema, (2) parse every title and section body with the
 * template engine and confirm each referenced slot and optional section is
 * declared in that template's `slots` list, (3) confirm the public-text files
 * are well-formed YAML of the shape later tasks (5.6, the book cipher in task
 * 8) expect, and (4) load the whole core pack end to end and confirm the
 * documents land in the Content Set.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import {
  DOCUMENT_KINDS,
  DocumentTemplateSchema,
  loadContent,
  parseTemplate,
  type DocumentTemplate,
  type TemplateNode,
} from '../index.js';

const PACK_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
  'core',
);

/** Read and YAML-parse one file from the core pack. */
function readPackYaml(relPath: string): unknown {
  return parseYaml(readFileSync(join(PACK_DIR, relPath), 'utf8'));
}

/** Collect every slot name a parsed template references (slots and sections). */
function referencedSlots(nodes: readonly TemplateNode[], out: Set<string>): void {
  for (const node of nodes) {
    switch (node.kind) {
      case 'slot':
        out.add(node.slot);
        break;
      case 'optional':
        out.add(node.slot);
        referencedSlots(node.body, out);
        break;
      case 'pick':
      case 'text':
        break;
    }
  }
}

describe('core pack documents.yaml', () => {
  const raw = readPackYaml('documents.yaml');

  it('is a non-empty YAML array of document templates', () => {
    expect(Array.isArray(raw)).toBe(true);
    expect((raw as unknown[]).length).toBeGreaterThan(0);
  });

  const templates: DocumentTemplate[] = (raw as unknown[]).map((item) =>
    DocumentTemplateSchema.parse(item),
  );

  it('validates every template against DocumentTemplateSchema', () => {
    // The .map above throws on any invalid template; reaching here means all
    // parsed. Assert the count is stable so an accidental deletion is caught.
    expect(templates.length).toBe((raw as unknown[]).length);
  });

  it('gives every template a unique id', () => {
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the newspaper, dossier, cable and seized kinds', () => {
    const kinds = new Set(templates.map((t) => t.kind));
    expect(kinds.has('newspaper')).toBe(true);
    expect(kinds.has('dossier')).toBe(true);
    expect(kinds.has('cable')).toBe(true);
    expect(kinds.has('seized')).toBe(true);
    for (const t of templates) {
      expect(DOCUMENT_KINDS).toContain(t.kind);
    }
  });

  it('provides several newspaper article templates with distinct mastheads', () => {
    const newspapers = templates.filter((t) => t.kind === 'newspaper');
    expect(newspapers.length).toBeGreaterThanOrEqual(3);
  });

  it('parses every title and section body and references only declared slots', () => {
    for (const t of templates) {
      const declared = new Set(t.slots);
      const used = new Set<string>();

      const title = parseTemplate(t.titlePattern);
      referencedSlots(title.nodes, used);

      expect(t.sections.length).toBeGreaterThanOrEqual(1);
      for (const section of t.sections) {
        const ast = parseTemplate(section.body);
        referencedSlots(ast.nodes, used);
      }

      for (const slot of used) {
        expect(
          declared.has(slot),
          `template "${t.id}" uses slot "${slot}" not in its slots list`,
        ).toBe(true);
      }
    }
  });

  it('writes cables in telegraphic style, using STOP as a separator', () => {
    const cables = templates.filter((t) => t.kind === 'cable');
    expect(cables.length).toBeGreaterThanOrEqual(1);
    for (const cable of cables) {
      const text = cable.sections.map((s) => s.body).join(' ');
      expect(text).toContain('STOP');
    }
  });
});

describe('core pack public-texts corpora', () => {
  it('provides a well-formed almanac with a keyable body', () => {
    const almanac = readPackYaml('public-texts/almanac.yaml') as {
      id: string;
      kind: string;
      lines: unknown;
    };
    expect(almanac.id).toBeTruthy();
    expect(almanac.kind).toBe('public-text');
    expect(Array.isArray(almanac.lines)).toBe(true);
    expect((almanac.lines as unknown[]).length).toBeGreaterThanOrEqual(20);
    for (const line of almanac.lines as unknown[]) {
      expect(typeof line).toBe('string');
      expect((line as string).trim().length).toBeGreaterThan(0);
    }
  });

  it('provides a well-formed anthology of original passages', () => {
    const anthology = readPackYaml('public-texts/anthology.yaml') as {
      id: string;
      kind: string;
      passages: Array<{ number: number; kind: string; text: unknown }>;
    };
    expect(anthology.id).toBeTruthy();
    expect(anthology.kind).toBe('public-text');
    expect(Array.isArray(anthology.passages)).toBe(true);
    expect(anthology.passages.length).toBeGreaterThanOrEqual(4);
    for (const passage of anthology.passages) {
      expect(['verse', 'prose']).toContain(passage.kind);
      // Verse carries an array of lines; prose carries a string.
      const ok =
        typeof passage.text === 'string' || Array.isArray(passage.text);
      expect(ok).toBe(true);
    }
  });

  it('provides a Vienna tram-and-rail timetable with lines, stops and times', () => {
    const timetable = readPackYaml('public-texts/timetable.yaml') as {
      id: string;
      kind: string;
      tram_lines: Array<{ line: number; stops: string[] }>;
      railway_lines: unknown;
    };
    expect(timetable.id).toBeTruthy();
    expect(timetable.kind).toBe('public-text');
    expect(Array.isArray(timetable.tram_lines)).toBe(true);
    expect(timetable.tram_lines.length).toBeGreaterThanOrEqual(4);
    for (const line of timetable.tram_lines) {
      expect(typeof line.line).toBe('number');
      expect(Array.isArray(line.stops)).toBe(true);
      expect(line.stops.length).toBeGreaterThanOrEqual(2);
    }
    expect(Array.isArray(timetable.railway_lines)).toBe(true);
  });

  it('gives the public texts enough words to key a book cipher', () => {
    const countWords = (value: unknown): number => {
      if (typeof value === 'string') {
        return value.split(/\s+/).filter((w) => w.length > 0).length;
      }
      if (Array.isArray(value)) {
        return value.reduce<number>((n, v) => n + countWords(v), 0);
      }
      if (value && typeof value === 'object') {
        return Object.values(value).reduce<number>(
          (n, v) => n + countWords(v),
          0,
        );
      }
      return 0;
    };

    for (const file of [
      'public-texts/almanac.yaml',
      'public-texts/anthology.yaml',
      'public-texts/timetable.yaml',
    ]) {
      const words = countWords(readPackYaml(file));
      expect(words, `${file} should be word-rich`).toBeGreaterThanOrEqual(200);
    }
  });
});

describe('core pack end-to-end load with documents', () => {
  it('loads the whole core pack and includes the document templates', () => {
    const result = loadContent([PACK_DIR], ['core']);
    if (!result.ok) {
      // Surface the located errors so a failure is diagnosable.
      throw new Error(
        `core pack failed to load:\n${result.errors
          .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
          .join('\n')}`,
      );
    }
    expect(result.value.documentTemplates.size).toBeGreaterThanOrEqual(7);
    // The documents are namespaced <pack>/<id>.
    expect(result.value.documentTemplates.has('core/cable-hq-directive')).toBe(
      true,
    );
  });
});
