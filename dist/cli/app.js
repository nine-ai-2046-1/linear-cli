import { Command, CommanderError } from "commander";
import { CliError, ExitCode, normalizeError } from "../core/errors.js";
import { OutputWriter } from "../core/output.js";
import { registerAdvancedCommands } from "../modules/advanced/commands.js";
import { registerAuthCommands } from "../modules/auth/commands.js";
import { registerCollaborationCommands } from "../modules/collaboration/commands.js";
import { registerIssueCommands } from "../modules/issues/commands.js";
import { registerMetadataCommands } from "../modules/metadata/commands.js";
import { registerPlanningCommands } from "../modules/planning/commands.js";
import { registerWorkspaceCommands } from "../modules/workspace/commands.js";
import { CLI_VERSION } from "../version.js";
import { CliContext } from "./context.js";
const EXTRA_REGISTRARS = [];
export function registerDomainModule(registrar) {
    if (!EXTRA_REGISTRARS.includes(registrar)) {
        EXTRA_REGISTRARS.push(registrar);
    }
}
export function createProgram(deps = {}) {
    const program = new Command();
    let cachedContext = null;
    // Commander routes help-on-error (`help({error:true})`: bare `linear`, `linear auth`)
    // through writeErr. Capture it so runCli can replay the help text on stdout while
    // still emitting its own deterministic error on stderr.
    const stderrBuffer = [];
    const getContext = () => {
        if (!cachedContext) {
            const opts = program.opts();
            cachedContext = new CliContext(opts, deps);
        }
        return cachedContext;
    };
    program
        .name("linear")
        .description("Agent-ready Linear CLI with strict per-folder authentication")
        .addHelpText("after", `\nVersion: ${CLI_VERSION} (use 'linear --version')`)
        .option("--json", "Output deterministic JSON to stdout")
        .option("--non-interactive", "Fail immediately instead of prompting for user input")
        .option("--dry-run", "Preview write operations without executing Linear mutations")
        .option("--cwd <dir>", "Execute against the specified working directory's .linear/auth.json")
        .option("--expect-workspace <workspace>", "Require active folder workspace ID, slug, or name to match")
        .option("--expect-user <user>", "Require active folder user ID, email, or name to match");
    program.exitOverride();
    program.configureOutput({
        writeOut: (str) => (deps.stdout ?? process.stdout).write(str),
        writeErr: (str) => {
            // Capture commander's help-on-error text (`help({error:true})`: bare `linear`,
            // `linear auth`) so runCli can replay it on stdout. Other commander error text
            // is discarded here in favor of the deterministic error runCli emits.
            stderrBuffer.push(str);
        },
    });
    registerAuthCommands(program, getContext);
    registerWorkspaceCommands(program, getContext);
    registerIssueCommands(program, getContext);
    registerCollaborationCommands(program, getContext);
    registerPlanningCommands(program, getContext);
    registerMetadataCommands(program, getContext);
    registerAdvancedCommands(program, getContext);
    for (const reg of EXTRA_REGISTRARS) {
        reg(program, getContext);
    }
    return { program, getContext, stderrBuffer };
}
/**
 * `--version` is intentionally NOT registered as a program option: commander would
 * consume it anywhere in argv and hijack subcommand options such as
 * `linear release create --version 1.2.3`. Instead we detect a standalone
 * version request (flag with no value following it) before parsing.
 */
/** Global flags defined on the root program that consume a separate value argument. */
const GLOBAL_VALUE_FLAGS = new Set(["--cwd", "--expect-workspace", "--expect-user"]);
function isVersionRequest(argv) {
    const idx = argv.findIndex((a) => a === "--version" || a === "-V");
    if (idx === -1)
        return false;
    // Only a leading version flag (possibly after global flags) is the CLI version;
    // a `--version` after a subcommand with a value is a subcommand option.
    let expectValueFor = null;
    for (const arg of argv.slice(0, idx)) {
        if (expectValueFor !== null) {
            expectValueFor = null; // this arg is the value of the preceding global flag
            continue;
        }
        if (arg.startsWith("-")) {
            const eq = arg.indexOf("=");
            const name = eq === -1 ? arg : arg.slice(0, eq);
            expectValueFor = eq === -1 && GLOBAL_VALUE_FLAGS.has(name) ? name : null;
            continue;
        }
        return false; // a subcommand/operand appears before --version
    }
    const next = argv[idx + 1];
    return next === undefined || next.startsWith("-");
}
export async function runCli(argv, deps = {}) {
    const jsonRequested = argv.includes("--json");
    const fallbackWriter = new OutputWriter({
        jsonMode: jsonRequested,
        stdout: deps.stdout ?? process.stdout,
        stderr: deps.stderr ?? process.stderr,
    });
    const { program, getContext, stderrBuffer } = createProgram(deps);
    try {
        if (isVersionRequest(argv)) {
            (deps.stdout ?? process.stdout).write(`${CLI_VERSION}\n`);
            return ExitCode.SUCCESS;
        }
        await program.parseAsync(argv, { from: "user" });
        return ExitCode.SUCCESS;
    }
    catch (err) {
        if (err instanceof CommanderError) {
            if (err.code === "commander.helpDisplayed" || err.code === "commander.version") {
                return ExitCode.SUCCESS;
            }
            // commander has two help exit paths. The `--help` FLAG ends in
            // 'commander.helpDisplayed' (handled above). The `help` SUBCOMMAND, a bare
            // `linear`, and a group without a subcommand (`linear auth`) end in
            // 'commander.help' — help text has already been written (to writeErr for the
            // error variants) by then.
            // exitCode 0 = help was requested explicitly (`linear help [command]`).
            if (err.code === "commander.help" && err.exitCode === 0) {
                return ExitCode.SUCCESS;
            }
            // exitCode 1 = help was shown because a command/subcommand was missing:
            // replay that help on stdout, then report a usage error on stderr.
            if (err.code === "commander.help") {
                const helpText = stderrBuffer.join("");
                if (helpText) {
                    (deps.stdout ?? process.stdout).write(helpText);
                }
            }
            // Missing command/subcommand is a usage error, not an internal failure.
            const message = err.code === "commander.help"
                ? "Missing command or subcommand. Run 'linear --help' to see available commands."
                : err.message.replace(/^error:\s*/i, "");
            const cliErr = new CliError("VALIDATION_ERROR", message);
            let writer = fallbackWriter;
            try {
                writer = getContext().output;
            }
            catch {
                // use fallbackWriter
            }
            writer.error(cliErr);
            return cliErr.exitCode;
        }
        const cliErr = normalizeError(err);
        let writer = fallbackWriter;
        try {
            writer = getContext().output;
        }
        catch {
            // use fallbackWriter
        }
        writer.error(cliErr);
        return cliErr.exitCode;
    }
}
//# sourceMappingURL=app.js.map