"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEsmProject = isEsmProject;
const devkit_1 = require("@nx/devkit");
const module_format_1 = require("./module-format");
/**
 * Determine whether a project should be treated as ESM for the purpose of
 * emitting `.ts` config and source files (e.g. choosing between
 * `__filename`/`__dirname` and `import.meta.dirname`, or `require()` and
 * `import` for sibling subpath imports).
 *
 * Mirrors Node's package.json `type` resolution: the **closest**
 * package.json with a recognized `type` field wins.
 *
 * Resolution order:
 * 1. The project's package.json `type`, if present and recognized.
 * 2. The workspace-root package.json `type`, if present and recognized.
 * 3. Default: `false` (CJS).
 */
function isEsmProject(tree, projectRoot) {
    const projectPackageJsonPath = (0, devkit_1.joinPathFragments)(projectRoot, 'package.json');
    if (tree.exists(projectPackageJsonPath)) {
        const projectFmt = (0, module_format_1.getPackageJsonModuleFormat)((0, devkit_1.readJson)(tree, projectPackageJsonPath));
        // Only honor an explicit type field; fall through to workspace when
        // unset so we match Node's "walk up to nearest type field" behavior.
        if (projectFmt !== null) {
            return projectFmt === 'esm';
        }
    }
    const workspaceFmt = (0, module_format_1.getPackageJsonModuleFormat)((0, devkit_1.readJson)(tree, 'package.json'));
    return workspaceFmt === 'esm';
}
