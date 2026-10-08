import { CommandModule } from 'yargs';
declare const SHELL_CHOICES: readonly ['bash', 'zsh', 'fish', 'powershell'];
type Shell = (typeof SHELL_CHOICES)[number];
interface CompletionArgs {
    shell?: Shell;
    force?: boolean;
    stdout?: boolean;
}
export declare const yargsCompletionCommand: CommandModule<{}, CompletionArgs>;
export {};
