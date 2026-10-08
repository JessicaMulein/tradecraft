"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const format_changed_files_1 = require("../../generators/internal-utils/format-changed-files");
const json_1 = require("../../generators/utils/json");
async function default_1(tree) {
    (0, json_1.updateJson)(tree, 'package.json', (json) => {
        for (const deps of [json.dependencies, json.devDependencies]) {
            if (deps) {
                delete deps['@nrwl/cli'];
            }
        }
        return json;
    });
    await (0, format_changed_files_1.formatChangedFiles)(tree);
}
