"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = migrate;
const nx_json_1 = require("../../generators/utils/nx-json");
const format_changed_files_1 = require("../../generators/internal-utils/format-changed-files");
async function migrate(tree) {
    const nxJson = (0, nx_json_1.readNxJson)(tree);
    nxJson.useInferencePlugins = false;
    (0, nx_json_1.updateNxJson)(tree, nxJson);
    await (0, format_changed_files_1.formatChangedFiles)(tree);
}
