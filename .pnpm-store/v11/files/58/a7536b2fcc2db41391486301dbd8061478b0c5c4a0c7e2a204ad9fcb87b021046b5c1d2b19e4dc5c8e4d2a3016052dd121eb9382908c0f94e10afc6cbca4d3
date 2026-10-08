"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renameLegacyEslintrcFile = renameLegacyEslintrcFile;
exports.convertEslintJsonToFlatConfig = convertEslintJsonToFlatConfig;
const tslib_1 = require("tslib");
const devkit_1 = require("@nx/devkit");
const ts = tslib_1.__importStar(require("typescript"));
const ast_utils_1 = require("../../utils/flat-config/ast-utils");
const eslint_file_1 = require("../../utils/eslint-file");
const path_utils_1 = require("../../utils/flat-config/path-utils");
// Rewrites legacy `.eslintrc[.base][.json]` / `.eslintignore` filenames to their flat-config
// counterparts. Used for `extends` local paths, rule option values that embed these filenames,
// and nx.json / project.json input globs that referenced the deleted files. Accepts
// extensionless `.eslintrc` since ESLint treats that as JSON by convention.
function renameLegacyEslintrcFile(path, format) {
    return path
        .replace(/(^|.*?)\.eslintrc(\.base)?(\.json)?$/, `$1eslint$2.config.${format}`)
        .replace(/(^|.*?)\.eslintignore$/, `$1eslint.config.${format}`);
}
// In flat config, `@nx/workspace/<rule>` is parsed as plugin `@nx/workspace`, rule `<rule>`.
// The `@nx` plugin already exposes workspace rules under both `workspace/<rule>` and `workspace-<rule>` keys.
// Rewriting to `@nx/workspace-<rule>` makes ESLint resolve them via the already-registered `@nx` plugin.
function renameLegacyWorkspaceRules(rules) {
    const renamed = {};
    for (const [key, value] of Object.entries(rules)) {
        const newKey = key.startsWith('@nx/workspace/')
            ? '@nx/workspace-' + key.slice('@nx/workspace/'.length)
            : key;
        renamed[newKey] = value;
    }
    return renamed;
}
// Rewrites references to the legacy `.eslintrc[.base].json` / `.eslintignore` that may appear
// inside rule option values (e.g. `@nx/dependency-checks`'s `ignoredFiles`) to point at the
// generated flat-config files instead. Without this, rule options keep pointing at files that
// no longer exist after the conversion.
function rewriteStaleEslintrcRefs(value, format) {
    if (typeof value === 'string') {
        return renameLegacyEslintrcFile(value, format);
    }
    if (Array.isArray(value)) {
        const mapped = value.map((v) => rewriteStaleEslintrcRefs(v, format));
        // Rewriting may collapse distinct strings (e.g. `.eslintrc.json` and
        // `.eslintrc.base.json`) into identical entries; dedupe string arrays.
        if (mapped.every((v) => typeof v === 'string')) {
            return Array.from(new Set(mapped));
        }
        return mapped;
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = rewriteStaleEslintrcRefs(v, format);
        }
        return out;
    }
    return value;
}
function preprocessRules(rules, format) {
    return rewriteStaleEslintrcRefs(renameLegacyWorkspaceRules(rules), format);
}
/**
 * Converts an ESLint JSON config to a flat config.
 * Deletes the original file along with .eslintignore if it exists.
 */
