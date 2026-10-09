/**
 * Regional Verifier (multi-city design, engine/region/verify).
 *
 * The slice learnability graph stays in city/discovery. This module adds the
 * regional edges the ambient gate re-checks in multi-city mode: travel (papers),
 * terminal surveillance, carriage meetings, liaison requests, remote tasking
 * and courier intercepts. Disjointness includes liaison services. A structural
 * change is accepted only when every previously solvable key is still covered
 * and a jurisdiction-permitted success condition remains.
 *
 * The generator registers the graph it just verified. It is not stored on the
 * single-city world, so slice saves and goldens stay unchanged. The multi-city
 * adapter attaches it for the advance.
 */

import type { StructuralChange, VerifierPath } from '../ambient/solvability.js';

export type RegionalEdge =
  | 'meeting'
  | 'intercept'
  | 'surveillance'
  | 'read'
  | 'travel'
  | 'terminal'
  | 'carriage'
  | 'liaison'
  | 'remote-tasking'
  | 'courier';

export type RegionalSuccess = 'arrest' | 'handoff' | 'abort';

export interface RegionWitness {
  readonly role: 'human' | 'signal';
  readonly edge: RegionalEdge;
  readonly node: string;
  readonly liaison?: string;
  readonly route?: string;
  readonly requiresPapers?: readonly string[];
}

export interface RegionTarget {
  readonly key: string;
  readonly paths: readonly RegionWitness[];
}

export interface RegionGraph {
  readonly papers: readonly string[];
  readonly obtainablePapers: readonly string[];
  readonly knownLocs: readonly string[];
  readonly targets: readonly RegionTarget[];
  readonly jurisdiction: readonly { readonly city: string; readonly permitsArrest: boolean }[];
  readonly success: readonly RegionalSuccess[];
  readonly handoffAt: readonly string[];
  readonly abortRoutes: readonly string[];
  /**
   * The Starting Brief the graph was built from. Present on a graph the region
   * generator just verified (Requirement 14.5).
   */
  readonly brief?: {
    readonly papers: readonly string[];
    readonly cities: readonly string[];
    readonly routes: readonly string[];
    readonly liaisons: readonly string[];
  };
}

export interface RegionalVerification {
  readonly ok: boolean;
  readonly solvable: ReadonlySet<string>;
  readonly witnesses: ReadonlyMap<string, readonly [VerifierPath, VerifierPath]>;
}

const graphs = new Map<string, RegionGraph>();

export function registerRegionGraph(seed: string, graph: RegionGraph): void {
  graphs.set(seed, graph);
}

export function regionGraphFor(seed: string): RegionGraph | undefined {
  return graphs.get(seed);
}

export function graphFromWitnesses(
  witnesses: ReadonlyMap<string, readonly [VerifierPath, VerifierPath]>,
  knownLocs: readonly string[],
): RegionGraph {
  const targets: RegionTarget[] = [...witnesses.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, [human, signal]]) => ({
      key,
      paths: [
        { role: 'human', edge: sliceEdge(human.edge), node: human.node },
        { role: 'signal', edge: sliceEdge(signal.edge), node: signal.node },
      ],
    }));
  return {
    papers: [],
    obtainablePapers: [],
    knownLocs,
    targets,
    jurisdiction: [{ city: 'city:home', permitsArrest: true }],
    success: ['arrest'],
    handoffAt: [],
    abortRoutes: [],
  };
}

function sliceEdge(edge: VerifierPath['edge']): RegionalEdge {
  return edge;
}

export function routeId(a: string, b: string): string {
  return a < b ? `route:${a}|${b}` : `route:${b}|${a}`;
}

function papersOk(witness: RegionWitness, graph: RegionGraph): boolean {
  const required = witness.requiresPapers ?? [];
  if (required.length === 0) {
    return true;
  }
  const held = new Set([...graph.papers, ...graph.obtainablePapers]);
  return required.every((paper) => held.has(paper));
}

