import crypto from "node:crypto";
import { LinearClient } from "@linear/sdk";
import { CliError } from "../core/errors.js";
import type { SecretStoreRegistry } from "./keychain.js";
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  exchangeClientCredentials,
  generatePkcePair,
  parseScopes,
  refreshOAuthAccessToken,
  revokeLinearOAuthToken,
  startOAuthLoopbackServer,
  type FetchLike,
} from "./oauth.js";
import {
  computeFolderHash,
  readAuthBinding,
  removeAuthBindingFiles,
  resolveCanonicalCwd,
  withFolderRefreshLock,
  writeAuthBinding,
} from "./store.js";
import type {
  AuthBinding,
  BoundAccountInfo,
  BoundWorkspaceInfo,
  SecretStorageMode,
  StoredSecretPayload,
} from "./types.js";

export type SdkFactory = (auth: { apiKey?: string; accessToken?: string }) => LinearClient;

export const defaultSdkFactory: SdkFactory = (auth) =>
  auth.apiKey ? new LinearClient({ apiKey: auth.apiKey }) : new LinearClient({ accessToken: auth.accessToken });

const EXPIRY_BUFFER_MS = 120_000;

export function isExpiringSoon(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  const ts = Date.parse(expiresAt);
  if (!Number.isFinite(ts)) return false;
  return ts - Date.now() <= EXPIRY_BUFFER_MS;
}

