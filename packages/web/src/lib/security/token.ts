import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 bits, hex encoded. In memory only (Requirement 3.1). */
export function generateToken(random: (n: number) => Buffer = randomBytes): string {
  return random(32).toString('hex');
}

/** 128-bit session ids. */
export function generateSessionId(random: (n: number) => Buffer = randomBytes): string {
  return random(16).toString('hex');
}

/**
 * Constant-time comparison (Requirement 3.5): both sides are hashed to equal
 * length first so neither the content nor the length of the secret leaks
 * through timing.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest();
  const db = createHash('sha256').update(b).digest();
  return timingSafeEqual(da, db);
}
