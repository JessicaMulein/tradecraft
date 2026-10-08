"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = moveTypescriptCompilationImport;
exports.rewriteCompilationImport = rewriteCompilationImport;
const devkit_1 = require("@nx/devkit");
const TS_EXTENSIONS = ['.ts', '.tsx', '.cts', '.mts'];
const FROM_SPECIFIER = '@nx/workspace/src/utilities/typescript/compilation';
const TO_SPECIFIER = '@nx/js/internal';
// Methods on `jest` and `vi` that take a module specifier as their first arg.
// Calls like `jest.mock('@nx/workspace/src/utilities/typescript/compilation')`
// are rewritten so the mock target lines up with the rewritten import.
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
// Resolved lazily so the migration only pays the typescript load cost when it
// actually has work to do.
let ts;
async function moveTypescriptCompilationImport(tree) {
    let touchedCount = 0;
    (0, devkit_1.visitNotIgnoredFiles)(tree, '.', (filePath) => {
        if (!TS_EXTENSIONS.some((ext) => filePath.endsWith(ext))) {
            return;
        }
        const original = tree.read(filePath, 'utf-8');
        if (!original || !original.includes(FROM_SPECIFIER)) {
            return;
        }
        const updated = rewriteCompilationImport(original);
        if (updated !== original) {
            tree.write(filePath, updated);
            touchedCount += 1;
        }
    });
    if (touchedCount > 0) {
        devkit_1.logger.info(`Rewrote @nx/workspace/src/utilities/typescript/compilation imports in ${touchedCount} file(s).`);
    }
    await (0, devkit_1.formatFiles)(tree);
}
function rewriteCompilationImport(source) {
    ts ??= (0, devkit_1.ensurePackage)('typescript', '*');
    const sourceFile = ts.createSourceFile('tmp.ts', source, ts.ScriptTarget.Latest, 
    /* setParentNodes */ true, ts.ScriptKind.TSX);
    const changes = [];
    collectImportRewrites(sourceFile, changes);
    collectCallExpressionRewrites(sourceFile, changes);
    return changes.length > 0 ? (0, devkit_1.applyChangesToString)(source, changes) : source;
}
function collectImportRewrites(sourceFile, changes) {
    for (const stmt of sourceFile.statements) {
        if (!ts.isImportDeclaration(stmt))
            continue;
        if (!ts.isStringLiteral(stmt.moduleSpecifier))
            continue;
        if (stmt.moduleSpecifier.text !== FROM_SPECIFIER)
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
            node.arguments[0].text === FROM_SPECIFIER) {
            replaceSpecifier(sourceFile, node.arguments[0], changes);
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
    // dynamic `import('...')` (runtime form parses as a CallExpression whose
    // callee is the `import` keyword). The type-position form
    // (`typeof import('...')`) is an `ImportTypeNode`, not a CallExpression, so
    // we don't touch it.
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
