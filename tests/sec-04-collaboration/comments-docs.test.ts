import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode } from "../../src/core/errors.js";
import { createAuthenticatedTestHarness } from "../helpers/cli-harness.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe("Section 4 Comments and Documents CLI", () => {
  it("supports comment list, add, nested-reply root resolution, update, and --yes delete guard", async () => {
    const createCommentCalls: unknown[] = [];
    let deletedCommentId: string | null = null;

    const harness = await createAuthenticatedTestHarness({
      issue: (async () => ({
        id: "iss-11",
        identifier: "NIN-11",
        team: Promise.resolve({ id: "t-1", key: "NIN", name: "NineAI" }),
        comments: async () => ({
          nodes: [
            {
              id: "cmt-root",
              body: "Initial note",
              url: "https://linear.app/nineai/issue/NIN-11#comment-root",
              createdAt: "2026-11-25T01:00:00.000Z",
              updatedAt: "2026-11-25T01:00:00.000Z",
              user: Promise.resolve({ id: "u-1", name: "Raymond同學" }),
              parent: Promise.resolve(undefined),
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        }),
      })) as never,
      comment: (async () => ({
        id: "cmt-child",
        body: "Nested reply",
        parent: Promise.resolve({ id: "cmt-root" }),
        issue: Promise.resolve({ id: "iss-11", identifier: "NIN-11" }),
      })) as never,
      createComment: (async (input: unknown) => {
        createCommentCalls.push(input);
        return {
          success: true,
          comment: Promise.resolve({
            id: "cmt-new",
            body: (input as { body: string }).body,
            url: "https://linear.app/nineai/issue/NIN-11#comment-new",
            createdAt: "2026-11-25T02:00:00.000Z",
          }),
        };
      }) as never,
      updateComment: (async (id: string, input: { body: string }) => ({
        success: true,
        comment: Promise.resolve({ id, body: input.body, url: "https://linear.app/c" }),
      })) as never,
      deleteComment: (async (id: string) => {
        deletedCommentId = id;
        return { success: true };
      }) as never,
    });
    cleanups.push(harness.cleanup);

    const listRes = await harness.exec(["comment", "list", "--issue", "NIN-11", "--json"]);
    expect(listRes.code).toBe(0);
    expect(JSON.parse(listRes.stdout).data[0].id).toBe("cmt-root");

    const addRes = await harness.exec(["comment", "add", "--issue", "NIN-11", "--body", "Top level", "--json"]);
    expect(addRes.code).toBe(0);
    expect(createCommentCalls[0]).toEqual({ issueId: "iss-11", body: "Top level" });

    // Reply on nested comment cmt-child resolves root thread cmt-root + issueId iss-11!
    const replyRes = await harness.exec(["comment", "reply", "cmt-child", "--body", "Fixed in PR", "--json"]);
    expect(replyRes.code).toBe(0);
    expect(createCommentCalls[1]).toEqual({
      parentId: "cmt-root",
      issueId: "iss-11",
      body: "Fixed in PR",
    });

    expect((await harness.exec(["comment", "update", "cmt-new", "--body", "Edited", "--json"])).code).toBe(0);

    const delBlocked = await harness.exec(["comment", "delete", "cmt-new", "--non-interactive", "--json"]);
    expect(delBlocked.code).toBe(ExitCode.VALIDATION_ERROR);
    expect(deletedCommentId).toBeNull();

    expect((await harness.exec(["comment", "delete", "cmt-new", "--yes", "--json"])).code).toBe(0);
    expect(deletedCommentId).toBe("cmt-new");
  });

  it("supports document list, get, create from file, update, archive, and restore", async () => {
    let createdDocInput: unknown = null;
    let archivedDocId: string | null = null;
    let restoredDocId: string | null = null;

    const harness = await createAuthenticatedTestHarness({
      projects: (async () => ({
        nodes: [{ id: "p-1", name: "Onboarding", slugId: "onboarding", url: "https://linear.app/p/1" }],
      })) as never,
      documents: (async () => ({
        nodes: [
          {
            id: "doc-1",
            title: "Setup Spec",
            slugId: "setup-spec",
            url: "https://linear.app/nineai/document/setup-spec",
            content: "# Setup\nHello",
            updatedAt: "2026-11-25T00:00:00.000Z",
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      })) as never,
      createDocument: (async (input: unknown) => {
        createdDocInput = input;
        return {
          success: true,
          document: Promise.resolve({
            id: "doc-2",
            slugId: "new-doc",
            title: (input as { title: string }).title,
            url: "https://linear.app/nineai/document/new-doc",
          }),
        };
      }) as never,
      updateDocument: (async () => ({
        success: true,
        document: Promise.resolve({
          id: "doc-1",
          slugId: "setup-spec",
          title: "Updated Spec",
          url: "https://linear.app/nineai/document/setup-spec",
        }),
      })) as never,
      deleteDocument: (async (id: string) => {
        archivedDocId = id;
        return { success: true };
      }) as never,
      unarchiveDocument: (async (id: string) => {
        restoredDocId = id;
        return { success: true };
      }) as never,
    });
    cleanups.push(harness.cleanup);

    const docFile = path.join(harness.folder, "doc.md");
    fs.writeFileSync(docFile, "# Architecture\nDetails\n");

    const createRes = await harness.exec([
      "document",
      "create",
      "--title",
      "Architecture Doc",
      "--content-file",
      docFile,
      "--project",
      "Onboarding",
      "--json",
    ]);
    expect(createRes.code).toBe(0);
    expect(createdDocInput).toEqual({
      title: "Architecture Doc",
      content: "# Architecture\nDetails\n",
      projectId: "p-1",
    });

    expect((await harness.exec(["document", "get", "setup-spec", "--json"])).code).toBe(0);
    expect((await harness.exec(["document", "update", "setup-spec", "--title", "Updated Spec", "--json"])).code).toBe(0);
    expect((await harness.exec(["document", "archive", "setup-spec", "--json"])).code).toBe(0);
    expect(archivedDocId).toBe("doc-1");
    expect((await harness.exec(["document", "restore", "setup-spec", "--json"])).code).toBe(0);
    expect(restoredDocId).toBe("doc-1");
  });
});
