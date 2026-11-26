import { openVerifiedSession } from "../../core/client.js";
import { CliError } from "../../core/errors.js";
import { formatKeyValue, formatTable } from "../../core/output.js";
import { resolvePaginationVariables, toPaginatedResult } from "../../core/pagination.js";
import { isUuid, resolveIssueLabel, resolveTeam } from "../../core/resolvers.js";
import { getOrCreateSubcommand } from "../workspace/commands.js";
/**
 * Linear computes Custom View query complexity from the query AST (`first` included):
 * `first: 100` costs ~11650 and is rejected (max 10000), while `first: 50` (~5825) passes.
 * Every customViews request therefore pages at most 50 nodes per request.
 */
const CUSTOM_VIEW_PAGE_SIZE = 50;
function parseIntOpt(val, flag) {
    if (val === undefined)
        return undefined;
    const n = Number(val);
    if (!Number.isInteger(n))
        throw new CliError("VALIDATION_ERROR", `Invalid ${flag} '${val}': expected integer.`);
    return n;
}
function parseSnoozeUntil(raw) {
    const trimmed = raw.trim();
    if (trimmed.toLowerCase() === "none" || trimmed.toLowerCase() === "null") {
        return null;
    }
    const relMatch = trimmed.match(/^\+(\d+)([mhdw])$/i);
    if (relMatch) {
        const amount = Number(relMatch[1]);
        const unit = relMatch[2].toLowerCase();
        const mult = unit === "m"
            ? 60_000
            : unit === "h"
                ? 3_600_000
                : unit === "d"
                    ? 86_400_000
                    : 7 * 86_400_000;
        return new Date(Date.now() + amount * mult);
    }
    const ms = Date.parse(trimmed);
    if (!Number.isFinite(ms)) {
        throw new CliError("VALIDATION_ERROR", `Invalid --until '${raw}': expected ISO-8601 timestamp, relative '+1h'/'+1d'/'+1w', or 'none'.`);
    }
    return new Date(ms);
}
async function resolveCustomViewNode(client, viewRef) {
    const q = viewRef.trim();
    if (!q)
        throw new CliError("VALIDATION_ERROR", "View reference cannot be empty.");
    if (isUuid(q)) {
        try {
            const v = await client.customView(q);
            return {
                id: v.id,
                name: v.name,
                slugId: v.slugId,
                modelName: v.modelName,
                shared: v.shared,
                description: v.description ?? null,
                filterData: v.filterData,
            };
        }
        catch (cause) {
            throw new CliError("NOT_FOUND", `Custom view '${q}' not found.`, { cause });
        }
    }
    // Page through views at <=50/request: first:100 exceeds Linear's query-complexity cap
    // and made every name/slug lookup fail with VALIDATION_ERROR (spec scenario broken).
    const matches = [];
    let after;
    for (;;) {
        const conn = await client.customViews({
            first: CUSTOM_VIEW_PAGE_SIZE,
            ...(after ? { after } : {}),
        });
        for (const v of conn.nodes) {
            if (v.slugId === q || v.name.toLowerCase() === q.toLowerCase()) {
                matches.push(v);
            }
        }
        if (matches.length > 1)
            break; // ambiguous regardless of remaining pages
        if (!conn.pageInfo?.hasNextPage)
            break;
        after = conn.pageInfo.endCursor ?? undefined;
        if (!after)
            break;
    }
    if (matches.length === 0)
        throw new CliError("NOT_FOUND", `Custom view '${q}' not found.`);
    if (matches.length > 1) {
        throw new CliError("AMBIGUOUS_RESOURCE", `Custom view '${q}' matched ${matches.length} records; pass UUID.`, {
            details: { candidates: matches.map((m) => ({ id: m.id, name: m.name, slugId: m.slugId })) },
        });
    }
    const v = matches[0];
    return {
        id: v.id,
        name: v.name,
        slugId: v.slugId,
        modelName: v.modelName,
        shared: v.shared,
        description: v.description ?? null,
        filterData: v.filterData,
    };
}
export function registerMetadataCommands(program, getContext) {
    // ==================== 1. LABELS (extend `linear label`) ====================
    const labelCmd = getOrCreateSubcommand(program, "label", "List and manage issue labels");
    labelCmd
        .command("create")
        .description("Create a workspace or team issue label")
        .requiredOption("--name <name>", "Label name")
        .option("--team <team>", "Team key, name, or UUID (omit for workspace-level label)")
        .option("--color <hex>", "Hex color such as #EB5757")
        .option("--description <text>", "Label description")
        .option("--parent <group>", "Parent label group name or UUID")
        .option("--is-group", "Create as a label group")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const input = await session.run("label.create.resolve", "read", async (client) => {
            const teamId = opts.team ? (await resolveTeam(client, opts.team)).id : undefined;
            let parentId;
            if (opts.parent) {
                const p = await resolveIssueLabel(client, opts.parent, { teamId, allowGroup: true });
                parentId = p.id;
            }
            return {
                name: opts.name,
                ...(teamId ? { teamId } : {}),
                ...(opts.color ? { color: opts.color } : {}),
                ...(opts.description !== undefined ? { description: opts.description } : {}),
                ...(parentId ? { parentId } : {}),
                ...(opts.isGroup ? { isGroup: true } : {}),
            };
        });
        if (ctx.options.dryRun) {
            ctx.output.dryRun("label.create", input);
            return;
        }
        const created = await session.run("label.create", "create", async (client) => {
            const res = await client.createIssueLabel(input);
            if (!res.success)
                throw new CliError("INTERNAL_ERROR", "createIssueLabel returned success=false.");
            const l = await res.issueLabel;
            return {
                id: l?.id ?? null,
                name: l?.name ?? opts.name,
                color: l?.color ?? opts.color ?? null,
                description: l?.description ?? opts.description ?? null,
                isGroup: Boolean(l?.isGroup ?? opts.isGroup),
            };
        });
        ctx.output.success(created, {
            human: () => `Created label '${created.name}' (${created.id ?? ""})`,
        });
    });
    labelCmd
        .command("update <label>")
        .description("Update an issue label's name, color, or description")
        .option("--team <team>", "Team scope when resolving label by name")
        .option("--name <name>", "New label name")
        .option("--color <hex>", "New hex color")
        .option("--description <text>", "New description")
        .action(async (labelRef, opts) => {
        const ctx = getContext();
        const input = {};
        if (opts.name !== undefined)
            input.name = opts.name;
        if (opts.color !== undefined)
            input.color = opts.color;
        if (opts.description !== undefined)
            input.description = opts.description;
        if (Object.keys(input).length === 0) {
            throw new CliError("VALIDATION_ERROR", "Specify '--name', '--color', or '--description' for 'linear label update'.");
        }
        const session = await openVerifiedSession(ctx);
        const target = await session.run("label.update.resolve", "read", async (client) => {
            const teamId = opts.team ? (await resolveTeam(client, opts.team)).id : undefined;
            return resolveIssueLabel(client, labelRef, { teamId, allowGroup: true, includeArchived: true });
        });
        if (ctx.options.dryRun) {
            ctx.output.dryRun("label.update", { id: target.id, name: target.name, input });
            return;
        }
        const updated = await session.run("label.update", "idempotent-write", async (client) => {
            const res = await client.updateIssueLabel(target.id, input);
            if (!res.success)
                throw new CliError("INTERNAL_ERROR", "updateIssueLabel returned success=false.");
            const l = await res.issueLabel;
            return {
                id: l?.id ?? target.id,
                name: l?.name ?? opts.name ?? target.name,
                color: l?.color ?? opts.color ?? target.color,
                description: l?.description ?? opts.description ?? target.description,
            };
        });
        ctx.output.success(updated, {
            human: () => `Updated label '${updated.name}'`,
        });
    });
    labelCmd
        .command("archive <label>")
        .description("Retire an issue label so new issues cannot apply it (or pass --delete --yes to permanently delete)")
        .option("--team <team>", "Team scope when resolving label by name")
        .option("--delete", "Permanently delete label instead of retiring")
        .option("--yes", "Confirm permanent deletion when --delete is passed")
        .action(async (labelRef, opts) => {
        const ctx = getContext();
        if (opts.delete) {
            ctx.requireDestructiveConfirmation(Boolean(opts.yes), `permanently delete label '${labelRef}'`);
        }
        const session = await openVerifiedSession(ctx);
        const target = await session.run("label.archive.resolve", "read", async (client) => {
            const teamId = opts.team ? (await resolveTeam(client, opts.team)).id : undefined;
            return resolveIssueLabel(client, labelRef, { teamId, allowGroup: true, includeArchived: true });
        });
        if (ctx.options.dryRun) {
            ctx.output.dryRun(opts.delete ? "label.delete" : "label.retire", { id: target.id, name: target.name });
            return;
        }
        if (opts.delete) {
            const res = await session.run("label.delete", "idempotent-write", (client) => client.deleteIssueLabel(target.id));
            ctx.output.success({ id: target.id, name: target.name, deleted: Boolean(res.success) }, {
                human: () => `Deleted label '${target.name}'`,
            });
            return;
        }
        const res = await session.run("label.retire", "idempotent-write", (client) => client.issueLabelRetire(target.id));
        ctx.output.success({ id: target.id, name: target.name, retired: Boolean(res.success) }, {
            human: () => `Retired label '${target.name}'`,
        });
    });
    labelCmd
        .command("restore <label>")
        .description("Restore a retired issue label")
        .option("--team <team>", "Team scope when resolving label by name")
        .action(async (labelRef, opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const target = await session.run("label.restore.resolve", "read", async (client) => {
            const teamId = opts.team ? (await resolveTeam(client, opts.team)).id : undefined;
            return resolveIssueLabel(client, labelRef, { teamId, allowGroup: true, includeArchived: true });
        });
        if (ctx.options.dryRun) {
            ctx.output.dryRun("label.restore", { id: target.id, name: target.name });
            return;
        }
        const res = await session.run("label.restore", "idempotent-write", (client) => client.issueLabelRestore(target.id));
        ctx.output.success({ id: target.id, name: target.name, restored: Boolean(res.success) }, {
            human: () => `Restored label '${target.name}'`,
        });
    });
    // ==================== 2. CUSTOM VIEWS ====================
    const viewCmd = getOrCreateSubcommand(program, "view", "List and inspect saved Linear Custom Views");
    viewCmd
        .command("list")
        .description("List accessible saved Custom Views")
        .option("--query <query>", "Search custom view names")
        .option("--team <team>", "Filter by team")
        .option("--shared", "Only return shared views")
        .option("--limit <n>", "Maximum results per page")
        .option("--cursor <cursor>", "Pagination cursor")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
            limit: parseIntOpt(opts.limit, "--limit"),
            cursor: opts.cursor,
        });
        const page = await session.run("view.list", "read", async (client) => {
            const andClauses = [];
            if (opts.query)
                andClauses.push({ name: { containsIgnoreCase: opts.query } });
            if (opts.shared)
                andClauses.push({ shared: { eq: true } });
            if (opts.team) {
                const team = await resolveTeam(client, opts.team);
                andClauses.push({ team: { id: { eq: team.id } } });
            }
            const filter = andClauses.length === 0 ? undefined : andClauses.length === 1 ? andClauses[0] : { and: andClauses };
            // Fetch in chunks of <=50: a single request with first up to 250 exceeds
            // Linear's Custom View query-complexity limit (>=86 is rejected server-side).
            const targetLimit = pageVars.first;
            const collected = [];
            let after = pageVars.after;
            let lastConn = {};
            while (collected.length < targetLimit) {
                const fetchCount = Math.min(CUSTOM_VIEW_PAGE_SIZE, targetLimit - collected.length);
                const conn = await client.customViews({
                    first: fetchCount,
                    ...(after ? { after } : {}),
                    ...(filter ? { filter } : {}),
                });
                collected.push(...conn.nodes);
                lastConn = conn;
                if (conn.nodes.length === 0 || !conn.pageInfo?.hasNextPage)
                    break;
                after = conn.pageInfo.endCursor ?? undefined;
                if (!after)
                    break;
            }
            return toPaginatedResult({ nodes: collected, pageInfo: lastConn.pageInfo }, (v) => ({
                id: v.id,
                name: v.name,
                slugId: v.slugId,
                modelName: v.modelName,
                shared: v.shared,
                description: v.description ?? null,
            }));
        });
        ctx.output.success(page.items, {
            pageInfo: page.pageInfo,
            human: () => formatTable(page.items, [
                { header: "SLUG", value: (r) => r.slugId },
                { header: "MODEL", value: (r) => r.modelName },
                { header: "SHARED", value: (r) => r.shared },
                { header: "NAME", value: (r) => r.name, maxWidth: 45 },
            ]),
        });
    });
    viewCmd
        .command("get <view>")
        .description("Inspect a saved Custom View's metadata and filterData")
        .action(async (viewRef) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const view = await session.run("view.get", "read", (client) => resolveCustomViewNode(client, viewRef));
        ctx.output.success(view, {
            human: () => formatKeyValue([
                ["ID", view.id],
                ["Slug", view.slugId],
                ["Name", view.name],
                ["Model", view.modelName],
                ["Shared", view.shared],
                ["Description", view.description],
                ["Filter Data", view.filterData],
            ]),
        });
    });
    // ==================== 3. INBOX NOTIFICATIONS ====================
    const inboxCmd = getOrCreateSubcommand(program, "inbox", "List and triage Linear Inbox notifications");
    inboxCmd
        .command("list")
        .description("List notifications from the authenticated account's Linear Inbox")
        .option("--unread", "Only return unread notifications")
        .option("--limit <n>", "Maximum results per page (1..250, default 50)")
        .option("--cursor <cursor>", "Pagination cursor")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
            limit: parseIntOpt(opts.limit, "--limit"),
            cursor: opts.cursor,
        });
        const page = await session.run("inbox.list", "read", async (client) => {
            // inboxNotifications is the Linear Inbox query and exposes server-side
            // `unreadOnly` filtering; `notifications` has no readAt filter, so `--unread`
            // previously filtered client-side on one page and dropped unread items on later pages.
            const conn = await client.inboxNotifications({
                first: pageVars.first,
                ...(pageVars.after ? { after: pageVars.after } : {}),
                ...(opts.unread ? { unreadOnly: true } : {}),
            });
            const mapped = toPaginatedResult(conn, (n) => {
                const raw = n;
                return {
                    id: raw.id,
                    type: raw.type,
                    category: raw.category ?? null,
                    read: Boolean(raw.readAt),
                    readAt: raw.readAt ? new Date(raw.readAt).toISOString() : null,
                    snoozedUntilAt: raw.snoozedUntilAt ? new Date(raw.snoozedUntilAt).toISOString() : null,
                    createdAt: new Date(raw.createdAt).toISOString(),
                    url: raw.url ?? null,
                };
            });
            // Server already filtered when --unread; this is a cheap defense-in-depth no-op.
            const items = opts.unread ? mapped.items.filter((i) => !i.read) : mapped.items;
            return {
                items,
                pageInfo: { ...mapped.pageInfo, count: items.length },
            };
        });
        ctx.output.success(page.items, {
            pageInfo: page.pageInfo,
            human: () => formatTable(page.items, [
                { header: "ID", value: (r) => r.id },
                { header: "READ", value: (r) => r.read },
                { header: "TYPE", value: (r) => r.type },
                { header: "CREATED_AT", value: (r) => r.createdAt },
            ]),
        });
    });
    inboxCmd
        .command("read <notificationId>")
        .description("Mark a Linear notification as read")
        .action(async (notificationId) => {
        const ctx = getContext();
        const id = notificationId.trim();
        const readAt = new Date();
        if (ctx.options.dryRun) {
            ctx.output.dryRun("inbox.read", { id, readAt: readAt.toISOString() });
            return;
        }
        const session = await openVerifiedSession(ctx);
        const res = await session.run("inbox.read", "idempotent-write", (client) => client.updateNotification(id, { readAt }));
        ctx.output.success({ id, read: true, success: Boolean(res.success) }, {
            human: () => `Marked notification ${id} as read`,
        });
    });
    inboxCmd
        .command("unread <notificationId>")
        .description("Mark a Linear notification as unread")
        .action(async (notificationId) => {
        const ctx = getContext();
        const id = notificationId.trim();
        if (ctx.options.dryRun) {
            ctx.output.dryRun("inbox.unread", { id, readAt: null });
            return;
        }
        const session = await openVerifiedSession(ctx);
        const res = await session.run("inbox.unread", "idempotent-write", (client) => client.updateNotification(id, { readAt: null }));
        ctx.output.success({ id, read: false, success: Boolean(res.success) }, {
            human: () => `Marked notification ${id} as unread`,
        });
    });
    inboxCmd
        .command("snooze <notificationId>")
        .description("Snooze a Linear notification until an ISO time / '+1h' / '+1d' (or 'none' to unsnooze)")
        .requiredOption("--until <time>", "ISO-8601 timestamp, '+1h'/'+1d'/'+1w', or 'none'")
        .action(async (notificationId, opts) => {
        const ctx = getContext();
        const id = notificationId.trim();
        const snoozedUntilAt = parseSnoozeUntil(opts.until);
        if (ctx.options.dryRun) {
            ctx.output.dryRun("inbox.snooze", { id, snoozedUntilAt: snoozedUntilAt?.toISOString() ?? null });
            return;
        }
        const session = await openVerifiedSession(ctx);
        const res = await session.run("inbox.snooze", "idempotent-write", (client) => client.updateNotification(id, { snoozedUntilAt }));
        ctx.output.success({ id, snoozedUntilAt: snoozedUntilAt?.toISOString() ?? null, success: Boolean(res.success) }, {
            human: () => snoozedUntilAt
                ? `Snoozed notification ${id} until ${snoozedUntilAt.toISOString()}`
                : `Unsnoozed notification ${id}`,
        });
    });
}
//# sourceMappingURL=commands.js.map