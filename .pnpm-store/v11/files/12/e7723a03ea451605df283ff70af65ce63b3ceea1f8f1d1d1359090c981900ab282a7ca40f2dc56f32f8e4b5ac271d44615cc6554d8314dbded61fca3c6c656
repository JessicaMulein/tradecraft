"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PnpmCatalogManager = void 0;
const manager_1 = require("./manager");
const manager_utils_1 = require("./manager-utils");
const PNPM_WORKSPACE_FILENAME = 'pnpm-workspace.yaml';
/**
 * PNPM-specific catalog manager implementation
 */
class PnpmCatalogManager {
    constructor() {
        this.name = 'pnpm';
        this.catalogProtocol = 'catalog:';
        // Parsed fs-root definitions, cached per pass. See readCatalogDefinitions.
        this.definitionsByRoot = new Map();
    }
    isCatalogReference(version) {
        return version.startsWith(this.catalogProtocol);
    }
    parseCatalogReference(version) {
        if (!this.isCatalogReference(version)) {
            return null;
        }
        const catalogName = version.substring(this.catalogProtocol.length);
        // Normalize both "catalog:" and "catalog:default" to the same representation
        const isDefault = !catalogName || catalogName === 'default';
        return {
            catalogName: isDefault ? undefined : catalogName,
            isDefaultCatalog: isDefault,
        };
    }
    getCatalogDefinitionFilePaths() {
        return [PNPM_WORKSPACE_FILENAME];
    }
    getCatalogDefinitions(treeOrRoot) {
        return (0, manager_utils_1.readCatalogDefinitions)(PNPM_WORKSPACE_FILENAME, treeOrRoot, this.definitionsByRoot);
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
            // Check both locations for default catalog
            catalogToUse = catalogDefs.catalog ?? catalogDefs.catalogs?.default;
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
            throw new Error((0, manager_1.formatCatalogError)(`Cannot get Pnpm catalog definitions. No ${PNPM_WORKSPACE_FILENAME} found in workspace root.`, [`Create a ${PNPM_WORKSPACE_FILENAME} file in your workspace root`]));
        }
        let catalogToUse;
        if (catalogRef.isDefaultCatalog) {
            const hasCatalog = !!catalogDefs.catalog;
            const hasCatalogsDefault = !!catalogDefs.catalogs?.default;
            // Error if both defined (matches pnpm behavior)
            if (hasCatalog && hasCatalogsDefault) {
                throw new Error("The 'default' catalog was defined multiple times. Use the 'catalog' field or 'catalogs.default', but not both.");
            }
            catalogToUse = catalogDefs.catalog ?? catalogDefs.catalogs?.default;
            if (!catalogToUse) {
                const availableCatalogs = Object.keys(catalogDefs.catalogs || {});
                const suggestions = [
                    `Define a default catalog in ${PNPM_WORKSPACE_FILENAME} under the "catalog" key`,
                ];
                if (availableCatalogs.length > 0) {
                    suggestions.push(`Or select from the available named catalogs: ${availableCatalogs
                        .map((c) => `"catalog:${c}"`)
                        .join(', ')}`);
                }
                throw new Error((0, manager_1.formatCatalogError)(`No default catalog defined in ${PNPM_WORKSPACE_FILENAME}`, suggestions));
            }
        }
        else if (catalogRef.catalogName) {
            catalogToUse = catalogDefs.catalogs?.[catalogRef.catalogName];
            if (!catalogToUse) {
                const availableCatalogs = Object.keys(catalogDefs.catalogs || {}).filter((c) => c !== 'default');
                const defaultCatalog = !!catalogDefs.catalog
                    ? 'catalog'
                    : !catalogDefs.catalogs?.default
                        ? 'catalogs.default'
                        : null;
                const suggestions = [
                    `Define the catalog in ${PNPM_WORKSPACE_FILENAME} under the "catalogs" key`,
                ];
                if (availableCatalogs.length > 0) {
                    suggestions.push(`Or select from the available named catalogs: ${availableCatalogs
                        .map((c) => `"catalog:${c}"`)
                        .join(', ')}`);
                }
                if (defaultCatalog) {
                    suggestions.push(`Or use the default catalog ("${defaultCatalog}")`);
                }
                throw new Error((0, manager_1.formatCatalogError)(`Catalog "${catalogRef.catalogName}" not found in ${PNPM_WORKSPACE_FILENAME}`, suggestions));
            }
        }
        if (!catalogToUse[packageName]) {
            let catalogName;
            if (catalogRef.isDefaultCatalog) {
                // Context-aware messaging based on which location exists
                const hasCatalog = !!catalogDefs.catalog;
                catalogName = hasCatalog
                    ? 'default catalog ("catalog")'
                    : 'default catalog ("catalogs.default")';
            }
            else {
                catalogName = `catalog '${catalogRef.catalogName}'`;
            }
            const availablePackages = Object.keys(catalogToUse);
            const suggestions = [
                `Add "${packageName}" to ${catalogName} in ${PNPM_WORKSPACE_FILENAME}`,
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
        (0, manager_utils_1.updateCatalogVersionsInFile)(PNPM_WORKSPACE_FILENAME, treeOrRoot, updates);
    }
}
exports.PnpmCatalogManager = PnpmCatalogManager;
