/**
 * Tees `console.{log,warn,error,info,debug}` into an internal buffer while
 * preserving the original behavior. Does not intercept
 * `process.{stdout,stderr}.write` — those bypass `console` and would also
 * pick up unrelated framework output. Restoration is idempotent.
 */
export interface GeneratorOutputCapture {
    flush(): string;
    restore(): void;
}
export declare function installGeneratorOutputCapture(): GeneratorOutputCapture;
/**
 * Convenience wrapper that installs the capture, runs `fn`, restores on
 * completion or throw, and returns the captured logs alongside `fn`'s value.
 * Throws from `fn` propagate with the captured logs attached as
 * `(err as any).capturedLogs` — the most useful diagnostic when a generator
 * crashes mid-output.
 */
export declare function withGeneratorOutputCapture<T>(fn: () => Promise<T> | T): Promise<{
    result: T;
    logs: string;
}>;
