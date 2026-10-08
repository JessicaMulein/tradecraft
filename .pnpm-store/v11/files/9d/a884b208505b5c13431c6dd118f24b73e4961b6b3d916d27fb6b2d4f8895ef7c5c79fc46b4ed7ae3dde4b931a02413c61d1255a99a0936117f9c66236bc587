"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = rewriteInternalSubpathImports;
exports.rewriteSubpathImports = rewriteSubpathImports;
const devkit_1 = require("@nx/devkit");
const TS_EXTENSIONS = ['.ts', '.tsx', '.cts', '.mts'];
const FROM_PREFIX = '@nx/js/src/';
const TO_SPECIFIER = '@nx/js/internal';
// Subpaths kept as explicit (non-wildcard) exports entries on `@nx/js`, so
// imports of them keep resolving. Don't rewrite these:
// - `release/version-actions`: referenced by a runtime string default baked
//   into existing user `nx.json` release configs.
// - `utils/assets/copy-assets-handler`: consumed by project-graph plugins
//   (e.g. nx's own `tools/workspace-plugin`) that load before any build and
//   therefore can't resolve the source-only `@nx/js/internal` entry.
const PRESERVED_SUBPATHS = new Set([
    '@nx/js/src/release/version-actions',
    '@nx/js/src/utils/assets/copy-assets-handler',
]);
// Methods on `jest` and `vi` that take a module specifier as their first arg.
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
async function rewriteInternalSubpathImports(tree) {
    let touchedCount = 0;
    (0, devkit_1.visitNotIgnoredFiles)(tree, '.', (filePath) => {
        if (!TS_EXTENSIONS.some((ext) => filePath.endsWith(ext))) {
            return;
        }
        const original = tree.read(filePath, 'utf-8');
        if (!original || !original.includes(FROM_PREFIX)) {
            return;
        }
        const updated = rewriteSubpathImports(original);
        if (updated !== original) {
            tree.write(filePath, updated);
            touchedCount += 1;
        }
    });
    if (touchedCount > 0) {
        devkit_1.logger.info(`Rewrote @nx/js/src/* imports to @nx/js/internal in ${touchedCount} file(s).`);
    }
    await (0, devkit_1.formatFiles)(tree);
}
function rewriteSubpathImports(source) {
    ts ??= (0, devkit_1.ensurePackage)('typescript', '*');
    const sourceFile = ts.createSourceFile('tmp.ts', source, ts.ScriptTarget.Latest, 
    /* setParentNodes */ true, ts.ScriptKind.TSX);
    const changes = [];
    collectImportRewrites(sourceFile, changes);
    collectCallExpressionRewrites(sourceFile, changes);
    return changes.length > 0 ? (0, devkit_1.applyChangesToString)(source, changes) : source;
}
function shouldRewriteSpecifier(specifier) {
    if (!specifier.startsWith(FROM_PREFIX))
        return false;
    if (PRESERVED_SUBPATHS.has(specifier))
        return false;
    // Strip a trailing `.js` so e.g. `@nx/js/src/utils/foo.js` matches `@nx/js/src/utils/foo`
    // for the preserved-subpath check.
    const withoutJs = specifier.endsWith('.js')
        ? specifier.slice(0, -3)
        : specifier;
    return !PRESERVED_SUBPATHS.has(withoutJs);
}
function collectImportRewrites(sourceFile, changes) {
    for (const stmt of sourceFile.statements) {
        if (!ts.isImportDeclaration(stmt))
            continue;
        if (!ts.isStringLiteral(stmt.moduleSpecifier))
            continue;
        if (!shouldRewriteSpecifier(stmt.moduleSpecifier.text))
            continue;
        replaceSpecifier(sourceFile, stmt.moduleSpecifier, changes);
    }
}
function collectCallExpressionRewrites(sourceFile, changes) {
    const visit = (node) => {
        if (ts.isCallExpression(node) &&
            shouldRewriteCallExpression(node) &&
            node.arguments.length >= 1 &&
            ts.isStringLiteral(node.arguments[0]) &&
            shouldRewriteSpecifier(node.arguments[0].text)) {
            replaceSpecifier(sourceFile, node.arguments[0], changes);
        }
        else if (ts.isImportTypeNode(node)) {
            // `typeof import('...')` parses as an `ImportTypeNode`, not a
            // CallExpression — its argument is `LiteralTypeNode<StringLiteral>`.
            // The whole module is referenced, so it can't be symbol-split.
            const literal = getImportTypeStringLiteral(node);
            if (literal && shouldRewriteSpecifier(literal.text)) {
                replaceSpecifier(sourceFile, literal, changes);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
}
function getImportTypeStringLiteral(node) {
    const arg = node.argument;
    if (arg && ts.isLiteralTypeNode(arg) && ts.isStringLiteral(arg.literal)) {
        return arg.literal;
    }
    return undefined;
}
function shouldRewriteCallExpression(call) {
    const callee = call.expression;
    // `require('...')`
    if (ts.isIdentifier(callee) && callee.text === 'require')
        return true;
    // dynamic `import('...')` (runtime form parses as a CallExpression whose
    // callee is the `import` keyword). The `typeof import('...')` type-position
    // form is an `ImportTypeNode` (handled in `collectCallExpressionRewrites`).
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
function replaceSpecifier(sourceFile, literal, changes) {
    const start = literal.getStart(sourceFile);
    const end = literal.getEnd();
    const quote = sourceFile.text.charAt(start);
    changes.push({ type: devkit_1.ChangeType.Delete, start, length: end - start }, {
        type: devkit_1.ChangeType.Insert,
        index: start,
        text: `${quote}${TO_SPECIFIER}${quote}`,
    });
}
