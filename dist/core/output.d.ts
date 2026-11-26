import { CliError } from "./errors.js";
import type { PageInfoResult } from "./pagination.js";
export declare function redactString(input: string, extraSecrets?: string[]): string;
export declare function redactValue<T>(value: T, extraSecrets?: string[]): T;
export interface WritableLike {
    write(chunk: string): boolean | void;
}
export interface TableColumn<Row> {
    header: string;
    value: (row: Row) => string | number | boolean | null | undefined;
    maxWidth?: number;
}
export declare function formatTable<Row>(rows: Row[], columns: TableColumn<Row>[]): string;
export declare function formatKeyValue(pairs: Array<[string, unknown]>): string;
export declare class OutputWriter {
    readonly jsonMode: boolean;
    private readonly stdout;
    private readonly stderr;
    private readonly extraSecrets;
    constructor(options: {
        jsonMode: boolean;
        stdout: WritableLike;
        stderr: WritableLike;
        extraSecrets?: string[];
    });
    addSecretToRedact(secret: string | undefined): void;
    success<T>(data: T, options?: {
        pageInfo?: PageInfoResult;
        human?: string | (() => string);
    }): void;
    dryRun(operation: string, parameters: Record<string, unknown>): void;
    error(err: CliError): void;
}
