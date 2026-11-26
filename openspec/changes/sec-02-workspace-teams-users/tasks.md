# Tasks

## 1. Ambiguity-Safe Entity Resolvers

- [x] 1.1 Implement `src/core/resolvers.ts` covering teams, users (`me`/UUID/email/name), workflow states, issue labels, projects, cycles, and priorities, and verify unit tests cover exact match, `NOT_FOUND` (`exit 4`), and `AMBIGUOUS_RESOURCE` (`exit 6`) in `tests/sec-02-workspace/resolvers.test.ts`

## 2. Workspace, Users, Teams, Statuses, Labels, and Templates Commands

- [x] 2.1 Implement `src/modules/workspace/commands.ts` (`workspace info`, `me`, `user list|get`, `team list|get|members`, `status list`, `label list`, `template list|get`), register it in `src/cli/app.ts`, and verify CLI tests pass in `tests/sec-02-workspace/workspace-cli.test.ts`
- [x] 2.2 Rebuild `dist/bin/linear.js`, run Vitest saving results to `reports/sec-02-test-result.json`, and verify live read-only discovery commands against an isolated temp folder

## Workflow follow-up

- Keep `sec-02-workspace-teams-users` unarchived for final user deliverable review before running `openspec archive`.
