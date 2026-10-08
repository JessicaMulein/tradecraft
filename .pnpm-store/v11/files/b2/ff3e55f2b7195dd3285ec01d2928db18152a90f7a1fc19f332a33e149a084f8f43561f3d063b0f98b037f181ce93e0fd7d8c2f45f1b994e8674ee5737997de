"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.determineProjectNameAndRootOptions = determineProjectNameAndRootOptions;
exports.resolveImportPath = resolveImportPath;
exports.ensureRootProjectName = ensureRootProjectName;
const devkit_internals_1 = require("nx/src/devkit-internals");
const prompt_1 = require("./prompt");
const devkit_exports_1 = require("nx/src/devkit-exports");
const path_1 = require("path");
async function determineProjectNameAndRootOptions(tree, options) {
    // root projects must provide name option
    if (options.directory === '.' && !options.name) {
        throw new Error(`When generating a root project, you must also specify the name option.`);
    }
    const directory = (0, devkit_exports_1.normalizePath)(options.directory);
    const name = options.name ??
        directory.match(/(@[^@/]+(\/[^@/]+)+)/)?.[1] ??
        directory.substring(directory.lastIndexOf('/') + 1);
    validateOptions(options.name, name, options.directory);
    let projectSimpleName;
    let projectFileName;
    if (name.startsWith('@')) {
        const [_scope, ...rest] = name.split('/');
        projectFileName = rest.join('-');
        projectSimpleName = rest.pop();
    }
    else {
        projectSimpleName = name;
        projectFileName = name;
    }
    let projectRoot;
    const relativeCwd = getRelativeCwd();
    if (directory) {
        // append the directory to the current working directory if it doesn't start with it
        if (directory === relativeCwd || directory.startsWith(`${relativeCwd}/`)) {
            projectRoot = directory;
        }
        else {
            projectRoot = (0, devkit_exports_1.joinPathFragments)(relativeCwd, directory);
        }
    }
    else if (options.rootProject) {
        projectRoot = '.';
    }
    else {
        projectRoot = relativeCwd;
        // append the project name to the current working directory if it doesn't end with it
        if (!relativeCwd.endsWith(name)) {
            projectRoot = (0, devkit_exports_1.joinPathFragments)(relativeCwd, name);
        }
    }
    if (projectRoot.startsWith('..')) {
        throw new Error(`The resolved project root "${projectRoot}" is outside of the workspace root "${devkit_exports_1.workspaceRoot}".`);
    }
    validateUniqueName(tree, name, projectRoot, options);
    const importPath = options.importPath ?? resolveImportPath(tree, name, projectRoot);
    return {
        projectName: name,
        names: {
            projectSimpleName,
            projectFileName,
        },
        importPath,
        projectRoot,
    };
}
function resolveImportPath(tree, projectName, projectRoot) {
    let importPath;
    if (projectName.startsWith('@')) {
        importPath = projectName;
    }
    else {
        const npmScope = getNpmScope(tree);
        importPath =
            projectRoot === '.'
                ? ((0, devkit_exports_1.readJson)(tree, 'package.json').name ??
                    getImportPath(npmScope, projectName))
                : getImportPath(npmScope, projectName);
    }
    return importPath;
}
async function ensureRootProjectName(options, projectType) {
    if (!options.name && options.directory === '.' && getRelativeCwd() === '') {
        options.name = (0, prompt_1.isInteractive)()
            ? await (0, devkit_internals_1.textPrompt)({
                message: `What do you want to name the ${projectType}?`,
            })
            : undefined;
    }
}
function validateOptions(providedName, derivedName, directory) {
    /**
     * The provided name and the derived name from the provided directory must match one of two cases:
     *
     * 1. Valid npm package names (e.g., '@scope/name' or 'name').
     * 2. Names starting with a letter and can contain any character except whitespace and ':'.
     *
     * The second case is to support the legacy behavior (^[a-zA-Z].*$) with the difference
     * that it doesn't allow the ":" character. It was wrong to allow it because it would
     * conflict with the notation for tasks.
     */
    const pattern = '(?:^@[a-zA-Z0-9-*~][a-zA-Z0-9-*._~]*\\/[a-zA-Z0-9-~][a-zA-Z0-9-._~]*|^[a-zA-Z][^:]*)$';
    const validationRegex = new RegExp(pattern);
    if (providedName) {
        if (!validationRegex.test(providedName)) {
            throw new Error(`The name should match the pattern "${pattern}". The provided value "${providedName}" does not match.`);
        }
    }
    else if (!validationRegex.test(derivedName)) {
        throw new Error(`The derived name from the provided directory should match the pattern "${pattern}". The derived name "${derivedName}" from the provided value "${directory}" does not match.`);
    }
}
function validateUniqueName(tree, name, projectRoot, options) {
    const existingProject = (0, devkit_exports_1.getProjects)(tree).get(name);
    // A project at the resolved root is handled elsewhere with a more
    // accurate error, so only error when the name is taken by a project
    // located somewhere else.
    if (!existingProject || existingProject.root === projectRoot) {
        return;
    }
    throw new Error(options.name
        ? `The provided name "${name}" is already used by the project at "${existingProject.root}". Please provide a unique name for the new project.`
        : `The name "${name}" was derived from the provided directory "${options.directory}", but it is already used by the project at "${existingProject.root}". Please provide a unique name for the new project with the "--name" option.`);
}
function getImportPath(npmScope, name) {
    return npmScope ? `${npmScope === '@' ? '' : '@'}${npmScope}/${name}` : name;
}
function getNpmScope(tree) {
    const { name } = tree.exists('package.json')
        ? (0, devkit_exports_1.readJson)(tree, 'package.json')
        : { name: null };
    return name?.startsWith('@') ? name.split('/')[0].substring(1) : undefined;
}
/**
 * When running a script with the package manager (e.g. `npm run`), the package manager will
 * traverse the directory tree upwards until it finds a `package.json` and will set `process.cwd()`
 * to the folder where it found it. The actual working directory is stored in the INIT_CWD
 * environment variable (see here: https://docs.npmjs.com/cli/v9/commands/npm-run-script#description).
 */
function getCwd() {
    return process.env.INIT_CWD?.startsWith(devkit_exports_1.workspaceRoot)
        ? process.env.INIT_CWD
        : process.cwd();
}
function getRelativeCwd() {
    return (0, devkit_exports_1.normalizePath)((0, path_1.relative)(devkit_exports_1.workspaceRoot, getCwd())).replace(/\/$/, '');
}
