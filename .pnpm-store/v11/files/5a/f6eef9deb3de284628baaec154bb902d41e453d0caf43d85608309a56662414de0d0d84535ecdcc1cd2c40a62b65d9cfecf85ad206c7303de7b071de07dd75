"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPackageManager = detectPackageManager;
exports.isWorkspacesEnabled = isWorkspacesEnabled;
exports.getPackageManagerCommand = getPackageManagerCommand;
exports.getPackageManagerVersion = getPackageManagerVersion;
exports.parseVersionFromPackageManagerField = parseVersionFromPackageManagerField;
exports.findFileInPackageJsonDirectory = findFileInPackageJsonDirectory;
exports.modifyYarnRcYmlToFitNewDirectory = modifyYarnRcYmlToFitNewDirectory;
exports.modifyYarnRcToFitNewDirectory = modifyYarnRcToFitNewDirectory;
exports.modifyPnpmWorkspaceYamlToFitNewDirectory = modifyPnpmWorkspaceYamlToFitNewDirectory;
exports.copyPackageManagerConfigurationFiles = copyPackageManagerConfigurationFiles;
exports.createTempNpmDirectory = createTempNpmDirectory;
exports.resolvePackageVersionUsingRegistry = resolvePackageVersionUsingRegistry;
exports.resolvePackageVersionUsingInstallation = resolvePackageVersionUsingInstallation;
exports.getWorkspaceRegistryUrlForDisplay = getWorkspaceRegistryUrlForDisplay;
exports.packageRegistryView = packageRegistryView;
exports.packageRegistryPack = packageRegistryPack;
exports.clearPackageManagerVersionCache = clearPackageManagerVersionCache;
exports.getPackageWorkspaces = getPackageWorkspaces;
exports.addPackagePathToWorkspaces = addPackagePathToWorkspaces;
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const promises_1 = require("node:fs/promises");
const path_1 = require("path");
const semver_1 = require("semver");
const tmp_1 = require("tmp");
const util_1 = require("util");
const yaml_1 = require("yaml");
const configuration_1 = require("../config/configuration");
const file_utils_1 = require("../project-graph/file-utils");
const catalog_1 = require("./catalog");
const fileutils_1 = require("./fileutils");
const installation_directory_1 = require("./installation-directory");
const logger_1 = require("./logger");
const package_json_1 = require("./package-json");
const shell_quoting_1 = require("./shell-quoting");
const workspace_root_1 = require("./workspace-root");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * Shell-less spawn for the registry-bridged fetches: `exec` goes through
 * /bin/sh, which is dash on Debian-family systems, and dash drops environment
 * names that are not valid shell identifiers, i.e. every `//...:_authToken`
 * credential and `@scope:registry` entry the overlay carries. Windows stays on
 * `exec`, with every argument quoted, because Node refuses to execFile the
 * package manager's `.cmd` shim without a shell.
 *
 * That quoting is the whole defence on Windows, so it goes through
 * quoteShellArg, which throws on the one argument it cannot make safe.
 */
function execPackageManagerAsync(pm, args, options) {
    if (process.platform === 'win32') {
        return execAsync([pm, ...args].map(shell_quoting_1.quoteShellArg).join(' '), options);
    }
    return execFileAsync(pm, args, options);
}
/** Same split, and the same quoting, for a blocking caller. */
function execPackageManagerSync(pm, args, options) {
    if (process.platform === 'win32') {
        return (0, child_process_1.execSync)([pm, ...args].map(shell_quoting_1.quoteShellArg).join(' '), options);
    }
    return (0, child_process_1.execFileSync)(pm, args, options);
}
/**
 * Detects which package manager is used in the workspace based on the lock file.
 */
function detectPackageManager(dir = '') {
    const nxJson = (0, configuration_1.readNxJson)();
    return (nxJson.cli?.packageManager ??
        ((0, fs_1.existsSync)((0, path_1.join)(dir, 'bun.lockb')) || (0, fs_1.existsSync)((0, path_1.join)(dir, 'bun.lock'))
            ? 'bun'
            : (0, fs_1.existsSync)((0, path_1.join)(dir, 'yarn.lock'))
                ? 'yarn'
                : (0, fs_1.existsSync)((0, path_1.join)(dir, 'pnpm-lock.yaml'))
                    ? 'pnpm'
                    : (0, fs_1.existsSync)((0, path_1.join)(dir, 'package-lock.json'))
                        ? 'npm'
                        : detectInvokedPackageManager()));
}
/**
 * Detects which package manager was used to invoke the current command
 * based on the npm_config_user_agent environment variable.
 *
 * Falls back to 'npm' if detection fails.
 */
