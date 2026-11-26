import fs from "node:fs";
import path from "node:path";
import type { LinearClient, LinearDocument } from "@linear/sdk";
import { Command } from "commander";
import type { CliContext } from "../../cli/context.js";
import { openVerifiedSession } from "../../core/client.js";
import { CliError } from "../../core/errors.js";
import { formatKeyValue, formatTable } from "../../core/output.js";
import { resolvePaginationVariables, toPaginatedResult } from "../../core/pagination.js";
import { isUuid, resolveProject } from "../../core/resolvers.js";
import { resolveIssueSummary } from "../issues/filter.js";
import { getOrCreateSubcommand } from "../workspace/commands.js";

function parseIntOpt(val: string | undefined, flag: string): number | undefined {
  if (val === undefined) return undefined;
  const n = Number(val);
  if (!Number.isInteger(n)) throw new CliError("VALIDATION_ERROR", `Invalid ${flag} '${val}': expected integer.`);
  return n;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".json": "application/json",
  ".csv": "text/csv",
  ".zip": "application/zip",
};

function inferMimeType(filePath: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

async function resolveDocumentByIdOrSlug(
  client: LinearClient,
  docRef: string,
  includeArchived = false,
): Promise<{ id: string; title: string; slugId: string; url: string; content: string | null }> {
  const q = docRef.trim();
  if (!q) throw new CliError("VALIDATION_ERROR", "Document reference cannot be empty.");
  if (isUuid(q)) {
    try {
      const d = await client.document(q);
      return {
        id: d.id,
        title: d.title,
        slugId: d.slugId,
        url: d.url,
        content: d.content ?? null,
      };
    } catch (cause) {
      throw new CliError("NOT_FOUND", `Document '${q}' not found.`, { cause });
    }
  }
  const conn = await client.documents({
    first: 100,
    includeArchived,
    filter: {
      or: [{ slugId: { eq: q } }, { title: { eqIgnoreCase: q } }],
    } as Parameters<typeof client.documents>[0] extends { filter?: infer F } ? F : never,
  });
  const matches = conn.nodes.filter(
    (d) => d.slugId === q || d.title.toLowerCase() === q.toLowerCase(),
  );
  if (matches.length === 0) throw new CliError("NOT_FOUND", `Document '${q}' not found.`);
  if (matches.length > 1) {
    throw new CliError("AMBIGUOUS_RESOURCE", `Document '${q}' matched ${matches.length} records; pass UUID or slugId.`, {
      details: { candidates: matches.map((m) => ({ id: m.id, slugId: m.slugId, title: m.title })) },
    });
  }
  const d = matches[0]!;
  return {
    id: d.id,
    title: d.title,
    slugId: d.slugId,
    url: d.url,
    content: d.content ?? null,
  };
}

export function registerCollaborationCommands(program: Command, getContext: () => CliContext): void {
  // ==================== 1. COMMENTS ====================
  const commentCmd = getOrCreateSubcommand(program, "comment", "List, add, reply to, edit, and delete Linear comments");

  commentCmd
    .command("list")
    .description("List discussion comments on an issue or project")
    .option("--issue <issue>", "Issue identifier (e.g. NIN-11) or UUID")
    .option("--project <project>", "Project name, slugId, P-identifier, or UUID")
    .option("--limit <n>", "Maximum results per page (1..250, default 50)")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--sort <field>", "Sort order: created or updated")
    .action(
      async (opts: {
        issue?: string;
        project?: string;
        limit?: string;
        cursor?: string;
        sort?: "created" | "updated";
      }) => {
        if ((opts.issue ? 1 : 0) + (opts.project ? 1 : 0) !== 1) {
          throw new CliError("VALIDATION_ERROR", "Provide exactly one of '--issue <issue>' or '--project <project>'.");
        }
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
          limit: parseIntOpt(opts.limit, "--limit"),
          cursor: opts.cursor,
          sort: opts.sort,
        });

        const page = await session.run("comment.list", "read", async (client) => {
          let conn;
          if (opts.issue) {
            const target = await resolveIssueSummary(client, opts.issue);
            const iss = await client.issue(target.id);
            conn = await iss.comments(pageVars);
          } else {
            const proj = await resolveProject(client, opts.project!);
            conn = await client.comments({
              ...pageVars,
              filter: { project: { id: { eq: proj.id } } } as never,
            });
          }
          const items = await Promise.all(
            conn.nodes.map(async (c) => {
              const [user, parent] = await Promise.all([
                Promise.resolve(c.user).catch(() => undefined),
                Promise.resolve(c.parent).catch(() => undefined),
              ]);
              return {
                id: c.id,
                author: user?.name ?? null,
                authorId: user?.id ?? null,
                parentId: parent?.id ?? null,
                body: c.body,
                url: c.url,
                createdAt: new Date(c.createdAt).toISOString(),
                updatedAt: new Date(c.updatedAt).toISOString(),
              };
            }),
          );
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
          human: () =>
            formatTable(page.items, [
              { header: "ID", value: (r) => r.id },
              { header: "AUTHOR", value: (r) => r.author },
              { header: "PARENT", value: (r) => r.parentId },
              { header: "BODY", value: (r) => r.body, maxWidth: 55 },
            ]),
        });
      },
    );

  commentCmd
    .command("add")
    .description("Add a top-level comment to an issue or project")
    .option("--issue <issue>", "Issue identifier or UUID")
    .option("--project <project>", "Project name, slugId, P-identifier, or UUID")
    .option("--body <markdown>", "Comment Markdown body")
    .option("--body-file <path>", "Read comment Markdown body from file")
    .action(async (opts: { issue?: string; project?: string; body?: string; bodyFile?: string }) => {
      if ((opts.issue ? 1 : 0) + (opts.project ? 1 : 0) !== 1) {
        throw new CliError("VALIDATION_ERROR", "Provide exactly one of '--issue <issue>' or '--project <project>'.");
      }
      const ctx = getContext();
      const body = ctx.resolveMarkdownInput({
        inlineValue: opts.body,
        filePath: opts.bodyFile,
        inlineFlag: "--body",
        fileFlag: "--body-file",
      });
      if (!body || !body.trim()) {
        throw new CliError("VALIDATION_ERROR", "Comment body is required via '--body' or '--body-file'.");
      }

      const session = await openVerifiedSession(ctx);
      const input = await session.run("comment.add.resolve", "read", async (client) => {
        if (opts.issue) {
          const iss = await resolveIssueSummary(client, opts.issue);
          return { issueId: iss.id, body } as LinearDocument.CommentCreateInput;
        }
        const proj = await resolveProject(client, opts.project!);
        return { projectId: proj.id, body } as LinearDocument.CommentCreateInput;
      });

      if (ctx.options.dryRun) {
        ctx.output.dryRun("comment.add", input as Record<string, unknown>);
        return;
      }

      const created = await session.run("comment.add", "create", async (client) => {
        const res = await client.createComment(input);
        if (!res.success) throw new CliError("INTERNAL_ERROR", "createComment returned success=false.");
        const c = await res.comment;
        if (!c) throw new CliError("INTERNAL_ERROR", "createComment returned no comment.");
        return {
          id: c.id,
          body: c.body,
          url: c.url,
          createdAt: new Date(c.createdAt).toISOString(),
        };
      });
      ctx.output.success(created, {
        human: () => `Added comment ${created.id}\nURL: ${created.url}`,
      });
    });

  commentCmd
    .command("reply <commentId>")
    .description("Reply to an existing comment thread (resolves root parentId automatically)")
    .option("--body <markdown>", "Reply Markdown body")
    .option("--body-file <path>", "Read reply Markdown body from file")
    .action(async (commentId: string, opts: { body?: string; bodyFile?: string }) => {
      const ctx = getContext();
      const body = ctx.resolveMarkdownInput({
        inlineValue: opts.body,
        filePath: opts.bodyFile,
        inlineFlag: "--body",
        fileFlag: "--body-file",
      });
      if (!body || !body.trim()) {
        throw new CliError("VALIDATION_ERROR", "Reply body is required via '--body' or '--body-file'.");
      }
      const session = await openVerifiedSession(ctx);
      const input = await session.run("comment.reply.resolve", "read", async (client) => {
        let target;
        try {
          target = await client.comment({ id: commentId.trim() });
        } catch (cause) {
          throw new CliError("NOT_FOUND", `Comment '${commentId}' not found.`, { cause });
        }
        const [parent, issue, project] = await Promise.all([
          Promise.resolve(target.parent).catch(() => undefined),
          Promise.resolve(target.issue).catch(() => undefined),
          Promise.resolve((target as unknown as { project?: Promise<{ id: string } | undefined> }).project).catch(() => undefined),
        ]);
        const rootParentId = parent?.id ?? target.id;
        return {
          parentId: rootParentId,
          body,
          ...(issue?.id ? { issueId: issue.id } : {}),
          ...(!issue?.id && project?.id ? { projectId: project.id } : {}),
        } as LinearDocument.CommentCreateInput;
      });

      if (ctx.options.dryRun) {
        ctx.output.dryRun("comment.reply", input as Record<string, unknown>);
        return;
      }

      const created = await session.run("comment.reply", "create", async (client) => {
        const res = await client.createComment(input);
        if (!res.success) throw new CliError("INTERNAL_ERROR", "createComment reply returned success=false.");
        const c = await res.comment;
        return {
          id: c?.id ?? null,
          parentId: input.parentId,
          body: c?.body ?? body,
          url: c?.url ?? null,
        };
      });
      ctx.output.success(created, {
        human: () => `Replied with comment ${created.id ?? ""} on thread ${created.parentId}`,
      });
    });

  commentCmd
    .command("update <commentId>")
    .description("Update an existing comment's Markdown body")
    .option("--body <markdown>", "Replacement Markdown body")
    .option("--body-file <path>", "Read replacement Markdown body from file")
    .action(async (commentId: string, opts: { body?: string; bodyFile?: string }) => {
      const ctx = getContext();
      const body = ctx.resolveMarkdownInput({
        inlineValue: opts.body,
        filePath: opts.bodyFile,
        inlineFlag: "--body",
        fileFlag: "--body-file",
      });
      if (!body || !body.trim()) {
        throw new CliError("VALIDATION_ERROR", "Replacement body is required via '--body' or '--body-file'.");
      }
      const id = commentId.trim();
      if (ctx.options.dryRun) {
        ctx.output.dryRun("comment.update", { id, body });
        return;
      }
      const session = await openVerifiedSession(ctx);
      const updated = await session.run("comment.update", "idempotent-write", async (client) => {
        const res = await client.updateComment(id, { body });
        if (!res.success) throw new CliError("INTERNAL_ERROR", "updateComment returned success=false.");
        const c = await res.comment;
        return { id: c?.id ?? id, body: c?.body ?? body, url: c?.url ?? null };
      });
      ctx.output.success(updated, {
        human: () => `Updated comment ${updated.id}`,
      });
    });

  commentCmd
    .command("delete <commentId>")
    .description("Delete a comment (requires --yes)")
    .option("--yes", "Confirm comment deletion")
    .action(async (commentId: string, opts: { yes?: boolean }) => {
      const ctx = getContext();
      const id = commentId.trim();
      ctx.requireDestructiveConfirmation(Boolean(opts.yes), `delete comment '${id}'`);
      if (ctx.options.dryRun) {
        ctx.output.dryRun("comment.delete", { id });
        return;
      }
      const session = await openVerifiedSession(ctx);
      const res = await session.run("comment.delete", "idempotent-write", (client) => client.deleteComment(id));
      ctx.output.success({ id, deleted: Boolean(res.success) }, {
        human: () => `Deleted comment ${id}`,
      });
    });

  // ==================== 2. DOCUMENTS ====================
  const docCmd = getOrCreateSubcommand(program, "document", "List, read, create, update, and archive Linear documents");

  docCmd
    .command("list")
    .description("List or search Linear documents")
    .option("--query <query>", "Full-text search across document titles and content")
    .option("--project <project>", "Filter documents linked to this project")
    .option("--issue <issue>", "Filter documents linked to this issue")
    .option("--include-archived", "Include archived/trashed documents")
    .option("--limit <n>", "Maximum results per page (1..250, default 50)")
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--sort <field>", "Sort order: created or updated")
    .action(
      async (opts: {
        query?: string;
        project?: string;
        issue?: string;
        includeArchived?: boolean;
        limit?: string;
        cursor?: string;
        sort?: "created" | "updated";
      }) => {
        const ctx = getContext();
        const session = await openVerifiedSession(ctx);
        const pageVars = resolvePaginationVariables({
          limit: parseIntOpt(opts.limit, "--limit"),
          cursor: opts.cursor,
          sort: opts.sort,
          includeArchived: opts.includeArchived,
        });

        const page = await session.run("document.list", "read", async (client) => {
          if (opts.query && !opts.project && !opts.issue) {
            const sConn = await client.searchDocuments(opts.query, {
              first: pageVars.first,
              ...(pageVars.after ? { after: pageVars.after } : {}),
              ...(pageVars.includeArchived !== undefined ? { includeArchived: pageVars.includeArchived } : {}),
            });
            return toPaginatedResult(sConn, (d) => ({
              id: d.id,
              title: d.title,
              slugId: d.slugId,
              url: d.url,
              updatedAt: new Date(d.updatedAt).toISOString(),
            }));
          }

          const andClauses: Array<Record<string, unknown>> = [];
          if (opts.query) {
            andClauses.push({ title: { containsIgnoreCase: opts.query } });
          }
          if (opts.project) {
            const p = await resolveProject(client, opts.project);
            andClauses.push({ project: { id: { eq: p.id } } });
          }
          if (opts.issue) {
            const iss = await resolveIssueSummary(client, opts.issue);
            andClauses.push({ issue: { id: { eq: iss.id } } });
          }
          const filter =
            andClauses.length === 0 ? undefined : andClauses.length === 1 ? andClauses[0] : { and: andClauses };
          const conn = await client.documents({
            ...pageVars,
            ...(filter ? { filter } : {}),
          } as Parameters<typeof client.documents>[0]);
          return toPaginatedResult(conn, (d) => ({
            id: d.id,
            title: d.title,
            slugId: d.slugId,
            url: d.url,
            updatedAt: new Date(d.updatedAt).toISOString(),
          }));
        });

        ctx.output.success(page.items, {
          pageInfo: page.pageInfo,
          human: () =>
            formatTable(page.items, [
              { header: "SLUG", value: (r) => r.slugId },
              { header: "TITLE", value: (r) => r.title, maxWidth: 50 },
              { header: "ID", value: (r) => r.id },
            ]),
        });
      },
    );

  docCmd
    .command("get <document>")
    .description("Retrieve a Linear document by UUID, slugId, or exact title")
    .action(async (docRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const doc = await session.run("document.get", "read", (client) => resolveDocumentByIdOrSlug(client, docRef, true));
      ctx.output.success(doc, {
        human: () =>
          `${formatKeyValue([
            ["ID", doc.id],
            ["Slug", doc.slugId],
            ["Title", doc.title],
            ["URL", doc.url],
          ])}${doc.content ? `\n\nContent:\n${doc.content}` : ""}`,
      });
    });

  docCmd
    .command("create")
    .description("Create a Linear Markdown document")
    .requiredOption("--title <title>", "Document title")
    .option("--content <markdown>", "Document Markdown content")
    .option("--content-file <path>", "Read document Markdown content from file")
    .option("--project <project>", "Associate document with a project")
    .option("--issue <issue>", "Associate document with an issue")
    .option("--icon <icon>", "Document icon")
    .option("--color <hex>", "Document icon hex color")
    .action(
      async (opts: {
        title: string;
        content?: string;
        contentFile?: string;
        project?: string;
        issue?: string;
        icon?: string;
        color?: string;
      }) => {
        if (opts.project && opts.issue) {
          throw new CliError("VALIDATION_ERROR", "A document can belong to '--project' or '--issue', not both.");
        }
        const ctx = getContext();
        const content = ctx.resolveMarkdownInput({
          inlineValue: opts.content,
          filePath: opts.contentFile,
          inlineFlag: "--content",
          fileFlag: "--content-file",
        });

        const session = await openVerifiedSession(ctx);
        const input = await session.run("document.create.resolve", "read", async (client) => {
          const payload: Record<string, unknown> = {
            title: opts.title,
            ...(content !== undefined ? { content } : {}),
            ...(opts.icon ? { icon: opts.icon } : {}),
            ...(opts.color ? { color: opts.color } : {}),
          };
          if (opts.project) {
            payload.projectId = (await resolveProject(client, opts.project)).id;
          }
          if (opts.issue) {
            payload.issueId = (await resolveIssueSummary(client, opts.issue)).id;
          }
          return payload;
        });

        if (ctx.options.dryRun) {
          ctx.output.dryRun("document.create", input);
          return;
        }

        const created = await session.run("document.create", "create", async (client) => {
          const res = await client.createDocument(input as unknown as LinearDocument.DocumentCreateInput);
          if (!res.success) throw new CliError("INTERNAL_ERROR", "createDocument returned success=false.");
          const d = await res.document;
          if (!d) throw new CliError("INTERNAL_ERROR", "createDocument returned no document.");
          return { id: d.id, slugId: d.slugId, title: d.title, url: d.url };
        });
        ctx.output.success(created, {
          human: () => `Created document '${created.title}' (${created.slugId})\nURL: ${created.url}`,
        });
      },
    );

  docCmd
    .command("update <document>")
    .description("Update a Linear document's title, content, or container")
    .option("--title <title>", "New document title")
    .option("--content <markdown>", "Replacement Markdown content")
    .option("--content-file <path>", "Read replacement Markdown content from file")
    .option("--project <project>", "Move document to a project")
    .option("--issue <issue>", "Move document to an issue")
    .action(
      async (
        docRef: string,
        opts: { title?: string; content?: string; contentFile?: string; project?: string; issue?: string },
      ) => {
        const ctx = getContext();
        const content = ctx.resolveMarkdownInput({
          inlineValue: opts.content,
          filePath: opts.contentFile,
          inlineFlag: "--content",
          fileFlag: "--content-file",
        });
        const session = await openVerifiedSession(ctx);
        const { target, input } = await session.run("document.update.resolve", "read", async (client) => {
          const t = await resolveDocumentByIdOrSlug(client, docRef);
          const payload: Record<string, unknown> = {};
          if (opts.title !== undefined) payload.title = opts.title;
          if (content !== undefined) payload.content = content;
          if (opts.project) payload.projectId = (await resolveProject(client, opts.project)).id;
          if (opts.issue) payload.issueId = (await resolveIssueSummary(client, opts.issue)).id;
          if (Object.keys(payload).length === 0) {
            throw new CliError("VALIDATION_ERROR", "No update fields specified for 'linear document update'.");
          }
          return { target: t, input: payload };
        });

        if (ctx.options.dryRun) {
          ctx.output.dryRun("document.update", { id: target.id, input });
          return;
        }

        const updated = await session.run("document.update", "idempotent-write", async (client) => {
          const res = await client.updateDocument(target.id, input as LinearDocument.DocumentUpdateInput);
          if (!res.success) throw new CliError("INTERNAL_ERROR", "updateDocument returned success=false.");
          const d = await res.document;
          return { id: d?.id ?? target.id, slugId: d?.slugId ?? target.slugId, title: d?.title ?? target.title, url: d?.url ?? target.url };
        });
        ctx.output.success(updated, {
          human: () => `Updated document ${updated.slugId}`,
        });
      },
    );

  docCmd
    .command("archive <document>")
    .description("Archive (trash) a Linear document")
    .action(async (docRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const target = await session.run("document.archive.resolve", "read", (client) => resolveDocumentByIdOrSlug(client, docRef));
      if (ctx.options.dryRun) {
        ctx.output.dryRun("document.archive", { id: target.id, slugId: target.slugId });
        return;
      }
      const res = await session.run("document.archive", "idempotent-write", (client) => client.deleteDocument(target.id));
      ctx.output.success({ id: target.id, slugId: target.slugId, archived: Boolean(res.success) }, {
        human: () => `Archived document ${target.slugId}`,
      });
    });

  docCmd
    .command("restore <document>")
    .description("Restore an archived Linear document")
    .action(async (docRef: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const target = await session.run("document.restore.resolve", "read", (client) =>
        resolveDocumentByIdOrSlug(client, docRef, true),
      );
      if (ctx.options.dryRun) {
        ctx.output.dryRun("document.restore", { id: target.id, slugId: target.slugId });
        return;
      }
      const res = await session.run("document.restore", "idempotent-write", (client) => client.unarchiveDocument(target.id));
      ctx.output.success({ id: target.id, slugId: target.slugId, restored: Boolean(res.success) }, {
        human: () => `Restored document ${target.slugId}`,
      });
    });

  // ==================== 3. ATTACHMENTS ====================
  const attCmd = getOrCreateSubcommand(program, "attachment", "List, upload, link, download, and remove issue attachments");

  attCmd
    .command("list")
    .description("List attachments linked to an issue")
    .requiredOption("--issue <issue>", "Issue identifier or UUID")
    .action(async (opts: { issue: string }) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const items = await session.run("attachment.list", "read", async (client) => {
        const target = await resolveIssueSummary(client, opts.issue);
        const iss = await client.issue(target.id);
        const conn = await iss.attachments({ first: 100 });
        return conn.nodes.map((a) => ({
          id: a.id,
          title: a.title,
          subtitle: a.subtitle ?? null,
          url: a.url,
          createdAt: new Date(a.createdAt).toISOString(),
        }));
      });
      ctx.output.success(items, {
        human: () =>
          formatTable(items, [
            { header: "ID", value: (r) => r.id },
            { header: "TITLE", value: (r) => r.title },
            { header: "URL", value: (r) => r.url, maxWidth: 55 },
          ]),
      });
    });

  attCmd
    .command("get <attachmentId>")
    .description("Inspect attachment metadata by attachment UUID")
    .action(async (attachmentId: string) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      const data = await session.run("attachment.get", "read", async (client) => {
        let att;
        try {
          att = await client.attachment(attachmentId.trim());
        } catch (cause) {
          throw new CliError("NOT_FOUND", `Attachment '${attachmentId}' not found.`, { cause });
        }
        const issue = await Promise.resolve(att.issue).catch(() => undefined);
        return {
          id: att.id,
          title: att.title,
          subtitle: att.subtitle ?? null,
          url: att.url,
          metadata: att.metadata ?? null,
          issue: issue ? { id: issue.id, identifier: issue.identifier, title: issue.title } : null,
        };
      });
      ctx.output.success(data, {
        human: () =>
          formatKeyValue([
            ["ID", data.id],
            ["Title", data.title],
            ["Subtitle", data.subtitle],
            ["Issue", data.issue?.identifier ?? null],
            ["URL", data.url],
          ]),
      });
    });

  attCmd
    .command("upload")
    .description("Upload a local file to Linear private storage and attach it to an issue")
    .requiredOption("--issue <issue>", "Issue identifier or UUID")
    .requiredOption("--file <path>", "Path to local file to upload")
    .option("--title <title>", "Attachment title (defaults to filename)")
    .option("--subtitle <subtitle>", "Optional attachment subtitle")
    .option("--content-type <mime>", "Explicit MIME type override")
    .action(
      async (opts: { issue: string; file: string; title?: string; subtitle?: string; contentType?: string }) => {
        const ctx = getContext();
        let fileBuf: Buffer;
        try {
          fileBuf = fs.readFileSync(opts.file);
        } catch (cause) {
          throw new CliError("VALIDATION_ERROR", `Unable to read upload file '${opts.file}'.`, { cause });
        }
        if (fileBuf.byteLength === 0) {
          throw new CliError("VALIDATION_ERROR", `Upload file '${opts.file}' is empty (Linear requires size > 0).`);
        }
        const filename = path.basename(opts.file);
        const contentType = inferMimeType(opts.file, opts.contentType);
        const title = opts.title ?? filename;

        const session = await openVerifiedSession(ctx);
        const targetIssue = await session.run("attachment.upload.resolve", "read", (client) =>
          resolveIssueSummary(client, opts.issue),
        );

        if (ctx.options.dryRun) {
          ctx.output.dryRun("attachment.upload", {
            issueId: targetIssue.id,
            identifier: targetIssue.identifier,
            filename,
            contentType,
            size: fileBuf.byteLength,
            title,
          });
          return;
        }

        const created = await session.run("attachment.upload", "create", async (client) => {
          const uploadPayload = await client.fileUpload(contentType, filename, fileBuf.byteLength);
          if (!uploadPayload.success || !uploadPayload.uploadFile) {
            throw new CliError("INTERNAL_ERROR", "Linear fileUpload did not return a signed uploadFile destination.");
          }
          const uploadFile = uploadPayload.uploadFile;
          const headers: Record<string, string> = {
            "Content-Type": uploadFile.contentType || contentType,
          };
          for (const h of uploadFile.headers ?? []) {
            headers[h.key] = h.value;
          }
          const putRes = await ctx.fetchImpl(uploadFile.uploadUrl, {
            method: "PUT",
            headers,
            body: new Uint8Array(fileBuf),
          });
          if (!putRes.ok) {
            throw new CliError(
              "NETWORK_ERROR",
              `Signed storage PUT failed with HTTP ${putRes.status} for '${filename}'.`,
            );
          }

          const attRes = await client.createAttachment({
            issueId: targetIssue.id,
            url: uploadFile.assetUrl,
            title,
            ...(opts.subtitle ? { subtitle: opts.subtitle } : {}),
          });
          if (!attRes.success) {
            throw new CliError("INTERNAL_ERROR", "createAttachment returned success=false after upload.");
          }
          const att = await attRes.attachment;
          return {
            id: att?.id ?? null,
            issue: targetIssue.identifier,
            title,
            assetUrl: uploadFile.assetUrl,
          };
        });

        ctx.output.success(created, {
          human: () => `Uploaded '${filename}' and attached to ${targetIssue.identifier} (${created.id ?? "ok"})`,
        });
      },
    );

  attCmd
    .command("link")
    .description("Link an external URL to an issue as an attachment (idempotent per issue + URL)")
    .requiredOption("--issue <issue>", "Issue identifier or UUID")
    .requiredOption("--url <url>", "External resource URL")
    .requiredOption("--title <title>", "Attachment title")
    .option("--subtitle <subtitle>", "Attachment subtitle")
    .action(async (opts: { issue: string; url: string; title: string; subtitle?: string }) => {
      const ctx = getContext();
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(opts.url);
      } catch (cause) {
        throw new CliError("VALIDATION_ERROR", `Invalid --url '${opts.url}'.`, { cause });
      }
      const session = await openVerifiedSession(ctx);
      const targetIssue = await session.run("attachment.link.resolve", "read", (client) =>
        resolveIssueSummary(client, opts.issue),
      );
      const input: LinearDocument.AttachmentCreateInput = {
        issueId: targetIssue.id,
        url: parsedUrl.toString(),
        title: opts.title,
        ...(opts.subtitle ? { subtitle: opts.subtitle } : {}),
      };
      if (ctx.options.dryRun) {
        ctx.output.dryRun("attachment.link", input as unknown as Record<string, unknown>);
        return;
      }
      const res = await session.run("attachment.link", "idempotent-write", async (client) => {
        const payload = await client.createAttachment(input);
        if (!payload.success) throw new CliError("INTERNAL_ERROR", "createAttachment returned success=false.");
        const att = await payload.attachment;
        return {
          id: att?.id ?? null,
          issue: targetIssue.identifier,
          title: opts.title,
          url: parsedUrl.toString(),
        };
      });
      ctx.output.success(res, {
        human: () => `Linked '${res.title}' (${res.url}) to ${targetIssue.identifier}`,
      });
    });

  attCmd
    .command("download <attachmentOrUrl>")
    .description("Download an attachment by attachment UUID or URL to a local file")
    .requiredOption("--output <path>", "Destination file path")
    .action(async (attachmentOrUrl: string, opts: { output: string }) => {
      const ctx = getContext();
      const session = await openVerifiedSession(ctx);
      let targetUrl: string;
      if (/^https?:\/\//i.test(attachmentOrUrl.trim())) {
        targetUrl = attachmentOrUrl.trim();
      } else {
        targetUrl = await session.run("attachment.download.resolve", "read", async (client) => {
          try {
            const att = await client.attachment(attachmentOrUrl.trim());
            return att.url;
          } catch (cause) {
            throw new CliError("NOT_FOUND", `Attachment '${attachmentOrUrl}' not found.`, { cause });
          }
        });
      }

      const parsed = new URL(targetUrl);
      const isLinearStorage = parsed.hostname.toLowerCase() === "uploads.linear.app";
      const headers: Record<string, string> = {};
      if (isLinearStorage) {
        headers.Authorization = await ctx.authService.getAuthorizationHeader(ctx.cwd);
      }

      if (ctx.options.dryRun) {
        ctx.output.dryRun("attachment.download", {
          url: targetUrl,
          output: opts.output,
          authenticatedLinearStorage: isLinearStorage,
        });
        return;
      }

      let resp = await ctx.fetchImpl(targetUrl, {
        method: "GET",
        headers,
        redirect: isLinearStorage ? "manual" : "follow",
      });
      if (isLinearStorage && resp.status >= 300 && resp.status < 400) {
        const redirectLocation = resp.headers.get("location");
        if (redirectLocation) {
          resp = await ctx.fetchImpl(redirectLocation, { method: "GET" });
        }
      }
      if (!resp.ok) {
        throw new CliError("NETWORK_ERROR", `Failed to download attachment (HTTP ${resp.status}).`);
      }
      const bytes = Buffer.from(await resp.arrayBuffer());
      fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
      fs.writeFileSync(opts.output, bytes);

      ctx.output.success(
        {
          url: targetUrl,
          output: path.resolve(opts.output),
          bytes: bytes.byteLength,
          authenticatedLinearStorage: isLinearStorage,
        },
        {
          human: () => `Downloaded ${bytes.byteLength} bytes to ${path.resolve(opts.output)}`,
        },
      );
    });

  attCmd
    .command("remove <attachmentId>")
    .description("Remove an attachment link from an issue (requires --yes)")
    .option("--yes", "Confirm removing the attachment link")
    .action(async (attachmentId: string, opts: { yes?: boolean }) => {
      const ctx = getContext();
      const id = attachmentId.trim();
      ctx.requireDestructiveConfirmation(Boolean(opts.yes), `remove attachment '${id}'`);
      if (ctx.options.dryRun) {
        ctx.output.dryRun("attachment.remove", { id });
        return;
      }
      const session = await openVerifiedSession(ctx);
      const res = await session.run("attachment.remove", "idempotent-write", (client) => client.deleteAttachment(id));
      ctx.output.success({ id, removed: Boolean(res.success) }, {
        human: () => `Removed attachment ${id}`,
      });
    });
}
