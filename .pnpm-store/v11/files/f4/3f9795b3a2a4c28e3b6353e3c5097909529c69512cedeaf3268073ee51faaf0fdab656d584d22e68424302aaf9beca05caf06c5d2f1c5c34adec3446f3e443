"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREATE_NODES_V2_TYPE_RENAMES = void 0;
exports.default = renameCreateNodesV2Types;
exports.rewriteCreateNodesV2Types = rewriteCreateNodesV2Types;
const devkit_exports_1 = require("nx/src/devkit-exports");
const format_files_1 = require("../../generators/format-files");
const visit_not_ignored_files_1 = require("../../generators/visit-not-ignored-files");
const package_json_1 = require("../../utils/package-json");
const string_change_1 = require("../../utils/string-change");
const versions_1 = require("../../utils/versions");
const TS_EXTENSIONS = ['.ts', '.tsx', '.cts', '.mts'];
const DEVKIT_SPECIFIER = '@nx/devkit';
// The `*V2` plugin types were renamed to their canonical un-suffixed names in
// Nx 23. The `V2` names remain as `@deprecated` aliases, so this migration only
// moves callers onto the canonical names. (`CreateNodesResultV2` is renamed to
// `CreateNodesResultArray`, not `CreateNodesResult`, which is an unrelated type.)
exports.CREATE_NODES_V2_TYPE_RENAMES = new Map([
    ['CreateNodesV2', 'CreateNodes'],
    ['CreateNodesContextV2', 'CreateNodesContext'],
    ['CreateNodesResultV2', 'CreateNodesResultArray'],
    ['CreateNodesFunctionV2', 'CreateNodesFunction'],
    ['NxPluginV2', 'NxPlugin'],
]);
let ts;
async function renameCreateNodesV2Types(tree) {
    let touchedCount = 0;
    (0, visit_not_ignored_files_1.visitNotIgnoredFiles)(tree, '.', (filePath) => {
        if (!TS_EXTENSIONS.some((ext) => filePath.endsWith(ext))) {
            return;
        }
        const original = tree.read(filePath, 'utf-8');
        if (!original || !original.includes('V2')) {
            return;
        }
        const updated = rewriteCreateNodesV2Types(original);
        if (updated !== original) {
            tree.write(filePath, updated);
            touchedCount += 1;
        }
    });
    if (touchedCount > 0) {
        devkit_exports_1.logger.info(`Renamed deprecated CreateNodes V2 type imports from @nx/devkit in ${touchedCount} file(s).`);
    }
    await (0, format_files_1.formatFiles)(tree);
}
/**
 * Rewrites named imports and re-exports of the deprecated `*V2` plugin types
 * from `@nx/devkit` to their canonical names. Only the named bindings are
 * touched — the module specifier, the `import`/`export` keyword, any `type`
 * modifier, and any default import are left untouched.
 */
function rewriteCreateNodesV2Types(source) {
    ts ??= (0, package_json_1.ensurePackage)('typescript', versions_1.typescriptVersion);
    const sourceFile = ts.createSourceFile('tmp.ts', source, ts.ScriptTarget.Latest, 
    /* setParentNodes */ true, ts.ScriptKind.TSX);
    const changes = [];
    // Local bindings whose name changes as a result of rewriting a non-aliased
    // import specifier (e.g. `import { CreateNodesV2 }` -> `import { CreateNodes }`).
    // Every in-body reference to such a binding must be renamed too, otherwise the
    // rewritten import leaves a dangling reference to the old name.
    const localRenames = new Map();
    for (const stmt of sourceFile.statements) {
        if (ts.isImportDeclaration(stmt)) {
            collectImportRewrite(sourceFile, stmt, changes, localRenames);
        }
        else if (ts.isExportDeclaration(stmt)) {
            collectExportRewrite(sourceFile, stmt, changes);
        }
    }
    if (localRenames.size > 0) {
        collectUsageRewrites(sourceFile, localRenames, changes);
    }
    return changes.length > 0 ? (0, string_change_1.applyChangesToString)(source, changes) : source;
}
function isDevkitSpecifier(node) {
    return ts.isStringLiteral(node) && node.text === DEVKIT_SPECIFIER;
}
function collectImportRewrite(sourceFile, stmt, changes, localRenames) {
    if (!isDevkitSpecifier(stmt.moduleSpecifier)) {
        return;
    }
    const namedBindings = stmt.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) {
        return;
    }
    // A non-aliased specifier (`{ CreateNodesV2 }`) renames the local binding, so
    // its in-body references must be rewritten as well. An aliased specifier
    // (`{ CreateNodesV2 as Foo }`) keeps the local name `Foo`, so it does not.
    for (const el of namedBindings.elements) {
        if (el.propertyName) {
            continue;
        }
        const canonical = exports.CREATE_NODES_V2_TYPE_RENAMES.get(el.name.text);
        if (canonical) {
            localRenames.set(el.name.text, canonical);
        }
    }
    rewriteNamedBindings(sourceFile, namedBindings, changes);
}
/**
 * Renames in-body references (type annotations, value usages) of bindings that
 * were renamed by an import rewrite. References inside import/export
 * declarations are left to the binding rewrite, and member positions
 * (`foo.CreateNodesV2`, `NS.CreateNodesV2`) are not standalone references to the
 * imported binding, so they are skipped.
 */
