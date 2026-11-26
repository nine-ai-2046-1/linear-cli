import { LinearDocument } from "@linear/sdk";
import { Command } from "commander";
import type { CliContext } from "../../cli/context.js";
import { openVerifiedSession } from "../../core/client.js";
import { CliError } from "../../core/errors.js";
import { formatKeyValue, formatTable } from "../../core/output.js";
import { resolvePaginationVariables, toPaginatedResult } from "../../core/pagination.js";
import {
  isUuid,
  parsePriority,
  resolveCycle,
  resolveIssueLabels,
  resolveProject,
  resolveTeam,
  resolveUser,
  resolveWorkflowState,
} from "../../core/resolvers.js";
import { getOrCreateSubcommand } from "../workspace/commands.js";
import {
  buildIssueFilter,
  mapIssueNode,
  resolveIssueSummary,
  type IssueListFilterOptions,
  type IssueSummaryDto,
} from "./filter.js";

function collectRepeatable(val: string, prev: string[]): string[] {
  return [...prev, val];
}

function parseIntOpt(val: string | undefined, flag: string): number | undefined {
  if (val === undefined) return undefined;
  const n = Number(val);
  if (!Number.isInteger(n)) {
    throw new CliError("VALIDATION_ERROR", `Invalid ${flag} '${val}': expected integer.`);
  }
  return n;
}

function renderIssueTable(items: IssueSummaryDto[]): string {
  return formatTable(items, [
    { header: "ID", value: (r) => r.identifier },
    { header: "STATUS", value: (r) => r.status },
    { header: "PRIORITY", value: (r) => r.priorityName },
    { header: "ASSIGNEE", value: (r) => r.assignee },
    { header: "TITLE", value: (r) => r.title, maxWidth: 50 },
  ]);
}

function attachIssueFilterOptions(cmd: Command): Command {
  return cmd
    .option("--assignee <user>", "Filter by assignee ('me', email, displayName, name, or UUID)")
    .option("--unassigned", "Filter to unassigned issues only")
    .option("--status <status>", "Filter by workflow status name, type, or UUID")
    .option("--team <team>", "Filter by team key, name, or UUID")
    .option("--project <project>", "Filter by project name, slugId, P-identifier, or UUID")
    .option("--cycle <cycle>", "Filter by cycle ('current', 'next', 'previous', number, name, or UUID)")
    .option("--label <label>", "Filter by label name or UUID (repeatable)", collectRepeatable, [])
    .option("--priority <priority>", "Filter by priority (urgent|high|medium|low|none or 0..4)")
    .option("--updated-after <isoOrDuration>", "Filter updatedAt >= ISO date or duration (e.g. -P7D)")
    .option("--created-after <isoOrDuration>", "Filter createdAt >= ISO date or duration")
    .option("--completed-after <isoOrDuration>", "Filter completedAt >= ISO date or duration")
    .option("--due-before <date>", "Filter dueDate <= YYYY-MM-DD")
    .option("--creator <user>", "Filter by creator ('me', email, name, or UUID)")
    .option("--parent <issue>", "Filter by parent issue identifier or UUID")
    .option("--include-archived", "Include archived issues")
    .option("--limit <n>", "Maximum results per page (1..250, default 50)")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--sort <field>", "Sort order: created or updated");
}

