import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode } from "../../src/core/errors.js";
import { createAuthenticatedTestHarness } from "../helpers/cli-harness.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe("Section 3 Issue Mutations, Shortcuts, Lifecycle, Sharing, and Relations", () => {
  it("supports create from file, partial updates, non-destructive labels, lifecycle guards, and normalized blocked-by relations", async () => {
    let createdInput: unknown = null;
    const updateCalls: Array<{ id: string; input: Record<string, unknown> }> = [];
    let createdRelation: unknown = null;
    let deletedRelationId: string | null = null;
    let deletedIssueId: string | null = null;
    let archivedId: string | null = null;
    let restoredId: string | null = null;
    let sharedArgs: { id: string; userId: string } | null = null;
    let subscribedId: string | null = null;

    const issueMap: Record<string, { id: string; identifier: string; title: string; url: string }> = {
      "NIN-11": { id: "uuid-11", identifier: "NIN-11", title: "Base issue", url: "https://linear.app/nineai/issue/NIN-11" },
      "NIN-12": { id: "uuid-12", identifier: "NIN-12", title: "Dependent issue", url: "https://linear.app/nineai/issue/NIN-12" },
    };

    const harness = await createAuthenticatedTestHarness({
      viewer: Promise.resolve({ id: "u-me", name: "Raymond同學", displayName: "raymond", email: "r@nineai.dev", active: true }) as never,
      teams: (async () => ({ nodes: [{ id: "t-nin", key: "NIN", name: "NineAI" }] })) as never,
      workflowStates: (async () => ({
        nodes: [{ id: "st-done", name: "Done", type: "completed", color: "#5e6ad2", position: 3 }],
      })) as never,
      issueLabels: (async () => ({
        nodes: [
          { id: "lbl-feat", name: "Feature", color: "#BB87FC", isGroup: false },
          { id: "lbl-imp", name: "Improvement", color: "#4EA7FC", isGroup: false },
          { id: "lbl-bug", name: "Bug", color: "#EB5757", isGroup: false },
        ],
      })) as never,
      projects: (async () => ({
        nodes: [{ id: "proj-1", name: "Roadmap Q4", slugId: "roadmap-q4", url: "https://linear.app/nineai/project/roadmap-q4" }],
      })) as never,
      issue: (async (ref: string) => {
        const found = issueMap[ref] ?? Object.values(issueMap).find((x) => x.id === ref);
        if (!found) throw new Error("Not found");
        return {
          ...found,
          team: Promise.resolve({ id: "t-nin", key: "NIN", name: "NineAI" }),
        };
      }) as never,
      createIssue: (async (input: unknown) => {
        createdInput = input;
        return {
          success: true,
          issue: Promise.resolve({
            id: "uuid-99",
            identifier: "NIN-99",
            title: (input as { title: string }).title,
            url: "https://linear.app/nineai/issue/NIN-99",
          }),
        };
      }) as never,
      updateIssue: (async (id: string, input: Record<string, unknown>) => {
        updateCalls.push({ id, input });
        return {
          success: true,
          issue: Promise.resolve({
            id,
            identifier: "NIN-11",
            title: "Updated",
            url: "https://linear.app/nineai/issue/NIN-11",
          }),
        };
      }) as never,
      archiveIssue: (async (id: string) => {
        archivedId = id;
        return { success: true };
      }) as never,
      unarchiveIssue: (async (id: string) => {
        restoredId = id;
        return { success: true };
      }) as never,
      deleteIssue: (async (id: string) => {
        deletedIssueId = id;
        return { success: true };
      }) as never,
      issueSubscribe: (async (id: string) => {
        subscribedId = id;
        return { success: true };
      }) as never,
      issueUnsubscribe: (async () => ({ success: true })) as never,
      issueShare: (async (id: string, userId: string) => {
        sharedArgs = { id, userId };
        return { success: true };
      }) as never,
      issueUnshare: (async () => ({ success: true })) as never,
      createIssueRelation: (async (input: unknown) => {
        createdRelation = input;
        return { success: true, issueRelation: Promise.resolve({ id: "rel-new" }) };
      }) as never,
      deleteIssueRelation: (async (id: string) => {
        deletedRelationId = id;
        return { success: true };
      }) as never,
    });
    cleanups.push(harness.cleanup);

    // 1. Create issue from Markdown file
    const mdFile = path.join(harness.folder, "spec.md");
    fs.writeFileSync(mdFile, "## Acceptance\n- Works cleanly\n");
    const created = await harness.exec([
      "issue",
      "create",
      "--team",
      "NIN",
      "--title",
      "Implement CLI",
      "--description-file",
      mdFile,
      "--assignee",
      "me",
      "--label",
      "Feature",
      "--priority",
      "high",
      "--json",
    ]);
    expect(created.code).toBe(0);
    expect(createdInput).toEqual({
      teamId: "t-nin",
      title: "Implement CLI",
      description: "## Acceptance\n- Works cleanly\n",
      assigneeId: "u-me",
      labelIds: ["lbl-feat"],
      priority: 2,
    });

    // 2. Non-destructive label add & remove
    expect((await harness.exec(["issue", "label", "add", "NIN-11", "Improvement", "--json"])).code).toBe(0);
    expect((await harness.exec(["issue", "label", "remove", "NIN-11", "Bug", "--json"])).code).toBe(0);
    expect(updateCalls[0]).toEqual({ id: "uuid-11", input: { addedLabelIds: ["lbl-imp"] } });
    expect(updateCalls[1]).toEqual({ id: "uuid-11", input: { removedLabelIds: ["lbl-bug"] } });

    // 3. Shortcuts: status, assign, unassign, priority, project set, parent set
    expect((await harness.exec(["issue", "status", "NIN-11", "Done", "--json"])).code).toBe(0);
    expect((await harness.exec(["issue", "assign", "NIN-11", "me", "--json"])).code).toBe(0);
    expect((await harness.exec(["issue", "unassign", "NIN-11", "--json"])).code).toBe(0);
    expect((await harness.exec(["issue", "priority", "NIN-11", "urgent", "--json"])).code).toBe(0);
    expect((await harness.exec(["issue", "project", "set", "NIN-11", "Roadmap Q4", "--json"])).code).toBe(0);
    expect((await harness.exec(["issue", "parent", "set", "NIN-12", "NIN-11", "--json"])).code).toBe(0);

    // 4. Lifecycle: archive, restore, subscribe, share, and delete confirmation guard
    expect((await harness.exec(["issue", "archive", "NIN-11", "--json"])).code).toBe(0);
    expect(archivedId).toBe("uuid-11");
    expect((await harness.exec(["issue", "restore", "NIN-11", "--json"])).code).toBe(0);
    expect(restoredId).toBe("uuid-11");
    expect((await harness.exec(["issue", "subscribe", "NIN-11", "--json"])).code).toBe(0);
    expect(subscribedId).toBe("uuid-11");
    expect((await harness.exec(["issue", "share", "NIN-11", "me", "--json"])).code).toBe(0);
    expect(sharedArgs).toEqual({ id: "uuid-11", userId: "u-me" });

    const delNoYes = await harness.exec(["issue", "delete", "NIN-11", "--non-interactive", "--json"]);
    expect(delNoYes.code).toBe(ExitCode.VALIDATION_ERROR);
    expect(deletedIssueId).toBeNull();

    const delYes = await harness.exec(["issue", "delete", "NIN-11", "--yes", "--json"]);
    expect(delYes.code).toBe(0);
    expect(deletedIssueId).toBe("uuid-11");

    // 5. Blocked-by relation normalizes direction: NIN-12 blocked-by NIN-11 -> NIN-11 blocks NIN-12!
    const relAdd = await harness.exec([
      "issue",
      "relation",
      "add",
      "NIN-12",
      "--type",
      "blocked-by",
      "--target",
      "NIN-11",
      "--json",
    ]);
    expect(relAdd.code).toBe(0);
    expect(createdRelation).toEqual({
      issueId: "uuid-11",
      relatedIssueId: "uuid-12",
      type: "blocks",
    });

    expect((await harness.exec(["issue", "relation", "remove", "rel-new", "--json"])).code).toBe(0);
    expect(deletedRelationId).toBe("rel-new");
  });
});
