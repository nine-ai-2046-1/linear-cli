import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LinearClient } from "@linear/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { FileSecretStore, MemorySecretStore, type SecretStoreRegistry } from "../../src/auth/keychain.js";
import { AuthService } from "../../src/auth/service.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `linear-cli-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()!;
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function createMockRegistry(): {
  registry: SecretStoreRegistry;
  memoryStore: MemorySecretStore;
  fileStore: FileSecretStore;
} {
  const memoryStore = new MemorySecretStore("keychain");
  const fileStore = new FileSecretStore();
  return {
    memoryStore,
    fileStore,
    registry: {
      getStore(mode) {
        return mode === "file" ? fileStore : memoryStore;
      },
    },
  };
}

function createFakeSdkFactory(identities: Record<string, { id: string; name: string; email: string; orgId: string; orgName: string; urlKey: string }>) {
  return (auth: { apiKey?: string; accessToken?: string }): LinearClient => {
    const token = auth.apiKey ?? auth.accessToken ?? "";
    const identity = identities[token];
    if (!identity) {
      const err = new Error("Authentication required") as Error & { status?: number };
      err.status = 401;
      return {
        get viewer() {
          return Promise.reject(err);
        },
        get organization() {
          return Promise.reject(err);
        },
      } as unknown as LinearClient;
    }
    return {
      viewer: Promise.resolve({
        id: identity.id,
        name: identity.name,
        displayName: identity.name,
        email: identity.email,
      }),
      organization: Promise.resolve({
        id: identity.orgId,
        name: identity.orgName,
        urlKey: identity.urlKey,
      }),
    } as unknown as LinearClient;
  };
}

