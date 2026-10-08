export declare const SHOULD_SHOW_SPINNERS: boolean;
export interface StartSpinnerOptions {
    /**
     * When `true`, the text passed to `start`, `succeed`, and `fail` is NOT
     * emitted in non-TTY environments. By default (`false`), the text is logged
     * via `console.warn` so progress information isn't lost in non-interactive
     * environments. Set to `true` when completion is reported through a
     * different mechanism (e.g. a batched logger).
     *
     * Defaults to `false`.
     */
    skipNonTtyLogging?: boolean;
}
declare class SpinnerManager {
    #private;
    start(text?: string, prefix?: string, opts?: StartSpinnerOptions): SpinnerManager;
    succeed(text?: string): void;
    stop(): void;
    fail(text?: string): void;
    updateText(text?: string): void;
    isSpinning(): boolean;
}
export declare const globalSpinner: SpinnerManager;
export {};
