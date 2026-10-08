/**
 * Ambient content validation (ambient-world Property 20; Req 22).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadContent } from '@tradecraft/content';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import { checkAmbientPredicate, checkAmbientRefs, duplicateIdIssues, scanDenylist } from './check.js';
import {
  AMBIENT_KINDS,
  EVENT_CATEGORIES,
  EventTemplateSchema,
  IncidentTemplateSchema,
  NpcSelectorSchema,
  ambientJsonSchema,
} from './content.js';
import { ambientPreset } from './preset.js';

const PACKS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'content', 'packs');

const event = {
  id: 'dock-strike',
  category: 'labour',
  class: 'exogenous',
  weight: 3,
  cooldownDays: 21,
  name: 'Dock strike',
  durationDays: [3, 6],
  stages: [{ day: 0, ops: [{ op: 'metric-delta', metric: 'unrest', delta: 0.1 }] }],
};

describe('ambient content validation', () => {
  it('accepts a closed effect op and rejects an unknown one', () => {
    // Feature: ambient-world, Property 20: Ambient content validation
    expect(EventTemplateSchema.safeParse(event).success).toBe(true);
    const bad = EventTemplateSchema.safeParse({
      ...event,
      stages: [{ day: 0, ops: [{ op: 'fly-away' }] }],
    });
    expect(bad.success).toBe(false);
  });

  it('rejects a person slot that is not a registry npc or a role title', () => {
    expect(NpcSelectorSchema.safeParse({ npc: 'npc:clerk' }).success).toBe(true);
    expect(NpcSelectorSchema.safeParse({ roleTitle: 'a sector commandant' }).success).toBe(true);
    expect(NpcSelectorSchema.safeParse({ query: ['role:cell'] }).success).toBe(false);
  });

  it('reports an era-denylist term with pack, file and path', () => {
    const issues = scanDenylist(
      { name: 'A smartphone notice' },
      'ambient',
      'notices/post.yaml',
    );
    expect(issues).toEqual([
      {
        pack: 'ambient',
        file: 'notices/post.yaml',
        path: 'name',
        message: 'era denylist term "smartphone"',
      },
    ]);
  });

  it('rejects an ambient predicate that declares an implication', () => {
    const issues = checkAmbientPredicate(
      { implication: { role: 'subject', other: ['hostile-org'], weight: 1 } },
      'ambient',
      'predicates.yaml',
      '[0]',
    );
    expect(issues[0]?.path).toBe('[0]');
    expect(issues[0]?.message).toContain('implication');
  });

  it('loads the ambient pack and covers every event category', () => {
    const loaded = loadContent(
      [join(PACKS, 'core'), join(PACKS, 'ambient')],
      ['core', 'ambient'],
      { kinds: [...AMBIENT_KINDS] },
    );
    expect(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.errors.slice(0, 8))).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const pack = join(PACKS, 'ambient');
    const events = EventTemplateSchema.array().parse(
      parse(readFileSync(join(pack, 'events/events.yaml'), 'utf8')),
    );
    const incidents = IncidentTemplateSchema.array().parse(
      parse(readFileSync(join(pack, 'incidents/incidents.yaml'), 'utf8')),
    );
    expect(incidents.length).toBeGreaterThanOrEqual(40);
    for (const category of EVENT_CATEGORIES) {
      expect(events.filter((item) => item.category === category).length).toBeGreaterThanOrEqual(4);
    }
    expect(scanDenylist(events, 'ambient', 'events/events.yaml')).toEqual([]);
    const stories = parse(readFileSync(join(pack, 'stories/stories.yaml'), 'utf8')) as {
      id: string;
    }[];
    const notices = parse(readFileSync(join(pack, 'notices/notices.yaml'), 'utf8')) as {
      id: string;
    }[];
    const tags = new Set(loaded.value.tagVocabulary.tags.map((tag) => tag.id));
    expect(
      checkAmbientRefs(
        events,
        incidents,
        {
          stories: new Set(stories.map((item) => item.id)),
          notices: new Set(notices.map((item) => item.id)),
          tags,
        },
        'ambient',
        'events/events.yaml',
        'incidents/incidents.yaml',
      ),
    ).toEqual([]);
    expect(duplicateIdIssues(events, 'ambient', 'events/events.yaml')).toEqual([]);
    expect(duplicateIdIssues(incidents, 'ambient', 'incidents/incidents.yaml')).toEqual([]);
    expect(ambientPreset('standard').policeBaseline).toBe(0.3);
    expect(ambientPreset('hard').maxPlotDelayDays).toBe(1);
    expect(ambientJsonSchema('event-template').type).toBeDefined();
  });
});