function collectUsageRewrites(sourceFile, localRenames, changes) {
    const visit = (node) => {
        if (ts.isIdentifier(node) &&
            localRenames.has(node.text) &&
            isRenameableReference(node)) {
            const start = node.getStart(sourceFile);
            changes.push({ type: string_change_1.ChangeType.Delete, start, length: node.getEnd() - start }, {
                type: string_change_1.ChangeType.Insert,
                index: start,
                text: localRenames.get(node.text),
            });
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
}
function isRenameableReference(id) {
    const parent = id.parent;
    // `foo.CreateNodesV2` — the member name is not the imported binding.
    if (ts.isPropertyAccessExpression(parent) && parent.name === id) {
        return false;
    }
    // `NS.CreateNodesV2` in a type position — same reasoning.
    if (ts.isQualifiedName(parent) && parent.right === id) {
        return false;
    }
    // Anything inside an import/export declaration is handled by the binding
    // rewrite; skip it here to avoid touching the specifier twice.
    for (let n = id; n; n = n.parent) {
        if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
            return false;
        }
    }
    return true;
}
function collectExportRewrite(sourceFile, stmt, changes) {
    if (!stmt.moduleSpecifier || !isDevkitSpecifier(stmt.moduleSpecifier)) {
        return;
    }
    if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) {
        return;
    }
    rewriteNamedBindings(sourceFile, stmt.exportClause, changes);
}
/**
 * Re-renders the `{ ... }` of a named import/export, renaming any deprecated
 * `*V2` type to its canonical name. If renaming would collide with a canonical
 * name that is already present, the duplicate is dropped. Returns without
 * recording a change when the binding list contains none of the renamed types.
 */
function rewriteNamedBindings(sourceFile, namedBindings, changes) {
    const elements = namedBindings.elements;
    const hasRenamed = elements.some((el) => exports.CREATE_NODES_V2_TYPE_RENAMES.has((el.propertyName ?? el.name).text));
    if (!hasRenamed) {
        return;
    }
    const seen = new Set();
    const rendered = [];
    for (const el of elements) {
        const text = renderSpecifier(el);
        if (!seen.has(text)) {
            seen.add(text);
            rendered.push(text);
        }
    }
    const start = namedBindings.getStart(sourceFile);
    changes.push({
        type: string_change_1.ChangeType.Delete,
        start,
        length: namedBindings.getEnd() - start,
    }, {
        type: string_change_1.ChangeType.Insert,
        index: start,
        text: `{ ${rendered.join(', ')} }`,
    });
}
function renderSpecifier(el) {
    const typePrefix = el.isTypeOnly ? 'type ' : '';
    const rename = (name) => exports.CREATE_NODES_V2_TYPE_RENAMES.get(name) ?? name;
    // `{ name }` — no alias, so the local binding follows the rename.
    if (!el.propertyName) {
        return `${typePrefix}${rename(el.name.text)}`;
    }
    // `{ propertyName as name }` — only the imported (left) side is renamed; the
    // local alias is preserved. A now-redundant alias such as
    // `CreateNodesV2 as CreateNodes` collapses to `CreateNodes`.
    const canonicalImported = rename(el.propertyName.text);
    const localName = el.name.text;
    return canonicalImported === localName
        ? `${typePrefix}${localName}`
        : `${typePrefix}${canonicalImported} as ${localName}`;
}
