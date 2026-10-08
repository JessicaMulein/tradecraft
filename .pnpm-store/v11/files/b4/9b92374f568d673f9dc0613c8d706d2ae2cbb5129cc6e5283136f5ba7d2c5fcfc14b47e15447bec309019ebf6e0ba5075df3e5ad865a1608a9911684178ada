"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGlobPatternsForDependencies = createGlobPatternsForDependencies;
const tslib_1 = require("tslib");
const devkit_1 = require("@nx/devkit");
const path_1 = require("path");
const fs_1 = require("fs");
const ignore_1 = tslib_1.__importDefault(require("ignore"));
const internal_1 = require("@nx/devkit/internal");
function configureIgnore() {
    let ig;
    const pathToGitIgnore = (0, path_1.join)(devkit_1.workspaceRoot, '.gitignore');
    if ((0, fs_1.existsSync)(pathToGitIgnore)) {
        ig = (0, ignore_1.default)();
        ig.add((0, fs_1.readFileSync)(pathToGitIgnore, { encoding: 'utf-8' }));
    }
    return ig;
}
/**
 * Generates a set of glob patterns based off the source root of the app and its dependencies
 * @param dirPath workspace relative directory path that will be used to infer the parent project and dependencies
 * @param fileGlobPattern pass a custom glob pattern to be used
 */
function createGlobPatternsForDependencies(dirPath, fileGlobPattern) {
    let ig = configureIgnore();
    const filenameRelativeToWorkspaceRoot = (0, devkit_1.normalizePath)((0, path_1.relative)(devkit_1.workspaceRoot, dirPath));
    const projectGraph = (0, devkit_1.readCachedProjectGraph)();
    const projectRootMappings = (0, internal_1.createProjectRootMappings)(projectGraph.nodes);
    // find the project
    let projectName;
    try {
        projectName = (0, internal_1.findProjectForPath)(filenameRelativeToWorkspaceRoot, projectRootMappings);
        if (!projectName) {
            throw new Error(`createGlobPatternsForDependencies: Could not find any project containing the file "${filenameRelativeToWorkspaceRoot}" among it's project files`);
        }
    }
    catch (e) {
        throw new Error(`createGlobPatternsForDependencies: Error when trying to determine main project.\n${e?.message}`);
    }
    // generate the glob
    try {
        const [projectDirs, warnings] = (0, internal_1.getSourceDirOfDependentProjects)(projectName, projectGraph);
        const dirsToUse = [];
        const recursiveScanDirs = (dirPath) => {
            const children = (0, fs_1.readdirSync)((0, path_1.resolve)(devkit_1.workspaceRoot, dirPath));
            for (const child of children) {
                const childPath = (0, path_1.join)(dirPath, child);
                if (ig?.ignores(childPath) ||
                    !(0, fs_1.lstatSync)((0, path_1.resolve)(devkit_1.workspaceRoot, childPath)).isDirectory()) {
                    continue;
                }
                if ((0, fs_1.existsSync)((0, path_1.join)(devkit_1.workspaceRoot, childPath, 'ng-package.json'))) {
                    dirsToUse.push(childPath);
                }
                else {
                    recursiveScanDirs(childPath);
                }
            }
        };
        for (const srcDir of projectDirs) {
            dirsToUse.push(srcDir);
            const root = (0, path_1.dirname)(srcDir);
            recursiveScanDirs(root);
        }
        if (warnings.length > 0) {
            devkit_1.logger.warn(`
[createGlobPatternsForDependencies] Failed to generate glob pattern for the following:
${warnings.join('\n- ')}\n
due to missing "sourceRoot" in the dependencies' project configuration
      `);
        }
        return dirsToUse.map((sourceDir) => (0, path_1.resolve)(devkit_1.workspaceRoot, (0, devkit_1.joinPathFragments)(sourceDir, fileGlobPattern)));
    }
    catch (e) {
        throw new Error(`createGlobPatternsForDependencies: Error when generating globs.\n${e?.message}`);
    }
}