function convertEslintJsonToFlatConfig(tree, root, config, ignorePaths, format) {
    const importsMap = new Map();
    const exportElements = [];
    let isFlatCompatNeeded = false;
    let isESLintJSNeeded = false;
    let combinedConfig = [];
    let languageOptions = [];
    if (config.rules) {
        config.rules = preprocessRules(config.rules, format);
    }
    if (config.overrides) {
        config.overrides = config.overrides.map((override) => override.rules
            ? {
                ...override,
                rules: preprocessRules(override.rules, format),
            }
            : override);
    }
    if (config.extends) {
        const extendsResult = addExtends(importsMap, exportElements, config, format);
        isFlatCompatNeeded = extendsResult.isFlatCompatNeeded;
        isESLintJSNeeded = extendsResult.isESLintJSNeeded;
    }
    if (config.plugins) {
        addPlugins(importsMap, exportElements, config);
    }
    if (config.parser) {
        const imp = config.parser;
        const parserName = (0, devkit_1.names)(imp).propertyName;
        importsMap.set(imp, parserName);
        languageOptions.push(ts.factory.createPropertyAssignment('parser', ts.factory.createIdentifier(parserName)));
    }
    if (config.parserOptions) {
        languageOptions.push(ts.factory.createPropertyAssignment('parserOptions', (0, ast_utils_1.generateAst)(config.parserOptions)));
    }
    if (config.globals || config.env) {
        if (config.env) {
            importsMap.set('globals', 'globals');
        }
        languageOptions.push(ts.factory.createPropertyAssignment('globals', ts.factory.createObjectLiteralExpression([
            ...Object.keys(config.env || {}).map((env) => ts.factory.createSpreadAssignment(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('globals'), ts.factory.createIdentifier(env)))),
            ...Object.keys(config.globals || {}).map((key) => ts.factory.createPropertyAssignment(key, (0, ast_utils_1.generateAst)(config.globals[key]))),
        ])));
    }
    if (config.settings) {
        combinedConfig.push(ts.factory.createPropertyAssignment('settings', (0, ast_utils_1.generateAst)(config.settings)));
    }
    if (config.noInlineConfig !== undefined ||
        config.reportUnusedDisableDirectives !== undefined) {
        combinedConfig.push(ts.factory.createPropertyAssignment('linterOptions', (0, ast_utils_1.generateAst)({
            noInlineConfig: config.noInlineConfig,
            reportUnusedDisableDirectives: config.reportUnusedDisableDirectives,
        })));
    }
    if (languageOptions.length > 0) {
        combinedConfig.push(ts.factory.createPropertyAssignment('languageOptions', ts.factory.createObjectLiteralExpression(languageOptions, languageOptions.length > 1)));
    }
    if (combinedConfig.length > 0) {
        exportElements.push(ts.factory.createObjectLiteralExpression(combinedConfig, combinedConfig.length > 1));
    }
    if (config.rules) {
        exportElements.push((0, ast_utils_1.generateAst)({ rules: config.rules }));
    }
    if (config.overrides) {
        config.overrides.forEach((override) => {
            if (override.extends) {
                const extendsArr = Array.isArray(override.extends)
                    ? override.extends
                    : [override.extends];
                const mapped = extendsArr.map((e) => ({
                    original: e,
                    flatConfig: mapNxPluginToFlatConfig(e),
                }));
                const nxExtends = mapped.filter((m) => m.flatConfig);
                const nonNxExtends = mapped
                    .filter((m) => !m.flatConfig)
                    .map((m) => m.original);
                if (nxExtends.length > 0) {
                    const nxVar = importsMap.get('@nx/eslint-plugin') ?? 'nx';
                    importsMap.set('@nx/eslint-plugin', nxVar);
                    nxExtends.forEach((ext) => {
                        exportElements.push((0, ast_utils_1.generateFlatPredefinedConfig)(ext.flatConfig, nxVar, true));
                    });
                    // Build remaining override without Nx extends
                    const remainingOverride = { ...override };
                    if (nonNxExtends.length > 0) {
                        remainingOverride.extends = nonNxExtends;
                    }
                    else {
                        delete remainingOverride.extends;
                    }
                    // Emit remaining override if it has content beyond files and empty rules
                    const { files: _files, rules: remainingRules, ...remainingRest } = remainingOverride;
                    const hasNonEmptyRules = remainingRules && Object.keys(remainingRules).length > 0;
                    if (Object.keys(remainingRest).length > 0 || hasNonEmptyRules) {
                        if (remainingOverride.env ||
                            remainingOverride.extends ||
                            remainingOverride.plugins) {
                            isFlatCompatNeeded = true;
                        }
                        exportElements.push((0, ast_utils_1.generateFlatOverride)(remainingOverride, format, importsMap));
                    }
                    return;
                }
            }
            if (override.env || override.extends || override.plugins) {
                isFlatCompatNeeded = true;
            }
            exportElements.push((0, ast_utils_1.generateFlatOverride)(override, format, importsMap));
        });
    }
    if (config.ignorePatterns) {
        const patterns = (Array.isArray(config.ignorePatterns)
            ? config.ignorePatterns
            : [config.ignorePatterns]).filter((pattern) => 
        // Drop patterns that are meaningless in flat config. `'**/*'` and
        // `'!**/*'` were eslintrc cascading toggles; `node_modules` is already
        // ignored by default. Real negations like `['dist/**', '!dist/keep.js']`
        // are preserved — flat config still supports un-ignoring within a
        // broader ignores block.
        !['**/*', '!**/*', 'node_modules'].includes(pattern));
        if (patterns.length > 0) {
            exportElements.push((0, ast_utils_1.generateAst)({
                ignores: patterns.map((path) => (0, path_utils_1.mapFilePath)(path)),
            }));
        }
    }
    for (const ignorePath of ignorePaths) {
        if (tree.exists(ignorePath)) {
            const patterns = tree
                .read(ignorePath, 'utf-8')
                .split(/\r\n|\r|\n/)
                .filter((line) => line.length > 0 && line !== 'node_modules')
                .map((path) => (0, path_utils_1.mapFilePath)(path));
            if (patterns.length > 0) {
                exportElements.push((0, ast_utils_1.generateAst)({ ignores: patterns }));
            }
        }
    }
    // create the node list and print it to new file
    const nodeList = (0, ast_utils_1.createNodeList)(importsMap, exportElements, format);
    let content = (0, ast_utils_1.stringifyNodeList)(nodeList);
    if (isFlatCompatNeeded) {
        content = (0, ast_utils_1.addFlatCompatToFlatConfig)(content);
    }
    return {
        content,
        addESLintRC: isFlatCompatNeeded,
        addESLintJS: isESLintJSNeeded,
    };
}
// add parsed extends to export blocks and add import statements
function addExtends(importsMap, configBlocks, config, format) {
    let isFlatCompatNeeded = false;
    let isESLintJSNeeded = false;
    const extendsConfig = Array.isArray(config.extends)
        ? config.extends
        : [config.extends];
    const eslintrcConfigs = [];
    // add base extends
    extendsConfig
        .filter((imp) => imp.match(/^\.?(\.\/)/))
        .forEach((imp, index) => {
        if (imp.match(/\.eslintrc(\.base)?(\.json)?$/)) {
            const localName = index ? `baseConfig${index}` : 'baseConfig';
            configBlocks.push((0, ast_utils_1.generateSpreadElement)(localName));
            importsMap.set(renameLegacyEslintrcFile(imp, format), localName);
        }
        else {
            eslintrcConfigs.push(imp);
        }
    });
    // add plugin extends
    const pluginExtends = extendsConfig.filter((imp) => !imp.match(/^\.?(\.\/)/));
    if (pluginExtends.length) {
        const eslintPluginExtends = pluginExtends.filter((imp) => imp.startsWith('eslint:'));
        pluginExtends.forEach((imp) => {
            if (imp.startsWith('eslint:')) {
                return;
            }
            const nxFlatConfig = mapNxPluginToFlatConfig(imp);
            if (nxFlatConfig) {
                const nxVar = importsMap.get('@nx/eslint-plugin') ?? 'nx';
                importsMap.set('@nx/eslint-plugin', nxVar);
                configBlocks.push((0, ast_utils_1.generateFlatPredefinedConfig)(nxFlatConfig, nxVar, true));
            }
            else {
                eslintrcConfigs.push(imp);
            }
        });
        if (eslintPluginExtends.length) {
            isESLintJSNeeded = true;
            importsMap.set('@eslint/js', 'js');
            eslintPluginExtends.forEach((plugin) => {
                configBlocks.push(ts.factory.createPropertyAccessExpression(ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier('js'), ts.factory.createIdentifier('configs')), ts.factory.createIdentifier(plugin.slice(7)) // strip 'eslint:' prefix
                ));
            });
        }
    }
    if (eslintrcConfigs.length) {
        isFlatCompatNeeded = true;
        isESLintJSNeeded = true;
        configBlocks.push((0, ast_utils_1.generatePluginExtendsElement)(eslintrcConfigs));
    }
    return { isFlatCompatNeeded, isESLintJSNeeded };
}
function addPlugins(importsMap, configBlocks, config) {
    // Replace @nx plugin with flat/base predefined config to match fresh generation.
    // flat/base registers the @nx plugin and ignores .nx directory.
    // This runs before overrides are processed, so we set the import name here
    // for Nx extends that may appear in overrides later.
    if (config.plugins.includes('@nx')) {
        importsMap.set('@nx/eslint-plugin', 'nx');
        configBlocks.push((0, ast_utils_1.generateFlatPredefinedConfig)('flat/base', 'nx', true));
    }
    const remainingPlugins = config.plugins.filter((name) => name !== '@nx');
    if (remainingPlugins.length === 0) {
        return;
    }
    const mappedPlugins = [];
    remainingPlugins.forEach((name) => {
        const imp = (0, eslint_file_1.getPluginImport)(name);
        const varName = importsMap.get(imp) ?? (0, devkit_1.names)(imp).propertyName;
        mappedPlugins.push({ name, varName, imp });
    });
    mappedPlugins.forEach(({ varName, imp }) => {
        importsMap.set(imp, varName);
    });
    const pluginsAst = ts.factory.createObjectLiteralExpression([
        ts.factory.createPropertyAssignment('plugins', ts.factory.createObjectLiteralExpression(mappedPlugins.map(({ name, varName }) => {
            return ts.factory.createPropertyAssignment(ts.factory.createStringLiteral(name), ts.factory.createIdentifier(varName));
        }), mappedPlugins.length > 1)),
        ...(config.processor
            ? [
                ts.factory.createPropertyAssignment('processor', ts.factory.createStringLiteral(config.processor)),
            ]
            : []),
    ], false);
    configBlocks.push(pluginsAst);
}
const nxPluginToFlatConfigMap = {
    'plugin:@nx/typescript': 'flat/typescript',
    'plugin:@nx/javascript': 'flat/javascript',
    'plugin:@nx/react': 'flat/react',
    'plugin:@nx/react-base': 'flat/react-base',
    'plugin:@nx/react-typescript': 'flat/react-typescript',
    'plugin:@nx/react-jsx': 'flat/react-jsx',
    'plugin:@nx/angular': 'flat/angular',
    'plugin:@nx/angular-template': 'flat/angular-template',
    'plugin:@nrwl/nx/typescript': 'flat/typescript',
    'plugin:@nrwl/nx/javascript': 'flat/javascript',
};
function mapNxPluginToFlatConfig(pluginExtend) {
    return nxPluginToFlatConfigMap[pluginExtend];
}
