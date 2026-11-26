# Design

## Context

See `proposal.md` for motivation. Section 6 extends the `label` command registered in Section 2 and introduces `view` and `inbox` command groups.

## Goals / Non-Goals

**Goals:**
- Default `label archive` to non-destructive `issueLabelRetire` so existing issues retain historical label context, matching Linear's recommended label lifecycle.
- Support both ISO timestamps and relative shortcuts (`none` to unsnooze, `+1h`, `+1d`, `+7d`) on `inbox snooze --until`.

**Non-Goals:**
- Mutating saved custom view filter schemas (view inspection only, per Section 6 scope).

## Decisions

### 1. Subcommand Extension on `linear label`

```text
`linear label` (created via getOrCreateSubcommand)
    +-- `list`    (Section 2)
    +-- `create`  (Section 6)
    +-- `update`  (Section 6)
    +-- `archive` (Section 6 -> issueLabelRetire, or --delete --yes -> deleteIssueLabel)
    +-- `restore` (Section 6 -> issueLabelRestore)
```

## Risks / Trade-offs

- **[Risk] Resolving retired label during `label restore`** → Mitigation: Pass `includeArchived: true` when looking up the target label in `label restore`.
