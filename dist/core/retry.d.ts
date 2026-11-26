export type OperationKind = "read" | "idempotent-write" | "create";
export interface RetryOptions {
    kind: OperationKind;
    operationName: string;
    maxRetries?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
}
export declare function executeWithGuardrails<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T>;
