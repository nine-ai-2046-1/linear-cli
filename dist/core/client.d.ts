import type { LinearClient } from "@linear/sdk";
import type { AuthBinding } from "../auth/types.js";
import type { CliContext } from "../cli/context.js";
import { type OperationKind } from "./retry.js";
export declare function assertExpectedIdentity(binding: AuthBinding, ctx: CliContext): void;
export interface VerifiedLinearSession {
    client: LinearClient;
    binding: AuthBinding;
    folder: string;
    run<T>(operationName: string, kind: OperationKind, fn: (client: LinearClient) => Promise<T>, timeoutMs?: number): Promise<T>;
}
export declare function openVerifiedSession(ctx: CliContext): Promise<VerifiedLinearSession>;
