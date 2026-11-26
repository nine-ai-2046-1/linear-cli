# Design

## Context

See `proposal.md` for motivation and scope. This initial change establishes the `linear-cli` TypeScript ESM package, its modular source layout, strict per-directory authentication (`<cwd>/.linear/auth.json`), secret storage adapters, and the shared runtime contract used by all subsequent domain modules (Sections 2–7).

## Goals / Non-Goals

**Goals:**
- Provide a clean dependency-injected `CliRuntime` so every command module can be executed both from the real `linear` binary and in-process from Vitest without spawning slow subprocesses for every unit test (while also supporting real compiled-binary subprocess tests).
- Guarantee zero credential bleed across project folders on the same machine.
- Enforce deterministic JSON output, exit codes, rate-limit handling, and create-timeout protection in one shared core layer.

**Non-Goals:**
- Domain entity commands beyond `auth` (covered in Sections 2–7).
- Daemonized background token refresh (tokens renew on-demand with lockfile coordination when `linear` runs).

## Decisions

### 1. Architecture & Module Boundaries

```text
+-----------------------------------------------------------------------+
|                         src/bin/linear.ts                             |
+-----------------------------------+-----------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                     src/cli/app.ts & context.ts                       |
|  Global flags: --json --non-interactive --dry-run --cwd               |
|                --expect-workspace --expect-user                       |
+-----------------+-----------------------------------+-----------------+
                  |                                   |
                  v                                   v
+-----------------------------------+ +---------------------------------+
|         src/auth/*                | |         src/core/*              |
| - types.ts (.linear/auth.json)    | | - errors.ts (CliError/ExitCode) |
| - store.ts (exact cwd, 0700/0600) | | - output.ts (JSON/Table/Redact) |
| - keychain.ts (Keychain/File/Mem) | | - retry.ts (429 / Timeout guard)|
| - oauth.ts (PKCE / App / Revoke)  | | - pagination.ts (Relay cursors) |
| - service.ts (AuthService)        | | - resolvers.ts (Entity lookup)  |
+-----------------+-----------------+ | - client.ts (LinearClient wrap) |
                  |                   +----------------+----------------+
                  +-----------------+------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                      src/modules/<domain>/*                           |
|  auth | workspace | issues | collaboration | planning | metadata |... |
+-----------------------------------------------------------------------+
```

- **Why injectable `CliDependencies`**: Passing `{ cwd, env, stdin, stdout, stderr, isTTY, secretStore, fetchImpl, sdkFactory }` into `runCli(argv, deps)` makes OAuth callback handling, `429` retry, timeout handling, and SDK calls 100% deterministic in unit tests while using real Node/OS implementations by default.

### 2. Per-Folder Auth Metadata & Secret Storage

- **Auth file path**: `path.join(fs.realpathSync(activeCwd), ".linear", "auth.json")`. No upward directory walk is ever performed.
- **Schema of `.linear/auth.json`**:
  - `version`: `1`
  - `authType`: `"oauth" | "api-key" | "app"`
  - `storage`: `"keychain" | "file"`
  - `bindingId`: random UUID v4 generated per login
  - `folderHash`: first 16 hex chars of SHA-256 of canonical folder path
  - `secretKey`: `<folderHash>:<bindingId>`
  - `account`: `{ id, name, displayName, email, isApp }`
  - `workspace`: `{ id, name, urlKey, url }`
  - `oauth`: optional `{ clientId, scopes, expiresAt }` (no secrets!)
  - `createdAt`, `updatedAt`
- **Why Keychain default + optional `0600` file**: Prevents accidental secret commits in Git repositories while still supporting headless CI/containers or explicit file-backed workflows (`--storage file`). Regardless of mode, `.linear/.gitignore` with `*` is always written.

### 3. Error Codes & Retry Semantics

| Error Code | Exit Code | Trigger |
|---|---|---|
| `AUTH_REQUIRED` | `2` | Missing `.linear/auth.json`, missing secret, expired/revoked token that cannot refresh |
| `FORBIDDEN` | `3` | Permission denied or `--expect-workspace` / `--expect-user` mismatch |
| `NOT_FOUND` | `4` | Entity not found |
| `VALIDATION_ERROR` | `5` | Invalid flags/inputs or missing required flag in `--non-interactive` |
| `AMBIGUOUS_RESOURCE` | `6` | Human-friendly name matched >1 team/user/state/project/label |
| `RATE_LIMITED` | `7` | `429` / `RATELIMITED` persisted after bounded retries |
| `OUTCOME_UNKNOWN` | `8` | Non-idempotent create mutation timed out after dispatch |
| `UNSUPPORTED_BY_PUBLIC_API` | `9` | Operation is not exposed in Linear's public GraphQL API |
| `NETWORK_ERROR` | `10` | Transport/DNS/TLS failure on read or before dispatch |

## Risks / Trade-offs

- **[Risk] Concurrent CLI invocations refreshing the same folder's rotating OAuth refresh token** → Mitigation: Acquire an exclusive lockfile (`<cwd>/.linear/refresh.lock`) with stale-lock detection and re-read stored credentials after lock acquisition before refreshing.
- **[Risk] Interactive prompt triggered inside an automated agent workflow** → Mitigation: Treat `!stdin.isTTY || !stdout.isTTY || process.env.CI === "true" || opts.nonInteractive` as non-interactive; any missing credential or confirmation throws `AUTH_REQUIRED` or `VALIDATION_ERROR` immediately.
