/** Allowed values for `--step-action`, the orchestrated reconcile's decision relay. */
export declare const STEP_ACTIONS: readonly ['retry', 'skip', 'retry-clean', 'adopt'];
export type StepAction = (typeof STEP_ACTIONS)[number];
/** Runtime guard backed by {@link STEP_ACTIONS} so the two can't drift apart. */
export declare function isStepAction(value: unknown): value is StepAction;
