import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LinearClient } from "@linear/sdk";
import { MemorySecretStore } from "../../src/auth/keychain.js";
import type { FetchLike } from "../../src/auth/oauth.js";
import { writeAuthBinding, computeFolderHash } from "../../src/auth/store.js";
import { runCli } from "../../src/cli/app.js";

export async function createAuthenticatedTestHarness(
  mockClient: Partial<LinearClient>,
  options?: { fetchImpl?: FetchLike },
) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "linear-cli-test-"));
  const canonicalFolder = fs.realpathSync(folder);
  const mem = new MemorySecretStore("keychain");
  const folderHash = computeFolderHash(canonicalFolder);
  const secretKey = `${folderHash}:test-binding`;

  await mem.set(secretKey, canonicalFolder, {
    kind: "api-key",
    apiKey: "lin_api_test_secret_12345678",
  });

  writeAuthBinding(canonicalFolder, {
    version: 1,
    authType: "api-key",
    storage: "keychain",
    bindingId: "test-binding",
    folderHash,
    secretKey,
    account: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Raymond Magic",
      displayName: "raymond",
      email: "raymond@nineai.dev",
      isApp: false,
    },
    workspace: {
      id: "00000000-0000-4000-8000-000000000099",
      name: "NineAI",
      urlKey: "nineai",
      url: "https://linear.app/nineai",
    },
    createdAt: "2026-11-25T00:00:00.000Z",
    updatedAt: "2026-11-25T00:00:00.000Z",
  });

  async function exec(argv: string[], stdinText?: string) {
    let stdout = "";
    let stderr = "";
    const code = await runCli(argv, {
      cwd: canonicalFolder,
      stdinText,
      isTTY: false,
      stdout: { write: (s) => { stdout += s; } },
      stderr: { write: (s) => { stderr += s; } },
      stores: { getStore: () => mem },
      sdkFactory: () => mockClient as LinearClient,
      fetchImpl: options?.fetchImpl,
      sleepFn: async () => {},
    });
    return { code, stdout, stderr };
  }

  function cleanup() {
    fs.rmSync(canonicalFolder, { recursive: true, force: true });
  }

  return { folder: canonicalFolder, exec, cleanup };
}
