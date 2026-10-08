"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatCatalogError = formatCatalogError;
exports.collectCatalogReferencesForPackage = collectCatalogReferencesForPackage;
function formatCatalogError(error, suggestions) {
    let message = error;
    if (suggestions.length > 0) {
        message += '\n\nSuggestions:';
        suggestions.forEach((suggestion) => {
            message += `\n  • ${suggestion}`;
        });
    }
    return message;
}
/**
 * Shared implementation of getCatalogReferencesForPackage: enumerates the
 * default and named catalog references and keeps those the manager resolves,
 * so per-manager default-catalog semantics apply without duplication.
 */
function collectCatalogReferencesForPackage(manager, treeOrRoot, packageName) {
    // The overload pairs don't accept the Tree | string union directly.
    const source = treeOrRoot;
    const catalogDefs = manager.getCatalogDefinitions(source);
    if (!catalogDefs) {
        return [];
    }
    const catalogRefs = ['catalog:'];
    for (const name of Object.keys(catalogDefs.catalogs ?? {})) {
        // Skip names the manager treats as the default catalog (e.g. pnpm's
        // "default") — already covered by the `catalog:` candidate.
        if (!manager.parseCatalogReference(`catalog:${name}`)?.isDefaultCatalog) {
            catalogRefs.push(`catalog:${name}`);
        }
    }
    const matches = [];
    for (const catalogRef of catalogRefs) {
        const versionSpec = manager.resolveCatalogReference(source, packageName, catalogRef);
        if (versionSpec) {
            matches.push({ catalogRef, versionSpec });
        }
    }
    return matches;
}
