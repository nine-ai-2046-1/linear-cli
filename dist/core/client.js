import { CliError } from "./errors.js";
import { executeWithGuardrails } from "./retry.js";
function matchesWorkspace(binding, expected) {
    const norm = expected.trim().toLowerCase();
    return (binding.workspace.id.toLowerCase() === norm ||
        binding.workspace.urlKey.toLowerCase() === norm ||
        binding.workspace.name.toLowerCase() === norm);
}
function matchesUser(binding, expected) {
    const norm = expected.trim().toLowerCase();
    return (binding.account.id.toLowerCase() === norm ||
        (binding.account.email?.toLowerCase() ?? "") === norm ||
        binding.account.displayName.toLowerCase() === norm ||
        binding.account.name.toLowerCase() === norm);
}
export function assertExpectedIdentity(binding, ctx) {
    if (ctx.options.expectWorkspace && !matchesWorkspace(binding, ctx.options.expectWorkspace)) {
        throw new CliError("FORBIDDEN", `Active folder workspace '${binding.workspace.urlKey}' (${binding.workspace.name}) does not match --expect-workspace '${ctx.options.expectWorkspace}'.`, {
            details: {
                expectedWorkspace: ctx.options.expectWorkspace,
                actualWorkspace: binding.workspace,
            },
        });
    }
    if (ctx.options.expectUser && !matchesUser(binding, ctx.options.expectUser)) {
        throw new CliError("FORBIDDEN", `Active folder user '${binding.account.email ?? binding.account.name}' does not match --expect-user '${ctx.options.expectUser}'.`, {
            details: {
                expectedUser: ctx.options.expectUser,
                actualAccount: binding.account,
            },
        });
    }
}
export async function openVerifiedSession(ctx) {
    let active = await ctx.authService.getActiveClient(ctx.cwd);
    assertExpectedIdentity(active.binding, ctx);
    return {
        get client() {
            return active.client;
        },
        get binding() {
            return active.binding;
        },
        get folder() {
            return active.canonicalFolder;
        },
        async run(operationName, kind, fn, timeoutMs) {
            try {
                return await executeWithGuardrails(() => fn(active.client), {
                    kind,
                    operationName,
                    timeoutMs,
                    sleep: ctx.sleepFn,
                });
            }
            catch (err) {
                if (err instanceof CliError &&
                    err.code === "AUTH_REQUIRED" &&
                    active.binding.authType !== "api-key") {
                    active = await ctx.authService.getActiveClient(ctx.cwd, { forceRefresh: true });
                    assertExpectedIdentity(active.binding, ctx);
                    return executeWithGuardrails(() => fn(active.client), {
                        kind,
                        operationName,
                        timeoutMs,
                        sleep: ctx.sleepFn,
                    });
                }
                throw err;
            }
        },
    };
}
//# sourceMappingURL=client.js.map