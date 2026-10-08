import type { Tree } from '../../generators/tree';
/**
 * Config filenames oxfmt *discovers* - narrower than the set `-c` accepts.
 * Measured against 0.60.0: `oxfmt.config.{js,cjs,mjs,cts}` load when named
 * but are never searched for, so treating one as config would format on
 * options oxfmt ignores. No precedence order - oxfmt fails with
 * "Both '<a>' and '<b>' found in <dir>" when a directory holds two.
 */
export declare const oxfmtConfigFiles: string[];
export declare function isUsingOxfmt(root: string): boolean;
export declare function isUsingOxfmtInTree(tree: Tree): boolean;
export declare function getOxfmtBinPath(): string;
export declare function writeWithOxfmt(patterns: string[], cwd?: string): void;
export declare function checkWithOxfmt(patterns: string[]): Promise<string[]>;
/**
 * Nothing is written to disk: staging files inside the workspace would race the
 * daemon's watcher and the project graph mid-generator.
 *
 * A path is absent from the result when oxfmt has no parser for it, an ignore
 * file covers it, or it is already formatted. One unparseable file fails only
 * itself; the rest of the batch still applies.
 */
export declare function formatFilesWithOxfmt(files: {
    path: string;
    content: string;
}[], workspaceRoot: string, seedConfig?: {
    name: string;
    content: string;
}, rootConfigNames?: readonly string[], read?: (relativePath: string) => string | null | undefined): Promise<{
    formatted: Map<string, string>;
    errors?: string[];
}>;
