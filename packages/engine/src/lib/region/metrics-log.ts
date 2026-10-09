/**
 * Regional timings for the play metrics log (multi-city Req 19.7).
 *
 * The log is the same JSONL file as model-call metrics (`scenario.metrics.path`).
 * A line uses `role: 'region'` so a reader that only understands voice and
 * narrator lines skips it. Writing is best effort and never changes the world.
 *
 * The default path is not written while Vitest is running. Generation tests
 * would otherwise append once per attempt. An explicit path, and play outside
 * the test runner, still record. Tests install {@link setRegionMetricsSink}.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type RegionTimingPurpose =
  | 'region-generate'
  | 'region-advance-coarse'
  | 'region-advance-full'
  | 'region-reconcile';

export interface RegionMetricsTarget {
  readonly enabled: boolean;
  readonly path: string;
}

export interface RegionTimingRecord {
  readonly at: number;
  readonly role: 'region';
  readonly model: 'sim';
  readonly purpose: RegionTimingPurpose;
  readonly ttfsMs: null;
  readonly durationMs: number;
  readonly completionTokens: 0;
  readonly tokensPerSec: null;
  readonly outcome: 'ok';
  readonly day: number;
  readonly phase: number;
  readonly city?: string;
}

export interface RegionTimingInput {
  readonly purpose: RegionTimingPurpose;
  readonly durationMs: number;
  readonly day: number;
  readonly phase: number;
  readonly city?: string;
}

export interface RegionMetricsSink {
  append(record: RegionTimingRecord): void;
}

let override: RegionMetricsSink | undefined;
const files = new Map<string, FileRegionSink>();

/** Tests install a sink here. Production uses the scenario metrics file. */
export function setRegionMetricsSink(sink: RegionMetricsSink | undefined): void {
  override = sink;
}

/** Wait for queued file appends. Tests use this before reading the log. */
export async function flushRegionMetrics(): Promise<void> {
  const pending = [...files.values()].map((sink) => sink.flush());
  await Promise.all(pending);
}

/**
 * Append one regional timing. Disabled metrics do not write. With no sink and
 * no enabled file target, this is a no-op.
 */
export function recordRegionTiming(
  metrics: RegionMetricsTarget | undefined,
  input: RegionTimingInput,
): void {
  if (metrics?.enabled === false) {
    return;
  }
  const sink = override ?? (fileRecording(metrics) ? fileSink(metrics.path) : undefined);
  if (sink === undefined) {
    return;
  }
  sink.append(toRecord(input));
}

function fileRecording(metrics: RegionMetricsTarget | undefined): metrics is RegionMetricsTarget {
  if (metrics?.enabled !== true) {
    return false;
  }
  if (process.env.VITEST !== undefined && metrics.path === 'logs/metrics.jsonl') {
    return false;
  }
  return true;
}

function toRecord(input: RegionTimingInput): RegionTimingRecord {
  const record: RegionTimingRecord = {
    at: Date.now(),
    role: 'region',
    model: 'sim',
    purpose: input.purpose,
    ttfsMs: null,
    durationMs: input.durationMs,
    completionTokens: 0,
    tokensPerSec: null,
    outcome: 'ok',
    day: input.day,
    phase: input.phase,
  };
  if (input.city === undefined) {
    return record;
  }
  return { ...record, city: input.city };
}

function fileSink(path: string): FileRegionSink {
  const existing = files.get(path);
  if (existing !== undefined) {
    return existing;
  }
  const created = new FileRegionSink(path);
  files.set(path, created);
  return created;
}

class FileRegionSink implements RegionMetricsSink {
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  append(record: RegionTimingRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    this.writeTail = this.writeTail
      .catch(() => undefined)
      .then(() => appendFile(this.path, line, 'utf8'))
      .catch((err: unknown) => {
        if (isMissingDir(err)) {
          return mkdir(dirname(this.path), { recursive: true }).then(() =>
            appendFile(this.path, line, 'utf8'),
          );
        }
        return undefined;
      })
      .catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.writeTail.catch(() => undefined);
  }
}

function isMissingDir(err: unknown): boolean {
  return err !== null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT';
}
