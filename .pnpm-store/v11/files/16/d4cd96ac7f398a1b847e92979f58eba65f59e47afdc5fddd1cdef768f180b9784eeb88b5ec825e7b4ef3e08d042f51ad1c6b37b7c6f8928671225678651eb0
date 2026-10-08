"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetFormatterWarningsForTesting = resetFormatterWarningsForTesting;
exports.detectFormatter = detectFormatter;
exports.detectFormatterInTree = detectFormatterInTree;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const json_1 = require("../../generators/utils/json");
const fileutils_1 = require("../fileutils");
const oxfmt_1 = require("./oxfmt");
const prettier_1 = require("./prettier");
const logger_1 = require("../logger");
// Once per process: detection runs on every one of 200+ `formatFiles` call sites.
let warnedBothConfigured = false;
function warnBothConfigured() {
    warnedBothConfigured = true;
    logger_1.logger.warn('Both an oxfmt and a prettier config were found. Nx is formatting with ' +
        'oxfmt. Delete the config you are not using to make the choice ' +
        'explicit: https://nx.dev/docs/reference/code-formatting');
}
/** Test-only: the warn-once flag is module state and would leak between cases. */
function resetFormatterWarningsForTesting() {
    warnedBothConfigured = false;
}
function detectFormatter(root) {
    if ((0, oxfmt_1.isUsingOxfmt)(root)) {
        // Flag first, so the lookup stops repeating once we have warned.
        if (!warnedBothConfigured && (0, prettier_1.isUsingPrettier)(root)) {
            warnBothConfigured();
        }
        return 'oxfmt';
    }
    if ((0, prettier_1.isUsingPrettier)(root)) {
        return 'prettier';
    }
    // Neither is configured. Both formatters run on their defaults, so a
    // dependency declared in the root package.json is the only statement of
    // intent an unconfigured workspace gives. #30426 ruled out treating prettier
    // as *resolvable in node_modules*, which a declared dependency is not.
    const packageJsonPath = (0, node_path_1.join)(root, 'package.json');
    if ((0, node_fs_1.existsSync)(packageJsonPath)) {
        return detectFormatterFromDependencies((0, fileutils_1.readJsonFile)(packageJsonPath));
    }
    return null;
}
function detectFormatterInTree(tree) {
    if ((0, oxfmt_1.isUsingOxfmtInTree)(tree)) {
        if (!warnedBothConfigured && (0, prettier_1.isUsingPrettierInTree)(tree)) {
            warnBothConfigured();
        }
        return 'oxfmt';
    }
    if ((0, prettier_1.isUsingPrettierInTree)(tree)) {
        return 'prettier';
    }
    // See detectFormatter: a declared dependency is the fallback for both.
    if (tree.exists('package.json')) {
        return detectFormatterFromDependencies((0, json_1.readJson)(tree, 'package.json'));
    }
    return null;
}
/** oxfmt first, matching the precedence the config files already have. */
function detectFormatterFromDependencies(packageJson) {
    if (hasDependency(packageJson, 'oxfmt')) {
        return 'oxfmt';
    }
    if (hasDependency(packageJson, 'prettier')) {
        return 'prettier';
    }
    return null;
}
function hasDependency(packageJson, name) {
    return Boolean(packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name]);
}
