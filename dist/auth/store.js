import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CliError } from "../core/errors.js";
export function resolveCanonicalCwd(cwd) {
    let stat;
    try {
        stat = fs.statSync(cwd);
    }
    catch (cause) {
        throw new CliError("VALIDATION_ERROR", `Working directory does not exist: ${cwd}`, { cause });
    }
    if (!stat.isDirectory()) {
        throw new CliError("VALIDATION_ERROR", `Working directory path is not a directory: ${cwd}`);
    }
    return fs.realpathSync(cwd);
}
export function computeFolderHash(canonicalFolder) {
    return crypto.createHash("sha256").update(canonicalFolder).digest("hex").slice(0, 16);
}
export function getLinearDir(canonicalFolder) {
    return path.join(canonicalFolder, ".linear");
}
export function getAuthFilePath(canonicalFolder) {
    return path.join(getLinearDir(canonicalFolder), "auth.json");
}
export function ensureLinearDirSecure(canonicalFolder) {
    const dir = getLinearDir(canonicalFolder);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
        fs.chmodSync(dir, 0o700);
    }
    catch {
        // Ignore on filesystems that do not support POSIX permissions
    }
    const gitignorePath = path.join(dir, ".gitignore");
    if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, "*\n", { mode: 0o600 });
    }
    return dir;
}
export function readAuthBinding(cwd) {
    const canonicalFolder = resolveCanonicalCwd(cwd);
    // Strictly read `<canonicalFolder>/.linear/auth.json` without parent traversal.
    const authFile = getAuthFilePath(canonicalFolder);
    if (!fs.existsSync(authFile)) {
        return { canonicalFolder, authFile, binding: null };
    }
    let raw;
    try {
        raw = fs.readFileSync(authFile, "utf8");
    }
    catch (cause) {
        throw new CliError("AUTH_REQUIRED", `Unable to read folder auth file at ${authFile}`, { cause });
    }
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 1 || !parsed.secretKey || !parsed.authType) {
            throw new Error("Malformed auth binding schema");
        }
        return { canonicalFolder, authFile, binding: parsed };
    }
    catch (cause) {
        throw new CliError("AUTH_REQUIRED", `Corrupted folder auth file at ${authFile}. Run 'linear auth reauth' or 'linear auth logout'.`, { cause });
    }
}
export function writeAuthBinding(cwd, binding) {
    const canonicalFolder = resolveCanonicalCwd(cwd);
    const dir = ensureLinearDirSecure(canonicalFolder);
    const authFile = path.join(dir, "auth.json");
    const tmpFile = `${authFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
    try {
        fs.chmodSync(tmpFile, 0o600);
    }
    catch {
        // Ignore if unsupported
    }
    fs.renameSync(tmpFile, authFile);
    return authFile;
}
export function removeAuthBindingFiles(cwd) {
    const canonicalFolder = resolveCanonicalCwd(cwd);
    const dir = getLinearDir(canonicalFolder);
    for (const name of ["auth.json", "credentials.json", "refresh.lock"]) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) {
            fs.rmSync(p, { force: true });
        }
    }
}
export async function withFolderRefreshLock(cwd, fn, options) {
    const canonicalFolder = resolveCanonicalCwd(cwd);
    const dir = ensureLinearDirSecure(canonicalFolder);
    const lockPath = path.join(dir, "refresh.lock");
    const staleMs = options?.staleMs ?? 30_000;
    const waitTimeoutMs = options?.waitTimeoutMs ?? 10_000;
    const deadline = Date.now() + waitTimeoutMs;
    let fd = null;
    while (fd === null) {
        try {
            fd = fs.openSync(lockPath, "wx", 0o600);
            fs.writeFileSync(fd, `${process.pid}:${Date.now()}`);
        }
        catch (err) {
            const code = err.code;
            if (code !== "EEXIST") {
                throw err;
            }
            try {
                const st = fs.statSync(lockPath);
                if (Date.now() - st.mtimeMs > staleMs) {
                    fs.rmSync(lockPath, { force: true });
                    continue;
                }
            }
            catch {
                continue;
            }
            if (Date.now() >= deadline) {
                throw new CliError("AUTH_REQUIRED", "Timed out waiting for folder token refresh lock.");
            }
            await new Promise((r) => setTimeout(r, 40));
        }
    }
    try {
        return await fn();
    }
    finally {
        try {
            fs.closeSync(fd);
        }
        catch {
            // ignore
        }
        try {
            fs.rmSync(lockPath, { force: true });
        }
        catch {
            // ignore
        }
    }
}
//# sourceMappingURL=store.js.map