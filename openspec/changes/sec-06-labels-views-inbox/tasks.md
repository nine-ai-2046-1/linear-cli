# Tasks

## 1. Label Lifecycle, Custom Views, and Inbox Commands

- [x] 1.1 Implement `label create|update|archive|restore`, `view list|get`, and `inbox list|read|unread|snooze` in `src/modules/metadata/commands.ts`, register in `src/cli/app.ts`, and verify unit tests cover label retire/restore, custom views, and inbox read/unread/snooze in `tests/sec-06-metadata/metadata-cli.test.ts`
- [x] 1.2 Rebuild `dist/bin/linear.js`, run Vitest saving results to `reports/sec-06-test-result.json`, and verify compiled metadata commands

## Workflow follow-up

- Keep `sec-06-labels-views-inbox` unarchived for final user deliverable review before running `openspec archive`.
