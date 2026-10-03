/**
 * Unit tests for {@link fsOutcomeSink} (slice-integration task 12.4; design,
 * "Turn Pipeline" step 9; Requirements 13.1, 7.6).
 *
 * The sink is the one-line adapter from the Turn Pipeline's `(record) => void`
 * seam onto the engine's `writeOutcomeRecord`: it validates the record against
 * the versioned schema and writes one pretty-printed JSON file per game into
 * `saves/outcomes/`. These tests pin that it writes a valid record to the given
 * directory and that an invalid record is rejected (nothing written), running
 * against a fresh `os.tmpdir()` directory removed afterwards so the repo's
 * `saves/` is never touched.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseOutcomeRecord, type OutcomeRecord } from '@tradecraft/engine';
import { afterEach, describe, expect, it } from 'vitest';

import { fsOutcomeSink } from './fs-outcome-sink.js';

/** Fresh temp dirs created per test, torn down in `afterEach`. */
const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** A fresh directory under the OS temp dir for the sink to write into. */
function freshDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'tc-fs-outcome-'));
  tempRoots.push(root);
  return root;
}

/** A minimal but schema-valid Outcome Record. */
function sampleRecord(): OutcomeRecord {
  return {
    schema: 1,
    outcome: 'success',
    endedAt: { day: 3, phase: 2 } as OutcomeRecord['endedAt'],
    seed: 'alpha',
    generatorVersion: '1.0.0',
    content: { schema: 1, packs: [{ id: 'core', version: '1.0.0', hash: 'abc' }] },
    difficulty: 'standard',
    standing: 4,
    directives: [{ id: 'd1', status: 'met' }],
    survivingAssets: [],
    cover: { identity: 'merchant', blown: false, suspicion: 0.2 },
    hostileMemory: {
      knownCover: false,
      suspectedAssets: [],
      compromisedChannels: [],
      compromisedDrops: [],
      doctrineShift: {},
    },
    budgetRemaining: 1200,
  };
}

describe('fsOutcomeSink — writing (Req 13.1, 7.6)', () => {
  it('writes one schema-valid Outcome Record file into the given directory', () => {
    const dir = freshDir();
    const sink = fsOutcomeSink(dir);
    const record = sampleRecord();

    sink(record);

    // Exactly one JSON file was written into the directory.
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);

    // Its content round-trips back through the schema to the same record.
    const written = JSON.parse(readFileSync(join(dir, files[0]), 'utf8'));
    expect(parseOutcomeRecord(written)).toEqual(record);
  });

  it('rejects an invalid record and writes nothing', () => {
    const dir = freshDir();
    const sink = fsOutcomeSink(dir);

    // A record with a wrong schema version fails validation before any write.
    const bad = { ...sampleRecord(), schema: 99 } as unknown as OutcomeRecord;
    expect(() => sink(bad)).toThrow();

    expect(existsSync(dir)).toBe(true);
    expect(readdirSync(dir).filter((f) => f.endsWith('.json'))).toEqual([]);
  });
});
