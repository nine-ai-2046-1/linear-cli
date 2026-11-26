import type { LinearClient } from "@linear/sdk";
import { describe, expect, it } from "vitest";
import { ExitCode } from "../../src/core/errors.js";
import {
  parsePriority,
  resolveCycle,
  resolveIssueLabel,
  resolveProject,
  resolveTeam,
  resolveUser,
  resolveWorkflowState,
} from "../../src/core/resolvers.js";

describe("Section 2 Entity Resolvers", () => {
  it("parses human-friendly priority names and rejects invalid values", () => {
    expect(parsePriority("urgent")).toBe(1);
    expect(parsePriority("HIGH")).toBe(2);
    expect(parsePriority("medium")).toBe(3);
    expect(parsePriority("low")).toBe(4);
    expect(parsePriority("none")).toBe(0);
    expect(parsePriority(2)).toBe(2);
    expect(() => parsePriority("p99")).toThrowError(/Invalid priority/);
  });

  it("resolves team by key, user by 'me', and rejects ambiguous user names with exit code 6", async () => {
    const mockClient = {
      viewer: Promise.resolve({
        id: "11111111-1111-4111-8111-111111111111",
        name: "Raymond Magic",
        displayName: "raymond",
        email: "raymond@nineai.dev",
        active: true,
        admin: true,
        guest: false,
      }),
      teams: async () => ({
        nodes: [{ id: "22222222-2222-4222-8222-222222222222", key: "NIN", name: "NineAI", description: null }],
      }),
      users: async () => ({
        nodes: [
          { id: "u-1", name: "Alex", displayName: "alex1", email: "alex1@nineai.dev", active: true },
          { id: "u-2", name: "Alex", displayName: "alex2", email: "alex2@nineai.dev", active: true },
        ],
      }),
      workflowStates: async () => ({
        nodes: [
          { id: "s-1", name: "Todo", type: "unstarted", color: "#ccc", position: 1 },
          { id: "s-2", name: "In Progress", type: "started", color: "#0f0", position: 2 },
        ],
      }),
      issueLabels: async () => ({
        nodes: [
          { id: "l-grp", name: "Type", color: "#111", isGroup: true },
          { id: "l-feat", name: "Feature", color: "#bb87fc", isGroup: false },
        ],
      }),
      projects: async () => ({
        nodes: [{ id: "p-1", name: "CLI Launch", slugId: "cli-launch", url: "https://linear.app/nineai/project/cli-launch" }],
      }),
      team: async () => ({
        activeCycle: Promise.resolve({
          id: "c-10",
          number: 10,
          name: "Sprint 10",
          startsAt: "2026-11-20T00:00:00.000Z",
          endsAt: "2026-12-04T00:00:00.000Z",
        }),
      }),
    } as unknown as LinearClient;

    const me = await resolveUser(mockClient, "me");
    expect(me.email).toBe("raymond@nineai.dev");

    const team = await resolveTeam(mockClient, "nin");
    expect(team.id).toBe("22222222-2222-4222-8222-222222222222");

    await expect(resolveUser(mockClient, "Alex")).rejects.toMatchObject({
      code: "AMBIGUOUS_RESOURCE",
      exitCode: ExitCode.AMBIGUOUS_RESOURCE,
    });

    const st = await resolveWorkflowState(mockClient, team.id, "in progress");
    expect(st.id).toBe("s-2");

    await expect(resolveIssueLabel(mockClient, "Type")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const feat = await resolveIssueLabel(mockClient, "Feature");
    expect(feat.id).toBe("l-feat");

    const proj = await resolveProject(mockClient, "cli-launch");
    expect(proj.id).toBe("p-1");

    const curCycle = await resolveCycle(mockClient, "current", team.id);
    expect(curCycle.number).toBe(10);

    const emptyClient = {
      teams: async () => ({ nodes: [] }),
    } as unknown as LinearClient;
    await expect(resolveTeam(emptyClient, "MISSING")).rejects.toMatchObject({
      code: "NOT_FOUND",
      exitCode: ExitCode.NOT_FOUND,
    });
  });
});
