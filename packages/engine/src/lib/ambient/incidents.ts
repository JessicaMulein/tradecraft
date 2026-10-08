/**
 * Local incidents (ambient-world Req 5.9). One draw per location and phase,
 * stopped at the density cap. Each record is a hidden incident.
 */

import type { Prng } from '../prng/prng.js';

export interface IncidentTemplate {
  readonly id: string;
  readonly locQuery: readonly string[];
  readonly phases: readonly string[];
  readonly factLine: string;
}

export interface IncidentSite {
  readonly id: string;
  readonly tags: readonly string[];
}

export interface LocalIncident {
  readonly kind: 'incident';
  readonly visibility: 'hidden';
  readonly loc: string;
  readonly phase: string;
  readonly templateId: string;
  readonly factLine: string;
}

function matches(site: IncidentSite, query: readonly string[]): boolean {
  return query.every((tag) => site.tags.includes(tag));
}

export function selectIncidents(args: {
  readonly sites: readonly IncidentSite[];
  readonly phase: string;
  readonly templates: readonly IncidentTemplate[];
  readonly cap: number;
  readonly rng: Prng;
}): LocalIncident[] {
  const found: LocalIncident[] = [];
  const sites = [...args.sites].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const site of sites) {
    if (found.length >= args.cap) {
      break;
    }
    const pool = args.templates.filter(
      (template) => template.phases.includes(args.phase) && matches(site, template.locQuery),
    );
    if (pool.length === 0 || !args.rng.bool(0.5)) {
      continue;
    }
    const template = args.rng.pick(pool);
    found.push({
      kind: 'incident',
      visibility: 'hidden',
      loc: site.id,
      phase: args.phase,
      templateId: template.id,
      factLine: template.factLine,
    });
  }
  return found;
}
