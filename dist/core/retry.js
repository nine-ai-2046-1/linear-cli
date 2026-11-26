import { CliError, isTimeoutError, normalizeError } from "./errors.js";
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function withTimeout(promise, timeoutMs) {
    if (!timeoutMs || timeoutMs <= 0) {
        return promise;
    }
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    const err = new Error(`Request timed out after ${timeoutMs}ms`);
                    err.name = "TimeoutError";
                    reject(err);
                }, timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
export async function executeWithGuardrails(fn, options) {
    const maxRetries = options.maxRetries ?? 2;
    const baseDelayMs = options.baseDelayMs ?? 250;
    const sleep = options.sleep ?? defaultSleep;
    let attempt = 0;
    while (true) {
        try {
            return await withTimeout(fn(), options.timeoutMs);
        }
        catch (rawError) {
            if (isTimeoutError(rawError)) {
                if (options.kind === "create") {
                    throw new CliError("OUTCOME_UNKNOWN", `Create operation '${options.operationName}' timed out after dispatch; not retrying automatically to prevent duplicates. Reconcile existing records before retrying.`, {
                        details: { operation: options.operationName },
                        cause: rawError,
                    });
                }
                if (attempt < maxRetries) {
                    attempt += 1;
                    await sleep(baseDelayMs * attempt);
                    continue;
                }
                throw new CliError("NETWORK_ERROR", `Operation '${options.operationName}' timed out after ${attempt + 1} attempt(s).`, { cause: rawError });
            }
            const normalized = normalizeError(rawError);
            if (normalized.code === "RATE_LIMITED" && options.kind !== "create" && attempt < maxRetries) {
                attempt += 1;
                const waitMs = normalized.retryAfterMs ?? baseDelayMs * Math.pow(2, attempt - 1);
                await sleep(Math.min(waitMs, 30_000));
                continue;
            }
            throw normalized;
        }
    }
}
//# sourceMappingURL=retry.js.map