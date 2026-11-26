# Section 1 (`sec-01-foundation-and-auth`) QA & Verification Report

- **Target Package**: `@nineai/linear-cli` (`0.1.0`)
- **Working Directory**: `/Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli`
- **Compiled Binary Audited**: `/Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli/dist/bin/linear.js`
- **OpenSpec Change**: `sec-01-foundation-and-auth`
- **Verification Date**: 2026-11-25
- **Overall Verdict**: **PASS** (All 10 spec requirements across `folder-scoped-auth` and `cli-automation-runtime` passed; 0 blocking defects, 2 minor non-blocking observations)

---

## 1. Automated Validation, Typecheck, and Test Suite Results

### 1.1 OpenSpec Strict Validation
Command executed:
```sh
openspec validate sec-01-foundation-and-auth --strict --json
```
Observed output (exit code `0`):
```json
{
  "items": [
    {
      "id": "sec-01-foundation-and-auth",
      "type": "change",
      "valid": true,
      "issues": [],
      "durationMs": 13
    }
  ],
  "summary": {
    "totals": { "items": 1, "passed": 1, "failed": 0 },
    "byType": { "change": { "items": 1, "passed": 1, "failed": 0 } }
  },
  "version": "1.0"
}
```
- **Result**: **PASS**

### 1.2 TypeScript Typecheck (`npm run typecheck`)
Command executed:
```sh
npm run typecheck
```
Observed output (exit code `0`):
```text
> @nineai/linear-cli@0.1.0 typecheck
> tsc --noEmit
```
- **Result**: **PASS** (0 compiler errors)

### 1.3 Automated Vitest Suite (`npm test`)
Command executed:
```sh
npm test
```
Observed output (exit code `0`):
```text
 RUN  v5.1.1 /Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli

 Test Files  3 passed (3)
      Tests  11 passed (11)
   Duration  179ms
```
Test files verified:
1. `tests/sec-01-auth/runtime.test.ts` (6 tests: JSON envelope & secret redaction, `--dry-run`, exit code mapping `0..10`, `429` `Retry-After` backoff, `OUTCOME_UNKNOWN` create-timeout protection, Relay pagination validation)
2. `tests/sec-01-auth/auth-store-and-oauth.test.ts` (3 tests: multi-folder isolation & no parent traversal + `0600`/`.gitignore`, OAuth PKCE loopback + rotating refresh token renewal + `/oauth/revoke`, `--app` `client_credentials` login + automatic renewal)
3. `tests/sec-01-auth/auth-cli.test.ts` (2 end-to-end CLI harness tests: `login`, `status`, `whoami`, `--expect-workspace`, `--expect-user`, `reauth`, `logout`, `--app`, and `revoke`)
- **Result**: **PASS** (`3/3` files, `11/11` tests)

---

## 2. Live Compiled-Binary Subprocess Verification

All subprocess tests executed the compiled binary `/Users/IMTCRS/Documents/dev-2046/linear-sdk/linear-cli/dist/bin/linear.js` inside isolated temporary directories under `/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec01-qa/`:
- `folder-a`
- `folder-a/child`
- `folder-b`

*(Note: Live `--app` testing used `~/.config/linear-agent-mcp/client.json` with default `read,write` scopes and cleaned up strictly via `auth logout --json` without invoking `auth revoke` against the shared OAuth app.)*

### 2.1 Unauthenticated `auth status --json` in `folder-a`
- **Exit Code**: `0`
- **Observed `stdout`**:
```json
{
  "ok": true,
  "data": {
    "authenticated": false,
    "folder": "/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec01-qa/folder-a",
    "authFile": "/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec01-qa/folder-a/.linear/auth.json",
    "credentialPresent": false,
    "binding": null
  }
}
```
- **Result**: **PASS**

### 2.2 Unauthenticated `auth whoami --json --non-interactive` in `folder-a`
- **Exit Code**: `2` (`AUTH_REQUIRED`)
- **Observed `stderr`** (`stdout` verified empty):
```json
{
  "ok": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "exitCode": 2,
    "message": "No Linear authentication found in folder '/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec01-qa/folder-a' (expected /private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec01-qa/folder-a/.linear/auth.json). Run 'linear auth login' in this folder."
  }
}
```
- **Result**: **PASS**

