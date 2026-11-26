# Spec Delta

## Purpose

Provides complete non-interactive Linear issue querying, multi-predicate filtering, full-text search, creation, partial field updates, lifecycle actions, sub-issue hierarchies, and issue relationships.

## ADDED Requirements

### Requirement: Structured Issue Listing, Assigned Filter, and Search
The CLI SHALL provide `linear issue list` with combinable AND filters (`--assignee`, `--unassigned`, `--status`, `--team`, `--project`, `--cycle`, `--label`, `--priority`, `--updated-after`, `--completed-after`, `--creator`, `--parent`, `--include-archived`, `--limit`, `--cursor`, `--sort`), `linear issue mine` (defaulting `--assignee me`), `linear issue search <query>`, and `linear issue get <issue>`.

#### Scenario: Filter assigned issues by status and label
- **WHEN** `linear issue mine --status "In Progress" --label Feature --json` executes
- **THEN** the CLI queries Linear with an AND filter matching viewer assignee, status `"In Progress"`, and label `"Feature"`

#### Scenario: Reject conflicting assignee and unassigned flags
- **WHEN** `linear issue list --assignee me --unassigned --json` executes
- **THEN** the CLI exits with code `5` (`VALIDATION_ERROR`) rather than ignoring a filter

### Requirement: Issue Creation and Partial Non-Destructive Updates
The CLI SHALL provide `linear issue create` (supporting `--team`, `--title`, `--description` or `--description-file`, `--assignee`, `--status`, `--label`, `--priority`, `--project`, `--milestone`, `--cycle`, `--parent`, `--estimate`, `--due-date`, `--template`) and `linear issue update <issue>` modifying only explicitly specified fields.

#### Scenario: Create issue from Markdown file with labels and assignee
- **WHEN** `linear issue create --team NIN --title "Add CLI" --description-file spec.md --assignee me --label Feature --json` executes
- **THEN** the CLI resolves team, viewer, and label UUIDs, calls `createIssue` using non-retrying create guardrails, and returns the created issue identifier and URL

#### Scenario: Incremental label add and remove preserve existing labels
- **WHEN** `linear issue label add NIN-11 Improvement --json` and `linear issue label remove NIN-11 Bug --json` execute
- **THEN** the CLI passes `addedLabelIds` and `removedLabelIds` respectively without overwriting other labels on `NIN-11`

### Requirement: Issue Shortcut Mutations and Lifecycle Controls
The CLI SHALL provide `linear issue status`, `assign`, `unassign`, `priority`, `project set`, `archive`, `restore`, `delete --yes`, `subscribe`, `unsubscribe`, `share`, and `unshare`.

#### Scenario: Delete issue requires explicit confirmation flag
- **WHEN** `linear issue delete NIN-99 --non-interactive --json` runs without `--yes`
- **THEN** the CLI aborts with exit code `5` (`VALIDATION_ERROR`) without deleting `NIN-99`

### Requirement: Sub-Issues and Bidirectional Issue Relations
The CLI SHALL provide `linear issue children <issue>`, `linear issue parent set <issue> <parent|none>`, `linear issue relation list <issue>`, `linear issue relation add <issue> --type <blocks|blocked-by|related|duplicate> --target <other>`, and `linear issue relation remove <relation-id>`.

#### Scenario: Add blocked-by relation normalizes direction
- **WHEN** `linear issue relation add NIN-12 --type blocked-by --target NIN-11 --json` executes
- **THEN** the CLI creates a `blocks` relation with `issueId: "NIN-11"` and `relatedIssueId: "NIN-12"`
