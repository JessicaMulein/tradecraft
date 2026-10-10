/**
 * A word key of a known length falls out of the coincidence table, and a trial
 * reading of that word is the message. Neither consults the true spec.
 */
import { encrypt } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { keyCoincidence, trialReading } from './cipher-trial.js';

const PLAIN =
  'The courier meets the contact at the cafe on thursday morning and brings the packet. '.repeat(
    6,
  );

describe('keyCoincidence', () => {
  it('peaks at the length of a Vigenère word', () => {
    const ciphertext = encrypt(PLAIN, { kind: 'vigenere', keyword: 'VIENNA' });
    const report = keyCoincidence(ciphertext);
    const best = Math.max(...report.rows.map((row) => row.coincidence));
    const peak = report.rows.find((row) => row.coincidence === best);
    expect(peak?.length).toBe(6);
  });

  it('reads a Caesar shift of English as one alphabet', () => {
    const ciphertext = encrypt(PLAIN, { kind: 'caesar', shift: 5 });
    const report = keyCoincidence(ciphertext);
    expect(report.overall).toBeGreaterThan(0.05);
  });
});

describe('trialReading', () => {
  it('shows the message for the right word and does not for a wrong one', () => {
    const ciphertext = encrypt(PLAIN, { kind: 'vigenere', keyword: 'DANUBE' });
    expect(trialReading(ciphertext, { kind: 'vigenere', keyword: 'danube' })).toBe(PLAIN);
    expect(trialReading(ciphertext, { kind: 'vigenere', keyword: 'vienna' })).not.toBe(PLAIN);
  });

  it('says a one-time pad is not a word puzzle', () => {
    expect(trialReading('ABC', { kind: 'otp', pad: 'SECRET' })).toContain('one-time pad');
  });
});
