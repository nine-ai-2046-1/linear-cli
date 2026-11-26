import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { CliError } from "../core/errors.js";
export const LINEAR_OAUTH_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
export const LINEAR_OAUTH_TOKEN_URL = "https://api.linear.app/oauth/token";
export const LINEAR_OAUTH_REVOKE_URL = "https://api.linear.app/oauth/revoke";
export function generatePkcePair() {
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
    const state = crypto.randomBytes(24).toString("base64url");
    return { codeVerifier, codeChallenge, state };
}
export function parseScopes(rawScopes) {
    if (!rawScopes)
        return ["read", "write"];
    const items = Array.isArray(rawScopes) ? rawScopes : rawScopes.split(/[\s,]+/);
    const cleaned = items.map((s) => s.trim()).filter(Boolean);
    return cleaned.length > 0 ? Array.from(new Set(cleaned)) : ["read", "write"];
}
export function buildAuthorizeUrl(params) {
    const url = new URL(LINEAR_OAUTH_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", params.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("scope", params.scopes.join(","));
    url.searchParams.set("state", params.state);
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (params.actor) {
        url.searchParams.set("actor", params.actor);
    }
    if (params.promptConsent) {
        url.searchParams.set("prompt", "consent");
    }
    return url.toString();
}
function normalizeTokenResponse(body, fallbackScopes) {
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    if (!accessToken) {
        throw new CliError("AUTH_REQUIRED", "Linear OAuth token endpoint did not return an access_token.");
    }
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : undefined;
    const expiresIn = typeof body.expires_in === "number" ? body.expires_in : undefined;
    const expiresAt = expiresIn && Number.isFinite(expiresIn)
        ? new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString()
        : undefined;
    const scopeVal = body.scope;
    const scopes = Array.isArray(scopeVal)
        ? scopeVal.map(String)
        : typeof scopeVal === "string"
            ? parseScopes(scopeVal)
            : fallbackScopes;
    return { accessToken, refreshToken, expiresAt, scopes };
}
export async function exchangeAuthorizationCode(params) {
    const fetchFn = params.fetchImpl ?? fetch;
    const form = new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: params.redirectUri,
        client_id: params.clientId,
        code_verifier: params.codeVerifier,
    });
    if (params.clientSecret) {
        form.set("client_secret", params.clientSecret);
    }
    const res = await fetchFn(LINEAR_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
    });
    const json = (await res.json().catch(() => ({})));
    if (!res.ok) {
        const desc = String(json.error_description ?? json.error ?? `HTTP ${res.status}`);
        throw new CliError("AUTH_REQUIRED", `OAuth code exchange failed: ${desc}`);
    }
    return normalizeTokenResponse(json, params.scopes);
}
export async function refreshOAuthAccessToken(params) {
    const fetchFn = params.fetchImpl ?? fetch;
    const form = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: params.refreshToken,
    });
    const headers = {
        "Content-Type": "application/x-www-form-urlencoded",
    };
    if (params.clientSecret) {
        const basic = Buffer.from(`${params.clientId}:${params.clientSecret}`, "utf8").toString("base64");
        headers.Authorization = `Basic ${basic}`;
    }
    else {
        form.set("client_id", params.clientId);
    }
    const res = await fetchFn(LINEAR_OAUTH_TOKEN_URL, {
        method: "POST",
        headers,
        body: form.toString(),
    });
    const json = (await res.json().catch(() => ({})));
    if (!res.ok) {
        const desc = String(json.error_description ?? json.error ?? `HTTP ${res.status}`);
        throw new CliError("AUTH_REQUIRED", `OAuth token refresh failed (${desc}). Run 'linear auth reauth' in this folder.`);
    }
    return normalizeTokenResponse(json, params.scopes);
}
export async function exchangeClientCredentials(params) {
    const fetchFn = params.fetchImpl ?? fetch;
    const basic = Buffer.from(`${params.clientId}:${params.clientSecret}`, "utf8").toString("base64");
    const form = new URLSearchParams({
        grant_type: "client_credentials",
        scope: params.scopes.join(","),
    });
    const res = await fetchFn(LINEAR_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${basic}`,
        },
        body: form.toString(),
    });
    const json = (await res.json().catch(() => ({})));
    if (!res.ok) {
        const desc = String(json.error_description ?? json.error ?? `HTTP ${res.status}`);
        throw new CliError("AUTH_REQUIRED", `Client credentials token request failed: ${desc}`);
    }
    return normalizeTokenResponse(json, params.scopes);
}
export async function revokeLinearOAuthToken(params) {
    const fetchFn = params.fetchImpl ?? fetch;
    const form = new URLSearchParams({ token: params.token });
    if (params.tokenTypeHint) {
        form.set("token_type_hint", params.tokenTypeHint);
    }
    const res = await fetchFn(LINEAR_OAUTH_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
    });
    // 200 = revoked, 400 = already revoked; 401 = unauthorized token
    if (res.status === 200 || res.status === 400) {
        return { revoked: res.status === 200, status: res.status };
    }
    throw new CliError("AUTH_REQUIRED", `Failed to revoke token at Linear (HTTP ${res.status}).`);
}
export async function startOAuthLoopbackServer(options) {
    const callbackPath = options.callbackPath ?? "/oauth/callback";
    const timeoutMs = options.timeoutMs ?? 180_000;
    let resolveCode;
    let rejectCode;
    const callbackPromise = new Promise((res, rej) => {
        resolveCode = res;
        rejectCode = rej;
    });
    const server = http.createServer((req, res) => {
        try {
            const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
            if (reqUrl.pathname !== callbackPath) {
                res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
                res.end("Not found");
                return;
            }
            const errParam = reqUrl.searchParams.get("error");
            if (errParam) {
                const desc = reqUrl.searchParams.get("error_description") ?? errParam;
                res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
                res.end("Linear authorization failed. You may close this tab.");
                rejectCode(new CliError("AUTH_REQUIRED", `OAuth authorization denied: ${desc}`));
                return;
            }
            const returnedState = reqUrl.searchParams.get("state");
            const code = reqUrl.searchParams.get("code");
            if (!returnedState || returnedState !== options.expectedState) {
                res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
                res.end("Invalid OAuth state. You may close this tab.");
                rejectCode(new CliError("AUTH_REQUIRED", "OAuth callback state mismatch."));
                return;
            }
            if (!code) {
                res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
                res.end("Missing authorization code.");
                rejectCode(new CliError("AUTH_REQUIRED", "OAuth callback missing code parameter."));
                return;
            }
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end("<!doctype html><html><body><h2>Linear CLI authenticated</h2><p>You may close this window.</p></body></html>");
            resolveCode({ code });
        }
        catch (err) {
            rejectCode(err instanceof Error ? err : new Error(String(err)));
        }
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") {
        server.close();
        throw new CliError("INTERNAL_ERROR", "Unable to determine local OAuth callback port.");
    }
    const redirectUri = `http://127.0.0.1:${addr.port}${callbackPath}`;
    const close = () => new Promise((resolve) => {
        server.close(() => resolve());
    });
    const waitForCallback = async () => {
        let timer;
        try {
            return await Promise.race([
                callbackPromise,
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new CliError("AUTH_REQUIRED", `Timed out waiting for OAuth browser callback (${timeoutMs}ms).`)), timeoutMs);
                }),
            ]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
            await close();
        }
    };
    return { redirectUri, waitForCallback, close };
}
//# sourceMappingURL=oauth.js.map