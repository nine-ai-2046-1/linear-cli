import type { AuthBinding } from "./types.js";
export declare function resolveCanonicalCwd(cwd: string): string;
export declare function computeFolderHash(canonicalFolder: string): string;
export declare function getLinearDir(canonicalFolder: string): string;
export declare function getAuthFilePath(canonicalFolder: string): string;
export declare function ensureLinearDirSecure(canonicalFolder: string): string;
export declare function readAuthBinding(cwd: string): {
    canonicalFolder: string;
    authFile: string;
    binding: AuthBinding | null;
};
export declare function writeAuthBinding(cwd: string, binding: AuthBinding): string;
export declare function removeAuthBindingFiles(cwd: string): void;
export declare function withFolderRefreshLock<T>(cwd: string, fn: () => Promise<T>, options?: {
    staleMs?: number;
    waitTimeoutMs?: number;
}): Promise<T>;
