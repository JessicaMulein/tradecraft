"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldPrintConfigureAiAgentsDisclaimer = shouldPrintConfigureAiAgentsDisclaimer;
const fs_1 = require("fs");
const detect_ai_agent_1 = require("./detect-ai-agent");
const constants_1 = require("./constants");
/**
 * Whether to show the "configure-ai-agents is outdated" banner after a task run.
 */
function shouldPrintConfigureAiAgentsDisclaimer(outdatedAgents, workspaceRoot) {
    if (outdatedAgents.length === 0) {
        return false;
    }
    const detectedAgent = (0, detect_ai_agent_1.detectAiAgent)();
    if (detectedAgent) {
        return outdatedAgents.some((agent) => agent.name === detectedAgent);
    }
    // Unsupported agents (e.g. qwen) cannot be configured via `nx configure-ai-agents`.
    // If the repo already has Nx rules in AGENTS.md, skip the misleading warning.
    const agentsMd = (0, constants_1.agentsMdPath)(workspaceRoot);
    if (!(0, fs_1.existsSync)(agentsMd)) {
        return true;
    }
    try {
        const content = (0, fs_1.readFileSync)(agentsMd, 'utf-8');
        return !constants_1.rulesRegex.test(content);
    }
    catch {
        return true;
    }
}
