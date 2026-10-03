/**
 * Mechanical metrics for the model evaluation harness (task 23.2; Req 15.3,
 * 18.2): the reported {@link MechanicalMetrics} shape and the
 * {@link MetricsCollector} that accumulates it over a fixture run from guard
 * outcomes, extraction signals and per-call timing samples.
 */

export {
  METRIC_ROLES,
  MetricsCollector,
  type CallTimingSample,
  type ExtractionCounts,
  type LeakGuardTrip,
  type MechanicalMetrics,
  type MetricRole,
  type PerRole,
  type RefusalRate,
  type ReplyOutcome,
  type SpecificsCheck,
  type ThroughputStats,
  type TtfsStats,
} from './mechanical-metrics.js';
