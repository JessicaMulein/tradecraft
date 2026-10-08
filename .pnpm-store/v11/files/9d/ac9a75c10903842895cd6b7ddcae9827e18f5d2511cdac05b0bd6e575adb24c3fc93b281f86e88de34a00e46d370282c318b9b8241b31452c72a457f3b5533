export type CompletionFn = (current: string, args: string[]) => string[];
export interface PositionalCompletion {
    choices?: string[];
    complete?: CompletionFn;
}
export interface CommandCompletionMetadata {
    positionals?: PositionalCompletion[];
    /** Flag value handlers, keyed without leading `--`. Aliases get their own
     *  entry pointing at the same function. */
    flags?: Record<string, CompletionFn>;
}
export declare function registerCompletion(path: string, metadata: CommandCompletionMetadata): void;
/** Single-token registered paths (infix targets etc.). */
export declare function getRegisteredTopLevelPaths(): string[];
/** Longest-prefix match against the leading non-flag args. */
export declare function findCompletionMetadata(args: string[]): {
    metadata: CommandCompletionMetadata;
    positionalIndex: number;
} | null;
export declare function findFlagCompletion(metadata: CommandCompletionMetadata | null, flag: string): CompletionFn | null;
/** Positional/flag-value dispatch. Returns null when no handler applies. */
export declare function resolveCompletion(args: string[], current: string, previousToken: string): string[] | null;
