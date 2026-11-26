# labels-views-inbox Specification

## Purpose

Provides CLI commands for issue label management (create, update, retire/archive, restore), saved custom view discovery, and inbox notification triage.

## Requirements

### Requirement: Issue Label Creation, Update, Archive/Retire, and Restore
The CLI SHALL provide `linear label create`, `linear label update <label>`, `linear label archive <label>` (retiring the label via `issueLabelRetire`, or permanently deleting only when `--delete --yes` is passed), and `linear label restore <label>` (`issueLabelRestore`).

#### Scenario: Create, retire, and restore a team label
- **WHEN** `linear label create --name "Tech Debt" --team NIN --color "#EB5757" --json`, `linear label archive "Tech Debt" --team NIN --json`, and `linear label restore "Tech Debt" --team NIN --json` execute
- **THEN** the CLI creates the label on team `NIN`, retires it safely without deleting historical associations, and restores it

### Requirement: Saved Custom Views Discovery
The CLI SHALL provide `linear view list` (supporting `--query`, `--team`, `--shared`, `--limit`, `--cursor`) and `linear view get <view>` (by UUID, slugId, or exact name).

#### Scenario: Inspect saved view metadata and filterData
- **WHEN** `linear view list --shared --json` and `linear view get "Active Bugs" --json` execute
- **THEN** the CLI returns shared custom views and the selected view's `id`, `name`, `modelName`, `shared`, and `filterData`

### Requirement: Inbox Notifications Listing and State Updates
The CLI SHALL provide `linear inbox list` (`--unread`, `--limit`, `--cursor`), `linear inbox read <id>`, `linear inbox unread <id>`, and `linear inbox snooze <id> --until <iso-or-none>`.

#### Scenario: List unread notifications and mark read or snoozed
- **WHEN** `linear inbox list --unread --json`, `linear inbox read notif-1 --json`, and `linear inbox snooze notif-1 --until 2026-12-01T09:00:00Z --json` execute
- **THEN** the CLI filters unread notifications and updates `readAt` and `snoozedUntilAt` accordingly
