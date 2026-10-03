/**
 * Tests for Intercept submission verification (task 8.4; Requirement 9.5).
 *
 * `verifySubmission` reads an Intercept's ground truth to decide whether a
 * player's candidate key or plaintext is correct, and on success yields the
 * recovered Propositions (re-tagged with the Intercept's true source ids). These
 * tests pin:
 *
 * - the TRUE key verifies and returns the source Propositions;
 * - a WRONG key is rejected with a bare `{ ok: false }` that leaks nothing;
 * - the correct PLAINTEXT verifies; a wrong plaintext is rejected;
 * - rejection is information-free across arbitrary wrong keys (property);
 * - determinism.
 *
 * The fixtures mirror intercept.spec.ts: a hand-built field-code map, a radio
 * Channel, two well-typed Propositions, and a key lookup with a pad and a public
 * text long enough to key any message.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createPrng } from '../prng/prng.js';
import type {
  ChannelId,
  DocId,
  GameTime,
  Proposition,
} from '../model/core.js';
import type { Channel, ChannelKind } from '../city/comms.js';
import {
  resolveCipherSpec,
  type CipherKeyLookup,
  type CipherSpec,
  type KeySubmission,
} from './spec.js';
import {
  generateIntercepts,
  revealedSpec,
  decryptToFieldMessage,
  type GenerateInterceptsInputs,
  type Intercept,
  type InterceptSource,
} from './intercept.js';
import { parseFieldMessage, type FieldCodeLookup } from './field-message.js';
import { verifySubmission } from './verify.js';

// ---------------------------------------------------------------------------
// Fixtures (mirroring intercept.spec.ts)
// ---------------------------------------------------------------------------

const fieldCodes: FieldCodeLookup = {
  fieldCodes: new Map<string, string>([
    ['MEETS_AT', 'MAT'],
    ['USES_CHANNEL', 'UCH'],
  ]),
};

const PAD = 'QWERTYUIOPASDFGHJKLZXCVBNM'.repeat(20);
const PUBLIC_TEXT = 'THEQUICKBROWNFOXJUMPSOVERTHELAZYDOG'.repeat(20);
const PAD_ID = 'pad:test';
const DOC_ID = 'doc:almanac' as DocId;

const keyLookup: CipherKeyLookup = {
  publicText: (id) => (id === DOC_ID ? PUBLIC_TEXT : undefined),
  pad: (id) => (id === PAD_ID ? PAD : undefined),
};

function channel(id: string, kind: ChannelKind = 'radio'): Channel {
  return {
    id: id as ChannelId,
    kind,
    owner: 'org:cell',
    schedule: { period: 1, start: { day: 0, phase: 0 }, phase: 0 },
  };
}

const CHANNELS: Record<ChannelId, Channel> = {
  ['chan:a' as ChannelId]: channel('chan:a'),
};

function props(n: number): Proposition[] {
  const at: GameTime = { day: 2, phase: 1 };
  return [
    {
      id: `p:${n}:0`,
      subject: 'npc:ana',
      predicate: 'MEETS_AT',
      object: 'npc:boris',
      place: 'loc:cafe',
      window: { from: at },
    },
    {
      id: `p:${n}:1`,
      subject: 'npc:boris',
      predicate: 'USES_CHANNEL',
      object: 'chan:a' as ChannelId,
    },
  ];
}

function source(
  id: string,
  overrides: Partial<InterceptSource> = {},
): InterceptSource {
  return {
    id,
    channel: 'chan:a' as ChannelId,
    at: { day: 1, phase: 2 },
    ownerKind: 'hostile',
    origin: 'plot',
    propositions: props(0),
    ...overrides,
  };
}

const ALL_CIPHERS = ['caesar', 'vigenere', 'columnar', 'book', 'otp'] as const;

function inputs(
  overrides: Partial<GenerateInterceptsInputs> = {},
): GenerateInterceptsInputs {
  return {
    channels: CHANNELS,
    fieldCodes,
    allowedCiphers: [...ALL_CIPHERS],
    tradecraftErrorProbability: 0,
    publicTextIds: [DOC_ID],
    padIds: [PAD_ID],
    keyLookup,
    ...overrides,
  };
}

/** Generate a single Intercept and return it. */
function makeIntercept(
  seed: string,
  srcOverrides: Partial<InterceptSource> = {},
  inputOverrides: Partial<GenerateInterceptsInputs> = {},
): Intercept {
  const { intercepts, order } = generateIntercepts(
    createPrng(seed),
    [source('tx-1', srcOverrides)],
    inputs(inputOverrides),
  );
  return intercepts[order[0]];
}

/** The true recovered field message of an Intercept (crib stripped). */
function truePlaintext(intercept: Intercept): string {
  const key = resolveCipherSpec(revealedSpec(intercept), keyLookup);
  return decryptToFieldMessage(intercept, key);
}

// ---------------------------------------------------------------------------
// Correct key
// ---------------------------------------------------------------------------