### 2.3 Live OAuth App Login in `folder-a` (Default macOS Keychain Storage)
Command:
```sh
dist/bin/linear.js auth login --app --client-credentials-file ~/.config/linear-agent-mcp/client.json --json --non-interactive
```
- **Exit Code**: `0`
- **Observed `stdout`** (client ID redacted):
```json
{
  "ok": true,
  "data": {
    "authenticated": true,
    "folder": "/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec01-qa/folder-a",
    "authType": "app",
    "storage": "keychain",
    "account": {
      "id": "aeed4513-8d63-407a-b35c-9ed566e1749e",
      "name": "Local Agent MCP",
      "displayName": "localagentmcp",
      "email": "9fecec95-b587-4d8e-bc09-d2fa1be9e5b5@oauthapp.linear.app",
      "isApp": true
    },
    "workspace": {
      "id": "4b04ee96-418a-4d9e-adb9-0114d4f994eb",
      "name": "NineAI",
      "urlKey": "nineai",
      "url": "https://linear.app/nineai"
    }
  }
}
```
- **Filesystem & Secret Hygiene Inspection**:
  - `.linear/` directory permissions: `drwx------` (`0700`)
  - `.linear/auth.json` permissions: `-rw-------` (`0600`)
  - `.linear/.gitignore` permissions & contents: `-rw-------` (`0600`), exact content `*`
  - Programmatic secret scan against `folder-a/.linear/auth.json`:
    - `AUTH_JSON_CONTAINS_CLIENT_SECRET=false`
    - `AUTH_JSON_CONTAINS_TOKEN_KEYS=false` (no `accessToken`, `refreshToken`, `clientSecret`, or `apiKey` fields)
  - macOS Keychain verification (`security find-generic-password -s "ai.nineai.linear-cli" -a "<secretKey>"` without `-w`): exit code `0` (confirmed stored in Keychain).
- **Result**: **PASS**

### 2.4 Folder Isolation, No Parent Traversal, and Env-Token Immunity
1. **`folder-a` (`auth whoami --json --non-interactive`)**:
   - **Exit Code**: `0`
   - **Observed**: Returned live `Local Agent MCP` (`isApp: true`) and workspace `NineAI` (`urlKey: "nineai"`).
2. **`folder-a/child` (`auth whoami --json --non-interactive`)**:
   - **Exit Code**: `2` (`AUTH_REQUIRED`)
   - **Observed**: Failed immediately looking only for `folder-a/child/.linear/auth.json` — **proving zero upward parent directory traversal**.
3. **`folder-b` (`auth whoami --json --non-interactive`, including with `LINEAR_API_KEY` & `LINEAR_TOKEN` env vars set)**:
   - **Exit Code**: `2` (`AUTH_REQUIRED`)
   - **Observed**: Failed immediately looking only for `folder-b/.linear/auth.json` — **proving strict per-folder isolation and zero environment variable fallback**.
4. **`--cwd` flag from `folder-b` targeting `folder-a` (`--cwd .../folder-a auth status --json`)**:
   - **Exit Code**: `0`
   - **Observed**: Resolved `folder-a/.linear/auth.json` (`authenticated: true`).
- **Result**: **PASS**

### 2.5 Identity Guardrails (`--expect-workspace` & `--expect-user`) in `folder-a`
1. **Workspace mismatch (`auth whoami --expect-workspace wrong-ws --json --non-interactive`)**:
   - **Exit Code**: `3` (`FORBIDDEN`)
   - **Observed `stderr`**:
```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "exitCode": 3,
    "message": "Active folder workspace 'nineai' (NineAI) does not match --expect-workspace 'wrong-ws'.",
    "details": {
      "expectedWorkspace": "wrong-ws",
      "actualWorkspace": {
        "id": "4b04ee96-418a-4d9e-adb9-0114d4f994eb",
        "name": "NineAI",
        "urlKey": "nineai",
        "url": "https://linear.app/nineai"
      }
    }
  }
}
```
2. **User mismatch (`auth whoami --expect-user wrong-user --json --non-interactive`)**:
   - **Exit Code**: `3` (`FORBIDDEN`)
3. **Matching expectations (`auth whoami --expect-workspace nineai --expect-user localagentmcp --json --non-interactive`)**:
   - **Exit Code**: `0`
- **Result**: **PASS**

