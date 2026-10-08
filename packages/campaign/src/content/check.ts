/**
 * Campaign load checks the item schema cannot make on its own
 * (campaign-career Req 4.2, 22.2). Each failure is a slice `ContentError`.
 */

import { DifficultyPresetSchema, type ContentError } from '@tradecraft/content';
import { RecruitmentWeightsSchema } from '@tradecraft/engine';
import type { z } from 'zod';

export interface CampaignSource {
  readonly pack: string;
  readonly file: string;
  /** True when the file is a YAML list, so error paths start at `[i]`. */
  readonly list: boolean;
  readonly kind: string;
  readonly items: readonly unknown[];
}

export interface CampaignRefs {
  readonly archetypes: ReadonlySet<string>;
  readonly predicates: ReadonlySet<string>;
}

interface ZodNode {
  readonly type?: string;
  readonly shape?: Readonly<Record<string, ZodNode>>;
  readonly in?: ZodNode;
  unwrap?: () => ZodNode;
}

function unwrap(schema: z.ZodType): ZodNode {
  let current = schema as ZodNode;
  while (
    current.type === 'optional' ||
    current.type === 'default' ||
    current.type === 'nullable' ||
    current.type === 'pipe'
  ) {
    const next = current.type === 'pipe' ? current.in : current.unwrap?.();
    if (next === undefined) {
      break;
    }
    current = next;
  }
  return current;
}

/** Dotted paths that land on a number in the preset or the recruitment weights. */
export function numericModifierPaths(): ReadonlySet<string> {
  const found = new Set<string>();
  const walk = (schema: ZodNode, prefix: string): void => {
    const current = unwrap(schema as z.ZodType);
    if (current.type === 'number') {
      if (prefix !== '') {
        found.add(prefix);
      }
      return;
    }
    if (current.type !== 'object' || current.shape === undefined) {
      return;
    }
    for (const [key, child] of Object.entries(current.shape)) {
      walk(child, prefix === '' ? key : `${prefix}.${key}`);
    }
  };
  walk(DifficultyPresetSchema, '');
  walk(RecruitmentWeightsSchema, '');
  return found;
}

const NUMERIC_PATHS = numericModifierPaths();

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pathAt(source: CampaignSource, index: number, rest: string): string {
  const base = source.list ? `[${index}]` : '';
  if (rest === '') {
    return base;
  }
  if (base === '') {
    return rest;
  }
  return rest.startsWith('[') ? `${base}${rest}` : `${base}.${rest}`;
}

function issue(source: CampaignSource, path: string, message: string): ContentError {
  return { pack: source.pack, file: source.file, path, message };
}

function refResolves(ref: string, pack: string, ids: ReadonlySet<string>): boolean {
  if (ids.has(ref)) {
    return true;
  }
  return !ref.includes('/') && ids.has(`${pack}/${ref}`);
}

function idsOf(sources: readonly CampaignSource[], kind: string): Set<string> {
  const ids = new Set<string>();
  for (const source of sources) {
    if (source.kind !== kind) {
      continue;
    }
    for (const item of source.items) {
      if (isRecord(item) && typeof item.id === 'string') {
        ids.add(`${source.pack}/${item.id}`);
      }
    }
  }
  return ids;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function modifierIssues(source: CampaignSource): ContentError[] {
  const errors: ContentError[] = [];
  source.items.forEach((item, index) => {
    if (!isRecord(item) || !Array.isArray(item.effects)) {
      return;
    }
    item.effects.forEach((effect, effectIndex) => {
      if (!isRecord(effect)) {
        return;
      }
      const where = pathAt(source, index, `effects[${effectIndex}]`);
      if (Array.isArray(effect.bounds) && effect.bounds.length === 2) {
        const [lo, hi] = effect.bounds;
        if (typeof lo === 'number' && typeof hi === 'number' && lo > hi) {
          errors.push(issue(source, `${where}.bounds`, 'bounds must be ordered'));
        }
      }
      if (typeof effect.path === 'string' && !NUMERIC_PATHS.has(effect.path)) {
        errors.push(
          issue(
            source,
            `${where}.path`,
            `modifier path "${effect.path}" is not a numeric preset or recruitment-weight field`,
          ),
        );
      }
    });
  });
  return errors;
}

function epochIssues(sources: readonly CampaignSource[]): ContentError[] {
  const errors: ContentError[] = [];
  const spans: {
    from: number;
    to: number;
    id: string;
    source: CampaignSource;
    path: string;
  }[] = [];
  for (const source of sources) {
    if (source.kind !== 'epoch') {
      continue;
    }
    source.items.forEach((item, index) => {
      if (!isRecord(item) || !Array.isArray(item.years) || item.years.length !== 2) {
        return;
      }
      const [from, to] = item.years;
      if (typeof from !== 'number' || typeof to !== 'number') {
        return;
      }
      const path = pathAt(source, index, 'years');
      if (from > to) {
        errors.push(issue(source, path, 'epoch years must be ordered'));
        return;
      }
      spans.push({
        from,
        to,
        id: typeof item.id === 'string' ? item.id : path,
        source,
        path,
      });
    });
  }
  spans.sort((a, b) => a.from - b.from || a.path.localeCompare(b.path));
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const later = spans[i];
      const earlier = spans[j];
      if (later === undefined || earlier === undefined) {
        continue;
      }
      if (later.from <= earlier.to && earlier.from <= later.to) {
        errors.push(
          issue(later.source, later.path, `epoch years overlap "${earlier.id}"`),
        );
        break;
      }
    }
  }
  return errors;
}

