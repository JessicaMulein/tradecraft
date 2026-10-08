"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.typescriptESLintVersion = exports.eslintVersion = exports.eslintCompat = exports.jsoncEslintParserVersion = exports.eslintrcVersion = exports.eslintConfigPrettierVersion = exports.minSupportedEslintVersion = exports.nxVersion = void 0;
exports.versions = versions;
exports.getInstalledEslintVersion = getInstalledEslintVersion;
const internal_1 = require("@nx/devkit/internal");
const path_1 = require("path");
const semver_1 = require("semver");
exports.nxVersion = require((0, path_1.join)('@nx/eslint', 'package.json')).version;
exports.minSupportedEslintVersion = '9.0.0';
exports.eslintConfigPrettierVersion = '^10.0.0';
exports.eslintrcVersion = '^3.0.0';
exports.jsoncEslintParserVersion = '^2.1.0';
exports.eslintCompat = '^1.1.1';
exports.eslintVersion = '^9.8.0';
exports.typescriptESLintVersion = '^8.58.0';
const latestVersions = {
    eslintVersion: exports.eslintVersion,
    typescriptESLintVersion: exports.typescriptESLintVersion,
};
const versionMap = {
    9: { eslintVersion: '^9.8.0', typescriptESLintVersion: '^8.58.0' },
};
function versions(tree) {
    const installedEslintVersion = getInstalledEslintVersion(tree);
    if (installedEslintVersion) {
        const eslintMajorVersion = (0, semver_1.major)(installedEslintVersion);
        return versionMap[eslintMajorVersion] ?? latestVersions;
    }
    // No ESLint declared yet, so fresh installs go to the latest supported stack.
    return latestVersions;
}
function getInstalledEslintVersion(tree) {
    if (!tree) {
        return (0, internal_1.getInstalledPackageVersion)('eslint');
    }
    return (0, internal_1.getDeclaredPackageVersion)(tree, 'eslint');
}
