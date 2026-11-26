import type { LinearClient, LinearDocument } from "@linear/sdk";
import { Command } from "commander";
import { Kind, parse as parseGraphQL } from "graphql";
import type { CliContext } from "../../cli/context.js";
import { openVerifiedSession } from "../../core/client.js";
import { CliError } from "../../core/errors.js";
import { formatKeyValue, formatTable } from "../../core/output.js";
import { resolvePaginationVariables, toPaginatedResult } from "../../core/pagination.js";
import { isUuid } from "../../core/resolvers.js";
import { resolveIssueSummary } from "../issues/filter.js";
import { getOrCreateSubcommand } from "../workspace/commands.js";

function collectRepeatable(val: string, prev: string[]): string[] {
  return [...prev, val];
}

function parseIntOpt(val: string | undefined, flag: string): number | undefined {
  if (val === undefined) return undefined;
  const n = Number(val);
  if (!Number.isInteger(n)) throw new CliError("VALIDATION_ERROR", `Invalid ${flag} '${val}': expected integer.`);
  return n;
}

async function resolvePipeline(client: LinearClient, ref: string): Promise<{ id: string; name: string; slugId: string }> {
  const q = ref.trim();
  if (!q) throw new CliError("VALIDATION_ERROR", "Release pipeline reference cannot be empty.");
  if (isUuid(q)) {
    try {
      const p = await client.releasePipeline(q);
      return { id: p.id, name: p.name, slugId: p.slugId };
    } catch (cause) {
      throw new CliError("NOT_FOUND", `Release pipeline '${q}' not found.`, { cause });
    }
  }
  const conn = await client.releasePipelines({ first: 100 });
  const matches = conn.nodes.filter(
    (p) => p.slugId.toLowerCase() === q.toLowerCase() || p.name.toLowerCase() === q.toLowerCase(),
  );
  if (matches.length === 0) throw new CliError("NOT_FOUND", `Release pipeline '${q}' not found.`);
  if (matches.length > 1) {
    throw new CliError("AMBIGUOUS_RESOURCE", `Release pipeline '${q}' matched ${matches.length} records; pass UUID.`, {
      details: { candidates: matches.map((m) => ({ id: m.id, slugId: m.slugId, name: m.name })) },
    });
  }
  const p = matches[0]!;
  return { id: p.id, name: p.name, slugId: p.slugId };
}

async function resolveReleaseNode(client: LinearClient, ref: string) {
  const q = ref.trim();
  if (!q) throw new CliError("VALIDATION_ERROR", "Release reference cannot be empty.");
  if (isUuid(q)) {
    try {
      return await client.release(q);
    } catch (cause) {
      throw new CliError("NOT_FOUND", `Release '${q}' not found.`, { cause });
    }
  }
  const conn = await client.releases({ first: 100 });
  const matches = conn.nodes.filter(
    (r) =>
      r.id === q ||
      (r as unknown as { slugId?: string }).slugId === q ||
      r.name.toLowerCase() === q.toLowerCase() ||
      (r.version ?? "").toLowerCase() === q.toLowerCase(),
  );
  if (matches.length === 0) throw new CliError("NOT_FOUND", `Release '${q}' not found.`);
  if (matches.length > 1) {
    throw new CliError("AMBIGUOUS_RESOURCE", `Release '${q}' matched ${matches.length} records; pass UUID.`);
  }
  return matches[0]!;
}

function parseGraphQLVariables(ctx: CliContext, inlineVars?: string, varsFile?: string): Record<string, unknown> {
  if (inlineVars !== undefined && varsFile !== undefined) {
    throw new CliError("VALIDATION_ERROR", "Provide either '--variables' or '--variables-file', not both.");
  }
  const raw = varsFile !== undefined ? ctx.readFileUtf8(varsFile, "--variables-file") : inlineVars;
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Variables JSON must be an object.");
    }
    return parsed as Record<string, unknown>;
  } catch (cause) {
    throw new CliError("VALIDATION_ERROR", "Invalid JSON for GraphQL variables: expected a JSON object.", { cause });
  }
}