function detectInvokedPackageManager() {
    const userAgent = process.env.npm_config_user_agent;
    if (userAgent) {
        if (userAgent.startsWith('pnpm/')) {
            return 'pnpm';
        }
        if (userAgent.startsWith('yarn/')) {
            return 'yarn';
        }
        if (userAgent.startsWith('bun/')) {
            return 'bun';
        }
    }
    return 'npm';
}
/**
 * Returns true if the workspace is using npm workspaces, yarn workspaces, or pnpm workspaces.
 * @param packageManager The package manager to use. If not provided, it will be detected based on the lock file.
 * @param root The directory the commands will be ran inside of. Defaults to the current workspace's root.
 */
function isWorkspacesEnabled(packageManager = detectPackageManager(), root = workspace_root_1.workspaceRoot) {
    if (packageManager === 'pnpm') {
        if (!(0, fs_1.existsSync)((0, path_1.join)(root, 'pnpm-workspace.yaml'))) {
            return false;
        }
        try {
            const content = (0, fs_1.readFileSync)((0, path_1.join)(root, 'pnpm-workspace.yaml'), 'utf-8');
            const { load } = require('@zkochan/js-yaml');
            const { packages } = load(content) ?? {};
            return packages !== undefined;
        }
        catch {
            return false;
        }
    }
    // yarn and npm both use the same 'workspaces' property in package.json
    const packageJson = (0, file_utils_1.readPackageJson)(root);
    return !!packageJson?.workspaces;
}
/**
 * Returns commands for the package manager used in the workspace.
 * By default, the package manager is derived based on the lock file,
 * but it can also be passed in explicitly.
 *
 * Example:
 *
 * ```javascript
 * execSync(`${getPackageManagerCommand().addDev} my-dev-package`);
 * ```
 *
 * @param packageManager The package manager to use. If not provided, it will be detected based on the lock file.
 * @param root The directory the commands will be ran inside of. Defaults to the current workspace's root.
 */
