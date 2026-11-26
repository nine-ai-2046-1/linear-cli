import { afterEach, describe, expect, it } from "vitest";
import { ExitCode } from "../../src/core/errors.js";
import { createAuthenticatedTestHarness } from "../helpers/cli-harness.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe("Section 3 Issue Read, Filter, Search, Children, and Relation List", () => {
  it("constructs combinable AND filters for issue list and issue mine, and rejects conflicting flags", async () => {
    let capturedFilter: unknown = null;
    let capturedSearchArgs: unknown = null;

    const fakeIssue = {
      id: "iss-1",
      identifier: "NIN-11",
      title: "Write setup guide",
      priority: 2,
      url: "https://linear.app/nineai/issue/NIN-11",
      description: "Detailed guide",
      state: Promise.resolve({ id: "st-prog", name: "In Progress", type: "started" }),
      assignee: Promise.resolve({ id: "u-me", name: "Raymond同學", email: "raymond@nineai.dev" }),
      team: Promise.resolve({ id: "t-nin", key: "NIN", name: "NineAI" }),
      project: Promise.resolve({ id: "p-1", name: "CLI Project" }),
      labels: async () => ({ nodes: [{ name: "Feature" }] }),
      children: async () => ({
        nodes: [
          {
            id: "iss-2",
            identifier: "NIN-12",
            title: "Subtask",
            priority: 3,
            url: "https://linear.app/nineai/issue/NIN-12",
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
      relations: async () => ({
        nodes: [
          {
            id: "rel-out",
            type: "blocks",
            relatedIssue: Promise.resolve({ id: "iss-3", identifier: "NIN-13", title: "Downstream" }),
          },
        ],
      }),
      inverseRelations: async () => ({
        nodes: [
          {
            id: "rel-in",
            type: "blocks",
            issue: Promise.resolve({ id: "iss-0", identifier: "NIN-10", title: "Upstream blocker" }),
          },
        ],
      }),
    };

    const harness = await createAuthenticatedTestHarness({
      viewer: Promise.resolve({
        id: "u-me",
        name: "Raymond同學",
        displayName: "raymond",
        email: "raymond@nineai.dev",
        active: true,
      }) as never,
      teams: (async () => ({ nodes: [{ id: "t-nin", key: "NIN", name: "NineAI" }] })) as never,
      workflowStates: (async () => ({
        nodes: [{ id: "st-prog", name: "In Progress", type: "started", color: "#f2c94c", position: 2 }],
      })) as never,
      issues: (async (vars: { filter?: unknown }) => {
        capturedFilter = vars?.filter ?? null;
        return {
          nodes: [fakeIssue],
          pageInfo: { hasNextPage: false, endCursor: null },
        };
      }) as never,
      searchIssues: (async (term: string, vars: unknown) => {
        capturedSearchArgs = { term, vars };
        return {
          nodes: [fakeIssue],
          pageInfo: { hasNextPage: false, endCursor: null },
        };
      }) as never,
      issue: (async () => fakeIssue) as never,
    });
    cleanups.push(harness.cleanup);

    // 1. Conflicting --assignee and --unassigned fails with exit code 5
    const conflict = await harness.exec(["issue", "list", "--assignee", "me", "--unassigned", "--json"]);
    expect(conflict.code).toBe(ExitCode.VALIDATION_ERROR);

    // 2. issue mine with --team, --status, --label, --priority builds AND filter
    const mine = await harness.exec([
      "issue",
      "mine",
      "--team",
      "NIN",
      "--status",
      "In Progress",
      "--label",
      "Feature",
      "--priority",
      "high",
      "--json",
    ]);
    expect(mine.code).toBe(0);
    expect(JSON.parse(mine.stdout).data[0].identifier).toBe("NIN-11");
    expect(capturedFilter).toMatchObject({
      and: [
        { team: { id: { eq: "t-nin" } } },
        { assignee: { id: { eq: "u-me" } } },
        { state: { id: { eq: "st-prog" } } },
        { labels: { name: { eqIgnoreCase: "Feature" } } },
        { priority: { eq: 2 } },
      ],
    });

    // 3. issue search
    const search = await harness.exec(["issue", "search", "setup guide", "--team", "NIN", "--include-comments", "--json"]);
    expect(search.code).toBe(0);
    expect(capturedSearchArgs).toMatchObject({
      term: "setup guide",
      vars: { first: 50, includeComments: true, teamId: "t-nin" },
    });

    // 4. issue get, children, relation list
    const getRes = await harness.exec(["issue", "get", "NIN-11", "--json"]);
    expect(getRes.code).toBe(0);
    expect(JSON.parse(getRes.stdout).data.description).toBe("Detailed guide");

    const childrenRes = await harness.exec(["issue", "children", "NIN-11", "--json"]);
    expect(childrenRes.code).toBe(0);
    expect(JSON.parse(childrenRes.stdout).data[0].identifier).toBe("NIN-12");

    const relList = await harness.exec(["issue", "relation", "list", "NIN-11", "--json"]);
    expect(relList.code).toBe(0);
    const rels = JSON.parse(relList.stdout).data;
    expect(rels).toEqual([
      expect.objectContaining({ id: "rel-out", direction: "outbound", type: "blocks", relatedIssue: "NIN-13" }),
      expect.objectContaining({ id: "rel-in", direction: "inbound", type: "blocked-by", relatedIssue: "NIN-10" }),
    ]);
  });
});
