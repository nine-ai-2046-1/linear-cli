# Design

## Context

See `proposal.md` for motivation. Issue operations span read-heavy filtered queries, full-text search, non-idempotent creation, idempotent field updates, and graph relationships.

## Goals / Non-Goals

**Goals:**
- Translate CLI filter flags into strongly typed Linear GraphQL `IssueFilter` predicates without fetching unnecessary pages in memory.
- Keep `create` guarded by `kind: "create"` (`OUTCOME_UNKNOWN` on timeout) while `update` / `status` / `assign` / `archive` use `kind: "idempotent-write"`.

**Non-Goals:**
- Issue comments and file attachments (covered in Section 4).

## Decisions

### 1. Filter Builder (`src/modules/issues/filter.ts`)

```text
CLI Flags (--assignee, --status, --team, --label, --priority, --updated-after, ...)
    |
    v
Validate mutually exclusive flags (--assignee vs --unassigned)
    |
    v
Construct LinearDocument.IssueFilter (AND composition)
    |
    v
client.issues({ filter, first, after, orderBy, includeArchived })
```

- **Why push all filters to GraphQL**: Linear's complexity rate-limiter charges per connection node; server-side `IssueFilter` minimizes complexity points and avoids false empty pages.

### 2. Relation Direction Normalization

- Linear's `IssueRelationType` enum has `blocks`, `duplicate`, and `related`. When a user specifies `issue relation add A --type blocked-by --target B`, we swap `(issueId = B, relatedIssueId = A, type = blocks)` so the user gets ergonomic CLI flags backed by Linear's exact schema.

## Risks / Trade-offs

- **[Risk] Resolving team-scoped status or label when updating an issue by identifier (`NIN-11`)** → Mitigation: Fetch `issue` and its owning `team` first so `--status "In Progress"` resolves strictly within `NIN-11`'s team workflow states.
