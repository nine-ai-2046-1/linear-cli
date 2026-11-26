export declare const LINEAR_OAUTH_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
export declare const LINEAR_OAUTH_TOKEN_URL = "https://api.linear.app/oauth/token";
export declare const LINEAR_OAUTH_REVOKE_URL = "https://api.linear.app/oauth/revoke";
export type FetchLike = typeof fetch;
export interface PkcePair {
    codeVerifier: string;
    codeChallenge: string;
    state: string;
}
export declare function generatePkcePair(): PkcePair;
export declare function parseScopes(rawScopes: string | string[] | undefined): string[];
export declare function buildAuthorizeUrl(params: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state: string;
    codeChallenge: string;
    actor?: "user" | "app";
    promptConsent?: boolean;
}): string;
export interface TokenEndpointResponse {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: string;
    scopes: string[];
}
export declare function exchangeAuthorizationCode(params: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret?: string;
    codeVerifier: string;
    scopes: string[];
    fetchImpl?: FetchLike;
}): Promise<TokenEndpointResponse>;
export declare function refreshOAuthAccessToken(params: {
    refreshToken: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
    fetchImpl?: FetchLike;
}): Promise<TokenEndpointResponse>;
export declare function exchangeClientCredentials(params: {
    clientId: string;
    clientSecret: string;
    scopes: string[];
    fetchImpl?: FetchLike;
}): Promise<TokenEndpointResponse>;
export declare function revokeLinearOAuthToken(params: {
    token: string;
    tokenTypeHint?: "access_token" | "refresh_token";
    fetchImpl?: FetchLike;
}): Promise<{
    revoked: boolean;
    status: number;
}>;
export interface LoopbackCallbackResult {
    redirectUri: string;
    waitForCallback: () => Promise<{
        code: string;
    }>;
    close: () => Promise<void>;
}
export declare function startOAuthLoopbackServer(options: {
    expectedState: string;
    port?: number;
    callbackPath?: string;
    timeoutMs?: number;
}): Promise<LoopbackCallbackResult>;
