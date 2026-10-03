/**
 * The JSONL persistence seam for record and replay (task 13.5).
 *
 * Recording appends one {@link CallRecord} per line to a file; replay reads the
 * whole file once. Both sit behind the tiny {@link RecordSink} and {@link
 * RecordSource} interfaces so a test can drive them against an in-memory buffer
 * or a temp file, and production uses the {@link FileRecordSink} / {@link
 * FileRecordSource} backed by `node:fs`. Keeping the file I/O behind an
 * interface is what lets the record/replay round-trip be unit-tested without
 * touching the disk.
 *
 * The on-disk format is JSON Lines: each record is `JSON.stringify`-ed onto its
 * own line, appended in call order. Appending (rather than rewriting) means a
 * long session streams to disk as it plays and a crash keeps every completed
 * call. Blank lines are ignored on read so a trailing newline is harmless.
 */

import { appendFileSync, readFileSync } from 'node:fs';

import type { CallRecord } from './records.js';

/** A sink the {@link RecordingGateway} appends records to, one per call. */
export interface RecordSink {
  /** Append one record. Implementations serialise it as a single JSONL line. */
  append(record: CallRecord): void;
}

/** A source the {@link ReplayGateway} reads all records from, once, at load. */
export interface RecordSource {
  /** Read every record in file order. */
  readAll(): CallRecord[];
}

/**
 * A {@link RecordSink} backed by a file. Each record is appended as one line of
 * JSON via `node:fs.appendFileSync`, so the file is created on first write and
 * grows as the session plays. Synchronous appends keep call order exact and
 * avoid interleaving when several calls finish close together.
 */
export class FileRecordSink implements RecordSink {
  constructor(private readonly path: string) {}

  append(record: CallRecord): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, 'utf8');
  }
}

/**
 * A {@link RecordSource} backed by a file. Reads the file once and parses each
 * non-blank line as a {@link CallRecord}. A parse failure names the file and
 * the 1-based line so a corrupt recording is easy to locate.
 */
export class FileRecordSource implements RecordSource {
  constructor(private readonly path: string) {}

  readAll(): CallRecord[] {
    const text = readFileSync(this.path, 'utf8');
    return parseRecords(text, this.path);
  }
}

/**
 * Parse JSONL recording text into records. Exported so a test (or an
 * in-memory source) can reuse the exact same line parsing the file source uses.
 * Blank lines are skipped; a malformed line throws with its location.
 */
export function parseRecords(text: string, label = '<recording>'): CallRecord[] {
  const records: CallRecord[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') {
      continue;
    }
    try {
      records.push(JSON.parse(line) as CallRecord);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `invalid recording at ${label}:${i + 1}: ${detail}`,
      );
    }
  }
  return records;
}
