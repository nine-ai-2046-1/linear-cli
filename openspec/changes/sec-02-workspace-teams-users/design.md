# Design

## Context

See `proposal.md` for motivation. Subsequent CLI modules (issues, comments, projects, cycles, labels, releases) all depend on converting human-readable references (`me`, `NIN`, `"In Progress"`, `"Raymond Magic"`) into canonical Linear UUIDs safely.

## Goals / Non-Goals

**Goals:**
- Centralize reference resolution in `src/core/resolvers.ts` so every command shares identical matching and ambiguity detection rules.
- Expose clean discovery commands for workspace, viewer, users, teams, workflow states, labels, and templates.

**Non-Goals:**
- Mutating labels, statuses, or teams (label CRUD/retire/restore is covered in Section 6).

## Decisions

### 1. Ambiguity-Safe Resolver Pipeline (`src/core/resolvers.ts`)

```text
Input Ref ---> UUID regex? ---> Direct SDK fetch (404 -> NOT_FOUND exit 4)
          |
          +--> "me" (user)? --> client.viewer.id
          |
          +--> Query filtered candidates from Linear API
                    |
                    +--> 0 exact matches ---> NOT_FOUND (exit 4)
                    +--> 1 exact match  ---> Return canonical entity
                    +--> >1 matches     ---> AMBIGUOUS_RESOURCE (exit 6)
```

- **Rationale**: Linear's GraphQL mutations require UUIDs (`teamId`, `stateId`, `assigneeId`, `labelIds`). Silent first-match selection causes data corruption when names collide across teams or users; failing with exit code `6` (`AMBIGUOUS_RESOURCE`) and candidate IDs lets both humans and agents disambiguate deterministically.

### 2. Module Layout

- `src/core/resolvers.ts`: Reusable resolvers (`resolveTeam`, `resolveUser`, `resolveWorkflowState`, `resolveIssueLabels`, `resolveProject`, `resolveCycle`, `parsePriority`).
- `src/modules/workspace/commands.ts`: Registers `workspace`, `me`, `user`, `team`, `status`, `template`, and baseline `label list` (designed so Section 6 extends `label` with `create|update|archive|restore` cleanly).

## Risks / Trade-offs

- **[Risk] Workspaces with >50 users/labels when resolving by name** → Mitigation: Push GraphQL `filter` predicates (`eqIgnoreCase` / `key: { eqIgnoreCase }`) directly into Linear's API query rather than fetching an unfiltered first page in memory.
