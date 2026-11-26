import { LinearDocument } from "@linear/sdk";
export interface PaginationInput {
    limit?: number;
    cursor?: string;
    sort?: "created" | "updated";
    includeArchived?: boolean;
}
export interface PageInfoResult {
    hasNextPage: boolean;
    endCursor: string | null;
    count: number;
}
export interface PaginatedResult<T> {
    items: T[];
    pageInfo: PageInfoResult;
}
export declare function resolvePaginationVariables(input?: PaginationInput): {
    first: number;
    after?: string;
    orderBy?: LinearDocument.PaginationOrderBy;
    includeArchived?: boolean;
};
export declare function toPaginatedResult<Node, Out>(connection: {
    nodes: Node[];
    pageInfo?: {
        hasNextPage?: boolean;
        endCursor?: string | null;
    };
}, mapper: (node: Node) => Out): PaginatedResult<Out>;
