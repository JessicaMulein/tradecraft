"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNxCloudOnboardingURLForWelcomeApp = createNxCloudOnboardingURLForWelcomeApp;
exports.getNxCloudAppOnBoardingUrl = getNxCloudAppOnBoardingUrl;
exports.readNxCloudToken = readNxCloudToken;
const is_workspace_claimed_1 = require("./is-workspace-claimed");
const url_shorten_1 = require("./url-shorten");
const nx_json_1 = require("../../generators/utils/nx-json");
async function createNxCloudOnboardingURLForWelcomeApp(tree, token) {
    token = token || readNxCloudToken(tree);
    if (!token) {
        return 'not-configured';
    }
    return (await (0, is_workspace_claimed_1.isWorkspaceClaimed)(token)) ? 'claimed' : 'unclaimed';
}
async function getNxCloudAppOnBoardingUrl(token) {
    if (!token) {
        return null;
    }
    const onboardingUrl = await (0, url_shorten_1.createNxCloudOnboardingURL)('nx-welcome-app', token, undefined, false);
    return onboardingUrl;
}
function readNxCloudToken(tree) {
    // Required lazily: this module is re-exported from the @nx/devkit/internal
    // barrel that plugin workers load, and run-command eagerly pulls in the whole
    // task-execution subsystem.
    const { getRunnerOptions, } = require('../../tasks-runner/run-command');
    const nxJson = (0, nx_json_1.readNxJson)(tree);
    const { accessToken, nxCloudId } = getRunnerOptions('default', nxJson, {}, true);
    return accessToken || nxCloudId;
}
