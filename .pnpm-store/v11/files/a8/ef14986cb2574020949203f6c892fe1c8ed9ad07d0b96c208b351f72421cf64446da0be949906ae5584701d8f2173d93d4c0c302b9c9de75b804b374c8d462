import type { Tree } from '../../generators/tree';
import { type CatalogManager } from './manager';
import type { CatalogDefinitions, CatalogReference, CatalogReferenceMatch } from './types';
/**
 * Bun-specific catalog manager implementation.
 *
 * Bun declares catalogs in the root package.json `catalog`/`catalogs` fields,
 * either at the top level or nested under the object form of `workspaces`.
 * Unlike pnpm, the name "default" is not special: `catalog:` resolves only
 * against `catalog`, and `catalog:default` against `catalogs.default`.
 */
export declare class BunCatalogManager implements CatalogManager {
    readonly name = "bun";
    readonly catalogProtocol = "catalog:";
    private definitionsByRoot;
    isCatalogReference(version: string): boolean;
    parseCatalogReference(version: string): CatalogReference | null;
    getCatalogDefinitionFilePaths(): string[];
    getCatalogDefinitions(treeOrRoot: Tree | string): CatalogDefinitions | null;
    resolveCatalogReference(treeOrRoot: Tree | string, packageName: string, version: string): string | null;
    getCatalogReferencesForPackage(treeOrRoot: Tree | string, packageName: string): CatalogReferenceMatch[];
    validateCatalogReference(treeOrRoot: Tree | string, packageName: string, version: string): void;
    updateCatalogVersions(treeOrRoot: Tree | string, updates: Array<{
        packageName: string;
        version: string;
        catalogName?: string;
    }>): void;
}
