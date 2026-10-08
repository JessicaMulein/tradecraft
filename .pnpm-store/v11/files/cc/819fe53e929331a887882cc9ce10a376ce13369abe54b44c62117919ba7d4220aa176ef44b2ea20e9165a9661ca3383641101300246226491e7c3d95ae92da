import type { Tree } from '../../generators/tree';
import type { PackageJson } from '../package-json';
import type { CatalogManager } from './manager';
import { getCatalogManager } from './manager-factory';
export { type CatalogManager, getCatalogManager };
/**
 * Dereferences a pnpm/yarn/bun catalog reference to a concrete version spec. Returns
 * the input unchanged when it is not a catalog reference (or no catalog manager
 * applies). Throws when the reference cannot be resolved.
 */
export declare function resolveCatalogReferenceIfNeeded(packageName: string, version: string): string;
/**
 * Resolves a package.json's `catalog:` dependency / devDependency specifiers to
 * their declared version range. Non-catalog or unresolvable specifiers are
 * returned unchanged.
 */
export declare function resolveCatalogSpecifiers(packageJson: PackageJson | null): PackageJson | null;
/**
 * Detects which packages in a package.json use catalog references
 * Returns Map of package name -> catalog name (undefined for default catalog)
 */
export declare function getCatalogDependenciesFromPackageJson(tree: Tree, packageJsonPath: string, manager: CatalogManager): Map<string, string | undefined>;
