import { spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline/promises";
import { createDefaultSecretStoreRegistry, type SecretStoreRegistry } from "../auth/keychain.js";
import type { FetchLike } from "../auth/oauth.js";
import { AuthService, defaultSdkFactory, type SdkFactory } from "../auth/service.js";
import { resolveCanonicalCwd } from "../auth/store.js";
import { CliError } from "../core/errors.js";
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

export function defaultOpenBrowser(url: string): Promise<void> {
  return new Promise((resolve) => {
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => resolve());
    child.unref();
    resolve();
  });
}

export class CliContext {
  public readonly cwd: string;
  public readonly env: NodeJS.ProcessEnv;
  public readonly options: GlobalCliOptions;
  public readonly isInteractive: boolean;
  public readonly output: OutputWriter;
  public readonly authService: AuthService;
  public readonly fetchImpl: FetchLike;
  public readonly sleepFn?: (ms: number) => Promise<void>;
  private readonly stdinText?: string;
  private readonly promptFn?: (question: string) => Promise<string>;

  constructor(options: GlobalCliOptions, deps: CliDependencies = {}) {
    const baseCwd = options.cwd ?? deps.cwd ?? process.cwd();
    this.cwd = resolveCanonicalCwd(baseCwd);
    this.env = deps.env ?? process.env;
    this.options = options;
    const ttyDefault = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const hasTty = deps.isTTY ?? ttyDefault;
    this.isInteractive = hasTty && !options.nonInteractive && this.env.CI !== "true";
    this.output = new OutputWriter({
      jsonMode: Boolean(options.json),
      stdout: deps.stdout ?? process.stdout,
      stderr: deps.stderr ?? process.stderr,
    });
    const stores = deps.stores ?? createDefaultSecretStoreRegistry();
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.authService = new AuthService({
      stores,
      sdkFactory: deps.sdkFactory ?? defaultSdkFactory,
      fetchImpl: this.fetchImpl,
      openBrowser: deps.openBrowser ?? defaultOpenBrowser,
    });
    this.stdinText = deps.stdinText;
    this.promptFn = deps.promptFn;
    this.sleepFn = deps.sleepFn;
  }

  public async readStdin(): Promise<string> {
    if (this.stdinText !== undefined) {
      return this.stdinText;
    }
    if (process.stdin.isTTY) {
      throw new CliError("VALIDATION_ERROR", "Expected piped stdin input, but stdin is an interactive TTY.");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  public readFileUtf8(filePath: string, flagName: string): string {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch (cause) {
      throw new CliError("VALIDATION_ERROR", `Unable to read ${flagName} file '${filePath}'.`, { cause });
    }
  }

  public resolveMarkdownInput(params: {
    inlineValue?: string;
    filePath?: string;
    inlineFlag: string;
    fileFlag: string;
  }): string | undefined {
    if (params.inlineValue !== undefined && params.filePath !== undefined) {
      throw new CliError("VALIDATION_ERROR", `Provide either ${params.inlineFlag} or ${params.fileFlag}, not both.`);
    }
    if (params.filePath !== undefined) {
      return this.readFileUtf8(params.filePath, params.fileFlag);
    }
    return params.inlineValue;
  }

  public async promptRequired(question: string, missingHint: string): Promise<string> {
    if (!this.isInteractive) {
      throw new CliError("VALIDATION_ERROR", `Non-interactive mode cannot prompt: ${missingHint}`);
    }
    if (this.promptFn) {
      return (await this.promptFn(question)).trim();
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
      const ans = await rl.question(question);
      return ans.trim();
    } finally {
      rl.close();
    }
  }

  public requireDestructiveConfirmation(confirmedByFlag: boolean, actionDescription: string): void {
    if (this.options.dryRun || confirmedByFlag) {
      return;
    }
    throw new CliError(
      "VALIDATION_ERROR",
      `Destructive operation (${actionDescription}) requires explicit '--yes' flag (or '--dry-run' to preview).`,
    );
  }
}
