import { Choice } from '../../utils/prompt-helpers';
/**
 * Whether `nx migrate` may show interactive prompts: requires a TTY on stdin,
 * not running in CI, and the user not having passed `--no-interactive`.
 */
export declare function canPrompt(interactive: boolean | undefined): boolean;
/**
 * Yes/no question for `nx migrate`, aborting the run if the user cancels.
 */
export declare function migrateConfirm(options: {
    message: string;
    initial?: boolean;
}): Promise<boolean>;
/**
 * Single-choice question for `nx migrate`, aborting the run if the user cancels.
 */
export declare function migrateChoice<T extends string>(options: {
    message: string;
    choices: Choice<T>[];
    initial?: T;
}): Promise<T>;
