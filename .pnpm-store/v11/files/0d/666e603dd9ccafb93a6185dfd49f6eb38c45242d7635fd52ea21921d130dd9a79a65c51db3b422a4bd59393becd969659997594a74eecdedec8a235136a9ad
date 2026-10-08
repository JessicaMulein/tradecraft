"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BunCatalogManager = void 0;
const manager_1 = require("./manager");
const bun_manager_utils_1 = require("./bun-manager-utils");
const BUN_CATALOG_FILENAME = 'package.json';
/**
 * Bun-specific catalog manager implementation.
 *
 * Bun declares catalogs in the root package.json `catalog`/`catalogs` fields,
 * either at the top level or nested under the object form of `workspaces`.
 * Unlike pnpm, the name "default" is not special: `catalog:` resolves only
 * against `catalog`, and `catalog:default` against `catalogs.default`.
 */
class BunCatalogManager {
    constructor() {
        this.name = 'bun';
        this.catalogProtocol = 'catalog:';
        // Parsed fs-root definitions, cached per pass. See readBunCatalogDefinitions.
        this.definitionsByRoot = new Map();
    }
    isCatalogReference(version) {
        return version.startsWith(this.catalogProtocol);
    }
    parseCatalogReference(version) {
        if (!this.isCatalogReference(version)) {
            return null;
        }
        const catalogName = version.substring(this.catalogProtocol.length).trim();
        // Only an empty/whitespace name selects the default catalog; "default" is
        // a regular named catalog in bun.
        const isDefault = !catalogName;
        return {
            catalogName: isDefault ? undefined : catalogName,
            isDefaultCatalog: isDefault,
        };
    }
    getCatalogDefinitionFilePaths() {
        return [BUN_CATALOG_FILENAME];
    }
    getCatalogDefinitions(treeOrRoot) {
        return (0, bun_manager_utils_1.readBunCatalogDefinitions)(BUN_CATALOG_FILENAME, treeOrRoot, this.definitionsByRoot);
    }
    resolveCatalogReference(treeOrRoot, packageName, version) {
        const catalogRef = this.parseCatalogReference(version);
        if (!catalogRef) {
            return null;
        }
        const catalogDefs = this.getCatalogDefinitions(treeOrRoot);
        if (!catalogDefs) {
            return null;
        }
        let catalogToUse;
        if (catalogRef.isDefaultCatalog) {
            catalogToUse = catalogDefs.catalog;
        }
        else if (catalogRef.catalogName) {
            catalogToUse = catalogDefs.catalogs?.[catalogRef.catalogName];
        }
        return catalogToUse?.[packageName] || null;
    }
    getCatalogReferencesForPackage(treeOrRoot, packageName) {
        return (0, manager_1.collectCatalogReferencesForPackage)(this, treeOrRoot, packageName);
    }
    validateCatalogReference(treeOrRoot, packageName, version) {
        const catalogRef = this.parseCatalogReference(version);
        if (!catalogRef) {
            throw new Error(`Invalid catalog reference syntax: "${version}". Expected format: "catalog:" or "catalog:name"`);
        }
        const catalogDefs = this.getCatalogDefinitions(treeOrRoot);
        if (!catalogDefs) {
            throw new Error((0, manager_1.formatCatalogError)(`Cannot get Bun catalog definitions. No catalog defined in ${BUN_CATALOG_FILENAME}.`, [
                `Add a "catalog" or "catalogs" field to ${BUN_CATALOG_FILENAME} in your workspace root`,
            ]));
        }
        let catalogToUse;
        if (catalogRef.isDefaultCatalog) {
            catalogToUse = catalogDefs.catalog;
            if (!catalogToUse) {
                const availableCatalogs = Object.keys(catalogDefs.catalogs || {});
                const suggestions = [
                    `Define a default catalog in ${BUN_CATALOG_FILENAME} under the "catalog" key`,
                ];
                if (availableCatalogs.length > 0) {
                    suggestions.push(`Or select from the available named catalogs: ${availableCatalogs
                        .map((c) => `"catalog:${c}"`)
                        .join(', ')}`);
                }
                throw new Error((0, manager_1.formatCatalogError)(`No default catalog defined in ${BUN_CATALOG_FILENAME}`, suggestions));
            }
        }
        else if (catalogRef.catalogName) {
            catalogToUse = catalogDefs.catalogs?.[catalogRef.catalogName];
            if (!catalogToUse) {
                const availableCatalogs = Object.keys(catalogDefs.catalogs || {});
                const suggestions = [
                    `Define the catalog in ${BUN_CATALOG_FILENAME} under the "catalogs" key`,
                ];
                if (availableCatalogs.length > 0) {
                    suggestions.push(`Or select from the available named catalogs: ${availableCatalogs
                        .map((c) => `"catalog:${c}"`)
                        .join(', ')}`);
                }
                if (catalogDefs.catalog) {
                    suggestions.push(`Or use the default catalog ("catalog:")`);
                }
                throw new Error((0, manager_1.formatCatalogError)(`Catalog "${catalogRef.catalogName}" not found in ${BUN_CATALOG_FILENAME}`, suggestions));
            }
        }
        if (!catalogToUse[packageName]) {
            const catalogName = catalogRef.isDefaultCatalog
                ? 'default catalog ("catalog")'
                : `catalog '${catalogRef.catalogName}'`;
            const availablePackages = Object.keys(catalogToUse);
            const suggestions = [
                `Add "${packageName}" to ${catalogName} in ${BUN_CATALOG_FILENAME}`,
            ];
            if (availablePackages.length > 0) {
                suggestions.push(`Or select from the available packages in ${catalogName}: ${availablePackages
                    .map((p) => `"${p}"`)
                    .join(', ')}`);
            }
            throw new Error((0, manager_1.formatCatalogError)(`Package "${packageName}" not found in ${catalogName}`, suggestions));
        }
    }
    updateCatalogVersions(treeOrRoot, updates) {
        (0, bun_manager_utils_1.updateBunCatalogVersionsInFile)(BUN_CATALOG_FILENAME, treeOrRoot, updates);
    }
}
exports.BunCatalogManager = BunCatalogManager;