function getPackageManagerCommand(packageManager = detectPackageManager(), root = workspace_root_1.workspaceRoot) {
    const commands = {
        yarn: () => {
            let yarnVersion, useBerry;
            try {
                yarnVersion = getPackageManagerVersion('yarn', root);
                useBerry = (0, semver_1.gte)(yarnVersion, '2.0.0');
            }
            catch {
                yarnVersion = 'latest';
                useBerry = true;
            }
            // new versions of yarn only support ignoring scripts via .yarnrc.yml
            return {
                preInstall: `yarn set version ${yarnVersion}`,
                install: 'yarn',
                ciInstall: useBerry
                    ? 'yarn install --immutable'
                    : 'yarn install --frozen-lockfile',
                updateLockFile: useBerry
                    ? 'yarn install --mode update-lockfile'
                    : 'yarn install',
                add: useBerry ? 'yarn add' : 'yarn add -W',
                addDev: useBerry ? 'yarn add -D' : 'yarn add -D -W',
                rm: 'yarn remove',
                exec: 'yarn',
                dlx: useBerry ? 'yarn dlx' : 'npx',
                run: (script, args) => `yarn ${script}${args ? ` ${args}` : ''}`,
                list: useBerry ? 'yarn info --name-only' : 'yarn list',
                why: 'yarn why',
                getRegistryUrl: useBerry
                    ? 'yarn config get npmRegistryServer'
                    : 'yarn config get registry',
                publish: (packageRoot, registry, registryConfigKey, tag) => `npm publish "${packageRoot}" --json --"${registryConfigKey}=${registry}" --tag=${tag}`,
                ignoreScriptsFlag: useBerry ? undefined : `--ignore-scripts`,
            };
        },
        pnpm: () => {
            let modernPnpm, includeDoubleDashBeforeArgs, configForm, scopedForm;
            try {
                const pnpmVersion = getPackageManagerVersion('pnpm', root);
                modernPnpm = (0, semver_1.gte)(pnpmVersion, '6.13.0');
                includeDoubleDashBeforeArgs = (0, semver_1.lt)(pnpmVersion, '7.0.0');
                configForm = (0, semver_1.gte)(pnpmVersion, '11.0.0');
                // Support for --@scope:registry was added in pnpm v10.5.0 and
                // backported to v9.15.7. Starting with pnpm 11, the equivalent
                // option is --config.@scope:registry.
                scopedForm = (0, semver_1.satisfies)(pnpmVersion, '>=9.15.7 <10.0.0 || >=10.5.0 <11.0.0');
            }
            catch {
                modernPnpm = true;
                includeDoubleDashBeforeArgs = true;
                configForm = false;
                scopedForm = false;
            }
            const isPnpmWorkspace = (0, fs_1.existsSync)((0, path_1.join)(root, 'pnpm-workspace.yaml'));
            return {
                install: 'pnpm install --no-frozen-lockfile', // explicitly disable in case of CI
                ciInstall: 'pnpm install --frozen-lockfile',
                updateLockFile: 'pnpm install --lockfile-only',
                add: isPnpmWorkspace
                    ? 'pnpm add -w --config.frozen-lockfile=false'
                    : 'pnpm add --config.frozen-lockfile=false',
                addDev: isPnpmWorkspace
                    ? 'pnpm add -Dw --config.frozen-lockfile=false'
                    : 'pnpm add -D --config.frozen-lockfile=false',
                rm: 'pnpm rm',
                exec: modernPnpm ? 'pnpm exec' : 'pnpx',
                dlx: modernPnpm ? 'pnpm dlx' : 'pnpx',
                run: (script, args) => `pnpm run ${script}${args
                    ? includeDoubleDashBeforeArgs
                        ? ' -- ' + args
                        : ` ${args}`
                    : ''}`,
                list: 'pnpm ls --depth 100',
                why: 'pnpm why',
                getRegistryUrl: 'pnpm config get registry',
                publish: (packageRoot, registry, registryConfigKey, tag) => `pnpm publish "${packageRoot}" --json --"${configForm
                    ? `config.${registryConfigKey}`
                    : scopedForm
                        ? registryConfigKey
                        : 'registry'}=${registry}" --tag=${tag} --no-git-checks`,
                ignoreScriptsFlag: '--ignore-scripts',
            };
        },
        npm: () => {
            return {
                install: 'npm install',
                ciInstall: 'npm ci',
                updateLockFile: 'npm install --package-lock-only',
                add: 'npm install',
                addDev: 'npm install -D',
                rm: 'npm rm',
                exec: 'npx',
                dlx: 'npx',
                run: (script, args) => `npm run ${script}${args ? ' -- ' + args : ''}`,
                list: 'npm ls',
                why: 'npm explain',
                getRegistryUrl: 'npm config get registry',
                publish: (packageRoot, registry, registryConfigKey, tag) => `npm publish "${packageRoot}" --json --"${registryConfigKey}=${registry}" --tag=${tag}`,
                ignoreScriptsFlag: '--ignore-scripts',
            };
        },
        bun: () => {
            // bun doesn't current support programmatically reading config https://github.com/oven-sh/bun/issues/7140
            return {
                install: 'bun install',
                ciInstall: 'bun install --no-cache',
                updateLockFile: 'bun install --lockfile-only',
                add: 'bun install',
                addDev: 'bun install -D',
                rm: 'bun rm',
                exec: 'bun',
                dlx: 'bunx',
                run: (script, args) => `bun run ${script} -- ${args}`,
                list: 'bun pm ls',
                why: 'bun why',
                // Unlike npm, bun publish does not support a custom registryConfigKey option
                publish: (packageRoot, registry, registryConfigKey, tag) => `bun publish --cwd="${packageRoot}" --json --registry="${registry}" --tag=${tag}`,
                ignoreScriptsFlag: '--ignore-scripts',
            };
        },
    };
    return commands[packageManager]();
}
/**
 * Returns the version of the package manager used in the workspace.
 * By default, the package manager is derived based on the lock file,
 * but it can also be passed in explicitly.
 */
function getPackageManagerVersion(packageManager = detectPackageManager(), cwd = process.cwd()) {
    let version;
    if ((0, fs_1.existsSync)((0, path_1.join)(cwd, 'package.json'))) {
        const packageManagerEntry = (0, fileutils_1.readJsonFile)((0, path_1.join)(cwd, 'package.json'))?.packageManager;
        version = parseVersionFromPackageManagerField(packageManager, packageManagerEntry);
    }
    if (!version) {
        try {
            const versionArgs = packageManager === 'pnpm'
                ? '--ignore-workspace --version'
                : '--version';
            version = (0, child_process_1.execSync)(`${packageManager} ${versionArgs}`, {
                cwd,
                encoding: 'utf-8',
                windowsHide: true,
            }).trim();
        }
        catch { }
    }
    if (!version) {
        throw new Error(`Cannot determine the version of ${packageManager}.`);
    }
    return version;
}
function parseVersionFromPackageManagerField(requestedPackageManager, packageManagerFieldValue) {
    if (!packageManagerFieldValue)
        return null;
    const [packageManagerFromPackageJson, versionFromPackageJson] = packageManagerFieldValue.split('@');
    if (versionFromPackageJson &&
        // If it's a URL, it's not a valid range by default, unless users set `COREPACK_ENABLE_UNSAFE_CUSTOM_URLS=1`.
        // In the unsafe case, there's no way to reliably pare out the version since it could be anything, e.g. http://mydomain.com/bin/yarn.js.
        // See: https://github.com/nodejs/corepack/blob/2b43f26/sources/corepackUtils.ts#L110-L112
        !URL.canParse(versionFromPackageJson) &&
        packageManagerFromPackageJson === requestedPackageManager &&
        versionFromPackageJson) {
        // The range could have a validation hash attached, like "3.2.3+sha224.953c8233f7a92884eee2de69a1b92d1f2ec1655e66d08071ba9a02fa".
        // We just want to parse out the "<major>.<minor>.<patch>". Semver treats "+" as a build, which is not included in the resulting version.
        return (0, semver_1.parse)(versionFromPackageJson)?.version ?? null;
    }
    return null;
}
/**
 * Checks for a project level npmrc file by crawling up the file tree until
 * hitting a package.json file, as this is how npm finds them as well.
 */
