import { afterEach, describe, expect, it } from "vitest";
import { createAuthenticatedTestHarness } from "../helpers/cli-harness.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe("Section 6 Labels, Custom Views, and Inbox CLI", () => {
  it("supports label create/update/archive(retire)/restore, custom views list/get, and inbox list/read/unread/snooze", async () => {
    let createdLabel: unknown = null;
    let retiredId: string | null = null;
    let restoredId: string | null = null;
    const notifUpdates: Array<{ id: string; input: Record<string, unknown> }> = [];
    const customViewFirsts: number[] = [];
    const inboxVars: Array<{ first?: number; unreadOnly?: boolean }> = [];

    const harness = await createAuthenticatedTestHarness({
      teams: (async () => ({ nodes: [{ id: "t-nin", key: "NIN", name: "NineAI" }] })) as never,
      issueLabels: (async () => ({
        nodes: [
          {
            id: "lbl-td",
            name: "Tech Debt",
            color: "#EB5757",
            description: "Refactor items",
            isGroup: false,
            retiredAt: "2026-11-25T00:00:00.000Z",
          },
        ],
      })) as never,
      createIssueLabel: (async (input: unknown) => {
        createdLabel = input;
        return {
          success: true,
          issueLabel: Promise.resolve({
            id: "lbl-td",
            name: "Tech Debt",
            color: "#EB5757",
            description: "Refactor items",
            isGroup: false,
          }),
        };
      }) as never,
      updateIssueLabel: (async (id: string, input: { color?: string }) => ({
        success: true,
        issueLabel: Promise.resolve({ id, name: "Tech Debt", color: input.color ?? "#000000" }),
      })) as never,
      issueLabelRetire: (async (id: string) => {
        retiredId = id;
        return { success: true };
      }) as never,
      issueLabelRestore: (async (id: string) => {
        restoredId = id;
        return { success: true };
      }) as never,
      customViews: (async (vars?: { first?: number }) => {
        customViewFirsts.push(vars?.first ?? 0);
        return {
          nodes: [
            {
              id: "view-1",
              name: "Active Bugs",
              slugId: "active-bugs",
              modelName: "Issue",
              shared: true,
              description: "Team bug triage",
              filterData: { labels: { name: { eq: "Bug" } } },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        };
      }) as never,
      inboxNotifications: (async (vars?: { first?: number; unreadOnly?: boolean }) => {
        inboxVars.push(vars ?? {});
        const nodes = [
          {
            id: "notif-1",
            type: "issueAssignedToYou",
            category: "assignments",
            readAt: null,
            snoozedUntilAt: null,
            createdAt: "2026-11-25T01:00:00.000Z",
          },
          {
            id: "notif-2",
            type: "issueCommentMention",
            category: "mentions",
            readAt: "2026-11-25T01:05:00.000Z",
            snoozedUntilAt: null,
            createdAt: "2026-11-25T01:02:00.000Z",
          },
        ];
        return {
          // Simulate Linear's server-side unreadOnly filter (D6: --unread must be
          // applied by the API so it covers every page, not just the current one).
          nodes: vars?.unreadOnly ? nodes.filter((n) => !n.readAt) : nodes,
          pageInfo: { hasNextPage: false, endCursor: null },
        };
      }) as never,
      updateNotification: (async (id: string, input: Record<string, unknown>) => {
        notifUpdates.push({ id, input });
        return { success: true };
      }) as never,
    });
    cleanups.push(harness.cleanup);

    // 1. Labels: create, update, archive (retire), restore
    const cRes = await harness.exec([
      "label",
      "create",
      "--name",
      "Tech Debt",
      "--team",
      "NIN",
      "--color",
      "#EB5757",
      "--json",
    ]);
    expect(cRes.code).toBe(0);
    expect(createdLabel).toEqual({ name: "Tech Debt", teamId: "t-nin", color: "#EB5757" });

    expect((await harness.exec(["label", "update", "Tech Debt", "--team", "NIN", "--color", "#112233", "--json"])).code).toBe(0);
    expect((await harness.exec(["label", "archive", "Tech Debt", "--team", "NIN", "--json"])).code).toBe(0);
    expect(retiredId).toBe("lbl-td");
    expect((await harness.exec(["label", "restore", "Tech Debt", "--team", "NIN", "--json"])).code).toBe(0);
    expect(restoredId).toBe("lbl-td");

    // 2. Views: list & get
    const vList = await harness.exec(["view", "list", "--shared", "--json"]);
    expect(vList.code).toBe(0);
    expect(JSON.parse(vList.stdout).data[0].slugId).toBe("active-bugs");

    const vGet = await harness.exec(["view", "get", "Active Bugs", "--json"]);
    expect(vGet.code).toBe(0);
    expect(JSON.parse(vGet.stdout).data.filterData).toEqual({ labels: { name: { eq: "Bug" } } });

    // D1/D5: Custom View queries must never exceed first:50 (Linear rejects >=86
    // with "Query too complex", which made view get by name impossible).
    expect(customViewFirsts.length).toBeGreaterThan(0);
    for (const first of customViewFirsts) {
      expect(first).toBeGreaterThan(0);
      expect(first).toBeLessThanOrEqual(50);
    }
    // --limit above the per-request cap is honored by chunking, not by one big query.
    const vListBig = await harness.exec(["view", "list", "--limit", "100", "--json"]);
    expect(vListBig.code).toBe(0);
    for (const first of customViewFirsts) {
      expect(first).toBeLessThanOrEqual(50);
    }

    // 3. Inbox: list --unread, read, unread, snooze
    const unread = await harness.exec(["inbox", "list", "--unread", "--json"]);
    expect(unread.code).toBe(0);
    expect(JSON.parse(unread.stdout).data).toHaveLength(1);
    expect(JSON.parse(unread.stdout).data[0].id).toBe("notif-1");
    // D6: --unread must be forwarded to the API (server-side filtering across all pages),
    // not applied client-side to a single page.
    expect(inboxVars.length).toBeGreaterThan(0);
    expect(inboxVars.some((v) => v.unreadOnly === true)).toBe(true);
    // Without --unread, no unreadOnly filter is sent.
    const inboxAll = await harness.exec(["inbox", "list", "--json"]);
    expect(inboxAll.code).toBe(0);
    expect(JSON.parse(inboxAll.stdout).data).toHaveLength(2);
    expect(inboxVars[inboxVars.length - 1]?.unreadOnly).toBeFalsy();

    expect((await harness.exec(["inbox", "read", "notif-1", "--json"])).code).toBe(0);
    expect(notifUpdates[0]?.input.readAt).toBeInstanceOf(Date);

    expect((await harness.exec(["inbox", "unread", "notif-1", "--json"])).code).toBe(0);
    expect(notifUpdates[1]?.input.readAt).toBeNull();

    expect(
      (await harness.exec(["inbox", "snooze", "notif-1", "--until", "2026-12-01T09:00:00Z", "--json"])).code,
    ).toBe(0);
    expect((notifUpdates[2]?.input.snoozedUntilAt as Date).toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });
});
