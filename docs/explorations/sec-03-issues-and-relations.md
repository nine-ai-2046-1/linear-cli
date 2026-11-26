# Section 3 Exploration: Issues, Filtering, Search, Sub-Issues & Relations

## Issue Operations Architecture

```text
+-----------------------------------------------------------------------+
|                       `linear issue ...`                              |
+-------------------+---------------------------+-----------------------+
                    |                           |
      +-------------+-------------+             +-----------+-----------+
      |    Read / Filter / Search |             |  Mutations & Relations|
      +-------------+-------------+             +-----------+-----------+
                    |                                       |
  - issue list (AND filter builder)         - issue create (--description-file)
  - issue mine (--assignee me)              - issue update (partial diff)
  - issue search (searchIssues)             - issue status / assign / unassign
  - issue get (UUID or NIN-11)              - issue label add / remove
  - issue children (sub-issues)             - issue priority / project set
  - issue relation list (out + inverse)     - issue archive / restore / delete
                                            - issue subscribe / unsubscribe
                                            - issue share / unshare
                                            - issue parent set
                                            - issue relation add / remove
```

## SDK Nuances Verified in `@linear/sdk@104.0.0`

1. **Incremental Labels (`addedLabelIds` / `removedLabelIds`)**: `IssueUpdateInput` supports `addedLabelIds` and `removedLabelIds` natively without needing to overwrite `labelIds`, preventing race conditions on existing labels.
2. **Search vs Filter**: `client.searchIssues(term, vars)` runs full-text search across titles, descriptions, and optionally comments (`includeComments`), while `client.issues({ filter })` applies structured GraphQL `IssueFilter` predicates (`assignee`, `state`, `team`, `project`, `cycle`, `labels`, `priority`, `updatedAt`, `completedAt`, `creator`, `parent`).
3. **Relations (`IssueRelationType`)**: Linear stores directional relations (`blocks`, `duplicate`, `related`). For `--type blocked-by`, `A blocked-by B` is stored in Linear by creating `{ issueId: B, relatedIssueId: A, type: "blocks" }`, while `issue relation list <A>` combines `issue.relations()` and `issue.inverseRelations()` so the user sees both directions clearly.
