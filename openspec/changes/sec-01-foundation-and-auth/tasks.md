# Tasks

## 1. Package & TypeScript Modular Scaffolding

- [x] 1.1 Create `package.json`, `tsconfig.json`, `vitest.config.ts`, and `.gitignore` inside `linear-cli` and verify `npm install` and `npm run typecheck` succeed
- [x] 1.2 Create shared error codes (`src/core/errors.ts`), secret-redacting output formatter (`src/core/output.ts`), pagination helper (`src/core/pagination.ts`), and rate-limit/timeout execution wrapper (`src/core/retry.ts`), and verify unit tests pass in `tests/sec-01-auth/runtime.test.ts`

## 2. Per-Folder Auth Store, Secret Backends, and OAuth/API-Key/App Service

- [x] 2.1 Implement strict working-directory `.linear/auth.json` store (`src/auth/types.ts`, `src/auth/store.ts`) and pluggable secret stores (`src/auth/keychain.ts`: macOS Keychain, `0600` file store, in-memory store), and verify unit tests cover folder isolation, no parent traversal, permissions, and `.gitignore` creation
- [x] 2.2 Implement OAuth PKCE loopback helper, refresh lockfile renewal, OAuth client-credentials grant, and OAuth revocation (`src/auth/oauth.ts`, `src/auth/service.ts`), and verify unit tests cover PKCE code exchange, token rotation refresh, `client_credentials` renewal, and revocation

## 3. CLI Router & `linear auth` Command Suite

- [x] 3.1 Implement root CLI router (`src/cli/context.ts`, `src/cli/app.ts`, `src/bin/linear.ts`), authenticated `LinearClient` wrapper with `--expect-workspace` / `--expect-user` guards (`src/core/client.ts`), and `linear auth login|status|whoami|reauth|logout|revoke` (`src/modules/auth/commands.ts`), and verify CLI integration tests pass in `tests/sec-01-auth/auth-cli.test.ts`
- [x] 3.2 Build `dist/bin/linear.js`, execute the full Section 1 test suite writing JSON results to `reports/sec-01-test-result.json`, and verify compiled binary behavior across two isolated temporary folders

## Workflow follow-up

- Keep `sec-01-foundation-and-auth` unarchived for final user deliverable review before running `openspec archive`.