describe('verifySubmission — correct key (Req 9.5)', () => {
  it('verifies the true key and returns the source Propositions', () => {
    const intercept = makeIntercept('seed-key');
    const submission: KeySubmission = {
      kind: 'key',
      spec: revealedSpec(intercept),
    };
    const result = verifySubmission(intercept, submission, keyLookup, fieldCodes);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    // The recovered Propositions carry the Intercept's true source ids, by
    // position, and otherwise match the parsed field message.
    expect(result.propositions.map((p) => p.id)).toEqual(['p:0:0', 'p:0:1']);
    expect(result.propositions.map((p) => p.predicate)).toEqual([
      'MEETS_AT',
      'USES_CHANNEL',
    ]);
    expect(result.propositions.map((p) => p.subject)).toEqual([
      'npc:ana',
      'npc:boris',
    ]);
    // Content matches the parsed true message (ids aside).
    const parsed = parseFieldMessage(truePlaintext(intercept), fieldCodes);
    result.propositions.forEach((p, i) => {
      expect({ ...p, id: parsed[i].id }).toEqual(parsed[i]);
    });
  });

  it('verifies the true key even when a fixed-header crib is present', () => {
    // Caesar-only + probability 1 ⇒ a fixed-header crib was prefixed.
    const intercept = makeIntercept(
      'seed-crib',
      {},
      { allowedCiphers: ['caesar'], tradecraftErrorProbability: 1 },
    );
    expect(intercept.tradecraftError?.kind).toBe('fixed-header');
    const result = verifySubmission(
      intercept,
      { kind: 'key', spec: revealedSpec(intercept) },
      keyLookup,
      fieldCodes,
    );
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wrong key — rejected, leaks nothing
// ---------------------------------------------------------------------------

describe('verifySubmission — wrong key is rejected without leaking (Req 9.5)', () => {
  it('rejects a wrong caesar shift with a bare { ok: false }', () => {
    // Force a caesar Intercept so a definitely-wrong shift is easy to name.
    const intercept = makeIntercept('seed-wrong', {}, { allowedCiphers: ['caesar'] });
    const trueSpec = revealedSpec(intercept);
    expect(trueSpec.kind).toBe('caesar');
    const trueShift = trueSpec.kind === 'caesar' ? trueSpec.shift : 0;
    const wrong: CipherSpec = {
      kind: 'caesar',
      shift: ((trueShift + 7) % 26) + 1,
    };
    const result = verifySubmission(
      intercept,
      { kind: 'key', spec: wrong },
      keyLookup,
      fieldCodes,
    );
    expect(result).toEqual({ ok: false });
    // The result object carries no spec, plaintext or propositions.
    expect(Object.keys(result)).toEqual(['ok']);
  });

  it('rejects a key naming an unknown pad/book text (resolution miss)', () => {
    const intercept = makeIntercept('seed-unknown', {}, { allowedCiphers: ['caesar'] });
    const result = verifySubmission(
      intercept,
      { kind: 'key', spec: { kind: 'otp', padId: 'pad:does-not-exist' } },
      keyLookup,
      fieldCodes,
    );
    expect(result).toEqual({ ok: false });
  });

  it('leaks nothing across arbitrary wrong caesar shifts (property)', () => {
    const intercept = makeIntercept('seed-prop', {}, { allowedCiphers: ['caesar'] });
    const trueSpec = revealedSpec(intercept);
    const trueShift = trueSpec.kind === 'caesar' ? trueSpec.shift : 0;
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 25 }), (delta) => {
        const shift = ((trueShift + delta) % 26 || 26);
        // Skip the (vanishingly unlikely) case the shift lands back on true.
        if (shift % 26 === trueShift % 26) {
          return;
        }
        const result = verifySubmission(
          intercept,
          { kind: 'key', spec: { kind: 'caesar', shift } },
          keyLookup,
          fieldCodes,
        );
        expect(result).toEqual({ ok: false });
      }),
      { numRuns: 25 },
    );
  });
});

// ---------------------------------------------------------------------------
// Plaintext submissions
// ---------------------------------------------------------------------------

describe('verifySubmission — plaintext (Req 9.5)', () => {
  it('verifies the correct plaintext and returns the source Propositions', () => {
    const intercept = makeIntercept('seed-plain');
    const result = verifySubmission(
      intercept,
      { kind: 'plaintext', text: truePlaintext(intercept) },
      keyLookup,
      fieldCodes,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.propositions.map((p) => p.id)).toEqual(['p:0:0', 'p:0:1']);
    }
  });

  it('rejects a wrong plaintext without leaking', () => {
    const intercept = makeIntercept('seed-plain-wrong');
    const result = verifySubmission(
      intercept,
      { kind: 'plaintext', text: 'NOT THE MESSAGE' },
      keyLookup,
      fieldCodes,
    );
    expect(result).toEqual({ ok: false });
  });

  it('rejects the correct plaintext across arbitrary mutations (property)', () => {
    const intercept = makeIntercept('seed-plain-mut');
    const truth = truePlaintext(intercept);
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), (suffix) => {
        const result = verifySubmission(
          intercept,
          { kind: 'plaintext', text: truth + suffix },
          keyLookup,
          fieldCodes,
        );
        // Any non-empty suffix makes it a different (wrong) plaintext.
        expect(result).toEqual({ ok: false });
      }),
      { numRuns: 30 },
    );
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('verifySubmission — determinism', () => {
  it('returns the same result for the same inputs', () => {
    const intercept = makeIntercept('seed-det');
    const submission: KeySubmission = {
      kind: 'key',
      spec: revealedSpec(intercept),
    };
    const a = verifySubmission(intercept, submission, keyLookup, fieldCodes);
    const b = verifySubmission(intercept, submission, keyLookup, fieldCodes);
    expect(a).toEqual(b);
  });

  it('accepts the true key across arbitrary owners and seeds (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 10 }), (seed) => {
        const intercept = makeIntercept(seed);
        const result = verifySubmission(
          intercept,
          { kind: 'key', spec: revealedSpec(intercept) },
          keyLookup,
          fieldCodes,
        );
        expect(result.ok).toBe(true);
      }),
      { numRuns: 40 },
    );
  });
});
