"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analogVitestAngular = exports.jitiVersion = exports.edgeRuntimeVmVersion = exports.happyDomVersion = exports.ajvVersion = exports.vitePluginDtsVersion = exports.jsdomVersion = exports.vitePluginReactSwcVersion = exports.vitePluginReactV4Version = exports.vitePluginReactVersion = exports.viteV5Version = exports.viteV6Version = exports.viteV7Version = exports.viteVersion = exports.vitestCoverageIstanbulVersion = exports.vitestCoverageV8Version = exports.vitestVersion = exports.minSupportedVitestVersion = exports.nxVersion = void 0;
exports.versions = versions;
exports.getInstalledVitestVersion = getInstalledVitestVersion;
exports.getInstalledVitestMajorVersion = getInstalledVitestMajorVersion;
const devkit_1 = require("@nx/devkit");
const internal_1 = require("@nx/devkit/internal");
const path_1 = require("path");
const semver_1 = require("semver");
exports.nxVersion = require((0, path_1.join)('@nx/vitest', 'package.json')).version;
exports.minSupportedVitestVersion = '3.0.0';
exports.vitestVersion = '~4.1.0';
exports.vitestCoverageV8Version = '~4.1.0';
exports.vitestCoverageIstanbulVersion = '~4.1.0';
exports.viteVersion = '^8.0.0';
exports.viteV7Version = '^7.0.0';
exports.viteV6Version = '^6.0.0';
exports.viteV5Version = '^5.0.0';
exports.vitePluginReactVersion = '^6.0.0';
exports.vitePluginReactV4Version = '^4.2.0';
exports.vitePluginReactSwcVersion = '^4.3.0';
exports.jsdomVersion = '^27.1.0';
exports.vitePluginDtsVersion = '~4.5.0';
exports.ajvVersion = '^8.0.0';
exports.happyDomVersion = '^20.10.4';
exports.edgeRuntimeVmVersion = '~3.0.2';
exports.jitiVersion = '2.4.2';
exports.analogVitestAngular = '~2.6.0';
const latestVersions = {
    vitestVersion: exports.vitestVersion,
    vitestCoverageV8Version: exports.vitestCoverageV8Version,
    vitestCoverageIstanbulVersion: exports.vitestCoverageIstanbulVersion,
};
const versionMap = {
    3: {
        vitestVersion: '^3.0.0',
        vitestCoverageV8Version: '^3.0.5',
        vitestCoverageIstanbulVersion: '^3.0.5',
    },
};
function versions(tree) {
    const installedVitestVersion = getInstalledVitestVersion(tree);
    if (!installedVitestVersion) {
        return latestVersions;
    }
    const vitestMajorVersion = (0, semver_1.major)(installedVitestVersion);
    return versionMap[vitestMajorVersion] ?? latestVersions;
}
function getInstalledVitestVersion(tree) {
    if (!tree) {
        return (0, internal_1.getInstalledPackageVersion)('vitest');
    }
    const installedVersion = (0, devkit_1.getDependencyVersionFromPackageJson)(tree, 'vitest');
    if (!installedVersion) {
        return null;
    }
    if (installedVersion === 'latest' || installedVersion === 'next') {
        return (0, semver_1.clean)(exports.vitestVersion) ?? (0, semver_1.coerce)(exports.vitestVersion)?.version ?? null;
    }
    return (0, semver_1.clean)(installedVersion) ?? (0, semver_1.coerce)(installedVersion)?.version ?? null;
}
function getInstalledVitestMajorVersion(tree) {
    const installedVitestVersion = getInstalledVitestVersion(tree);
    return installedVitestVersion ? (0, semver_1.major)(installedVitestVersion) : null;
}
