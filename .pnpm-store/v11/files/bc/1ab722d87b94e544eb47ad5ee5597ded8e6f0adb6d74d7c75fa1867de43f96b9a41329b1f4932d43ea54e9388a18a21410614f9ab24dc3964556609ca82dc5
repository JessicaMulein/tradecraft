import type { Tree } from '../../generators/tree';
import { type CatalogManager } from './manager';
import type { CatalogDefinitions, CatalogReference, CatalogReferenceMatch } from './types';
/**
 * PNPM-specific catalog manager implementation
 */
export declare class PnpmCatalogManager implements CatalogManager {
    readonly name = "pnpm";
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
