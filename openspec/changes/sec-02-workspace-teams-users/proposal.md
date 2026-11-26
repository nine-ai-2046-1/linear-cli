# Proposal

## Why

Before agents or users can create, filter, or assign Linear work items, they need deterministic commands to inspect workspace metadata, discover teams, members, workflow statuses, issue labels, and templates, and resolve human-friendly names (`me`, team keys like `NIN`, emails, or display names) without guessing UUIDs. Ambiguous matches must fail explicitly rather than picking an arbitrary entity.

## What Changes

- Implement shared human-friendly entity resolvers (`src/core/resolvers.ts`) for users (`me`, UUID, email, displayName, name), teams (UUID, key, name), workflow statuses (UUID, name, type within a team), labels (UUID, name), projects (UUID, identifier, slugId, name), cycles (`current`, `next`, `previous`, number, name, UUID), and priority names (`none`, `urgent`, `high`, `medium`, `low`, `0`–`4`) with strict `AMBIGUOUS_RESOURCE` (`exit 6`) and `NOT_FOUND` (`exit 4`) behavior.
- Implement Section 2 discovery commands under `src/modules/workspace/`:
  - `linear workspace info`
  - `linear me`
  - `linear user list` and `linear user get <user>`
  - `linear team list`, `linear team get <team>`, and `linear team members <team>`
  - `linear status list --team <team>`
  - `linear label list [--team <team>]`
  - `linear template list [--team <team>] [--type <type>]` and `linear template get <template>`

## Capabilities

### New Capabilities
- `workspace-directory-discovery`: Workspace info, authenticated viewer (`me`), user/member listing and lookup, team listing/details/members, workflow status discovery, label discovery, template discovery, and ambiguity-safe human-friendly entity resolution.

### Modified Capabilities

## Impact

- Adds `src/core/resolvers.ts` and `src/modules/workspace/commands.ts`, registers the workspace module in `src/cli/app.ts`, and adds `tests/sec-02-workspace/*`.
