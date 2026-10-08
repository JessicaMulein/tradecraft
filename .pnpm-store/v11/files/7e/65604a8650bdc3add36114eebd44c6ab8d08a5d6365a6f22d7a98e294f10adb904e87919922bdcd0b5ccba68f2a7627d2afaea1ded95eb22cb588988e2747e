"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCatalogManager = void 0;
exports.resolveCatalogReferenceIfNeeded = resolveCatalogReferenceIfNeeded;
exports.resolveCatalogSpecifiers = resolveCatalogSpecifiers;
exports.getCatalogDependenciesFromPackageJson = getCatalogDependenciesFromPackageJson;
const json_1 = require("../../generators/utils/json");
const workspace_root_1 = require("../workspace-root");
const manager_factory_1 = require("./manager-factory");
Object.defineProperty(exports, "getCatalogManager", { enumerable: true, get: function () { return manager_factory_1.getCatalogManager; } });
/**
 * Dereferences a pnpm/yarn/bun catalog reference to a concrete version spec. Returns
 * the input unchanged when it is not a catalog reference (or no catalog manager
 * applies). Throws when the reference cannot be resolved.
 */
function resolveCatalogReferenceIfNeeded(packageName, version) {
    const manager = (0, manager_factory_1.getCatalogManager)(workspace_root_1.workspaceRoot);
    if (!manager?.isCatalogReference(version)) {
        return version;
    }
    const resolvedVersion = manager.resolveCatalogReference(workspace_root_1.workspaceRoot, packageName, version);
    if (!resolvedVersion) {
        throw new Error(`Unable to resolve catalog reference ${packageName}@${version}.`);
    }
    return resolvedVersion;
}
/**
 * Resolves a package.json's `catalog:` dependency / devDependency specifiers to
 * their declared version range. Non-catalog or unresolvable specifiers are
 * returned unchanged.
 */
function resolveCatalogSpecifiers(packageJson) {
    if (!packageJson) {
        return packageJson;
    }
    const resolveSection = (section) => {
        const resolved = {};
        for (const [name, specifier] of Object.entries(section)) {
            try {
                resolved[name] = resolveCatalogReferenceIfNeeded(name, specifier);
            }
            catch {
                resolved[name] = specifier;
            }
        }
        return resolved;
    };
    const result = { ...packageJson };
    if (packageJson.dependencies) {
        result.dependencies = resolveSection(packageJson.dependencies);
    }
    if (packageJson.devDependencies) {
        result.devDependencies = resolveSection(packageJson.devDependencies);
    }
    return result;
}
/**
 * Detects which packages in a package.json use catalog references
 * Returns Map of package name -> catalog name (undefined for default catalog)
 */
function getCatalogDependenciesFromPackageJson(tree, packageJsonPath, manager) {
    const catalogDeps = new Map();
    if (!tree.exists(packageJsonPath)) {
        return catalogDeps;
    }
    try {
        const packageJson = (0, json_1.readJson)(tree, packageJsonPath);
        const allDependencies = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
            ...packageJson.peerDependencies,
            ...packageJson.optionalDependencies,
        };
        for (const [packageName, version] of Object.entries(allDependencies || {})) {
            if (manager.isCatalogReference(version)) {
                const catalogRef = manager.parseCatalogReference(version);
                if (catalogRef) {
                    catalogDeps.set(packageName, catalogRef.catalogName);
                }
            }
        }
    }
    catch (error) {
        // If we can't read the package.json, return empty map
    }
    return catalogDeps;
}
