/**
 * Campaign kind registrations (Req 22.4). Callers pass {@link CAMPAIGN_KINDS}
 * through `LoadOptions.kinds`. Items are schema-checked and not stored on the
 * Content Set.
 */

import type { ContentKindRegistration, FieldDeclarations } from '@tradecraft/content';
import { z } from 'zod';

import {
  ArcTemplateSchema,
  ArcThreadTemplateSchema,
  BackgroundSchema,
  CampaignTextSchema,
  EpochSchema,
  ExfiltrationSchema,
  FactionSchema,
  HqCastTemplateSchema,
  RankRowSchema,
  RequisitionSchema,
  ReviewWeightsSchema,
  SkillSchema,
  TraitSchema,
} from './schemas.js';

const OWNER = '@tradecraft/campaign';
const ROLES = ['core', 'era', 'extension'] as const;

function kind(
  name: string,
  dir: string,
  schema: z.ZodType,
  fields: FieldDeclarations,
): ContentKindRegistration {
  return {
    kind: name,
    dir: `campaign/${dir}`,
    schema,
    roles: ROLES,
    cityScoped: false,
    owner: OWNER,
    fields,
  };
}

export const CAMPAIGN_KINDS: readonly ContentKindRegistration[] = [
  kind('background', 'backgrounds', BackgroundSchema, {
    text: ['items[].text'],
    names: ['items[].name'],
    refs: [{ path: 'items[].traits[]', kind: 'trait' }],
  }),
  kind('rank', 'ranks', RankRowSchema, {}),
  kind('skill', 'skills', SkillSchema, {
    text: ['items[].name'],
  }),
  kind('trait', 'traits', TraitSchema, {
    text: ['items[].name'],
    refs: [{ path: 'items[].triggers[].trait', kind: 'trait' }],
  }),
  kind('faction', 'factions', FactionSchema, {
    text: ['items[].name', 'items[].text'],
  }),
  kind('hq-cast', 'hq-cast', HqCastTemplateSchema, {
    text: ['items[].role'],
    names: ['items[].name'],
    refs: [{ path: 'items[].faction', kind: 'faction' }],
  }),
  kind('requisition', 'requisitions', RequisitionSchema, {
    refs: [{ path: 'items[].effect.skill', kind: 'skill' }],
  }),
  kind('exfiltration', 'exfiltrations', ExfiltrationSchema, {
    refs: [
      { path: 'items[].archetype', kind: 'archetype' },
      { path: 'items[].benefit.faction', kind: 'faction' },
    ],
  }),
  kind('arc', 'arcs', ArcTemplateSchema, {
    refs: [
      { path: 'items[].stages[].thread', kind: 'arc-thread' },
      { path: 'items[].traits[]', kind: 'trait' },
    ],
  }),
  kind('arc-thread', 'arc-threads', ArcThreadTemplateSchema, {
    text: ['items[].stages[].traces[].text'],
    templates: [{ path: 'items[].publicTraceArticles[]', style: 'other' }],
    refs: [{ path: 'items[].clues[].prop', kind: 'predicate' }],
  }),
  kind('epoch', 'epochs', EpochSchema, {
    refs: [{ path: 'items[].events[]', kind: 'event-template' }],
  }),
  kind('review-weights', 'review-weights', ReviewWeightsSchema, {}),
  kind('campaign-text', 'texts', CampaignTextSchema, {
    text: ['items[].title'],
    templates: [{ path: 'items[].body', style: 'document:cable' }],
  }),
];

/** JSON Schema for one campaign kind, derived from its Zod schema. */
export function campaignJsonSchema(kindName: string): Record<string, unknown> {
  const found = CAMPAIGN_KINDS.find((item) => item.kind === kindName);
  if (found === undefined) {
    throw new Error(`no campaign kind ${kindName}`);
  }
  return z.toJSONSchema(found.schema) as Record<string, unknown>;
}
