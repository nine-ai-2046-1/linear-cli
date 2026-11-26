# Proposal

## Why

Issues are the primary daily unit of work in Linear (covering tasks, features, improvements, and bugs). Agents and users need rich, non-interactive CLI commands to list and filter assigned or team issues, run full-text searches, inspect details, create and partially update issues without clobbering existing fields or labels, manage lifecycle states/sharing/subscriptions, and maintain parent/child hierarchies and issue relations.

## What Changes

- Implement `src/modules/issues/commands.ts` and filter/mapper utilities (`src/modules/issues/filter.ts`):
  - Discovery & Inspection: `linear issue list`, `linear issue mine`, `linear issue search <query>`, `linear issue get <issue>`, `linear issue children <issue>`, `linear issue relation list <issue>`
  - Creation & Partial Update: `linear issue create` (supporting `--description-file`, `--template`, `--parent`, `--label`, etc.) and `linear issue update <issue>`
  - Targeted Field Shortcuts: `linear issue status <issue> <status>`, `linear issue assign <issue> <user>`, `linear issue unassign <issue>`, `linear issue label add <issue> <label...>`, `linear issue label remove <issue> <label...>`, `linear issue priority <issue> <priority>`, `linear issue project set <issue> <project|none>`, `linear issue parent set <issue> <parent|none>`
  - Lifecycle, Subscription, Sharing & Relations: `linear issue archive <issue>`, `linear issue restore <issue>`, `linear issue delete <issue> --yes`, `linear issue subscribe <issue>`, `linear issue unsubscribe <issue>`, `linear issue share <issue> <user>`, `linear issue unshare <issue> <user>`, `linear issue relation add <issue>`, `linear issue relation remove <relation-id>`

## Capabilities

### New Capabilities
- `issue-lifecycle-and-relations`: Full issue querying, multi-predicate filtering, full-text search, creation, partial updates, incremental label/status/assignee/priority/project changes, archive/restore/delete, subscribe/share, sub-issue hierarchy, and issue relations.

### Modified Capabilities

## Impact

- Adds `src/modules/issues/filter.ts`, `src/modules/issues/commands.ts`, and `tests/sec-03-issues/*`, and registers `issue` commands in `src/cli/app.ts`.
