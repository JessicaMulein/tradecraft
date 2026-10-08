"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveUserExistingPrettierConfig = resolveUserExistingPrettierConfig;
exports.generatePrettierSetup = generatePrettierSetup;
exports.resolvePrettierConfigPath = resolvePrettierConfigPath;
const devkit_1 = require("@nx/devkit");
const internal_1 = require("@nx/devkit/internal");
const nx_formatter_internals_1 = require("./nx-formatter-internals");
const versions_1 = require("./versions");
// Prettier v3 (ESM) exposes its API as named exports; v2 (CJS) exposes it under
// `.default` when loaded via `import()`. Return whichever carries the API, or
// null if prettier isn't installed.
async function importPrettier() {
    try {
        const imported = await import('prettier');
        return (imported.resolveConfig ? imported : imported.default);
    }
    catch {
        return null;
    }
}
async function resolveUserExistingPrettierConfig() {
    const prettier = await importPrettier();
    if (!prettier) {
        return null;
    }
    try {
        const filepath = await prettier.resolveConfigFile();
        if (!filepath) {
            return null;
        }
        const config = await prettier.resolveConfig(process.cwd(), {
            useCache: false,
            config: filepath,
        });
        if (!config) {
            return null;
        }
        return {
            sourceFilepath: filepath,
            config: config,
        };
    }
    catch {
        return null;
    }
}
function generatePrettierSetup(tree, options) {
    (0, nx_formatter_internals_1.assertNxSupportsFormatters)();
    // Imported rather than copied: detection and setup have to agree on this
    // list, or a workspace whose config format is missing from one side gets a
    // second, redundant `.prettierrc` written beside the one it already has.
    if (internal_1.prettierConfigFiles.every((name) => !tree.exists(name))) {
        (0, devkit_1.writeJson)(tree, '.prettierrc', { singleQuote: true });
    }
    if (!tree.exists('.prettierignore')) {
        tree.write('.prettierignore', (0, devkit_1.stripIndents) `# Add files here to ignore them from prettier formatting
        /dist
        /coverage
        /.nx/cache
        /.nx/workspace-data
        ${(0, internal_1.getLockFileName)((0, devkit_1.detectPackageManager)(tree.root))}
      `);
    }
    if (tree.exists('.vscode/extensions.json')) {
        (0, devkit_1.updateJson)(tree, '.vscode/extensions.json', (json) => {
            json.recommendations ??= [];
            const extension = 'esbenp.prettier-vscode';
            if (!json.recommendations.includes(extension)) {
                json.recommendations.push(extension);
            }
            return json;
        });
    }
    return options.skipPackageJson
        ? () => { }
        : (0, devkit_1.addDependenciesToPackageJson)(tree, {}, { prettier: versions_1.prettierVersion });
}
async function resolvePrettierConfigPath(tree) {
    (0, nx_formatter_internals_1.assertNxSupportsFormatters)();
    const prettier = await importPrettier();
    if (!prettier) {
        return null;
    }
    const configFilePath = await prettier.resolveConfigFile();
    if (configFilePath) {
        return configFilePath;
    }
    if (!tree) {
        return null;
    }
    // Same shared list as the setup above, so a config this can't see is one the
    // setup would overwrite. The copy this replaced was missing the `.ts`,
    // `.mts` and `.cts` forms.
    // https://prettier.io/docs/configuration
    const filePath = internal_1.prettierConfigFiles.find((file) => tree.exists(file));
    if (filePath) {
        return filePath;
    }
    // check the package.json file
    const packageJson = (0, devkit_1.readJson)(tree, 'package.json');
    if (packageJson.prettier) {
        return 'package.json';
    }
    // check the package.yaml file
    if (tree.exists('package.yaml')) {
        const { load } = await import('@zkochan/js-yaml');
        const packageYaml = load(tree.read('package.yaml', 'utf-8'));
        if (packageYaml.prettier) {
            return 'package.yaml';
        }
    }
    return null;
}
