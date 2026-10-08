export type Shell = 'bash' | 'zsh' | 'fish' | 'powershell';
export declare const SHELLS: readonly Shell[];
/** Print the raw wrapper script to stdout — for scripting / custom rc paths. */
export declare function printCompletionScript(shell: Shell): void;
/**
 * Write the wrapper to the shell's default rc location, replacing any prior
 * nx-completion block (idempotent via the begin/end markers). Logs the
 * resolved path and a one-line "open a new shell" hint.
 */
export declare function installCompletionScript(shell: Shell): void;
/**
 * Stderr advisory when `nx` is not on PATH — the wrappers walk up for a
 * workspace-local nx, but the outside-workspace fallback needs `nx`
 * reachable by name. Callers fire this ONCE per invocation even when
 * installing for multiple shells.
 */
export declare function maybeWarnNxNotOnPath(): void;
export declare function generateScript(shell: Shell): string;
