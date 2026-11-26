# Tasks

## 1. Issue Filter Builder & Query/Search Commands

- [x] 1.1 Implement `src/modules/issues/filter.ts` and read/search commands (`issue list`, `issue mine`, `issue search`, `issue get`, `issue children`, `issue relation list`) and verify unit tests cover combinable filters, conflicting filter rejection, search, and pagination in `tests/sec-03-issues/issues-read.test.ts`

## 2. Issue Creation, Partial Updates, Lifecycle, Sharing, and Relations

- [x] 2.1 Implement write commands in `src/modules/issues/commands.ts` (`create`, `update`, `status`, `assign`, `unassign`, `label add|remove`, `priority`, `project set`, `parent set`, `archive`, `restore`, `delete`, `subscribe`, `unsubscribe`, `share`, `unshare`, `relation add|remove`), register in `src/cli/app.ts`, and verify CLI tests pass in `tests/sec-03-issues/issues-write.test.ts`
- [x] 2.2 Rebuild `dist/bin/linear.js`, run Vitest saving results to `reports/sec-03-test-result.json`, and verify compiled `linear issue` commands against an isolated folder

## Workflow follow-up

- Keep `sec-03-issues-and-relations` unarchived for final user deliverable review before running `openspec archive`.
