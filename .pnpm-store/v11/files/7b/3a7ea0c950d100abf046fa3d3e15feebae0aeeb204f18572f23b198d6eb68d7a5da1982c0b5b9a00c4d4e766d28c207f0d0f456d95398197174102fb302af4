"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPackageJsonModuleFormat = getPackageJsonModuleFormat;
exports.getTsConfigModuleFormat = getTsConfigModuleFormat;
/**
 * Decide module format from a parsed package.json `type` field alone.
 * Returns `null` when the field is unset or holds an unrecognized value -
 * callers can then fall back to other signals (tsconfig, defaults).
 */
function getPackageJsonModuleFormat(packageJson) {
    if (!packageJson)
        return null;
    if (packageJson.type === 'module')
        return 'esm';
    if (packageJson.type === 'commonjs')
        return 'cjs';
    return null;
}
/**
 * Decide module format from tsconfig compiler options' `module` setting.
 * Returns `null` when the setting is unset OR when it is `NodeNext` /
 * `Node16` (those defer to the package.json `type` field, so the caller
 * should have already checked package.json).
 */
function getTsConfigModuleFormat(compilerOptions) {
    const m = compilerOptions?.module;
    if (m === undefined)
        return null;
    // Lazy-require typescript so importing this module (e.g. via
    // @nx/js/internal -> is-esm-project) doesn't fail in workspaces that
    // haven't installed typescript yet (fresh CNW projects before a
    // generator adds it).
    const tsMod = require('typescript');
    if (m === tsMod.ModuleKind.NodeNext || m === tsMod.ModuleKind.Node16)
        return null;
    if (m === tsMod.ModuleKind.ES2015 ||
        m === tsMod.ModuleKind.ES2020 ||
        m === tsMod.ModuleKind.ES2022 ||
        m === tsMod.ModuleKind.ESNext) {
        return 'esm';
    }
    return 'cjs';
}
