"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCloudOptions = getCloudOptions;
exports.getCloudUrl = getCloudUrl;
exports.removeTrailingSlash = removeTrailingSlash;
exports.isNxCloudId = isNxCloudId;
const nx_json_1 = require("../../config/nx-json");
const workspace_root_1 = require("../../utils/workspace-root");
function getCloudOptions(directory = workspace_root_1.workspaceRoot) {
    // Required lazily: this module is reachable from the @nx/devkit/internal
    // barrel that plugin workers load, and run-command eagerly pulls in the whole
    // task-execution subsystem.
    const { getRunnerOptions, } = require('../../tasks-runner/run-command');
    const nxJson = (0, nx_json_1.readNxJson)(directory);
    // TODO: The default is not always cloud? But it's not handled at the moment
    return getRunnerOptions('default', nxJson, {}, true);
}
function getCloudUrl() {
    return removeTrailingSlash(process.env.NX_CLOUD_API || process.env.NRWL_API || `https://cloud.nx.app`);
}
function removeTrailingSlash(apiUrl) {
    return apiUrl[apiUrl.length - 1] === '/' ? apiUrl.slice(0, -1) : apiUrl;
}
function isNxCloudId(token) {
    return token.length === 24;
}
