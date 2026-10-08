import type { Tree } from '../../generators/tree';
import { type CatalogManager } from './manager';
import type { CatalogDefinitions, CatalogReference, CatalogReferenceMatch } from './types';
/**
 * Yarn Berry (v4.10+) catalog manager implementation.
 *
 * Unlike pnpm, the name "default" is not special: `catalog:` resolves only
 * against `catalog`, and `catalog:default` against `catalogs.default`.
 */
export declare class YarnCatalogManager implements CatalogManager {
    readonly name = "yarn";
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
