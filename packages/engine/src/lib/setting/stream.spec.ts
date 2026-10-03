/**
 * Tests for the setting PRNG stream registry (content-expansion task 3.2).
 *
 * The setting stream owns the block `0x30000`–`0x30FFF` of the slice PRNG
 * stream registry; `settingStreamSeed(seed, j)` must map attempt *j* onto
 * `derive(seed, 0x30000 + j)` and must refuse an index that would reach into a
 * neighbouring spec's block. These checks pin the block bounds and the derive
 * mapping so a later change to the registry cannot silently move the stream.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { derive } from '../prng/prng.js';
import {
  SETTING_STREAM_BASE,
  SETTING_STREAM_LIMIT,
  SETTING_STREAM_SPAN,
  settingStreamSeed,
} from './stream.js';

describe('setting stream registry (Req 9.10)', () => {
  it('claims the block 0x30000–0x30FFF the slice registry allocates', () => {
    expect(SETTING_STREAM_BASE).toBe(0x30000);
    expect(SETTING_STREAM_LIMIT).toBe(0x31000);
    expect(SETTING_STREAM_SPAN).toBe(0x1000);
  });

  it('maps attempt j onto derive(seed, 0x30000 + j)', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 0, max: SETTING_STREAM_SPAN - 1 }),
        (seed, j) => {
          expect(settingStreamSeed(seed, j)).toBe(
            derive(seed, SETTING_STREAM_BASE + j),
          );
        },
      ),
    );
  });

  it('is deterministic in the seed and the attempt', () => {
    expect(settingStreamSeed('abc', 0)).toBe(settingStreamSeed('abc', 0));
    expect(settingStreamSeed('abc', 1)).not.toBe(settingStreamSeed('abc', 0));
    expect(settingStreamSeed('abc', 0)).not.toBe(settingStreamSeed('abd', 0));
  });

  it('rejects a negative, non-integer or out-of-block attempt', () => {
    expect(() => settingStreamSeed('s', -1)).toThrow(RangeError);
    expect(() => settingStreamSeed('s', 1.5)).toThrow(RangeError);
    expect(() => settingStreamSeed('s', SETTING_STREAM_SPAN)).toThrow(RangeError);
    // The last in-block index is accepted.
    expect(() => settingStreamSeed('s', SETTING_STREAM_SPAN - 1)).not.toThrow();
  });
});
