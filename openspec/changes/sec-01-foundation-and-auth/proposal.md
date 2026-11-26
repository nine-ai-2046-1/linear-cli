# Proposal

## Why

Agents and automated workflows need a globally installable `linear` CLI built on the official `@linear/sdk` that executes deterministic commands with strict per-folder authentication isolation (`<cwd>/.linear/auth.json`). Without strict folder-local credential resolution, structured JSON output, and non-interactive failure semantics, agents running across multiple project directories risk acting under the wrong Linear account or hanging on interactive prompts.

## What Changes

- Initialize the modular TypeScript ESM CLI package (`linear-cli`) with global `linear` binary entrypoint, Commander command router, Vitest test suite, and build scripts.
- Implement strict per-directory authentication binding in `<cwd>/.linear/auth.json` (with auto-generated `<cwd>/.linear/.gitignore`) that never traverses parent directories and never falls back to global credentials.
- Implement pluggable secret storage defaulting to macOS Keychain (`security` CLI) with explicit `--storage file` (`0600`) support and in-memory test adapter.
- Implement `linear auth` commands:
  - `linear auth login` (OAuth 2.0 PKCE loopback user flow, `--api-key` personal API key flow via stdin/prompt, and `--app` OAuth `client_credentials` flow)
  - `linear auth status` (local folder auth inspection without requiring network)
  - `linear auth whoami` (live Linear `viewer` and `organization` verification)
  - `linear auth reauth` (replace existing folder credentials cleanly)
  - `linear auth logout` (delete current folder's binding and secret without affecting other folders)
  - `linear auth revoke` (revoke OAuth token via `https://api.linear.app/oauth/revoke` and remove local binding)
- Implement core automation runtime: `--json` / human output formatting with secret redaction, `--non-interactive` prompt guard, `--dry-run`, `--cwd`, `--expect-workspace` / `--expect-user` identity guardrails, deterministic exit codes, `429` `Retry-After` backoff, and `OUTCOME_UNKNOWN` create-timeout protection.

## Capabilities

### New Capabilities
- `folder-scoped-auth`: Strict per-directory `.linear/auth.json` binding, OS Keychain / `0600` file secret storage, OAuth PKCE / Personal API Key / OAuth Client Credentials login, automatic token refresh, reauth, logout, and revocation.
- `cli-automation-runtime`: Global CLI flags (`--json`, `--non-interactive`, `--dry-run`, `--cwd`, `--expect-workspace`, `--expect-user`), deterministic exit codes, secret redaction, Relay pagination helpers, rate-limit retry, and non-idempotent timeout safety.

### Modified Capabilities

## Impact

- Creates `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/bin/linear.ts`, `src/cli/*`, `src/core/*`, `src/auth/*`, `src/modules/auth/*`, and `tests/sec-01-auth/*`.
- Adds runtime dependencies `@linear/sdk` (`^104.0.0`) and `commander`, plus devDependencies `typescript`, `vitest`, `@types/node`, and `tsx`.
