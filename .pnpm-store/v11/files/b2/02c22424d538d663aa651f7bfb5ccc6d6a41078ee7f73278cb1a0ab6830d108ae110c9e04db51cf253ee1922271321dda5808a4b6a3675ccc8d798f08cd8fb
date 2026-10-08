"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSemverSpecifierFromConventionalCommits = resolveSemverSpecifierFromConventionalCommits;
exports.resolveSemverSpecifierFromPrompt = resolveSemverSpecifierFromPrompt;
const prompt_helpers_1 = require("../../../utils/prompt-helpers");
const semver_1 = require("semver");
const git_1 = require("./git");
const semver_2 = require("./semver");
const shared_1 = require("./shared");
async function resolveSemverSpecifierFromConventionalCommits(from, projectGraph, projectNames, releaseConfig, releaseGraph, 
// The full set of projects in the active release group. For independent
// release groups, `projectNames` only contains the single project being
// processed, so this is forwarded separately to keep scope matching
// accurate against the whole group. Defaults to `projectNames`.
releaseGroupProjects = projectNames) {
    const commits = await (0, git_1.getGitDiff)(from);
    const parsedCommits = (0, git_1.parseCommits)(commits);
    const relevantCommits = await (0, shared_1.getCommitsRelevantToProjects)(projectGraph, parsedCommits, projectNames, releaseConfig, releaseGraph, releaseGroupProjects);
    return (0, semver_2.determineSemverChange)(relevantCommits, releaseConfig.conventionalCommits);
}
async function resolveSemverSpecifierFromPrompt(selectionMessage, customVersionMessage) {
    // Cancelling exits rather than returning, so yargs never prints its help for
    // what the user meant as an abort.
    const abort = () => process.exit(1);
    const specifier = await (0, prompt_helpers_1.selectPrompt)({
        message: selectionMessage,
        choices: [
            ...semver_1.RELEASE_TYPES,
            { value: 'custom', label: 'Custom exact version' },
        ],
        onCancel: abort,
    });
    if (specifier !== 'custom') {
        return specifier;
    }
    return (0, prompt_helpers_1.textPrompt)({
        message: customVersionMessage,
        validate: (input) => (0, semver_1.valid)(input) ? undefined : 'Please enter a valid semver version',
        onCancel: abort,
    });
}
