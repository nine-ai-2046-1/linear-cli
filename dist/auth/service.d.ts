import { LinearClient } from "@linear/sdk";
import type { SecretStoreRegistry } from "./keychain.js";
import { type FetchLike } from "./oauth.js";
import type { AuthBinding, BoundAccountInfo, BoundWorkspaceInfo, SecretStorageMode } from "./types.js";
export type SdkFactory = (auth: {
    apiKey?: string;
    accessToken?: string;
}) => LinearClient;
export declare const defaultSdkFactory: SdkFactory;
export declare function isExpiringSoon(expiresAt?: string): boolean;
export declare function inspectIdentityWithClient(client: LinearClient): Promise<{
    account: BoundAccountInfo;
    workspace: BoundWorkspaceInfo;
}>;
export declare class AuthService {
    private readonly stores;
    private readonly sdkFactory;
    private readonly fetchImpl;
    private readonly openBrowser?;
    constructor(deps: {
        stores: SecretStoreRegistry;
        sdkFactory?: SdkFactory;
        fetchImpl?: FetchLike;
        openBrowser?: (url: string) => Promise<void> | void;
    });
    private replaceBindingAndSecret;
    loginWithApiKey(params: {
        cwd: string;
        apiKey: string;
        storage: SecretStorageMode;
        validateBeforeSave?: (identity: {
            account: BoundAccountInfo;
            workspace: BoundWorkspaceInfo;
        }) => void;
    }): Promise<AuthBinding>;
    loginWithAppCredentials(params: {
        cwd: string;
        clientId: string;
        clientSecret: string;
        scopes?: string | string[];
        storage: SecretStorageMode;
        validateBeforeSave?: (identity: {
            account: BoundAccountInfo;
            workspace: BoundWorkspaceInfo;
        }) => void;
    }): Promise<AuthBinding>;
    loginWithOAuthPkce(params: {
        cwd: string;
        clientId: string;
        clientSecret?: string;
        scopes?: string | string[];
        port?: number;
        actor?: "user" | "app";
        storage: SecretStorageMode;
        timeoutMs?: number;
        onAuthorizeUrl?: (url: string, redirectUri: string) => void;
        validateBeforeSave?: (identity: {
            account: BoundAccountInfo;
            workspace: BoundWorkspaceInfo;
        }) => void;
    }): Promise<AuthBinding>;
    getStatus(cwd: string): Promise<{
        authenticated: boolean;
        folder: string;
        authFile: string;
        credentialPresent: boolean;
        binding: AuthBinding | null;
    }>;
    getActiveClient(cwd: string, options?: {
        forceRefresh?: boolean;
    }): Promise<{
        client: LinearClient;
        binding: AuthBinding;
        canonicalFolder: string;
    }>;
    getAuthorizationHeader(cwd: string): Promise<string>;
    whoami(cwd: string): Promise<{
        folder: string;
        authType: AuthBinding["authType"];
        storage: SecretStorageMode;
        account: BoundAccountInfo;
        workspace: BoundWorkspaceInfo;
    }>;
    logout(cwd: string): Promise<{
        folder: string;
        loggedOut: boolean;
        previousAccount?: string;
    }>;
    revoke(cwd: string): Promise<{
        folder: string;
        revokedAtLinear: boolean;
        loggedOut: boolean;
    }>;
}
