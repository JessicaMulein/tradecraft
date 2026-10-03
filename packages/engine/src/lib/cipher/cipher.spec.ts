import fc from 'fast-check';

import {
  CIPHERS,
  bookCipher,
  caesarCipher,
  columnarCipher,
  decrypt,
  encrypt,
  otpCipher,
  vigenereCipher,
  type CipherKey,
} from './cipher.js';

// A long public text to key book ciphers in tests. Repeated so it has plenty
// of letters for any plaintext a generator throws at it.
const PUBLIC_TEXT =
  'In Vienna the trams ran past the opera and the river kept its own time. ' +
  'The old city held its secrets close, and the four powers watched each other across the rubble.';

describe('caesarCipher', () => {
  it('shifts letters by the key, leaving case and non-letters alone', () => {
    expect(caesarCipher.encrypt('Hello, World!', { kind: 'caesar', shift: 3 })).toBe(
      'Khoor, Zruog!',
    );
  });

  it('wraps around the alphabet', () => {
    expect(caesarCipher.encrypt('xyz XYZ', { kind: 'caesar', shift: 3 })).toBe(
      'abc ABC',
    );
  });

  it('treats shift 13 as its own inverse (ROT13)', () => {
    const spec = { kind: 'caesar', shift: 13 } as const;
    expect(caesarCipher.encrypt('Attack', spec)).toBe('Nggnpx');
    expect(caesarCipher.encrypt('Nggnpx', spec)).toBe('Attack');
  });

  it('normalises large and negative shifts mod 26', () => {
    expect(caesarCipher.encrypt('abc', { kind: 'caesar', shift: 29 })).toBe('def');
    expect(caesarCipher.encrypt('def', { kind: 'caesar', shift: -3 })).toBe('abc');
  });

  it('round-trips any shift', () => {
    for (const shift of [0, 1, 5, 13, 25, 26, 100, -7]) {
      const spec = { kind: 'caesar', shift } as const;
      const plain = 'Meet at the Pier, Tuesday 1900 hours.';
      expect(caesarCipher.decrypt(caesarCipher.encrypt(plain, spec), spec)).toBe(
        plain,
      );
    }
  });
});

describe('vigenereCipher', () => {
  it('matches the classic LEMON vector', () => {
    const spec = { kind: 'vigenere', keyword: 'LEMON' } as const;
    expect(vigenereCipher.encrypt('ATTACKATDAWN', spec)).toBe('LXFOPVEFRNHR');
    expect(vigenereCipher.decrypt('LXFOPVEFRNHR', spec)).toBe('ATTACKATDAWN');
  });

  it('ignores non-letters in the keyword', () => {
    const a = vigenereCipher.encrypt('ATTACKATDAWN', { kind: 'vigenere', keyword: 'LEMON' });
    const b = vigenereCipher.encrypt('ATTACKATDAWN', { kind: 'vigenere', keyword: 'L E-M.O/N' });
    expect(b).toBe(a);
  });

  it('does not advance the key on passthrough characters', () => {
    // With key "AB", the shifts are 0,1,0,1,... applied to letters only.
    expect(vigenereCipher.encrypt('a a a', { kind: 'vigenere', keyword: 'AB' })).toBe(
      'a b a',
    );
  });

  it('throws on a keyword with no letters', () => {
    expect(() =>
      vigenereCipher.encrypt('hello', { kind: 'vigenere', keyword: '123 !' }),
    ).toThrow(/at least one letter/);
  });
});

describe('bookCipher', () => {
  it('round-trips against a public text', () => {
    const key = { kind: 'book', text: PUBLIC_TEXT } as const;
    const plain = 'Meet the courier at dawn.';
    expect(bookCipher.decrypt(bookCipher.encrypt(plain, key), key)).toBe(plain);
  });

  it('throws when the key text is too short', () => {
    const key = { kind: 'book', text: 'abc' } as const;
    expect(() => bookCipher.encrypt('abcdef', key)).toThrow(/needs 6/);
  });

  it('encodes the first letter as plaintext+keytext shift', () => {
    // key text starts with 'In...' -> first letter 'I' = index 8.
    // plaintext 'a' (0) + 8 = 'i'.
    expect(bookCipher.encrypt('a', { kind: 'book', text: PUBLIC_TEXT })).toBe('i');
  });
});

describe('otpCipher', () => {
  it('round-trips against a pad at least as long as the message', () => {
    const key = { kind: 'otp', pad: 'XMCKLZZZZZZZZZZZZZZZZ' } as const;
    const plain = 'HELLO';
    expect(otpCipher.decrypt(otpCipher.encrypt(plain, key), key)).toBe(plain);
  });

  it('matches a worked example', () => {
    // H(7)+X(23)=30%26=4 -> E ; E(4)+M(12)=16 -> Q ; L(11)+C(2)=13 -> N ;
    // L(11)+K(10)=21 -> V ; O(14)+L(11)=25 -> Z
    expect(otpCipher.encrypt('HELLO', { kind: 'otp', pad: 'XMCKL' })).toBe('EQNVZ');
  });

  it('throws when the pad is shorter than the message', () => {
    expect(() => otpCipher.encrypt('HELLO', { kind: 'otp', pad: 'XM' })).toThrow(
      /needs 5/,
    );
  });
});

