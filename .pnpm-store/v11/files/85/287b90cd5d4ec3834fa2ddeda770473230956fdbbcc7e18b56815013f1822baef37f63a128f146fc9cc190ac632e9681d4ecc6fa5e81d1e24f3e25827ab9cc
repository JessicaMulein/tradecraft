import type { Tree } from '../generators/tree';
import type { PackageManager } from './package-manager';
/**
 * Records build-script decisions for dependencies that are about to be
 * installed, in whatever form the given package manager understands.
 *
 * Only pnpm needs this today: pnpm 11+ refuses to install a dependency whose
 * build scripts are neither allowed nor denied, so the generator or command
 * that introduces such a dependency records the decision up front. Other
 * package managers run build scripts unconditionally, so this is a no-op for
 * them.
 */
export declare function acknowledgeBuildScripts(treeOrRoot: Tree | string, packageManager: PackageManager, entries: Record<string, boolean>): void;
