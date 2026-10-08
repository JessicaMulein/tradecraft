import type { Tree } from '../tree';
/**
 * Formats all the created or updated files using the configured formatter
 * @param tree - the file system tree
 *
 * @remarks
 * Set the environment variable `NX_SKIP_FORMAT` to `true` to skip
 * formatting. This is useful for repositories that format with a tool Nx does
 * not drive (Biome, dprint) or that have custom formatting requirements.
 */
export declare function formatChangedFiles(tree: Tree, options?: {
    silent?: boolean;
    /**
     * Tree-relative paths to leave untouched. Both platform-native and
     * forward-slash separators are accepted.
     */
    excludePaths?: Set<string>;
}): Promise<void>;
export declare function formatFileContents(files: {
    path: string;
    content: string | Buffer;
}[], root: string, options?: {
    silent?: boolean;
}): Promise<Map<string, string>>;