function findFileInPackageJsonDirectory(file, directory = process.cwd()) {
    while (!(0, fs_1.existsSync)((0, path_1.join)(directory, 'package.json'))) {
        if (directory === workspace_root_1.workspaceRoot) {
            // we reached the workspace root and we didn't find a package.json file
            return null;
        }
        directory = (0, path_1.dirname)(directory);
    }
    const path = (0, path_1.join)(directory, file);
    return (0, fs_1.existsSync)(path) ? path : null;
}
/**
 * We copy yarnrc.yml to the temporary directory to ensure things like the specified
 * package registry are still used. However, there are a few relative paths that can
 * cause issues, so we modify them to fit the new directory.
 *
 * Exported for testing - not meant to be used outside of this file.
 *
 * @param contents The string contents of the yarnrc.yml file
 * @returns Updated string contents of the yarnrc.yml file
 */
function modifyYarnRcYmlToFitNewDirectory(contents) {
    const { parseSyml, stringifySyml } = require('./yarn-syml');
    const parsed = parseSyml(contents);
    if (parsed.yarnPath) {
        // yarnPath is relative to the workspace root, so we need to make it relative
        // to the new directory s.t. it still points to the same yarn binary.
        delete parsed.yarnPath;
    }
    if (parsed.plugins) {
        // Plugins specified by a string are relative paths from workspace root.
        // ex: https://yarnpkg.com/advanced/plugin-tutorial#writing-our-first-plugin
        delete parsed.plugins;
    }
    return stringifySyml(parsed);
}
/**
 * We copy .yarnrc to the temporary directory to ensure things like the specified
 * package registry are still used. However, there are a few relative paths that can
 * cause issues, so we modify them to fit the new directory.
 *
 * Exported for testing - not meant to be used outside of this file.
 *
 * @param contents The string contents of the yarnrc.yml file
 * @returns Updated string contents of the yarnrc.yml file
 */
function modifyYarnRcToFitNewDirectory(contents) {
    const lines = contents.split('\n');
    const yarnPathIndex = lines.findIndex((line) => line.startsWith('yarn-path'));
    if (yarnPathIndex !== -1) {
        lines.splice(yarnPathIndex, 1);
    }
    return lines.join('\n');
}
/**
 * We copy pnpm-workspace.yaml to the temporary directory so the workspace's
 * registry, auth and release-age settings still apply, and so `pnpm add -w`
 * recognizes the directory as a workspace root. `patchedDependencies` (relative
 * patch paths) only resolves in the real workspace, so it is dropped. The
 * `packages` field is always set to a self-reference (`['.']`) - the temp dir is
 * a single-package workspace - whether or not the source had one, since pnpm
 * <10.5 (and corepack's bundled default pnpm) reject a workspace manifest whose
 * `packages` field is missing or empty.
 *
 * Exported for testing - not meant to be used outside of this file.
 *
 * @param contents The string contents of the pnpm-workspace.yaml file
 * @returns Updated string contents of the pnpm-workspace.yaml file
 */
