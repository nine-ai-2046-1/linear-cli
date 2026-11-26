import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CliError } from "../core/errors.js";
import { ensureLinearDirSecure, resolveCanonicalCwd } from "./store.js";
import type { SecretStorageMode, SecretStore, StoredSecretPayload } from "./types.js";

const KEYCHAIN_SERVICE = "ai.nineai.linear-cli";

function encodeSecretPayload(payload: StoredSecretPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeSecretPayload(encoded: string): StoredSecretPayload {
  const json = Buffer.from(encoded.trim(), "base64url").toString("utf8");
  return JSON.parse(json) as StoredSecretPayload;
}

export class MacosKeychainSecretStore implements SecretStore {
  public readonly mode: SecretStorageMode = "keychain";
  private readonly serviceName: string;

  constructor(serviceName: string = KEYCHAIN_SERVICE) {
    this.serviceName = serviceName;
  }

  public async get(secretKey: string): Promise<StoredSecretPayload | null> {
    if (process.platform !== "darwin") {
      throw new CliError(
        "AUTH_REQUIRED",
        "OS Keychain backend requires macOS. Re-login with '--storage file' on this platform.",
      );
    }
    const res = spawnSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", this.serviceName, "-a", secretKey, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (res.status !== 0) {
      return null;
    }
    try {
      return decodeSecretPayload(res.stdout);
    } catch (cause) {
      throw new CliError("AUTH_REQUIRED", "Stored Keychain credential could not be decoded.", { cause });
    }
  }

  public async set(secretKey: string, _folderPath: string, payload: StoredSecretPayload): Promise<void> {
    if (process.platform !== "darwin") {
      throw new CliError(
        "VALIDATION_ERROR",
        "OS Keychain backend requires macOS. Pass '--storage file' to store credentials in a 0600 folder-local file.",
      );
    }
    const encoded = encodeSecretPayload(payload);
    const res = spawnSync(
      "/usr/bin/security",
      ["add-generic-password", "-U", "-s", this.serviceName, "-a", secretKey, "-w", encoded],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (res.status !== 0) {
      throw new CliError(
        "INTERNAL_ERROR",
        "Failed to store credential in macOS Keychain. You can pass '--storage file' if Keychain is locked.",
      );
    }
  }

  public async delete(secretKey: string): Promise<void> {
    if (process.platform !== "darwin") return;
    spawnSync(
      "/usr/bin/security",
      ["delete-generic-password", "-s", this.serviceName, "-a", secretKey],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  }
}

export class FileSecretStore implements SecretStore {
  public readonly mode: SecretStorageMode = "file";

  private getCredentialsPath(folderPath: string): string {
    const canonical = resolveCanonicalCwd(folderPath);
    const dir = ensureLinearDirSecure(canonical);
    return path.join(dir, "credentials.json");
  }

  private readMap(filePath: string): Record<string, string> {
    if (!fs.existsSync(filePath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, string>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeMap(filePath: string, map: Record<string, string>): void {
    const entries = Object.keys(map);
    if (entries.length === 0) {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
      }
      return;
    }
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(map, null, 2)}\n`, { mode: 0o600 });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch {
      // ignore if unsupported
    }
    fs.renameSync(tmp, filePath);
  }

  public async get(secretKey: string, folderPath: string): Promise<StoredSecretPayload | null> {
    const filePath = path.join(resolveCanonicalCwd(folderPath), ".linear", "credentials.json");
    if (!fs.existsSync(filePath)) return null;
    const map = this.readMap(filePath);
    const encoded = map[secretKey];
    if (!encoded) return null;
    try {
      return decodeSecretPayload(encoded);
    } catch (cause) {
      throw new CliError("AUTH_REQUIRED", "Stored file credential could not be decoded.", { cause });
    }
  }

  public async set(secretKey: string, folderPath: string, payload: StoredSecretPayload): Promise<void> {
    const filePath = this.getCredentialsPath(folderPath);
    const map = this.readMap(filePath);
    map[secretKey] = encodeSecretPayload(payload);
    this.writeMap(filePath, map);
  }

  public async delete(secretKey: string, folderPath: string): Promise<void> {
    const filePath = path.join(resolveCanonicalCwd(folderPath), ".linear", "credentials.json");
    if (!fs.existsSync(filePath)) return;
    const map = this.readMap(filePath);
    delete map[secretKey];
    this.writeMap(filePath, map);
  }
}

export class MemorySecretStore implements SecretStore {
  public readonly mode: SecretStorageMode;
  private readonly store = new Map<string, StoredSecretPayload>();

  constructor(mode: SecretStorageMode = "keychain") {
    this.mode = mode;
  }

  public async get(secretKey: string, folderPath: string): Promise<StoredSecretPayload | null> {
    return this.store.get(`${folderPath}::${secretKey}`) ?? null;
  }

  public async set(secretKey: string, folderPath: string, payload: StoredSecretPayload): Promise<void> {
    this.store.set(`${folderPath}::${secretKey}`, structuredClone(payload));
  }

  public async delete(secretKey: string, folderPath: string): Promise<void> {
    this.store.delete(`${folderPath}::${secretKey}`);
  }
}

export interface SecretStoreRegistry {
  getStore(mode: SecretStorageMode): SecretStore;
}

export function createDefaultSecretStoreRegistry(): SecretStoreRegistry {
  const keychain = new MacosKeychainSecretStore();
  const file = new FileSecretStore();
  return {
    getStore(mode: SecretStorageMode): SecretStore {
      return mode === "file" ? file : keychain;
    },
  };
}
