"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canPrompt = canPrompt;
exports.migrateConfirm = migrateConfirm;
exports.migrateChoice = migrateChoice;
const exit_codes_1 = require("../../utils/exit-codes");
const is_ci_1 = require("../../utils/is-ci");
const output_1 = require("../../utils/output");
const prompt_helpers_1 = require("../../utils/prompt-helpers");
/**
 * Whether `nx migrate` may show interactive prompts: requires a TTY on stdin,
 * not running in CI, and the user not having passed `--no-interactive`.
 */
function canPrompt(interactive) {
    return !!process.stdin.isTTY && !(0, is_ci_1.isCI)() && interactive !== false;
}
/**
 * Aborts the run the way `nx migrate` wants a cancel to look: one notice, then
 * POSIX 130 (128 + SIGINT). The user asked to stop, so there is no state worth
 * preserving.
 */
function cancelMigrate() {
    process.stdout.write('\n');
    output_1.output.warn({ title: 'nx migrate interrupted by user.' });
    (0, exit_codes_1.exitAsInterrupted)();
}
/**
 * Yes/no question for `nx migrate`, aborting the run if the user cancels.
 */
async function migrateConfirm(options) {
    return (0, prompt_helpers_1.confirmationPrompt)({
        message: options.message,
        initial: options.initial,
        onCancel: cancelMigrate,
    });
}
/**
 * Single-choice question for `nx migrate`, aborting the run if the user cancels.
 */
async function migrateChoice(options) {
    return (0, prompt_helpers_1.selectPrompt)({
        message: options.message,
        choices: options.choices,
        initial: options.initial,
        onCancel: cancelMigrate,
    });
}