function validateGraphQLOperations(documentSource: string, expectedOperation: "query" | "mutation"): void {
  let ast;
  try {
    ast = parseGraphQL(documentSource);
  } catch (cause) {
    throw new CliError(
      "VALIDATION_ERROR",
      `Invalid GraphQL syntax: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  const ops = ast.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION);
  if (ops.length === 0) {
    throw new CliError("VALIDATION_ERROR", "GraphQL document must contain at least one operation definition.");
  }
  for (const op of ops) {
    if (op.operation !== expectedOperation) {
      throw new CliError(
        "VALIDATION_ERROR",
        expectedOperation === "query"
          ? `Rejected '${op.operation}' operation in 'linear api query'. Use 'linear api mutation --allow-mutation' for mutations.`
          : `Expected a 'mutation' operation in 'linear api mutation', but found '${op.operation}'.`,
      );
    }
  }
}

export function registerAdvancedCommands(program: Command, getContext: () => CliContext): void {
  // ==================== 1. RELEASES ====================
  const releaseCmd = getOrCreateSubcommand(program, "release", "Manage Linear release pipelines and releases");
  const pipeCmd = releaseCmd.command("pipeline").description("Inspect Linear release pipelines");

  pipeCmd
    .command("list")
    .description("List release pipelines in the workspace")
    .option("--query <query>", "Filter pipeline name")
    .option("--limit <n>", "Maximum results per page")
    .option("--cursor <cursor>", "Pagination cursor")
    .action(async (opts: { query?: string; limit?: string; cursor?: string }) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const pageVars = resolvePaginationVariables({
        limit: parseIntOpt(opts.limit, "--limit"),
        cursor: opts.cursor,
      });
      const page = await session.run("release.pipeline.list", "read", async (client) => {
        const conn = await client.releasePipelines(pageVars);
        const mapped = toPaginatedResult(conn, (p) => ({
          id: p.id,
          slugId: p.slugId,
          name: p.name,
          type: (p as unknown as { type?: string }).type ?? null,
        }));
        const items = opts.query
          ? mapped.items.filter((i) => i.name.toLowerCase().includes(opts.query!.toLowerCase()))
          : mapped.items;
        return { items, pageInfo: { ...mapped.pageInfo, count: items.length } };
      });
      ctx.output.success(page.items, {
        pageInfo: page.pageInfo,
        human: () =>
          formatTable(page.items, [
            { header: "SLUG", value: (r) => r.slugId },
            { header: "TYPE", value: (r) => r.type },
            { header: "NAME", value: (r) => r.name },
            { header: "ID", value: (r) => r.id },
          ]),
      });
    });

  releaseCmd
    .command("list")
    .description("List releases in the workspace")
    .option("--pipeline <pipeline>", "Filter by release pipeline UUID, slug, or name")
    .option("--query <query>", "Filter by release name or version")
    .option("--include-archived", "Include archived releases")
    .option("--limit <n>", "Maximum results per page")
    .option("--cursor <cursor>", "Pagination cursor")
    .action(
      async (opts: {
        pipeline?: string;
        query?: string;
        includeArchived?: boolean;
        limit?: string;
        cursor?: string;
      }) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
          limit: parseIntOpt(opts.limit, "--limit"),
          cursor: opts.cursor,
          includeArchived: opts.includeArchived,
        });
        const page = await session.run("release.list", "read", async (client) => {
          const filter: Record<string, unknown> = {};
          if (opts.pipeline) {
            const p = await resolvePipeline(client, opts.pipeline);
            filter.pipeline = { id: { eq: p.id } };
          }
          const conn = await client.releases({
            ...pageVars,
            ...(Object.keys(filter).length > 0 ? { filter: filter as never } : {}),
          });
          const mapped = toPaginatedResult(conn, (r) => ({
            id: r.id,
            name: r.name,
            version: r.version ?? null,
            startDate: r.startDate ?? null,
            targetDate: r.targetDate ?? null,
            url: (r as unknown as { url?: string }).url ?? null,
          }));
          const items = opts.query
            ? mapped.items.filter(
                (i) =>
                  i.name.toLowerCase().includes(opts.query!.toLowerCase()) ||
                  (i.version ?? "").toLowerCase().includes(opts.query!.toLowerCase()),
              )
            : mapped.items;
          return { items, pageInfo: { ...mapped.pageInfo, count: items.length } };
        });
        ctx.output.success(page.items, {
          pageInfo: page.pageInfo,
          human: () =>
            formatTable(page.items, [
              { header: "NAME", value: (r) => r.name },
              { header: "VERSION", value: (r) => r.version },
              { header: "TARGET_DATE", value: (r) => r.targetDate },
              { header: "ID", value: (r) => r.id },
            ]),
        });
      },
    );

  releaseCmd
    .command("get <release>")
    .description("Retrieve details of a release by UUID, version, or name")
    .action(async (releaseRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const data = await session.run("release.get", "read", async (client) => {
        const r = await resolveReleaseNode(client, releaseRef);
        return {
          id: r.id,
          name: r.name,
          version: r.version ?? null,
          description: r.description ?? null,
          commitSha: r.commitSha ?? null,
          startDate: r.startDate ?? null,
          targetDate: r.targetDate ?? null,
          url: (r as unknown as { url?: string }).url ?? null,
        };
      });
      ctx.output.success(data, {
        human: () =>
          formatKeyValue([
            ["ID", data.id],
            ["Name", data.name],
            ["Version", data.version],
            ["Commit SHA", data.commitSha],
            ["Start Date", data.startDate],
            ["Target Date", data.targetDate],
            ["Description", data.description],
            ["URL", data.url],
          ]),
      });
    });

  releaseCmd
    .command("create")
    .description("Create a release in a pipeline")
    .requiredOption("--pipeline <pipeline>", "Pipeline UUID, slug, or name")
    .requiredOption("--name <name>", "Release name")
    .option("--version <version>", "Version string (e.g. 1.0.0)")
    .option("--stage <stageId>", "Optional stage UUID")
    .option("--description <markdown>", "Release description")
    .option("--description-file <path>", "Read release description from file")
    .option("--start-date <date>", "Planned start date YYYY-MM-DD")
    .option("--target-date <date>", "Planned target date YYYY-MM-DD")
    .option("--commit-sha <sha>", "Associated commit SHA")
    .action(
      async (opts: {
        pipeline: string;
        name: string;
        version?: string;
        stage?: string;
        description?: string;
        descriptionFile?: string;
        startDate?: string;
        targetDate?: string;
        commitSha?: string;
      }) => {
        const ctx = getContext();
        const description = ctx.resolveMarkdownInput({
          inlineValue: opts.description,
          filePath: opts.descriptionFile,
          inlineFlag: "--description",
          fileFlag: "--description-file",
        });
        const session = await openVerifiedSession(ctx);
        const pipe = await session.run("release.create.resolve", "read", (client) => resolvePipeline(client, opts.pipeline));
        const input: LinearDocument.ReleaseCreateInput = {
          pipelineId: pipe.id,
          name: opts.name,
          ...(opts.version ? { version: opts.version } : {}),
          ...(opts.stage ? { stageId: opts.stage } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(opts.startDate ? { startDate: opts.startDate } : {}),
          ...(opts.targetDate ? { targetDate: opts.targetDate } : {}),
          ...(opts.commitSha ? { commitSha: opts.commitSha } : {}),
        };
        if (ctx.options.dryRun) {
          ctx.output.dryRun("release.create", input as unknown as Record<string, unknown>);
          return;
        }
        const created = await session.run("release.create", "create", async (client) => {
          const res = await client.createRelease(input);
          if (!res.success) throw new CliError("INTERNAL_ERROR", "createRelease returned success=false.");
          const r = await res.release;
          return {
            id: r?.id ?? null,
            name: r?.name ?? opts.name,
            version: r?.version ?? opts.version ?? null,
            pipelineId: pipe.id,
          };
        });
        ctx.output.success(created, {
          human: () => `Created release '${created.name}' (${created.id ?? ""})`,
        });
      },
    );

  releaseCmd
    .command("update <release>")
    .description("Update an existing release")
    .option("--name <name>", "New release name")
    .option("--version <version>", "New version string")
    .option("--stage <stageId>", "New stage UUID")
    .option("--description <markdown>", "Replacement description")
    .option("--description-file <path>", "Read replacement description from file")
    .option("--start-date <date>", "Planned start date YYYY-MM-DD (or 'none')")
    .option("--target-date <date>", "Planned target date YYYY-MM-DD (or 'none')")
    .option("--commit-sha <sha>", "Associated commit SHA")
    .action(
      async (
        releaseRef: string,
        opts: {
          name?: string;
          version?: string;
          stage?: string;
          description?: string;
          descriptionFile?: string;
          startDate?: string;
          targetDate?: string;
          commitSha?: string;
        },
      ) => {
        const ctx = getContext();
        const description = ctx.resolveMarkdownInput({
          inlineValue: opts.description,
          filePath: opts.descriptionFile,
          inlineFlag: "--description",
          fileFlag: "--description-file",
        });
        const input: Record<string, unknown> = {};
        if (opts.name !== undefined) input.name = opts.name;
        if (opts.version !== undefined) input.version = opts.version;
        if (opts.stage !== undefined) input.stageId = opts.stage;
        if (description !== undefined) input.description = description;
        if (opts.commitSha !== undefined) input.commitSha = opts.commitSha;
        if (opts.startDate !== undefined) {
          input.startDate = opts.startDate.toLowerCase() === "none" ? null : opts.startDate;
        }
        if (opts.targetDate !== undefined) {
          input.targetDate = opts.targetDate.toLowerCase() === "none" ? null : opts.targetDate;
        }
        if (Object.keys(input).length === 0) {
          throw new CliError("VALIDATION_ERROR", "No update fields specified for 'linear release update'.");
        }

        const session = await openVerifiedSession(ctx);
        const target = await session.run("release.update.resolve", "read", (client) => resolveReleaseNode(client, releaseRef));
        if (ctx.options.dryRun) {
          ctx.output.dryRun("release.update", { id: target.id, input });
          return;
        }
        const updated = await session.run("release.update", "idempotent-write", async (client) => {
          const res = await client.updateRelease(target.id, input as LinearDocument.ReleaseUpdateInput);
          if (!res.success) throw new CliError("INTERNAL_ERROR", "updateRelease returned success=false.");
          const r = await res.release;
          return { id: r?.id ?? target.id, name: r?.name ?? opts.name ?? target.name, version: r?.version ?? target.version };
        });
        ctx.output.success(updated, {
          human: () => `Updated release '${updated.name}'`,
        });
      },
    );

  // ==================== 2. RELEASE NOTES ====================
  const rnCmd = getOrCreateSubcommand(program, "release-note", "List, read, and create Linear release notes");

  rnCmd
    .command("list")
    .description("List release notes in the workspace")
    .option("--pipeline <pipeline>", "Filter by release pipeline")
    .option("--limit <n>", "Maximum results per page")
    .option("--cursor <cursor>", "Pagination cursor")
    .action(async (opts: { pipeline?: string; limit?: string; cursor?: string }) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const pageVars = resolvePaginationVariables({
        limit: parseIntOpt(opts.limit, "--limit"),
        cursor: opts.cursor,
      });
      const page = await session.run("release-note.list", "read", async (client) => {
        const filter: Record<string, unknown> = {};
        if (opts.pipeline) {
          const p = await resolvePipeline(client, opts.pipeline);
          filter.pipeline = { id: { eq: p.id } };
        }
        const conn = await client.releaseNotes({
          ...pageVars,
          ...(Object.keys(filter).length > 0 ? { filter: filter as never } : {}),
        });
        return toPaginatedResult(conn, (n) => ({
          id: n.id,
          title: n.title ?? null,
          updatedAt: new Date(n.updatedAt).toISOString(),
        }));
      });
      ctx.output.success(page.items, {
        pageInfo: page.pageInfo,
        human: () =>
          formatTable(page.items, [
            { header: "ID", value: (r) => r.id },
            { header: "TITLE", value: (r) => r.title },
            { header: "UPDATED_AT", value: (r) => r.updatedAt },
          ]),
      });
    });

  rnCmd
    .command("get <noteId>")
    .description("Retrieve release notes by UUID")
    .action(async (noteId: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const data = await session.run("release-note.get", "read", async (client) => {
        let n;
        try {
          n = await client.releaseNote(noteId.trim());
        } catch (cause) {
          throw new CliError("NOT_FOUND", `Release note '${noteId}' not found.`, { cause });
        }
        return {
          id: n.id,
          slugId: n.slugId,
          title: n.title ?? null,
          content: n.documentContent?.content ?? (n as unknown as { content?: string | null }).content ?? null,
          url: n.url,
          updatedAt: new Date(n.updatedAt).toISOString(),
        };
      });
      ctx.output.success(data, {
        human: () =>
          `${formatKeyValue([
            ["ID", data.id],
            ["Title", data.title],
            ["Updated At", data.updatedAt],
          ])}${data.content ? `\n\n${data.content}` : ""}`,
      });
    });

  rnCmd
    .command("create")
    .description("Create release notes for one or more releases in a pipeline")
    .requiredOption("--pipeline <pipeline>", "Release pipeline UUID, slug, or name")
    .option("--release <release>", "Release UUID, version, or name (repeatable)", collectRepeatable, [])
    .option("--from-release <release>", "Start release for range-based release notes")
    .option("--to-release <release>", "End release for range-based release notes")
    .option("--title <title>", "Optional custom release note title")
    .option("--content <markdown>", "Markdown content")
    .option("--content-file <path>", "Read Markdown content from file")
    .action(
      async (opts: {
        pipeline: string;
        release: string[];
        fromRelease?: string;
        toRelease?: string;
        title?: string;
        content?: string;
        contentFile?: string;
      }) => {
        if (opts.release.length === 0 && (!opts.fromRelease || !opts.toRelease)) {
          throw new CliError(
            "VALIDATION_ERROR",
            "Provide at least one '--release <release>' or both '--from-release' and '--to-release'.",
          );
        }
        const ctx = getContext();
        const content = ctx.resolveMarkdownInput({
          inlineValue: opts.content,
          filePath: opts.contentFile,
          inlineFlag: "--content",
          fileFlag: "--content-file",
        });

        const session = await openVerifiedSession(ctx);
        const input = await session.run("release-note.create.resolve", "read", async (client) => {
          const pipe = await resolvePipeline(client, opts.pipeline);
          const payload: Record<string, unknown> = {
            pipelineId: pipe.id,
            ...(opts.title ? { title: opts.title } : {}),
            ...(content !== undefined ? { content } : {}),
          };
          if (opts.release.length > 0) {
            const releaseIds: string[] = [];
            for (const rRef of opts.release) {
              releaseIds.push((await resolveReleaseNode(client, rRef)).id);
            }
            payload.releaseIds = releaseIds;
          } else {
            payload.rangeFromReleaseId = (await resolveReleaseNode(client, opts.fromRelease!)).id;
            payload.rangeToReleaseId = (await resolveReleaseNode(client, opts.toRelease!)).id;
          }
          return payload;
        });

        if (ctx.options.dryRun) {
          ctx.output.dryRun("release-note.create", input);
          return;
        }
        const created = await session.run("release-note.create", "create", async (client) => {
          const res = await client.createReleaseNote(input as unknown as LinearDocument.ReleaseNoteCreateInput);
          if (!res.success) throw new CliError("INTERNAL_ERROR", "createReleaseNote returned success=false.");
          const rn = await res.releaseNote;
          return {
            id: rn?.id ?? null,
            title: rn?.title ?? opts.title ?? null,
            pipelineId: input.pipelineId,
          };
        });
        ctx.output.success(created, {
          human: () => `Created release note ${created.id ?? ""}`,
        });
      },
    );

  // ==================== 3. REVIEWS / PR DIFFS ====================
  const reviewCmd = getOrCreateSubcommand(
    program,
    "review",
    "Discover and link pull requests / reviews (enforces Linear public GraphQL API boundaries)",
  );

  reviewCmd
    .command("list")
    .description("List pull requests linked to issues in the workspace")
    .option("--issue <issue>", "Filter PR attachments on a specific issue")
    .option("--query <query>", "Filter PR attachments by title or URL")
    .option("--limit <n>", "Maximum results per page (default 50)")
    .action(async (opts: { issue?: string; query?: string; limit?: string }) => {
      const ctx = getContext();
      const limit = parseIntOpt(opts.limit, "--limit") ?? 50;
      const session = await openVerifiedSession(ctx);
      const items = await session.run("review.list", "read", async (client) => {
        let nodes: Array<{ id: string; title: string; subtitle?: string | null; url: string; sourceType?: string | null }> = [];
        if (opts.issue) {
          const target = await resolveIssueSummary(client, opts.issue);
          const iss = await client.issue(target.id);
          const conn = await iss.attachments({ first: limit });
          nodes = conn.nodes;
        } else {
          const conn = await client.attachments({ first: limit });
          nodes = conn.nodes;
        }
        const prLike = nodes.filter(
          (a) =>
            /github\.com\/[^/]+\/[^/]+\/pull\/\d+|gitlab\.com\/.+\/-\/merge_requests\/\d+/i.test(a.url) ||
            (a.sourceType ?? "").toLowerCase().includes("github") ||
            (a.sourceType ?? "").toLowerCase().includes("gitlab"),
        );
        const filtered = opts.query
          ? prLike.filter(
              (a) =>
                a.title.toLowerCase().includes(opts.query!.toLowerCase()) ||
                a.url.toLowerCase().includes(opts.query!.toLowerCase()),
            )
          : prLike;
        return filtered.map((a) => ({
          id: a.id,
          title: a.title,
          subtitle: a.subtitle ?? null,
          url: a.url,
          sourceType: a.sourceType ?? null,
        }));
      });
      ctx.output.success(items, {
        human: () =>
          formatTable(items, [
            { header: "ID", value: (r) => r.id },
            { header: "TITLE", value: (r) => r.title, maxWidth: 42 },
            { header: "URL", value: (r) => r.url, maxWidth: 55 },
          ]),
      });
    });

  reviewCmd
    .command("get <urlOrAttachmentId>")
    .description("Inspect linked Linear issues and metadata for a PR URL or attachment UUID")
    .action(async (urlOrId: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const data = await session.run("review.get", "read", async (client) => {
        const q = urlOrId.trim();
        if (/^https?:\/\//i.test(q)) {
          const conn = await client.attachmentsForURL(q);
          if (conn.nodes.length === 0) {
            throw new CliError("NOT_FOUND", `No linked PR attachment found in Linear for URL '${q}'.`);
          }
          const linked = await Promise.all(
            conn.nodes.map(async (a) => {
              const iss = await Promise.resolve(a.issue).catch(() => undefined);
              return {
                attachmentId: a.id,
                title: a.title,
                subtitle: a.subtitle ?? null,
                url: a.url,
                issue: iss ? { id: iss.id, identifier: iss.identifier, title: iss.title } : null,
              };
            }),
          );
          return { url: q, attachments: linked };
        }
        if (isUuid(q)) {
          try {
            const a = await client.attachment(q);
            const iss = await Promise.resolve(a.issue).catch(() => undefined);
            return {
              url: a.url,
              attachments: [
                {
                  attachmentId: a.id,
                  title: a.title,
                  subtitle: a.subtitle ?? null,
                  url: a.url,
                  issue: iss ? { id: iss.id, identifier: iss.identifier, title: iss.title } : null,
                },
              ],
            };
          } catch (cause) {
            throw new CliError("NOT_FOUND", `PR attachment '${q}' not found.`, { cause });
          }
        }
        throw new CliError(
          "UNSUPPORTED_BY_PUBLIC_API",
          `Linear's public GraphQL API does not expose internal Diff slug '${q}'. Pass a GitHub/GitLab PR URL or attachment UUID.`,
        );
      });
      ctx.output.success(data);
    });

  reviewCmd
    .command("link")
    .description("Link a GitHub Pull Request URL to a Linear issue")
    .requiredOption("--issue <issue>", "Issue identifier or UUID")
    .requiredOption("--url <prUrl>", "GitHub Pull Request URL")
    .option("--title <title>", "Optional attachment title")
    .action(async (opts: { issue: string; url: string; title?: string }) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const target = await session.run("review.link.resolve", "read", (client) => resolveIssueSummary(client, opts.issue));
      if (ctx.options.dryRun) {
        ctx.output.dryRun("review.link", { issueId: target.id, identifier: target.identifier, url: opts.url, title: opts.title });
        return;
      }
      const res = await session.run("review.link", "idempotent-write", async (client) => {
        const payload = await client.attachmentLinkGitHubPR(
          target.id,
          opts.url,
          opts.title ? { title: opts.title } : undefined,
        );
        if (!payload.success) throw new CliError("INTERNAL_ERROR", "attachmentLinkGitHubPR returned success=false.");
        const att = await payload.attachment;
        return {
          id: att?.id ?? null,
          issue: target.identifier,
          url: opts.url,
        };
      });
      ctx.output.success(res, {
        human: () => `Linked PR ${opts.url} to ${target.identifier}`,
      });
    });

  for (const unsupportedSub of [
    { name: "comment <review>", desc: "Submit a diff review comment", needsYes: false },
    { name: "approve <review>", desc: "Approve a diff review", needsYes: false },
    { name: "request-changes <review>", desc: "Request changes on a diff review", needsYes: false },
    { name: "merge <review>", desc: "Merge a diff or enqueue in merge queue", needsYes: true },
  ] as const) {
    const sub = reviewCmd.command(unsupportedSub.name).description(unsupportedSub.desc);
    if (unsupportedSub.name.startsWith("comment")) {
      sub.option("--body <markdown>", "Review comment Markdown").option("--body-file <path>", "Comment Markdown file");
    }
    if (unsupportedSub.needsYes) {
      sub.option("--yes", "Confirm merge action").option("--method <method>", "MERGE | REBASE | SQUASH");
    }
    sub.action(async (reviewRef: string, opts: { yes?: boolean }) => {
      const ctx = getContext();
      const actionName = unsupportedSub.name.split(" ")[0]!;
      if (unsupportedSub.needsYes) {
        ctx.requireDestructiveConfirmation(Boolean(opts.yes), `merge review '${reviewRef}'`);
      }
      await openVerifiedSession(ctx);
      throw new CliError(
        "UNSUPPORTED_BY_PUBLIC_API",
        `Linear's public GraphQL API (@linear/sdk) does not expose internal Diffs '${actionName}' mutations. Use 'gh pr review'/'gh pr merge' for GitHub PRs or Linear's hosted MCP worker.`,
        { details: { operation: `review.${actionName}`, target: reviewRef } },
      );
    });
  }

  // ==================== 4. RAW GRAPHQL API (AST-GUARDED) ====================
  const apiCmd = getOrCreateSubcommand(
    program,
    "api",
    "Execute AST-guarded raw GraphQL queries or mutations against Linear",
  );

  apiCmd
    .command("query")
    .description("Execute a read-only GraphQL query (rejects mutations via AST check)")
    .option("--query <graphql>", "Inline GraphQL query string")
    .option("--file <path>", "Path to .graphql query file")
    .option("--variables <json>", "JSON object of GraphQL variables")
    .option("--variables-file <path>", "Path to JSON variables file")
    .action(async (opts: { query?: string; file?: string; variables?: string; variablesFile?: string }) => {
      const ctx = getContext();
      const doc = ctx.resolveMarkdownInput({
        inlineValue: opts.query,
        filePath: opts.file,
        inlineFlag: "--query",
        fileFlag: "--file",
      });
      if (!doc || !doc.trim()) {
        throw new CliError("VALIDATION_ERROR", "Provide a GraphQL query via '--query <gql>' or '--file <path>'.");
      }
      validateGraphQLOperations(doc, "query");
      const variables = parseGraphQLVariables(ctx, opts.variables, opts.variablesFile);

      const session = await openVerifiedSession(ctx);
      const result = await session.run("api.query", "read", async (client) => {
        const res = await client.client.rawRequest(doc, variables);
        return res.data;
      });
      ctx.output.success(result);
    });

  apiCmd
    .command("mutation")
    .description("Execute a GraphQL mutation (requires --allow-mutation)")
    .option("--query <graphql>", "Inline GraphQL mutation string")
    .option("--file <path>", "Path to .graphql mutation file")
    .option("--variables <json>", "JSON object of GraphQL variables")
    .option("--variables-file <path>", "Path to JSON variables file")
    .option("--allow-mutation", "Explicitly authorize raw GraphQL mutation execution")
    .action(
      async (opts: {
        query?: string;
        file?: string;
        variables?: string;
        variablesFile?: string;
        allowMutation?: boolean;
      }) => {
        const ctx = getContext();
        const doc = ctx.resolveMarkdownInput({
          inlineValue: opts.query,
          filePath: opts.file,
          inlineFlag: "--query",
          fileFlag: "--file",
        });
        if (!doc || !doc.trim()) {
          throw new CliError("VALIDATION_ERROR", "Provide a GraphQL mutation via '--query <gql>' or '--file <path>'.");
        }
        validateGraphQLOperations(doc, "mutation");
        const variables = parseGraphQLVariables(ctx, opts.variables, opts.variablesFile);

        if (!opts.allowMutation && !ctx.options.dryRun) {
          throw new CliError(
            "FORBIDDEN",
            "Raw GraphQL mutations require '--allow-mutation' (or '--dry-run' to preview).",
          );
        }

        const session = await openVerifiedSession(ctx);
        if (ctx.options.dryRun) {
          ctx.output.dryRun("api.mutation", { query: doc.trim(), variables });
          return;
        }
        const result = await session.run("api.mutation", "create", async (client) => {
          const res = await client.client.rawRequest(doc, variables);
          return res.data;
        });
        ctx.output.success(result);
      },
    );
}
