import { type SecretStoreRegistry } from "../auth/keychain.js";
import type { FetchLike } from "../auth/oauth.js";
import { AuthService, type SdkFactory } from "../auth/service.js";
import { OutputWriter, type WritableLike } from "../core/output.js";
export interface GlobalCliOptions {
    json?: boolean;
    nonInteractive?: boolean;
    dryRun?: boolean;
    cwd?: string;
    expectWorkspace?: string;
    expectUser?: string;
}
export interface CliDependencies {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdinText?: string;
    isTTY?: boolean;
    stdout?: WritableLike;
    stderr?: WritableLike;
    stores?: SecretStoreRegistry;
    sdkFactory?: SdkFactory;
    fetchImpl?: FetchLike;
    openBrowser?: (url: string) => Promise<void> | void;
    promptFn?: (question: string) => Promise<string>;
    sleepFn?: (ms: number) => Promise<void>;
}
export declare function defaultOpenBrowser(url: string): Promise<void>;
export declare class CliContext {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly options: GlobalCliOptions;
    readonly isInteractive: boolean;
    readonly output: OutputWriter;
    readonly authService: AuthService;
    readonly fetchImpl: FetchLike;
    readonly sleepFn?: (ms: number) => Promise<void>;
    private readonly stdinText?;
    private readonly promptFn?;
    constructor(options: GlobalCliOptions, deps?: CliDependencies);
    readStdin(): Promise<string>;
    readFileUtf8(filePath: string, flagName: string): string;
    resolveMarkdownInput(params: {
        inlineValue?: string;
        filePath?: string;
        inlineFlag: string;
        fileFlag: string;
    }): string | undefined;
    promptRequired(question: string, missingHint: string): Promise<string>;
    requireDestructiveConfirmation(confirmedByFlag: boolean, actionDescription: string): void;
}