### 2.6 Dry-Run Mutation Preview in `folder-b`
Command:
```sh
dist/bin/linear.js auth login --app --client-credentials-file ~/.config/linear-agent-mcp/client.json --storage file --dry-run --json --non-interactive
```
- **Exit Code**: `0`
- **Observed `stdout`** (client ID redacted):
```json
{
  "ok": true,
  "dryRun": true,
  "operation": "auth.login.app",
  "data": {
    "dryRun": true,
    "operation": "auth.login.app",
    "parameters": {
      "folder": "/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec01-qa/folder-b",
      "storage": "file",
      "clientId": "<REDACTED_CLIENT_ID>",
      "scopes": "read,write"
    }
  }
}
```
- **Side-Effect Check**: `ls -la folder-b` confirmed neither `folder-b/.linear` nor `folder-b/.linear/auth.json` was created, and no network token exchange was performed.
- **Result**: **PASS**

### 2.7 Non-Interactive Fail-Fast & Stream Separation Checks
- `auth login --json --non-interactive` (default browser OAuth in non-interactive mode): exited immediately with code `2` (`AUTH_REQUIRED`).
- `auth login --api-key --json --non-interactive` (missing `--api-key-stdin` / `--api-key-file`): exited immediately with code `5` (`VALIDATION_ERROR`).
- Subprocess stream discipline (`spawnSync`):
  - Success with `--json`: `stdout` valid JSON (`ok: true`), `stderr` empty (`""`), `hasAnsi: false`.
  - Failure with `--json`: `stdout` empty (`""`), `stderr` valid JSON (`ok: false`), `hasAnsi: false`.
- **Result**: **PASS**

### 2.8 Cleanup & Logout Verification in `folder-a`
Command:
```sh
dist/bin/linear.js auth logout --json
```
- **Exit Code**: `0`
- **Post-Logout Verification**:
  - `auth status --json` in `folder-a`: `authenticated: false`, `credentialPresent: false`, `binding: null` (exit `0`).
  - `folder-a/.linear/auth.json`: deleted.
  - macOS Keychain check (`security find-generic-password -s "ai.nineai.linear-cli" -a "<secretKey>"`): exit code `44` (`errSecItemNotFound` — Keychain entry cleanly removed).
  - Temporary test root `/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec01-qa` removed.
- **Result**: **PASS**

---

## 3. Spec Requirement Traceability Matrix

| Spec | Requirement | Verdict | Evidence |
|---|---|---|---|
| `folder-scoped-auth` | Strict Working-Directory Auth Resolution | **PASS** | Live subprocess verified `folder-a` (`0`), `folder-a/child` (`2` `AUTH_REQUIRED`), `folder-b` (`2` `AUTH_REQUIRED` even with env vars), and `--cwd` (`0`). |
| `folder-scoped-auth` | Pluggable Secret Storage Without Plaintext Leakage | **PASS** | Live Keychain login created `0700` `.linear/`, `0600` `auth.json` with zero secrets, and `.gitignore` (`*`); unit tests verified `0600` `.linear/credentials.json` for `--storage file`. |
| `folder-scoped-auth` | Personal API Key, OAuth PKCE, and App Client-Credentials Login | **PASS** | Live `--app` login verified against Linear (`NineAI`); Vitest verified `--api-key-stdin` and OAuth PKCE `S256` callback exchange. |
| `folder-scoped-auth` | Automatic Token Renewal Before Expiry and on 401 | **PASS** | `src/auth/service.ts` + `withFolderRefreshLock` verified in `auth-store-and-oauth.test.ts` for both rotating `refresh_token` and `client_credentials` renewal. |
| `folder-scoped-auth` | Status, Whoami, Reauth, Logout, and Revoke Lifecycle | **PASS** | Live subprocess verified `login`, `status`, `whoami`, `logout` (including Keychain removal); Vitest verified `reauth` and `revoke` (`/oauth/revoke`). |
| `cli-automation-runtime` | Structured JSON Output and Secret Redaction | **PASS** | Subprocess `spawnSync` verified clean `stdout`/`stderr` separation, valid JSON, zero ANSI codes; `runtime.test.ts` & `auth-cli.test.ts` verified token/header redaction. |
| `cli-automation-runtime` | Non-Interactive Prompt Guard and Deterministic Exit Codes | **PASS** | Exit codes `0..10` verified in `runtime.test.ts`; live subprocess verified immediate exits `2`, `3`, and `5` under `--non-interactive`. |
| `cli-automation-runtime` | Expected Workspace and User Guardrails | **PASS** | Live subprocess verified `--expect-workspace wrong-ws` and `--expect-user wrong-user` fail with exit `3` (`FORBIDDEN`); `openVerifiedSession` enforces prior to domain operations. |
| `cli-automation-runtime` | Dry-Run Mutation Preview | **PASS** | Live subprocess verified `--dry-run` returns `dryRun: true` (exit `0`) without creating `.linear/auth.json`. |
| `cli-automation-runtime` | Rate-Limit Retry and Create-Timeout Safety | **PASS** | `executeWithGuardrails` (`src/core/retry.ts`) verified in `runtime.test.ts` for `429` `Retry-After` read retry and single-dispatch `OUTCOME_UNKNOWN` (`8`) on create timeout. |

