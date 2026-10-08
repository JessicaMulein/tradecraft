import { Tree } from 'nx/src/devkit-exports';
/**
 * Formats the created or updated files with the configured formatter,
 * skipping `node_modules`, `.git`, the nx and yarn caches, and whatever the
 * workspace's ignore files cover. Which ignore files apply follows the
 * formatter: prettier reads the workspace root only, oxfmt cascades.
 * @param tree - the file system tree
 * @param options - options for the formatFiles function
 *
 * @remarks
 * `NX_SKIP_FORMAT=true` skips formatting - but not TSConfig path sorting,
 * which is controlled by `sortRootTsconfigPaths` or
 * `NX_FORMAT_SORT_TSCONFIG_PATHS`.
 */
export declare function formatFiles(tree: Tree, options?: {
    sortRootTsconfigPaths?: boolean;
}): Promise<void>;
