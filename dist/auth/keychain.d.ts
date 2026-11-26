import type { SecretStorageMode, SecretStore, StoredSecretPayload } from "./types.js";
export declare class MacosKeychainSecretStore implements SecretStore {
    readonly mode: SecretStorageMode;
    private readonly serviceName;
    constructor(serviceName?: string);
    get(secretKey: string): Promise<StoredSecretPayload | null>;
    set(secretKey: string, _folderPath: string, payload: StoredSecretPayload): Promise<void>;
    delete(secretKey: string): Promise<void>;
}
export declare class FileSecretStore implements SecretStore {
    readonly mode: SecretStorageMode;
    private getCredentialsPath;
    private readMap;
    private writeMap;
    get(secretKey: string, folderPath: string): Promise<StoredSecretPayload | null>;
    set(secretKey: string, folderPath: string, payload: StoredSecretPayload): Promise<void>;
    delete(secretKey: string, folderPath: string): Promise<void>;
}
export declare class MemorySecretStore implements SecretStore {
    readonly mode: SecretStorageMode;
    private readonly store;
    constructor(mode?: SecretStorageMode);
    get(secretKey: string, folderPath: string): Promise<StoredSecretPayload | null>;
    set(secretKey: string, folderPath: string, payload: StoredSecretPayload): Promise<void>;
    delete(secretKey: string, folderPath: string): Promise<void>;
}
export interface SecretStoreRegistry {
    getStore(mode: SecretStorageMode): SecretStore;
}
export declare function createDefaultSecretStoreRegistry(): SecretStoreRegistry;
