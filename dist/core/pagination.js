import { LinearDocument } from "@linear/sdk";
import { CliError } from "./errors.js";
export function resolvePaginationVariables(input) {
    const limit = input?.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 250) {
        throw new CliError("VALIDATION_ERROR", `Invalid --limit '${String(input?.limit)}': expected an integer between 1 and 250.`);
    }
    const orderBy = input?.sort === "created"
        ? LinearDocument.PaginationOrderBy.CreatedAt
        : input?.sort === "updated"
            ? LinearDocument.PaginationOrderBy.UpdatedAt
            : undefined;
    return {
        first: limit,
        ...(input?.cursor ? { after: input.cursor } : {}),
        ...(orderBy ? { orderBy } : {}),
        ...(input?.includeArchived !== undefined ? { includeArchived: input.includeArchived } : {}),
    };
}
export function toPaginatedResult(connection, mapper) {
    const items = connection.nodes.map(mapper);
    return {
        items,
        pageInfo: {
            hasNextPage: Boolean(connection.pageInfo?.hasNextPage),
            endCursor: connection.pageInfo?.endCursor ?? null,
            count: items.length,
        },
    };
}
//# sourceMappingURL=pagination.js.map