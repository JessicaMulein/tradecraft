/**
 * Campaign content indexed for the reducer.
 *
 * Caller-registered kinds are schema-checked by the slice loader and are not
 * stored on the Content Set. The reducer reads backgrounds, the HQ cast and
 * arcs from the same sources `loadCampaignContent` already checked.
 */

import type { ContentSet } from '@tradecraft/content';

import type { CampaignSource } from './check.js';
import {
  ArcTemplateSchema,
  ArcThreadTemplateSchema,
  BackgroundSchema,
  CampaignTextSchema,
  HqCastTemplateSchema,
  EpochSchema,
  ExfiltrationSchema,
  RankRowSchema,
  RequisitionSchema,
  SkillSchema,
  TraitSchema,
  type ArcTemplate,
  type ArcThreadTemplate,
  type Background,
  type CampaignText,
  type Epoch,
  type Exfiltration,
  type HqCastTemplate,
  type RankRow,
  type Requisition,
  type Skill,
  type Trait,
} from './schemas.js';

export interface CampaignContent {
  readonly set: ContentSet;
  readonly backgrounds: readonly Background[];
  readonly ranks: readonly RankRow[];
  readonly skills: readonly Skill[];
  readonly traits: readonly Trait[];
  readonly requisitions: readonly Requisition[];
  readonly exfiltrations: readonly Exfiltration[];
  readonly hqCast: readonly HqCastTemplate[];
  readonly arcs: readonly ArcTemplate[];
  readonly arcThreads: readonly ArcThreadTemplate[];
  readonly epochs: readonly Epoch[];
  readonly texts: readonly CampaignText[];
}

function readKind<T>(
  sources: readonly CampaignSource[],
  kind: string,
  schema: { parse: (value: unknown) => T },
): T[] {
  const items: T[] = [];
  for (const source of sources) {
    if (source.kind !== kind) {
      continue;
    }
    for (const item of source.items) {
      items.push(schema.parse(item));
    }
  }
  return items;
}

/** Index the campaign sources that belong to an already-loaded content set. */
export function campaignContent(
  set: ContentSet,
  sources: readonly CampaignSource[],
): CampaignContent {
  return {
    set,
    backgrounds: readKind(sources, 'background', BackgroundSchema),
    ranks: readKind(sources, 'rank', RankRowSchema),
    skills: readKind(sources, 'skill', SkillSchema),
    traits: readKind(sources, 'trait', TraitSchema),
    requisitions: readKind(sources, 'requisition', RequisitionSchema),
    exfiltrations: readKind(sources, 'exfiltration', ExfiltrationSchema),
    hqCast: readKind(sources, 'hq-cast', HqCastTemplateSchema),
    arcs: readKind(sources, 'arc', ArcTemplateSchema),
    arcThreads: readKind(sources, 'arc-thread', ArcThreadTemplateSchema),
    epochs: readKind(sources, 'epoch', EpochSchema),
    texts: readKind(sources, 'campaign-text', CampaignTextSchema),
  };
}
