/**
 * The only ambient module allowed to change a running plot or hand the
 * hostile service a belief-adjacent input. Delay and reroute call the slice
 * responses directly: the deadline moves, or the place moves to another
 * location of the same type. Neither draws `onDisrupted`, so abort pressure
 * stays where it was.
 */

import { delayStage, sameTypeAlternative } from '../clock/plot-execution.js';
import type { AmbientCoupling } from '../fidelity/types.js';
import { asTruth, revealTruth, type ChannelId, type LocId, type NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { InformantReportInput } from '../hostile/hostile.js';

import { applyPlayerDelta } from './metrics.js';
import { ambientPreset } from './preset.js';
import type { AmbientState } from './state.js';

export type AmbientHook =
  | { readonly kind: 'delay-stage'; readonly stage: string; readonly days: 1 | 2 }
  | { readonly kind: 'reroute-location'; readonly stage: string; readonly from: LocId }
  | { readonly kind: 'channel-outage'; readonly channel: string; readonly untilDay: number }
  | { readonly kind: 'cover-suspicion-delta'; readonly amount: number }
  | {
      readonly kind: 'informant-report';
      readonly informant: NpcId;
      readonly handler: 'police' | 'hostile';
      readonly seenWith?: NpcId;
    }
  | { readonly kind: 'detection-bonus'; readonly npc: NpcId; readonly bonus: number };

export interface HookResult {
  readonly next: WorldState;
  readonly applied: boolean;
}

const POLICE_REPORT_PRESSURE = 0.05;

/** Plot-delay cap shared with `applyCouplings`. A day past the cap is refused. */
export function cappedPlotDelay(
  used: number,
  days: number,
  maxPlotDelayDays: number,
): { readonly applied: boolean; readonly plotDelayDays: number } {
  const applied = used + days <= maxPlotDelayDays;
  return { applied, plotDelayDays: applied ? used + days : used };
}

/** Cover-suspicion cap shared with `applyCouplings`. A zero remainder is refused. */
export function cappedCoverSuspicion(
  suspicion: number,
  coverPos: number,
  coverNeg: number,
  amount: number,
  maxCoverSuspicionPerDay: number,
): {
  readonly suspicion: number;
  readonly coverPos: number;
  readonly coverNeg: number;
  readonly amount: number;
  readonly applied: boolean;
} {
  let next = amount;
  if (next > 0) {
    next = Math.min(next, Math.max(0, maxCoverSuspicionPerDay - coverPos));
  } else if (next < 0) {
    next = -Math.min(-next, Math.max(0, maxCoverSuspicionPerDay - coverNeg));
  }
  if (next === 0) {
    return { suspicion, coverPos, coverNeg, amount: 0, applied: false };
  }
  return {
    suspicion: Math.min(1, Math.max(0, suspicion + next)),
    coverPos: next > 0 ? coverPos + next : coverPos,
    coverNeg: next < 0 ? coverNeg - next : coverNeg,
    amount: next,
    applied: true,
  };
}

function limitsOf(world: WorldState): { maxPlotDelayDays: number; maxCoverSuspicionPerDay: number } {
  const id = world.meta?.preset?.id ?? 'standard';
  const table = ambientPreset(id);
  return {
    maxPlotDelayDays: table.maxPlotDelayDays,
    maxCoverSuspicionPerDay: table.maxCoverSuspicionPerDay,
  };
}

function withAmbient(world: WorldState, ambient: AmbientState, applied: boolean): HookResult {
  return { next: { ...world, ambient }, applied };
}

function record(
  world: WorldState,
  ambient: AmbientState,
  kind: string,
  detail: string,
): AmbientState {
  const ledger = revealTruth(ambient.hookLedger);
  return {
    ...ambient,
    hookLedger: asTruth([...ledger, { kind, day: world.time.day, detail }]),
  };
}

function applyDelay(world: WorldState, ambient: AmbientState, hook: AmbientHook & { kind: 'delay-stage' }): HookResult {
  const limits = limitsOf(world);
  const capped = cappedPlotDelay(ambient.ambientDelayDays, hook.days, limits.maxPlotDelayDays);
  if (!capped.applied) {
    return { next: world, applied: false };
  }
  const plot = delayStage(world.plot, hook.stage, hook.days);
  if (plot === undefined) {
    return { next: world, applied: false };
  }
  const nextAmbient = record(
    world,
    { ...ambient, ambientDelayDays: capped.plotDelayDays },
    hook.kind,
    `${hook.stage}+${hook.days}`,
  );
  return { next: { ...world, plot, ambient: nextAmbient }, applied: true };
}

function applyReroute(
  world: WorldState,
  ambient: AmbientState,
  hook: AmbientHook & { kind: 'reroute-location' },
): HookResult {
  const alternative = sameTypeAlternative(world.city.locations, hook.from);
  if (alternative === undefined) {
    return { next: world, applied: false };
  }
  let moved = false;
  const stages = world.plot.stages.map((stage) => {
    if (stage.id !== hook.stage) {
      return stage;
    }
    const traces = stage.traces.map((trace) => {
      if (trace.place?.kind === 'loc' && trace.place.loc === hook.from) {
        moved = true;
        return { ...trace, place: { kind: 'loc' as const, loc: alternative as LocId } };
      }
      return trace;
    });
    return { ...stage, traces };
  });
  if (!moved) {
    return { next: world, applied: false };
  }
  const nextAmbient = record(world, ambient, hook.kind, `${hook.from}->${alternative}`);
  return {
    next: { ...world, plot: { ...world.plot, stages }, ambient: nextAmbient },
    applied: true,
  };
}

function applyOutage(
  world: WorldState,
  ambient: AmbientState,
  hook: AmbientHook & { kind: 'channel-outage' },
): HookResult {
  const alternate =
    Object.keys(world.channels)
      .filter((id) => id !== hook.channel)
      .sort()[0] ?? 'courier';
  const nextAmbient = record(
    world,
    {
      ...ambient,
      channelOutages: [
        ...ambient.channelOutages,
        { channel: hook.channel, untilDay: hook.untilDay, alternate },
      ],
    },
    hook.kind,
    `${hook.channel}->${alternate}`,
  );
  return withAmbient(world, nextAmbient, true);
}

function applyCover(
  world: WorldState,
  ambient: AmbientState,
  hook: AmbientHook & { kind: 'cover-suspicion-delta' },
): HookResult {
  const max = limitsOf(world).maxCoverSuspicionPerDay;
  const today = ambient.coverDeltaToday;
  const capped = cappedCoverSuspicion(
    revealTruth(world.player.coverSuspicion),
    today.pos,
    today.neg,
    hook.amount,
    max,
  );
  if (!capped.applied) {
    return { next: world, applied: false };
  }
  const amount = capped.amount;
  const suspicion = capped.suspicion;
  const coverDeltaToday = { pos: capped.coverPos, neg: capped.coverNeg };
  const nextAmbient = record(
    world,
    { ...ambient, coverDeltaToday },
    hook.kind,
    String(amount),
  );
  return {
    next: {
      ...world,
      player: { ...world.player, coverSuspicion: asTruth(suspicion) },
      ambient: nextAmbient,
    },
    applied: true,
  };
}

function applyReport(
  world: WorldState,
  ambient: AmbientState,
  hook: AmbientHook & { kind: 'informant-report' },
): HookResult {
  const metrics =
    hook.handler === 'police'
      ? applyPlayerDelta(ambient.metrics, 'police', POLICE_REPORT_PRESSURE)
      : ambient.metrics;
  const nextAmbient = record(
    world,
    {
      ...ambient,
      metrics,
      informantReports: [
        ...ambient.informantReports,
        {
          visibility: 'hidden',
          informant: hook.informant,
          handler: hook.handler,
          ...(hook.seenWith !== undefined ? { seenWith: hook.seenWith } : {}),
        },
      ],
    },
    hook.kind,
    `${hook.handler}:${hook.informant}`,
  );
  return withAmbient(world, nextAmbient, true);
}

function applyBonus(
  world: WorldState,
  ambient: AmbientState,
  hook: AmbientHook & { kind: 'detection-bonus' },
): HookResult {
  const detectionBonuses = {
    ...ambient.detectionBonuses,
    [hook.npc]: (ambient.detectionBonuses[hook.npc] ?? 0) + hook.bonus,
  };
  const nextAmbient = record(world, { ...ambient, detectionBonuses }, hook.kind, hook.npc);
  return withAmbient(world, nextAmbient, true);
}

/**
 * Apply one ambient hook. A rejected hook leaves the world unchanged and is
 * not written to the ledger. Channel outages never touch compromised channels.
 */
function asChannel(channel: string): ChannelId {
  return (channel.startsWith('chan:') ? channel : `chan:${channel}`) as ChannelId;
}

/** Queue the hook for the region clock. The spine is not written here. */
function couplingOf(hook: AmbientHook): AmbientCoupling {
  switch (hook.kind) {
    case 'delay-stage':
      return { kind: 'delay-stage', stage: hook.stage, days: hook.days };
    case 'reroute-location':
      return { kind: 'reroute-location', stage: hook.stage, from: hook.from };
    case 'channel-outage':
      return { kind: 'channel-outage', channel: asChannel(hook.channel), window: { untilDay: hook.untilDay } };
    case 'cover-suspicion-delta':
      return { kind: 'cover-suspicion-delta', amount: hook.amount, cause: 'ambient' };
    case 'informant-report':
      return {
        kind: 'informant-report',
        informant: hook.informant,
        item: hook.seenWith ?? hook.informant,
        handler: hook.handler === 'police' ? 'police' : 'service:hostile',
      };
    case 'detection-bonus':
      return { kind: 'detection-bonus', npc: hook.npc, bonus: hook.bonus };
    default: {
      const unreachable: never = hook;
      return unreachable;
    }
  }
}

export function applyHook(world: WorldState, hook: AmbientHook): HookResult {
  const ambient = world.ambient;
  if (ambient === undefined) {
    return { next: world, applied: false };
  }
  if (ambient.multiCity === true) {
    return withAmbient(
      world,
      { ...ambient, pendingCouplings: [...(ambient.pendingCouplings ?? []), couplingOf(hook)] },
      true,
    );
  }
  switch (hook.kind) {
    case 'delay-stage':
      return applyDelay(world, ambient, hook);
    case 'reroute-location':
      return applyReroute(world, ambient, hook);
    case 'channel-outage':
      return applyOutage(world, ambient, hook);
    case 'cover-suspicion-delta':
      return applyCover(world, ambient, hook);
    case 'informant-report':
      return applyReport(world, ambient, hook);
    case 'detection-bonus':
      return applyBonus(world, ambient, hook);
    default: {
      const unreachable: never = hook;
      return unreachable;
    }
  }
}

/** Reports the hostile tailing step reads. Police reports stay on the city metric. */
export function informantReportsForTick(ambient: AmbientState): readonly InformantReportInput[] {
  return ambient.informantReports.map((report) => ({
    handler: report.handler,
    ...(report.seenWith !== undefined ? { seenWith: report.seenWith } : {}),
  }));
}
