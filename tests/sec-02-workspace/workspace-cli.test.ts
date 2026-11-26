import { afterEach, describe, expect, it } from "vitest";
import { ExitCode } from "../../src/core/errors.js";
import { createAuthenticatedTestHarness } from "../helpers/cli-harness.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe("Section 2 Workspace, Users, Teams, Statuses, Labels, and Templates CLI", () => {
  it("executes workspace info, me, user list/get, team list/get/members, status list, label list, and template list/get", async () => {
    const teamId = "10b7ddf4-d8d0-40c3-a850-1530d0b3fb00";
    const userId = "6d2d2449-bf54-4c72-a1ff-ca3598de1155";
    const tplId = "33333333-3333-4333-8333-333333333333";

    const harness = await createAuthenticatedTestHarness({
      organization: Promise.resolve({
        id: "4b04ee96-418a-4d9e-adb9-0114d4f994eb",
        name: "NineAI",
        urlKey: "nineai",
      }) as never,
      viewer: Promise.resolve({
        id: userId,
        name: "Raymond Magic",
        displayName: "photovideo2046",
        email: "photovideo2046@gmail.com",
        active: true,
        admin: true,
        guest: false,
      }) as never,
      users: (async () => ({
        nodes: [
          {
            id: userId,
            name: "Raymond Magic",
            displayName: "photovideo2046",
            email: "photovideo2046@gmail.com",
            active: true,
            admin: true,
            guest: false,
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      })) as never,
      user: (async () => ({
        id: userId,
        name: "Raymond Magic",
        displayName: "photovideo2046",
        email: "photovideo2046@gmail.com",
        active: true,
        admin: true,
        guest: false,
        teams: async () => ({ nodes: [{ id: teamId, key: "NIN", name: "NineAI" }] }),
      })) as never,
      teams: (async () => ({
        nodes: [{ id: teamId, key: "NIN", name: "NineAI", description: "Core team", private: false }],
        pageInfo: { hasNextPage: false, endCursor: null },
      })) as never,
      team: (async () => ({
        id: teamId,
        key: "NIN",
        name: "NineAI",
        description: "Core team",
        private: false,
        cyclesEnabled: true,
        triageEnabled: true,
        members: async () => ({
          nodes: [
            {
              id: userId,
              name: "Raymond Magic",
              displayName: "photovideo2046",
              email: "photovideo2046@gmail.com",
              active: true,
              admin: true,
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        }),
        templates: async () => ({ nodes: [] }),
      })) as never,
      workflowStates: (async () => ({
        nodes: [
          { id: "st-2", name: "In Progress", type: "started", color: "#f2c94c", position: 2 },
          { id: "st-1", name: "Todo", type: "unstarted", color: "#e2e2e2", position: 1 },
        ],
      })) as never,
      issueLabels: (async () => ({
        nodes: [
          { id: "lbl-1", name: "Feature", color: "#BB87FC", isGroup: false, retiredAt: null, archivedAt: null },
          { id: "lbl-g", name: "Category", color: "#000000", isGroup: true, retiredAt: null, archivedAt: null },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      })) as never,
      // D2: the SDK IssueLabel fragment omits retiredAt, so `label list` enriches
      // the page via raw GraphQL. Mock that enrichment here.
      client: {
        rawRequest: async (_doc: string, vars: { ids?: string[] }) => ({
          data: {
            issueLabels: {
              nodes: (vars.ids ?? []).map((id) => ({
                id,
                retiredAt: id === "lbl-1" ? "2026-11-20T08:00:00.000Z" : null,
              })),
            },
          },
        }),
      } as never,
      templates: Promise.resolve([
        { id: tplId, name: "Bug Report", type: "issue", description: "Standard bug", content: "## Steps", templateData: {} },
      ]) as never,
    });
    cleanups.push(harness.cleanup);

    const ws = await harness.exec(["workspace", "info", "--json"]);
    expect(ws.code).toBe(0);
    expect(JSON.parse(ws.stdout).data.urlKey).toBe("nineai");

    const me = await harness.exec(["me", "--json"]);
    expect(me.code).toBe(0);
    expect(JSON.parse(me.stdout).data.email).toBe("photovideo2046@gmail.com");

    const users = await harness.exec(["user", "list", "--query", "raymond", "--json"]);
    expect(users.code).toBe(0);
    expect(JSON.parse(users.stdout).data).toHaveLength(1);

    const uGet = await harness.exec(["user", "get", "Raymond Magic", "--json"]);
    expect(uGet.code).toBe(0);
    expect(JSON.parse(uGet.stdout).data.teams[0].key).toBe("NIN");

    const tGet = await harness.exec(["team", "get", "NIN", "--json"]);
    expect(tGet.code).toBe(0);
    expect(JSON.parse(tGet.stdout).data.id).toBe(teamId);

    const tMembers = await harness.exec(["team", "members", "NIN", "--json"]);
    expect(tMembers.code).toBe(0);
    expect(JSON.parse(tMembers.stdout).data[0].name).toBe("Raymond Magic");

    const statuses = await harness.exec(["status", "list", "--team", "NIN", "--json"]);
    expect(statuses.code).toBe(0);
    // Ordered by position!
    expect(JSON.parse(statuses.stdout).data.map((s: { name: string }) => s.name)).toEqual(["Todo", "In Progress"]);

    const labels = await harness.exec(["label", "list", "--team", "NIN", "--json"]);
    expect(labels.code).toBe(0);
    // Groups excluded unless --include-groups
    expect(JSON.parse(labels.stdout).data).toHaveLength(1);
    // D2: retiredAt comes from the raw enrichment query, not the (incomplete) SDK fragment
    expect(JSON.parse(labels.stdout).data[0].retiredAt).toBe("2026-11-20T08:00:00.000Z");

    const tpls = await harness.exec(["template", "list", "--type", "issue", "--json"]);
    expect(tpls.code).toBe(0);
    expect(JSON.parse(tpls.stdout).data[0].name).toBe("Bug Report");

    const tplGet = await harness.exec(["template", "get", "Bug Report", "--json"]);
    expect(tplGet.code).toBe(0);
    expect(JSON.parse(tplGet.stdout).data.content).toBe("## Steps");
  });

  it("returns AMBIGUOUS_RESOURCE (exit 6) when user get matches multiple users", async () => {
    const harness = await createAuthenticatedTestHarness({
      users: (async () => ({
        nodes: [
          { id: "u-1", name: "Alex", displayName: "alex1", email: "a1@nineai.dev", active: true },
          { id: "u-2", name: "Alex", displayName: "alex2", email: "a2@nineai.dev", active: true },
        ],
      })) as never,
    });
    cleanups.push(harness.cleanup);

    const res = await harness.exec(["user", "get", "Alex", "--json"]);
    expect(res.code).toBe(ExitCode.AMBIGUOUS_RESOURCE);
    expect(JSON.parse(res.stderr).error.code).toBe("AMBIGUOUS_RESOURCE");
  });
});