function disjoint(human: RegionWitness, signal: RegionWitness): boolean {
  if (human.liaison !== undefined && human.liaison === signal.liaison) {
    return false;
  }
  return human.node === '' || human.node !== signal.node;
}

function slicePath(witness: RegionWitness): VerifierPath {
  const edge = witness.edge;
  if (edge === 'intercept' || edge === 'courier') {
    return { edge: 'intercept', node: witness.node };
  }
  if (edge === 'surveillance' || edge === 'terminal') {
    return { edge: 'surveillance', node: witness.node };
  }
  if (edge === 'read') {
    return { edge: 'read', node: witness.node };
  }
  return { edge: 'meeting', node: witness.node };
}

function successHolds(graph: RegionGraph): boolean {
  if (graph.success.length === 0) {
    return true;
  }
  return graph.success.some((kind) => {
    if (kind === 'arrest') {
      return graph.jurisdiction.some((item) => item.permitsArrest);
    }
    if (kind === 'handoff') {
      return graph.handoffAt.length > 0;
    }
    return graph.abortRoutes.length > 0;
  });
}

function blocked(witness: RegionWitness, change: StructuralChange, graph: RegionGraph): boolean {
  switch (change.kind) {
    case 'location-status':
      if (change.status === 'open' || change.status === 'newly-opened') {
        return false;
      }
      return change.locs.includes(witness.node);
    case 'route-closure':
      return witness.route === routeId(change.a, change.b);
    case 'detain-npc':
      return witness.node === change.npc;
    case 'schedule-override':
      return (
        witness.role === 'human' &&
        witness.node === change.npc &&
        !graph.knownLocs.includes(change.loc)
      );
    case 'channel-outage':
      return witness.node === change.channel;
  }
}

/** The graph the verifier should read once `change` has been applied for its full duration. */
export function applyRegionalChange(graph: RegionGraph, change: StructuralChange): RegionGraph {
  const closed =
    change.kind === 'location-status' && change.status !== 'open' && change.status !== 'newly-opened'
      ? new Set(change.locs)
      : undefined;
  const closedRoute = change.kind === 'route-closure' ? routeId(change.a, change.b) : undefined;
  return {
    ...graph,
    targets: graph.targets.map((target) => ({
      key: target.key,
      paths: target.paths.filter((witness) => papersOk(witness, graph) && !blocked(witness, change, graph)),
    })),
    handoffAt: closed === undefined ? graph.handoffAt : graph.handoffAt.filter((loc) => !closed.has(loc)),
    abortRoutes:
      closedRoute === undefined ? graph.abortRoutes : graph.abortRoutes.filter((route) => route !== closedRoute),
  };
}

/**
 * Cover each target with a human path and a signal path that share no NPC,
 * channel or liaison. Jurisdiction must still permit a success condition.
 */
export function verifyRegion(graph: RegionGraph): RegionalVerification {
  const solvable = new Set<string>();
  const witnesses = new Map<string, readonly [VerifierPath, VerifierPath]>();
  if (!successHolds(graph)) {
    return { ok: false, solvable, witnesses };
  }
  for (const target of graph.targets) {
    const humans = target.paths.filter((path) => path.role === 'human' && papersOk(path, graph));
    const signals = target.paths.filter((path) => path.role === 'signal' && papersOk(path, graph));
    let covered: readonly [RegionWitness, RegionWitness] | undefined;
    for (const human of humans) {
      for (const signal of signals) {
        if (disjoint(human, signal)) {
          covered = [human, signal];
          break;
        }
      }
      if (covered !== undefined) {
        break;
      }
    }
    if (covered === undefined) {
      continue;
    }
    solvable.add(target.key);
    witnesses.set(target.key, [slicePath(covered[0]), slicePath(covered[1])]);
  }
  const ok = graph.targets.every((target) => solvable.has(target.key));
  return { ok, solvable, witnesses };
}
