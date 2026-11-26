import { LinearDocument } from "@linear/sdk";
import { openVerifiedSession } from "../../core/client.js";
import { CliError } from "../../core/errors.js";
import { formatKeyValue, formatTable } from "../../core/output.js";
import { resolvePaginationVariables, toPaginatedResult } from "../../core/pagination.js";
import { formatPriorityName, isUuid, parsePriority, resolveCycle, resolveProject, resolveProjectStatus, resolveTeam, resolveUser, } from "../../core/resolvers.js";
import { buildIssueFilter, mapIssueNode } from "../issues/filter.js";
import { getOrCreateSubcommand } from "../workspace/commands.js";
function collectRepeatable(val, prev) {
    return [...prev, val];
}
function parseIntOpt(val, flag) {
    if (val === undefined)
        return undefined;
    const n = Number(val);
    if (!Number.isInteger(n))
        throw new CliError("VALIDATION_ERROR", `Invalid ${flag} '${val}': expected integer.`);
    return n;
}
function parseHealth(raw) {
    if (!raw)
        return undefined;
    const norm = raw.trim().toLowerCase();
    if (norm === "ontrack" || norm === "on-track" || norm === "on_track") {
        return LinearDocument.ProjectUpdateHealthType.OnTrack;
    }
    if (norm === "atrisk" || norm === "at-risk" || norm === "at_risk") {
        return LinearDocument.ProjectUpdateHealthType.AtRisk;
    }
    if (norm === "offtrack" || norm === "off-track" || norm === "off_track") {
        return LinearDocument.ProjectUpdateHealthType.OffTrack;
    }
    throw new CliError("VALIDATION_ERROR", `Invalid --health '${raw}': expected onTrack | atRisk | offTrack.`);
}
async function mapProjectNode(p) {
    const raw = p;
    const [status, lead, teamsConn] = await Promise.all([
        Promise.resolve(raw.status).catch(() => undefined),
        Promise.resolve(raw.lead).catch(() => undefined),
        typeof raw.teams === "function" ? raw.teams().catch(() => ({ nodes: [] })) : Promise.resolve({ nodes: [] }),
    ]);
    const prio = raw.priority ?? 0;
    return {
        id: raw.id,
        name: raw.name,
        slugId: raw.slugId,
        summary: raw.description ?? null,
        status: status?.name ?? null,
        statusType: status?.type ?? null,
        priority: prio,
        priorityName: formatPriorityName(prio),
        lead: lead?.name ?? null,
        leadId: lead?.id ?? null,
        teams: teamsConn.nodes.map((t) => t.key),
        progress: raw.progress ?? null,
        startDate: raw.startDate ?? null,
        targetDate: raw.targetDate ?? null,
        url: raw.url,
        archivedAt: raw.archivedAt ? new Date(raw.archivedAt).toISOString() : null,
    };
}
async function resolveMilestoneNode(client, milestoneRef, projectRef) {
    const q = milestoneRef.trim();
    if (!q)
        throw new CliError("VALIDATION_ERROR", "Milestone reference cannot be empty.");
    if (isUuid(q)) {
        try {
            const ms = await client.projectMilestone(q);
            const proj = await Promise.resolve(ms.project).catch(() => undefined);
            return {
                id: ms.id,
                name: ms.name,
                description: ms.description ?? null,
                targetDate: ms.targetDate ?? null,
                projectId: proj?.id ?? null,
            };
        }
        catch (cause) {
            throw new CliError("NOT_FOUND", `Milestone '${q}' not found.`, { cause });
        }
    }
    if (!projectRef) {
        throw new CliError("VALIDATION_ERROR", `Resolving milestone '${q}' by name requires '--project <project>'.`);
    }
    const proj = await resolveProject(client, projectRef);
    const pNode = await client.project(proj.id);
    const conn = await pNode.projectMilestones({ first: 100 });
    const matches = conn.nodes.filter((m) => m.name.toLowerCase() === q.toLowerCase());
    if (matches.length === 0)
        throw new CliError("NOT_FOUND", `Milestone '${q}' not found in project '${proj.name}'.`);
    if (matches.length > 1) {
        throw new CliError("AMBIGUOUS_RESOURCE", `Milestone '${q}' matched ${matches.length} records in '${proj.name}'.`, {
            details: { candidates: matches.map((m) => ({ id: m.id, name: m.name })) },
        });
    }
    const ms = matches[0];
    return {
        id: ms.id,
        name: ms.name,
        description: ms.description ?? null,
        targetDate: ms.targetDate ?? null,
        projectId: proj.id,
    };
}
export function registerPlanningCommands(program, getContext) {
    // ==================== 1. PROJECTS ====================
    const projectCmd = getOrCreateSubcommand(program, "project", "List, inspect, create, update, and manage Linear projects");
    projectCmd
        .command("list")
        .description("List Linear projects with optional filters")
        .option("--team <team>", "Filter projects belonging to this team")
        .option("--status <status>", "Filter by project status name or type")
        .option("--lead <user>", "Filter by project lead ('me', email, name, or UUID)")
        .option("--member <user>", "Filter by project member ('me', email, name, or UUID)")
        .option("--query <query>", "Search project name")
        .option("--include-archived", "Include archived projects")
        .option("--limit <n>", "Maximum results per page (1..250, default 50)")
        .option("--cursor <cursor>", "Pagination cursor")
        .option("--sort <field>", "Sort order: created or updated")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
            limit: parseIntOpt(opts.limit, "--limit"),
            cursor: opts.cursor,
            sort: opts.sort,
            includeArchived: opts.includeArchived,
        });
        const page = await session.run("project.list", "read", async (client) => {
            const andClauses = [];
            if (opts.query) {
                andClauses.push({ name: { containsIgnoreCase: opts.query } });
            }
            if (opts.team) {
                const team = await resolveTeam(client, opts.team);
                andClauses.push({ accessibleTeams: { id: { eq: team.id } } });
            }
            if (opts.status) {
                const st = await resolveProjectStatus(client, opts.status);
                andClauses.push({ status: { id: { eq: st.id } } });
            }
            if (opts.lead) {
                const lead = await resolveUser(client, opts.lead);
                andClauses.push({ lead: { id: { eq: lead.id } } });
            }
            if (opts.member) {
                const mem = await resolveUser(client, opts.member);
                andClauses.push({ members: { id: { eq: mem.id } } });
            }
            const filter = andClauses.length === 0 ? undefined : andClauses.length === 1 ? andClauses[0] : { and: andClauses };
            const conn = await client.projects({
                ...pageVars,
                ...(filter ? { filter } : {}),
            });
            const items = await Promise.all(conn.nodes.map((n) => mapProjectNode(n)));
            return {
                items,
                pageInfo: {
                    hasNextPage: Boolean(conn.pageInfo?.hasNextPage),
                    endCursor: conn.pageInfo?.endCursor ?? null,
                    count: items.length,
                },
            };
        });
        ctx.output.success(page.items, {
            pageInfo: page.pageInfo,
            human: () => formatTable(page.items, [
                { header: "SLUG", value: (r) => r.slugId },
                { header: "STATUS", value: (r) => r.status },
                { header: "TEAMS", value: (r) => r.teams.join(",") },
                { header: "LEAD", value: (r) => r.lead },
                { header: "NAME", value: (r) => r.name, maxWidth: 42 },
            ]),
        });
    });
    projectCmd
        .command("get <project>")
        .description("Retrieve detailed information about a project")
        .action(async (projectRef) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const data = await session.run("project.get", "read", async (client) => {
            const resolved = await resolveProject(client, projectRef);
            const full = await client.project(resolved.id);
            const summary = await mapProjectNode(full);
            const [milestonesConn, membersConn] = await Promise.all([
                typeof full.projectMilestones === "function"
                    ? full.projectMilestones({ first: 100 }).catch(() => ({ nodes: [] }))
                    : Promise.resolve({ nodes: [] }),
                typeof full.members === "function"
                    ? full.members({ first: 100 }).catch(() => ({ nodes: [] }))
                    : Promise.resolve({ nodes: [] }),
            ]);
            return {
                ...summary,
                content: full.content ?? null,
                members: membersConn.nodes.map((m) => ({ id: m.id, name: m.name, email: m.email ?? null })),
                milestones: milestonesConn.nodes.map((m) => ({
                    id: m.id,
                    name: m.name,
                    targetDate: m.targetDate ?? null,
                })),
            };
        });
        ctx.output.success(data, {
            human: () => `${formatKeyValue([
                ["ID", data.id],
                ["Slug", data.slugId],
                ["Name", data.name],
                ["Status", data.status],
                ["Priority", data.priorityName],
                ["Teams", data.teams],
                ["Lead", data.lead],
                ["Summary", data.summary],
                ["Start Date", data.startDate],
                ["Target Date", data.targetDate],
                ["Milestones", data.milestones.map((m) => m.name)],
                ["URL", data.url],
            ])}${data.content ? `\n\nOverview:\n${data.content}` : ""}`,
        });
    });
    projectCmd
        .command("issues <project>")
        .description("List issues belonging to a project")
        .option("--status <status>", "Filter by status")
        .option("--assignee <user>", "Filter by assignee")
        .option("--limit <n>", "Maximum results per page")
        .option("--cursor <cursor>", "Pagination cursor")
        .action(async (projectRef, opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
            limit: parseIntOpt(opts.limit, "--limit"),
            cursor: opts.cursor,
        });
        const page = await session.run("project.issues", "read", async (client) => {
            const filter = await buildIssueFilter(client, {
                project: projectRef,
                status: opts.status,
                assignee: opts.assignee,
            });
            const conn = await client.issues({
                ...pageVars,
                filter: filter,
            });
            const items = await Promise.all(conn.nodes.map((n) => mapIssueNode(n)));
            return {
                items,
                pageInfo: {
                    hasNextPage: Boolean(conn.pageInfo?.hasNextPage),
                    endCursor: conn.pageInfo?.endCursor ?? null,
                    count: items.length,
                },
            };
        });
        ctx.output.success(page.items, {
            pageInfo: page.pageInfo,
            human: () => formatTable(page.items, [
                { header: "ID", value: (r) => r.identifier },
                { header: "STATUS", value: (r) => r.status },
                { header: "ASSIGNEE", value: (r) => r.assignee },
                { header: "TITLE", value: (r) => r.title, maxWidth: 48 },
            ]),
        });
    });
    projectCmd
        .command("create")
        .description("Create a new Linear project")
        .requiredOption("--name <name>", "Project name")
        .requiredOption("--team <team>", "Team key, name, or UUID (repeatable)", collectRepeatable, [])
        .option("--summary <text>", "Short plain-text project summary")
        .option("--content <markdown>", "Full Markdown project overview")
        .option("--content-file <path>", "Read full Markdown project overview from file")
        .option("--status <status>", "Project status name, type, or UUID")
        .option("--lead <user>", "Project lead (human user; app actors cannot be leads)")
        .option("--member <user>", "Project member (repeatable)", collectRepeatable, [])
        .option("--priority <priority>", "Priority (urgent|high|medium|low|none or 0..4)")
        .option("--start-date <date>", "Planned start date YYYY-MM-DD")
        .option("--target-date <date>", "Planned target completion date YYYY-MM-DD")
        .action(async (opts) => {
        const ctx = getContext();
        // Commander's requiredOption is satisfied by the [] default, so enforce client-side.
        if (opts.team.length === 0) {
            throw new CliError("VALIDATION_ERROR", "Missing required option '--team <team>' for 'linear project create'.");
        }
        const content = ctx.resolveMarkdownInput({
            inlineValue: opts.content,
            filePath: opts.contentFile,
            inlineFlag: "--content",
            fileFlag: "--content-file",
        });
        const priority = opts.priority !== undefined ? parsePriority(opts.priority) : undefined;
        const session = await openVerifiedSession(ctx);
        const input = await session.run("project.create.resolve", "read", async (client) => {
            const teamIds = [];
            for (const tRef of opts.team) {
                teamIds.push((await resolveTeam(client, tRef)).id);
            }
            const payload = {
                name: opts.name,
                teamIds,
                ...(opts.summary !== undefined ? { description: opts.summary } : {}),
                ...(content !== undefined ? { content } : {}),
                ...(priority !== undefined ? { priority } : {}),
                ...(opts.startDate ? { startDate: opts.startDate } : {}),
                ...(opts.targetDate ? { targetDate: opts.targetDate } : {}),
            };
            if (opts.status) {
                payload.statusId = (await resolveProjectStatus(client, opts.status)).id;
            }
            if (opts.lead) {
                const lead = await resolveUser(client, opts.lead);
                if (lead.isApp) {
                    throw new CliError("VALIDATION_ERROR", `App user '${lead.name}' cannot be assigned as a project lead.`);
                }
                payload.leadId = lead.id;
            }
            if (opts.member.length > 0) {
                const memberIds = [];
                for (const mRef of opts.member) {
                    const u = await resolveUser(client, mRef);
                    if (u.isApp) {
                        throw new CliError("VALIDATION_ERROR", `App user '${u.name}' cannot be added as a project member.`);
                    }
                    memberIds.push(u.id);
                }
                payload.memberIds = memberIds;
            }
            return payload;
        });
        if (ctx.options.dryRun) {
            ctx.output.dryRun("project.create", input);
            return;
        }
        const created = await session.run("project.create", "create", async (client) => {
            const res = await client.createProject(input);
            if (!res.success)
                throw new CliError("INTERNAL_ERROR", "createProject returned success=false.");
            const p = await res.project;
            if (!p)
                throw new CliError("INTERNAL_ERROR", "createProject returned no project.");
            return mapProjectNode(p);
        });
        ctx.output.success(created, {
            human: () => `Created project '${created.name}' (${created.slugId})\nURL: ${created.url}`,
        });
    });
    projectCmd
        .command("update <project>")
        .description("Partially update a Linear project")
        .option("--name <name>", "New project name")
        .option("--summary <text>", "New short summary")
        .option("--content <markdown>", "New full Markdown overview")
        .option("--content-file <path>", "Read full Markdown overview from file")
        .option("--status <status>", "New project status")
        .option("--lead <user>", "New project lead (or 'none' to clear)")
        .option("--priority <priority>", "New priority")
        .option("--start-date <date>", "Planned start date YYYY-MM-DD (or 'none')")
        .option("--target-date <date>", "Planned target date YYYY-MM-DD (or 'none')")
        .option("--team <team>", "Replacement team set (repeatable)", collectRepeatable, [])
        .action(async (projectRef, opts) => {
        const ctx = getContext();
        const content = ctx.resolveMarkdownInput({
            inlineValue: opts.content,
            filePath: opts.contentFile,
            inlineFlag: "--content",
            fileFlag: "--content-file",
        });
        const session = await openVerifiedSession(ctx);
        const { target, input } = await session.run("project.update.resolve", "read", async (client) => {
            const t = await resolveProject(client, projectRef);
            const payload = {};
            if (opts.name !== undefined)
                payload.name = opts.name;
            if (opts.summary !== undefined)
                payload.description = opts.summary;
            if (content !== undefined)
                payload.content = content;
            if (opts.priority !== undefined)
                payload.priority = parsePriority(opts.priority);
            if (opts.status)
                payload.statusId = (await resolveProjectStatus(client, opts.status)).id;
            if (opts.lead !== undefined) {
                if (opts.lead.toLowerCase() === "none") {
                    payload.leadId = null;
                }
                else {
                    const lead = await resolveUser(client, opts.lead);
                    if (lead.isApp)
                        throw new CliError("VALIDATION_ERROR", `App user '${lead.name}' cannot be a project lead.`);
                    payload.leadId = lead.id;
                }
            }
            if (opts.startDate !== undefined) {
                payload.startDate = opts.startDate.toLowerCase() === "none" ? null : opts.startDate;
            }
            if (opts.targetDate !== undefined) {
                payload.targetDate = opts.targetDate.toLowerCase() === "none" ? null : opts.targetDate;
            }
            if (opts.team.length > 0) {
                const teamIds = [];
                for (const tRef of opts.team)
                    teamIds.push((await resolveTeam(client, tRef)).id);
                payload.teamIds = teamIds;
            }
            if (Object.keys(payload).length === 0) {
                throw new CliError("VALIDATION_ERROR", "No update fields specified for 'linear project update'.");
            }
            return { target: t, input: payload };
        });
        if (ctx.options.dryRun) {
            ctx.output.dryRun("project.update", { id: target.id, slugId: target.slugId, input });
            return;
        }
        const updated = await session.run("project.update", "idempotent-write", async (client) => {
            const res = await client.updateProject(target.id, input);
            if (!res.success)
                throw new CliError("INTERNAL_ERROR", "updateProject returned success=false.");
            const p = await res.project;
            return p ? mapProjectNode(p) : { id: target.id, name: target.name, slugId: target.slugId };
        });
        ctx.output.success(updated, {
            human: () => `Updated project ${target.slugId}`,
        });
    });
    projectCmd
        .command("status <project> <status>")
        .description("Update a project's status")
        .action(async (projectRef, statusRef) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const { target, status } = await session.run("project.status.resolve", "read", async (client) => ({
            target: await resolveProject(client, projectRef),
            status: await resolveProjectStatus(client, statusRef),
        }));
        if (ctx.options.dryRun) {
            ctx.output.dryRun("project.status", { id: target.id, slugId: target.slugId, statusId: status.id, status: status.name });
            return;
        }
        const updated = await session.run("project.status", "idempotent-write", async (client) => {
            const res = await client.updateProject(target.id, { statusId: status.id });
            const p = await res.project;
            return p ? mapProjectNode(p) : { id: target.id, slugId: target.slugId, status: status.name };
        });
        ctx.output.success(updated, {
            human: () => `Updated project '${target.name}' status -> ${status.name}`,
        });
    });
    projectCmd
        .command("archive <project>")
        .description("Archive a project")
        .action(async (projectRef) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const target = await session.run("project.archive.resolve", "read", (client) => resolveProject(client, projectRef));
        if (ctx.options.dryRun) {
            ctx.output.dryRun("project.archive", { id: target.id, slugId: target.slugId });
            return;
        }
        const res = await session.run("project.archive", "idempotent-write", (client) => client.archiveProject(target.id));
        ctx.output.success({ id: target.id, slugId: target.slugId, archived: Boolean(res.success) }, {
            human: () => `Archived project ${target.slugId}`,
        });
    });
    projectCmd
        .command("restore <project>")
        .description("Restore (unarchive) an archived project")
        .action(async (projectRef) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const target = await session.run("project.restore.resolve", "read", async (client) => {
            if (isUuid(projectRef.trim())) {
                return { id: projectRef.trim(), name: projectRef.trim(), slugId: projectRef.trim() };
            }
            const conn = await client.projects({
                first: 100,
                includeArchived: true,
                filter: {
                    or: [{ slugId: { eq: projectRef.trim() } }, { name: { eqIgnoreCase: projectRef.trim() } }],
                },
            });
            const m = conn.nodes[0];
            if (!m)
                throw new CliError("NOT_FOUND", `Project '${projectRef}' not found.`);
            return { id: m.id, name: m.name, slugId: m.slugId };
        });
        if (ctx.options.dryRun) {
            ctx.output.dryRun("project.restore", { id: target.id, slugId: target.slugId });
            return;
        }
        const res = await session.run("project.restore", "idempotent-write", (client) => client.unarchiveProject(target.id));
        ctx.output.success({ id: target.id, slugId: target.slugId, restored: Boolean(res.success) }, {
            human: () => `Restored project ${target.slugId}`,
        });
    });
    projectCmd
        .command("delete <project>")
        .description("Move a project to trash (requires --yes; recoverable until Linear purges it)")
        .option("--yes", "Confirm moving the project to trash")
        .action(async (projectRef, opts) => {
        const ctx = getContext();
        ctx.requireDestructiveConfirmation(Boolean(opts.yes), `delete project '${projectRef}'`);
        const session = await openVerifiedSession(ctx);
        const target = await session.run("project.delete.resolve", "read", (client) => resolveProject(client, projectRef));
        if (ctx.options.dryRun) {
            ctx.output.dryRun("project.delete", { id: target.id, slugId: target.slugId });
            return;
        }
        const res = await session.run("project.delete", "idempotent-write", (client) => client.deleteProject(target.id));
        // Linear moves deleted projects to trash; they may still appear in
        // --include-archived listings until Linear purges them.
        ctx.output.success({ id: target.id, slugId: target.slugId, deleted: Boolean(res.success), trashed: Boolean(res.success) }, {
            human: () => `Moved project ${target.slugId} to trash (Linear keeps it recoverable until purge)`,
        });
    });
    // ==================== 2. MILESTONES ====================
    const msCmd = getOrCreateSubcommand(program, "milestone", "List, inspect, create, and update project milestones");
    msCmd
        .command("list")
        .description("List milestones in a project")
        .requiredOption("--project <project>", "Project name, slugId, P-identifier, or UUID")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const items = await session.run("milestone.list", "read", async (client) => {
            const proj = await resolveProject(client, opts.project);
            const pNode = await client.project(proj.id);
            const conn = await pNode.projectMilestones({ first: 100 });
            return conn.nodes.map((m) => ({
                id: m.id,
                name: m.name,
                description: m.description ?? null,
                targetDate: m.targetDate ?? null,
                sortOrder: m.sortOrder,
            }));
        });
        ctx.output.success(items, {
            human: () => formatTable(items, [
                { header: "NAME", value: (r) => r.name },
                { header: "TARGET_DATE", value: (r) => r.targetDate },
                { header: "ID", value: (r) => r.id },
            ]),
        });
    });
    msCmd
        .command("get <milestone>")
        .description("Inspect a project milestone by UUID or name (with --project)")
        .option("--project <project>", "Project when resolving milestone by name")
        .action(async (milestoneRef, opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const data = await session.run("milestone.get", "read", (client) => resolveMilestoneNode(client, milestoneRef, opts.project));
        ctx.output.success(data, {
            human: () => formatKeyValue([
                ["ID", data.id],
                ["Name", data.name],
                ["Target Date", data.targetDate],
                ["Project ID", data.projectId],
                ["Description", data.description],
            ]),
        });
    });
    msCmd
        .command("create")
        .description("Create a milestone in a project")
        .requiredOption("--project <project>", "Project name, slugId, P-identifier, or UUID")
        .requiredOption("--name <name>", "Milestone name")
        .option("--target-date <date>", "Planned target date YYYY-MM-DD")
        .option("--description <markdown>", "Milestone Markdown description")
        .option("--description-file <path>", "Read milestone Markdown description from file")
        .action(async (opts) => {
        const ctx = getContext();
        const description = ctx.resolveMarkdownInput({
            inlineValue: opts.description,
            filePath: opts.descriptionFile,
            inlineFlag: "--description",
            fileFlag: "--description-file",
        });
        const session = await openVerifiedSession(ctx);
        const proj = await session.run("milestone.create.resolve", "read", (client) => resolveProject(client, opts.project));
        const input = {
            projectId: proj.id,
            name: opts.name,
            ...(opts.targetDate ? { targetDate: opts.targetDate } : {}),
            ...(description !== undefined ? { description } : {}),
        };
        if (ctx.options.dryRun) {
            ctx.output.dryRun("milestone.create", input);
            return;
        }
        const created = await session.run("milestone.create", "create", async (client) => {
            const res = await client.createProjectMilestone(input);
            if (!res.success)
                throw new CliError("INTERNAL_ERROR", "createProjectMilestone returned success=false.");
            const m = await res.projectMilestone;
            return {
                id: m?.id ?? null,
                name: m?.name ?? opts.name,
                targetDate: m?.targetDate ?? opts.targetDate ?? null,
                projectId: proj.id,
            };
        });
        ctx.output.success(created, {
            human: () => `Created milestone '${created.name}' (${created.id ?? ""})`,
        });
    });
    msCmd
        .command("update <milestone>")
        .description("Update an existing project milestone")
        .option("--project <project>", "Project when resolving milestone by name")
        .option("--name <name>", "New milestone name")
        .option("--target-date <date>", "New target date YYYY-MM-DD (or 'none' to clear)")
        .option("--description <markdown>", "Replacement Markdown description")
        .option("--description-file <path>", "Read replacement Markdown description from file")
        .action(async (milestoneRef, opts) => {
        const ctx = getContext();
        const description = ctx.resolveMarkdownInput({
            inlineValue: opts.description,
            filePath: opts.descriptionFile,
            inlineFlag: "--description",
            fileFlag: "--description-file",
        });
        const session = await openVerifiedSession(ctx);
        const target = await session.run("milestone.update.resolve", "read", (client) => resolveMilestoneNode(client, milestoneRef, opts.project));
        const input = {};
        if (opts.name !== undefined)
            input.name = opts.name;
        if (description !== undefined)
            input.description = description;
        if (opts.targetDate !== undefined) {
            input.targetDate = opts.targetDate.toLowerCase() === "none" ? null : opts.targetDate;
        }
        if (Object.keys(input).length === 0) {
            throw new CliError("VALIDATION_ERROR", "No update fields specified for 'linear milestone update'.");
        }
        if (ctx.options.dryRun) {
            ctx.output.dryRun("milestone.update", { id: target.id, input });
            return;
        }
        const updated = await session.run("milestone.update", "idempotent-write", async (client) => {
            const res = await client.updateProjectMilestone(target.id, input);
            if (!res.success)
                throw new CliError("INTERNAL_ERROR", "updateProjectMilestone returned success=false.");
            const m = await res.projectMilestone;
            return {
                id: m?.id ?? target.id,
                name: m?.name ?? opts.name ?? target.name,
                targetDate: m?.targetDate ?? target.targetDate,
            };
        });
        ctx.output.success(updated, {
            human: () => `Updated milestone '${updated.name}'`,
        });
    });
    // ==================== 3. CYCLES ====================
    const cycleCmd = getOrCreateSubcommand(program, "cycle", "Inspect team cycles and cycle issues");
    cycleCmd
        .command("list")
        .description("List cycles for a team")
        .requiredOption("--team <team>", "Team key, name, or UUID")
        .option("--include-archived", "Include archived cycles")
        .option("--limit <n>", "Maximum results per page")
        .option("--cursor <cursor>", "Pagination cursor")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
            limit: parseIntOpt(opts.limit, "--limit"),
            cursor: opts.cursor,
            includeArchived: opts.includeArchived,
        });
        const page = await session.run("cycle.list", "read", async (client) => {
            const team = await resolveTeam(client, opts.team);
            const conn = await client.cycles({
                ...pageVars,
                filter: { team: { id: { eq: team.id } } },
            });
            return toPaginatedResult(conn, (c) => ({
                id: c.id,
                number: c.number,
                name: c.name ?? null,
                startsAt: new Date(c.startsAt).toISOString(),
                endsAt: new Date(c.endsAt).toISOString(),
                completedAt: c.completedAt ? new Date(c.completedAt).toISOString() : null,
            }));
        });
        ctx.output.success(page.items, {
            pageInfo: page.pageInfo,
            human: () => formatTable(page.items, [
                { header: "NUMBER", value: (r) => `#${r.number}` },
                { header: "NAME", value: (r) => r.name },
                { header: "STARTS_AT", value: (r) => r.startsAt.slice(0, 10) },
                { header: "ENDS_AT", value: (r) => r.endsAt.slice(0, 10) },
                { header: "ID", value: (r) => r.id },
            ]),
        });
    });
    cycleCmd
        .command("current")
        .description("Retrieve the active current cycle for a team")
        .requiredOption("--team <team>", "Team key, name, or UUID")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const cyc = await session.run("cycle.current", "read", async (client) => {
            const team = await resolveTeam(client, opts.team);
            return resolveCycle(client, "current", team.id);
        });
        ctx.output.success(cyc, {
            human: () => formatKeyValue([
                ["ID", cyc.id],
                ["Number", `#${cyc.number}`],
                ["Name", cyc.name],
                ["Starts At", cyc.startsAt],
                ["Ends At", cyc.endsAt],
            ]),
        });
    });
    cycleCmd
        .command("issues <cycle>")
        .description("List issues in a cycle ('current', 'next', 'previous', cycle number, name, or UUID)")
        .option("--team <team>", "Team key, name, or UUID (required unless <cycle> is a UUID)")
        .option("--limit <n>", "Maximum results per page")
        .option("--cursor <cursor>", "Pagination cursor")
        .action(async (cycleRef, opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
            limit: parseIntOpt(opts.limit, "--limit"),
            cursor: opts.cursor,
        });
        const page = await session.run("cycle.issues", "read", async (client) => {
            const teamId = opts.team ? (await resolveTeam(client, opts.team)).id : undefined;
            const cyc = await resolveCycle(client, cycleRef, teamId);
            const cNode = await client.cycle(cyc.id);
            const conn = await cNode.issues(pageVars);
            const items = await Promise.all(conn.nodes.map((n) => mapIssueNode(n)));
            return {
                items,
                pageInfo: {
                    hasNextPage: Boolean(conn.pageInfo?.hasNextPage),
                    endCursor: conn.pageInfo?.endCursor ?? null,
                    count: items.length,
                },
            };
        });
        ctx.output.success(page.items, {
            pageInfo: page.pageInfo,
            human: () => formatTable(page.items, [
                { header: "ID", value: (r) => r.identifier },
                { header: "STATUS", value: (r) => r.status },
                { header: "ASSIGNEE", value: (r) => r.assignee },
                { header: "TITLE", value: (r) => r.title, maxWidth: 48 },
            ]),
        });
    });
    // ==================== 4. PROJECT STATUS UPDATES ====================
    const updateCmd = getOrCreateSubcommand(program, "update", "List, publish, and edit project health status updates");
    updateCmd
        .command("list")
        .description("List status updates published on a project")
        .requiredOption("--project <project>", "Project name, slugId, P-identifier, or UUID")
        .option("--limit <n>", "Maximum results per page")
        .option("--cursor <cursor>", "Pagination cursor")
        .action(async (opts) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
            limit: parseIntOpt(opts.limit, "--limit"),
            cursor: opts.cursor,
        });
        const page = await session.run("update.list", "read", async (client) => {
            const proj = await resolveProject(client, opts.project);
            const pNode = await client.project(proj.id);
            const conn = await pNode.projectUpdates(pageVars);
            const items = await Promise.all(conn.nodes.map(async (u) => {
                const author = await Promise.resolve(u.user).catch(() => undefined);
                return {
                    id: u.id,
                    health: u.health,
                    author: author?.name ?? null,
                    body: u.body,
                    url: u.url,
                    createdAt: new Date(u.createdAt).toISOString(),
                };
            }));
            return {
                items,
                pageInfo: {
                    hasNextPage: Boolean(conn.pageInfo?.hasNextPage),
                    endCursor: conn.pageInfo?.endCursor ?? null,
                    count: items.length,
                },
            };
        });
        ctx.output.success(page.items, {
            pageInfo: page.pageInfo,
            human: () => formatTable(page.items, [
                { header: "ID", value: (r) => r.id },
                { header: "HEALTH", value: (r) => r.health },
                { header: "AUTHOR", value: (r) => r.author },
                { header: "BODY", value: (r) => r.body, maxWidth: 50 },
            ]),
        });
    });
    updateCmd
        .command("create")
        .description("Publish a new project health status update")
        .requiredOption("--project <project>", "Project name, slugId, P-identifier, or UUID")
        .option("--health <health>", "Health status: onTrack | atRisk | offTrack (default onTrack)")
        .option("--body <markdown>", "Status update Markdown body")
        .option("--body-file <path>", "Read status update Markdown body from file")
        .action(async (opts) => {
        const ctx = getContext();
        const body = ctx.resolveMarkdownInput({
            inlineValue: opts.body,
            filePath: opts.bodyFile,
            inlineFlag: "--body",
            fileFlag: "--body-file",
        });
        if (!body || !body.trim()) {
            throw new CliError("VALIDATION_ERROR", "Status update body is required via '--body' or '--body-file'.");
        }
        const health = parseHealth(opts.health) ?? LinearDocument.ProjectUpdateHealthType.OnTrack;
        const session = await openVerifiedSession(ctx);
        const proj = await session.run("update.create.resolve", "read", (client) => resolveProject(client, opts.project));
        const input = {
            projectId: proj.id,
            body,
            health,
        };
        if (ctx.options.dryRun) {
            ctx.output.dryRun("update.create", input);
            return;
        }
        const created = await session.run("update.create", "create", async (client) => {
            const res = await client.createProjectUpdate(input);
            if (!res.success)
                throw new CliError("INTERNAL_ERROR", "createProjectUpdate returned success=false.");
            const u = await res.projectUpdate;
            return {
                id: u?.id ?? null,
                projectId: proj.id,
                health: u?.health ?? health,
                body: u?.body ?? body,
                url: u?.url ?? null,
            };
        });
        ctx.output.success(created, {
            human: () => `Published project status update ${created.id ?? ""} (${created.health})`,
        });
    });
    updateCmd
        .command("edit <updateId>")
        .description("Edit an existing project status update")
        .option("--health <health>", "Updated health status: onTrack | atRisk | offTrack")
        .option("--body <markdown>", "Updated Markdown body")
        .option("--body-file <path>", "Read updated Markdown body from file")
        .action(async (updateId, opts) => {
        const ctx = getContext();
        const body = ctx.resolveMarkdownInput({
            inlineValue: opts.body,
            filePath: opts.bodyFile,
            inlineFlag: "--body",
            fileFlag: "--body-file",
        });
        const health = parseHealth(opts.health);
        const input = {};
        if (body !== undefined)
            input.body = body;
        if (health !== undefined)
            input.health = health;
        if (Object.keys(input).length === 0) {
            throw new CliError("VALIDATION_ERROR", "Provide '--body', '--body-file', or '--health' to edit status update.");
        }
        const id = updateId.trim();
        if (ctx.options.dryRun) {
            ctx.output.dryRun("update.edit", { id, input });
            return;
        }
        const session = await openVerifiedSession(ctx);
        const updated = await session.run("update.edit", "idempotent-write", async (client) => {
            const res = await client.updateProjectUpdate(id, input);
            if (!res.success)
                throw new CliError("INTERNAL_ERROR", "updateProjectUpdate returned success=false.");
            const u = await res.projectUpdate;
            return { id: u?.id ?? id, health: u?.health ?? health, body: u?.body ?? body, url: u?.url ?? null };
        });
        ctx.output.success(updated, {
            human: () => `Edited project status update ${updated.id}`,
        });
    });
}
//# sourceMappingURL=commands.js.map