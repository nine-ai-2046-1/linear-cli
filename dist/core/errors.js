import { InvalidInputLinearError, LinearError } from "@linear/sdk";
export const ExitCode = {
    SUCCESS: 0,
    INTERNAL_ERROR: 1,
    AUTH_REQUIRED: 2,
    FORBIDDEN: 3,
    NOT_FOUND: 4,
    VALIDATION_ERROR: 5,
    AMBIGUOUS_RESOURCE: 6,
    RATE_LIMITED: 7,
    OUTCOME_UNKNOWN: 8,
    UNSUPPORTED_BY_PUBLIC_API: 9,
    NETWORK_ERROR: 10,
};
const CODE_TO_EXIT = {
    INTERNAL_ERROR: ExitCode.INTERNAL_ERROR,
    AUTH_REQUIRED: ExitCode.AUTH_REQUIRED,
    FORBIDDEN: ExitCode.FORBIDDEN,
    NOT_FOUND: ExitCode.NOT_FOUND,
    VALIDATION_ERROR: ExitCode.VALIDATION_ERROR,
    AMBIGUOUS_RESOURCE: ExitCode.AMBIGUOUS_RESOURCE,
    RATE_LIMITED: ExitCode.RATE_LIMITED,
    OUTCOME_UNKNOWN: ExitCode.OUTCOME_UNKNOWN,
    UNSUPPORTED_BY_PUBLIC_API: ExitCode.UNSUPPORTED_BY_PUBLIC_API,
    NETWORK_ERROR: ExitCode.NETWORK_ERROR,
};
export class CliError extends Error {
    code;
    exitCode;
    details;
    retryAfterMs;
    constructor(code, message, options) {
        super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
        this.name = "CliError";
        this.code = code;
        this.exitCode = CODE_TO_EXIT[code];
        this.details = options?.details;
        this.retryAfterMs = options?.retryAfterMs;
    }
}
export function extractRetryAfterMs(error) {
    if (error instanceof CliError && error.retryAfterMs !== undefined) {
        return error.retryAfterMs;
    }
    const raw = error ?? {};
    const headers = raw.headers ??
        raw.response?.headers ??
        raw.raw?.response?.headers;
    let val;
    if (headers && typeof headers.get === "function") {
        val = headers.get("retry-after");
    }
    else if (headers && typeof headers === "object") {
        const rec = headers;
        val = rec["retry-after"] ?? rec["Retry-After"];
    }
    if (val !== undefined && val !== null && val !== "") {
        const num = Number(val);
        if (Number.isFinite(num) && num >= 0) {
            return Math.round(num * 1000);
        }
    }
    return undefined;
}
export function isTimeoutError(error) {
    if (!error || typeof error !== "object")
        return false;
    const err = error;
    if (err.name === "TimeoutError" || err.name === "AbortError")
        return true;
    if (err.code === "ETIMEDOUT" || err.code === "UND_ERR_CONNECT_TIMEOUT" || err.code === "UND_ERR_HEADERS_TIMEOUT") {
        return true;
    }
    const msg = (err.message ?? "").toLowerCase();
    return msg.includes("timed out") || msg.includes("timeout");
}
export function normalizeError(error) {
    if (error instanceof CliError) {
        return error;
    }
    if (error instanceof InvalidInputLinearError) {
        const msg = error.message;
        // Linear reports missing referenced entities as InvalidInput
        // ("Entity not found: Notification - Could not find referenced Notification."),
        // which is a not-found condition rather than a malformed request.
        if (/entity not found|could not find referenced/i.test(msg)) {
            return new CliError("NOT_FOUND", msg, { cause: error });
        }
        return new CliError("VALIDATION_ERROR", msg, { cause: error });
    }
    if (error instanceof LinearError) {
        const status = error.status;
        const errType = String(error.type ?? "").toLowerCase();
        const gqlCodes = (error.errors ?? []).map((e) => String(e.type ?? ""));
        const msg = error.message || "Linear API error";
        if (status === 429 ||
            gqlCodes.some((c) => c.toLowerCase().includes("ratelimited")) ||
            msg.toLowerCase().includes("ratelimited") ||
            msg.toLowerCase().includes("rate limit")) {
            return new CliError("RATE_LIMITED", msg, {
                retryAfterMs: extractRetryAfterMs(error),
                cause: error,
            });
        }
        if (status === 401 || msg.toLowerCase().includes("authentication required") || msg.toLowerCase().includes("invalid token")) {
            return new CliError("AUTH_REQUIRED", msg, { cause: error });
        }
        if (status === 403 ||
            errType === "forbidden" ||
            errType === "featurenotaccessible" ||
            gqlCodes.some((c) => {
                const t = c.toLowerCase();
                return t === "forbidden" || t === "featurenotaccessible";
            }) ||
            msg.toLowerCase().includes("forbidden") ||
            msg.toLowerCase().includes("not authorized") ||
            msg.toLowerCase().includes("not allowed") ||
            msg.toLowerCase().includes("permission denied")) {
            return new CliError("FORBIDDEN", msg, { cause: error });
        }
        if (status === 404 || msg.toLowerCase().includes("entity not found") || msg.toLowerCase().includes("not found")) {
            return new CliError("NOT_FOUND", msg, { cause: error });
        }
        return new CliError("INTERNAL_ERROR", msg, { cause: error });
    }
    if (error && typeof error === "object") {
        const err = error;
        const msg = err.message ?? "Unexpected error";
        if (err.status === 429 || err.code === "RATELIMITED") {
            return new CliError("RATE_LIMITED", msg, {
                retryAfterMs: extractRetryAfterMs(error),
                cause: error,
            });
        }
        if (err.status === 401) {
            return new CliError("AUTH_REQUIRED", msg, { cause: error });
        }
        if (err.status === 403) {
            return new CliError("FORBIDDEN", msg, { cause: error });
        }
        if (err.status === 404) {
            return new CliError("NOT_FOUND", msg, { cause: error });
        }
        if (err.code === "ECONNREFUSED" ||
            err.code === "ENOTFOUND" ||
            err.code === "ECONNRESET" ||
            err.code === "EAI_AGAIN" ||
            msg.toLowerCase().includes("fetch failed")) {
            return new CliError("NETWORK_ERROR", msg, { cause: error });
        }
        if (error instanceof Error) {
            return new CliError("INTERNAL_ERROR", error.message, { cause: error });
        }
    }
    return new CliError("INTERNAL_ERROR", String(error));
}
//# sourceMappingURL=errors.js.map