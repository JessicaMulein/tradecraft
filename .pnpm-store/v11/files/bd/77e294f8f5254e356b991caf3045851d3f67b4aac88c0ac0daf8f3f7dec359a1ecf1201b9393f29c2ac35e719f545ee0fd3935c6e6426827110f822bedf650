"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBunCatalogDefinitions = readBunCatalogDefinitions;
exports.updateBunCatalogVersionsInFile = updateBunCatalogVersionsInFile;
const jsonc_parser_1 = require("jsonc-parser");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const fileutils_1 = require("../fileutils");
const json_1 = require("../json");
const output_1 = require("../output");
// Extracts catalog definitions from a parsed bun package.json, normalizing the
// top-level and `workspaces`-nested locations into a single CatalogDefinitions.
// Bun treats the locations as all-or-nothing: when either catalog field exists
// under `workspaces`, the top-level fields are ignored entirely rather than
// merged.
function normalizeBunCatalogDefinitions(packageJson) {
    const nested = packageJson.workspaces && !Array.isArray(packageJson.workspaces)
        ? packageJson.workspaces
        : undefined;
    const source = nested?.catalog !== undefined || nested?.catalogs !== undefined
        ? nested
        : packageJson;
    const { catalog, catalogs } = source;
    if (!catalog && !catalogs) {
        return null;
    }
    return { catalog, catalogs };
}
function readBunCatalogConfigFromFs(filename, fullPath) {
    try {
        return normalizeBunCatalogDefinitions((0, fileutils_1.readJsonFile)(fullPath));
    }
    catch (error) {
        output_1.output.warn({
            title: `Unable to parse ${filename}`,
            bodyLines: [error.toString()],
        });
        return null;
    }
}
function readBunCatalogConfigFromTree(filename, tree) {
    const content = tree.read(filename, 'utf-8');
    try {
        return normalizeBunCatalogDefinitions((0, json_1.parseJson)(content));
    }
    catch (error) {
        output_1.output.warn({
            title: `Unable to parse ${filename}`,
            bodyLines: [error.toString()],
        });
        return null;
    }
}
// Mirror of readCatalogDefinitions for bun's package.json-based catalogs: the
// fs (string-root) branch is cached per pass, the Tree branch stays live.
function readBunCatalogDefinitions(filename, treeOrRoot, cache) {
    if (typeof treeOrRoot === 'string') {
        if (cache.has(treeOrRoot)) {
            return cache.get(treeOrRoot);
        }
        const configPath = (0, node_path_1.join)(treeOrRoot, filename);
        const defs = (0, node_fs_1.existsSync)(configPath)
            ? readBunCatalogConfigFromFs(filename, configPath)
            : null;
        cache.set(treeOrRoot, defs);
        return defs;
    }
    if (!treeOrRoot.exists(filename)) {
        return null;
    }
    return readBunCatalogConfigFromTree(filename, treeOrRoot);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
// Resolves the jsonc path a catalog update should target. Follows the same
// all-or-nothing routing as the reader: updates land in the `workspaces`
// location when it holds a catalog field, otherwise at the top level.
function resolveBunCatalogTargetPath(packageJson, packageName, catalogName) {
    const nested = packageJson.workspaces && !Array.isArray(packageJson.workspaces)
        ? packageJson.workspaces
        : undefined;
    const nestedIsActive = nested?.catalog !== undefined || nested?.catalogs !== undefined;
    const prefix = nestedIsActive ? ['workspaces'] : [];
    return catalogName
        ? [...prefix, 'catalogs', catalogName, packageName]
        : [...prefix, 'catalog', packageName];
}
// jsonc-parser's `modify` creates missing intermediate objects but throws on
// null (or other non-object) ones — the JSON counterpart of pnpm's empty
// `catalog:` placeholder. Walk the target path and, at the first non-object
// step, replace that node wholesale with the remaining path nested as fresh
// objects.
function planBunCatalogEdit(packageJson, targetPath, version) {
    let node = packageJson;
    for (let i = 0; i < targetPath.length - 1; i++) {
        if (!isRecord(node)) {
            break;
        }
        const next = node[targetPath[i]];
        if (next !== undefined && !isRecord(next)) {
            const value = targetPath
                .slice(i + 1)
                .reduceRight((acc, key) => ({ [key]: acc }), version);
            return { path: targetPath.slice(0, i + 1), value };
        }
        node = next;
    }
    return { path: targetPath, value: version };
}
function updateBunCatalogVersionsInFile(filename, treeOrRoot, updates) {
    let checkExists;
    let readContent;
    let writeContent;
    if (typeof treeOrRoot === 'string') {
        const configPath = (0, node_path_1.join)(treeOrRoot, filename);
        checkExists = () => (0, node_fs_1.existsSync)(configPath);
        readContent = () => (0, node_fs_1.readFileSync)(configPath, 'utf-8');
        writeContent = (content) => (0, node_fs_1.writeFileSync)(configPath, content, 'utf-8');
    }
    else {
        checkExists = () => treeOrRoot.exists(filename);
        readContent = () => treeOrRoot.read(filename, 'utf-8');
        writeContent = (content) => treeOrRoot.write(filename, content);
    }
    if (!checkExists()) {
        output_1.output.warn({
            title: `No ${filename} found`,
            bodyLines: [
                `Cannot update catalog versions without a ${filename} file.`,
                `Create a ${filename} file to use catalogs.`,
            ],
        });
        return;
    }
    try {
        let content = readContent();
        // parseJson surfaces a genuine syntax error here rather than letting a
        // broken file be silently rewritten.
        let packageJson = (0, json_1.parseJson)(content);
        let hasChanges = false;
        for (const update of updates) {
            const { packageName, version, catalogName } = update;
            const targetPath = resolveBunCatalogTargetPath(packageJson, packageName, catalogName);
            // `modify` emits an edit even for an identical value, so check first to
            // keep an already-matching file untouched.
            const currentValue = targetPath.reduce((node, key) => (isRecord(node) ? node[key] : undefined), packageJson);
            if (currentValue === version) {
                continue;
            }
            const { path, value } = planBunCatalogEdit(packageJson, targetPath, version);
            const edits = (0, jsonc_parser_1.modify)(content, path, value, {
                formattingOptions: { insertSpaces: true, tabSize: 2 },
            });
            if (edits.length > 0) {
                content = (0, jsonc_parser_1.applyEdits)(content, edits);
                // Re-parse so the next update routes against the just-applied edit
                // (e.g. a null `catalog` placeholder replaced with a fresh map).
                packageJson = (0, json_1.parseJson)(content);
                hasChanges = true;
            }
        }
        if (hasChanges) {
            writeContent(content);
        }
    }
    catch (error) {
        output_1.output.error({
            title: 'Failed to update catalog versions',
            bodyLines: [error instanceof Error ? error.message : String(error)],
        });
        throw error;
    }
}
