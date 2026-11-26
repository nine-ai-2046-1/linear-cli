import { afterEach, describe, expect, it } from "vitest";
import { ExitCode } from "../../src/core/errors.js";
import { createAuthenticatedTestHarness } from "../helpers/cli-harness.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

describe("Section 7 Releases, Reviews/PR Boundaries, and AST-Guarded Raw GraphQL CLI", () => {
  it("supports release pipelines, releases, release notes, PR review discovery/link, truthful UNSUPPORTED_BY_PUBLIC_API, and AST-guarded raw GraphQL", async () => {
    let createdRelInput: unknown = null;
    let createdRnInput: unknown = null;
    let linkedPrArgs: unknown = null;
    const rawRequests: Array<{ doc: string; vars: unknown }> = [];

    const harness = await createAuthenticatedTestHarness({
      releasePipelines: (async () => ({
        nodes: [{ id: "pipe-1", slugId: "prod", name: "Production", type: "continuous" }],
        pageInfo: { hasNextPage: false, endCursor: null },
      })) as never,
      releases: (async () => ({
        nodes: [{ id: "rel-1", name: "v1.0.0", version: "1.0.0", startDate: null, targetDate: "2026-12-01" }],
        pageInfo: { hasNextPage: false, endCursor: null },
      })) as never,
      createRelease: (async (input: unknown) => {
        createdRelInput = input;
        return {
          success: true,
          release: Promise.resolve({ id: "rel-1", name: "v1.0.0", version: "1.0.0" }),
        };
      }) as never,
      updateRelease: (async (id: string, input: { version?: string }) => ({
        success: true,
        release: Promise.resolve({ id, name: "v1.0.0", version: input.version ?? "1.0.1" }),
      })) as never,
      releaseNotes: (async () => ({
        nodes: [{ id: "rn-1", title: "Release 1.0", updatedAt: "2026-11-25T00:00:00.000Z" }],
        pageInfo: { hasNextPage: false, endCursor: null },
      })) as never,
      releaseNote: (async () => ({
        id: "rn-1",
        slugId: "rn-1-slug",
        title: "Release 1.0",
        url: "https://linear.app/nineai/release-note/rn-1-slug",
        documentContent: { content: "## Highlights" },
        updatedAt: "2026-11-25T00:00:00.000Z",
      })) as never,
      createReleaseNote: (async (input: unknown) => {
        createdRnInput = input;
        return {
          success: true,
          releaseNote: Promise.resolve({ id: "rn-2", title: "Notes 1.0" }),
        };
      }) as never,
      issue: (async () => ({
        id: "iss-11",
        identifier: "NIN-11",
        team: Promise.resolve({ id: "t-nin", key: "NIN", name: "NineAI" }),
      })) as never,
      attachments: (async () => ({
        nodes: [
          {
            id: "att-pr",
            title: "feat: add CLI",
            subtitle: "Merged",
            url: "https://github.com/nineai/cli/pull/42",
            sourceType: "github",
          },
        ],
      })) as never,
      attachmentsForURL: (async () => ({
        nodes: [
          {
            id: "att-pr",
            title: "feat: add CLI",
            subtitle: "Merged",
            url: "https://github.com/nineai/cli/pull/42",
            issue: Promise.resolve({ id: "iss-11", identifier: "NIN-11", title: "CLI Guide" }),
          },
        ],
      })) as never,
      attachmentLinkGitHubPR: (async (issueId: string, url: string, vars: unknown) => {
        linkedPrArgs = { issueId, url, vars };
        return { success: true, attachment: Promise.resolve({ id: "att-pr" }) };
      }) as never,
      client: {
        rawRequest: async (doc: string, vars: unknown) => {
          rawRequests.push({ doc, vars });
          return { data: { viewer: { id: "u-1", name: "Raymond同學" } } };
        },
      } as never,
    });
    cleanups.push(harness.cleanup);

    // 1. Release pipeline, release create/update/list/get, release-note create/list/get
    expect((await harness.exec(["release", "pipeline", "list", "--json"])).code).toBe(0);
    expect(
      (
        await harness.exec([
          "release",
          "create",
          "--pipeline",
          "prod",
          "--name",
          "v1.0.0",
          "--version",
          "1.0.0",
          "--json",
        ])
      ).code,
    ).toBe(0);
    expect(createdRelInput).toEqual({ pipelineId: "pipe-1", name: "v1.0.0", version: "1.0.0" });

    expect((await harness.exec(["release", "list", "--pipeline", "prod", "--json"])).code).toBe(0);
    expect((await harness.exec(["release", "get", "1.0.0", "--json"])).code).toBe(0);
    expect((await harness.exec(["release", "update", "1.0.0", "--version", "1.0.1", "--json"])).code).toBe(0);

    expect(
      (
        await harness.exec([
          "release-note",
          "create",
          "--pipeline",
          "prod",
          "--release",
          "1.0.0",
          "--content",
          "Shipped!",
          "--json",
        ])
      ).code,
    ).toBe(0);
    expect(createdRnInput).toEqual({ pipelineId: "pipe-1", releaseIds: ["rel-1"], content: "Shipped!" });
    expect((await harness.exec(["release-note", "list", "--json"])).code).toBe(0);
    expect((await harness.exec(["release-note", "get", "rn-1", "--json"])).code).toBe(0);

    // 2. Review list, get, link, and truthful exit 9 on private Diff mutations
    const rList = await harness.exec(["review", "list", "--json"]);
    expect(rList.code).toBe(0);
    expect(JSON.parse(rList.stdout).data[0].url).toBe("https://github.com/nineai/cli/pull/42");

    const rGet = await harness.exec(["review", "get", "https://github.com/nineai/cli/pull/42", "--json"]);
    expect(rGet.code).toBe(0);
    expect(JSON.parse(rGet.stdout).data.attachments[0].issue.identifier).toBe("NIN-11");

    const rLink = await harness.exec([
      "review",
      "link",
      "--issue",
      "NIN-11",
      "--url",
      "https://github.com/nineai/cli/pull/42",
      "--json",
    ]);
    expect(rLink.code).toBe(0);
    expect(linkedPrArgs).toEqual({
      issueId: "iss-11",
      url: "https://github.com/nineai/cli/pull/42",
      vars: undefined,
    });

    const rApprove = await harness.exec(["review", "approve", "https://github.com/nineai/cli/pull/42", "--json"]);
    expect(rApprove.code).toBe(ExitCode.UNSUPPORTED_BY_PUBLIC_API);
    expect(JSON.parse(rApprove.stderr).error.code).toBe("UNSUPPORTED_BY_PUBLIC_API");

    const rMergeNoYes = await harness.exec([
      "review",
      "merge",
      "https://github.com/nineai/cli/pull/42",
      "--non-interactive",
      "--json",
    ]);
    expect(rMergeNoYes.code).toBe(ExitCode.VALIDATION_ERROR);

    const rMergeYes = await harness.exec([
      "review",
      "merge",
      "https://github.com/nineai/cli/pull/42",
      "--yes",
      "--json",
    ]);
    expect(rMergeYes.code).toBe(ExitCode.UNSUPPORTED_BY_PUBLIC_API);

    // 3. Raw GraphQL AST enforcement
    const sneakyMut = await harness.exec([
      "api",
      "query",
      "--query",
      'mutation { issueArchive(id: "1") { success } }',
      "--json",
    ]);
    expect(sneakyMut.code).toBe(ExitCode.VALIDATION_ERROR);
    expect(rawRequests).toHaveLength(0);

    const rawQuery = await harness.exec([
      "api",
      "query",
      "--query",
      "query Who($x: Boolean = true) { viewer @include(if: $x) { id name } }",
      "--variables",
      '{"x":true}',
      "--json",
    ]);
    expect(rawQuery.code).toBe(0);
    expect(rawRequests).toHaveLength(1);

    const mutBlocked = await harness.exec([
      "api",
      "mutation",
      "--query",
      'mutation { issueArchive(id: "1") { success } }',
      "--json",
    ]);
    expect(mutBlocked.code).toBe(ExitCode.FORBIDDEN);

    const mutAllowed = await harness.exec([
      "api",
      "mutation",
      "--allow-mutation",
      "--query",
      'mutation { issueArchive(id: "1") { success } }',
      "--json",
    ]);
    expect(mutAllowed.code).toBe(0);
    expect(rawRequests).toHaveLength(2);
  });

  it("prints the CLI version only for a leading standalone --version and never hijacks subcommand --version options", async () => {
    const { runCli } = await import("../../src/cli/app.js");
    const { CLI_VERSION } = await import("../../src/version.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const unauthFolder = fs.mkdtempSync(path.join(os.tmpdir(), "linear-version-flag-"));
    const capture = async (argv: string[]) => {
      let stdout = "";
      const code = await runCli(argv, {
        cwd: unauthFolder,
        isTTY: false,
        stdout: { write: (s) => { stdout += s; } },
        stderr: { write: () => {} },
      });
      return { code, stdout };
    };
    try {

    // Leading standalone version requests (including after global value flags) print the version.
    for (const argv of [
      ["--version"],
      ["-V"],
      ["--json", "--version"],
      ["--cwd", unauthFolder, "--version"],
    ]) {
      const res = await capture(argv);
      expect(res.code, argv.join(" ")).toBe(0);
      expect(res.stdout.trim(), argv.join(" ")).toBe(CLI_VERSION);
    }

    // A --version with a value after a subcommand is the subcommand's option:
    // it must not print the CLI version (unauthenticated folder => AUTH_REQUIRED).
    const sub = await capture(["release", "create", "--pipeline", "p", "--name", "n", "--version", "1.0.0", "--json"]);
    expect(sub.stdout).not.toContain(CLI_VERSION);
    expect(sub.code).toBe(ExitCode.AUTH_REQUIRED);
    } finally {
      fs.rmSync(unauthFolder, { recursive: true, force: true });
    }
  });
});