function arcIssues(
  sources: readonly CampaignSource[],
  traits: ReadonlySet<string>,
  threads: ReadonlySet<string>,
  refs: CampaignRefs | undefined,
): ContentError[] {
  const errors: ContentError[] = [];
  for (const source of sources) {
    if (source.kind === 'arc') {
      source.items.forEach((item, index) => {
        if (!isRecord(item)) {
          return;
        }
        if (isRecord(item.binds) && refs !== undefined) {
          for (const [slot, bind] of Object.entries(item.binds)) {
            if (!isRecord(bind) || typeof bind.archetype !== 'string') {
              continue;
            }
            if (!refResolves(bind.archetype, source.pack, refs.archetypes)) {
              errors.push(
                issue(
                  source,
                  pathAt(source, index, `binds.${slot}.archetype`),
                  `archetype "${bind.archetype}" does not resolve`,
                ),
              );
            }
          }
        }
        strings(item.traits).forEach((trait, traitIndex) => {
          if (!refResolves(trait, source.pack, traits)) {
            errors.push(
              issue(
                source,
                pathAt(source, index, `traits[${traitIndex}]`),
                `trait "${trait}" does not resolve`,
              ),
            );
          }
        });
        if (!Array.isArray(item.stages)) {
          return;
        }
        item.stages.forEach((stage, stageIndex) => {
          if (!isRecord(stage) || typeof stage.thread !== 'string') {
            return;
          }
          if (!refResolves(stage.thread, source.pack, threads)) {
            errors.push(
              issue(
                source,
                pathAt(source, index, `stages[${stageIndex}].thread`),
                `arc thread "${stage.thread}" does not resolve`,
              ),
            );
          }
        });
      });
    }
    if (source.kind === 'arc-thread' && refs !== undefined) {
      source.items.forEach((item, index) => {
        if (!isRecord(item)) {
          return;
        }
        if (Array.isArray(item.roleSlots)) {
          item.roleSlots.forEach((slot, slotIndex) => {
            if (!isRecord(slot)) {
              return;
            }
            strings(slot.archetypes).forEach((archetype, archetypeIndex) => {
              if (!refResolves(archetype, source.pack, refs.archetypes)) {
                errors.push(
                  issue(
                    source,
                    pathAt(source, index, `roleSlots[${slotIndex}].archetypes[${archetypeIndex}]`),
                    `archetype "${archetype}" does not resolve`,
                  ),
                );
              }
            });
          });
        }
        if (Array.isArray(item.clues)) {
          item.clues.forEach((clue, clueIndex) => {
            if (!isRecord(clue) || typeof clue.prop !== 'string') {
              return;
            }
            if (!refs.predicates.has(clue.prop)) {
              errors.push(
                issue(
                  source,
                  pathAt(source, index, `clues[${clueIndex}].prop`),
                  `predicate "${clue.prop}" does not resolve`,
                ),
              );
            }
          });
        }
        if (!Array.isArray(item.stages)) {
          return;
        }
        item.stages.forEach((stage, stageIndex) => {
          if (!isRecord(stage) || !Array.isArray(stage.traces)) {
            return;
          }
          stage.traces.forEach((trace, traceIndex) => {
            if (!isRecord(trace)) {
              return;
            }
            strings(trace.evidences).forEach((predicate, predicateIndex) => {
              if (!refs.predicates.has(predicate)) {
                errors.push(
                  issue(
                    source,
                    pathAt(
                      source,
                      index,
                      `stages[${stageIndex}].traces[${traceIndex}].evidences[${predicateIndex}]`,
                    ),
                    `predicate "${predicate}" does not resolve`,
                  ),
                );
              }
            });
          });
        });
      });
    }
  }
  return errors;
}

/**
 * Check arc references, modifier paths, ordered bounds and epoch overlap.
 * Archetype and predicate checks run only when `refs` is supplied, which is
 * after the slice load has produced those registries.
 */
export function checkCampaignContent(
  sources: readonly CampaignSource[],
  refs?: CampaignRefs,
): ContentError[] {
  const traits = idsOf(sources, 'trait');
  const threads = idsOf(sources, 'arc-thread');
  return [
    ...sources
      .filter((source) => source.kind === 'skill' || source.kind === 'trait')
      .flatMap((source) => modifierIssues(source)),
    ...epochIssues(sources),
    ...arcIssues(sources, traits, threads, refs),
  ];
}
