import { Serializable } from 'child_process';
import { ChildProcess, RustPseudoTerminal } from '../native';
import { PseudoIPCServer } from './pseudo-ipc';
import { RunningTask } from './running-tasks/running-task';
export declare function createPseudoTerminal(skipSupportCheck?: boolean): PseudoTerminal;
export declare class PseudoTerminal {
    private rustPseudoTerminal;
    private pseudoIPCPath;
    private pseudoIPC;
    private initialized;
    private childProcesses;
    static isSupported(): boolean;
    constructor(rustPseudoTerminal: RustPseudoTerminal);
    init(): Promise<void>;
    shutdown(code: number): void;
    private releaseChild;
    runCommand(command: string, { cwd, execArgv, jsEnv, quiet, tty, }?: {
        cwd?: string;
        execArgv?: string[];
        jsEnv?: Record<string, string>;
        quiet?: boolean;
        tty?: boolean;
    }): PseudoTtyProcess;
    fork(id: string, script: string, { cwd, execArgv, jsEnv, quiet, commandLabel, }: {
        cwd?: string;
        execArgv?: string[];
        jsEnv?: Record<string, string>;
        quiet?: boolean;
        commandLabel?: string;
    }): Promise<PseudoTtyProcessWithSend>;
    sendMessageToChildren(message: Serializable): void;
    onMessageFromChildren(callback: (message: Serializable) => void): void;
}
export declare class PseudoTtyProcess implements RunningTask {
    rustPseudoTerminal: RustPseudoTerminal;
    private childProcess;
    /**
     * Whether the native side is suppressing this task's output. When it is
     * not, Rust writes each chunk straight to our stdout, so `CLIOutput` has to
     * be told - it never sees those writes and would otherwise assume the
     * cursor is still at a line start.
     */
    private readonly quiet;
    isAlive: boolean;
    private exitCallbacks;
    private outputCallbacks;
    private terminalOutputChunks;
    constructor(rustPseudoTerminal: RustPseudoTerminal, childProcess: ChildProcess, 
    /**
     * Whether the native side is suppressing this task's output. When it is
     * not, Rust writes each chunk straight to our stdout, so `CLIOutput` has to
     * be told - it never sees those writes and would otherwise assume the
     * cursor is still at a line start.
     */
    quiet?: boolean);
    getResults(): Promise<{
        code: number;
        terminalOutput: string;
    }>;
    onExit(callback: (code: number, terminalOutput: string) => void): void;
    onOutput(callback: (message: string) => void): void;
    getPid(): number | undefined;
    kill(s?: NodeJS.Signals): Promise<void>;
    getPtyHandles(): import("../native").ExternalObject<[import("../native").ParserArc, import("../native").WriterArc, import("../native").MasterArc]>;
}
export declare class PseudoTtyProcessWithSend extends PseudoTtyProcess {
    rustPseudoTerminal: RustPseudoTerminal;
    private id;
    private pseudoIpc;
    constructor(rustPseudoTerminal: RustPseudoTerminal, _childProcess: ChildProcess, id: string, pseudoIpc: PseudoIPCServer, quiet?: boolean);
    send(message: Serializable): void;
}
