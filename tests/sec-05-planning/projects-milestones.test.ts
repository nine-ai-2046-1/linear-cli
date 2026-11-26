import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExitCode } from "../../src/core/errors.js";
import { createAuthenticatedTestHarness } from "../helpers/cli-harness.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe("Section 5 Projects and Milestones CLI", () => {
  it("supports project list/get/issues/create/update/status/archive/restore/delete and milestone CRUD", async () => {
    let createdProjInput: unknown = null;
    const updatedProjCalls: Array<{ id: string; input: Record<string, unknown> }> = [];
    let deletedProjId: string | null = null;
    let createdMsInput: unknown = null;

    const projNode = {
      id: "p-1",
      name: "Q4 CLI",
      slugId: "q4-cli",
      description: "CLI launch",
      content: "# Overview",
      priority: 2,
      url: "https://linear.app/nineai/project/q4-cli",
      status: Promise.resolve({ id: "ps-started", name: "In Progress", type: "started" }),
      lead: Promise.resolve({ id: "u-human", name: "Raymond同學" }),
      teams: async () => ({ nodes: [{ id: "t-nin", key: "NIN", name: "NineAI" }] }),
      members: async () => ({ nodes: [{ id: "u-human", name: "Raymond同學", email: "r@nineai.dev" }] }),
      projectMilestones: async () => ({
        nodes: [{ id: "ms-1", name: "Alpha", description: "First cut", targetDate: "2026-12-01", sortOrder: 1 }],
      }),
    };

    const harness = await createAuthenticatedTestHarness({
      teams: (async () => ({ nodes: [{ id: "t-nin", key: "NIN", name: "NineAI" }] })) as never,
      projectStatuses: (async () => ({
        nodes: [
          { id: "ps-planned", name: "Planned", type: "planned" },
          { id: "ps-started", name: "In Progress", type: "started" },
        ],
      })) as never,
      users: (async ({ filter }: { filter?: unknown }) => {
        const s = JSON.stringify(filter ?? "");
        if (s.toLowerCase().includes("bot")) {
          return {
            nodes: [{ id: "u-app", name: "Bot", displayName: "bot", email: "bot@oauthapp.linear.app", active: true, app: true }],
          };
        }
        return {
          nodes: [{ id: "u-human", name: "Raymond同學", displayName: "raymond", email: "r@nineai.dev", active: true, app: false }],
        };
      }) as never,
      projects: (async () => ({
        nodes: [projNode],
        pageInfo: { hasNextPage: false, endCursor: null },
      })) as never,
      project: (async () => projNode) as never,
      issues: (async () => ({
        nodes: [{ id: "i-1", identifier: "NIN-11", title: "Guide", url: "https://linear.app/i/1" }],
        pageInfo: { hasNextPage: false, endCursor: null },
      })) as never,
      createProject: (async (input: unknown) => {
        createdProjInput = input;
        return { success: true, project: Promise.resolve(projNode) };
      }) as never,
      updateProject: (async (id: string, input: Record<string, unknown>) => {
        updatedProjCalls.push({ id, input });
        return { success: true, project: Promise.resolve(projNode) };
      }) as never,
      archiveProject: (async () => ({ success: true })) as never,
      unarchiveProject: (async () => ({ success: true })) as never,
      deleteProject: (async (id: string) => {
        deletedProjId = id;
        return { success: true };
      }) as never,
      createProjectMilestone: (async (input: unknown) => {
        createdMsInput = input;
        return {
          success: true,
          projectMilestone: Promise.resolve({ id: "ms-2", name: "Beta", targetDate: "2026-12-15" }),
        };
      }) as never,
      updateProjectMilestone: (async () => ({
        success: true,
        projectMilestone: Promise.resolve({ id: "ms-1", name: "Alpha Updated", targetDate: "2026-12-05" }),
      })) as never,
    });
    cleanups.push(harness.cleanup);

    // 1. Create project with summary + content-file + human lead
    const ovFile = path.join(harness.folder, "overview.md");
    fs.writeFileSync(ovFile, "## Objective\nDeliver CLI\n");
    const createRes = await harness.exec([
      "project",
      "create",
      "--name",
      "Q4 CLI",
      "--team",
      "NIN",
      "--summary",
      "CLI launch",
      "--content-file",
      ovFile,
      "--status",
      "Planned",
      "--lead",
      "Raymond同學",
      "--json",
    ]);
    expect(createRes.code).toBe(0);
    expect(createdProjInput).toEqual({
      name: "Q4 CLI",
      teamIds: ["t-nin"],
      description: "CLI launch",
      content: "## Objective\nDeliver CLI\n",
      statusId: "ps-planned",
      leadId: "u-human",
    });

    // Reject app actor as project lead
    const appLead = await harness.exec([
      "project",
      "create",
      "--name",
      "Bad Lead",
      "--team",
      "NIN",
      "--lead",
      "Bot",
      "--json",
    ]);
    expect(appLead.code).toBe(ExitCode.VALIDATION_ERROR);

    // Sec-05 D1: --team has a [] default, so Commander's requiredOption is satisfied
    // even when omitted. The CLI must reject it client-side before any network call.
    const noTeam = await harness.exec(["project", "create", "--name", "No Team", "--json"]);
    expect(noTeam.code).toBe(ExitCode.VALIDATION_ERROR);
    expect(JSON.parse(noTeam.stderr).error.message).toContain("--team");
    expect(createdProjInput).toEqual({
      name: "Q4 CLI",
      teamIds: ["t-nin"],
      description: "CLI launch",
      content: "## Objective\nDeliver CLI\n",
      statusId: "ps-planned",
      leadId: "u-human",
    }); // unchanged: no second create happened

    // 2. Project list, get, issues, status, archive, restore, delete guard
    expect((await harness.exec(["project", "list", "--team", "NIN", "--json"])).code).toBe(0);
    expect((await harness.exec(["project", "get", "Q4 CLI", "--json"])).code).toBe(0);
    expect((await harness.exec(["project", "issues", "Q4 CLI", "--json"])).code).toBe(0);
    expect((await harness.exec(["project", "status", "Q4 CLI", "In Progress", "--json"])).code).toBe(0);
    expect(updatedProjCalls[0]).toEqual({ id: "p-1", input: { statusId: "ps-started" } });
    expect((await harness.exec(["project", "archive", "Q4 CLI", "--json"])).code).toBe(0);
    expect((await harness.exec(["project", "restore", "Q4 CLI", "--json"])).code).toBe(0);

    expect((await harness.exec(["project", "delete", "Q4 CLI", "--non-interactive", "--json"])).code).toBe(
      ExitCode.VALIDATION_ERROR,
    );
    expect(deletedProjId).toBeNull();
    expect((await harness.exec(["project", "delete", "Q4 CLI", "--yes", "--json"])).code).toBe(0);
    expect(deletedProjId).toBe("p-1");

    // 3. Milestones list, get, create, update
    expect((await harness.exec(["milestone", "list", "--project", "Q4 CLI", "--json"])).code).toBe(0);
    expect((await harness.exec(["milestone", "get", "Alpha", "--project", "Q4 CLI", "--json"])).code).toBe(0);
    const msCreate = await harness.exec([
      "milestone",
      "create",
      "--project",
      "Q4 CLI",
      "--name",
      "Beta",
      "--target-date",
      "2026-12-15",
      "--json",
    ]);
    expect(msCreate.code).toBe(0);
    expect(createdMsInput).toEqual({ projectId: "p-1", name: "Beta", targetDate: "2026-12-15" });
    expect(
      (await harness.exec(["milestone", "update", "Alpha", "--project", "Q4 CLI", "--name", "Alpha Updated", "--json"]))
        .code,
    ).toBe(0);
  });
});
