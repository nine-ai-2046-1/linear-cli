# Section 1 Exploration: CLI Foundation, Per-Folder Auth & Automation Runtime

## Problem Space

Agents and automated workflows need a deterministic, direct CLI (`linear`) built on `@linear/sdk` (`104.0.0`) so skills can execute exact Linear operations without searching MCP tool catalogs at runtime. Crucially, the binary is installed globally once, while authentication state MUST be isolated strictly per execution folder (`<cwd>/.linear/auth.json`) with zero parent-directory traversal and zero global credential fallback.

```text
+-------------------------------------------------------------------+
|                   Global `linear` CLI Binary                      |
+-------------------------------------------------------------------+
                                 |
          resolves `--cwd <dir>` or `process.cwd()` (exact!)
          NO parent traversal (`../`), NO global `~/.linear`
                                 |
        +------------------------+------------------------+
        |                                                 |
        v                                                 v
+-------------------------------+         +-------------------------------+
| folder-a/.linear/auth.json    |         | folder-b/.linear/auth.json    |
| account: user-a@example.com   |         | account: user-b@example.com   |
| workspace: Workspace A        |         | workspace: Workspace B        |
| secretRef: keychain:<id-a>    |         | secretRef: keychain:<id-b>    |
+---------------+---------------+         +---------------+---------------+
                |                                         |
                v                                         v
+-------------------------------+         +-------------------------------+
| macOS Keychain / 0600 Secret  |         | macOS Keychain / 0600 Secret  |
| Service: ai.opencode.linear   |         | Service: ai.opencode.linear   |
| Account: <folderHash>:<id-a>  |         | Account: <folderHash>:<id-b>  |
+-------------------------------+         +-------------------------------+
```

## Key Decisions Explored

1. **Auth Modes Supported in `<cwd>/.linear/auth.json`**:
   - `oauth`: Personal OAuth 2.0 Authorization Code + PKCE (`S256`) via ephemeral loopback callback (`http://127.0.0.1:<port>/oauth/callback`), storing rotating `accessToken` + `refreshToken` + `expiresAt` in `SecretStore` and refreshing automatically with a per-folder lockfile before expiry or on `401`.
   - `api-key`: Personal API key read from `--api-key-stdin` or masked TTY prompt (never required in argv), validated against `viewer` + `organization` before persisting.
   - `app`: OAuth 2.0 `client_credentials` (`actor=app`) grant with automatic 30-day token acquisition and renewal on expiry/`401`.

2. **Secret Storage Tradeoffs**:
   - Default `keychain` on macOS via `/usr/bin/security` (`add-generic-password -U`, `find-generic-password -w`, `delete-generic-password`), keeping `.linear/auth.json` free of raw tokens/keys.
   - Explicit `--storage file` writes secrets into `<cwd>/.linear/credentials.json` (`0600` mode inside `0700` `.linear/`) for headless CI/Linux or explicit local-file workflows, and ensures `.linear/` has its own `.gitignore` (`*`) so secrets cannot be accidentally staged into Git.

3. **Agent & Automation Guarantees (Section 8 Cross-Cutting)**:
   - Global flags: `--json`, `--non-interactive`, `--dry-run`, `--cwd <dir>`, `--expect-workspace <id|urlKey|name>`, `--expect-user <id|email|name>`.
   - Deterministic exit codes:
     - `0`: Success
     - `1`: Unexpected internal error
     - `2`: `AUTH_REQUIRED` / invalid credentials
     - `3`: `FORBIDDEN` / workspace or user expectation mismatch
     - `4`: `NOT_FOUND`
     - `5`: `VALIDATION_ERROR`
     - `6`: `AMBIGUOUS_RESOURCE`
     - `7`: `RATE_LIMITED`
     - `8`: `OUTCOME_UNKNOWN` (non-idempotent create mutation timed out)
     - `9`: `UNSUPPORTED_BY_PUBLIC_API`
     - `10`: `NETWORK_ERROR`
