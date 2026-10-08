/**
 * The Instantiator (plot-library). Turns an expansion into cells, a twist and
 * the standing values a secondary plot carries. Schema-1 templates do not come
 * through here: {@link instantiateChosenPlot} in the slice generator remains
 * the path that reproduces slice draws.
 */

import type { PlotTemplateV2 } from '@tradecraft/content';
import type { Prng } from '../prng/prng.js';
import type { ExpandedPlot } from './expand.js';
import { variantKey } from './expand.js';
import type { LibraryPreset } from './preset.js';
import { frontOrgId } from './twists.js';

export interface InstantiateWorld {
  readonly hostileOrg: string;
  readonly contacts: readonly string[];
  readonly stationStaff: readonly string[];
  readonly mole?: string;
  readonly orgsForQuery: (query: readonly string[]) => readonly string[];
  readonly npcsForQuery: (query: readonly string[]) => readonly string[];
}

export interface InstantiatedPlot {
  readonly templateId: string;
  readonly role: 'primary' | 'secondary';
  readonly variantKey: string;
  readonly cells: readonly {
    readonly org: string;
    readonly spec: string;
    readonly security: number;
    readonly members: readonly string[];
  }[];
  readonly cutouts: readonly string[];
  readonly twist?: {
    readonly kind: 'false-flag' | 'facade' | 'inside-man';
    readonly present: true;
    readonly facadeStages: readonly string[];
    readonly decoy?: string;
    readonly inside?: string;
    readonly cover?: readonly { readonly npc: string; readonly org: string }[];
    readonly plants?: readonly { readonly kind: 'document' | 'rumour'; readonly org: string }[];
    readonly trueAllegiance?: 'hostile';
    readonly apparentAllegiance?: 'station';
  };
  readonly standingPenalty: number;
  readonly standingReward: number;
  readonly damageReport?: string;
  readonly offMap: readonly string[];
  readonly subPlots: readonly string[];
  /** Bound item id → the entity that holds it before any handover. */
  readonly itemOrigins: Readonly<Record<string, string>>;
}

function itemOriginsFor(
  template: PlotTemplateV2,
  bindings: Readonly<Record<string, string>>,
  cells: InstantiatedPlot['cells'],
): Readonly<Record<string, string>> {
  const person = cells.flatMap((cell) => cell.members)[0];
  const depotName = Object.entries(template.params).find(([, param]) => param.kind === 'loc')?.[0];
  const depot = depotName === undefined ? undefined : bindings[depotName];
  const origin = person ?? depot;
  if (origin === undefined) {
    return {};
  }
  const origins: Record<string, string> = {};
  for (const [name, param] of Object.entries(template.params)) {
    if (param.kind !== 'item') {
      continue;
    }
    const item = bindings[name];
    if (item !== undefined) {
      origins[item] = origin;
    }
  }
  return origins;
}

function securityFor(template: PlotTemplateV2, preset: LibraryPreset): number {
  const base = 0.4;
  const override = template.difficulty?.[preset.id as 'easy' | 'standard' | 'hard']?.tradecraft ?? 0;
  return Math.min(1, Math.max(0, base + override));
}

/**
 * Instantiate an expanded plot. The twist draw is the first use of `rng`, so
 * the variant key can include it. Cell members are the first unused NPC for
 * each role query.
 */
export function instantiate(
  template: PlotTemplateV2,
  expanded: ExpandedPlot,
  preset: LibraryPreset,
  world: InstantiateWorld,
  rng: Prng,
  role: 'primary' | 'secondary' = 'primary',
  packVersion = '1',
  bindings: Readonly<Record<string, string>> = {},
  /**
   * NPCs already cast in a non-shareable role of an earlier plot. A later
   * plot may not reuse them (plot-library Req 8.3).
   */
  claimed: Set<string> = new Set(),
  /**
   * NPCs cast only in roles both sides may share. A later shareable role may
   * reuse one; a non-shareable role may not.
   */
  shareableHeld: Set<string> = new Set(),
): InstantiatedPlot {
  const twistOn =
    template.twist !== undefined &&
    (template.twist.mandatory || rng.next() < preset.twistProbability);
  const used = new Set<string>();
  const memberFor = (slot: string): string => {
    const shareable = template.roleSlots[slot]?.shareable === true;
    const query = template.roleSlots[slot]?.query ?? ['role:cell'];
    const pool = world.npcsForQuery(query).filter((id) => {
      if (used.has(id)) {
        return false;
      }
      if (claimed.has(id)) {
        return false;
      }
      return shareable || !shareableHeld.has(id);
    });
    const chosen = pool[0] ?? `npc:${template.id}-${slot}`;
    used.add(chosen);
    if (shareable) {
      shareableHeld.add(chosen);
    } else {
      claimed.add(chosen);
    }
    return chosen;
  };

  const cells = template.cells.map((cell) => ({
    org: `org:cell-${template.id}-${cell.id}`,
    spec: cell.id,
    security: securityFor(template, preset),
    members: cell.roles.map((slot) => memberFor(slot)),
  }));
  const holderOf = (slot: string): string | undefined => {
    for (let index = 0; index < template.cells.length; index += 1) {
      const roleIndex = template.cells[index]?.roles.indexOf(slot) ?? -1;
      const member = roleIndex < 0 ? undefined : cells[index]?.members[roleIndex];
      if (member !== undefined) {
        return member;
      }
    }
    return undefined;
  };
  const cutouts = template.cutouts.map((cutout) => holderOf(cutout.role) ?? memberFor(cutout.role));

  let twist: InstantiatedPlot['twist'];
  if (twistOn && template.twist !== undefined) {
    if (template.twist.kind === 'false-flag') {
      const found = world
        .orgsForQuery(template.twist.decoy?.query ?? ['org:criminal'])
        .find((id) => id !== world.hostileOrg);
      const decoy = found ?? frontOrgId(template.id);
      const members = cells.flatMap((cell) => cell.members);
      twist = {
        kind: 'false-flag',
        present: true,
        facadeStages: [],
        decoy,
        cover: members.map((npc) => ({ npc, org: decoy })),
        plants: [
          { kind: 'document' as const, org: decoy },
          { kind: 'rumour' as const, org: decoy },
        ],
      };
    } else if (template.twist.kind === 'facade') {
      twist = {
        kind: 'facade',
        present: true,
        facadeStages: template.twist.facadeStages,
      };
    } else {
      const pool = [...world.contacts, ...world.stationStaff].filter((id) => id !== world.mole);
      const inside = pool[0];
      twist = {
        kind: 'inside-man',
        present: true,
        facadeStages: [],
        ...(inside === undefined
          ? {}
          : { inside, trueAllegiance: 'hostile' as const, apparentAllegiance: 'station' as const }),
      };
    }
  }

  return {
    templateId: template.id,
    role,
    variantKey: variantKey(
      template.id,
      packVersion,
      expanded.staticChoices,
      expanded.optionalIncluded,
      twist?.kind ?? null,
    ),
    cells,
    cutouts,
    ...(twist === undefined ? {} : { twist }),
    standingPenalty: template.secondary?.standingPenalty ?? 0,
    standingReward: template.secondary?.standingReward ?? 0,
    ...(template.secondary?.damageReport === undefined
      ? {}
      : { damageReport: template.secondary.damageReport }),
    offMap: expanded.offMap,
    subPlots: expanded.subPlots,
    itemOrigins: itemOriginsFor(template, bindings, cells),
  };
}
