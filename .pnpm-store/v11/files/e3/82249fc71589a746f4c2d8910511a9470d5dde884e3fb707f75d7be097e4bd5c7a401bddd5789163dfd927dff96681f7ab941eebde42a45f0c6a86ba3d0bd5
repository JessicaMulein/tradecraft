"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSwcDependencies = getSwcDependencies;
exports.addSwcDependencies = addSwcDependencies;
exports.addSwcRegisterDependencies = addSwcRegisterDependencies;
const devkit_1 = require("@nx/devkit");
const internal_1 = require("@nx/devkit/internal");
const versions_1 = require("../versions");
// @swc/core's postinstall only installs a wasm fallback for platforms not
// covered by its prebuilt optional dependencies, so skip it.
const swcAllowBuilds = { '@swc/core': false };
function getSwcDependencies() {
    const dependencies = {
        '@swc/helpers': versions_1.swcHelpersVersion,
    };
    const devDependencies = {
        '@swc/core': versions_1.swcCoreVersion,
        '@swc/cli': versions_1.swcCliVersion,
    };
    return { dependencies, devDependencies };
}
function addSwcDependencies(tree) {
    const { dependencies, devDependencies } = getSwcDependencies();
    (0, internal_1.acknowledgeBuildScripts)(tree, (0, devkit_1.detectPackageManager)(tree.root), swcAllowBuilds);
    return (0, devkit_1.addDependenciesToPackageJson)(tree, dependencies, devDependencies, undefined, true);
}
function addSwcRegisterDependencies(tree) {
    (0, internal_1.acknowledgeBuildScripts)(tree, (0, devkit_1.detectPackageManager)(tree.root), swcAllowBuilds);
    return (0, devkit_1.addDependenciesToPackageJson)(tree, {}, { '@swc-node/register': versions_1.swcNodeVersion, '@swc/core': versions_1.swcCoreVersion }, undefined, true);
}
