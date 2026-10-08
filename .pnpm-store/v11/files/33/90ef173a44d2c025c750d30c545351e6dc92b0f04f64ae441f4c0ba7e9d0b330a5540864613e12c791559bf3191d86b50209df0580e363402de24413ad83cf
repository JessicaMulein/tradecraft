"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installGeneratorOutputCapture = installGeneratorOutputCapture;
exports.withGeneratorOutputCapture = withGeneratorOutputCapture;
const node_util_1 = require("node:util");
const logger_1 = require("../../../utils/logger");
const CONSOLE_METHODS = [
    'log',
    'warn',
    'error',
    'info',
    'debug',
];
// Marks `console[method]` as a wrapper installed by this module. Seeing it on
// entry means the previous install never restored — refuse rather than layer,
// otherwise the leak compounds silently into a wrapper-wrapping-a-wrapper.
const CAPTURED_MARKER = Symbol.for('nx-migrate.generator-output-captured');
const NOOP_CAPTURE = {
    flush: () => '',
    restore: () => { },
};
function installGeneratorOutputCapture() {
    // Refuse to layer if the previous install never restored. Returns a noop
    // handle so callers' `flush()` / `restore()` calls remain safe.
    for (const method of CONSOLE_METHODS) {
        if (console[method][CAPTURED_MARKER]) {
            logger_1.logger.verbose(`nx migrate: refusing to layer a second generator-output capture; the previous one was not restored. This typically means a caller skipped its \`try/finally\`. The inner caller's \`flush()\` will return empty, but its console output is still being captured by the outer install.`);
            return NOOP_CAPTURE;
        }
    }
    const buffer = [];
    const originals = new Map();
    for (const method of CONSOLE_METHODS) {
        originals.set(method, console[method]);
        const original = console[method].bind(console);
        const wrapper = ((...args) => {
            original(...args);
            try {
                buffer.push((0, node_util_1.format)(...args));
            }
            catch {
                // `format` is robust against the common pathologies but a user arg
                // with a throwing `toString()` would otherwise turn a benign
                // `console.log(...)` into a generator crash.
            }
        });
        Object.defineProperty(wrapper, CAPTURED_MARKER, {
            value: true,
            enumerable: false,
            configurable: true,
            writable: false,
        });
        console[method] = wrapper;
    }
    let restored = false;
    return {
        flush() {
            return buffer.join('\n');
        },
        restore() {
            if (restored)
                return;
            restored = true;
            for (const [method, fn] of originals) {
                console[method] = fn;
            }
        },
    };
}
/**
 * Convenience wrapper that installs the capture, runs `fn`, restores on
 * completion or throw, and returns the captured logs alongside `fn`'s value.
 * Throws from `fn` propagate with the captured logs attached as
 * `(err as any).capturedLogs` — the most useful diagnostic when a generator
 * crashes mid-output.
 */
async function withGeneratorOutputCapture(fn) {
    const capture = installGeneratorOutputCapture();
    try {
        const result = await fn();
        return { result, logs: capture.flush() };
    }
    catch (err) {
        if (err && typeof err === 'object') {
            // A frozen / sealed / non-extensible error would make this throw a
            // TypeError under TS-emitted strict-mode code, masking the original
            // generator error. Swallow that failure; the diagnostic is best-effort.
            try {
                err.capturedLogs = capture.flush();
            }
            catch {
                /* attachment failed; preserve the original error */
            }
        }
        throw err;
    }
    finally {
        capture.restore();
    }
}
