# Tasks

## 1. Projects and Milestones Commands

- [x] 1.1 Implement `project list|get|issues|create|update|status|archive|restore|delete` and `milestone list|get|create|update` in `src/modules/planning/commands.ts` and verify unit tests cover project status resolution, summary vs content fields, `--yes` delete guard, and milestone CRUD in `tests/sec-05-planning/projects-milestones.test.ts`

## 2. Cycles and Project Status Updates Commands

- [x] 2.1 Implement `cycle list|current|issues` and `update list|create|edit` in `src/modules/planning/commands.ts`, register planning commands in `src/cli/app.ts`, and verify unit tests cover `current`/`next`/`previous`/number cycle resolution and health status updates in `tests/sec-05-planning/cycles-updates.test.ts`
- [x] 2.2 Rebuild `dist/bin/linear.js`, run Vitest saving results to `reports/sec-05-test-result.json`, and verify compiled planning commands

## Workflow follow-up

- Keep `sec-05-projects-milestones-cycles` unarchived for final user deliverable review before running `openspec archive`.
