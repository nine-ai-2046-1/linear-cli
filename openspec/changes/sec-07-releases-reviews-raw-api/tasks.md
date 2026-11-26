# Tasks

## 1. Releases, Release Notes, Reviews, and AST-Guarded Raw GraphQL Commands

- [x] 1.1 Implement `release pipeline list`, `release list|get|create|update`, `release-note list|get|create`, `review list|get|link|comment|approve|request-changes|merge`, and AST-guarded `api query|mutation` in `src/modules/advanced/commands.ts`, register in `src/cli/app.ts`, and verify unit tests pass in `tests/sec-07-advanced/advanced-cli.test.ts`

## 2. Global CLI Installation, Bilingual Docs, and End-to-End Build Verification

- [x] 2.1 Create `scripts/install-global.sh`, `README.md`, and `README-zh.md` inside `linear-cli`, install `linear` into `~/.local/bin/linear`, run full Vitest suite saving results to `reports/sec-07-test-result.json`, and verify global `linear --help` and live `linear api query`

## Workflow follow-up

- Keep `sec-07-releases-reviews-raw-api` unarchived for final user deliverable review before running `openspec archive`.
