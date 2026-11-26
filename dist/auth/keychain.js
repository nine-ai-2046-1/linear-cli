import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CliError } from "../core/errors.js";
import { ensureLinearDirSecure, resolveCanonicalCwd } from "./store.js";
const KEYCHAIN_SERVICE = "ai.nineai.linear-cli";
function encodeSecretPayload(payload) {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
function decodeSecretPayload(encoded) {
    const json = Buffer.from(encoded.trim(), "base64url").toString("utf8");
    return JSON.parse(json);
}
export class MacosKeychainSecretStore {
    mode = "keychain";
    serviceName;
    constructor(serviceName = KEYCHAIN_SERVICE) {
        this.serviceName = serviceName;
    }
    async get(secretKey) {
        if (process.platform !== "darwin") {
            throw new CliError("AUTH_REQUIRED", "OS Keychain backend requires macOS. Re-login with '--storage file' on this platform.");
        }
        const res = spawnSync("/usr/bin/security", ["find-generic-password", "-s", this.serviceName, "-a", secretKey, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        if (res.status !== 0) {
            return null;
        }
        try {
            return decodeSecretPayload(res.stdout);
        }
        catch (cause) {
            throw new CliError("AUTH_REQUIRED", "Stored Keychain credential could not be decoded.", { cause });
        }
    }
    async set(secretKey, _folderPath, payload) {
        if (process.platform !== "darwin") {
            throw new CliError("VALIDATION_ERROR", "OS Keychain backend requires macOS. Pass '--storage file' to store credentials in a 0600 folder-local file.");
        }
        const encoded = encodeSecretPayload(payload);
        const res = spawnSync("/usr/bin/security", ["add-generic-password", "-U", "-s", this.serviceName, "-a", secretKey, "-w", encoded], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        if (res.status !== 0) {
            throw new CliError("INTERNAL_ERROR", "Failed to store credential in macOS Keychain. You can pass '--storage file' if Keychain is locked.");
        }
    }
    async delete(secretKey) {
        if (process.platform !== "darwin")
            return;
        spawnSync("/usr/bin/security", ["delete-generic-password", "-s", this.serviceName, "-a", secretKey], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    }
}
export class FileSecretStore {
    mode = "file";
    getCredentialsPath(folderPath) {
        const canonical = resolveCanonicalCwd(folderPath);
        const dir = ensureLinearDirSecure(canonical);
        return path.join(dir, "credentials.json");
    }
    readMap(filePath) {
        if (!fs.existsSync(filePath))
            return {};
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
            return parsed && typeof parsed === "object" ? parsed : {};
        }
        catch {
            return {};
        }
    }
    writeMap(filePath, map) {
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
        }
        catch {
            // ignore if unsupported
        }
        fs.renameSync(tmp, filePath);
    }
    async get(secretKey, folderPath) {
        const filePath = path.join(resolveCanonicalCwd(folderPath), ".linear", "credentials.json");
        if (!fs.existsSync(filePath))
            return null;
        const map = this.readMap(filePath);
        const encoded = map[secretKey];
        if (!encoded)
            return null;
        try {
            return decodeSecretPayload(encoded);
        }
        catch (cause) {
            throw new CliError("AUTH_REQUIRED", "Stored file credential could not be decoded.", { cause });
        }
    }
    async set(secretKey, folderPath, payload) {
        const filePath = this.getCredentialsPath(folderPath);
        const map = this.readMap(filePath);
        map[secretKey] = encodeSecretPayload(payload);
        this.writeMap(filePath, map);
    }
    async delete(secretKey, folderPath) {
        const filePath = path.join(resolveCanonicalCwd(folderPath), ".linear", "credentials.json");
        if (!fs.existsSync(filePath))
            return;
        const map = this.readMap(filePath);
        delete map[secretKey];
        this.writeMap(filePath, map);
    }
}
export class MemorySecretStore {
    mode;
    store = new Map();
    constructor(mode = "keychain") {
        this.mode = mode;
    }
    async get(secretKey, folderPath) {
        return this.store.get(`${folderPath}::${secretKey}`) ?? null;
    }
    async set(secretKey, folderPath, payload) {
        this.store.set(`${folderPath}::${secretKey}`, structuredClone(payload));
    }
    async delete(secretKey, folderPath) {
        this.store.delete(`${folderPath}::${secretKey}`);
    }
}
export function createDefaultSecretStoreRegistry() {
    const keychain = new MacosKeychainSecretStore();
    const file = new FileSecretStore();
    return {
        getStore(mode) {
            return mode === "file" ? file : keychain;
        },
    };
}
//# sourceMappingURL=keychain.js.map