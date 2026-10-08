"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readNxJson = readNxJson;
exports.updateNxJson = updateNxJson;
const path_1 = require("path");
const json_1 = require("./json");
/**
 * Reads nx.json
 */
function readNxJson(tree) {
    if (!tree.exists('nx.json')) {
        return null;
    }
    let nxJson = (0, json_1.readJson)(tree, 'nx.json');
    if (nxJson.extends) {
        nxJson = { ...readNxJsonExtends(tree, nxJson.extends), ...nxJson };
    }
    return nxJson;
}
/**
 * Update nx.json
 */
function updateNxJson(tree, nxJson) {
    if (tree.exists('nx.json')) {
        (0, json_1.updateJson)(tree, 'nx.json', (json) => {
            if (json.extends) {
                const nxJsonExtends = readNxJsonExtends(tree, json.extends);
                const changedPropsOfNxJson = {};
                Object.keys(nxJson).forEach((prop) => {
                    if (JSON.stringify(nxJson[prop], null, 2) !=
                        JSON.stringify(nxJsonExtends[prop], null, 2)) {
                        changedPropsOfNxJson[prop] = nxJson[prop];
                    }
                });
                return changedPropsOfNxJson;
            }
            else {
                return nxJson;
            }
        });
    }
}
function readNxJsonExtends(tree, extendsPath) {
    try {
        let resolvedExtendsPath;
        try {
            resolvedExtendsPath = require.resolve(extendsPath, {
                paths: [tree.root],
            });
        }
        catch {
            // Tree roots without a node_modules folder (e.g. the in-memory trees
            // used in tests) can't anchor module resolution; fall back to
            // resolving from the running nx package.
            resolvedExtendsPath = require.resolve(extendsPath);
        }
        return (0, json_1.readJson)(tree, (0, path_1.relative)(tree.root, resolvedExtendsPath));
    }
    catch (e) {
        throw new Error(`Unable to resolve nx.json extends. Error: ${e.message}`);
    }
}
