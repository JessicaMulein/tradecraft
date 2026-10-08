"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectPrompt = selectPrompt;
exports.confirmationPrompt = confirmationPrompt;
exports.textPrompt = textPrompt;
exports.multiselectPrompt = multiselectPrompt;
const exit_codes_1 = require("./exit-codes");
/**
 * `@clack/prompts` is ESM-only. A static import would compile to `require()`
 * under CommonJS emit and throw ERR_REQUIRE_ESM; `module: nodenext` preserves
 * this dynamic form.
 */
async function prompts() {
    return await import('@clack/prompts');
}
function toChoice(choice) {
    return typeof choice === 'string' ? { value: choice } : choice;
}
async function selectPrompt(options) {
    if (options.skip) {
        return options.skippedValue ?? toChoice(options.choices[0]).value;
    }
    const choices = options.choices.map(toChoice);
    const { autocomplete, isCancel } = await prompts();
    const answer = await autocomplete({
        message: options.message,
        // `Option<Value>` is conditional on `Value extends Primitive`, which
        // TypeScript cannot resolve while `T` is still generic.
        options: choices.map((c) => ({
            value: c.value,
            label: c.label ?? c.value,
            ...(c.hint ? { hint: c.hint } : {}),
        })),
        initialValue: options.initial ?? choices[0].value,
        // A no-match filter leaves clack with an empty selection, and Enter then
        // submits `undefined` rather than blocking. `isCancel` does not catch
        // that, so downstream comparisons would silently take a wrong branch.
        validate: (value) => value === undefined ? 'Pick one of the listed options' : undefined,
    });
    if (isCancel(answer)) {
        if (options.onCancel) {
            return options.onCancel();
        }
        // No handler means the user aborted the command.
        (0, exit_codes_1.exitAsInterrupted)();
    }
    return answer;
}
async function confirmationPrompt(options) {
    const answer = await selectPrompt({
        message: options.message,
        choices: [{ value: 'Yes' }, { value: 'No' }],
        initial: options.initial === false ? 'No' : 'Yes',
        skip: options.skip,
        skippedValue: options.skippedValue === undefined
            ? undefined
            : options.skippedValue
                ? 'Yes'
                : 'No',
        onCancel: options.onCancel
            ? () => (options.onCancel() ? 'Yes' : 'No')
            : undefined,
    });
    return answer === 'Yes';
}
async function textPrompt(options) {
    if (options.skip) {
        return options.skippedValue ?? options.initialValue ?? '';
    }
    const { text, isCancel } = await prompts();
    const answer = await text({
        message: options.message,
        initialValue: options.initialValue,
        placeholder: options.placeholder,
        validate: options.validate
            ? (value) => options.validate(value ?? '')
            : undefined,
    });
    if (isCancel(answer)) {
        if (options.onCancel) {
            return options.onCancel();
        }
        // No handler means the user aborted the command.
        (0, exit_codes_1.exitAsInterrupted)();
    }
    return answer;
}
async function multiselectPrompt(options) {
    const choices = options.choices.map(toChoice);
    const { multiselect, isCancel } = await prompts();
    const answer = await multiselect({
        message: options.message,
        options: choices.map((c) => ({
            value: c.value,
            label: c.label ?? c.value,
            ...(c.hint ? { hint: c.hint } : {}),
        })),
        required: options.required ?? false,
        initialValues: options.initialValues
            ? [...options.initialValues]
            : undefined,
    });
    if (isCancel(answer)) {
        if (options.onCancel) {
            return options.onCancel();
        }
        // No handler means the user aborted the command.
        (0, exit_codes_1.exitAsInterrupted)();
    }
    return answer;
}
