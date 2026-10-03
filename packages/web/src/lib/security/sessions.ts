import { constantTimeEqual, generateSessionId } from './token.js';

/**
 * In-memory session records. Empties on restart, so a restart invalidates every
 * cookie (Requirement 3.7).
 */
export class SessionStore {
  private readonly ids = new Set<string>();

  constructor(private readonly random?: (n: number) => Buffer) {}

  create(): string {
    const id = generateSessionId(this.random);
    this.ids.add(id);
    return id;
  }

  /** Constant-time membership test. */
  has(candidate: string): boolean {
    let found = false;
    for (const id of this.ids) {
      if (constantTimeEqual(id, candidate)) {
        found = true;
      }
    }
    return found;
  }

  clear(): void {
    this.ids.clear();
  }
}
