"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveESLintClass = resolveESLintClass;
const flat_config_1 = require("../utils/flat-config");
async function resolveESLintClass(opts) {
    const shouldESLintUseFlatConfig = typeof opts?.useFlatConfigOverrideVal === 'boolean'
        ? opts.useFlatConfigOverrideVal
        : (0, flat_config_1.useFlatConfig)();
    // `loadESLint` (added in eslint 8.57.0) resolves the correct ESLint class
    // for flat vs eslintrc config; it exists in every supported version (v9+).
    let eslintModule;
    // Only a failed import means eslint is missing; let loadESLint errors surface.
    try {
        eslintModule = (await import('eslint'));
    }
    catch {
        throw new Error('Unable to find `eslint`. Ensure a valid `eslint` version is installed.');
    }
    return (await eslintModule.loadESLint({
        useFlatConfig: shouldESLintUseFlatConfig,
    }));
}
