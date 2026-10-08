"use strict";
// Zero-dep source of truth for --step-action: keeps migrate/run's execution
// chain out of CLI startup for callers that only need the value list or type.
Object.defineProperty(exports, "__esModule", { value: true });
exports.STEP_ACTIONS = void 0;
exports.isStepAction = isStepAction;
/** Allowed values for `--step-action`, the orchestrated reconcile's decision relay. */
exports.STEP_ACTIONS = ['retry', 'skip', 'retry-clean', 'adopt'];
/** Runtime guard backed by {@link STEP_ACTIONS} so the two can't drift apart. */
function isStepAction(value) {
    return exports.STEP_ACTIONS.includes(value);
}
