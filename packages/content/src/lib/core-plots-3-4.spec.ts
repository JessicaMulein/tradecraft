/**
 * Validates the authored `core` pack Plot templates, Side Thread templates and
 * Rumour templates (task 3.4) against their schemas, and confirms the complete
 * pack still loads end to end now that tasks 3.1/3.2/3.3 have landed
 * (Requirements 29.2, 29.3, 31.7).
 *
 * The per-file checks parse the YAML with the `yaml` dependency and validate
 * each entry with the matching exported Zod schema, in isolation. The load
 * check runs `loadContent` over the `core` pack directory and asserts it
 * succeeds, which catches any dangling archetype or predicate reference these
 * templates make.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  PlotTemplateSchema,
  RumourTemplateSchema,
  SideThreadTemplateSchema,
  loadContent,
  type PlotTemplate,
  type RumourTemplate,
  type SideThreadTemplate,
} from '../index.js';

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
  'core',
);

/** Read a core-pack YAML file as a list of entries. */
function readList(name: string): unknown[] {
  const parsed = parseYaml(readFileSync(join(CORE_DIR, name), 'utf8'));
  expect(Array.isArray(parsed)).toBe(true);
  return parsed as unknown[];
}

/** Pick the id from a raw entry for readable failure messages. */
function idOf(entry: unknown): string {
  return typeof entry === 'object' && entry !== null && 'id' in entry
    ? String((entry as { id: unknown }).id)
    : '<no id>';
}

describe('core pack plots.yaml', () => {
  const raw = readList('plots.yaml');

  it('every entry validates against PlotTemplateSchema', () => {
    for (const entry of raw) {
      const result = PlotTemplateSchema.safeParse(entry);
      if (!result.success) {
        throw new Error(
          `plot "${idOf(entry)}" failed validation: ${result.error.message}`,
        );
      }
    }
  });

  const plots: PlotTemplate[] = raw.map((e) => PlotTemplateSchema.parse(e));

  it('provides the three core plot templates with unique ids', () => {
    // Req 31.7: the core pack ships three Plot templates after task 26.9 added
    // the émigré-abduction plot to the original two.
    expect(plots.length).toBe(3);
    const ids = plots.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes the compromise, cipher-theft and émigré-abduction plots', () => {
    const ids = new Set(plots.map((p) => p.id));
    expect(ids).toContain('liaison-compromise');
    expect(ids).toContain('cipher-theft');
    expect(ids).toContain('emigre-abduction');
  });

  it('gives every plot at least one stage, each with a valid deadline', () => {
    for (const plot of plots) {
      expect(plot.stages.length).toBeGreaterThanOrEqual(1);
      for (const stage of plot.stages) {
        expect(stage.deadline.min).toBeLessThanOrEqual(stage.deadline.max);
      }
    }
  });

  it('gives every plot stage structured traces and the plot public articles', () => {
    for (const plot of plots) {
      expect(plot.publicTraceArticles.length).toBeGreaterThanOrEqual(1);
      for (const stage of plot.stages) {
        expect(stage.traces.length).toBeGreaterThanOrEqual(1);
        for (const trace of stage.traces) {
          // Each trace carries a kind, a prose summary and at least one
          // evidence predicate the event makes observable.
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

  it('names only declared role, target and materiel slots in traces', () => {
    for (const plot of plots) {
      const roleIds = new Set(plot.roleSlots.map((s) => s.id));
      const targetIds = new Set(plot.targetSlots.map((s) => s.id));
      const materielIds = new Set(plot.materielSlots.map((s) => s.id));
      for (const stage of plot.stages) {
        for (const trace of stage.traces) {
          for (const role of trace.roles) {
            expect(roleIds.has(role)).toBe(true);
          }
          if (trace.place !== undefined && 'target' in trace.place) {
            expect(targetIds.has(trace.place.target)).toBe(true);
          }
          if (trace.materiel !== undefined) {
            expect(materielIds.has(trace.materiel)).toBe(true);
          }
        }
      }
    }
  });

  it('wires each stage onDisrupted response as non-negative weights', () => {
    for (const plot of plots) {
      for (const stage of plot.stages) {
        const { delay, reroute, abort } = stage.onDisrupted;
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(reroute).toBeGreaterThanOrEqual(0);
        expect(abort).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('core pack side-threads.yaml', () => {
  const raw = readList('side-threads.yaml');

  it('every entry validates against SideThreadTemplateSchema', () => {
    for (const entry of raw) {
      const result = SideThreadTemplateSchema.safeParse(entry);
      if (!result.success) {
        throw new Error(
          `side thread "${idOf(entry)}" failed validation: ${result.error.message}`,
        );
      }
    }
  });

  const threads: SideThreadTemplate[] = raw.map((e) =>
    SideThreadTemplateSchema.parse(e),
  );

  it('provides the four core side threads with unique ids', () => {
    // Req 31.7: the core pack ships four Side Thread templates after task 26.9
    // added the currency ring and the forged-papers racket to the original two.
    expect(threads.length).toBe(4);
    const ids = threads.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names no Cell role in any side thread', () => {
    for (const thread of threads) {
      for (const slot of thread.roleSlots) {
        expect(slot.id).not.toContain('cell');
      }
    }
  });

  it('includes the penicillin, affair, currency-ring and forged-papers threads', () => {
    const ids = new Set(threads.map((t) => t.id));
    expect(ids).toContain('penicillin-racket');
    expect(ids).toContain('sector-crossing-affair');
    expect(ids).toContain('currency-ring');
    expect(ids).toContain('forged-papers-racket');
  });
});

describe('core pack rumours.yaml', () => {
  const raw = readList('rumours.yaml');

  const VALID_DISTORTIONS = new Set([
    'swap-subject',
    'shift-day',
    'invent-target',
  ]);

  it('every entry validates against RumourTemplateSchema', () => {
    for (const entry of raw) {
      const result = RumourTemplateSchema.safeParse(entry);
      if (!result.success) {
        throw new Error(
          `rumour "${idOf(entry)}" failed validation: ${result.error.message}`,
        );
      }
    }
  });

  const rumours: RumourTemplate[] = raw.map((e) =>
    RumourTemplateSchema.parse(e),
  );

  it('provides the twelve core rumour templates with unique ids', () => {
    // Req 31.7: the core pack ships twelve Rumour templates after task 26.9
    // added four to the original eight.
    expect(rumours.length).toBe(12);
    const ids = rumours.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each rumour carries at least one known distortion', () => {
    for (const rumour of rumours) {
      expect(rumour.distortions.length).toBeGreaterThanOrEqual(1);
      for (const distortion of rumour.distortions) {
        expect(VALID_DISTORTIONS.has(distortion)).toBe(true);
      }
    }
  });

  it('covers all three distortion kinds across the set', () => {
    const seen = new Set(rumours.flatMap((r) => r.distortions));
    expect(seen).toEqual(VALID_DISTORTIONS);
  });
});

describe('core pack loads end to end with the task 3.4 templates', () => {
  it('loadContent over the core pack succeeds with no dangling references', () => {
    const result = loadContent([CORE_DIR], ['core']);
    if (!result.ok) {
      throw new Error(
        `loadContent failed:\n${result.errors
          .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
          .join('\n')}`,
      );
    }
    expect(result.value.plotTemplates.size).toBe(3);
    expect(result.value.sideThreadTemplates.size).toBe(4);
    expect(result.value.rumourTemplates.size).toBe(12);
  });
});
