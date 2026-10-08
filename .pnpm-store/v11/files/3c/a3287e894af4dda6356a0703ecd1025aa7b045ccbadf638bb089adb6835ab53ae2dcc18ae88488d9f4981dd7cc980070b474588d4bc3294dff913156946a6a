export interface Choice<T extends string> {
    value: T;
    label?: string;
    hint?: string;
}
/** A bare string is a choice whose label is its value. */
export type ChoiceOrValue<T extends string> = T | Choice<T>;
/**
 * Ctrl+C yields a sentinel rather than throwing. `onCancel` decides what that
 * means for the caller - either a fallback answer or an abort. The default
 * aborts with the POSIX interrupt status.
 */
export type OnCancel<T> = () => T;
export declare function selectPrompt<T extends string>(options: {
    message: string;
    choices: readonly ChoiceOrValue<T>[];
    initial?: T;
    /** Answer without prompting; defaults to the first choice. */
    skip?: boolean;
    skippedValue?: T;
    onCancel?: OnCancel<T>;
}): Promise<T>;
export declare function confirmationPrompt(options: {
    message: string;
    initial?: boolean;
    skip?: boolean;
    skippedValue?: boolean;
    onCancel?: OnCancel<boolean>;
}): Promise<boolean>;
export declare function textPrompt(options: {
    message: string;
    initialValue?: string;
    placeholder?: string;
    /**
     * Runs synchronously; clack does not await validators.
     *
     * Always receives a string. clack validates on Enter *before* it coerces an
     * empty submit to `''`, so it would otherwise hand `undefined` to a prompt
     * declaring no `initialValue`; the wrapper below normalizes that, matching
     * what enquirer passed.
     */
    validate?: (value: string) => string | undefined;
    skip?: boolean;
    skippedValue?: string;
    onCancel?: OnCancel<string>;
}): Promise<string>;
export declare function multiselectPrompt<T extends string>(options: {
    message: string;
    choices: readonly ChoiceOrValue<T>[];
    required?: boolean;
    initialValues?: readonly T[];
    onCancel?: OnCancel<T[]>;
}): Promise<T[]>;