describe("Section 1 Per-Folder Auth Store & OAuth/API-Key/App Lifecycle", () => {
  it("isolates authentication between two folders and never traverses parent directories", async () => {
    const folderA = makeTempDir("folder-a");
    const folderB = makeTempDir("folder-b");
    const childOfA = path.join(folderA, "nested-subproject");
    fs.mkdirSync(childOfA, { recursive: true });

    const { registry } = createMockRegistry();
    const service = new AuthService({
      stores: registry,
      sdkFactory: createFakeSdkFactory({
        lin_api_userA_key_123456: {
          id: "u-a",
          name: "Alice",
          email: "alice@example.com",
          orgId: "org-a",
          orgName: "Org A",
          urlKey: "org-a",
        },
        lin_api_userB_key_654321: {
          id: "u-b",
          name: "Bob",
          email: "bob@example.com",
          orgId: "org-b",
          orgName: "Org B",
          urlKey: "org-b",
        },
      }),
    });

    await service.loginWithApiKey({ cwd: folderA, apiKey: "lin_api_userA_key_123456", storage: "keychain" });
    await service.loginWithApiKey({ cwd: folderB, apiKey: "lin_api_userB_key_654321", storage: "file" });

    // Default keychain mode must NOT store raw key inside auth.json
    const rawAuthJsonA = fs.readFileSync(path.join(folderA, ".linear", "auth.json"), "utf8");
    expect(rawAuthJsonA).not.toContain("lin_api_userA_key_123456");

    // File storage mode sets 0600 on credentials.json and writes .gitignore
    const credStatB = fs.statSync(path.join(folderB, ".linear", "credentials.json"));
    expect(credStatB.mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(path.join(folderB, ".linear", ".gitignore"), "utf8")).toContain("*");

    // Separate identities in folderA vs folderB
    const whoA = await service.whoami(folderA);
    const whoB = await service.whoami(folderB);
    expect(whoA.account.email).toBe("alice@example.com");
    expect(whoB.account.email).toBe("bob@example.com");

    // Child directory MUST NOT inherit parent folderA auth
    const childStatus = await service.getStatus(childOfA);
    expect(childStatus.authenticated).toBe(false);
    await expect(service.whoami(childOfA)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });

    // Logout in folderA leaves folderB intact
    await service.logout(folderA);
    expect((await service.getStatus(folderA)).authenticated).toBe(false);
    expect((await service.whoami(folderB)).account.email).toBe("bob@example.com");
  });

  it("completes OAuth PKCE loopback login, refreshes expired rotating tokens, and revokes on linear auth revoke", async () => {
    const folder = makeTempDir("oauth-folder");
    const { registry, fileStore } = createMockRegistry();
    const fetchCalls: Array<{ url: string; body: string }> = [];

    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = String(init?.body ?? "");
      fetchCalls.push({ url, body });

      if (url.endsWith("/oauth/token") && body.includes("grant_type=authorization_code")) {
        return new Response(
          JSON.stringify({
            access_token: "oauth_tok_initial_1234567890",
            refresh_token: "refresh_tok_1",
            expires_in: 10, // within 120s buffer so next call triggers refresh!
            scope: "read write",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/oauth/token") && body.includes("grant_type=refresh_token")) {
        return new Response(
          JSON.stringify({
            access_token: "oauth_tok_refreshed_0987654321",
            refresh_token: "refresh_tok_2",
            expires_in: 86400,
            scope: "read write",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.endsWith("/oauth/revoke")) {
        return new Response("", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const service = new AuthService({
      stores: registry,
      fetchImpl: mockFetch,
      sdkFactory: createFakeSdkFactory({
        oauth_tok_initial_1234567890: {
          id: "u-oauth",
          name: "Raymond Magic",
          email: "raymond@example.com",
          orgId: "org-1",
          orgName: "NineAI",
          urlKey: "nineai",
        },
        oauth_tok_refreshed_0987654321: {
          id: "u-oauth",
          name: "Raymond Magic",
          email: "raymond@example.com",
          orgId: "org-1",
          orgName: "NineAI",
          urlKey: "nineai",
        },
      }),
      openBrowser: async (authorizeUrl) => {
        const parsed = new URL(authorizeUrl);
        const redirectUri = parsed.searchParams.get("redirect_uri")!;
        const state = parsed.searchParams.get("state")!;
        const cb = new URL(redirectUri);
        cb.searchParams.set("code", "auth_code_xyz");
        cb.searchParams.set("state", state);
        await fetch(cb.toString());
      },
    });

    const binding = await service.loginWithOAuthPkce({
      cwd: folder,
      clientId: "client_123",
      storage: "file",
    });
    expect(binding.account.email).toBe("raymond@example.com");

    // Calling whoami sees expires_in=10 (< 120s buffer), refreshes token automatically, and rotates refresh_token!
    const who = await service.whoami(folder);
    expect(who.account.name).toBe("Raymond Magic");
    expect(fetchCalls.some((c) => c.body.includes("grant_type=refresh_token"))).toBe(true);

    const saved = await fileStore.get(binding.secretKey, fs.realpathSync(folder));
    expect(saved).toMatchObject({
      kind: "oauth",
      accessToken: "oauth_tok_refreshed_0987654321",
      refreshToken: "refresh_tok_2",
    });

    // Revoke calls /oauth/revoke with rotated refresh_token and cleans local files
    const revoked = await service.revoke(folder);
    expect(revoked.revokedAtLinear).toBe(true);
    expect(fetchCalls.some((c) => c.url.endsWith("/oauth/revoke") && c.body.includes("refresh_tok_2"))).toBe(true);
    expect((await service.getStatus(folder)).authenticated).toBe(false);
  });

  it("supports --app OAuth client_credentials login and automatic renewal", async () => {
    const folder = makeTempDir("app-folder");
    const { registry } = createMockRegistry();
    let tokenCount = 0;

    const service = new AuthService({
      stores: registry,
      fetchImpl: async (input) => {
        if (String(input).endsWith("/oauth/token")) {
          tokenCount += 1;
          return new Response(
            JSON.stringify({
              access_token: `app_token_${tokenCount}`,
              expires_in: tokenCount === 1 ? 5 : 2592000,
              scope: "read,write",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("err", { status: 400 });
      },
      sdkFactory: createFakeSdkFactory({
        app_token_1: {
          id: "app-1",
          name: "Local Agent",
          email: "app@oauthapp.linear.app",
          orgId: "org-1",
          orgName: "NineAI",
          urlKey: "nineai",
        },
        app_token_2: {
          id: "app-1",
          name: "Local Agent",
          email: "app@oauthapp.linear.app",
          orgId: "org-1",
          orgName: "NineAI",
          urlKey: "nineai",
        },
      }),
    });

    const b = await service.loginWithAppCredentials({
      cwd: folder,
      clientId: "cid",
      clientSecret: "csecret",
      storage: "keychain",
    });
    expect(b.account.isApp).toBe(true);

    // Since token_1 had expires_in=5 (<120s), whoami renews via client_credentials automatically
    const who = await service.whoami(folder);
    expect(who.authType).toBe("app");
    expect(tokenCount).toBe(2);
  });
});