describe('columnarCipher', () => {
  it('round-trips including spaces and trailing content', () => {
    const key = { kind: 'columnar', key: 'ZEBRAS' } as const;
    const plain = 'WE ARE DISCOVERED FLEE AT ONCE';
    expect(columnarCipher.decrypt(columnarCipher.encrypt(plain, key), key)).toBe(
      plain,
    );
  });

  it('handles repeated key characters by stable order', () => {
    const key = { kind: 'columnar', key: 'BAOBAB' } as const;
    const plain = 'The materiel moves tonight at the pier';
    expect(columnarCipher.decrypt(columnarCipher.encrypt(plain, key), key)).toBe(
      plain,
    );
  });

  it('reorders columns by key sort order', () => {
    // key "CAB" -> columns sorted A,B,C -> read order [1,2,0].
    // grid rows (cols=3): "DEF","GHI" from "DEFGHI".
    // column 1 = E,H ; column 2 = F,I ; column 0 = D,G -> "EHFIDG"
    expect(columnarCipher.encrypt('DEFGHI', { kind: 'columnar', key: 'CAB' })).toBe(
      'EHFIDG',
    );
  });

  it('throws on an empty key', () => {
    expect(() => columnarCipher.encrypt('abc', { kind: 'columnar', key: '' })).toThrow(
      /must not be empty/,
    );
  });

  it('preserves trailing spaces through the sentinel padding', () => {
    const key = { kind: 'columnar', key: 'KEY' } as const;
    const plain = 'drop at noon   ';
    expect(columnarCipher.decrypt(columnarCipher.encrypt(plain, key), key)).toBe(
      plain,
    );
  });
});

describe('dispatch', () => {
  it('encrypt/decrypt dispatch matches the per-cipher objects', () => {
    const keys: CipherKey[] = [
      { kind: 'caesar', shift: 4 },
      { kind: 'vigenere', keyword: 'VIENNA' },
      { kind: 'columnar', key: 'DELTA' },
      { kind: 'book', text: PUBLIC_TEXT },
      { kind: 'otp', pad: PUBLIC_TEXT },
    ];
    const plain = 'The drop is live at the Prater.';
    for (const key of keys) {
      expect(decrypt(encrypt(plain, key), key)).toBe(plain);
      expect(CIPHERS[key.kind].kind).toBe(key.kind);
    }
  });
});

// ---------------------------------------------------------------------------
// Property-based round-trip coverage (Property 8 is formalised in task 8.5;
// this gives each cipher basic round-trip assurance across many inputs).
// ---------------------------------------------------------------------------

// Printable text that stays clear of the columnar NUL sentinel.
const textArb = fc
  .string({ unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ,.!?'.split('')) })
  .filter((s) => !s.includes('\u0000'));

// A key stream with enough letters for the message, for book/otp.
function padFor(message: string): fc.Arbitrary<string> {
  const letters = (message.match(/[a-z]/gi) ?? []).length;
  return fc
    .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), {
      minLength: letters,
      maxLength: letters + 20,
    })
    .map((xs) => xs.join(''));
}

describe('round-trip properties', () => {
  it('Caesar round-trips for any text and shift', () => {
    fc.assert(
      fc.property(textArb, fc.integer(), (plain, shift) => {
        const key = { kind: 'caesar', shift } as const;
        expect(decrypt(encrypt(plain, key), key)).toBe(plain);
      }),
    );
  });

  it('Vigenère round-trips for any text and non-empty letter keyword', () => {
    const keywordArb = fc
      .string({ unit: fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), minLength: 1 });
    fc.assert(
      fc.property(textArb, keywordArb, (plain, keyword) => {
        const key = { kind: 'vigenere', keyword } as const;
        expect(decrypt(encrypt(plain, key), key)).toBe(plain);
      }),
    );
  });

  it('columnar round-trips for any text and non-empty key', () => {
    fc.assert(
      fc.property(textArb, fc.string({ minLength: 1 }).filter((k) => !k.includes('\u0000')), (plain, key) => {
        const spec = { kind: 'columnar', key } as const;
        expect(decrypt(encrypt(plain, spec), spec)).toBe(plain);
      }),
    );
  });

  it('book cipher round-trips when the key text is long enough', () => {
    fc.assert(
      fc.property(
        textArb.chain((plain) => padFor(plain).map((text) => ({ plain, text }))),
        ({ plain, text }) => {
          const key = { kind: 'book', text } as const;
          expect(decrypt(encrypt(plain, key), key)).toBe(plain);
        },
      ),
    );
  });

  it('OTP round-trips when the pad is long enough', () => {
    fc.assert(
      fc.property(
        textArb.chain((plain) => padFor(plain).map((pad) => ({ plain, pad }))),
        ({ plain, pad }) => {
          const key = { kind: 'otp', pad } as const;
          expect(decrypt(encrypt(plain, key), key)).toBe(plain);
        },
      ),
    );
  });
});