function modifyPnpmWorkspaceYamlToFitNewDirectory(contents) {
    const doc = (0, yaml_1.parseDocument)(contents);
    // Set unconditionally so an empty/comments-only source (null doc.contents)
    // still gets a packages field; doc.set creates the root map.
    doc.set('packages', ['.']);
    // Relative patch paths don't resolve in the temp dir.
    doc.delete('patchedDependencies');
    // link:/file: overrides (e.g. written by `pnpm link`) point at paths that
    // don't exist in the temp dir, and an override would hijack an exact-version
    // add (`pnpm add pkg@x.y.z` would install the linked dir instead).
    const overrides = doc.toJS()?.overrides;
    if (overrides && typeof overrides === 'object') {
        for (const [name, spec] of Object.entries(overrides)) {
            if (typeof spec === 'string' && /^(link|file):/.test(spec)) {
                doc.deleteIn(['overrides', name]);
            }
        }
        if (Object.keys(doc.toJS()?.overrides ?? {}).length === 0) {
            doc.delete('overrides');
        }
    }
    return doc.toString();
}
function copyPackageManagerConfigurationFiles(root, destination) {
    for (const packageManagerConfigFile of [
        '.npmrc',
        '.yarnrc',
        '.yarnrc.yml',
        'bunfig.toml',
        'pnpm-workspace.yaml',
    ]) {
        // f is an absolute path, including the {workspaceRoot}.
        const f = findFileInPackageJsonDirectory(packageManagerConfigFile, root);
        if (f) {
            // Destination should be the same relative path from the {workspaceRoot},
            // but now relative to the destination. `relative` makes `{workspaceRoot}/some/path`
            // look like `./some/path`, and joining that gets us `{destination}/some/path
            const destinationPath = (0, path_1.join)(destination, (0, path_1.relative)(root, f));
            switch (packageManagerConfigFile) {
                case '.npmrc': {
                    (0, fs_1.copyFileSync)(f, destinationPath);
                    break;
                }
                case '.yarnrc': {
                    const updated = modifyYarnRcToFitNewDirectory((0, fileutils_1.readFileIfExisting)(f));
                    (0, fs_1.writeFileSync)(destinationPath, updated);
                    break;
                }
                case '.yarnrc.yml': {
                    const updated = modifyYarnRcYmlToFitNewDirectory((0, fileutils_1.readFileIfExisting)(f));
                    (0, fs_1.writeFileSync)(destinationPath, updated);
                    break;
                }
                case 'bunfig.toml': {
                    (0, fs_1.copyFileSync)(f, destinationPath);
                    break;
                }
                case 'pnpm-workspace.yaml': {
                    const updated = modifyPnpmWorkspaceYamlToFitNewDirectory((0, fileutils_1.readFileIfExisting)(f));
                    (0, fs_1.writeFileSync)(destinationPath, updated);
                    break;
                }
            }
        }
    }
}
/**
 * A non-JS workspace has no root package.json and keeps its package manager
 * files under the Nx installation directory instead.
 */
function getPackageManagerConfigRoot() {
    if ((0, fs_1.existsSync)((0, path_1.join)(workspace_root_1.workspaceRoot, 'package.json'))) {
        return workspace_root_1.workspaceRoot;
    }
    const installationPath = (0, installation_directory_1.getNxInstallationPath)(workspace_root_1.workspaceRoot);
    // The installation directory can be missing or not a directory, and spawning
    // with such a cwd fails outright (ENOENT/ENOTDIR).
    try {
        return (0, fs_1.statSync)(installationPath).isDirectory()
            ? installationPath
            : workspace_root_1.workspaceRoot;
    }
    catch (e) {
        logger_1.logger.verbose(`Failed to stat the Nx installation directory at "${installationPath}".`, e);
        return workspace_root_1.workspaceRoot;
    }
}
/**
 * Creates a temporary directory where you can run package manager commands safely.
 *
 * For cases where you'd want to install packages that require an `.npmrc` set up,
 * this function looks up for the nearest `.npmrc` (if exists) and copies it over to the
 * temp directory.
 *
 * @param skipCopy - If true, skips copying package manager configuration files to the temporary directory.
 *                   This is useful when creating a workspace from scratch (e.g., in create-nx-workspace)
 *                   where no existing configuration files are available to copy.
 */
function createTempNpmDirectory(skipCopy = false) {
    const dir = (0, tmp_1.dirSync)().name;
    // A package.json is needed for pnpm pack and for .npmrc to resolve
    (0, fileutils_1.writeJsonFile)(`${dir}/package.json`, {});
    if (!skipCopy) {
        copyPackageManagerConfigurationFiles(getPackageManagerConfigRoot(), dir);
    }
    const cleanup = async () => {
        try {
            await (0, promises_1.rm)(dir, { recursive: true, force: true });
        }
        catch {
            // It's okay if this fails, the OS will clean it up eventually
        }
    };
    return { dir, cleanup };
}
/**
 * Returns the resolved version for a given package and version tag using the
 * NPM registry (when using Yarn it will fall back to NPM to fetch the info).
 */
