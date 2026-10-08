"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PseudoTtyProcessWithSend = exports.PseudoTtyProcess = exports.PseudoTerminal = void 0;
exports.createPseudoTerminal = createPseudoTerminal;
const tslib_1 = require("tslib");
const os = tslib_1.__importStar(require("os"));
const socket_utils_1 = require("../daemon/socket-utils");
const native_1 = require("../native");
const output_1 = require("../utils/output");
const pseudo_ipc_1 = require("./pseudo-ipc");
const exit_codes_1 = require("../utils/exit-codes");
// Kill any children still alive when Nx exits. Terminals remove themselves once
// their children exit (see releaseChild), so finished runs skip a per-terminal scan.
const activePseudoTerminals = new Set();
process.on('exit', (code) => {
    activePseudoTerminals.forEach((t) => t.shutdown(code));
});
function createPseudoTerminal(skipSupportCheck = false) {
    if (!skipSupportCheck && !PseudoTerminal.isSupported()) {
        throw new Error('Pseudo terminal is not supported on this platform.');
    }
    const pseudoTerminal = new PseudoTerminal(new native_1.RustPseudoTerminal());
    activePseudoTerminals.add(pseudoTerminal);
    return pseudoTerminal;
}
let id = 0;
class PseudoTerminal {
    static isSupported() {
        return process.stdout.isTTY && supportedPtyPlatform();
    }
    constructor(rustPseudoTerminal) {
        this.rustPseudoTerminal = rustPseudoTerminal;
        this.pseudoIPCPath = (0, socket_utils_1.getForkedProcessOsSocketPath)(process.pid.toString() + '-' + id++);
        this.pseudoIPC = new pseudo_ipc_1.PseudoIPCServer(this.pseudoIPCPath);
        this.initialized = false;
        this.childProcesses = new Set();
    }
    async init() {
        if (this.initialized) {
            return;
        }
        await this.pseudoIPC.init();
        this.initialized = true;
    }
    shutdown(code) {
        // Called from process.on('exit') — must be synchronous/best-effort.
        // Use fire-and-forget killProcessTree, not the async graceful variant.
        for (const cp of this.childProcesses) {
            try {
                const pid = cp.getPid();
                if (pid) {
                    (0, native_1.killProcessTree)(pid, (0, exit_codes_1.codeToSignal)(code));
                }
            }
            catch { }
        }
        if (this.initialized) {
            this.pseudoIPC.close();
        }
    }
    // Once all children have exited, drop the process-exit handler and close IPC.
    releaseChild(cp) {
        this.childProcesses.delete(cp);
        if (this.childProcesses.size === 0) {
            activePseudoTerminals.delete(this);
            if (this.initialized) {
                this.pseudoIPC.close();
                this.initialized = false;
            }
        }
    }
    runCommand(command, { cwd, execArgv, jsEnv, quiet, tty, } = {}) {
        const cp = new PseudoTtyProcess(this.rustPseudoTerminal, this.rustPseudoTerminal.runCommand(command, cwd, jsEnv, execArgv, quiet, tty), quiet);
        this.childProcesses.add(cp);
        cp.onExit(() => this.releaseChild(cp));
        return cp;
    }
    async fork(id, script, { cwd, execArgv, jsEnv, quiet, commandLabel, }) {
        if (!this.initialized) {
            throw new Error('Call init() before forking processes');
        }
        const cp = new PseudoTtyProcessWithSend(this.rustPseudoTerminal, this.rustPseudoTerminal.fork(id, script, this.pseudoIPCPath, cwd, jsEnv, execArgv, quiet, commandLabel), id, this.pseudoIPC, quiet);
        this.childProcesses.add(cp);
        cp.onExit(() => this.releaseChild(cp));
        await this.pseudoIPC.waitForChildReady(id);
        return cp;
    }
    sendMessageToChildren(message) {
        this.pseudoIPC.sendMessageToChildren(message);
    }
    onMessageFromChildren(callback) {
        this.pseudoIPC.onMessageFromChildren(callback);
    }
}
exports.PseudoTerminal = PseudoTerminal;
class PseudoTtyProcess {
    constructor(rustPseudoTerminal, childProcess, 
    /**
     * Whether the native side is suppressing this task's output. When it is
     * not, Rust writes each chunk straight to our stdout, so `CLIOutput` has to
     * be told - it never sees those writes and would otherwise assume the
     * cursor is still at a line start.
     */
    quiet = false) {
        this.rustPseudoTerminal = rustPseudoTerminal;
        this.childProcess = childProcess;
        this.quiet = quiet;
        this.isAlive = true;
        this.exitCallbacks = [];
        this.outputCallbacks = [];
        this.terminalOutputChunks = [];
        childProcess.onOutput((chunk) => {
            if (!this.quiet) {
                output_1.output.noteExternalWrite(chunk);
            }
            this.terminalOutputChunks.push(chunk);
            this.outputCallbacks.forEach((cb) => cb(chunk));
        });
        childProcess.onExit((message) => {
            this.isAlive = false;
            const code = (0, exit_codes_1.messageToCode)(message);
            childProcess.cleanup();
            const terminalOutput = this.terminalOutputChunks.join('');
            this.terminalOutputChunks = [];
            this.exitCallbacks.forEach((cb) => cb(code, terminalOutput));
        });
    }
    async getResults() {
        return new Promise((res) => {
            this.onExit((code, terminalOutput) => {
                res({ code, terminalOutput });
            });
        });
    }
    onExit(callback) {
        this.exitCallbacks.push(callback);
    }
    onOutput(callback) {
        this.outputCallbacks.push(callback);
    }
    getPid() {
        return this.childProcess.getPid();
    }
    async kill(s) {
        if (this.isAlive) {
            this.isAlive = false;
            const pid = this.childProcess.getPid();
            // Gracefully kill the entire process tree. This snapshots the tree
            // BEFORE sending signals, so even if the root exits quickly from
            // the signal, all descendants are already tracked and will be
            // cleaned up (including any reparented to init/PID 1).
            if (pid) {
                await (0, native_1.killProcessTreeGraceful)(pid, s || 'SIGTERM');
            }
            else {
                try {
                    this.childProcess.kill(s || 'SIGTERM');
                }
                catch {
                    // child may have already exited
                }
            }
        }
    }
    getPtyHandles() {
        return this.childProcess.getPtyHandles();
    }
}
exports.PseudoTtyProcess = PseudoTtyProcess;
class PseudoTtyProcessWithSend extends PseudoTtyProcess {
    constructor(rustPseudoTerminal, _childProcess, id, pseudoIpc, quiet = false) {
        super(rustPseudoTerminal, _childProcess, quiet);
        this.rustPseudoTerminal = rustPseudoTerminal;
        this.id = id;
        this.pseudoIpc = pseudoIpc;
    }
    send(message) {
        this.pseudoIpc.sendMessageToChild(this.id, message);
    }
}
exports.PseudoTtyProcessWithSend = PseudoTtyProcessWithSend;
function supportedPtyPlatform() {
    if (native_1.IS_WASM) {
        return false;
    }
    if (process.platform !== 'win32') {
        return true;
    }
    // TODO: Re-enable Windows support when it's stable
    // Currently, there's an issue with control chars.
    // See: https://github.com/nrwl/nx/issues/22358
    if (process.env.NX_WINDOWS_PTY_SUPPORT !== 'true') {
        return false;
    }
    let windowsVersion = os.release().split('.');
    let windowsBuild = windowsVersion[2];
    if (!windowsBuild) {
        return false;
    }
    // Mininum supported Windows version:
    // https://en.wikipedia.org/wiki/Windows_10,_version_1809
    // https://learn.microsoft.com/en-us/windows/console/createpseudoconsole#requirements
    if (+windowsBuild < 17763) {
        return false;
    }
    else {
        return true;
    }
}
