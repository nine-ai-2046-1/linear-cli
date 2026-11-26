const SECRET_PATTERNS = [
    /\blin_api_[A-Za-z0-9_-]{12,}\b/g,
    /\blin_oauth_[A-Za-z0-9_-]{12,}\b/g,
    /(Authorization\s*:\s*Bearer\s+)[^\s"',}]+/gi,
    /(Authorization\s*:\s*Basic\s+)[^\s"',}]+/gi,
    /(Authorization\s*:\s*)(lin_api_[^\s"',}]+)/gi,
    /("(?:access_token|refresh_token|client_secret|apiKey|accessToken|refreshToken|clientSecret)"\s*:\s*")[^"]+(")/gi,
];
export function redactString(input, extraSecrets = []) {
    let out = input;
    for (const secret of extraSecrets) {
        if (secret && secret.length >= 6) {
            out = out.split(secret).join("[REDACTED]");
        }
    }
    out = out.replace(/\blin_api_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
    out = out.replace(/\blin_oauth_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
    out = out.replace(/(Authorization\s*:\s*Bearer\s+)[^\s"',}]+/gi, "$1[REDACTED]");
    out = out.replace(/(Authorization\s*:\s*Basic\s+)[^\s"',}]+/gi, "$1[REDACTED]");
    out = out.replace(/(Authorization\s*:\s*)[^\s"',}]{16,}/gi, "$1[REDACTED]");
    out = out.replace(/("(?:access_token|refresh_token|client_secret|apiKey|accessToken|refreshToken|clientSecret)"\s*:\s*")[^"]+(")/gi, "$1[REDACTED]$2");
    void SECRET_PATTERNS;
    return out;
}
export function redactValue(value, extraSecrets = []) {
    if (typeof value === "string") {
        return redactString(value, extraSecrets);
    }
    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item, extraSecrets));
    }
    if (value && typeof value === "object") {
        if (value instanceof Date) {
            return value.toISOString();
        }
        const result = {};
        for (const [k, v] of Object.entries(value)) {
            if (/^(access_token|refresh_token|client_secret|apiKey|accessToken|refreshToken|clientSecret)$/i.test(k) &&
                typeof v === "string" &&
                v.length > 0) {
                result[k] = "[REDACTED]";
            }
            else {
                result[k] = redactValue(v, extraSecrets);
            }
        }
        return result;
    }
    return value;
}
export function formatTable(rows, columns) {
    if (rows.length === 0) {
        return "(no results)";
    }
    const cellMatrix = rows.map((row) => columns.map((col) => {
        const raw = col.value(row);
        const str = raw === null || raw === undefined ? "-" : String(raw).replace(/\r?\n/g, " ");
        const maxW = col.maxWidth ?? 60;
        return str.length > maxW ? `${str.slice(0, maxW - 1)}…` : str;
    }));
    const widths = columns.map((col, idx) => Math.max(col.header.length, ...cellMatrix.map((r) => r[idx]?.length ?? 0)));
    const headerLine = columns.map((col, idx) => col.header.padEnd(widths[idx])).join("  ");
    const dividerLine = widths.map((w) => "-".repeat(w)).join("  ");
    const bodyLines = cellMatrix.map((cells) => cells.map((cell, idx) => cell.padEnd(widths[idx])).join("  "));
    return [headerLine, dividerLine, ...bodyLines].join("\n");
}
export function formatKeyValue(pairs) {
    const filtered = pairs.filter(([, v]) => v !== undefined);
    const maxKey = Math.max(0, ...filtered.map(([k]) => k.length));
    return filtered
        .map(([k, v]) => {
        const rendered = v === null
            ? "-"
            : Array.isArray(v)
                ? v.length === 0
                    ? "-"
                    : v.join(", ")
                : typeof v === "object"
                    ? JSON.stringify(v)
                    : String(v);
        return `${k.padEnd(maxKey)} : ${rendered}`;
    })
        .join("\n");
}
export class OutputWriter {
    jsonMode;
    stdout;
    stderr;
    extraSecrets;
    constructor(options) {
        this.jsonMode = options.jsonMode;
        this.stdout = options.stdout;
        this.stderr = options.stderr;
        this.extraSecrets = options.extraSecrets ?? [];
    }
    addSecretToRedact(secret) {
        if (secret && secret.length >= 6) {
            this.extraSecrets.push(secret);
        }
    }
    success(data, options) {
        const safeData = redactValue(data, this.extraSecrets);
        if (this.jsonMode) {
            const payload = { ok: true, data: safeData };
            if (options?.pageInfo) {
                payload.pageInfo = options.pageInfo;
            }
            this.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
            return;
        }
        const rendered = typeof options?.human === "function"
            ? options.human()
            : options?.human ?? JSON.stringify(safeData, null, 2);
        this.stdout.write(`${redactString(rendered, this.extraSecrets)}\n`);
        if (options?.pageInfo?.hasNextPage && options.pageInfo.endCursor) {
            this.stderr.write(`More results available. Next cursor: ${options.pageInfo.endCursor}\n`);
        }
    }
    dryRun(operation, parameters) {
        const safeParams = redactValue(parameters, this.extraSecrets);
        if (this.jsonMode) {
            this.stdout.write(`${JSON.stringify({
                ok: true,
                dryRun: true,
                operation,
                data: {
                    dryRun: true,
                    operation,
                    parameters: safeParams,
                },
            }, null, 2)}\n`);
            return;
        }
        this.stdout.write(`[DRY-RUN] Operation: ${operation}\n${redactString(JSON.stringify(safeParams, null, 2), this.extraSecrets)}\n`);
    }
    error(err) {
        const safeMessage = redactString(err.message, this.extraSecrets);
        const safeDetails = err.details ? redactValue(err.details, this.extraSecrets) : undefined;
        if (this.jsonMode) {
            const payload = {
                ok: false,
                error: {
                    code: err.code,
                    exitCode: err.exitCode,
                    message: safeMessage,
                    ...(safeDetails ? { details: safeDetails } : {}),
                },
            };
            this.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
            return;
        }
        this.stderr.write(`Error [${err.code}]: ${safeMessage}\n`);
    }
}
//# sourceMappingURL=output.js.map