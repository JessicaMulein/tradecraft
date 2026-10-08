/**
 * Ambient tick timings for the play metrics log (ambient-world Req 2.8).
 *
 * The log is the same JSONL file as model-call metrics (`scenario.metrics.path`).
 * A line is a model-call record with `role: 'ambient'` plus the step breakdown,
 * so a reader that only understands voice and narrator lines skips it. Writing
 * is best effort and never changes the world: a missing directory or a failed
 * append costs a line of telemetry, not a turn.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { WorldState } from '../model/state.js';

export interface AmbientTimingRecord {
  readonly at: number;
  readonly role: 'ambient';
  readonly model: 'sim';
  readonly purpose: 'ambient-day' | 'ambient-phase';
  readonly ttfsMs: null;
  readonly durationMs: number;
  readonly completionTokens: 0;
  readonly tokensPerSec: null;
  readonly outcome: 'ok';
  readonly day: number;
  readonly phase: number;
  readonly steps: Readonly<Record<string, number>>;
}

export interface AmbientMetricsSink {
  append(record: AmbientTimingRecord): void;
}

let override: AmbientMetricsSink | undefined;
const files = new Map<string, AmbientMetricsSink>();

/** Tests install a sink here. Production uses the scenario metrics file. */
export function setAmbientMetricsSink(sink: AmbientMetricsSink | undefined): void {
  override = sink;
}

/** Append one tick's timings. Disabled metrics and worlds without a scenario do not write. */
export function recordAmbientTiming(
  world: WorldState,
  tick: 'day' | 'phase',
  steps: Readonly<Record<string, number>>,
): void {
  const metrics = world.meta?.scenario?.metrics;
  if (metrics?.enabled === false) {
    return;
  }
  const sink = override ?? (metrics?.enabled === true ? fileSink(metrics.path) : undefined);
  if (sink === undefined) {
    return;
  }
  const durationMs = Object.values(steps).reduce((sum, ms) => sum + ms, 0);
  sink.append({
    at: Date.now(),
    role: 'ambient',
    model: 'sim',
    purpose: tick === 'day' ? 'ambient-day' : 'ambient-phase',
    ttfsMs: null,
    durationMs,
    completionTokens: 0,
    tokensPerSec: null,
    outcome: 'ok',
    day: world.time.day,
    phase: world.time.phase,
    steps,
  });
}

function fileSink(path: string): AmbientMetricsSink {
  const existing = files.get(path);
  if (existing !== undefined) {
    return existing;
  }
  const created = new FileAmbientSink(path);
  files.set(path, created);
  return created;
}

class FileAmbientSink implements AmbientMetricsSink {
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  append(record: AmbientTimingRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    this.writeTail = this.writeTail
      .catch(() => undefined)
      .then(() => appendFile(this.path, line, 'utf8'))
      .catch((err: unknown) => {
        if (isMissingDir(err)) {
          return mkdir(dirname(this.path), { recursive: true }).then(() => appendFile(this.path, line, 'utf8'));
        }
        return undefined;
      })
      .catch(() => undefined);
  }
}

function isMissingDir(err: unknown): boolean {
  return err !== null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT';
}
