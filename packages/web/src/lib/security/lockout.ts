export interface LockoutConfig {
  readonly maxFailures: number;
  readonly windowMs: number;
  readonly blockMs: number;
}

/**
 * A global failed-credential counter (Requirement 3.6). It is global rather
 * than per peer because every client of a loopback server has the same address.
 */
export class Lockout {
  private failures: number[] = [];
  private blockedUntil = 0;

  constructor(
    private readonly config: LockoutConfig,
    private readonly now: () => number = Date.now,
  ) {}

  fail(): void {
    const t = this.now();
    this.failures = this.failures.filter((f) => t - f < this.config.windowMs);
    this.failures.push(t);
    if (this.failures.length >= this.config.maxFailures) {
      this.blockedUntil = t + this.config.blockMs;
      this.failures = [];
    }
  }

  /** Seconds to wait, or undefined when requests are being served. */
  blocked(): number | undefined {
    const t = this.now();
    if (t < this.blockedUntil) {
      return Math.max(1, Math.ceil((this.blockedUntil - t) / 1000));
    }
    return undefined;
  }
}
