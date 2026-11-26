export type AuthType = "oauth" | "api-key" | "app";
export type SecretStorageMode = "keychain" | "file";
export interface BoundAccountInfo {
    id: string;
    name: string;
    displayName: string;
    email: string | null;
    isApp: boolean;
}
export interface BoundWorkspaceInfo {
    id: string;
    name: string;
    urlKey: string;
    url: string;
}
export interface AuthBinding {
    version: 1;
    authType: AuthType;
    storage: SecretStorageMode;
    bindingId: string;
    folderHash: string;
    secretKey: string;
    account: BoundAccountInfo;
    workspace: BoundWorkspaceInfo;
    oauth?: {
        clientId: string;
        scopes: string[];
        expiresAt?: string;
    };
    createdAt: string;
    updatedAt: string;
}
export type StoredSecretPayload = {
    kind: "api-key";
    apiKey: string;
} | {
    kind: "oauth";
    accessToken: string;
    refreshToken?: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
    expiresAt?: string;
} | {
    kind: "app";
    accessToken: string;
    clientId: string;
    clientSecret: string;
    scopes: string[];
    expiresAt?: string;
};
export interface SecretStore {
    readonly mode: SecretStorageMode;
    get(secretKey: string, folderPath: string): Promise<StoredSecretPayload | null>;
    set(secretKey: string, folderPath: string, payload: StoredSecretPayload): Promise<void>;
    delete(secretKey: string, folderPath: string): Promise<void>;
}
