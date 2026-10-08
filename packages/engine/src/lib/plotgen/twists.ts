/**
 * False-flag plants and inside-man allegiance (plot-library design, Instantiator).
 *
 * A false flag's decoy membership is a lie: a notice the player can find, and
 * one rumour in the first newspaper. It is not written into the Truth Store.
 * The cell's real membership is. An inside man serves the Hostile Service in
 * truth and still presents as Station.
 */

import type { EntityId, NpcId, OrgId, PropId, Proposition } from '../model/core.js';
import { asTruth } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { HOSTILE_ORG_ID } from '../city/principals.js';
import { docId, type ComposedDocument, type Document } from '../docs/document.js';
import type { NewspaperItem } from '../docs/newspaper.js';
import { publicTextLocations } from '../docs/public-text.js';
import type { Allegiance } from '../truth/truth.js';

import type { PlotStateV2 } from './types.js';

const FRONT_NAME = 'a local crew';

/** Stable id for a cover organisation minted when the decoy query misses. */
export function frontOrgId(templateId: string): string {
  const slug = templateId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `org:front-${slug.length > 0 ? slug : 'crew'}`;
}

function plantPropId(plotId: string, npc: string): PropId {
  return `prop:plant/${plotId}/${npc}`;
}

function plantProposition(plotId: string, npc: string, org: string): Proposition {
  return {
    id: plantPropId(plotId, npc),
    subject: npc as EntityId,
    predicate: 'MEMBER_OF',
    object: org as EntityId,
  };
}

function firstCover(plot: PlotStateV2): { readonly npc: string; readonly org: string } | undefined {
  if (plot.twist?.kind !== 'false-flag') {
    return undefined;
  }
  return plot.twist.cover?.[0];
}

/**
 * Write false-flag notices into the world and rewrite an inside man's true
 * allegiance. A world with no library plots is returned unchanged.
 */
export function materialiseTwists(world: WorldState): WorldState {
  const plots = world.plots;
  if (plots === undefined || plots.length === 0) {
    return world;
  }
  let orgs = world.orgs;
  let npcs = world.npcs;
  let documents = world.documents;
  let documentPropositions = world.documentPropositions;
  let changed = false;
  const stands = publicTextLocations(world.city);
  for (const plot of plots) {
    const twist = plot.twist;
    if (twist?.kind === 'false-flag' && twist.decoy !== undefined && (twist.cover?.length ?? 0) > 0) {
      const decoyId = twist.decoy as OrgId;
      if (orgs[decoyId] === undefined) {
        orgs = {
          ...orgs,
          [decoyId]: { id: decoyId, name: FRONT_NAME, kind: 'front', allegiance: 'neutral' },
        };
      }
      const orgName = orgs[decoyId]?.name ?? FRONT_NAME;
      const props = (twist.cover ?? []).map((story) => plantProposition(plot.id, story.npc, story.org));
      const id = docId('notice', `plant/${plot.id}`);
      const document: Document = {
        id,
        kind: 'notice',
        title: `A note naming ${orgName}`,
        date: world.time,
        body: `The note says they belong to ${orgName}.`,
        asserts: props.map((prop) => prop.id),
        obtainableAt: stands,
      };
      documents = { ...documents, [id]: document };
      for (const prop of props) {
        documentPropositions = { ...documentPropositions, [prop.id]: prop };
      }
      changed = true;
    }
    if (twist?.kind === 'inside-man' && twist.inside !== undefined) {
      const npcId = twist.inside as NpcId;
      const npc = npcs[npcId];
      if (npc !== undefined) {
        npcs = {
          ...npcs,
          [npcId]: {
            ...npc,
            trueAllegiance: asTruth({ org: HOSTILE_ORG_ID }),
            apparentAllegiance: 'station',
          },
        };
        changed = true;
      }
    }
  }
  if (!changed) {
    return world;
  }
  return { ...world, orgs, npcs, documents, documentPropositions };
}

/** The false-flag rumour articles. One per plot, asserting the same membership as the note. */
export function falseFlagRumours(world: WorldState): NewspaperItem[] {
  const items: NewspaperItem[] = [];
  for (const plot of world.plots ?? []) {
    const cover = firstCover(plot);
    if (cover === undefined) {
      continue;
    }
    const prop = world.documentPropositions[plantPropId(plot.id, cover.npc)];
    if (prop === undefined) {
      continue;
    }
    const name = world.orgs[cover.org as OrgId]?.name ?? FRONT_NAME;
    items.push({
      id: `rumour/plant/${plot.id}`,
      source: 'rumour',
      headline: 'A name in the wrong company',
      summary: `Word around the stands is that they belong to ${name}.`,
      asserts: [prop],
    });
  }
  return items;
}

/**
 * Fold false-flag rumours into an edition that was already selected. An empty
 * list returns the edition unchanged, so a day with no plant keeps the same
 * article draw.
 */
export function withFalseFlagRumour(
  composed: ComposedDocument,
  items: readonly NewspaperItem[],
): ComposedDocument {
  if (items.length === 0) {
    return composed;
  }
  const seen = new Set<PropId>(composed.document.asserts);
  const propositions = [...composed.propositions];
  const extra: string[] = [];
  for (const item of items) {
    const line = `${item.headline}. ${item.summary}`;
    extra.push(line);
    for (const prop of item.asserts) {
      if (seen.has(prop.id)) {
        continue;
      }
      seen.add(prop.id);
      propositions.push(prop);
    }
  }
  const body = [composed.document.body, ...extra]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('\n\n');
  return {
    document: {
      ...composed.document,
      body,
      asserts: propositions.map((prop) => prop.id),
    },
    propositions,
  };
}

/** Ground truth a twist adds. The planted decoy membership is deliberately absent. */
export function twistGroundTruth(world: WorldState): {
  readonly facts: readonly Proposition[];
  readonly allegiances: readonly { readonly npc: NpcId; readonly allegiance: Allegiance }[];
} {
  const facts: Proposition[] = [];
  const allegiances: { npc: NpcId; allegiance: Allegiance }[] = [];
  for (const plot of world.plots ?? []) {
    if (plot.twist?.kind === 'false-flag') {
      for (const cell of plot.cells) {
        for (const member of cell.members) {
          facts.push({
            id: `prop:twist/${plot.id}/${member}/cell`,
            subject: member as EntityId,
            predicate: 'MEMBER_OF',
            object: cell.org as EntityId,
          });
        }
      }
    }
    if (plot.twist?.kind === 'inside-man' && plot.twist.inside !== undefined) {
      const npc = plot.twist.inside as NpcId;
      allegiances.push({ npc, allegiance: { org: HOSTILE_ORG_ID } });
      facts.push({
        id: `prop:twist/${plot.id}/inside/member`,
        subject: npc,
        predicate: 'MEMBER_OF',
        object: HOSTILE_ORG_ID,
      });
      facts.push({
        id: `prop:twist/${plot.id}/inside/reports`,
        subject: npc,
        predicate: 'REPORTS_TO',
        object: HOSTILE_ORG_ID,
      });
    }
  }
  return { facts, allegiances };
}
