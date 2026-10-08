"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findEslintFile = findEslintFile;
exports.isEslintConfigSupported = isEslintConfigSupported;
exports.updateRelativePathsInConfig = updateRelativePathsInConfig;
exports.determineEslintConfigFormat = determineEslintConfigFormat;
exports.isTypedLintingEnabled = isTypedLintingEnabled;
exports.inspectTypedLinting = inspectTypedLinting;
exports.addTypedLintingToFlatConfig = addTypedLintingToFlatConfig;
exports.addOverrideToLintConfig = addOverrideToLintConfig;
exports.updateOverrideInLintConfig = updateOverrideInLintConfig;
exports.lintConfigHasOverride = lintConfigHasOverride;
exports.replaceOverridesInLintConfig = replaceOverridesInLintConfig;
exports.addExtendsToLintConfig = addExtendsToLintConfig;
exports.addPredefinedConfigToFlatLintConfig = addPredefinedConfigToFlatLintConfig;
exports.addPluginsToLintConfig = addPluginsToLintConfig;
exports.addIgnoresToLintConfig = addIgnoresToLintConfig;
exports.getPluginImport = getPluginImport;
const devkit_1 = require("@nx/devkit");
const config_file_1 = require("../../utils/config-file");
const flat_config_1 = require("../../utils/flat-config");
const versions_1 = require("../../utils/versions");
const ast_utils_1 = require("./flat-config/ast-utils");
const path_utils_1 = require("./flat-config/path-utils");
const ts = require("typescript");
const posix_1 = require("node:path/posix");
function findEslintFile(tree, projectRoot) {
    if (projectRoot === undefined) {
        for (const file of [
            config_file_1.baseEsLintConfigFile,
            ...config_file_1.BASE_ESLINT_CONFIG_FILENAMES,
        ]) {
            if (tree.exists(file)) {
                return file;
            }
        }
    }
    projectRoot ??= '';
    for (const file of config_file_1.ESLINT_CONFIG_FILENAMES) {
        if (tree.exists((0, devkit_1.joinPathFragments)(projectRoot, file))) {
            return file;
        }
    }
    return null;
}
function isEslintConfigSupported(tree, projectRoot = '') {
    const eslintFile = findEslintFile(tree, projectRoot);
    if (!eslintFile) {
        return false;
    }
    return (eslintFile.endsWith('.json') ||
        eslintFile.endsWith('.config.js') ||
        eslintFile.endsWith('.config.cjs') ||
        eslintFile.endsWith('.config.mjs'));
}
function updateRelativePathsInConfig(tree, sourcePath, destinationPath) {
    if (sourcePath === destinationPath ||
        !isEslintConfigSupported(tree, destinationPath)) {
        return;
    }
    const configPath = (0, devkit_1.joinPathFragments)(destinationPath, findEslintFile(tree, destinationPath));
    const offset = (0, devkit_1.offsetFromRoot)(destinationPath);
    if ((0, flat_config_1.useFlatConfig)(tree)) {
        const config = tree.read(configPath, 'utf-8');
        tree.write(configPath, replaceFlatConfigPaths(config, sourcePath, offset, destinationPath, tree));
    }
    else {
        (0, devkit_1.updateJson)(tree, configPath, (json) => {
            if (typeof json.extends === 'string') {
                json.extends = offsetFilePath(sourcePath, json.extends, offset, tree);
            }
            else if (json.extends) {
                json.extends = json.extends.map((extend) => offsetFilePath(sourcePath, extend, offset, tree));
            }
            json.overrides?.forEach((o) => {
                if (o.parserOptions?.project) {
                    o.parserOptions.project = Array.isArray(o.parserOptions.project)
                        ? o.parserOptions.project.map((p) => p.replace(sourcePath, destinationPath))
                        : o.parserOptions.project.replace(sourcePath, destinationPath);
                }
            });
            return json;
        });
    }
}
function replaceFlatConfigPaths(config, sourceRoot, offset, destinationRoot, tree) {
    let match;
    let newConfig = config;
    // replace requires
    const requireRegex = RegExp(/require\(['"](.*)['"]\)/g);
    while ((match = requireRegex.exec(newConfig)) !== null) {
        const newPath = offsetFilePath(sourceRoot, match[1], offset, tree);
        newConfig =
            newConfig.slice(0, match.index) +
                `require('${newPath}')` +
                newConfig.slice(match.index + match[0].length);
    }
    // Handle import statements
    const importRegex = RegExp(/import\s+.*?\s+from\s+['"](.*)['"]/g);
    while ((match = importRegex.exec(newConfig)) !== null) {
        const oldPath = match[1];
        const newPath = offsetFilePath(sourceRoot, oldPath, offset, tree);
        // Replace the old path with the updated path
        newConfig =
            newConfig.slice(0, match.index + match[0].indexOf(oldPath)) +
                newPath +
                newConfig.slice(match.index + match[0].indexOf(oldPath) + oldPath.length);
    }
    // replace projects
    const projectRegex = RegExp(/project:\s?\[?['"](.*)['"]\]?/g);
    while ((match = projectRegex.exec(newConfig)) !== null) {
        const newProjectDef = match[0].replaceAll(sourceRoot, destinationRoot);
        newConfig =
            newConfig.slice(0, match.index) +
                newProjectDef +
                newConfig.slice(match.index + match[0].length);
    }
    return newConfig;
}
function offsetFilePath(projectRoot, pathToFile, offset, tree) {
    if (config_file_1.ESLINT_CONFIG_FILENAMES.some((eslintFile) => pathToFile.includes(eslintFile))) {
        // if the file is point to base eslint
        const rootEslint = findEslintFile(tree);
        if (rootEslint) {
            return (0, devkit_1.joinPathFragments)(offset, rootEslint);
        }
    }
    if (!pathToFile.startsWith('..')) {
        // not a relative path
        return pathToFile;
    }
    return (0, devkit_1.joinPathFragments)(offset, projectRoot, pathToFile);
}
/**
 * The module system a flat config file actually runs under. `.cts` and `.mts`
 * fix it by extension, so the content is only a signal for the ambiguous ones
 * (`.js`, `.ts`). Trusting content alone reads an idiomatic `export default` in
 * a `.cts` as ESM and emits an `import.meta` its CommonJS output rejects.
 */
function determineEslintConfigFormatForFile(fileName, content) {
    const extension = (0, posix_1.extname)(fileName);
    if (extension === '.mjs' || extension === '.mts') {
        return 'mjs';
    }
    if (extension === '.cjs' || extension === '.cts') {
        return 'cjs';
    }
    return determineEslintConfigFormat(content);
}
function determineEslintConfigFormat(content) {
    const sourceFile = ts.createSourceFile('', content, ts.ScriptTarget.Latest, true);
    return (0, ast_utils_1.isEsmExport)(sourceFile) ? 'mjs' : 'cjs';
}
/**
 * Honors both `enableTypedLinting` and the deprecated `setParserOptionsProject`
 * (slated for removal in Nx v24); either one truthy enables typed linting. A
 * generator whose `enableTypedLinting` schema default is `false` must still
 * honor a user who set the deprecated flag.
 */
function isTypedLintingEnabled(options) {
    return !!(options.enableTypedLinting || options.setParserOptionsProject);
}
/**
 * What a config says about typed linting.
 *
 * Only keys inside a `parserOptions` object count, so an unrelated `project`
 * (e.g. `settings['import/resolver'].typescript.project`) is not a false match.
 * A local array the config spreads in is read too, since ESLint merges those
 * entries in as if they were inline.
 */
function inspectTypedLinting(content) {
    const readings = findParserOptions(content);
    const blocks = readings.filter(isReadParserOptions);
    const own = blocks.some((block) => block.projectService !== 'absent' || block.enablesProject);
    return {
        own,
        projectService: blocks.some((block) => block.projectService === 'enabled'),
        project: blocks.some((block) => block.enablesProject),
        // A local `parserOptions` set through an expression we can't read leaves
        // typed linting undecided: appending would risk converting a `project`
        // setup to the project service, so callers warn and skip. A definite setting
        // (own) already decides the outcome, so it takes precedence.
        uncertain: !own && readings.some((reading) => reading === UNREADABLE),
    };
}
/**
 * A `parserOptions` present in a config position whose value can't be read
 * statically. It carries no settings, so it can't be a `ParserOptions`; it marks
 * the result undecided rather than reading as no typed linting.
 */
const UNREADABLE = 'unreadable';
function isReadParserOptions(reading) {
    return reading !== UNREADABLE;
}
/**
 * A legacy config can be JSON, JS or YAML, and a bare `.eslintrc` can be any of
 * them, so each parser is tried in turn rather than picked from the filename.
 * YAML goes last: a one-line JS config can parse as YAML into a mapping keyed on
 * the whole line, which would otherwise preempt the parser that understands it.
 */
function findParserOptions(content) {
    const eslintrc = tryParseJson(content);
    if (eslintrc) {
        return findParserOptionsInJson(eslintrc);
    }
    const blocks = findParserOptionsInSource(content);
    if (blocks.length > 0) {
        return blocks;
    }
    const yaml = tryParseYaml(content);
    return yaml ? findParserOptionsInJson(yaml) : blocks;
}
function tryParseJson(content) {
    try {
        const parsed = (0, devkit_1.parseJson)(content);
        return typeof parsed === 'object' && parsed !== null ? parsed : null;
    }
    catch {
        return null;
    }
}
/**
 * `@zkochan/js-yaml` is an optional peer, so a workspace without it reads a YAML
 * config as no typed linting, which is what happened before YAML was parsed at
 * all.
 */
function tryParseYaml(content) {
    try {
        const { load } = require('@zkochan/js-yaml');
        const parsed = load(content, { json: true });
        return typeof parsed === 'object' && parsed !== null ? parsed : null;
    }
    catch {
        return null;
    }
}
/**
 * A legacy config carries parser options at the top level and in each
 * `overrides` entry, and ESLint rejects a nested `overrides`, so those are the
 * only two places to read. Walking the whole document instead would pick up a
 * `parserOptions` that configures something else, such as one inside a rule's
 * options.
 */
function findParserOptionsInJson(config) {
    const blocks = [];
    const read = (entry) => {
        const options = entry?.parserOptions;
        if (typeof options === 'object' && options !== null) {
            blocks.push(readJsonParserOptions(options));
        }
    };
    read(config);
    const { overrides } = config;
    if (Array.isArray(overrides)) {
        overrides.forEach(read);
    }
    return blocks;
}
function readJsonParserOptions(options) {
    return {
        projectService: !('projectService' in options)
            ? 'absent'
            : isFalsyValue(options.projectService)
                ? 'disabled'
                : 'enabled',
        enablesProject: 'project' in options && !isFalsyValue(options.project),
    };
}
function isFalsyValue(value) {
    return value === false || value === null || value === undefined;
}
function findParserOptionsInSource(content) {
    const { source, checker } = parseSource(content);
    const configs = findConfigExpressions(source);
    if (configs.length === 0) {
        // No recognizable export (e.g. a `.eslintrc.js` legacy config, or a
        // tokenizer-only fixture): scan the whole source. That can read a
        // `parserOptions` from a declaration the config never uses, but a real flat
        // config exports its array, so the structured walk covers those.
        return collectParserOptions(source, checker, new Set());
    }
    const seen = new Set();
    return configs.flatMap((config) => walkValue(config, checker, seen));
}
/**
 * The value each config export denotes: `export default <expr>` (or `export =`)
 * and `module.exports = <expr>`. Only exports declared in this file, so an export
 * assembled in another module names nothing this walk reads.
 */
function findConfigExpressions(source) {
    const expressions = [];
    for (const statement of source.statements) {
        if (ts.isExportAssignment(statement)) {
            expressions.push(statement.expression);
        }
        else if (ts.isExpressionStatement(statement) &&
            ts.isBinaryExpression(statement.expression) &&
            statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            isModuleExports(statement.expression.left)) {
            expressions.push(statement.expression.right);
        }
    }
    return expressions;
}
/** The `module.exports` target of a CommonJS config's top-level assignment. */
function isModuleExports(node) {
    return (ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'module' &&
        node.name.text === 'exports');
}
const IGNORED_CONFIG_KEYS = new Set(['rules', 'settings', 'plugins']);
/**
 * A property whose value never holds real parser options, so the walk can skip
 * its subtree. A rule's options, a `settings` value and a `plugins` map can each
 * carry an object with a `parserOptions` key that configures something else;
 * ESLint reads parser options only from `languageOptions`.
 */
function isIgnoredConfigKey(name) {
    return IGNORED_CONFIG_KEYS.has(getPropertyName(name) ?? '');
}
/**
 * Every `parserOptions` reachable from a config value, walking only the
 * positions ESLint reads a config from: array entries, config-object property
 * values (a `rules`/`settings`/`plugins` subtree skipped), object and array
 * spreads, and the arguments of a wrapper call such as `tseslint.config(...)`. A
 * name in any of those positions resolves to its local declaration, so a config
 * assembled from `const` bindings reads the same as an inline one, and a name
 * bound to an import (another file) resolves to nothing. `seen` guards a
 * reference cycle.
 *
 * `inConfigPosition` tracks whether the value itself sits where ESLint reads a
 * config from, as opposed to being an ordinary property value. A wrapper call
 * forwards its arguments as config only in the former; in the latter it is an
 * arbitrary function whose arguments stay unread.
 */
function walkValue(expression, checker, seen, inConfigPosition = true) {
    const value = resolveExpressionValue(expression, checker, seen);
    if (!value) {
        return [];
    }
    if (ts.isArrayLiteralExpression(value)) {
        // Elements inherit this array's position: a root config array holds config
        // entries, an array under `files`/`ignores` holds ordinary values.
        return value.elements.flatMap((element) => ts.isSpreadElement(element)
            ? walkValue(element.expression, checker, seen, inConfigPosition)
            : walkValue(element, checker, seen, inConfigPosition));
    }
    if (ts.isObjectLiteralExpression(value)) {
        return value.properties.flatMap((property) => walkProperty(property, checker, seen));
    }
    if (ts.isCallExpression(value)) {
        // A wrapper (`tseslint.config(cfg)`) forwards its arguments as config
        // entries, but only when the call itself sits in a config position; as a
        // property value (`files: getFiles({...})`) the call is arbitrary and its
        // arguments are inputs, not config.
        const results = inConfigPosition
            ? value.arguments.flatMap((argument) => ts.isSpreadElement(argument)
                ? walkValue(argument.expression, checker, seen)
                : walkValue(argument, checker, seen))
            : [];
        // An IIFE (`(() => [...])()`) builds the config in the callee body, so read
        // its returns unconditionally (unlike wrapper arguments), at this call's own
        // position.
        const callee = unwrapExpression(value.expression);
        if (ts.isArrowFunction(callee) || ts.isFunctionExpression(callee)) {
            for (const returned of returnedExpressions(callee)) {
                results.push(...walkValue(returned, checker, seen, inConfigPosition));
            }
        }
        return results;
    }
    if (ts.isConditionalExpression(value)) {
        // Either branch of `cond ? a : b` may be the value at runtime, so a setting
        // in either counts. The branches inherit this value's position.
        return [
            ...walkValue(value.whenTrue, checker, seen, inConfigPosition),
            ...walkValue(value.whenFalse, checker, seen, inConfigPosition),
        ];
    }
    if (ts.isBinaryExpression(value) && isShortCircuit(value.operatorToken)) {
        // A short-circuit (`cond && cfg`, `base || [...]`, `base ?? [...]`) resolves
        // to one operand; read both, since either may be the value at runtime.
        return [
            ...walkValue(value.left, checker, seen, inConfigPosition),
            ...walkValue(value.right, checker, seen, inConfigPosition),
        ];
    }
    if (ts.isBinaryExpression(value) &&
        value.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        // A comma expression (`sideEffect(), cfg`) always evaluates to its right
        // operand.
        return walkValue(value.right, checker, seen, inConfigPosition);
    }
    return [];
}
/** The `&&`, `||` and `??` operators, whose result is one of their operands. */
function isShortCircuit(operator) {
    return (operator.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        operator.kind === ts.SyntaxKind.BarBarToken ||
        operator.kind === ts.SyntaxKind.QuestionQuestionToken);
}
/** The values an inline function returns: a concise arrow body, or each `return`. */
function returnedExpressions(fn) {
    if (!ts.isBlock(fn.body)) {
        return [fn.body];
    }
    const expressions = [];
    const visit = (node) => {
        if (ts.isReturnStatement(node)) {
            if (node.expression) {
                expressions.push(node.expression);
            }
            return;
        }
        // A nested function has its own returns, unrelated to this one's value.
        if (ts.isFunctionLike(node)) {
            return;
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(fn.body, visit);
    return expressions;
}
/** The `parserOptions` a single config-object property contributes. */
function walkProperty(property, checker, seen) {
    if (ts.isSpreadAssignment(property)) {
        return walkValue(property.expression, checker, seen, false);
    }
    const key = property.name ? getPropertyName(property.name) : null;
    if (key && IGNORED_CONFIG_KEYS.has(key)) {
        return [];
    }
    if (key === 'parserOptions') {
        const object = getParserOptionsObject(property, checker);
        return [object ? readParserOptions(object, checker) : UNREADABLE];
    }
    if (ts.isPropertyAssignment(property)) {
        return walkValue(property.initializer, checker, seen, false);
    }
    if (ts.isShorthandPropertyAssignment(property)) {
        // `{ languageOptions }`: follow the shorthand to its declaration and walk it.
        const declaration = checker.getShorthandAssignmentValueSymbol(property)?.declarations?.[0];
        if (declaration &&
            ts.isVariableDeclaration(declaration) &&
            declaration.initializer &&
            !seen.has(declaration)) {
            seen.add(declaration);
            return walkValue(declaration.initializer, checker, seen, false);
        }
    }
    return [];
}
/**
 * Export-less fallback: every `parserOptions` reachable from a node, local array
 * spreads followed. A spread of a local array contributes that array's entries;
 * a spread of another module names no file this walk reads.
 */
function collectParserOptions(root, checker, localSeen) {
    const blocks = [];
    const visit = (node) => {
        if (ts.isPropertyAssignment(node) && isIgnoredConfigKey(node.name)) {
            return;
        }
        if (isParserOptionsProperty(node)) {
            const object = getParserOptionsObject(node, checker);
            blocks.push(object ? readParserOptions(object, checker) : UNREADABLE);
        }
        if (ts.isSpreadElement(node)) {
            blocks.push(...followLocalSpread(node.expression, checker, localSeen));
        }
        ts.forEachChild(node, visit);
    };
    visit(root);
    return blocks;
}
/**
 * The expression a name (or an `obj.key` / `obj['key']` on a local object)
 * ultimately denotes, following alias chains such as `const inner = [...]; const
 * base = inner; export default base`. Anything we can't read statically (an
 * import, a dynamic key) resolves to nothing. `seen` guards a cycle like
 * `const a = b; const b = a`.
 */
function resolveExpressionValue(expression, checker, seen) {
    const unwrapped = unwrapExpression(expression);
    if (ts.isPropertyAccessExpression(unwrapped) ||
        ts.isElementAccessExpression(unwrapped)) {
        const value = resolveMemberValue(unwrapped, checker);
        return value ? resolveExpressionValue(value, checker, seen) : null;
    }
    if (!ts.isIdentifier(unwrapped)) {
        return unwrapped;
    }
    const declaration = checker.getSymbolAtLocation(unwrapped)?.declarations?.[0];
    if (!declaration ||
        !ts.isVariableDeclaration(declaration) ||
        !declaration.initializer ||
        seen.has(declaration)) {
        return null;
    }
    seen.add(declaration);
    return resolveExpressionValue(declaration.initializer, checker, seen);
}
/**
 * The value at `obj.key` / `obj['key']` when `obj` resolves to a local object
 * literal and the key is a static string. An imported object, a dynamic key or a
 * missing property resolves to nothing. A fresh `seen` isolates the object lookup
 * so sibling accesses on the same registry don't shadow one another.
 */
function resolveMemberValue(access, checker) {
    const key = memberKey(access);
    if (key === null) {
        return null;
    }
    const object = resolveObjectExpression(access.expression, checker, new Set());
    if (!object) {
        return null;
    }
    return lookupObjectKey(object, key, checker, new Set()).value;
}
/**
 * The value bound to `key` in an object literal, honoring source order (a later
 * property or spread wins, as at runtime) across plain, shorthand and spread
 * properties. `found` separates an absent key (an earlier value stands) from a
 * present but unreadable one (it clears the earlier value); an unreadable spread
 * object can't prove the key is present, so it leaves an earlier value in place.
 * `seen` is the recursion stack, so a spread cycle stops while the same object
 * reached again through a sibling spread still gets read.
 */
function lookupObjectKey(object, key, checker, seen) {
    if (seen.has(object)) {
        return { found: false, value: null };
    }
    seen.add(object);
    let result = {
        found: false,
        value: null,
    };
    for (const property of object.properties) {
        if (ts.isPropertyAssignment(property)) {
            if (getPropertyName(property.name) === key) {
                result = { found: true, value: property.initializer };
            }
        }
        else if (ts.isShorthandPropertyAssignment(property)) {
            if (property.name.text === key) {
                result = { found: true, value: shorthandValue(property, checker) };
            }
        }
        else if (ts.isSpreadAssignment(property)) {
            const spread = resolveObjectExpression(property.expression, checker, new Set());
            const fromSpread = spread
                ? lookupObjectKey(spread, key, checker, seen)
                : null;
            if (fromSpread && fromSpread.found) {
                result = fromSpread;
            }
        }
    }
    seen.delete(object);
    return result;
}
/** The initializer a shorthand property's binding was declared with. */
function shorthandValue(property, checker) {
    const declaration = checker.getShorthandAssignmentValueSymbol(property)?.declarations?.[0];
    return declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer
        ? declaration.initializer
        : null;
}
/** The static key of a member access, or `null` for a dynamic one. */
function memberKey(access) {
    if (ts.isPropertyAccessExpression(access)) {
        return access.name.text;
    }
    const argument = access.argumentExpression;
    if (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) {
        return argument.text;
    }
    return null;
}
/** A local array the config spreads in; its entries belong to this config. */
function followLocalSpread(expression, checker, localSeen) {
    // Only a name needs following. An inline array is already being walked as
    // part of the surrounding config, so resolving it again would double-count.
    // A name bound to an imported module resolves to nothing here (only a local
    // declaration has an initializer to read), so a spread config from another
    // file contributes nothing and the caller is free to append.
    const unwrapped = unwrapExpression(expression);
    if (!ts.isIdentifier(unwrapped)) {
        return [];
    }
    const value = resolveExpressionValue(expression, checker, localSeen);
    return value ? collectParserOptions(value, checker, localSeen) : [];
}
/**
 * Parses the config with a type checker attached, so a `parserOptions` written
 * as a reference resolves under real scope rules (shadowing, destructuring,
 * parameters, imports) rather than an approximation of them. One in-memory
 * file, no lib and no module resolution, so nothing reads from disk.
 */
function parseSource(content) {
    // Parsed as TS: flat configs may be `.ts`/`.cts`/`.mts`, and TS is a superset,
    // so the same parse covers the `.js` variants.
    const fileName = 'eslint.config.ts';
    const source = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const host = {
        getSourceFile: (name) => (name === fileName ? source : undefined),
        getDefaultLibFileName: () => 'lib.d.ts',
        writeFile: () => { },
        getCurrentDirectory: () => '',
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => '\n',
        fileExists: (name) => name === fileName,
        readFile: (name) => (name === fileName ? content : undefined),
    };
    const program = ts.createProgram([fileName], { noLib: true, allowJs: true, types: [] }, host);
    return { source, checker: program.getTypeChecker() };
}
/** A `parserOptions` property, whether written in full or by ES shorthand. */
function isParserOptionsProperty(node) {
    return ((ts.isShorthandPropertyAssignment(node) &&
        node.name.text === 'parserOptions') ||
        (ts.isPropertyAssignment(node) &&
            getPropertyName(node.name) === 'parserOptions'));
}
/**
 * The `parserOptions` object a node contributes: an inline literal, or the
 * literal behind a reference (`parserOptions: opts`, or the `{ parserOptions }`
 * shorthand). A variable only counts once the config actually references it, so
 * an unused declaration configures nothing.
 */
function getParserOptionsObject(node, checker) {
    if (ts.isShorthandPropertyAssignment(node) &&
        node.name.text === 'parserOptions') {
        return resolveSymbolObject(checker.getShorthandAssignmentValueSymbol(node), checker, new Set());
    }
    if (!ts.isPropertyAssignment(node) ||
        getPropertyName(node.name) !== 'parserOptions') {
        return null;
    }
    return resolveObjectExpression(node.initializer, checker, new Set());
}
/**
 * Strips the expression wrappers that don't change the value, so an object
 * literal behind `as const`, `satisfies`, a non-null assertion or parentheses is
 * still read as one.
 */
function unwrapExpression(node) {
    let current = node;
    while (ts.isParenthesizedExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isSatisfiesExpression(current) ||
        ts.isNonNullExpression(current) ||
        ts.isTypeAssertionExpression(current)) {
        current = current.expression;
    }
    return current;
}
/**
 * The object literal an expression ultimately denotes, following alias chains
 * (`const opts = typed`) and a static member access on a local object
 * (`registry.opts`). Anything else the name could be bound to (a parameter, a
 * destructured property, a call result, an import, a dynamic key) can't be read
 * statically, so it resolves to nothing and leaves the config alone. `seen`
 * guards against a cycle such as `const a = b; const b = a`.
 */
function resolveObjectExpression(expression, checker, seen) {
    const unwrapped = unwrapExpression(expression);
    if (ts.isObjectLiteralExpression(unwrapped)) {
        return unwrapped;
    }
    if (ts.isPropertyAccessExpression(unwrapped) ||
        ts.isElementAccessExpression(unwrapped)) {
        const value = resolveMemberValue(unwrapped, checker);
        return value ? resolveObjectExpression(value, checker, seen) : null;
    }
    if (!ts.isIdentifier(unwrapped) || seen.has(unwrapped)) {
        return null;
    }
    seen.add(unwrapped);
    return resolveSymbolObject(checker.getSymbolAtLocation(unwrapped), checker, seen);
}
/** The object literal behind a resolved name, if it was declared with one. */
function resolveSymbolObject(symbol, checker, seen) {
    const declaration = symbol?.declarations?.[0];
    return declaration &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer
        ? resolveObjectExpression(declaration.initializer, checker, seen)
        : null;
}
/**
 * The properties a `parserOptions` object ends up with, spreads expanded in
 * source order so a later entry overrides an earlier one, as it does at runtime.
 * A value of `null` means the key is set to something we can't read (a shorthand
 * or a nested reference). `seen` is the recursion stack, so a spread cycle stops
 * while the same object spread again later still gets read.
 */
function flattenProperties(node, checker, seen) {
    const properties = new Map();
    let unreadable = false;
    if (seen.has(node)) {
        return { properties, unreadable };
    }
    seen.add(node);
    for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
            const spread = resolveObjectExpression(property.expression, checker, new Set());
            if (!spread) {
                unreadable = true;
                continue;
            }
            const nested = flattenProperties(spread, checker, seen);
            unreadable ||= nested.unreadable;
            for (const [key, value] of nested.properties) {
                properties.set(key, value);
            }
            continue;
        }
        const key = property.name ? getPropertyName(property.name) : null;
        if (!key) {
            // A computed key could be either of the ones we look for.
            unreadable = true;
            continue;
        }
        properties.set(key, ts.isPropertyAssignment(property) ? property.initializer : null);
    }
    seen.delete(node);
    return { properties, unreadable };
}
function readParserOptions(node, checker) {
    const { properties, unreadable } = flattenProperties(node, checker, new Set());
    const project = properties.get('project');
    return {
        projectService: !properties.has('projectService')
            ? 'absent'
            : isFalsyLiteral(properties.get('projectService'))
                ? 'disabled'
                : 'enabled',
        // A shorthand (`{ project }`) hides its value, and an unreadable spread could
        // carry any `project` at all; both count, since assuming typed linting is off
        // risks appending a conflicting block over a working config.
        enablesProject: unreadable || (properties.has('project') && !isFalsyLiteral(project)),
    };
}
function getPropertyName(name) {
    return ts.isIdentifier(name) ||
        ts.isStringLiteral(name) ||
        ts.isNumericLiteral(name)
        ? name.text
        : null;
}
function isFalsyLiteral(node) {
    if (!node) {
        return false;
    }
    return (node.kind === ts.SyntaxKind.FalseKeyword ||
        node.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isIdentifier(node) && node.text === 'undefined'));
}
/**
 * Adds a typed-linting block (`parserOptions.projectService` + `tsconfigRootDir`)
 * to a project's flat ESLint config. No-op for legacy `.eslintrc` configs, whose
 * JSON format cannot express the `__dirname` that `tsconfigRootDir` needs.
 *
 * Use after operations that strip existing overrides (e.g.
 * `replaceOverridesInLintConfig`) to re-establish typed linting.
 */
function addTypedLintingToFlatConfig(tree, root) {
    if (!(0, flat_config_1.useFlatConfig)(tree)) {
        return;
    }
    let fileName;
    for (const f of flat_config_1.eslintFlatConfigFilenames) {
        if (tree.exists((0, devkit_1.joinPathFragments)(root, f))) {
            fileName = (0, devkit_1.joinPathFragments)(root, f);
            break;
        }
    }
    if (!fileName) {
        return;
    }
    const content = tree.read(fileName, 'utf8');
    // Idempotent: leave the config alone only when it configures typed-linting
    // parser options itself, an explicit `projectService: false` opt-out included.
    // Typed linting a config merely spreads in from another file need not cover
    // this project (its globs may be scoped elsewhere), and the appended block
    // defuses any inherited `project` anyway, so it is no reason to skip.
    const report = inspectTypedLinting(content);
    if (report.own) {
        return;
    }
    if (report.uncertain) {
        // A local `parserOptions` set through an expression we can't read could
        // already enable `project`; appending would silently convert it to the
        // project service, so leave the config for the user to complete instead.
        devkit_1.logger.warn(`Could not tell whether typed linting is already set up in "${fileName}" because its \`parserOptions\` is built from an expression Nx cannot read statically. Left it unchanged; add \`languageOptions: { parserOptions: { projectService: true } }\` yourself if typed linting is not configured.`);
        return;
    }
    // The block carries `tsconfigRootDir`, whose value differs per module system,
    // so the extension has to win over the content where it is decisive.
    const format = determineEslintConfigFormatForFile(fileName, content);
    const block = (0, ast_utils_1.generateTypedLintingFlatConfigOverride)(format);
    const updated = (0, ast_utils_1.addBlockToFlatConfigExport)(content, block);
    if (updated === content) {
        // `addBlockToFlatConfigExport` only edits a plain array export
        // (`export default [...]` / `module.exports = [...]`). A wrapper config such
        // as `export default tseslint.config(...)` is left untouched, so warn rather
        // than silently dropping the request.
        devkit_1.logger.warn(`Could not enable typed linting in "${fileName}" because its ESLint flat config is not a plain array export. Add \`languageOptions: { parserOptions: { projectService: true } }\` to enable typed linting.`);
        return;
    }
    tree.write(fileName, updated);
}
function addOverrideToLintConfig(tree, root, override, options = {
    insertAtTheEnd: true,
}) {
    const isBase = options.checkBaseConfig && findEslintFile(tree, root).includes('.base');
    if ((0, flat_config_1.useFlatConfig)(tree)) {
        let fileName;
        if (isBase) {
            for (const file of config_file_1.BASE_ESLINT_CONFIG_FILENAMES) {
                if (tree.exists((0, devkit_1.joinPathFragments)(root, file))) {
                    fileName = (0, devkit_1.joinPathFragments)(root, file);
                    break;
                }
            }
        }
        else {
            for (const f of flat_config_1.eslintFlatConfigFilenames) {
                if (tree.exists((0, devkit_1.joinPathFragments)(root, f))) {
                    fileName = (0, devkit_1.joinPathFragments)(root, f);
                    break;
                }
            }
        }
        let content = tree.read(fileName, 'utf8');
        const format = determineEslintConfigFormatForFile(fileName, content);
        const flatOverride = (0, ast_utils_1.generateFlatOverride)(override, format);
        // Check if the provided override using legacy eslintrc properties or plugins, if so we need to add compat
        if ((0, ast_utils_1.overrideNeedsCompat)(override)) {
            content = (0, ast_utils_1.addFlatCompatToFlatConfig)(content);
        }
        tree.write(fileName, (0, ast_utils_1.addBlockToFlatConfigExport)(content, flatOverride, options));
    }
    else {
        const fileName = (0, devkit_1.joinPathFragments)(root, isBase ? config_file_1.baseEsLintConfigFile : '.eslintrc.json');
        (0, devkit_1.updateJson)(tree, fileName, (json) => {
            json.overrides ??= [];
            if (options.insertAtTheEnd) {
                json.overrides.push(override);
            }
            else {
                json.overrides.unshift(override);
            }
            return json;
        });
    }
}
function updateOverrideInLintConfig(tree, rootOrFile, lookup, update) {
    let fileName;
    let root = rootOrFile;
    if (tree.exists(rootOrFile) && tree.isFile(rootOrFile)) {
        fileName = rootOrFile;
        root = (0, posix_1.dirname)(rootOrFile);
    }
    if ((0, flat_config_1.useFlatConfig)(tree)) {
        if (!fileName) {
            for (const f of flat_config_1.eslintFlatConfigFilenames) {
                if (tree.exists((0, devkit_1.joinPathFragments)(root, f))) {
                    fileName = (0, devkit_1.joinPathFragments)(root, f);
                    break;
                }
            }
        }
        let content = tree.read(fileName, 'utf8');
        content = (0, ast_utils_1.replaceOverride)(content, root, lookup, update);
        tree.write(fileName, content);
    }
    else {
        fileName ??= (0, devkit_1.joinPathFragments)(root, '.eslintrc.json');
        if (!tree.exists(fileName)) {
            return;
        }
        const existingJson = (0, devkit_1.readJson)(tree, fileName);
        if (!existingJson.overrides || !existingJson.overrides.some(lookup)) {
            return;
        }
        (0, devkit_1.updateJson)(tree, fileName, (json) => {
            const index = json.overrides.findIndex(lookup);
            if (index !== -1) {
                const newOverride = update(json.overrides[index]);
                if (newOverride) {
                    json.overrides[index] = newOverride;
                }
                else {
                    json.overrides.splice(index, 1);
                }
            }
            return json;
        });
    }
}
function lintConfigHasOverride(tree, rootOrFile, lookup, checkBaseConfig = false) {
    let fileName;
    let root = rootOrFile;
    if (tree.exists(rootOrFile) && tree.isFile(rootOrFile)) {
        fileName = rootOrFile;
        root = (0, posix_1.dirname)(rootOrFile);
    }
    if (!fileName && !isEslintConfigSupported(tree, root)) {
        return false;
    }
    const isBase = !fileName &&
        checkBaseConfig &&
        findEslintFile(tree, root).includes('.base');
    if (isBase) {
        for (const file of config_file_1.BASE_ESLINT_CONFIG_FILENAMES) {
            if (tree.exists((0, devkit_1.joinPathFragments)(root, file))) {
                fileName = (0, devkit_1.joinPathFragments)(root, file);
                break;
            }
        }
    }
    if ((0, flat_config_1.useFlatConfig)(tree)) {
        if (!fileName) {
            for (const f of flat_config_1.eslintFlatConfigFilenames) {
                if (tree.exists((0, devkit_1.joinPathFragments)(root, f))) {
                    fileName = (0, devkit_1.joinPathFragments)(root, f);
                    break;
                }
            }
        }
        const content = tree.read(fileName, 'utf8');
        return (0, ast_utils_1.hasOverride)(content, lookup);
    }
    else {
        fileName ??= (0, devkit_1.joinPathFragments)(root, isBase ? config_file_1.baseEsLintConfigFile : '.eslintrc.json');
        return (0, devkit_1.readJson)(tree, fileName).overrides?.some(lookup) || false;
    }
}
function replaceOverridesInLintConfig(tree, root, overrides) {
    if ((0, flat_config_1.useFlatConfig)(tree)) {
        let fileName;
        for (const f of flat_config_1.eslintFlatConfigFilenames) {
            if (tree.exists((0, devkit_1.joinPathFragments)(root, f))) {
                fileName = (0, devkit_1.joinPathFragments)(root, f);
                break;
            }
        }
        let content = tree.read(fileName, 'utf8');
        const format = determineEslintConfigFormatForFile(fileName, content);
        // Check if any of the provided overrides using legacy eslintrc properties or plugins, if so we need to add compat
        if (overrides.some(ast_utils_1.overrideNeedsCompat)) {
            content = (0, ast_utils_1.addFlatCompatToFlatConfig)(content);
        }
        content = (0, ast_utils_1.removeOverridesFromLintConfig)(content);
        overrides.forEach((override) => {
            const flatOverride = (0, ast_utils_1.generateFlatOverride)(override, format);
            content = (0, ast_utils_1.addBlockToFlatConfigExport)(content, flatOverride);
        });
        tree.write(fileName, content);
    }
    else {
        const fileName = (0, devkit_1.joinPathFragments)(root, '.eslintrc.json');
        (0, devkit_1.updateJson)(tree, fileName, (json) => {
            json.overrides = overrides;
            return json;
        });
    }
}
function addExtendsToLintConfig(tree, root, plugin, insertAtTheEnd = false) {
    if ((0, flat_config_1.useFlatConfig)(tree)) {
        const pluginExtends = [];
        let fileName;
        for (const f of flat_config_1.eslintFlatConfigFilenames) {
            if (tree.exists((0, devkit_1.joinPathFragments)(root, f))) {
                fileName = (0, devkit_1.joinPathFragments)(root, f);
                break;
            }
        }
        // Check the file extension to determine the format of the config if it is .js we look for the export
        const eslintConfigFormat = fileName.endsWith('.mjs')
            ? 'mjs'
            : fileName.endsWith('.cjs')
                ? 'cjs'
                : tree.read(fileName, 'utf-8').includes('module.exports')
                    ? 'cjs'
                    : 'mjs';
        let shouldImportEslintCompat = false;
        // eslint v9 requires the incompatible plugins to be wrapped with a helper from @eslint/compat
        const plugins = (Array.isArray(plugin) ? plugin : [plugin]).map((p) => typeof p === 'string' ? { name: p, needCompatFixup: false } : p);
        let compatiblePluginsBatch = [];
        plugins.forEach(({ name, needCompatFixup }) => {
            if (needCompatFixup) {
                if (compatiblePluginsBatch.length > 0) {
                    // flush the current batch of compatible plugins and reset it
                    pluginExtends.push((0, ast_utils_1.generatePluginExtendsElement)(compatiblePluginsBatch));
                    compatiblePluginsBatch = [];
                }
                // generate the extends for the incompatible plugin
                pluginExtends.push((0, ast_utils_1.generatePluginExtendsElementWithCompatFixup)(name));
                shouldImportEslintCompat = true;
            }
            else {
                // add the compatible plugin to the current batch
                compatiblePluginsBatch.push(name);
            }
        });
        if (compatiblePluginsBatch.length > 0) {
            // flush the batch of compatible plugins
            pluginExtends.push((0, ast_utils_1.generatePluginExtendsElement)(compatiblePluginsBatch));
        }
        let content = tree.read(fileName, 'utf8');
        if (shouldImportEslintCompat) {
            content = (0, ast_utils_1.addImportToFlatConfig)(content, ['fixupConfigRules'], '@eslint/compat');
        }
        content = (0, ast_utils_1.addFlatCompatToFlatConfig)(content);
        // reverse the order to ensure they are added in the correct order at the
        // start of the `extends` array
        for (const pluginExtend of pluginExtends.reverse()) {
            content = (0, ast_utils_1.addBlockToFlatConfigExport)(content, pluginExtend, {
                insertAtTheEnd,
            });
        }
        tree.write(fileName, content);
        if (shouldImportEslintCompat) {
            return (0, devkit_1.addDependenciesToPackageJson)(tree, {}, { '@eslint/compat': versions_1.eslintCompat, '@eslint/eslintrc': versions_1.eslintrcVersion }, undefined, true);
        }
        return (0, devkit_1.addDependenciesToPackageJson)(tree, {}, { '@eslint/eslintrc': versions_1.eslintrcVersion }, undefined, true);
    }
    else {
        const plugins = (Array.isArray(plugin) ? plugin : [plugin]).map((p) => typeof p === 'string' ? p : p.name);
        const fileName = (0, devkit_1.joinPathFragments)(root, '.eslintrc.json');
        (0, devkit_1.updateJson)(tree, fileName, (json) => {
            json.extends ??= [];
            json.extends = [
                ...plugins,
                ...(Array.isArray(json.extends) ? json.extends : [json.extends]),
            ];
            return json;
        });
        return () => { };
    }
}
function addPredefinedConfigToFlatLintConfig(tree, root, predefinedConfigName, options = {}) {
    const { moduleName = 'nx', moduleImportPath = '@nx/eslint-plugin', spread = true, insertAtTheEnd = true, checkBaseConfig = false, } = options;
    if (!(0, flat_config_1.useFlatConfig)(tree))
        throw new Error('Predefined configs can only be used with flat configs');
    let fileName;
    for (const f of flat_config_1.eslintFlatConfigFilenames) {
        if (tree.exists((0, devkit_1.joinPathFragments)(root, f))) {
            fileName = (0, devkit_1.joinPathFragments)(root, f);
            break;
        }
    }
    let content = tree.read(fileName, 'utf8');
    content = (0, ast_utils_1.addImportToFlatConfig)(content, moduleName, moduleImportPath);
    content = (0, ast_utils_1.addBlockToFlatConfigExport)(content, (0, ast_utils_1.generateFlatPredefinedConfig)(predefinedConfigName, moduleName, spread), { insertAtTheEnd, checkBaseConfig });
    tree.write(fileName, content);
}
function addPluginsToLintConfig(tree, root, plugin) {
    const plugins = Array.isArray(plugin) ? plugin : [plugin];
    if ((0, flat_config_1.useFlatConfig)(tree)) {
        let fileName;
        for (const f of flat_config_1.eslintFlatConfigFilenames) {
            if (tree.exists((0, devkit_1.joinPathFragments)(root, f))) {
                fileName = (0, devkit_1.joinPathFragments)(root, f);
                break;
            }
        }
        let content = tree.read(fileName, 'utf8');
        const mappedPlugins = [];
        plugins.forEach((name) => {
            const imp = getPluginImport(name);
            const varName = (0, devkit_1.names)(imp).propertyName;
            mappedPlugins.push({ name, varName, imp });
        });
        mappedPlugins.forEach(({ varName, imp }) => {
            content = (0, ast_utils_1.addImportToFlatConfig)(content, varName, imp);
        });
        content = (0, ast_utils_1.addPluginsToExportsBlock)(content, mappedPlugins);
        tree.write(fileName, content);
    }
    else {
        const fileName = (0, devkit_1.joinPathFragments)(root, '.eslintrc.json');
        (0, devkit_1.updateJson)(tree, fileName, (json) => {
            json.plugins = [...plugins, ...(json.plugins ?? [])];
            return json;
        });
    }
}
function addIgnoresToLintConfig(tree, root, ignorePatterns) {
    if ((0, flat_config_1.useFlatConfig)(tree)) {
        let fileName;
        for (const f of flat_config_1.eslintFlatConfigFilenames) {
            if (tree.exists((0, devkit_1.joinPathFragments)(root, f))) {
                fileName = (0, devkit_1.joinPathFragments)(root, f);
                break;
            }
        }
        if (!fileName) {
            return;
        }
        let content = tree.read(fileName, 'utf8');
        if ((0, ast_utils_1.hasFlatConfigIgnoresBlock)(content)) {
            content = (0, ast_utils_1.addPatternsToFlatConfigIgnoresBlock)(content, ignorePatterns);
            tree.write(fileName, content);
        }
        else {
            const block = (0, ast_utils_1.generateAst)({
                ignores: ignorePatterns.map((path) => (0, path_utils_1.mapFilePath)(path)),
            });
            tree.write(fileName, (0, ast_utils_1.addBlockToFlatConfigExport)(content, block));
        }
    }
    else {
        const fileName = (0, devkit_1.joinPathFragments)(root, '.eslintrc.json');
        if (!tree.exists(fileName)) {
            return;
        }
        (0, devkit_1.updateJson)(tree, fileName, (json) => {
            const ignoreSet = new Set([
                ...(json.ignorePatterns ?? []),
                ...ignorePatterns,
            ]);
            json.ignorePatterns = Array.from(ignoreSet);
            return json;
        });
    }
}
function getPluginImport(pluginName) {
    if (pluginName.includes('eslint-plugin-')) {
        return pluginName;
    }
    if (!pluginName.startsWith('@')) {
        return `eslint-plugin-${pluginName}`;
    }
    if (!pluginName.includes('/')) {
        return `${pluginName}/eslint-plugin`;
    }
    const [scope, name] = pluginName.split('/');
    return `${scope}/eslint-plugin-${name}`;
}
