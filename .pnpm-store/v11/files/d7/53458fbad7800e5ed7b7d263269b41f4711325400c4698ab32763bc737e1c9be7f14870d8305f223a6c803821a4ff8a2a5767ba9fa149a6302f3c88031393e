"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEVKIT_INTERNAL_SYMBOLS = void 0;
exports.default = updateDevkitDeepImports;
exports.rewriteDevkitDeepImports = rewriteDevkitDeepImports;
const devkit_exports_1 = require("nx/src/devkit-exports");
const format_files_1 = require("../../generators/format-files");
const visit_not_ignored_files_1 = require("../../generators/visit-not-ignored-files");
const package_json_1 = require("../../utils/package-json");
const string_change_1 = require("../../utils/string-change");
const versions_1 = require("../../utils/versions");
const TS_EXTENSIONS = ['.ts', '.tsx', '.cts', '.mts'];
const DEEP_IMPORT_PREFIX = '@nx/devkit/src/';
const PUBLIC_SPECIFIER = '@nx/devkit';
const INTERNAL_SPECIFIER = '@nx/devkit/internal';
// Names re-exported from `@nx/devkit/internal` (see packages/devkit/internal.ts
// at the time this migration was authored). Anything imported from a
// `@nx/devkit/src/...` path whose name is NOT in this set is assumed to be
// part of the stable public `@nx/devkit` API.
exports.DEVKIT_INTERNAL_SYMBOLS = new Set([
    'signalToCode',
    'createProjectRootMappingsFromProjectConfigurations',
    'PluginCache',
    'safeWriteFileCache',
    'determineArtifactNameAndDirectoryOptions',
    'getRelativeCwd',
    'FileExtensionType',
    'getE2EWebServerInfo',
    'E2EWebServerDetails',
    'forEachExecutorOptions',
    'AggregatedLog',
    'migrateProjectExecutorsToPlugin',
    'migrateProjectExecutorsToPluginV1',
    'NoTargetsToMigrateError',
    'InferredTargetConfiguration',
    'processTargetOutputs',
    'deleteMatchingProperties',
    'toProjectRelativePath',
    'determineProjectNameAndRootOptions',
    'ensureRootProjectName',
    'resolveImportPath',
    'promptWhenInteractive',
    'addBuildTargetDefaults',
    'addE2eCiTargetDefaults',
    'addPlugin',
    'createAsyncIterable',
    'combineAsyncIterables',
    'mapAsyncIterable',
    'calculateHashForCreateNodes',
    'calculateHashesForCreateNodes',
    'getCatalogManager',
    'loadConfigFile',
    'clearRequireCache',
    'findPluginForConfigFile',
    'getNamedInputs',
    'logShowProjectCommand',
    'eachValueFrom',
    'checkAndCleanWithSemver',
    'camelize',
    'capitalize',
    'classify',
    'dasherize',
    'emitPluginWorkerLog',
    'throwForUnsupportedVersion',
]);
// Methods on `jest` and `vi` that take a module specifier as their first
// argument. Calls like `jest.mock('@nx/devkit/src/...')` are rewritten so the
// mock target lines up with the rewritten import.
const MOCK_HELPER_METHODS = new Set([
    'mock',
    'unmock',
    'doMock',
    'dontMock',
    'requireActual',
    'requireMock',
    'importActual',
    'importMock',
]);
let ts;
async function updateDevkitDeepImports(tree) {
    let touchedCount = 0;
    (0, visit_not_ignored_files_1.visitNotIgnoredFiles)(tree, '.', (filePath) => {
        if (!TS_EXTENSIONS.some((ext) => filePath.endsWith(ext))) {
            return;
        }
        const original = tree.read(filePath, 'utf-8');
        if (!original || !original.includes(DEEP_IMPORT_PREFIX)) {
            return;
        }
        const updated = rewriteDevkitDeepImports(original);
        if (updated !== original) {
            tree.write(filePath, updated);
            touchedCount += 1;
        }
    });
    if (touchedCount > 0) {
        devkit_exports_1.logger.info(`Rewrote @nx/devkit deep imports in ${touchedCount} file(s).`);
    }
    await (0, format_files_1.formatFiles)(tree);
}
function rewriteDevkitDeepImports(source) {
    ts ??= (0, package_json_1.ensurePackage)('typescript', versions_1.typescriptVersion);
    const sourceFile = ts.createSourceFile('tmp.ts', source, ts.ScriptTarget.Latest, 
    /* setParentNodes */ true, ts.ScriptKind.TSX);
    const changes = [];
    for (const stmt of sourceFile.statements) {
        if (!ts.isImportDeclaration(stmt))
            continue;
        if (!ts.isStringLiteral(stmt.moduleSpecifier))
            continue;
        if (!stmt.moduleSpecifier.text.startsWith(DEEP_IMPORT_PREFIX))
            continue;
        const replacement = buildReplacement(stmt, sourceFile);
        changes.push({
            type: string_change_1.ChangeType.Delete,
            start: stmt.getStart(sourceFile),
            length: stmt.getEnd() - stmt.getStart(sourceFile),
        }, {
            type: string_change_1.ChangeType.Insert,
            index: stmt.getStart(sourceFile),
            text: replacement,
        });
    }
    // Pass 2: rewrite `require('@nx/devkit/src/...')`, dynamic
    // `import('@nx/devkit/src/...')`, and `jest.mock(...)` / `vi.mock(...)`-style
    // calls. We can't bucket these by symbol (no named binding to inspect), so
    // we route them at `/internal` as a best guess. Walking the AST instead of
    // string-replacing keeps us out of unrelated string literals — template
    // strings, `typeof import('...')` type queries, comments, etc.
    collectCallExpressionRewrites(sourceFile, changes);
    let updated = changes.length > 0 ? (0, string_change_1.applyChangesToString)(source, changes) : source;
    // Final pass: collapse any duplicate `@nx/devkit` and `@nx/devkit/internal`
    // named-only imports into a single declaration. This handles both the
    // imports we just emitted AND any that the user already had, so we never
    // leave the file with two `from '@nx/devkit'` lines.
    updated = collapseDevkitImports(updated);
    return updated;
}
function collapseDevkitImports(source) {
    const sourceFile = ts.createSourceFile('tmp.ts', source, ts.ScriptTarget.Latest, 
    /* setParentNodes */ true, ts.ScriptKind.TSX);
    const groups = new Map();
    for (const stmt of sourceFile.statements) {
        if (!ts.isImportDeclaration(stmt))
            continue;
        if (!ts.isStringLiteral(stmt.moduleSpecifier))
            continue;
        const specifier = stmt.moduleSpecifier.text;
        if (specifier !== PUBLIC_SPECIFIER && specifier !== INTERNAL_SPECIFIER) {
            continue;
        }
        const importClause = stmt.importClause;
        if (!importClause)
            continue; // skip side-effect imports
        if (importClause.name)
            continue; // skip default imports
        const namedBindings = importClause.namedBindings;
        if (!namedBindings || !ts.isNamedImports(namedBindings))
            continue;
        const typeOnly = !!importClause.isTypeOnly;
        const key = `${specifier}\x00${typeOnly ? 'type' : 'value'}`;
        if (!groups.has(key)) {
            groups.set(key, { decls: [], specifier, typeOnly });
        }
        groups.get(key).decls.push(stmt);
    }
    const changes = [];
    for (const { decls, specifier, typeOnly } of groups.values()) {
        if (decls.length < 2)
            continue;
        const seen = new Set();
        const merged = [];
        for (const decl of decls) {
            const named = decl.importClause.namedBindings;
            for (const el of named.elements) {
                const text = renderSpecifierFromNode(el, typeOnly);
                if (!seen.has(text)) {
                    seen.add(text);
                    merged.push(text);
                }
            }
        }
        // Replace the first declaration with the merged one in place.
        const first = decls[0];
        changes.push({
            type: string_change_1.ChangeType.Delete,
            start: first.getStart(sourceFile),
            length: first.getEnd() - first.getStart(sourceFile),
        }, {
            type: string_change_1.ChangeType.Insert,
            index: first.getStart(sourceFile),
            text: renderImport(merged, specifier, typeOnly),
        });
        // Delete every other declaration in this group (and consume one trailing
        // newline so we don't leave behind a blank line that prettier has to clean
        // up later).
        for (let i = 1; i < decls.length; i++) {
            const decl = decls[i];
            const start = decl.getStart(sourceFile);
            let end = decl.getEnd();
            if (source[end] === '\n') {
                end += 1;
            }
            else if (source[end] === '\r' && source[end + 1] === '\n') {
                end += 2;
            }
            changes.push({
                type: string_change_1.ChangeType.Delete,
                start,
                length: end - start,
            });
        }
    }
    return changes.length > 0 ? (0, string_change_1.applyChangesToString)(source, changes) : source;
}
function renderSpecifierFromNode(el, parentIsTypeOnly) {
    const aliasText = el.propertyName ? ` as ${el.name.text}` : '';
    const typePrefix = !parentIsTypeOnly && el.isTypeOnly ? 'type ' : '';
    return `${typePrefix}${(el.propertyName ?? el.name).text}${aliasText}`;
}
function buildReplacement(decl, sourceFile) {
    const importClause = decl.importClause;
    // `import '@nx/devkit/src/...';` (side-effect) — no clause to bucket.
    if (!importClause) {
        return `import '${INTERNAL_SPECIFIER}';`;
    }
    const namedBindings = importClause.namedBindings;
    const isNamedImport = namedBindings && ts.isNamedImports(namedBindings) && !importClause.name;
    // Default / namespace / mixed-default-and-named — can't bucket reliably.
    // Preserve the import shape, swap the specifier.
    if (!isNamedImport) {
        const before = source(decl, sourceFile).slice(0, decl.moduleSpecifier.getStart(sourceFile) - decl.getStart(sourceFile));
        const after = source(decl, sourceFile).slice(decl.moduleSpecifier.getEnd() - decl.getStart(sourceFile));
        return `${before}'${INTERNAL_SPECIFIER}'${after}`;
    }
    const isTypeOnlyImport = importClause.isTypeOnly;
    const elements = namedBindings.elements;
    const publik = [];
    const internal = [];
    for (const el of elements) {
        bucketSpecifier(el, isTypeOnlyImport, publik, internal);
    }
    const lines = [];
    if (publik.length > 0) {
        lines.push(renderImport(publik, PUBLIC_SPECIFIER, isTypeOnlyImport));
    }
    if (internal.length > 0) {
        lines.push(renderImport(internal, INTERNAL_SPECIFIER, isTypeOnlyImport));
    }
    if (lines.length === 0) {
        // Defensive: empty `import {} from '...'` — point at /internal.
        lines.push(`import {} from '${INTERNAL_SPECIFIER}';`);
    }
    return lines.join('\n');
}
function bucketSpecifier(el, parentIsTypeOnly, publik, internal) {
    const lookupName = (el.propertyName ?? el.name).text;
    const elementIsTypeOnly = el.isTypeOnly;
    const aliasText = el.propertyName ? ` as ${el.name.text}` : '';
    // Inline `type` is illegal when the parent import is already `import type`.
    const typePrefix = !parentIsTypeOnly && elementIsTypeOnly ? 'type ' : '';
    const text = `${typePrefix}${(el.propertyName ?? el.name).text}${aliasText}`;
    if (exports.DEVKIT_INTERNAL_SYMBOLS.has(lookupName)) {
        internal.push(text);
    }
    else {
        publik.push(text);
    }
}
function renderImport(specifiers, from, typeOnly) {
    const prefix = typeOnly ? 'import type' : 'import';
    return `${prefix} { ${specifiers.join(', ')} } from '${from}';`;
}
function source(decl, sourceFile) {
    return sourceFile.text.slice(decl.getStart(sourceFile), decl.getEnd());
}
function collectCallExpressionRewrites(sourceFile, changes) {
    const visit = (node) => {
        if (ts.isCallExpression(node) &&
            shouldRewriteCallExpression(node) &&
            node.arguments.length >= 1 &&
            ts.isStringLiteral(node.arguments[0]) &&
            node.arguments[0].text.startsWith(DEEP_IMPORT_PREFIX)) {
            const arg = node.arguments[0];
            const start = arg.getStart(sourceFile);
            const end = arg.getEnd();
            const quote = sourceFile.text.charAt(start);
            changes.push({
                type: string_change_1.ChangeType.Delete,
                start,
                length: end - start,
            }, {
                type: string_change_1.ChangeType.Insert,
                index: start,
                text: `${quote}${INTERNAL_SPECIFIER}${quote}`,
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
}
function shouldRewriteCallExpression(call) {
    const callee = call.expression;
    // `require('...')`
    if (ts.isIdentifier(callee) && callee.text === 'require')
        return true;
    // dynamic `import('...')` — the runtime form parses as a CallExpression
    // whose callee is the `import` keyword. The type-position form
    // (`typeof import('...')`) parses as `ImportTypeNode`, not a CallExpression,
    // so we don't touch it.
    if (callee.kind === ts.SyntaxKind.ImportKeyword)
        return true;
    // `jest.mock(...)` / `vi.mock(...)` and friends.
    if (ts.isPropertyAccessExpression(callee)) {
        const obj = callee.expression;
        if (ts.isIdentifier(obj) &&
            (obj.text === 'jest' || obj.text === 'vi') &&
            MOCK_HELPER_METHODS.has(callee.name.text)) {
            return true;
        }
    }
    return false;
}
