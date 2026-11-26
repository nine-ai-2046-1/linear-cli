export declare const ExitCode: {
    readonly SUCCESS: 0;
    readonly INTERNAL_ERROR: 1;
    readonly AUTH_REQUIRED: 2;
    readonly FORBIDDEN: 3;
    readonly NOT_FOUND: 4;
    readonly VALIDATION_ERROR: 5;
    readonly AMBIGUOUS_RESOURCE: 6;
    readonly RATE_LIMITED: 7;
    readonly OUTCOME_UNKNOWN: 8;
    readonly UNSUPPORTED_BY_PUBLIC_API: 9;
    readonly NETWORK_ERROR: 10;
};
export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];
export type ErrorCode = "INTERNAL_ERROR" | "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_ERROR" | "AMBIGUOUS_RESOURCE" | "RATE_LIMITED" | "OUTCOME_UNKNOWN" | "UNSUPPORTED_BY_PUBLIC_API" | "NETWORK_ERROR";
export declare class CliError extends Error {
    readonly code: ErrorCode;
    readonly exitCode: ExitCodeValue;
    readonly details?: Record<string, unknown>;
    readonly retryAfterMs?: number;
    constructor(code: ErrorCode, message: string, options?: {
        details?: Record<string, unknown>;
        retryAfterMs?: number;
        cause?: unknown;
    });
}
export declare function extractRetryAfterMs(error: unknown): number | undefined;
export declare function isTimeoutError(error: unknown): boolean;
export declare function normalizeError(error: unknown): CliError;
