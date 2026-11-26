import crypto from "node:crypto";
import { LinearClient } from "@linear/sdk";
import { CliError } from "../core/errors.js";
import { buildAuthorizeUrl, exchangeAuthorizationCode, exchangeClientCredentials, generatePkcePair, parseScopes, refreshOAuthAccessToken, revokeLinearOAuthToken, startOAuthLoopbackServer, } from "./oauth.js";
import { computeFolderHash, readAuthBinding, removeAuthBindingFiles, resolveCanonicalCwd, withFolderRefreshLock, writeAuthBinding, } from "./store.js";
export const defaultSdkFactory = (auth) => auth.apiKey ? new LinearClient({ apiKey: auth.apiKey }) : new LinearClient({ accessToken: auth.accessToken });
const EXPIRY_BUFFER_MS = 120_000;
export function isExpiringSoon(expiresAt) {
    if (!expiresAt)
        return false;
    const ts = Date.parse(expiresAt);
    if (!Number.isFinite(ts))
        return false;
    return ts - Date.now() <= EXPIRY_BUFFER_MS;
}
export async function inspectIdentityWithClient(client) {
    const [viewer, org] = await Promise.all([client.viewer, client.organization]);
    const rawViewer = viewer;
    const rawOrg = org;
    const email = rawViewer.email ?? null;
    const isApp = Boolean(rawViewer.app) || Boolean(email && email.endsWith("@oauthapp.linear.app"));
    return {
        account: {
            id: rawViewer.id,
            name: rawViewer.name,
            displayName: rawViewer.displayName ?? rawViewer.name,
            email,
            isApp,
        },
        workspace: {
            id: rawOrg.id,
            name: rawOrg.name,
            urlKey: rawOrg.urlKey,
            url: `https://linear.app/${rawOrg.urlKey}`,
        },
    };
}
export class AuthService {
    stores;
    sdkFactory;
    fetchImpl;
    openBrowser;
    constructor(deps) {
        this.stores = deps.stores;
        this.sdkFactory = deps.sdkFactory ?? defaultSdkFactory;
        this.fetchImpl = deps.fetchImpl ?? fetch;
        this.openBrowser = deps.openBrowser;
    }
    async replaceBindingAndSecret(params) {
        const { canonicalFolder, binding: previous } = readAuthBinding(params.cwd);
        if (previous) {
            await this.stores.getStore(previous.storage).delete(previous.secretKey, canonicalFolder);
        }
        const bindingId = crypto.randomUUID();
        const folderHash = computeFolderHash(canonicalFolder);
        const secretKey = `${folderHash}:${bindingId}`;
        const now = new Date().toISOString();
        const nextBinding = {
            version: 1,
            authType: params.authType,
            storage: params.storage,
            bindingId,
            folderHash,
            secretKey,
            account: params.account,
            workspace: params.workspace,
            ...(params.oauthMeta ? { oauth: params.oauthMeta } : {}),
            createdAt: previous?.createdAt ?? now,
            updatedAt: now,
        };
        await this.stores.getStore(params.storage).set(secretKey, canonicalFolder, params.secretPayload);
        writeAuthBinding(canonicalFolder, nextBinding);
        return nextBinding;
    }
    async loginWithApiKey(params) {
        const trimmed = params.apiKey.trim();
        if (!trimmed) {
            throw new CliError("VALIDATION_ERROR", "API key cannot be empty.");
        }
        const client = this.sdkFactory({ apiKey: trimmed });
        let identity;
        try {
            identity = await inspectIdentityWithClient(client);
        }
        catch (cause) {
            throw new CliError("AUTH_REQUIRED", "Invalid Linear API key or unable to verify identity.", { cause });
        }
        params.validateBeforeSave?.(identity);
        return this.replaceBindingAndSecret({
            cwd: params.cwd,
            storage: params.storage,
            authType: "api-key",
            account: identity.account,
            workspace: identity.workspace,
            secretPayload: { kind: "api-key", apiKey: trimmed },
        });
    }
    async loginWithAppCredentials(params) {
        const clientId = params.clientId.trim();
        const clientSecret = params.clientSecret.trim();
        if (!clientId || !clientSecret) {
            throw new CliError("VALIDATION_ERROR", "Both client ID and client secret are required for --app login.");
        }
        const scopes = parseScopes(params.scopes);
        const tokenRes = await exchangeClientCredentials({
            clientId,
            clientSecret,
            scopes,
            fetchImpl: this.fetchImpl,
        });
        const client = this.sdkFactory({ accessToken: tokenRes.accessToken });
        const identity = await inspectIdentityWithClient(client);
        params.validateBeforeSave?.(identity);
        return this.replaceBindingAndSecret({
            cwd: params.cwd,
            storage: params.storage,
            authType: "app",
            account: identity.account,
            workspace: identity.workspace,
            oauthMeta: {
                clientId,
                scopes: tokenRes.scopes,
                ...(tokenRes.expiresAt ? { expiresAt: tokenRes.expiresAt } : {}),
            },
            secretPayload: {
                kind: "app",
                accessToken: tokenRes.accessToken,
                clientId,
                clientSecret,
                scopes: tokenRes.scopes,
                expiresAt: tokenRes.expiresAt,
            },
        });
    }
    async loginWithOAuthPkce(params) {
        const clientId = params.clientId.trim();
        if (!clientId) {
            throw new CliError("VALIDATION_ERROR", "OAuth login requires --client-id <id> (with redirect URI http://127.0.0.1:<port>/oauth/callback configured in Linear).");
        }
        const scopes = parseScopes(params.scopes);
        const pkce = generatePkcePair();
        const loopback = await startOAuthLoopbackServer({
            expectedState: pkce.state,
            port: params.port,
            timeoutMs: params.timeoutMs,
        });
        try {
            const authorizeUrl = buildAuthorizeUrl({
                clientId,
                redirectUri: loopback.redirectUri,
                scopes,
                state: pkce.state,
                codeChallenge: pkce.codeChallenge,
                actor: params.actor,
                promptConsent: true,
            });
            params.onAuthorizeUrl?.(authorizeUrl, loopback.redirectUri);
            if (this.openBrowser) {
                await this.openBrowser(authorizeUrl);
            }
            const { code } = await loopback.waitForCallback();
            const tokenRes = await exchangeAuthorizationCode({
                code,
                redirectUri: loopback.redirectUri,
                clientId,
                clientSecret: params.clientSecret?.trim() || undefined,
                codeVerifier: pkce.codeVerifier,
                scopes,
                fetchImpl: this.fetchImpl,
            });
            const client = this.sdkFactory({ accessToken: tokenRes.accessToken });
            const identity = await inspectIdentityWithClient(client);
            params.validateBeforeSave?.(identity);
            return this.replaceBindingAndSecret({
                cwd: params.cwd,
                storage: params.storage,
                authType: "oauth",
                account: identity.account,
                workspace: identity.workspace,
                oauthMeta: {
                    clientId,
                    scopes: tokenRes.scopes,
                    ...(tokenRes.expiresAt ? { expiresAt: tokenRes.expiresAt } : {}),
                },
                secretPayload: {
                    kind: "oauth",
                    accessToken: tokenRes.accessToken,
                    refreshToken: tokenRes.refreshToken,
                    clientId,
                    clientSecret: params.clientSecret?.trim() || undefined,
                    scopes: tokenRes.scopes,
                    expiresAt: tokenRes.expiresAt,
                },
            });
        }
        catch (err) {
            await loopback.close();
            throw err;
        }
    }
    async getStatus(cwd) {
        const { canonicalFolder, authFile, binding } = readAuthBinding(cwd);
        if (!binding) {
            return {
                authenticated: false,
                folder: canonicalFolder,
                authFile,
                credentialPresent: false,
                binding: null,
            };
        }
        const secret = await this.stores.getStore(binding.storage).get(binding.secretKey, canonicalFolder);
        return {
            authenticated: Boolean(secret),
            folder: canonicalFolder,
            authFile,
            credentialPresent: Boolean(secret),
            binding,
        };
    }
    async getActiveClient(cwd, options) {
        const { canonicalFolder, authFile, binding } = readAuthBinding(cwd);
        if (!binding) {
            throw new CliError("AUTH_REQUIRED", `No Linear authentication found in folder '${canonicalFolder}' (expected ${authFile}). Run 'linear auth login' in this folder.`);
        }
        const store = this.stores.getStore(binding.storage);
        let secret = await store.get(binding.secretKey, canonicalFolder);
        if (!secret) {
            throw new CliError("AUTH_REQUIRED", `Authentication binding exists in '${canonicalFolder}', but secret '${binding.secretKey}' is missing from ${binding.storage} storage. Run 'linear auth reauth'.`);
        }
        if (secret.kind === "api-key") {
            return {
                client: this.sdkFactory({ apiKey: secret.apiKey }),
                binding,
                canonicalFolder,
            };
        }
        const needsRefresh = Boolean(options?.forceRefresh) || isExpiringSoon(secret.expiresAt);
        if (needsRefresh) {
            const refreshed = await withFolderRefreshLock(canonicalFolder, async () => {
                const latestBinding = readAuthBinding(canonicalFolder).binding ?? binding;
                const latestSecret = await store.get(latestBinding.secretKey, canonicalFolder);
                if (!latestSecret || latestSecret.kind === "api-key") {
                    throw new CliError("AUTH_REQUIRED", "Stored OAuth credentials missing during refresh.");
                }
                if (!options?.forceRefresh && !isExpiringSoon(latestSecret.expiresAt)) {
                    return { binding: latestBinding, secret: latestSecret };
                }
                if (latestSecret.kind === "oauth") {
                    if (!latestSecret.refreshToken) {
                        throw new CliError("AUTH_REQUIRED", `OAuth access token in '${canonicalFolder}' expired and has no refresh token. Run 'linear auth reauth'.`);
                    }
                    const nextTok = await refreshOAuthAccessToken({
                        refreshToken: latestSecret.refreshToken,
                        clientId: latestSecret.clientId,
                        clientSecret: latestSecret.clientSecret,
                        scopes: latestSecret.scopes,
                        fetchImpl: this.fetchImpl,
                    });
                    const updatedSecret = {
                        ...latestSecret,
                        accessToken: nextTok.accessToken,
                        refreshToken: nextTok.refreshToken ?? latestSecret.refreshToken,
                        scopes: nextTok.scopes,
                        expiresAt: nextTok.expiresAt,
                    };
                    const updatedBinding = {
                        ...latestBinding,
                        oauth: {
                            clientId: latestSecret.clientId,
                            scopes: nextTok.scopes,
                            ...(nextTok.expiresAt ? { expiresAt: nextTok.expiresAt } : {}),
                        },
                        updatedAt: new Date().toISOString(),
                    };
                    await store.set(updatedBinding.secretKey, canonicalFolder, updatedSecret);
                    writeAuthBinding(canonicalFolder, updatedBinding);
                    return { binding: updatedBinding, secret: updatedSecret };
                }
                else {
                    const nextTok = await exchangeClientCredentials({
                        clientId: latestSecret.clientId,
                        clientSecret: latestSecret.clientSecret,
                        scopes: latestSecret.scopes,
                        fetchImpl: this.fetchImpl,
                    });
                    const updatedSecret = {
                        ...latestSecret,
                        accessToken: nextTok.accessToken,
                        scopes: nextTok.scopes,
                        expiresAt: nextTok.expiresAt,
                    };
                    const updatedBinding = {
                        ...latestBinding,
                        oauth: {
                            clientId: latestSecret.clientId,
                            scopes: nextTok.scopes,
                            ...(nextTok.expiresAt ? { expiresAt: nextTok.expiresAt } : {}),
                        },
                        updatedAt: new Date().toISOString(),
                    };
                    await store.set(updatedBinding.secretKey, canonicalFolder, updatedSecret);
                    writeAuthBinding(canonicalFolder, updatedBinding);
                    return { binding: updatedBinding, secret: updatedSecret };
                }
            });
            secret = refreshed.secret;
            return {
                client: this.sdkFactory({ accessToken: secret.accessToken }),
                binding: refreshed.binding,
                canonicalFolder,
            };
        }
        return {
            client: this.sdkFactory({ accessToken: secret.accessToken }),
            binding,
            canonicalFolder,
        };
    }
    async getAuthorizationHeader(cwd) {
        const { canonicalFolder, binding } = readAuthBinding(cwd);
        if (!binding) {
            throw new CliError("AUTH_REQUIRED", `No Linear authentication found in folder '${canonicalFolder}'.`);
        }
        await this.getActiveClient(canonicalFolder);
        const refreshedBinding = readAuthBinding(canonicalFolder).binding ?? binding;
        const secret = await this.stores.getStore(refreshedBinding.storage).get(refreshedBinding.secretKey, canonicalFolder);
        if (!secret) {
            throw new CliError("AUTH_REQUIRED", `Missing stored credential in '${canonicalFolder}'.`);
        }
        return secret.kind === "api-key" ? secret.apiKey : `Bearer ${secret.accessToken}`;
    }
    async whoami(cwd) {
        let active = await this.getActiveClient(cwd);
        try {
            const live = await inspectIdentityWithClient(active.client);
            return {
                folder: active.canonicalFolder,
                authType: active.binding.authType,
                storage: active.binding.storage,
                account: live.account,
                workspace: live.workspace,
            };
        }
        catch (err) {
            const status = err?.status;
            if (status === 401 && active.binding.authType !== "api-key") {
                active = await this.getActiveClient(cwd, { forceRefresh: true });
                const live = await inspectIdentityWithClient(active.client);
                return {
                    folder: active.canonicalFolder,
                    authType: active.binding.authType,
                    storage: active.binding.storage,
                    account: live.account,
                    workspace: live.workspace,
                };
            }
            throw err;
        }
    }
    async logout(cwd) {
        const canonicalFolder = resolveCanonicalCwd(cwd);
        const { binding } = readAuthBinding(canonicalFolder);
        if (!binding) {
            removeAuthBindingFiles(canonicalFolder);
            return { folder: canonicalFolder, loggedOut: false };
        }
        await this.stores.getStore(binding.storage).delete(binding.secretKey, canonicalFolder);
        removeAuthBindingFiles(canonicalFolder);
        return {
            folder: canonicalFolder,
            loggedOut: true,
            previousAccount: binding.account.email ?? binding.account.name,
        };
    }
    async revoke(cwd) {
        const canonicalFolder = resolveCanonicalCwd(cwd);
        const { binding } = readAuthBinding(canonicalFolder);
        if (!binding) {
            throw new CliError("AUTH_REQUIRED", `No Linear authentication found in folder '${canonicalFolder}' to revoke.`);
        }
        const store = this.stores.getStore(binding.storage);
        const secret = await store.get(binding.secretKey, canonicalFolder);
        let revokedAtLinear = false;
        if (secret && (secret.kind === "oauth" || secret.kind === "app")) {
            const tokenToRevoke = secret.kind === "oauth" && secret.refreshToken ? secret.refreshToken : secret.accessToken;
            const hint = secret.kind === "oauth" && secret.refreshToken ? "refresh_token" : "access_token";
            const res = await revokeLinearOAuthToken({
                token: tokenToRevoke,
                tokenTypeHint: hint,
                fetchImpl: this.fetchImpl,
            });
            revokedAtLinear = res.revoked;
        }
        await store.delete(binding.secretKey, canonicalFolder);
        removeAuthBindingFiles(canonicalFolder);
        return { folder: canonicalFolder, revokedAtLinear, loggedOut: true };
    }
}
//# sourceMappingURL=service.js.map