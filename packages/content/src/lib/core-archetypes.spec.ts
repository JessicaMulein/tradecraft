/**
 * Validates the authored `core` pack archetypes (task 3.3) against
 * ArchetypeSchema directly, without requiring a full `loadContent` run (which
 * only passes once the sibling pack files from tasks 3.1/3.2 land). This keeps
 * the archetype roster honest on its own: every entry parses, the roster covers
 * all five roles, allegiances match each role, and the civilian coverage of
 * 1950s Vienna life is present (Requirements 1.3, 27.1, 29.1).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { ArchetypeSchema, type Archetype } from '../index.js';

const ARCHETYPES_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'packs',
  'core',
  'archetypes.yaml',
);

function loadArchetypes(): unknown[] {
  const text = readFileSync(ARCHETYPES_PATH, 'utf8');
  const parsed = parseYaml(text);
  expect(Array.isArray(parsed)).toBe(true);
  return parsed as unknown[];
}

describe('core pack archetypes', () => {
  const raw = loadArchetypes();

  it('every entry validates against ArchetypeSchema', () => {
    for (const entry of raw) {
      const result = ArchetypeSchema.safeParse(entry);
      if (!result.success) {
        const id =
          typeof entry === 'object' && entry !== null && 'id' in entry
            ? String((entry as { id: unknown }).id)
            : '<no id>';
        throw new Error(
          `archetype "${id}" failed validation: ${result.error.message}`,
        );
      }
    }
  });

  const parsed: Archetype[] = raw.map((e) => ArchetypeSchema.parse(e));

  it('has unique, lower-kebab ids', () => {
    const ids = parsed.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it('covers all five archetype roles', () => {
    const roles = new Set(parsed.map((a) => a.role));
    expect(roles).toEqual(
      new Set([
        'cell',
        'hostile-officer',
        'station-staff',
        'contact',
        'civilian',
      ]),
    );
  });

  it('matches allegiances to each role', () => {
    const byRole = (role: Archetype['role']) =>
      parsed.filter((a) => a.role === role);

    for (const a of byRole('cell')) {
      expect(a.allowedAllegiances).toEqual(['cell']);
    }
    for (const a of byRole('hostile-officer')) {
      expect(a.allowedAllegiances).toEqual(['hostile']);
    }
    for (const a of byRole('station-staff')) {
      expect(a.allowedAllegiances).toEqual(['station']);
    }
    for (const a of byRole('contact')) {
      // Contacts read as neutral but may be a quiet Station friend.
      expect(a.allowedAllegiances).toContain('neutral');
      for (const al of a.allowedAllegiances) {
        expect(['neutral', 'station']).toContain(al);
      }
    }
    for (const a of byRole('civilian')) {
      for (const al of a.allowedAllegiances) {
        expect(['neutral', 'unknown']).toContain(al);
      }
    }
  });

  it('includes a Chief of Station and 2-3 further staff (Req 27.1)', () => {
    const staff = parsed.filter((a) => a.role === 'station-staff');
    expect(staff.map((a) => a.id)).toContain('chief-of-station');
    const nonChief = staff.filter((a) => a.id !== 'chief-of-station');
    expect(nonChief.length).toBeGreaterThanOrEqual(2);
  });

  it('includes cell leadership and support roles', () => {
    const cellIds = parsed.filter((a) => a.role === 'cell').map((a) => a.id);
    expect(cellIds).toContain('cell-leader');
    expect(cellIds).toContain('cell-courier');
    expect(cellIds).toContain('cell-radio-operator');
    expect(cellIds).toContain('cell-financier');
  });

  it('includes hostile resident and case officer', () => {
    const officerIds = parsed
      .filter((a) => a.role === 'hostile-officer')
      .map((a) => a.id);
    expect(officerIds).toContain('hostile-resident');
    expect(officerIds).toContain('hostile-case-officer');
  });

  it('provides 2-3 starting contacts', () => {
    const contacts = parsed.filter((a) => a.role === 'contact');
    expect(contacts.length).toBeGreaterThanOrEqual(2);
    expect(contacts.length).toBeLessThanOrEqual(3);
  });

  it('provides at least eight period civilian archetypes', () => {
    const civilians = parsed.filter((a) => a.role === 'civilian');
    expect(civilians.length).toBeGreaterThanOrEqual(8);
    const ids = new Set(civilians.map((a) => a.id));
    // The period examples the task calls out explicitly.
    expect(ids).toContain('cafe-waiter');
    expect(ids).toContain('tram-conductor');
    expect(ids).toContain('black-market-trader');
    expect(ids).toContain('refugee-clerk');
  });

  it('gives every archetype complete MICE, wariness and pools', () => {
    for (const a of parsed) {
      for (const lever of ['money', 'ideology', 'coercion', 'ego'] as const) {
        const range = a.mice[lever];
        expect(range.min).toBeGreaterThanOrEqual(0);
        expect(range.max).toBeLessThanOrEqual(1);
        expect(range.min).toBeLessThanOrEqual(range.max);
      }
      expect(a.wariness.min).toBeGreaterThanOrEqual(0);
      expect(a.wariness.max).toBeLessThanOrEqual(1);
      expect(a.personaPools.length).toBeGreaterThanOrEqual(1);
      expect(a.descriptorPools.length).toBeGreaterThanOrEqual(1);
      expect(a.schedule.length).toBeGreaterThanOrEqual(1);
    }
  });
});