---

## 4. Defects & Observations

### Blocking Defects
- **None** (`0` blocking or spec-violating defects found).

### Minor / Non-Blocking Observations
1. **Order of `--expect-workspace` / `--expect-user` check during `auth login` / `auth reauth`** (`src/modules/auth/commands.ts:56-61, 123-130, 196-205`):
   - `performLogin` calls `assertExpectedIdentity(binding, ctx)` immediately *after* `authService.loginWith*` writes `.linear/auth.json` and stores the secret. While it still aborts with exit code `3` (`FORBIDDEN`), validating the resolved `viewer`/`organization` *before* calling `replaceBindingAndSecret` would avoid overwriting an existing folder binding when `reauth` is run with a mismatched `--expect-workspace` or `--expect-user`. (Domain mutations using `openVerifiedSession` in `src/core/client.ts:60-62` already check `assertExpectedIdentity` strictly before executing.)
2. **Interactive TTY API-key prompt input echoing** (`src/cli/context.ts:126-130`):
   - When running interactively without `--api-key-stdin` or `--api-key-file`, `promptRequired` uses Node's standard `readline.question(...)`, which echoes typed characters to `stderr` rather than masking keystrokes. Non-interactive/agent flows (`--api-key-stdin` and `--api-key-file`) are unaffected.

---

# Re-verification (post-fix)

- **Re-verification Date**: 2026-11-25 (after the two Section 1 core-runtime changes below)
- **Scope**: Only the two changes made after the original verification:
  1. `normalizeError` in `src/core/errors.ts` — truthful mapping of `ForbiddenLinearError` → `FORBIDDEN` (exit 3) and `InvalidInputLinearError` with "Entity not found: …" / "Could not find referenced …" wording → `NOT_FOUND` (exit 4); genuine invalid input still `VALIDATION_ERROR` (exit 5).
  2. `--version` handling in `src/cli/app.ts` — root program no longer registers commander's `.version()`; `runCli` detects a standalone leading `--version`/`-V` before parsing (only when every preceding arg is a global flag, including value-taking `--cwd <dir>` / `--expect-workspace` / `--expect-user`, and the flag has no value after it).
- **Binary Audited**: `./dist/bin/linear.js` (also installed globally as `linear` → `/Users/IMTCRS/.local/bin/linear`), built 17:19 after both source edits; `dist/cli/app.js` confirmed to contain `GLOBAL_VALUE_FLAGS` / `isVersionRequest` and `dist/core/errors.js` confirmed to contain the `entity not found|could not find referenced` and `not allowed` mappings.
- **Hygiene**: `~/.config/linear-agent-mcp/client.json` stat **identical before and after** (`inode 7071464`, `mtime 1795512864`, `size 99`). No `auth revoke` was run; test login used `--storage file`; all logins cleaned up with `auth logout`; all temp folders deleted; no secrets in output.

## R1. `--version` / `-V` handling (exit 0, version string only)

All executed against the real CLI (global `linear`) from multiple directories:

| Command | Directory | Exit | stdout |
|---|---|---|---|
| `linear --version` | `linear-cli/` | `0` | `0.1.0\n` |
| `linear -V` | `linear-cli/` | `0` | `0.1.0\n` |
| `linear --json --version` | `linear-cli/` | `0` | `0.1.0\n` (verified byte-exact via `od -c`; no JSON envelope, no hijack) |
| `linear --cwd /private/var/.../T/opencode --version` | `linear-cli/` | `0` | `0.1.0\n` |
| `linear --cwd <authed dir> --version` | fresh temp folder | `0` | `0.1.0\n` |
| `linear --expect-workspace x --version` / `linear --expect-user someone --version` | `linear-cli/` / fresh temp folder | `0` | `0.1.0\n` |
| `linear --help` | `linear-cli/` | `0` | (help text suppressed for check) |

- **Result**: **PASS** — version flag detected standalone (including after value-taking global flags) from any directory, exit 0.

## R2. Unauthenticated `auth whoami --json` in a fresh temp folder

- **Exit Code**: `2` (`AUTH_REQUIRED`), stderr JSON `{"ok":false,"error":{"code":"AUTH_REQUIRED","exitCode":2,"message":"No Linear authentication found in folder '…/sec01-reverify/fresh' …"}}`
- **Result**: **PASS**

