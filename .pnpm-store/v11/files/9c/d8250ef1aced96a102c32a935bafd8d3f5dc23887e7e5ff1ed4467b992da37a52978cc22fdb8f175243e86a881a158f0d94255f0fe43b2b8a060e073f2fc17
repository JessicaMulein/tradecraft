import type { Tree } from '../../generators/tree';
import type { CatalogDefinitions } from './types';
export declare function readCatalogDefinitions(filename: string, treeOrRoot: Tree | string, cache: Map<string, CatalogDefinitions | null>): CatalogDefinitions | null;
export declare function updateCatalogVersionsInFile(filename: string, treeOrRoot: Tree | string, updates: Array<{
    packageName: string;
    version: string;
    catalogName?: string;
}>, options?: {
    /**
     * Treat "default" as an alias for the `catalog` field and route default
     * updates through a populated `catalogs.default` (pnpm semantics). When
     * false, "default" is an ordinary named catalog (yarn semantics).
     */
    aliasDefaultCatalog?: boolean;
}): void;
