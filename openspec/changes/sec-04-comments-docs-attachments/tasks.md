# Tasks

## 1. Comments and Documents Commands

- [x] 1.1 Implement `comment list|add|reply|update|delete` and `document list|get|create|update|archive|restore` in `src/modules/collaboration/commands.ts` and verify unit tests cover root-thread reply resolution, Markdown file inputs, and destructive `--yes` guards in `tests/sec-04-collaboration/comments-docs.test.ts`

## 2. File Upload, Link, and Host-Scoped Download Attachments

- [x] 2.1 Implement `attachment list|get|upload|link|download|remove` in `src/modules/collaboration/commands.ts`, register collaboration commands in `src/cli/app.ts`, and verify unit tests cover pre-signed `PUT` headers and `uploads.linear.app` Authorization header scoping in `tests/sec-04-collaboration/attachments.test.ts`
- [x] 2.2 Rebuild `dist/bin/linear.js`, run Vitest saving results to `reports/sec-04-test-result.json`, and verify compiled collaboration commands

## Workflow follow-up

- Keep `sec-04-comments-docs-attachments` unarchived for final user deliverable review before running `openspec archive`.
