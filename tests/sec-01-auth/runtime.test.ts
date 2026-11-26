import { describe, expect, it } from "vitest";
import { ForbiddenLinearError, InvalidInputLinearError, LinearGraphQLError } from "@linear/sdk";
import { CliError, ExitCode, normalizeError } from "../../src/core/errors.js";
import { OutputWriter, redactString } from "../../src/core/output.js";
import { resolvePaginationVariables, toPaginatedResult } from "../../src/core/pagination.js";
import { executeWithGuardrails } from "../../src/core/retry.js";

function createBuffers() {
  let out = "";
  let err = "";
  return {
    stdout: { write: (chunk: string) => { out += chunk; } },
    stderr: { write: (chunk: string) => { err += chunk; } },
    getStdout: () => out,
    getStderr: () => err,
  };
}

describe("Section 1 Runtime Foundation", () => {
  it("emits deterministic JSON on stdout and redacts secrets across strings and objects", () => {
    const buf = createBuffers();
    const writer = new OutputWriter({
      jsonMode: true,
      stdout: buf.stdout,
      stderr: buf.stderr,
      extraSecrets: ["super_secret_custom_tok"],
    });

    writer.success({
      viewer: "Alice",
      accessToken: "secret-oauth-token-value",
      note: "Header Authorization: Bearer tok_1234567890abcdef and lin_api_AbCdEf1234567890 and super_secret_custom_tok",
    });

    const parsed = JSON.parse(buf.getStdout());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.viewer).toBe("Alice");
    expect(parsed.data.accessToken).toBe("[REDACTED]");
    expect(parsed.data.note).not.toContain("tok_1234567890abcdef");
    expect(parsed.data.note).not.toContain("lin_api_AbCdEf1234567890");
    expect(parsed.data.note).not.toContain("super_secret_custom_tok");
    expect(redactString("Authorization: Basic Y2xpZW50OnNlY3JldA==")).toBe("Authorization: Basic [REDACTED]");
  });

  it("emits dry-run preview without executing mutations", () => {
    const buf = createBuffers();
    const writer = new OutputWriter({
      jsonMode: true,
      stdout: buf.stdout,
      stderr: buf.stderr,
    });
    writer.dryRun("issue.create", { teamId: "team-1", title: "Test", apiKey: "lin_api_123456789012" });
    const parsed = JSON.parse(buf.getStdout());
    expect(parsed.ok).toBe(true);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.operation).toBe("issue.create");
    expect(parsed.data.parameters.apiKey).toBe("[REDACTED]");
  });

  it("maps error codes to deterministic exit codes", () => {
    expect(new CliError("AUTH_REQUIRED", "login needed").exitCode).toBe(ExitCode.AUTH_REQUIRED);
    expect(new CliError("FORBIDDEN", "wrong workspace").exitCode).toBe(ExitCode.FORBIDDEN);
    expect(new CliError("NOT_FOUND", "missing").exitCode).toBe(ExitCode.NOT_FOUND);
    expect(new CliError("VALIDATION_ERROR", "bad flag").exitCode).toBe(ExitCode.VALIDATION_ERROR);
    expect(new CliError("AMBIGUOUS_RESOURCE", "2 matches").exitCode).toBe(ExitCode.AMBIGUOUS_RESOURCE);
    expect(new CliError("RATE_LIMITED", "slow down").exitCode).toBe(ExitCode.RATE_LIMITED);
    expect(new CliError("OUTCOME_UNKNOWN", "timed out").exitCode).toBe(ExitCode.OUTCOME_UNKNOWN);
    expect(new CliError("UNSUPPORTED_BY_PUBLIC_API", "private").exitCode).toBe(ExitCode.UNSUPPORTED_BY_PUBLIC_API);
    expect(new CliError("NETWORK_ERROR", "offline").exitCode).toBe(ExitCode.NETWORK_ERROR);
    expect(normalizeError({ status: 401, message: "Unauthorized" }).code).toBe("AUTH_REQUIRED");
  });

  it("maps Linear permission denials to FORBIDDEN and missing-entity invalid input to NOT_FOUND", () => {
    // D3: Linear returns permission denials as ForbiddenLinearError with HTTP 200 and
    // wording like "Not allowed to take action" (no 403, no "forbidden" in the message).
    const forbidden = new ForbiddenLinearError(
      {
        message: "Not allowed to take action",
        response: { status: 200 },
      },
      [new LinearGraphQLError({ message: "You are not allowed to create labels in this team." as never })],
    );
    expect(forbidden.type).toBe("Forbidden");
    const mappedForbidden = normalizeError(forbidden);
    expect(mappedForbidden.code).toBe("FORBIDDEN");
    expect(mappedForbidden.exitCode).toBe(ExitCode.FORBIDDEN);

    // D4: Linear reports missing referenced entities as InvalidInputLinearError
    // ("Entity not found: ..."), which must map to NOT_FOUND, not VALIDATION_ERROR.
    const notFound = new InvalidInputLinearError(
      {
        message: "Entity not found: Notification",
        response: { status: 200 },
      },
      [new LinearGraphQLError({ message: "Could not find referenced Notification." as never })],
    );
    const mappedNotFound = normalizeError(notFound);
    expect(mappedNotFound.code).toBe("NOT_FOUND");
    expect(mappedNotFound.exitCode).toBe(ExitCode.NOT_FOUND);

    // A genuine invalid-input error still maps to VALIDATION_ERROR.
    const invalid = new InvalidInputLinearError(
      { message: "Invalid input", response: { status: 200 } },
      [new LinearGraphQLError({ message: "Name is required" as never })],
    );
    expect(normalizeError(invalid).code).toBe("VALIDATION_ERROR");
  });

  it("retries rate-limited read operations respecting Retry-After and succeeds", async () => {
    const slept: number[] = [];
    let calls = 0;
    const result = await executeWithGuardrails(
      async () => {
        calls += 1;
        if (calls === 1) {
          throw {
            status: 429,
            message: "Rate limit exceeded",
            headers: { "Retry-After": "1" },
          };
        }
        return { id: "ok" };
      },
      {
        kind: "read",
        operationName: "issues.list",
        sleep: async (ms) => {
          slept.push(ms);
        },
      },
    );
    expect(result).toEqual({ id: "ok" });
    expect(calls).toBe(2);
    expect(slept).toEqual([1000]);
  });

  it("never retries create mutations after timeout and fails with OUTCOME_UNKNOWN (exit code 8)", async () => {
    let calls = 0;
    await expect(
      executeWithGuardrails(
        async () => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 60));
          return { id: "created" };
        },
        {
          kind: "create",
          operationName: "issue.create",
          timeoutMs: 15,
        },
      ),
    ).rejects.toMatchObject({
      code: "OUTCOME_UNKNOWN",
      exitCode: ExitCode.OUTCOME_UNKNOWN,
    });
    expect(calls).toBe(1);
  });

  it("validates pagination limits and normalizes Relay connections", () => {
    expect(() => resolvePaginationVariables({ limit: 0 })).toThrowError(/Invalid --limit/);
    expect(() => resolvePaginationVariables({ limit: 500 })).toThrowError(/Invalid --limit/);
    const vars = resolvePaginationVariables({ limit: 25, cursor: "cur_1", sort: "updated" });
    expect(vars.first).toBe(25);
    expect(vars.after).toBe("cur_1");

    const page = toPaginatedResult(
      { nodes: [{ id: "1" }, { id: "2" }], pageInfo: { hasNextPage: true, endCursor: "cur_2" } },
      (n) => n.id,
    );
    expect(page).toEqual({
      items: ["1", "2"],
      pageInfo: { hasNextPage: true, endCursor: "cur_2", count: 2 },
    });
  });
});
