/**
 * Tests for the metrics sinks and record format (task 13.6).
 *
 * These cover the sink seam directly: the in-memory sink used by other tests,
 * and the file sink's async, best-effort contract — an append to an unwritable
 * path must not throw or reject into the caller. The round-trip test proves a
 * record written to a real temp file reads back as the same JSONL line the eval
 * harness will parse.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  FileMetricsSink,
  InMemoryMetricsSink,
  METRICS_OUTCOMES,
  type MetricsRecord,
} from './metrics-record.js';

const sampleRecord: MetricsRecord = {
  at: 1_700_000_000_000,
  role: 'voice',
  model: 'voice-model',
  purpose: 'voice',
  ttfsMs: 250,
  durationMs: 400,
  completionTokens: 12,
  tokensPerSec: 30,
  outcome: 'ok',
};

describe('METRICS_OUTCOMES', () => {
  it('lists the four recorded outcomes', () => {
    expect([...METRICS_OUTCOMES]).toEqual([
      'ok',
      'timeout',
      'fallback',
      'rejected',
    ]);
  });
});

describe('InMemoryMetricsSink', () => {
  it('keeps appended records in order', () => {
    const sink = new InMemoryMetricsSink();
    sink.append(sampleRecord);
    sink.append({ ...sampleRecord, purpose: 'narration' });
    expect(sink.records.map((r) => r.purpose)).toEqual(['voice', 'narration']);
  });

  it('throws on append when configured to, so best-effort wiring is testable', () => {
    const sink = new InMemoryMetricsSink({ throwOnAppend: true });
    expect(() => sink.append(sampleRecord)).toThrow();
  });
});

describe('FileMetricsSink', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'tradecraft-metrics-'));
    dirs.push(dir);
    return dir;
  }

  it('appends a record as one JSONL line', async () => {
    const dir = tempDir();
    const path = join(dir, 'metrics.jsonl');
    const sink = new FileMetricsSink(path);

    sink.append(sampleRecord);
    sink.append({ ...sampleRecord, purpose: 'narration' });

    // The append is fire-and-forget; wait for the write chain to drain.
    await sink.flushed();

    const text = readFileSync(path, 'utf8');
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual(sampleRecord);
    expect((JSON.parse(lines[1]) as MetricsRecord).purpose).toBe('narration');
  });

  it('is best effort: appending to an unwritable path does not throw', async () => {
    // A path whose parent directory does not exist cannot be written.
    const sink = new FileMetricsSink(
      join(tmpdir(), 'tradecraft-missing-dir-xyz', 'nested', 'metrics.jsonl'),
    );
    expect(() => sink.append(sampleRecord)).not.toThrow();
    // The swallowed rejection settles without surfacing.
    await expect(sink.flushed()).resolves.toBeUndefined();
  });
});
