/**
 * Apply ambient couplings onto a spine draft. Hook kinds use the same caps as
 * the ambient hook gateway (ambientPreset). Rejected hook kinds are recorded
 * and do not change the capped totals. Location, crowd, and route couplings
 * have no slice equivalent; they land on the draft.
 */

import { cappedCoverSuspicion, cappedPlotDelay } from '../ambient/hooks.js';
import { ambientPreset } from '../ambient/preset.js';

import type { AmbientCoupling } from './types.js';

export interface CouplingCaps {
  readonly maxPlotDelayDays: number;
  readonly maxCoverSuspicionPerDay: number;
}

export interface CouplingDraft {
  readonly plotDelayDays: number;
  readonly coverPos: number;
  readonly coverNeg: number;
  readonly suspicion: number;
  readonly closed: Readonly<Record<string, number>>;
  readonly crowd: Readonly<Record<string, number>>;
  readonly routeDelay: Readonly<Record<string, number>>;
  readonly reroutes: readonly { readonly stage: string; readonly from: string }[];
  readonly outages: readonly { readonly channel: string; readonly untilDay: number }[];
  readonly reports: readonly { readonly informant: string; readonly item: string; readonly handler: string }[];
  readonly detection: Readonly<Record<string, number>>;
  readonly ledger: readonly { readonly kind: string; readonly applied: boolean }[];
}

export function ambientCouplingCaps(presetId = 'standard'): CouplingCaps {
  const table = ambientPreset(presetId);
  return {
    maxPlotDelayDays: table.maxPlotDelayDays,
    maxCoverSuspicionPerDay: table.maxCoverSuspicionPerDay,
  };
}

export function emptyCouplingDraft(): CouplingDraft {
  return {
    plotDelayDays: 0,
    coverPos: 0,
    coverNeg: 0,
    suspicion: 0,
    closed: {},
    crowd: {},
    routeDelay: {},
    reroutes: [],
    outages: [],
    reports: [],
    detection: {},
    ledger: [],
  };
}

function ledger(draft: CouplingDraft, kind: string, applied: boolean): CouplingDraft['ledger'] {
  return [...draft.ledger, { kind, applied }];
}

export function applyCouplings(
  draft: CouplingDraft,
  couplings: readonly AmbientCoupling[],
  caps: CouplingCaps = ambientCouplingCaps(),
): CouplingDraft {
  let next = draft;
  for (const coupling of couplings) {
    switch (coupling.kind) {
      case 'location-closed':
        next = {
          ...next,
          closed: { ...next.closed, [coupling.loc]: coupling.phases },
          ledger: ledger(next, coupling.kind, true),
        };
        break;
      case 'crowd-modifier':
        next = {
          ...next,
          crowd: { ...next.crowd, [coupling.loc]: coupling.factor },
          ledger: ledger(next, coupling.kind, true),
        };
        break;
      case 'route-delay':
        next = {
          ...next,
          routeDelay: { ...next.routeDelay, [coupling.route]: coupling.phases },
          ledger: ledger(next, coupling.kind, true),
        };
        break;
      case 'delay-stage': {
        const capped = cappedPlotDelay(next.plotDelayDays, coupling.days, caps.maxPlotDelayDays);
        next = {
          ...next,
          plotDelayDays: capped.plotDelayDays,
          ledger: ledger(next, coupling.kind, capped.applied),
        };
        break;
      }
      case 'reroute-location':
        next = {
          ...next,
          reroutes: [...next.reroutes, { stage: coupling.stage, from: coupling.from }],
          ledger: ledger(next, coupling.kind, true),
        };
        break;
      case 'channel-outage':
        next = {
          ...next,
          outages: [...next.outages, { channel: coupling.channel, untilDay: coupling.window.untilDay }],
          ledger: ledger(next, coupling.kind, true),
        };
        break;
      case 'cover-suspicion-delta': {
        const capped = cappedCoverSuspicion(
          next.suspicion,
          next.coverPos,
          next.coverNeg,
          coupling.amount,
          caps.maxCoverSuspicionPerDay,
        );
        next = {
          ...next,
          suspicion: capped.suspicion,
          coverPos: capped.coverPos,
          coverNeg: capped.coverNeg,
          ledger: ledger(next, coupling.kind, capped.applied),
        };
        break;
      }
      case 'informant-report':
        next = {
          ...next,
          reports: [
            ...next.reports,
            { informant: coupling.informant, item: coupling.item, handler: coupling.handler },
          ],
          ledger: ledger(next, coupling.kind, true),
        };
        break;
      case 'detection-bonus':
        next = {
          ...next,
          detection: {
            ...next.detection,
            [coupling.npc]: (next.detection[coupling.npc] ?? 0) + coupling.bonus,
          },
          ledger: ledger(next, coupling.kind, true),
        };
        break;
      default: {
        const unreachable: never = coupling;
        return unreachable;
      }
    }
  }
  return next;
}
