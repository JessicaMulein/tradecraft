"use strict";
var _SpinnerManager_instances, _SpinnerManager_ora, _SpinnerManager_prefix, _SpinnerManager_skipNonTtyLogging, _SpinnerManager_createOra, _SpinnerManager_handleNonTty;
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalSpinner = exports.SHOULD_SHOW_SPINNERS = void 0;
const tslib_1 = require("tslib");
const ora_1 = tslib_1.__importDefault(require("ora"));
const is_ci_1 = require("./is-ci");
exports.SHOULD_SHOW_SPINNERS = process.stdout.isTTY && !(0, is_ci_1.isCI)();
class SpinnerManager {
    constructor() {
        _SpinnerManager_instances.add(this);
        _SpinnerManager_ora.set(this, void 0);
        _SpinnerManager_prefix.set(this, void 0);
        _SpinnerManager_skipNonTtyLogging.set(this, false);
    }
    start(text, prefix, opts) {
        tslib_1.__classPrivateFieldSet(this, _SpinnerManager_skipNonTtyLogging, opts?.skipNonTtyLogging ?? false, "f");
        if (tslib_1.__classPrivateFieldGet(this, _SpinnerManager_instances, "m", _SpinnerManager_handleNonTty).call(this, text)) {
            return this;
        }
        if (prefix !== undefined) {
            tslib_1.__classPrivateFieldSet(this, _SpinnerManager_prefix, prefix, "f");
        }
        if (tslib_1.__classPrivateFieldGet(this, _SpinnerManager_ora, "f")) {
            tslib_1.__classPrivateFieldGet(this, _SpinnerManager_ora, "f").text = text;
            tslib_1.__classPrivateFieldGet(this, _SpinnerManager_ora, "f").prefixText = tslib_1.__classPrivateFieldGet(this, _SpinnerManager_prefix, "f");
        }
        else {
            tslib_1.__classPrivateFieldGet(this, _SpinnerManager_instances, "m", _SpinnerManager_createOra).call(this, text);
        }
        tslib_1.__classPrivateFieldGet(this, _SpinnerManager_ora, "f").start();
        return this;
    }
    succeed(text) {
        if (tslib_1.__classPrivateFieldGet(this, _SpinnerManager_instances, "m", _SpinnerManager_handleNonTty).call(this, text)) {
            return;
        }
        tslib_1.__classPrivateFieldGet(this, _SpinnerManager_ora, "f")?.succeed(text);
    }
    stop() {
        tslib_1.__classPrivateFieldGet(this, _SpinnerManager_ora, "f")?.stop();
    }
    fail(text) {
        if (tslib_1.__classPrivateFieldGet(this, _SpinnerManager_instances, "m", _SpinnerManager_handleNonTty).call(this, text)) {
            return;
        }
        tslib_1.__classPrivateFieldGet(this, _SpinnerManager_ora, "f")?.fail(text);
    }
    updateText(text) {
        if (tslib_1.__classPrivateFieldGet(this, _SpinnerManager_ora, "f")) {
            tslib_1.__classPrivateFieldGet(this, _SpinnerManager_ora, "f").text = text;
        }
        else if (exports.SHOULD_SHOW_SPINNERS) {
            tslib_1.__classPrivateFieldGet(this, _SpinnerManager_instances, "m", _SpinnerManager_createOra).call(this, text);
        }
    }
    isSpinning() {
        return tslib_1.__classPrivateFieldGet(this, _SpinnerManager_ora, "f")?.isSpinning ?? false;
    }
}
_SpinnerManager_ora = new WeakMap(), _SpinnerManager_prefix = new WeakMap(), _SpinnerManager_skipNonTtyLogging = new WeakMap(), _SpinnerManager_instances = new WeakSet(), _SpinnerManager_createOra = function _SpinnerManager_createOra(text) {
    tslib_1.__classPrivateFieldSet(this, _SpinnerManager_ora, (0, ora_1.default)({
        text: text,
        prefixText: tslib_1.__classPrivateFieldGet(this, _SpinnerManager_prefix, "f"),
        hideCursor: false,
        discardStdin: false,
    }), "f");
}, _SpinnerManager_handleNonTty = function _SpinnerManager_handleNonTty(text) {
    if (exports.SHOULD_SHOW_SPINNERS) {
        return false;
    }
    if (!tslib_1.__classPrivateFieldGet(this, _SpinnerManager_skipNonTtyLogging, "f") && text) {
        console.warn(text);
    }
    return true;
};
exports.globalSpinner = new SpinnerManager();
