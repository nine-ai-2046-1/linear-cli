import { spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline/promises";
import { createDefaultSecretStoreRegistry } from "../auth/keychain.js";
import { AuthService, defaultSdkFactory } from "../auth/service.js";
import { resolveCanonicalCwd } from "../auth/store.js";
import { CliError } from "../core/errors.js";
import { OutputWriter } from "../core/output.js";
export function defaultOpenBrowser(url) {
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
    cwd;
    env;
    options;
    isInteractive;
    output;
    authService;
    fetchImpl;
    sleepFn;
    stdinText;
    promptFn;
    constructor(options, deps = {}) {
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
    async readStdin() {
        if (this.stdinText !== undefined) {
            return this.stdinText;
        }
        if (process.stdin.isTTY) {
            throw new CliError("VALIDATION_ERROR", "Expected piped stdin input, but stdin is an interactive TTY.");
        }
        const chunks = [];
        for await (const chunk of process.stdin) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        }
        return Buffer.concat(chunks).toString("utf8");
    }
    readFileUtf8(filePath, flagName) {
        try {
            return fs.readFileSync(filePath, "utf8");
        }
        catch (cause) {
            throw new CliError("VALIDATION_ERROR", `Unable to read ${flagName} file '${filePath}'.`, { cause });
        }
    }
    resolveMarkdownInput(params) {
        if (params.inlineValue !== undefined && params.filePath !== undefined) {
            throw new CliError("VALIDATION_ERROR", `Provide either ${params.inlineFlag} or ${params.fileFlag}, not both.`);
        }
        if (params.filePath !== undefined) {
            return this.readFileUtf8(params.filePath, params.fileFlag);
        }
        return params.inlineValue;
    }
    async promptRequired(question, missingHint) {
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
        }
        finally {
            rl.close();
        }
    }
    requireDestructiveConfirmation(confirmedByFlag, actionDescription) {
        if (this.options.dryRun || confirmedByFlag) {
            return;
        }
        throw new CliError("VALIDATION_ERROR", `Destructive operation (${actionDescription}) requires explicit '--yes' flag (or '--dry-run' to preview).`);
    }
}
//# sourceMappingURL=context.js.map