async function resolvePackageVersionUsingRegistry(packageName, version) {
    try {
        const resolvedVersion = (0, catalog_1.resolveCatalogReferenceIfNeeded)(packageName, version);
        const result = await packageRegistryView(packageName, resolvedVersion, [
            'version',
        ]);
        if (!result) {
            throw new Error(`Unable to resolve version ${packageName}@${resolvedVersion}.`);
        }
        const lines = result.split('\n');
        if (lines.length === 1) {
            return lines[0];
        }
        /**
         * The output contains multiple lines ordered by release date, so the last
         * version might not be the last one in the list. We need to sort it. Each
         * line looks like:
         *
         * <package>@<version> '<version>'
         */
        const finalResolvedVersion = lines
            .map((line) => line.split(' ')[1])
            .sort()
            .pop()
            .replace(/'/g, '');
        return finalResolvedVersion;
    }
    catch (e) {
        // npm masks a URL credential only in the password position, so a bare token
        // in the registry URL survives into the error kept as the cause.
        throw new Error(`Unable to resolve version ${packageName}@${version}.`, {
            cause: redactErrorCause(e),
        });
    }
}
// Masks the userinfo in a URL: `user`, `user:pass`, or a bare token.
function redactUrlCredentials(text) {
    return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1***@');
}
function redactErrorCause(error) {
    if (error && typeof error === 'object') {
        const e = error;
        // An exec error carries the command and both output streams as fields.
        for (const field of ['message', 'stack', 'stderr', 'stdout', 'cmd']) {
            if (typeof e[field] === 'string') {
                e[field] = redactUrlCredentials(e[field]);
            }
        }
    }
    return error;
}
/**
 * Return the resolved version for a given package and version tag using by
 * installing it in a temporary directory and fetching the version from the
 * package.json.
 */
async function resolvePackageVersionUsingInstallation(packageName, version) {
    const { dir, cleanup } = createTempNpmDirectory();
    try {
        let resolvedVersion = version;
        const manager = (0, catalog_1.getCatalogManager)(workspace_root_1.workspaceRoot);
        if (manager.isCatalogReference(version)) {
            resolvedVersion = manager.resolveCatalogReference(workspace_root_1.workspaceRoot, packageName, version);
            if (!resolvedVersion) {
                throw new Error(`Unable to resolve catalog reference ${packageName}@${version}.`);
            }
        }
        const pmc = getPackageManagerCommand();
        await execAsync(`${pmc.add} ${packageName}@${resolvedVersion}`, {
            cwd: dir,
            windowsHide: true,
        });
        const { packageJson } = (0, package_json_1.readModulePackageJson)(packageName, [dir]);
        return packageJson.version;
    }
    finally {
        await cleanup();
    }
}
/**
 * What every registry-bound npm spawn resolves the same way: where npm runs,
 * and an environment reproducing the workspace package manager's own registry,
 * auth and TLS resolution for `pkg`. `buildEnv` adds the caller's own entries.
 */
function createRegistrySpawnContext(pkg) {
    // Deferred so the registry resolvers load only for the commands that spawn
    // npm, not with every package-manager.ts import.
    const { getNpmSpawnRegistryEnv, getPackageScope, ignoresNpmConfigEnv, mergeNpmConfigEnv, } = require('./registry-config');
    const workspacePm = detectPackageManager();
    const configRoot = getPackageManagerConfigRoot();
    const workspacePmVersion = getPackageManagerVersionSafe(workspacePm, configRoot);
    return {
        workspacePm,
        workspacePmVersion,
        configRoot,
        scope: getPackageScope(pkg),
        buildEnv: (extra) => mergeNpmConfigEnv(process.env, {
            ...getNpmSpawnRegistryEnv(pkg, configRoot, workspacePm, workspacePmVersion),
            ...extra,
        }, ignoresNpmConfigEnv(workspacePm, workspacePmVersion)),
    };
}
/**
 * The registry the fetch for `pkg` went to, with its userinfo masked because a
 * registry URL can carry a bare token. The lookup is spawned the way
 * `packageRegistryView` spawns the fetch this describes (same manager, same
 * environment), so a registry the package manager keeps outside the .npmrc
 * chain and a scope resolved for itself both land on the value that fetch used.
 * Null where the manager yields no usable registry URL; throws where it cannot be run.
 */
function getWorkspaceRegistryUrlForDisplay(pkg) {
    const { workspacePm, workspacePmVersion, configRoot, scope, buildEnv } = createRegistrySpawnContext(pkg);
    const { pm, env, usesNativePnpm } = resolveRegistrySpawnTarget(workspacePm, workspacePmVersion, buildEnv);
    // Ask for the package scope first. Native pnpm can keep the workspace
    // `registries.default` separate from the flat `registry`, so it is queried
    // in between.
    const keys = scope ? [`${scope}:registry`] : [];
    if (usesNativePnpm) {
        keys.push('registries.default');
    }
    keys.push('registry');
    for (const key of keys) {
        const value = execPackageManagerSync(pm, ['config', 'get', key], {
            cwd: configRoot,
            timeout: 5000,
            windowsHide: true,
            encoding: 'utf-8',
            // The downgraded pin warns on stderr, which is noise on a path that only
            // decorates an error message.
            stdio: ['ignore', 'pipe', 'ignore'],
            env,
        }).trim();
        if (!value || value === 'undefined' || value === 'null') {
            continue;
        }
        // A present but unusable answer (a `registries:` map with a non-string
        // default serializes as JSON; a non-HTTP(S) scheme) also aborted the fetch
        // this describes, so a key below it was never contacted either.
        if (!URL.canParse(value)) {
            return null;
        }
        const protocol = new URL(value).protocol;
        if (protocol !== 'http:' && protocol !== 'https:') {
            return null;
        }
        return redactUrlCredentials(value);
    }
    return null;
}
/**
 * Which manager answers a registry read for this workspace, and the environment
 * it reads under. pnpm 11 reimplemented `view` natively, resolving registry and
 * credentials (tokenHelper included) itself, so it runs on the untouched
 * environment; pnpm 10 passed `view` through to the npm CLI, which needs the
 * overlay. Shared so a lookup describing a fetch cannot resolve against a
 * different environment than the fetch used.
 */
function resolveRegistrySpawnTarget(workspacePm, workspacePmVersion, buildEnv, options) {
    let pm = workspacePm;
    if (options?.forceNpm || pm === 'yarn' || pm === 'bun') {
        /**
         * yarn has `yarn info` but it behaves differently than (p)npm,
         * which makes it's usage unreliable
         *
         * @see https://github.com/nrwl/nx/pull/9667#discussion_r842553994
         *
         * Bun has a pm ls function but it only relates to its lockfile
         * and acts differently from all other package managers
         * from Jarred: "it probably would be bun pm view <package-name>"
         */
        pm = 'npm';
    }
    if (pm === 'pnpm' && ((0, semver_1.parse)(workspacePmVersion)?.major ?? 0) >= 11) {
        return { pm, env: process.env, usesNativePnpm: true };
    }
    // npm_config_force downgrades npm's `devEngines.packageManager` enforcement,
    // which otherwise aborts even a read-only lookup when the pin sets
    // `onFail: error`. Only set for npm so a pnpm spawn is untouched.
    return {
        pm,
        env: buildEnv(pm === 'npm' ? { npm_config_force: 'true' } : {}),
        usesNativePnpm: false,
    };
}
async function packageRegistryView(pkg, version, args, 
// `forceNpm` runs the view through npm even in a pnpm workspace: npm projects
// a field across every matched version, whereas `pnpm view <pkg>@<range>`
// collapses to the single highest match (breaks per-version field queries).
options) {
    const { workspacePm, workspacePmVersion, configRoot, buildEnv } = createRegistrySpawnContext(pkg);
    const { pm, env } = resolveRegistrySpawnTarget(workspacePm, workspacePmVersion, buildEnv, options);
    // An empty version means we want the full packument; omit the trailing `@`.
    const spec = version ? `${pkg}@${version}` : pkg;
    try {
        const { stdout } = await execPackageManagerAsync(pm, ['view', spec, ...args], {
            windowsHide: true,
            cwd: configRoot,
            env,
        });
        return stdout.toString().trim();
    }
    catch (e) {
        throw redactErrorCause(e);
    }
}
/**
 * Only `npm pack` supports downloading a tarball of a specified remote
 * package. `yarn` packs the active workspace, `pnpm pack` only packs
 * the local project, and `bun` doesn't support pack.
 *
 * @param packDestination Directory passed to npm's `--pack-destination`, where
 * the `.tgz` is written.
 * @see https://github.com/nrwl/nx/pull/9667#discussion_r842553994
 */
async function packageRegistryPack(packDestination, pkg, version, options) {
    const pm = 'npm';
    const { configRoot, buildEnv } = createRegistrySpawnContext(pkg);
    // Run from the config root, not the temp dir, so npm reads the workspace
    // .npmrc natively; --pack-destination still writes the tarball to the temp
    // dir. npm prints the tarball basename to stdout.
    try {
        const { stdout } = await execPackageManagerAsync(pm, ['pack', `${pkg}@${version}`, '--pack-destination', packDestination], {
            cwd: configRoot,
            windowsHide: true,
            env: buildEnv({
                // downgrade npm's devEngines.packageManager enforcement (onFail:
                // error) to a warning so pack still runs in a non-npm workspace
                npm_config_force: 'true',
                ...(options?.bypassMinReleaseAge
                    ? { npm_config_min_release_age: '0' }
                    : {}),
            }),
        });
        const tarballPath = stdout.trim();
        return { tarballPath };
    }
    catch (e) {
        throw redactErrorCause(e);
    }
}
// The version probe shells out when the packageManager field is absent, and
// packageRegistryView/packageRegistryPack run in tight resolution loops.
const packageManagerVersionCache = new Map();
/**
 * A null version is tolerated per package manager: pnpm and yarn skip bridging,
 * bun assumes a current version.
 */
function getPackageManagerVersionSafe(packageManager, root) {
    const key = `${packageManager}:${root}`;
    if (!packageManagerVersionCache.has(key)) {
        let version = null;
        try {
            version = getPackageManagerVersion(packageManager, root);
        }
        catch (e) {
            logger_1.logger.verbose(`Failed to determine the ${packageManager} version in "${root}".`, e);
        }
        packageManagerVersionCache.set(key, version);
    }
    return packageManagerVersionCache.get(key);
}
// Test-only: production never re-resolves a version mid-run.
function clearPackageManagerVersionCache() {
    packageManagerVersionCache.clear();
}
/**
 * Gets the workspaces defined in the package manager configuration.
 * @returns workspaces defined in the package manager configuration, empty array if none are defined
 */
function getPackageWorkspaces(packageManager = detectPackageManager(), root = workspace_root_1.workspaceRoot) {
    let workspaces;
    if (packageManager === 'npm' ||
        packageManager === 'yarn' ||
        packageManager === 'bun') {
        const packageJson = (0, file_utils_1.readPackageJson)(root);
        workspaces = packageJson.workspaces;
    }
    else if (packageManager === 'pnpm') {
        const pnpmWorkspacePath = (0, path_1.join)(root, 'pnpm-workspace.yaml');
        if ((0, fs_1.existsSync)(pnpmWorkspacePath)) {
            const { packages } = (0, fileutils_1.readYamlFile)(pnpmWorkspacePath) ?? {};
            workspaces = packages;
        }
    }
    return workspaces ?? [];
}
/**
 * Adds a package to the workspaces defined in the package manager configuration.
 * If the package is already included in the workspaces, it will not be added again.
 * @param packageManager The package manager to use. If not provided, it will be detected based on the lock file.
 * @param workspaces The workspaces to add the package to. Defaults to the workspaces defined in the package manager configuration.
 * @param root The directory the commands will be ran inside of. Defaults to the current workspace's root.
 * @param packagePath The path of the package to add to the workspaces
 */
function addPackagePathToWorkspaces(packagePath, packageManager = detectPackageManager(), workspaces = getPackageWorkspaces(packageManager), root = workspace_root_1.workspaceRoot) {
    if (packageManager === 'npm' ||
        packageManager === 'yarn' ||
        packageManager === 'bun') {
        workspaces.push(packagePath);
        const packageJson = (0, file_utils_1.readPackageJson)(root);
        const updatedPackageJson = {
            ...packageJson,
            workspaces,
        };
        const packageJsonPath = (0, path_1.join)(root, 'package.json');
        (0, fileutils_1.writeJsonFile)(packageJsonPath, updatedPackageJson);
    }
    else if (packageManager === 'pnpm') {
        const pnpmWorkspacePath = (0, path_1.join)(root, 'pnpm-workspace.yaml');
        if ((0, fs_1.existsSync)(pnpmWorkspacePath)) {
            const pnpmWorkspaceDocument = (0, yaml_1.parseDocument)((0, fileutils_1.readFileIfExisting)(pnpmWorkspacePath));
            const pnpmWorkspaceContents = pnpmWorkspaceDocument.contents;
            if (!pnpmWorkspaceContents) {
                (0, fs_1.writeFileSync)(pnpmWorkspacePath, (0, yaml_1.stringify)({
                    packages: [packagePath],
                }));
            }
            else if (pnpmWorkspaceContents instanceof yaml_1.YAMLMap) {
                const packages = pnpmWorkspaceContents.items.find((item) => {
                    return item.key instanceof yaml_1.Scalar
                        ? item.key?.value === 'packages'
                        : item.key === 'packages';
                });
                if (packages) {
                    if (packages.value instanceof yaml_1.YAMLSeq === false) {
                        packages.value = new yaml_1.YAMLSeq();
                    }
                    packages.value.items ??= [];
                    packages.value.items.push(packagePath);
                }
                else {
                    // if the 'packages' key doesn't exist, create it
                    const packagesSeq = new yaml_1.YAMLSeq();
                    packagesSeq.items ??= [];
                    packagesSeq.items.push(packagePath);
                    pnpmWorkspaceDocument.add(pnpmWorkspaceDocument.createPair('packages', packagesSeq));
                }
                (0, fs_1.writeFileSync)(pnpmWorkspacePath, (0, yaml_1.stringify)(pnpmWorkspaceContents));
            }
        }
        else {
            // If the file doesn't exist, create it
            (0, fs_1.writeFileSync)(pnpmWorkspacePath, (0, yaml_1.stringify)({
                packages: [packagePath],
            }));
        }
    }
}
