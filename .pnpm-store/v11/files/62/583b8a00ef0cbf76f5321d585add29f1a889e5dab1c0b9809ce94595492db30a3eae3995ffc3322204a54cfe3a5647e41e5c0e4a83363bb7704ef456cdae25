/**
 * This is the main API for accessing the lock file functionality.
 * It encapsulates the package manager specific logic and implementation details.
 */
import { ProjectGraph, ProjectGraphExternalNode } from '../../../config/project-graph';
import { CreateDependenciesContext, CreateNodesContext } from '../../../project-graph/plugins';
import { RawProjectGraphDependency } from '../../../project-graph/project-graph-builder';
import { PackageJson } from '../../../utils/package-json';
import { PackageManager } from '../../../utils/package-manager';
export declare const LOCKFILES: string[];
export declare const AUTO_AFFECTED_LOCK_FILES: readonly ["yarn.lock", "package-lock.json", "pnpm-lock.yaml", "pnpm-lock.yml", "bun.lockb", "bun.lock"];
/**
 * Parses lock file and maps dependencies and metadata to {@link LockFileGraph}
 */
export declare function getLockFileNodes(packageManager: PackageManager, contents: string, lockFileHash: string, context: CreateNodesContext): {
    nodes: Record<string, ProjectGraphExternalNode>;
    keyMap: Map<string, any>;
};
export declare function getLockFileNodesForName(lockFile: string, contents: string, lockFileHash: string, packageJson?: PackageJson): {
    nodes: Record<string, ProjectGraphExternalNode>;
    keyMap: Map<string, any>;
};
/**
 * Parses lock file and maps dependencies and metadata to {@link LockFileGraph}
 */
export declare function getLockFileDependencies(packageManager: PackageManager, contents: string, lockFileHash: string, context: CreateDependenciesContext, keyMap: Map<string, any>): RawProjectGraphDependency[];
export declare function lockFileExists(packageManager: PackageManager): boolean;
/**
 * Returns lock file name based on the detected package manager in the root
 * @param packageManager
 * @returns
 */
export declare function getLockFileName(packageManager: PackageManager): string;
export declare function getLockFilePath(packageManager: PackageManager): string;
/**
 * Create lock file based on the root level lock file and (pruned) package.json
 *
 * A pruned pnpm lockfile no longer declares the resolution-time pnpm config it
 * bakes into its snapshots, so the config is dropped from `packageJson` too:
 * pnpm 10 and below validate the manifest against the lockfile and abort a
 * frozen install with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH when the two disagree.
 * An inherited `pnpm.patchedDependencies` goes with it, since the prune scopes
 * the lockfile's patches to the packages that survive it and rewrites their
 * paths onto the output.
 * The manifest is left alone for npm and yarn, which never read that block.
 * Mutating it means callers must write or emit the manifest after this returns.
 *
 * The lockfile alone does not make a complete pnpm output. A workspace
 * declaring build-script approvals, patches or vendored local paths also needs
 * the artifacts `generatePrunedDeployOutput` ships, and this warns when that is
 * the case.
 *
 * On a pruning error the root lockfile is returned as a fail-open fallback,
 * with the manifest left as authored.
 *
 * @deprecated Use `generatePrunedDeployOutput` instead. This will be removed in Nx 25.
 */
export declare function createLockFile(packageJson: PackageJson, graph: ProjectGraph, packageManager?: PackageManager): string;
type PrunedDeploySink = {
    outputDirectory: string;
    emit?: never;
} | {
    emit: (path: string, content: string | Buffer) => void;
    outputDirectory?: never;
};
/**
 * Generates the standalone deploy output a generate-package-json flow ships
 * alongside its manifest: the pruned lockfile and, for pnpm, the install-time
 * artifacts that lockfile needs (the settings-only pnpm-workspace.yaml, the
 * `pnpm patch` files, and the vendored non-workspace local-path dependencies).
 * `options` carries either an `outputDirectory` to write into or an `emit` sink
 * for a bundler's asset pipeline, never both.
 *
 * Mutates `packageJson` into the form the output must ship (the relocated
 * local-path specifiers, the pnpm config strip, the pnpm <=10 build settings),
 * so write or emit the manifest after this returns.
 *
 * Bun has no lockfile generation, so it warns and ships nothing, leaving the
 * manifest as authored.
 */
export declare function generatePrunedDeployOutput(packageJson: PackageJson, graph: ProjectGraph, projectRoot: string, options: PrunedDeploySink & {
    packageManager: PackageManager;
    workspaceRoot?: string;
}): void;
export {};
