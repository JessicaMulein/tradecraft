"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.determineAiAgents = determineAiAgents;
const prompt_helpers_1 = require("../../utils/prompt-helpers");
const is_ci_1 = require("../../utils/is-ci");
const utils_1 = require("../../ai/utils");
const detect_ai_agent_1 = require("../../ai/detect-ai-agent");
async function determineAiAgents(aiAgents, interactive) {
    if (aiAgents) {
        const filtered = aiAgents.filter((a) => a !== 'none');
        if (filtered.length > 0) {
            return filtered;
        }
        return [];
    }
    if (interactive === false || (0, is_ci_1.isCI)()) {
        const detected = (0, detect_ai_agent_1.detectAiAgent)();
        return detected ? [detected] : [];
    }
    return await aiAgentsPrompt();
}
async function aiAgentsPrompt() {
    return (0, prompt_helpers_1.multiselectPrompt)({
        message: 'Which AI agents, if any, would you like to set up?',
        choices: utils_1.supportedAgents.map((a) => ({
            value: a,
            label: utils_1.agentDisplayMap[a],
        })),
    });
}
