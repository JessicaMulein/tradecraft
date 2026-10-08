export declare const NX_CLOUD_URL = "https://nx.dev/nx-cloud";
/**
 * Clickable Nx Cloud marketing link for cloud prompt footers. The visible text
 * stays the clean `NX_CLOUD_URL` while clicks carry UTM attribution; terminals
 * without OSC 8 support just render the bare URL (CLOUD-4642). The content tag
 * is per-command because `nx init` and `nx migrate` share a footer but report
 * different commands.
 */
export declare function nxCloudHyperlink(utmContent: string): string;
/**
 * Meta payload types for recordStat telemetry (matches CNW format).
 */
export interface RecordStatMetaStart {
    type: 'start';
    [key: string]: string | boolean;
}
export interface RecordStatMetaComplete {
    type: 'complete';
    [key: string]: string | boolean;
}
export interface RecordStatMetaError {
    type: 'error';
    errorCode: string;
    errorMessage: string;
    [key: string]: string | boolean;
}
export type RecordStatMeta = RecordStatMetaStart | RecordStatMetaComplete | RecordStatMetaError;
export type MessageOptionKey = 'yes' | 'skip' | 'never';
interface MessageData {
    code: string;
    message: string;
    initial: number;
    choices: Array<{
        value: string;
        name: string;
        hint?: string;
    }>;
    footer: string;
    hint?: string;
}
declare const messageOptions: Record<string, MessageData[]>;
export type MessageKey = keyof typeof messageOptions;
export declare class PromptMessages {
    private selectedMessages;
    getPrompt(key: MessageKey): MessageData;
    codeOfSelectedPromptMessage(key: string): string;
}
export declare const messages: PromptMessages;
/**
 * We are incrementing a counter to track how often create-nx-workspace is used in CI
 * vs dev environments. No personal information is collected.
 */
export declare function recordStat(opts: {
    command: string;
    nxVersion: string;
    useCloud: boolean;
    meta?: RecordStatMeta;
}): Promise<void>;
export {};
