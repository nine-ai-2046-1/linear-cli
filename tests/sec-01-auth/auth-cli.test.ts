import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LinearClient } from "@linear/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { FileSecretStore, MemorySecretStore } from "../../src/auth/keychain.js";
import { runCli } from "../../src/cli/app.js";
import { ExitCode } from "../../src/core/errors.js";

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `linear-auth-cli-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createHarness() {
  const mem = new MemorySecretStore("keychain");
  const file = new FileSecretStore();
  const stores = {
    getStore: (mode: "keychain" | "file") => (mode === "file" ? file : mem),
  };

  const sdkFactory = (auth: { apiKey?: string; accessToken?: string }): LinearClient => {
    const token = auth.apiKey ?? auth.accessToken;
    if (token === "lin_api_alice_secret_123456") {
      return {
        viewer: Promise.resolve({ id: "u-alice", name: "Alice", displayName: "alice", email: "alice@nineai.dev" }),
        organization: Promise.resolve({ id: "w-nine", name: "NineAI", urlKey: "nineai" }),
      } as unknown as LinearClient;
    }
    if (token === "lin_api_bob_secret_654321") {
      return {
        viewer: Promise.resolve({ id: "u-bob", name: "Bob", displayName: "bob", email: "bob@other.dev" }),
        organization: Promise.resolve({ id: "w-other", name: "OtherOrg", urlKey: "otherorg" }),
      } as unknown as LinearClient;
    }
    if (token === "app_access_tok_999999") {
      return {
        viewer: Promise.resolve({
          id: "u-app",
          name: "Agent Bot",
          displayName: "agentbot",
          email: "bot@oauthapp.linear.app",
          app: true,
        }),
        organization: Promise.resolve({ id: "w-nine", name: "NineAI", urlKey: "nineai" }),
      } as unknown as LinearClient;
    }
    const err = new Error("Invalid token") as Error & { status?: number };
    err.status = 401;
    return {
      get viewer() {
        return Promise.reject(err);
      },
      get organization() {
        return Promise.reject(err);
      },
    } as unknown as LinearClient;
  };

  async function exec(argv: string[], opts?: { cwd?: string; stdinText?: string; isTTY?: boolean }) {
    let stdout = "";
    let stderr = "";
    const code = await runCli(argv, {
      cwd: opts?.cwd,
      stdinText: opts?.stdinText,
      isTTY: opts?.isTTY ?? false,
      stdout: { write: (s) => { stdout += s; } },
      stderr: { write: (s) => { stderr += s; } },
      stores,
      sdkFactory,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/oauth/token")) {
          return new Response(
            JSON.stringify({
              access_token: "app_access_tok_999999",
              expires_in: 2592000,
              scope: "read,write",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.endsWith("/oauth/revoke")) {
          return new Response("", { status: 200 });
        }
        return new Response("err", { status: 404 });
      },
    });
    return { code, stdout, stderr };
  }

  return { exec };
}

describe("Section 1 CLI Auth Commands", () => {
  it("supports per-folder login, status, whoami, expect-workspace/user guardrails, reauth, and logout", async () => {
    const folderA = makeTempDir("a");
    const folderB = makeTempDir("b");
    const subA = path.join(folderA, "sub");
    fs.mkdirSync(subA, { recursive: true });
    const { exec } = createHarness();

    // Unauthenticated whoami fails with AUTH_REQUIRED (exit 2)
    const unauth = await exec(["auth", "whoami", "--json", "--non-interactive"], { cwd: folderA });
    expect(unauth.code).toBe(ExitCode.AUTH_REQUIRED);
    expect(JSON.parse(unauth.stderr).error.code).toBe("AUTH_REQUIRED");

    // Login Alice in folderA, Bob in folderB
    const loginA = await exec(
      ["auth", "login", "--api-key", "--api-key-stdin", "--storage", "file", "--json", "--non-interactive"],
      { cwd: folderA, stdinText: "lin_api_alice_secret_123456\n" },
    );
    expect(loginA.code).toBe(0);
    expect(loginA.stdout).not.toContain("lin_api_alice_secret_123456");
    expect(JSON.parse(loginA.stdout).data.account.email).toBe("alice@nineai.dev");

    const loginB = await exec(
      ["auth", "login", "--api-key", "--api-key-stdin", "--storage", "keychain", "--json", "--non-interactive"],
      { cwd: folderB, stdinText: "lin_api_bob_secret_654321\n" },
    );
    expect(loginB.code).toBe(0);
    expect(JSON.parse(loginB.stdout).data.account.email).toBe("bob@other.dev");

    // Subfolder of A does NOT inherit folderA's login
    const subWho = await exec(["auth", "whoami", "--json", "--non-interactive"], { cwd: subA });
    expect(subWho.code).toBe(ExitCode.AUTH_REQUIRED);

    // --expect-workspace mismatch blocks with FORBIDDEN (exit 3)
    const wrongWs = await exec(
      ["auth", "whoami", "--expect-workspace", "otherorg", "--json", "--non-interactive"],
      { cwd: folderA },
    );
    expect(wrongWs.code).toBe(ExitCode.FORBIDDEN);
    expect(JSON.parse(wrongWs.stderr).error.code).toBe("FORBIDDEN");

    // Matching --expect-workspace and --expect-user succeeds
    const rightWs = await exec(
      ["auth", "whoami", "--expect-workspace", "nineai", "--expect-user", "alice@nineai.dev", "--json"],
      { cwd: folderA },
    );
    expect(rightWs.code).toBe(0);

    // Reauth folderA from Alice to Bob
    const reauthA = await exec(
      ["auth", "reauth", "--api-key", "--api-key-stdin", "--storage", "file", "--json", "--non-interactive"],
      { cwd: folderA, stdinText: "lin_api_bob_secret_654321\n" },
    );
    expect(reauthA.code).toBe(0);
    expect(JSON.parse(reauthA.stdout).data.account.email).toBe("bob@other.dev");

    // Logout folderA leaves folderB untouched
    const logoutA = await exec(["auth", "logout", "--json"], { cwd: folderA });
    expect(logoutA.code).toBe(0);
    expect(JSON.parse((await exec(["auth", "status", "--json"], { cwd: folderA })).stdout).data.authenticated).toBe(false);
    expect(JSON.parse((await exec(["auth", "status", "--json"], { cwd: folderB })).stdout).data.authenticated).toBe(true);
  });

  it("handles all help and bare-invocation forms with truthful exit codes", async () => {
    const { exec } = createHarness();

    // `--help` FLAG -> commander.helpDisplayed -> exit 0
    const flag = await exec(["--help"]);
    expect(flag.code).toBe(0);
    expect(flag.stdout).toContain("Usage: linear");

    // `help` SUBCOMMAND -> commander.help (exitCode 0) -> exit 0 (previously exit 5 "(outputHelp)")
    const helpCmd = await exec(["help"]);
    expect(helpCmd.code).toBe(0);
    expect(helpCmd.stdout).toContain("Usage: linear");
    const helpSub = await exec(["help", "auth"]);
    expect(helpSub.code).toBe(0);
    expect(helpSub.stdout).toContain("Usage: linear auth");

    // group command without subcommand -> commander.help (exitCode 1) -> usage error 5
    const group = await exec(["auth"]);
    expect(group.code).toBe(ExitCode.VALIDATION_ERROR);
    expect(group.stderr).toContain("Missing command or subcommand");
    expect(group.stderr).not.toContain("(outputHelp)");

    // bare invocation -> same usage error, never "(outputHelp)"
    const bare = await exec([]);
    expect(bare.code).toBe(ExitCode.VALIDATION_ERROR);
    expect(bare.stderr).not.toContain("(outputHelp)");
    expect(bare.stderr).toContain("Missing command or subcommand");

    // unknown command still exit 5 with commander's own message
    const unknown = await exec(["bogus"]);
    expect(unknown.code).toBe(ExitCode.VALIDATION_ERROR);
    expect(unknown.stderr).toContain("unknown command 'bogus'");

    // JSON mode keeps the same codes/messages on stderr
    const groupJson = await exec(["--json", "auth"]);
    expect(groupJson.code).toBe(ExitCode.VALIDATION_ERROR);
    expect(JSON.parse(groupJson.stderr).error.message).toContain("Missing command or subcommand");

    // --version still exit 0
    const ver = await exec(["--version"]);
    expect(ver.code).toBe(0);
    expect(ver.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("supports --app client-credentials file login and revoke", async () => {
    const folder = makeTempDir("app");
    const credFile = path.join(folder, "client.json");
    fs.writeFileSync(credFile, JSON.stringify({ client_id: "cid_1", client_secret: "csec_1" }), { mode: 0o600 });
    const { exec } = createHarness();

    const login = await exec(
      ["auth", "login", "--app", "--client-credentials-file", credFile, "--storage", "file", "--json", "--non-interactive"],
      { cwd: folder },
    );
    expect(login.code).toBe(0);
    expect(JSON.parse(login.stdout).data.account.isApp).toBe(true);

    const rev = await exec(["auth", "revoke", "--json", "--non-interactive"], { cwd: folder });
    expect(rev.code).toBe(0);
    expect(JSON.parse(rev.stdout).data.revokedAtLinear).toBe(true);
  });
});
