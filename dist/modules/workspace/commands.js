import { openVerifiedSession } from "../../core/client.js";
import { CliError } from "../../core/errors.js";
import { formatKeyValue, formatTable } from "../../core/output.js";
import { resolvePaginationVariables, toPaginatedResult } from "../../core/pagination.js";
import { isUuid, resolveTeam, resolveUser } from "../../core/resolvers.js";
export function getOrCreateSubcommand(parent, name, description) {
    const existing = parent.commands.find((c) => c.name() === name);
    if (existing)
        return existing;
    return parent.command(name).description(description);
}
function parseIntOption(val, flag) {
    if (val === undefined)
        return undefined;
    const num = Number(val);
    if (!Number.isInteger(num)) {
        throw new CliError("VALIDATION_ERROR", `Invalid ${flag} '${val}': expected integer.`);
    }
    return num;
}
export function registerWorkspaceCommands(program, getContext) {
    // 1. workspace info
    const ws = getOrCreateSubcommand(program, "workspace", "Inspect the connected Linear workspace");
    ws.command("info")
        .description("Show the connected Linear workspace ID, name, slug, and URL")
        .action(async () => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const data = await session.run("workspace.info", "read", async (client) => {
            const org = await client.organization;
            return {
                id: org.id,
                name: org.name,
                urlKey: org.urlKey,
                url: `https://linear.app/${org.urlKey}`,
            };
        });
        ctx.output.success(data, {
            human: () => formatKeyValue([
                ["ID", data.id],
                ["Name", data.name],
                ["Slug", data.urlKey],
                ["URL", data.url],
            ]),
        });
    });
    // 2. me
    program
        .command("me")
        .description("Show the authenticated Linear viewer in the current folder")
        .action(async () => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const me = await session.run("viewer.me", "read", (client) => resolveUser(client, "me"));
        ctx.output.success(me, {
            human: () => formatKeyValue([
                ["ID", me.id],
                ["Name", me.name],
                ["Display Name", me.displayName],
                ["Email", me.email],
                ["Admin", me.admin],
                ["Guest", me.guest],
                ["Active", me.active],
                ["App Actor", me.isApp],
            ]),
        });
    });
    // 3. user list | get
    const userCmd = getOrCreateSubcommand(program, "user", "List and inspect workspace members and users");
    userCmd
        .command("list")
        .description("List workspace users with optional query or team filters")
        .option("--query <query>", "Filter users by name, displayName, or email substring")
        .option("--team <team>", "Only return members of this team (UUID, key, or name)")
        .option("--include-disabled", "Include suspended/disabled accounts")
        .option("--limit <n>", "Maximum results per page (1..250, default 50)")
        .option("--cursor <cursor>", "Pagination cursor")
        .option("--sort <field>", "Sort order: created or updated")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
            limit: parseIntOption(opts.limit, "--limit"),
            cursor: opts.cursor,
            sort: opts.sort,
        });
        const page = await session.run("user.list", "read", async (client) => {
            const filter = {};
            if (opts.query) {
                filter.or = [
                    { name: { containsIgnoreCase: opts.query } },
                    { displayName: { containsIgnoreCase: opts.query } },
                    { email: { containsIgnoreCase: opts.query } },
                ];
            }
            if (opts.team) {
                const team = await resolveTeam(client, opts.team);
                const tObj = await client.team(team.id);
                const membersConn = await tObj.members({
                    ...pageVars,
                    includeDisabled: Boolean(opts.includeDisabled),
                    ...(Object.keys(filter).length > 0 ? { filter } : {}),
                });
                return toPaginatedResult(membersConn, (u) => ({
                    id: u.id,
                    name: u.name,
                    displayName: u.displayName,
                    email: u.email ?? null,
                    active: u.active,
                    admin: u.admin,
                    guest: u.guest,
                    isApp: Boolean(u.app) || Boolean(u.email?.endsWith("@oauthapp.linear.app")),
                }));
            }
            const conn = await client.users({
                ...pageVars,
                includeDisabled: Boolean(opts.includeDisabled),
                ...(Object.keys(filter).length > 0 ? { filter } : {}),
            });
            return toPaginatedResult(conn, (u) => ({
                id: u.id,
                name: u.name,
                displayName: u.displayName,
                email: u.email ?? null,
                active: u.active,
                admin: u.admin,
                guest: u.guest,
                isApp: Boolean(u.app) || Boolean(u.email?.endsWith("@oauthapp.linear.app")),
            }));
        });
        ctx.output.success(page.items, {
            pageInfo: page.pageInfo,
            human: () => formatTable(page.items, [
                { header: "ID", value: (r) => r.id },
                { header: "NAME", value: (r) => r.name },
                { header: "EMAIL", value: (r) => r.email },
                { header: "ADMIN", value: (r) => r.admin },
                { header: "ACTIVE", value: (r) => r.active },
            ]),
        });
    });
    userCmd
        .command("get <user>")
        .description("Inspect a workspace user by 'me', UUID, email, displayName, or name")
        .action(async (userRef) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const user = await session.run("user.get", "read", async (client) => {
            const resolved = await resolveUser(client, userRef);
            try {
                const full = await client.user(resolved.id);
                const teamsConn = await full.teams({ first: 50 });
                return {
                    ...resolved,
                    teams: teamsConn.nodes.map((t) => ({ id: t.id, key: t.key, name: t.name })),
                };
            }
            catch {
                return { ...resolved, teams: [] };
            }
        });
        ctx.output.success(user, {
            human: () => formatKeyValue([
                ["ID", user.id],
                ["Name", user.name],
                ["Display Name", user.displayName],
                ["Email", user.email],
                ["Admin", user.admin],
                ["Active", user.active],
                ["Teams", user.teams.map((t) => `${t.key} (${t.name})`)],
            ]),
        });
    });
    // 4. team list | get | members
    const teamCmd = getOrCreateSubcommand(program, "team", "List and inspect Linear teams and memberships");
    teamCmd
        .command("list")
        .description("List accessible teams in the workspace")
        .option("--query <query>", "Filter teams by name or key")
        .option("--include-archived", "Include archived teams")
        .option("--limit <n>", "Maximum results per page (1..250, default 50)")
        .option("--cursor <cursor>", "Pagination cursor")
        .option("--sort <field>", "Sort order: created or updated")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
            limit: parseIntOption(opts.limit, "--limit"),
            cursor: opts.cursor,
            sort: opts.sort,
            includeArchived: opts.includeArchived,
        });
        const page = await session.run("team.list", "read", async (client) => {
            const conn = await client.teams({
                ...pageVars,
                ...(opts.query
                    ? {
                        filter: {
                            or: [
                                { name: { containsIgnoreCase: opts.query } },
                                { key: { containsIgnoreCase: opts.query } },
                            ],
                        },
                    }
                    : {}),
            });
            return toPaginatedResult(conn, (t) => ({
                id: t.id,
                key: t.key,
                name: t.name,
                description: t.description ?? null,
                private: Boolean(t.private),
            }));
        });
        ctx.output.success(page.items, {
            pageInfo: page.pageInfo,
            human: () => formatTable(page.items, [
                { header: "KEY", value: (r) => r.key },
                { header: "NAME", value: (r) => r.name },
                { header: "PRIVATE", value: (r) => r.private },
                { header: "ID", value: (r) => r.id },
            ]),
        });
    });
    teamCmd
        .command("get <team>")
        .description("Get details of a team by key (e.g. NIN), name, or UUID")
        .action(async (teamRef) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const data = await session.run("team.get", "read", async (client) => {
            const resolved = await resolveTeam(client, teamRef);
            const full = await client.team(resolved.id);
            return {
                id: full.id,
                key: full.key,
                name: full.name,
                description: full.description ?? null,
                private: Boolean(full.private),
                cyclesEnabled: Boolean(full.cyclesEnabled),
                triageEnabled: Boolean(full.triageEnabled),
            };
        });
        ctx.output.success(data, {
            human: () => formatKeyValue([
                ["ID", data.id],
                ["Key", data.key],
                ["Name", data.name],
                ["Description", data.description],
                ["Private", data.private],
                ["Cycles Enabled", data.cyclesEnabled],
                ["Triage Enabled", data.triageEnabled],
            ]),
        });
    });
    teamCmd
        .command("members <team>")
        .description("List members of a team")
        .option("--limit <n>", "Maximum results per page")
        .option("--cursor <cursor>", "Pagination cursor")
        .action(async (teamRef, opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
            limit: parseIntOption(opts.limit, "--limit"),
            cursor: opts.cursor,
        });
        const page = await session.run("team.members", "read", async (client) => {
            const resolved = await resolveTeam(client, teamRef);
            const t = await client.team(resolved.id);
            const conn = await t.members(pageVars);
            return toPaginatedResult(conn, (u) => ({
                id: u.id,
                name: u.name,
                displayName: u.displayName,
                email: u.email ?? null,
                active: u.active,
                admin: u.admin,
            }));
        });
        ctx.output.success(page.items, {
            pageInfo: page.pageInfo,
            human: () => formatTable(page.items, [
                { header: "NAME", value: (r) => r.name },
                { header: "EMAIL", value: (r) => r.email },
                { header: "ACTIVE", value: (r) => r.active },
                { header: "ID", value: (r) => r.id },
            ]),
        });
    });
    // 5. status list --team <team>
    const statusCmd = getOrCreateSubcommand(program, "status", "Inspect team issue workflow statuses");
    statusCmd
        .command("list")
        .description("List workflow statuses for a team")
        .requiredOption("--team <team>", "Team key, name, or UUID")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const items = await session.run("status.list", "read", async (client) => {
            const team = await resolveTeam(client, opts.team);
            const conn = await client.workflowStates({
                first: 100,
                filter: { team: { id: { eq: team.id } } },
            });
            return conn.nodes
                .map((s) => ({
                id: s.id,
                name: s.name,
                type: s.type,
                color: s.color,
                position: s.position,
                description: s.description ?? null,
            }))
                .sort((a, b) => a.position - b.position);
        });
        ctx.output.success(items, {
            human: () => formatTable(items, [
                { header: "NAME", value: (r) => r.name },
                { header: "TYPE", value: (r) => r.type },
                { header: "COLOR", value: (r) => r.color },
                { header: "ID", value: (r) => r.id },
            ]),
        });
    });
    // 6. label list [--team <team>]
    const labelCmd = getOrCreateSubcommand(program, "label", "List and manage issue labels");
    labelCmd
        .command("list")
        .description("List workspace or team issue labels")
        .option("--team <team>", "Filter to labels available to this team")
        .option("--name <name>", "Filter labels by name substring")
        .option("--include-groups", "Include label groups")
        .option("--include-archived", "Include archived/retired labels")
        .option("--limit <n>", "Maximum results per page")
        .option("--cursor <cursor>", "Pagination cursor")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
            limit: parseIntOption(opts.limit, "--limit"),
            cursor: opts.cursor,
            includeArchived: opts.includeArchived,
        });
        const page = await session.run("label.list", "read", async (client) => {
            const filter = {};
            if (!opts.includeGroups) {
                filter.isGroup = { eq: false };
            }
            if (opts.name) {
                filter.name = { containsIgnoreCase: opts.name };
            }
            if (opts.team) {
                const team = await resolveTeam(client, opts.team);
                filter.or = [{ team: { id: { eq: team.id } } }, { team: { null: true } }];
            }
            const conn = await client.issueLabels({
                ...pageVars,
                ...(Object.keys(filter).length > 0 ? { filter } : {}),
            });
            // The @linear/sdk IssueLabel fragment omits `retiredAt`, so the SDK always
            // reports null even for retired labels. Fetch authoritative retiredAt for
            // exactly this page's IDs via raw GraphQL.
            const ids = conn.nodes.map((l) => l.id);
            const retiredAtById = new Map();
            if (ids.length > 0) {
                const res = await client.client.rawRequest(`query LabelRetiredAt($ids: [ID!]!, $first: Int!) {
                issueLabels(filter: { id: { in: $ids } }, first: $first) {
                  nodes { id retiredAt }
                }
              }`, { ids, first: ids.length });
                for (const n of res.data?.issueLabels?.nodes ?? []) {
                    retiredAtById.set(n.id, n.retiredAt ? new Date(n.retiredAt).toISOString() : null);
                }
            }
            const mapped = toPaginatedResult(conn, (l) => {
                const raw = l;
                const retiredAt = retiredAtById.has(raw.id)
                    ? retiredAtById.get(raw.id) ?? null
                    : raw.retiredAt
                        ? new Date(raw.retiredAt).toISOString()
                        : null;
                return {
                    id: raw.id,
                    name: raw.name,
                    color: raw.color,
                    description: raw.description ?? null,
                    isGroup: Boolean(raw.isGroup),
                    retiredAt,
                    archivedAt: raw.archivedAt ? new Date(raw.archivedAt).toISOString() : null,
                };
            });
            const items = opts.includeGroups ? mapped.items : mapped.items.filter((i) => !i.isGroup);
            return {
                items,
                pageInfo: { ...mapped.pageInfo, count: items.length },
            };
        });
        ctx.output.success(page.items, {
            pageInfo: page.pageInfo,
            human: () => formatTable(page.items, [
                { header: "NAME", value: (r) => r.name },
                { header: "COLOR", value: (r) => r.color },
                { header: "GROUP", value: (r) => r.isGroup },
                { header: "RETIRED", value: (r) => Boolean(r.retiredAt) },
                { header: "ID", value: (r) => r.id },
            ]),
        });
    });
    // 7. template list | get
    const templateCmd = getOrCreateSubcommand(program, "template", "List and inspect Linear templates");
    templateCmd
        .command("list")
        .description("List available Linear templates")
        .option("--team <team>", "Include team-scoped templates for this team")
        .option("--type <type>", "Filter template type (e.g. issue, project, document)")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const items = await session.run("template.list", "read", async (client) => {
            let rawList = await client.templates;
            if (opts.team) {
                const team = await resolveTeam(client, opts.team);
                const teamObj = await client.team(team.id);
                const teamTemplates = await teamObj.templates();
                const byId = new Map();
                for (const t of rawList)
                    byId.set(t.id, t);
                for (const t of teamTemplates.nodes)
                    byId.set(t.id, t);
                rawList = Array.from(byId.values());
            }
            const mapped = rawList.map((t) => ({
                id: t.id,
                name: t.name,
                type: t.type,
                description: t.description ?? null,
            }));
            if (opts.type) {
                const lower = opts.type.toLowerCase();
                return mapped.filter((t) => t.type.toLowerCase() === lower);
            }
            return mapped;
        });
        ctx.output.success(items, {
            human: () => formatTable(items, [
                { header: "NAME", value: (r) => r.name },
                { header: "TYPE", value: (r) => r.type },
                { header: "DESCRIPTION", value: (r) => r.description },
                { header: "ID", value: (r) => r.id },
            ]),
        });
    });
    templateCmd
        .command("get <template>")
        .description("Inspect a template by UUID or exact name")
        .option("--team <team>", "Also search team-scoped templates for this team")
        .action(async (templateRef, opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const data = await session.run("template.get", "read", async (client) => {
            const q = templateRef.trim();
            if (isUuid(q)) {
                try {
                    const t = await client.template(q);
                    return {
                        id: t.id,
                        name: t.name,
                        type: t.type,
                        description: t.description ?? null,
                        content: t.content ?? null,
                        templateData: t.templateData,
                    };
                }
                catch (cause) {
                    throw new CliError("NOT_FOUND", `Template '${q}' not found.`, { cause });
                }
            }
            let all = await client.templates;
            if (opts.team) {
                const team = await resolveTeam(client, opts.team);
                const teamObj = await client.team(team.id);
                const teamTpls = await teamObj.templates();
                const map = new Map();
                for (const t of all)
                    map.set(t.id, t);
                for (const t of teamTpls.nodes)
                    map.set(t.id, t);
                all = Array.from(map.values());
            }
            const matches = all.filter((t) => t.name.toLowerCase() === q.toLowerCase());
            if (matches.length === 0) {
                throw new CliError("NOT_FOUND", `Template '${q}' not found.`);
            }
            if (matches.length > 1) {
                throw new CliError("AMBIGUOUS_RESOURCE", `Template '${q}' matched ${matches.length} records; pass UUID instead.`, { details: { candidates: matches.map((m) => ({ id: m.id, name: m.name, type: m.type })) } });
            }
            const t = matches[0];
            return {
                id: t.id,
                name: t.name,
                type: t.type,
                description: t.description ?? null,
                content: t.content ?? null,
                templateData: t.templateData,
            };
        });
        ctx.output.success(data, {
            human: () => formatKeyValue([
                ["ID", data.id],
                ["Name", data.name],
                ["Type", data.type],
                ["Description", data.description],
                ["Content", data.content],
            ]),
        });
    });
}
//# sourceMappingURL=commands.js.map