export function registerIssueCommands(program: Command, getContext: () => CliContext): void {
  const issueCmd = getOrCreateSubcommand(program, "issue", "List, search, create, update, and relate Linear issues");

  // 1. issue list
  attachIssueFilterOptions(
    issueCmd.command("list").description("List issues with combinable server-side filters"),
  ).action(
    async (
      opts: IssueListFilterOptions & {
        includeArchived?: boolean;
        limit?: string;
        cursor?: string;
        sort?: "created" | "updated";
      },
    ) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const pageVars = resolvePaginationVariables({
        limit: parseIntOpt(opts.limit, "--limit"),
        cursor: opts.cursor,
        sort: opts.sort,
        includeArchived: opts.includeArchived,
      });

      const page = await session.run("issue.list", "read", async (client) => {
        const filter = await buildIssueFilter(client, opts);
        const conn = await client.issues({
          ...pageVars,
          ...(Object.keys(filter).length > 0 ? { filter } : {}),
        } as Parameters<typeof client.issues>[0]);
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
        human: () => renderIssueTable(page.items),
      });
    },
  );

  // 2. issue mine
  attachIssueFilterOptions(
    issueCmd.command("mine").description("List issues assigned to the authenticated user ('me')"),
  ).action(
    async (
      opts: IssueListFilterOptions & {
        includeArchived?: boolean;
        limit?: string;
        cursor?: string;
        sort?: "created" | "updated";
      },
    ) => {
      if (opts.unassigned) {
        throw new CliError("VALIDATION_ERROR", "'linear issue mine' cannot be combined with '--unassigned'.");
      }
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const pageVars = resolvePaginationVariables({
        limit: parseIntOpt(opts.limit, "--limit"),
        cursor: opts.cursor,
        sort: opts.sort,
        includeArchived: opts.includeArchived,
      });

      const page = await session.run("issue.mine", "read", async (client) => {
        const filter = await buildIssueFilter(client, { ...opts, assignee: opts.assignee ?? "me" });
        const conn = await client.issues({
          ...pageVars,
          filter: filter as Parameters<typeof client.issues>[0] extends { filter?: infer F } ? F : never,
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
        human: () => renderIssueTable(page.items),
      });
    },
  );

  // 3. issue search <query>
  issueCmd
    .command("search <query>")
    .description("Full-text search across Linear issue titles, descriptions, and optionally comments")
    .option("--team <team>", "Restrict search to a team")
    .option("--include-comments", "Also search inside comment bodies")
    .option("--include-archived", "Include archived issues")
    .option("--limit <n>", "Maximum results per page (1..250, default 50)")
    .option("--cursor <cursor>", "Pagination cursor")
    .action(
      async (
        query: string,
        opts: {
          team?: string;
          includeComments?: boolean;
          includeArchived?: boolean;
          limit?: string;
          cursor?: string;
        },
      ) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
          limit: parseIntOpt(opts.limit, "--limit"),
          cursor: opts.cursor,
          includeArchived: opts.includeArchived,
        });

        const page = await session.run("issue.search", "read", async (client) => {
          let teamId: string | undefined;
          if (opts.team) {
            teamId = (await resolveTeam(client, opts.team)).id;
          }
          const conn = await client.searchIssues(query, {
            first: pageVars.first,
            ...(pageVars.after ? { after: pageVars.after } : {}),
            ...(pageVars.includeArchived !== undefined ? { includeArchived: pageVars.includeArchived } : {}),
            ...(opts.includeComments !== undefined ? { includeComments: opts.includeComments } : {}),
            ...(teamId ? { teamId } : {}),
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
          human: () => renderIssueTable(page.items),
        });
      },
    );

  // 4. issue get <issue>
  issueCmd
    .command("get <issue>")
    .description("Retrieve detailed information about an issue by identifier (e.g. NIN-11) or UUID")
    .action(async (issueRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const data = await session.run("issue.get", "read", async (client) => {
        let issue;
        try {
          issue = await client.issue(issueRef.trim());
        } catch (cause) {
          throw new CliError("NOT_FOUND", `Issue '${issueRef}' not found.`, { cause });
        }
        const summary = await mapIssueNode(issue);
        const [parent, cycle, milestone, attachmentsConn] = await Promise.all([
          Promise.resolve(issue.parent).catch(() => undefined),
          Promise.resolve(issue.cycle).catch(() => undefined),
          Promise.resolve(issue.projectMilestone).catch(() => undefined),
          typeof issue.attachments === "function"
            ? issue.attachments({ first: 50 }).catch(() => ({ nodes: [] }))
            : Promise.resolve({ nodes: [] }),
        ]);
        return {
          ...summary,
          description: issue.description ?? null,
          parent: parent ? { id: parent.id, identifier: parent.identifier, title: parent.title } : null,
          cycle: cycle ? { id: cycle.id, number: cycle.number, name: cycle.name ?? null } : null,
          milestone: milestone ? { id: milestone.id, name: milestone.name } : null,
          attachments: attachmentsConn.nodes.map((a) => ({
            id: a.id,
            title: a.title,
            subtitle: a.subtitle ?? null,
            url: a.url,
          })),
        };
      });

      ctx.output.success(data, {
        human: () =>
          `${formatKeyValue([
            ["Identifier", data.identifier],
            ["ID", data.id],
            ["Title", data.title],
            ["Status", data.status],
            ["Priority", data.priorityName],
            ["Assignee", data.assignee],
            ["Team", data.team],
            ["Project", data.project],
            ["Milestone", data.milestone?.name ?? null],
            ["Cycle", data.cycle ? `#${data.cycle.number}` : null],
            ["Parent", data.parent?.identifier ?? null],
            ["Labels", data.labels],
            ["Due Date", data.dueDate],
            ["Estimate", data.estimate],
            ["Branch", data.branchName],
            ["URL", data.url],
          ])}${data.description ? `\n\nDescription:\n${data.description}` : ""}`,
      });
    });

  // 5. issue create
  issueCmd
    .command("create")
    .description("Create a new Linear issue")
    .requiredOption("--team <team>", "Team key, name, or UUID")
    .option("--title <title>", "Issue title (required unless --template is provided)")
    .option("--description <markdown>", "Issue description in Markdown")
    .option("--description-file <path>", "Read issue description Markdown from file")
    .option("--assignee <user>", "Assignee ('me', email, name, or UUID)")
    .option("--status <status>", "Workflow status name, type, or UUID")
    .option("--label <label>", "Label name or UUID (repeatable)", collectRepeatable, [])
    .option("--priority <priority>", "Priority (urgent|high|medium|low|none or 0..4)")
    .option("--project <project>", "Project name, slugId, P-identifier, or UUID")
    .option("--milestone <milestone>", "Project milestone name or UUID (requires --project)")
    .option("--cycle <cycle>", "Cycle ('current', 'next', 'previous', number, name, or UUID)")
    .option("--parent <issue>", "Parent issue identifier or UUID")
    .option("--estimate <n>", "Numeric issue estimate")
    .option("--due-date <date>", "Due date in YYYY-MM-DD format")
    .option("--template <template>", "Issue template UUID or exact name")
    .option("--delegate <agent>", "Agent user to delegate issue to")
    .action(
      async (opts: {
        team: string;
        title?: string;
        description?: string;
        descriptionFile?: string;
        assignee?: string;
        status?: string;
        label: string[];
        priority?: string;
        project?: string;
        milestone?: string;
        cycle?: string;
        parent?: string;
        estimate?: string;
        dueDate?: string;
        template?: string;
        delegate?: string;
      }) => {
        const ctx = getContext();
        if (!opts.title && !opts.template) {
          throw new CliError("VALIDATION_ERROR", "Either '--title <title>' or '--template <template>' is required.");
        }
        if (opts.milestone && !opts.project) {
          throw new CliError("VALIDATION_ERROR", "'--milestone' requires '--project' to also be specified.");
        }
        const description = ctx.resolveMarkdownInput({
          inlineValue: opts.description,
          filePath: opts.descriptionFile,
          inlineFlag: "--description",
          fileFlag: "--description-file",
        });
        const priority = opts.priority !== undefined ? parsePriority(opts.priority) : undefined;
        const estimate = parseIntOpt(opts.estimate, "--estimate");

        const session = await openVerifiedSession(ctx);
        const input = await session.run("issue.create.resolve", "read", async (client) => {
          const team = await resolveTeam(client, opts.team);
          const payload: Record<string, unknown> = {
            teamId: team.id,
            ...(opts.title ? { title: opts.title } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(priority !== undefined ? { priority } : {}),
            ...(estimate !== undefined ? { estimate } : {}),
            ...(opts.dueDate ? { dueDate: opts.dueDate } : {}),
          };

          if (opts.assignee) {
            payload.assigneeId = (await resolveUser(client, opts.assignee)).id;
          }
          if (opts.delegate) {
            payload.delegateId = (await resolveUser(client, opts.delegate)).id;
          }
          if (opts.status) {
            payload.stateId = (await resolveWorkflowState(client, team.id, opts.status)).id;
          }
          if (opts.label.length > 0) {
            const labels = await resolveIssueLabels(client, opts.label, { teamId: team.id });
            payload.labelIds = labels.map((l) => l.id);
          }
          if (opts.project) {
            const proj = await resolveProject(client, opts.project);
            payload.projectId = proj.id;
            if (opts.milestone) {
              const pNode = await client.project(proj.id);
              const msConn = await pNode.projectMilestones({ first: 100 });
              const q = opts.milestone.trim();
              const ms = isUuid(q)
                ? msConn.nodes.find((m) => m.id.toLowerCase() === q.toLowerCase())
                : msConn.nodes.find((m) => m.name.toLowerCase() === q.toLowerCase());
              if (!ms) {
                throw new CliError("NOT_FOUND", `Milestone '${opts.milestone}' not found in project '${proj.name}'.`);
              }
              payload.projectMilestoneId = ms.id;
            }
          }
          if (opts.cycle) {
            payload.cycleId = (await resolveCycle(client, opts.cycle, team.id)).id;
          }
          if (opts.parent) {
            payload.parentId = (await resolveIssueSummary(client, opts.parent)).id;
          }
          if (opts.template) {
            if (isUuid(opts.template)) {
              payload.templateId = opts.template.trim();
            } else {
              const tpls = await client.templates;
              const match = tpls.find((t) => t.name.toLowerCase() === opts.template!.trim().toLowerCase());
              if (!match) throw new CliError("NOT_FOUND", `Template '${opts.template}' not found.`);
              payload.templateId = match.id;
            }
          }
          return payload;
        });

        if (ctx.options.dryRun) {
          ctx.output.dryRun("issue.create", input);
          return;
        }

        const created = await session.run("issue.create", "create", async (client) => {
          const res = await client.createIssue(input as unknown as LinearDocument.IssueCreateInput);
          if (!res.success) {
            throw new CliError("INTERNAL_ERROR", "Linear createIssue returned success=false.");
          }
          const issue = await res.issue;
          if (!issue) {
            throw new CliError("INTERNAL_ERROR", "Linear createIssue returned no issue payload.");
          }
          return mapIssueNode(issue);
        });

        ctx.output.success(created, {
          human: () => `Created issue ${created.identifier}: ${created.title}\nURL: ${created.url}`,
        });
      },
    );

  // 6. issue update <issue>
  issueCmd
    .command("update <issue>")
    .description("Partially update specified fields on an issue without clobbering unspecified fields")
    .option("--title <title>", "New title")
    .option("--description <markdown>", "Replacement Markdown description")
    .option("--description-file <path>", "Read replacement Markdown description from file")
    .option("--assignee <user>", "New assignee ('me', email, name, UUID, or 'none')")
    .option("--clear-assignee", "Unassign the issue")
    .option("--status <status>", "New workflow status")
    .option("--add-label <label>", "Add label without replacing existing labels (repeatable)", collectRepeatable, [])
    .option("--remove-label <label>", "Remove label without affecting other labels (repeatable)", collectRepeatable, [])
    .option("--set-labels <label>", "Replace entire label set (repeatable)", collectRepeatable, [])
    .option("--priority <priority>", "New priority (urgent|high|medium|low|none or 0..4)")
    .option("--project <project>", "Set project (or 'none' to clear)")
    .option("--clear-project", "Remove issue from its current project")
    .option("--cycle <cycle>", "Set cycle ('current', 'next', 'previous', number, UUID, or 'none')")
    .option("--clear-cycle", "Remove issue from its cycle")
    .option("--parent <issue>", "Set parent issue (or 'none' to make top-level)")
    .option("--clear-parent", "Clear parent issue")
    .option("--estimate <n>", "Set numeric estimate")
    .option("--clear-estimate", "Clear estimate")
    .option("--due-date <date>", "Set due date YYYY-MM-DD (or 'none' to clear)")
    .option("--clear-due-date", "Clear due date")
    .action(
      async (
        issueRef: string,
        opts: {
          title?: string;
          description?: string;
          descriptionFile?: string;
          assignee?: string;
          clearAssignee?: boolean;
          status?: string;
          addLabel: string[];
          removeLabel: string[];
          setLabels: string[];
          priority?: string;
          project?: string;
          clearProject?: boolean;
          cycle?: string;
          clearCycle?: boolean;
          parent?: string;
          clearParent?: boolean;
          estimate?: string;
          clearEstimate?: boolean;
          dueDate?: string;
          clearDueDate?: boolean;
        },
      ) => {
        const ctx = getContext();
        if (opts.setLabels.length > 0 && (opts.addLabel.length > 0 || opts.removeLabel.length > 0)) {
          throw new CliError(
            "VALIDATION_ERROR",
            "Cannot combine '--set-labels' with '--add-label' or '--remove-label'.",
          );
        }
        const description = ctx.resolveMarkdownInput({
          inlineValue: opts.description,
          filePath: opts.descriptionFile,
          inlineFlag: "--description",
          fileFlag: "--description-file",
        });

        const session = await openVerifiedSession(ctx);
        const { targetId, identifier, input } = await session.run("issue.update.resolve", "read", async (client) => {
          const target = await resolveIssueSummary(client, issueRef);
          const payload: Record<string, unknown> = {};

          if (opts.title !== undefined) payload.title = opts.title;
          if (description !== undefined) payload.description = description;
          if (opts.priority !== undefined) payload.priority = parsePriority(opts.priority);

          if (opts.clearAssignee || opts.assignee?.toLowerCase() === "none") {
            payload.assigneeId = null;
          } else if (opts.assignee) {
            payload.assigneeId = (await resolveUser(client, opts.assignee)).id;
          }

          if (opts.status) {
            if (!target.teamId) throw new CliError("INTERNAL_ERROR", "Unable to determine issue team for status lookup.");
            payload.stateId = (await resolveWorkflowState(client, target.teamId, opts.status)).id;
          }

          if (opts.setLabels.length > 0) {
            const labels = await resolveIssueLabels(client, opts.setLabels, { teamId: target.teamId ?? undefined });
            payload.labelIds = labels.map((l) => l.id);
          } else {
            if (opts.addLabel.length > 0) {
              const added = await resolveIssueLabels(client, opts.addLabel, { teamId: target.teamId ?? undefined });
              payload.addedLabelIds = added.map((l) => l.id);
            }
            if (opts.removeLabel.length > 0) {
              const removed = await resolveIssueLabels(client, opts.removeLabel, { teamId: target.teamId ?? undefined });
              payload.removedLabelIds = removed.map((l) => l.id);
            }
          }

          if (opts.clearProject || opts.project?.toLowerCase() === "none") {
            payload.projectId = null;
          } else if (opts.project) {
            payload.projectId = (await resolveProject(client, opts.project)).id;
          }

          if (opts.clearCycle || opts.cycle?.toLowerCase() === "none") {
            payload.cycleId = null;
          } else if (opts.cycle) {
            payload.cycleId = (await resolveCycle(client, opts.cycle, target.teamId ?? undefined)).id;
          }

          if (opts.clearParent || opts.parent?.toLowerCase() === "none") {
            payload.parentId = null;
          } else if (opts.parent) {
            payload.parentId = (await resolveIssueSummary(client, opts.parent)).id;
          }

          if (opts.clearEstimate) {
            payload.estimate = null;
          } else if (opts.estimate !== undefined) {
            payload.estimate = parseIntOpt(opts.estimate, "--estimate");
          }

          if (opts.clearDueDate || opts.dueDate?.toLowerCase() === "none") {
            payload.dueDate = null;
          } else if (opts.dueDate !== undefined) {
            payload.dueDate = opts.dueDate;
          }

          if (Object.keys(payload).length === 0) {
            throw new CliError("VALIDATION_ERROR", "No update fields specified for 'linear issue update'.");
          }
          return { targetId: target.id, identifier: target.identifier, input: payload };
        });

        if (ctx.options.dryRun) {
          ctx.output.dryRun("issue.update", { id: targetId, identifier, input });
          return;
        }

        const updated = await session.run("issue.update", "idempotent-write", async (client) => {
          const res = await client.updateIssue(targetId, input as LinearDocument.IssueUpdateInput);
          if (!res.success) throw new CliError("INTERNAL_ERROR", "Linear updateIssue returned success=false.");
          const issue = await res.issue;
          return issue ? mapIssueNode(issue) : { id: targetId, identifier };
        });

        ctx.output.success(updated, {
          human: () => `Updated issue ${identifier}`,
        });
      },
    );

  // 7. Shortcut commands: status, assign, unassign, priority
  issueCmd
    .command("status <issue> <status>")
    .description("Change an issue's workflow status")
    .action(async (issueRef: string, statusRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const { target, state } = await session.run("issue.status.resolve", "read", async (client) => {
        const t = await resolveIssueSummary(client, issueRef);
        if (!t.teamId) throw new CliError("INTERNAL_ERROR", "Issue team could not be resolved.");
        const s = await resolveWorkflowState(client, t.teamId, statusRef);
        return { target: t, state: s };
      });
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.status", { id: target.id, identifier: target.identifier, stateId: state.id, status: state.name });
        return;
      }
      const updated = await session.run("issue.status", "idempotent-write", async (client) => {
        const res = await client.updateIssue(target.id, { stateId: state.id });
        const iss = await res.issue;
        return iss ? mapIssueNode(iss) : { id: target.id, identifier: target.identifier, status: state.name };
      });
      ctx.output.success(updated, {
        human: () => `Moved ${target.identifier} -> ${state.name}`,
      });
    });

  issueCmd
    .command("assign <issue> <user>")
    .description("Assign an issue to a user ('me', email, name, or UUID)")
    .action(async (issueRef: string, userRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const { target, user } = await session.run("issue.assign.resolve", "read", async (client) => ({
        target: await resolveIssueSummary(client, issueRef),
        user: await resolveUser(client, userRef),
      }));
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.assign", { id: target.id, identifier: target.identifier, assigneeId: user.id });
        return;
      }
      const updated = await session.run("issue.assign", "idempotent-write", async (client) => {
        const res = await client.updateIssue(target.id, { assigneeId: user.id });
        const iss = await res.issue;
        return iss ? mapIssueNode(iss) : { id: target.id, identifier: target.identifier, assignee: user.name };
      });
      ctx.output.success(updated, {
        human: () => `Assigned ${target.identifier} to ${user.name}`,
      });
    });

  issueCmd
    .command("unassign <issue>")
    .description("Remove the assignee from an issue")
    .action(async (issueRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const target = await session.run("issue.unassign.resolve", "read", (client) => resolveIssueSummary(client, issueRef));
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.unassign", { id: target.id, identifier: target.identifier, assigneeId: null });
        return;
      }
      const updated = await session.run("issue.unassign", "idempotent-write", async (client) => {
        const res = await client.updateIssue(target.id, { assigneeId: null });
        const iss = await res.issue;
        return iss ? mapIssueNode(iss) : { id: target.id, identifier: target.identifier, assignee: null };
      });
      ctx.output.success(updated, {
        human: () => `Unassigned ${target.identifier}`,
      });
    });

  issueCmd
    .command("priority <issue> <priority>")
    .description("Set issue priority (urgent|high|medium|low|none or 0..4)")
    .action(async (issueRef: string, prioRaw: string) => {
      const ctx = getContext();
      const prio = parsePriority(prioRaw);
      const session = await openVerifiedSession(ctx);
      const target = await session.run("issue.priority.resolve", "read", (client) => resolveIssueSummary(client, issueRef));
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.priority", { id: target.id, identifier: target.identifier, priority: prio });
        return;
      }
      const updated = await session.run("issue.priority", "idempotent-write", async (client) => {
        const res = await client.updateIssue(target.id, { priority: prio });
        const iss = await res.issue;
        return iss ? mapIssueNode(iss) : { id: target.id, identifier: target.identifier, priority: prio };
      });
      ctx.output.success(updated, {
        human: () => `Updated priority on ${target.identifier}`,
      });
    });

  // 8. issue label add | remove
  const issueLabelCmd = issueCmd.command("label").description("Add or remove labels on an issue non-destructively");
  issueLabelCmd
    .command("add <issue> <labels...>")
    .description("Add one or more labels to an issue while keeping existing labels")
    .action(async (issueRef: string, labelRefs: string[]) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const { target, labels } = await session.run("issue.label.add.resolve", "read", async (client) => {
        const t = await resolveIssueSummary(client, issueRef);
        const resolved = await resolveIssueLabels(client, labelRefs, { teamId: t.teamId ?? undefined });
        return { target: t, labels: resolved };
      });
      const addedLabelIds = labels.map((l) => l.id);
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.label.add", { id: target.id, identifier: target.identifier, addedLabelIds });
        return;
      }
      const updated = await session.run("issue.label.add", "idempotent-write", async (client) => {
        const res = await client.updateIssue(target.id, { addedLabelIds });
        const iss = await res.issue;
        return iss ? mapIssueNode(iss) : { id: target.id, identifier: target.identifier, addedLabelIds };
      });
      ctx.output.success(updated, {
        human: () => `Added label(s) [${labels.map((l) => l.name).join(", ")}] to ${target.identifier}`,
      });
    });

  issueLabelCmd
    .command("remove <issue> <labels...>")
    .description("Remove one or more labels from an issue while keeping other labels")
    .action(async (issueRef: string, labelRefs: string[]) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const { target, labels } = await session.run("issue.label.remove.resolve", "read", async (client) => {
        const t = await resolveIssueSummary(client, issueRef);
        const resolved = await resolveIssueLabels(client, labelRefs, { teamId: t.teamId ?? undefined });
        return { target: t, labels: resolved };
      });
      const removedLabelIds = labels.map((l) => l.id);
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.label.remove", { id: target.id, identifier: target.identifier, removedLabelIds });
        return;
      }
      const updated = await session.run("issue.label.remove", "idempotent-write", async (client) => {
        const res = await client.updateIssue(target.id, { removedLabelIds });
        const iss = await res.issue;
        return iss ? mapIssueNode(iss) : { id: target.id, identifier: target.identifier, removedLabelIds };
      });
      ctx.output.success(updated, {
        human: () => `Removed label(s) [${labels.map((l) => l.name).join(", ")}] from ${target.identifier}`,
      });
    });

  // 9. issue project set <issue> <project|none>
  const issueProjCmd = issueCmd.command("project").description("Manage issue project association");
  issueProjCmd
    .command("set <issue> <project>")
    .description("Associate an issue with a project (or pass 'none' to clear)")
    .action(async (issueRef: string, projectRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const { target, projectId, projectName } = await session.run("issue.project.resolve", "read", async (client) => {
        const t = await resolveIssueSummary(client, issueRef);
        if (projectRef.trim().toLowerCase() === "none") {
          return { target: t, projectId: null as string | null, projectName: null as string | null };
        }
        const p = await resolveProject(client, projectRef);
        return { target: t, projectId: p.id, projectName: p.name };
      });
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.project.set", { id: target.id, identifier: target.identifier, projectId });
        return;
      }
      const updated = await session.run("issue.project.set", "idempotent-write", async (client) => {
        const res = await client.updateIssue(target.id, { projectId });
        const iss = await res.issue;
        return iss ? mapIssueNode(iss) : { id: target.id, identifier: target.identifier, projectId };
      });
      ctx.output.success(updated, {
        human: () =>
          projectName ? `Set project '${projectName}' on ${target.identifier}` : `Cleared project on ${target.identifier}`,
      });
    });

  // 10. issue archive | restore | delete | subscribe | unsubscribe | share | unshare
  issueCmd
    .command("archive <issue>")
    .description("Archive an issue")
    .action(async (issueRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const target = await session.run("issue.archive.resolve", "read", (client) => resolveIssueSummary(client, issueRef));
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.archive", { id: target.id, identifier: target.identifier });
        return;
      }
      const res = await session.run("issue.archive", "idempotent-write", (client) => client.archiveIssue(target.id));
      ctx.output.success({ id: target.id, identifier: target.identifier, archived: Boolean(res.success) }, {
        human: () => `Archived ${target.identifier}`,
      });
    });

  issueCmd
    .command("restore <issue>")
    .description("Restore (unarchive) an archived issue")
    .action(async (issueRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const target = await session.run("issue.restore.resolve", "read", (client) => resolveIssueSummary(client, issueRef));
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.restore", { id: target.id, identifier: target.identifier });
        return;
      }
      const res = await session.run("issue.restore", "idempotent-write", (client) => client.unarchiveIssue(target.id));
      ctx.output.success({ id: target.id, identifier: target.identifier, restored: Boolean(res.success) }, {
        human: () => `Restored ${target.identifier}`,
      });
    });

  issueCmd
    .command("delete <issue>")
    .description("Move an issue to trash (requires --yes; recoverable until Linear purges it)")
    .option("--yes", "Confirm moving the issue to trash")
    .action(async (issueRef: string, opts: { yes?: boolean }) => {
      const ctx = getContext();
      ctx.requireDestructiveConfirmation(Boolean(opts.yes), `delete issue '${issueRef}'`);
      const session = await openVerifiedSession(ctx);
      const target = await session.run("issue.delete.resolve", "read", (client) => resolveIssueSummary(client, issueRef));
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.delete", { id: target.id, identifier: target.identifier });
        return;
      }
      const res = await session.run("issue.delete", "idempotent-write", (client) => client.deleteIssue(target.id));
      // Linear moves deleted issues to trash: they remain fetchable (with archivedAt)
      // until Linear purges them, so report trashed semantics rather than "permanently removed".
      ctx.output.success({ id: target.id, identifier: target.identifier, deleted: Boolean(res.success), trashed: Boolean(res.success) }, {
        human: () => `Moved ${target.identifier} to trash (Linear keeps it recoverable until purge)`,
      });
    });

  issueCmd
    .command("subscribe <issue>")
    .description("Subscribe to updates on an issue")
    .option("--user <user>", "Optional user to subscribe (defaults to authenticated user)")
    .action(async (issueRef: string, opts: { user?: string }) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const { target, userId } = await session.run("issue.subscribe.resolve", "read", async (client) => ({
        target: await resolveIssueSummary(client, issueRef),
        userId: opts.user ? (await resolveUser(client, opts.user)).id : undefined,
      }));
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.subscribe", { id: target.id, identifier: target.identifier, userId });
        return;
      }
      const res = await session.run("issue.subscribe", "idempotent-write", (client) =>
        client.issueSubscribe(target.id, userId ? { userId } : undefined),
      );
      ctx.output.success({ id: target.id, identifier: target.identifier, subscribed: Boolean(res.success) }, {
        human: () => `Subscribed to ${target.identifier}`,
      });
    });

  issueCmd
    .command("unsubscribe <issue>")
    .description("Unsubscribe from updates on an issue")
    .option("--user <user>", "Optional user to unsubscribe")
    .action(async (issueRef: string, opts: { user?: string }) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const { target, userId } = await session.run("issue.unsubscribe.resolve", "read", async (client) => ({
        target: await resolveIssueSummary(client, issueRef),
        userId: opts.user ? (await resolveUser(client, opts.user)).id : undefined,
      }));
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.unsubscribe", { id: target.id, identifier: target.identifier, userId });
        return;
      }
      const res = await session.run("issue.unsubscribe", "idempotent-write", (client) =>
        client.issueUnsubscribe(target.id, userId ? { userId } : undefined),
      );
      ctx.output.success({ id: target.id, identifier: target.identifier, unsubscribed: Boolean(res.success) }, {
        human: () => `Unsubscribed from ${target.identifier}`,
      });
    });

  issueCmd
    .command("share <issue> <user>")
    .description("Share an issue with a workspace user")
    .action(async (issueRef: string, userRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const { target, user } = await session.run("issue.share.resolve", "read", async (client) => ({
        target: await resolveIssueSummary(client, issueRef),
        user: await resolveUser(client, userRef),
      }));
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.share", { id: target.id, identifier: target.identifier, userId: user.id });
        return;
      }
      const res = await session.run("issue.share", "idempotent-write", (client) =>
        client.issueShare(target.id, user.id),
      );
      ctx.output.success({ id: target.id, identifier: target.identifier, userId: user.id, shared: Boolean(res.success) }, {
        human: () => `Shared ${target.identifier} with ${user.name}`,
      });
    });

  issueCmd
    .command("unshare <issue> <user>")
    .description("Remove shared access to an issue for a workspace user")
    .action(async (issueRef: string, userRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const { target, user } = await session.run("issue.unshare.resolve", "read", async (client) => ({
        target: await resolveIssueSummary(client, issueRef),
        user: await resolveUser(client, userRef),
      }));
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.unshare", { id: target.id, identifier: target.identifier, userId: user.id });
        return;
      }
      const res = await session.run("issue.unshare", "idempotent-write", (client) =>
        client.issueUnshare(target.id, user.id),
      );
      ctx.output.success({ id: target.id, identifier: target.identifier, userId: user.id, unshared: Boolean(res.success) }, {
        human: () => `Removed shared access on ${target.identifier} for ${user.name}`,
      });
    });

  // 11. Sub-issues & parent
  issueCmd
    .command("children <issue>")
    .description("List direct sub-issues (children) of an issue")
    .option("--limit <n>", "Maximum results per page")
    .option("--cursor <cursor>", "Pagination cursor")
    .action(async (issueRef: string, opts: { limit?: string; cursor?: string }) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const pageVars = resolvePaginationVariables({
        limit: parseIntOpt(opts.limit, "--limit"),
        cursor: opts.cursor,
      });
      const page = await session.run("issue.children", "read", async (client) => {
        const target = await resolveIssueSummary(client, issueRef);
        const iss = await client.issue(target.id);
        const conn = await iss.children(pageVars);
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
        human: () => renderIssueTable(page.items),
      });
    });

  const parentCmd = issueCmd.command("parent").description("Manage parent/sub-issue hierarchy");
  parentCmd
    .command("set <issue> <parent>")
    .description("Set parent issue (or pass 'none' to promote to a top-level issue)")
    .action(async (issueRef: string, parentRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const { target, parent } = await session.run("issue.parent.resolve", "read", async (client) => {
        const t = await resolveIssueSummary(client, issueRef);
        if (parentRef.trim().toLowerCase() === "none") {
          return { target: t, parent: null as { id: string; identifier: string } | null };
        }
        const p = await resolveIssueSummary(client, parentRef);
        return { target: t, parent: p };
      });
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.parent.set", {
          id: target.id,
          identifier: target.identifier,
          parentId: parent?.id ?? null,
        });
        return;
      }
      const updated = await session.run("issue.parent.set", "idempotent-write", async (client) => {
        const res = await client.updateIssue(target.id, { parentId: parent?.id ?? null });
        const iss = await res.issue;
        return iss ? mapIssueNode(iss) : { id: target.id, identifier: target.identifier, parentId: parent?.id ?? null };
      });
      ctx.output.success(updated, {
        human: () =>
          parent
            ? `Set parent of ${target.identifier} -> ${parent.identifier}`
            : `Promoted ${target.identifier} to top-level issue`,
      });
    });

  // 12. Relations: list | add | remove
  const relCmd = issueCmd.command("relation").description("Manage blocking, related, and duplicate issue relations");
  relCmd
    .command("list <issue>")
    .description("List outbound and inbound relations on an issue")
    .action(async (issueRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const items = await session.run("issue.relation.list", "read", async (client) => {
        const target = await resolveIssueSummary(client, issueRef);
        const iss = await client.issue(target.id);
        const [outConn, invConn] = await Promise.all([
          iss.relations({ first: 100 }),
          iss.inverseRelations({ first: 100 }),
        ]);
        const outbound = await Promise.all(
          outConn.nodes.map(async (r) => {
            const relIssue = await Promise.resolve(r.relatedIssue).catch(() => undefined);
            return {
              id: r.id,
              direction: "outbound" as const,
              type: r.type,
              issue: target.identifier,
              relatedIssueId: relIssue?.id ?? null,
              relatedIssue: relIssue?.identifier ?? null,
              relatedTitle: relIssue?.title ?? null,
            };
          }),
        );
        const inbound = await Promise.all(
          invConn.nodes.map(async (r) => {
            const srcIssue = await Promise.resolve(r.issue).catch(() => undefined);
            return {
              id: r.id,
              direction: "inbound" as const,
              type: r.type === "blocks" ? "blocked-by" : r.type,
              issue: target.identifier,
              relatedIssueId: srcIssue?.id ?? null,
              relatedIssue: srcIssue?.identifier ?? null,
              relatedTitle: srcIssue?.title ?? null,
            };
          }),
        );
        return [...outbound, ...inbound];
      });
      ctx.output.success(items, {
        human: () =>
          formatTable(items, [
            { header: "RELATION_ID", value: (r) => r.id },
            { header: "TYPE", value: (r) => r.type },
            { header: "TARGET", value: (r) => r.relatedIssue },
            { header: "TITLE", value: (r) => r.relatedTitle, maxWidth: 45 },
          ]),
      });
    });

  relCmd
    .command("add <issue>")
    .description("Create an issue relation (blocks, blocked-by, related, or duplicate)")
    .requiredOption("--type <type>", "Relation type: blocks | blocked-by | related | duplicate")
    .requiredOption("--target <otherIssue>", "Target issue identifier or UUID")
    .action(async (issueRef: string, opts: { type: string; target: string }) => {
      const ctx = getContext();
      const rawType = opts.type.trim().toLowerCase();
      if (!["blocks", "blocked-by", "related", "duplicate"].includes(rawType)) {
        throw new CliError(
          "VALIDATION_ERROR",
          `Invalid relation --type '${opts.type}': expected blocks|blocked-by|related|duplicate.`,
        );
      }

      const session = await openVerifiedSession(ctx);
      const { source, target } = await session.run("issue.relation.resolve", "read", async (client) => ({
        source: await resolveIssueSummary(client, issueRef),
        target: await resolveIssueSummary(client, opts.target),
      }));

      const relationInput =
        rawType === "blocked-by"
          ? {
              issueId: target.id,
              relatedIssueId: source.id,
              type: LinearDocument.IssueRelationType.Blocks,
            }
          : {
              issueId: source.id,
              relatedIssueId: target.id,
              type:
                rawType === "blocks"
                  ? LinearDocument.IssueRelationType.Blocks
                  : rawType === "duplicate"
                    ? LinearDocument.IssueRelationType.Duplicate
                    : LinearDocument.IssueRelationType.Related,
            };

      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.relation.add", relationInput);
        return;
      }

      const created = await session.run("issue.relation.add", "create", async (client) => {
        const res = await client.createIssueRelation(relationInput);
        if (!res.success) throw new CliError("INTERNAL_ERROR", "createIssueRelation returned success=false.");
        const rel = await res.issueRelation;
        return {
          id: rel?.id ?? null,
          type: rawType,
          issueId: relationInput.issueId,
          relatedIssueId: relationInput.relatedIssueId,
        };
      });

      ctx.output.success(created, {
        human: () => `Created '${rawType}' relation between ${source.identifier} and ${target.identifier}`,
      });
    });

  relCmd
    .command("remove <relationId>")
    .description("Remove an issue relation by relation UUID")
    .action(async (relationId: string) => {
      const ctx = getContext();
      const id = relationId.trim();
      if (!id) throw new CliError("VALIDATION_ERROR", "Relation ID cannot be empty.");
      if (ctx.options.dryRun) {
        ctx.output.dryRun("issue.relation.remove", { id });
        return;
      }
      const session = await openVerifiedSession(ctx);
      const res = await session.run("issue.relation.remove", "idempotent-write", (client) =>
        client.deleteIssueRelation(id),
      );
      ctx.output.success({ id, removed: Boolean(res.success) }, {
        human: () => `Removed issue relation ${id}`,
      });
    });
}