## R3. Subcommand `--version` is not hijacked (authenticated)

Login (authenticated temp folder, `--storage file`): `linear auth login --app --client-credentials-file ~/.config/linear-agent-mcp/client.json --storage file --json --non-interactive` → exit `0` (`authType: app`, `storage: file`, workspace `nineai`).

| Command (in authenticated folder) | Exit | stdout | stderr |
|---|---|---|---|
| `linear release create --pipeline x --name y --version 1.0.0 --json` | `4` | empty (`0` bytes) | `{"ok":false,"error":{"code":"NOT_FOUND","exitCode":4,"message":"Release pipeline 'x' not found."}}` |
| `linear release create --version 1.0.0 --pipeline x --name y --json` (value flag first) | `4` | empty | same `NOT_FOUND` |

- `grep "0.1.0"` over both streams: **0 matches** — the version string is never printed.
- Reaching exit 4 (`NOT_FOUND`, "Release pipeline 'x' not found.") proves the command executed to the SDK instead of being intercepted by commander's `--version`.
- **Result**: **PASS**

## R4. Error-path exit codes (authenticated folder)

- **Unknown flag** `linear label list --bogus-flag --json` → exit **`5`** (`VALIDATION_ERROR`, message `unknown option '--bogus-flag'`).
- **`linear --expect-workspace wrongws label list --json`** → exit **`3`** (`FORBIDDEN`, "Active folder workspace 'nineai' (NineAI) does not match --expect-workspace 'wrongws'.").
- **`linear --expect-workspace nineai label list --json`** → exit **`0`**, valid JSON label list on stdout, empty stderr.
- **Result**: **PASS**

## R5. Direct execution of the new `normalizeError` mappings (real SDK error instances)

Node script importing `dist/core/errors.js` and constructing real `@linear/sdk` errors:

```text
ForbiddenLinearError ("Not allowed to take action - …")            -> FORBIDDEN 3
InvalidInputLinearError ("Entity not found: Notification - …")     -> NOT_FOUND 4
InvalidInputLinearError ("Invalid input: field name is required.") -> VALIDATION_ERROR 5
```

- **Result**: **PASS** — forbidden wording (HTTP 200, no "forbidden"/403) now maps to exit 3; missing-entity invalid input to exit 4; genuine invalid input remains exit 5.

## R6. Automated test suites

| Command | Result |
|---|---|
| `npx vitest run tests/sec-01-auth` | **PASS** — `3` files, `12` tests (incl. `runtime.test.ts` with **7** tests; new test "maps Linear permission denials to FORBIDDEN and missing-entity invalid input to NOT_FOUND" constructs real `ForbiddenLinearError`/`InvalidInputLinearError` asserting exits 3/4/5) |
| `npx vitest run` (full) | **PASS** — `13` files, `26` tests, `0` failed |

- **Result**: **PASS**

## R7. Cleanup & credential-file integrity

- `linear auth logout --json` in the authenticated folder → exit `0`; follow-up `auth status --json` → `authenticated: false`, `credentialPresent: false`, `binding: null`.
- Temp root `/private/var/folders/50/48ntmkvj7sq1dyqwjq82pl780000gp/T/opencode/sec01-reverify` deleted; `/tmp/sec01_*` scratch files deleted.
- `~/.config/linear-agent-mcp/client.json` stat before = after: `7071464 1795512864 99` (untouched). No `auth revoke` executed.
- **Result**: **PASS**

## Re-verification summary

| # | Check | Result |
|---|---|---|
| R1 | `--version`, `-V`, `--json --version`, `--cwd <dir> --version`, `--help` → version/help, exit 0 | PASS |
| R2 | Unauthenticated fresh folder `auth whoami --json` → exit 2 `AUTH_REQUIRED` | PASS |
| R3 | `release create … --version 1.0.0` reaches SDK (exit 4 `NOT_FOUND`), version string never printed | PASS |
| R4 | Unknown flag → exit 5; `--expect-workspace wrongws` → exit 3; `nineai` → exit 0 | PASS |
| R5 | `normalizeError` maps real `ForbiddenLinearError`→3, missing-entity `InvalidInputLinearError`→4, genuine invalid input→5 | PASS |
| R6 | `vitest tests/sec-01-auth` 3 files/12 tests; full suite 13 files/26 tests — all pass | PASS |
| R7 | Logout, temp cleanup, shared credential file untouched | PASS |

VERDICT: PASS