export async function inspectIdentityWithClient(client: LinearClient): Promise<{
  account: BoundAccountInfo;
  workspace: BoundWorkspaceInfo;
}> {
  const [viewer, org] = await Promise.all([client.viewer, client.organization]);
  const rawViewer = viewer as unknown as {
    id: string;
    name: string;
    displayName?: string;
    email?: string | null;
    app?: boolean;
  };
  const rawOrg = org as unknown as {
    id: string;
    name: string;
    urlKey: string;
  };
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
  private readonly stores: SecretStoreRegistry;
  private readonly sdkFactory: SdkFactory;
  private readonly fetchImpl: FetchLike;
  private readonly openBrowser?: (url: string) => Promise<void> | void;

  constructor(deps: {
    stores: SecretStoreRegistry;
    sdkFactory?: SdkFactory;
    fetchImpl?: FetchLike;
    openBrowser?: (url: string) => Promise<void> | void;
  }) {
    this.stores = deps.stores;
    this.sdkFactory = deps.sdkFactory ?? defaultSdkFactory;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.openBrowser = deps.openBrowser;
  }

  private async replaceBindingAndSecret(params: {
    cwd: string;
    storage: SecretStorageMode;
    authType: "api-key" | "oauth" | "app";
    account: BoundAccountInfo;
    workspace: BoundWorkspaceInfo;
    secretPayload: StoredSecretPayload;
    oauthMeta?: AuthBinding["oauth"];
  }): Promise<AuthBinding> {
    const { canonicalFolder, binding: previous } = readAuthBinding(params.cwd);
    if (previous) {
      await this.stores.getStore(previous.storage).delete(previous.secretKey, canonicalFolder);
    }
    const bindingId = crypto.randomUUID();
    const folderHash = computeFolderHash(canonicalFolder);
    const secretKey = `${folderHash}:${bindingId}`;
    const now = new Date().toISOString();
    const nextBinding: AuthBinding = {
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

  public async loginWithApiKey(params: {
    cwd: string;
    apiKey: string;
    storage: SecretStorageMode;
    validateBeforeSave?: (identity: { account: BoundAccountInfo; workspace: BoundWorkspaceInfo }) => void;
  }): Promise<AuthBinding> {
    const trimmed = params.apiKey.trim();
    if (!trimmed) {
      throw new CliError("VALIDATION_ERROR", "API key cannot be empty.");
    }
    const client = this.sdkFactory({ apiKey: trimmed });
    let identity: { account: BoundAccountInfo; workspace: BoundWorkspaceInfo };
    try {
      identity = await inspectIdentityWithClient(client);
    } catch (cause) {
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

  public async loginWithAppCredentials(params: {
    cwd: string;
    clientId: string;
    clientSecret: string;
    scopes?: string | string[];
    storage: SecretStorageMode;
    validateBeforeSave?: (identity: { account: BoundAccountInfo; workspace: BoundWorkspaceInfo }) => void;
  }): Promise<AuthBinding> {
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

  public async loginWithOAuthPkce(params: {
    cwd: string;
    clientId: string;
    clientSecret?: string;
    scopes?: string | string[];
    port?: number;
    actor?: "user" | "app";
    storage: SecretStorageMode;
    timeoutMs?: number;
    onAuthorizeUrl?: (url: string, redirectUri: string) => void;
    validateBeforeSave?: (identity: { account: BoundAccountInfo; workspace: BoundWorkspaceInfo }) => void;
  }): Promise<AuthBinding> {
    const clientId = params.clientId.trim();
    if (!clientId) {
      throw new CliError(
        "VALIDATION_ERROR",
        "OAuth login requires --client-id <id> (with redirect URI http://127.0.0.1:<port>/oauth/callback configured in Linear).",
      );
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
    } catch (err) {
      await loopback.close();
      throw err;
    }
  }

  public async getStatus(cwd: string): Promise<{
    authenticated: boolean;
    folder: string;
    authFile: string;
    credentialPresent: boolean;
    binding: AuthBinding | null;
  }> {
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

  public async getActiveClient(
    cwd: string,
    options?: { forceRefresh?: boolean },
  ): Promise<{ client: LinearClient; binding: AuthBinding; canonicalFolder: string }> {
    const { canonicalFolder, authFile, binding } = readAuthBinding(cwd);
    if (!binding) {
      throw new CliError(
        "AUTH_REQUIRED",
        `No Linear authentication found in folder '${canonicalFolder}' (expected ${authFile}). Run 'linear auth login' in this folder.`,
      );
    }

    const store = this.stores.getStore(binding.storage);
    let secret = await store.get(binding.secretKey, canonicalFolder);
    if (!secret) {
      throw new CliError(
        "AUTH_REQUIRED",
        `Authentication binding exists in '${canonicalFolder}', but secret '${binding.secretKey}' is missing from ${binding.storage} storage. Run 'linear auth reauth'.`,
      );
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
            throw new CliError(
              "AUTH_REQUIRED",
              `OAuth access token in '${canonicalFolder}' expired and has no refresh token. Run 'linear auth reauth'.`,
            );
          }
          const nextTok = await refreshOAuthAccessToken({
            refreshToken: latestSecret.refreshToken,
            clientId: latestSecret.clientId,
            clientSecret: latestSecret.clientSecret,
            scopes: latestSecret.scopes,
            fetchImpl: this.fetchImpl,
          });
          const updatedSecret: StoredSecretPayload = {
            ...latestSecret,
            accessToken: nextTok.accessToken,
            refreshToken: nextTok.refreshToken ?? latestSecret.refreshToken,
            scopes: nextTok.scopes,
            expiresAt: nextTok.expiresAt,
          };
          const updatedBinding: AuthBinding = {
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
        } else {
          const nextTok = await exchangeClientCredentials({
            clientId: latestSecret.clientId,
            clientSecret: latestSecret.clientSecret,
            scopes: latestSecret.scopes,
            fetchImpl: this.fetchImpl,
          });
          const updatedSecret: StoredSecretPayload = {
            ...latestSecret,
            accessToken: nextTok.accessToken,
            scopes: nextTok.scopes,
            expiresAt: nextTok.expiresAt,
          };
          const updatedBinding: AuthBinding = {
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

  public async getAuthorizationHeader(cwd: string): Promise<string> {
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

  public async whoami(cwd: string): Promise<{
    folder: string;
    authType: AuthBinding["authType"];
    storage: SecretStorageMode;
    account: BoundAccountInfo;
    workspace: BoundWorkspaceInfo;
  }> {
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
    } catch (err) {
      const status = (err as { status?: number })?.status;
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

  public async logout(cwd: string): Promise<{ folder: string; loggedOut: boolean; previousAccount?: string }> {
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

  public async revoke(cwd: string): Promise<{ folder: string; revokedAtLinear: boolean; loggedOut: boolean }> {
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
