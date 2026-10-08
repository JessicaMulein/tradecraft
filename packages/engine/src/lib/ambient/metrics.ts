/**
 * City metrics (ambient-world Req 4). Each metric is an exogenous component
 * plus a reactive one. The total is their clamped sum. Exogenous events write
 * the exogenous component; player consequences write the reactive one.
 */

import { METRIC_IDS } from './content.js';
import type { Metrics, MetricId } from './state.js';

export interface MetricDef {
  readonly id: MetricId;
  readonly baseline: number;
  readonly decay: number;
}

export function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function metricTotal(metrics: Metrics, id: MetricId): number {
  return clamp01(metrics.exo[id] + metrics.react[id]);
}

function stepToward(value: number, target: number, rate: number): number {
  if (value < target) {
    return clamp01(Math.min(target, value + rate));
  }
  return clamp01(Math.max(target, value - rate));
}

/** Move the exogenous component toward the content baseline and the reactive component toward 0. */
export function decayMetrics(metrics: Metrics, defs: readonly MetricDef[]): Metrics {
  const exo = { ...metrics.exo };
  const react = { ...metrics.react };
  for (const id of METRIC_IDS) {
    const def = defs.find((item) => item.id === id);
    const baseline = def?.baseline ?? 0;
    const rate = def?.decay ?? 0;
    exo[id] = stepToward(exo[id], baseline, rate);
    react[id] = stepToward(react[id], 0, rate);
  }
  return { exo, react };
}

export function applyMetricDelta(
  metrics: Metrics,
  id: MetricId,
  delta: number,
  channel: 'exo' | 'react',
): Metrics {
  const next = channel === 'exo' ? { ...metrics.exo } : { ...metrics.react };
  next[id] = clamp01(next[id] + delta);
  return channel === 'exo'
    ? { exo: next, react: metrics.react }
    : { exo: metrics.exo, react: next };
}

/** A public player consequence (arrest, detected surveillance, seized drop) lands on the reactive component. */
export function applyPlayerDelta(metrics: Metrics, id: MetricId, delta: number): Metrics {
  return applyMetricDelta(metrics, id, delta, 'react');
}
