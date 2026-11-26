import { afterEach, describe, expect, it } from "vitest";
import { createAuthenticatedTestHarness } from "../helpers/cli-harness.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe("Section 5 Cycles and Project Status Updates CLI", () => {
  it("supports cycle list/current/issues and project status update list/create/edit", async () => {
    let createdUpdateInput: unknown = null;
    let editedUpdateArgs: unknown = null;

    const harness = await createAuthenticatedTestHarness({
      teams: (async () => ({ nodes: [{ id: "t-nin", key: "NIN", name: "NineAI" }] })) as never,
      team: (async () => ({
        id: "t-nin",
        activeCycle: Promise.resolve({
          id: "cyc-5",
          number: 5,
          name: "Cycle 5",
          startsAt: "2026-11-20T00:00:00.000Z",
          endsAt: "2026-12-04T00:00:00.000Z",
        }),
      })) as never,
      cycles: (async () => ({
        nodes: [
          {
            id: "cyc-5",
            number: 5,
            name: "Cycle 5",
            startsAt: "2026-11-20T00:00:00.000Z",
            endsAt: "2026-12-04T00:00:00.000Z",
            completedAt: null,
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      })) as never,
      cycle: (async () => ({
        id: "cyc-5",
        number: 5,
        name: "Cycle 5",
        startsAt: "2026-11-20T00:00:00.000Z",
        endsAt: "2026-12-04T00:00:00.000Z",
        issues: async () => ({
          nodes: [{ id: "i-1", identifier: "NIN-11", title: "Sprint item", url: "https://linear.app/i/1" }],
          pageInfo: { hasNextPage: false, endCursor: null },
        }),
      })) as never,
      projects: (async () => ({
        nodes: [{ id: "p-1", name: "Q4 CLI", slugId: "q4-cli", url: "https://linear.app/p/1" }],
      })) as never,
      project: (async () => ({
        id: "p-1",
        name: "Q4 CLI",
        slugId: "q4-cli",
        projectUpdates: async () => ({
          nodes: [
            {
              id: "upd-1",
              health: "onTrack",
              body: "Green",
              url: "https://linear.app/p/1/update/1",
              createdAt: "2026-11-25T00:00:00.000Z",
              user: Promise.resolve({ id: "u-1", name: "Raymond同學" }),
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        }),
      })) as never,
      createProjectUpdate: (async (input: unknown) => {
        createdUpdateInput = input;
        return {
          success: true,
          projectUpdate: Promise.resolve({
            id: "upd-2",
            health: "atRisk",
            body: "Waiting on API",
            url: "https://linear.app/p/1/update/2",
          }),
        };
      }) as never,
      updateProjectUpdate: (async (id: string, input: unknown) => {
        editedUpdateArgs = { id, input };
        return {
          success: true,
          projectUpdate: Promise.resolve({ id, health: "onTrack", body: "Unblocked", url: "https://linear.app/p/1/update/2" }),
        };
      }) as never,
    });
    cleanups.push(harness.cleanup);

    expect((await harness.exec(["cycle", "list", "--team", "NIN", "--json"])).code).toBe(0);
    const cur = await harness.exec(["cycle", "current", "--team", "NIN", "--json"]);
    expect(cur.code).toBe(0);
    expect(JSON.parse(cur.stdout).data.number).toBe(5);

    const cycIssues = await harness.exec(["cycle", "issues", "current", "--team", "NIN", "--json"]);
    expect(cycIssues.code).toBe(0);
    expect(JSON.parse(cycIssues.stdout).data[0].identifier).toBe("NIN-11");

    expect((await harness.exec(["update", "list", "--project", "Q4 CLI", "--json"])).code).toBe(0);
    const updCreate = await harness.exec([
      "update",
      "create",
      "--project",
      "Q4 CLI",
      "--health",
      "atRisk",
      "--body",
      "Waiting on API",
      "--json",
    ]);
    expect(updCreate.code).toBe(0);
    expect(createdUpdateInput).toEqual({ projectId: "p-1", health: "atRisk", body: "Waiting on API" });

    const updEdit = await harness.exec([
      "update",
      "edit",
      "upd-2",
      "--health",
      "onTrack",
      "--body",
      "Unblocked",
      "--json",
    ]);
    expect(updEdit.code).toBe(0);
    expect(editedUpdateArgs).toEqual({ id: "upd-2", input: { health: "onTrack", body: "Unblocked" } });
  });
});
