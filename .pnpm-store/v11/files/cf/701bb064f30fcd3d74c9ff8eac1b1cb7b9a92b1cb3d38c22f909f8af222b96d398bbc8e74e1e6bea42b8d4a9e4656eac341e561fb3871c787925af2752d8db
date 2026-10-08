export interface NpmrcEntry {
    key: string;
    value: string;
    /** True when the source used ini's `key[]` array-append syntax. */
    array?: boolean;
}
/**
 * Parses an .npmrc file into its `key = value` entries the way npm/yarn/pnpm do
 * (via the `ini` package). Returns null when the file is missing, and
 * 'unreadable' when it exists but cannot be read (permissions, a directory):
 * package managers diverge on that state, so each caller decides whether to
 * skip, warn, or abort rather than having it collapsed into "absent" here.
 */
export declare function readNpmrcEntries(path: string): NpmrcEntry[] | 'unreadable' | null;
export declare function parseNpmrcContent(raw: string): NpmrcEntry[];
/**
 * Reads an .npmrc-format file into a map with ini's semantics for repeated
 * keys: scalars last-write-wins, `key[]` values joined. Null and 'unreadable'
 * pass through from {@link readNpmrcEntries}.
 */
export declare function readNpmrcMap(path: string): Map<string, string> | 'unreadable' | null;
/** Those entries under ini's semantics for repeated keys. */
export declare function npmrcEntriesToMap(entries: NpmrcEntry[]): Map<string, string>;
